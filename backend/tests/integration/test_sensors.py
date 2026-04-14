"""
Isolated API tests for /api/sensors (routers/sensors.py).

GET  /api/sensors  — returns only active sensors, auth required
POST /api/sensors  — admin creates, dispatcher rejected, invalid payload
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

# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

_SENSOR_ID = uuid4()
_NOW = datetime.now(timezone.utc)

_MOCK_SENSOR = SimpleNamespace(
    id=_SENSOR_ID,
    description="Left Ultrasonic",
    is_active=True,
    created_at=_NOW,
    updated_at=_NOW,
)

_DISPATCHER = SimpleNamespace(id=1, email="user@test.com", role="dispatcher", is_active=True)
_ADMIN      = SimpleNamespace(id=2, email="admin@test.com", role="admin",      is_active=True)

client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


# ===========================================================================
# GET /api/sensors
# ===========================================================================

class TestGetSensors:

    def test_200_returns_active_sensors(self):
        db = MagicMock()
        # endpoint: db.query(Sensor).filter(is_active == True).all()
        db.query.return_value.filter.return_value.all.return_value = [_MOCK_SENSOR]
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_active_user] = lambda: _DISPATCHER

        response = client.get("/api/sensors")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["description"] == "Left Ultrasonic"
        assert data[0]["is_active"] is True
        assert "id" in data[0]

    def test_200_empty_list_when_no_active_sensors(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = []
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_active_user] = lambda: _DISPATCHER

        response = client.get("/api/sensors")

        assert response.status_code == 200
        assert response.json() == []

    def test_401_missing_token(self):
        app.dependency_overrides[get_db] = lambda: MagicMock()

        response = client.get("/api/sensors")

        assert response.status_code == 401


# ===========================================================================
# POST /api/sensors
# ===========================================================================

class TestCreateSensor:

    def test_201_admin_creates_sensor(self):
        db = MagicMock()
        def _assign(obj):
            obj.id = _SENSOR_ID
            obj.created_at = _NOW
            obj.updated_at = _NOW
        db.refresh.side_effect = _assign
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_active_user] = lambda: _ADMIN

        response = client.post(
            "/api/sensors",
            json={"description": "New Sensor", "is_active": True},
        )

        assert response.status_code == 201
        body = response.json()
        assert body["description"] == "New Sensor"
        assert body["is_active"] is True
        assert "id" in body

    def test_201_sensor_with_defaults(self):
        """SensorCreate has no required fields — empty body is valid."""
        db = MagicMock()
        def _assign(obj):
            obj.id = _SENSOR_ID
            obj.created_at = _NOW
            obj.updated_at = _NOW
        db.refresh.side_effect = _assign
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_active_user] = lambda: _ADMIN

        response = client.post("/api/sensors", json={})

        assert response.status_code == 201

    def test_403_dispatcher_cannot_create_sensor(self):
        app.dependency_overrides[get_db] = lambda: MagicMock()
        app.dependency_overrides[get_current_active_user] = lambda: _DISPATCHER

        response = client.post("/api/sensors", json={"description": "X"})

        assert response.status_code == 403

    def test_422_invalid_is_active_type(self):
        app.dependency_overrides[get_db] = lambda: MagicMock()
        app.dependency_overrides[get_current_active_user] = lambda: _ADMIN

        response = client.post("/api/sensors", json={"is_active": "yes-please"})

        assert response.status_code == 422
