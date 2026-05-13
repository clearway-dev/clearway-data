"""
Isolated API tests for /api/v1/measurements (routers/measurements.py).

GET  /api/v1/measurements/recent        — happy path, auth required
POST /api/v1/measurements/raw-data/batch — happy path (Celery mocked),
                                         session not found, invalid payload,
                                         Celery failure does not fail request
"""
import pytest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db
from app.deps import get_current_active_user
from app import models

# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

_SESSION_ID = uuid4()
_BATCH_ID   = uuid4()
_NOW        = datetime.now(timezone.utc)

_MOCK_SESSION = SimpleNamespace(id=_SESSION_ID)

_MOCK_MEASUREMENT = SimpleNamespace(
    id=1,
    batch_id=_BATCH_ID,
    measured_at=_NOW,
    latitude=49.8175,
    longitude=13.3776,
    distance_left=250.0,
    distance_right=380.0,
    speed=13.5,
    accuracy_gps=2.1,
    is_valid=True,
    created_at=_NOW,
)

_USER = SimpleNamespace(id=1, email="user@test.com", role="dispatcher", is_active=True)

client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Payload helpers
# ---------------------------------------------------------------------------

def _item(**overrides):
    base = {
        "measured_at": "2026-02-24T10:30:00Z",
        "latitude": 49.8175,
        "longitude": 15.4730,
        "distance_left": 250.0,
        "distance_right": 380.0,
        "speed": 13.5,
        "accuracy_gps": 2.1,
    }
    return {**base, **overrides}


def _batch_payload(session_id=None, n=1):
    return {
        "session_id": str(session_id or _SESSION_ID),
        "measurements": [_item() for _ in range(n)],
    }


# ---------------------------------------------------------------------------
# Mock DB for batch ingest:
# db.add(new_batch) → tracked; db.flush() → assigns _BATCH_ID to Batch objects.
# This simulates the DB generating a UUID primary key on flush.
# ---------------------------------------------------------------------------

def _db_for_batch(session_exists=True):
    db = MagicMock()

    # Session existence check
    db.query.return_value.filter.return_value.first.return_value = (
        _MOCK_SESSION if session_exists else None
    )

    # Simulate DB assigning batch UUID on flush
    _pending = []
    db.add.side_effect = _pending.append

    def _flush():
        for obj in _pending:
            if isinstance(obj, models.Batch):
                obj.id = _BATCH_ID
        _pending.clear()

    db.flush.side_effect = _flush
    return db


# ===========================================================================
# GET /api/v1/measurements/recent
# ===========================================================================

class TestGetRecentMeasurements:

    def test_200_returns_measurement_list(self):
        db = MagicMock()
        # endpoint: db.query(...).order_by(...).limit(...).all()
        db.query.return_value.order_by.return_value.limit.return_value.all.return_value = [
            _MOCK_MEASUREMENT
        ]
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_active_user] = lambda: _USER

        response = client.get("/api/v1/measurements/recent")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["latitude"] == 49.8175

    def test_200_empty_list_when_no_measurements(self):
        db = MagicMock()
        db.query.return_value.order_by.return_value.limit.return_value.all.return_value = []
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_active_user] = lambda: _USER

        response = client.get("/api/v1/measurements/recent")

        assert response.status_code == 200
        assert response.json() == []

    def test_401_missing_token(self):
        app.dependency_overrides[get_db] = lambda: MagicMock()

        response = client.get("/api/v1/measurements/recent")

        assert response.status_code == 401


# ===========================================================================
# POST /api/v1/measurements/raw-data/batch
# ===========================================================================

class TestBatchIngest:

    def test_201_happy_path(self):
        app.dependency_overrides[get_db] = lambda: _db_for_batch(session_exists=True)
        app.dependency_overrides[get_current_active_user] = lambda: _USER

        with patch("app.routers.measurements.process_batch_task") as mock_task:
            response = client.post("/api/v1/measurements/raw-data/batch", json=_batch_payload())

        assert response.status_code == 201
        body = response.json()
        assert body["success"] is True
        assert body["total_received"] == 1
        assert body["total_stored"] == 1
        assert body["batch_id"] == str(_BATCH_ID)
        # Celery task must be queued with the batch UUID
        mock_task.delay.assert_called_once_with(str(_BATCH_ID))

    def test_404_session_not_found(self):
        app.dependency_overrides[get_db] = lambda: _db_for_batch(session_exists=False)
        app.dependency_overrides[get_current_active_user] = lambda: _USER

        with patch("app.routers.measurements.process_batch_task"):
            response = client.post(
                "/api/v1/measurements/raw-data/batch",
                json=_batch_payload(session_id=uuid4()),
            )

        assert response.status_code == 404

    def test_422_empty_measurements_list(self):
        app.dependency_overrides[get_db] = lambda: _db_for_batch()
        app.dependency_overrides[get_current_active_user] = lambda: _USER

        with patch("app.routers.measurements.process_batch_task"):
            response = client.post(
                "/api/v1/measurements/raw-data/batch",
                json={"session_id": str(_SESSION_ID), "measurements": []},
            )

        assert response.status_code == 422

    def test_401_missing_token(self):
        app.dependency_overrides[get_db] = lambda: _db_for_batch()

        with patch("app.routers.measurements.process_batch_task"):
            response = client.post(
                "/api/v1/measurements/raw-data/batch",
                json=_batch_payload(),
            )

        assert response.status_code == 401

    def test_201_celery_failure_does_not_fail_request(self):
        """
        If Celery raises (e.g., Redis unreachable), the endpoint must still
        return 201 — data is already committed and the error is only logged.
        """
        app.dependency_overrides[get_db] = lambda: _db_for_batch(session_exists=True)
        app.dependency_overrides[get_current_active_user] = lambda: _USER

        with patch("app.routers.measurements.process_batch_task") as mock_task:
            mock_task.delay.side_effect = Exception("Redis unavailable")
            response = client.post("/api/v1/measurements/raw-data/batch", json=_batch_payload())

        assert response.status_code == 201
        assert response.json()["total_stored"] == 1
