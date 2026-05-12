"""
Isolated API tests for /api/sessions (routers/sessions.py).

POST /api/sessions — happy path, sensor not found, vehicle not found,
                     invalid UUIDs, missing auth
"""
import pytest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db
from app.deps import get_current_active_user
from app import models

# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

_SENSOR_ID  = uuid4()
_VEHICLE_ID = uuid4()
_SESSION_ID = uuid4()
_NOW = datetime(2024, 1, 1, tzinfo=timezone.utc)

_MOCK_SENSOR  = SimpleNamespace(id=_SENSOR_ID,  description="Sensor A", is_active=True)
_MOCK_VEHICLE = SimpleNamespace(id=_VEHICLE_ID, vehicle_name="Test Van", width=220.0)

_USER = SimpleNamespace(id=1, email="user@test.com", role="dispatcher", is_active=True)

client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helper: mock db whose .query() returns different results per model class.
# The sessions endpoint queries Sensor first, then Vehicle in sequence.
# ---------------------------------------------------------------------------

def _db_for_session(sensor=_MOCK_SENSOR, vehicle=_MOCK_VEHICLE):
    """
    Build a MagicMock session that returns *sensor* / *vehicle* when the
    endpoint calls db.query(Sensor/Vehicle).filter().first() respectively.
    """
    db = MagicMock()

    def _query(model_cls):
        q = MagicMock()
        if model_cls is models.Sensor:
            q.filter.return_value.first.return_value = sensor
        elif model_cls is models.Vehicle:
            q.filter.return_value.first.return_value = vehicle
        else:
            q.filter.return_value.first.return_value = None
        return q

    db.query.side_effect = _query

    # db.refresh(db_session) simulates DB assigning the session UUID and timestamps
    def _refresh(obj):
        obj.id = _SESSION_ID
        obj.created_at = _NOW
    db.refresh.side_effect = _refresh

    return db


# ===========================================================================
# POST /api/sessions
# ===========================================================================

class TestCreateSession:

    def test_201_happy_path(self):
        app.dependency_overrides[get_db] = lambda: _db_for_session()
        app.dependency_overrides[get_current_active_user] = lambda: _USER

        response = client.post(
            "/api/sessions",
            json={"sensor_id": str(_SENSOR_ID), "vehicle_id": str(_VEHICLE_ID)},
        )

        assert response.status_code == 201
        body = response.json()
        assert body["sensor_id"]  == str(_SENSOR_ID)
        assert body["vehicle_id"] == str(_VEHICLE_ID)
        assert "id" in body

    def test_404_sensor_not_found(self):
        # sensor=None → endpoint raises 404 immediately, vehicle is never queried
        app.dependency_overrides[get_db] = lambda: _db_for_session(sensor=None)
        app.dependency_overrides[get_current_active_user] = lambda: _USER

        response = client.post(
            "/api/sessions",
            json={"sensor_id": str(uuid4()), "vehicle_id": str(_VEHICLE_ID)},
        )

        assert response.status_code == 404
        assert "Sensor" in response.json()["detail"]

    def test_404_vehicle_not_found(self):
        # sensor found, vehicle=None → endpoint raises 404
        app.dependency_overrides[get_db] = lambda: _db_for_session(vehicle=None)
        app.dependency_overrides[get_current_active_user] = lambda: _USER

        response = client.post(
            "/api/sessions",
            json={"sensor_id": str(_SENSOR_ID), "vehicle_id": str(uuid4())},
        )

        assert response.status_code == 404
        assert "Vehicle" in response.json()["detail"]

    def test_422_invalid_uuid_format(self):
        app.dependency_overrides[get_db] = lambda: MagicMock()
        app.dependency_overrides[get_current_active_user] = lambda: _USER

        response = client.post(
            "/api/sessions",
            json={"sensor_id": "not-a-uuid", "vehicle_id": "also-not"},
        )

        assert response.status_code == 422

    def test_401_missing_token(self):
        app.dependency_overrides[get_db] = lambda: MagicMock()

        response = client.post(
            "/api/sessions",
            json={"sensor_id": str(_SENSOR_ID), "vehicle_id": str(_VEHICLE_ID)},
        )

        assert response.status_code == 401
