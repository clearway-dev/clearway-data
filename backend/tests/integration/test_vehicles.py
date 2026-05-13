"""
Isolated API tests for /api/v1/vehicles (routers/vehicles.py).

Architecture
────────────
No real database. The get_db dependency is overridden with a plain MagicMock
session so that db.query().all() / .filter().first() / .refresh() return
exactly what each test needs.

Auth dependencies (get_current_active_user) are also overridden so tests
are not coupled to JWT logic. The 401 tests verify auth without an override
so the real OAuth2PasswordBearer raises the expected error.

Test count: 3-4 per endpoint.
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

_VEHICLE_ID = uuid4()
_NOW = datetime(2024, 1, 1, tzinfo=timezone.utc)

# SimpleNamespace gives attribute access that Pydantic's from_attributes=True
# can read (same as a SQLAlchemy model instance, without touching the DB).
_MOCK_VEHICLE = SimpleNamespace(
    id=_VEHICLE_ID,
    vehicle_name="Test Van",
    width=220.0,
    created_at=_NOW,
    updated_at=_NOW,
)

_DISPATCHER = SimpleNamespace(id=1, email="user@test.com", role="dispatcher", is_active=True)
_ADMIN      = SimpleNamespace(id=2, email="admin@test.com", role="admin",      is_active=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _db_returning_list(vehicles: list):
    """Mock session whose .query().all() returns *vehicles*."""
    db = MagicMock()
    db.query.return_value.all.return_value = vehicles
    return db


def _db_returning_first(obj):
    """Mock session whose .query().filter().first() returns *obj*."""
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = obj
    return db


def _db_for_create(assigned_id=_VEHICLE_ID):
    """
    Mock session for POST endpoint.
    db.refresh(vehicle_obj) simulates the DB assigning a UUID primary key and timestamps.
    """
    db = MagicMock()
    def _assign_id(obj):
        obj.id = assigned_id
        obj.created_at = _NOW
        obj.updated_at = _NOW
    db.refresh.side_effect = _assign_id
    return db


# ---------------------------------------------------------------------------
# Fixture: guarantee overrides are always cleared, even on test failure
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# TestClient (module-level — no DB connection opened, no lifespan needed)
# ---------------------------------------------------------------------------

client = TestClient(app, raise_server_exceptions=False)


# ===========================================================================
# GET /api/v1/vehicles
# ===========================================================================

class TestGetVehicles:

    def test_200_returns_vehicle_list(self):
        app.dependency_overrides[get_db] = lambda: _db_returning_list([_MOCK_VEHICLE])
        app.dependency_overrides[get_current_active_user] = lambda: _DISPATCHER

        response = client.get("/api/v1/vehicles")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["vehicle_name"] == "Test Van"
        assert data[0]["width"] == 220.0
        assert "id" in data[0]

    def test_200_empty_list_when_no_vehicles(self):
        app.dependency_overrides[get_db] = lambda: _db_returning_list([])
        app.dependency_overrides[get_current_active_user] = lambda: _DISPATCHER

        response = client.get("/api/v1/vehicles")

        assert response.status_code == 200
        assert response.json() == []

    def test_401_missing_token(self):
        # No auth override → real OAuth2PasswordBearer runs → no token → 401
        app.dependency_overrides[get_db] = lambda: _db_returning_list([])

        response = client.get("/api/v1/vehicles")

        assert response.status_code == 401


# ===========================================================================
# POST /api/v1/vehicles
# ===========================================================================

class TestCreateVehicle:

    def test_201_admin_creates_vehicle(self):
        # require_admin depends on get_current_active_user;
        # returning role="admin" means the real require_admin check passes.
        app.dependency_overrides[get_db] = lambda: _db_for_create()
        app.dependency_overrides[get_current_active_user] = lambda: _ADMIN

        response = client.post(
            "/api/v1/vehicles",
            json={"vehicle_name": "Fire Truck", "width": 250.0},
        )

        assert response.status_code == 201
        body = response.json()
        assert body["vehicle_name"] == "Fire Truck"
        assert body["width"] == 250.0
        assert "id" in body

    def test_403_dispatcher_cannot_create_vehicle(self):
        # role="dispatcher" → real require_admin raises 403
        app.dependency_overrides[get_db] = lambda: _db_for_create()
        app.dependency_overrides[get_current_active_user] = lambda: _DISPATCHER

        response = client.post(
            "/api/v1/vehicles",
            json={"vehicle_name": "Stealth Van", "width": 180.0},
        )

        assert response.status_code == 403

    def test_422_width_zero_fails_schema_validation(self):
        # Pydantic rejects width=0 (Field gt=0) before endpoint runs
        app.dependency_overrides[get_db] = lambda: _db_for_create()
        app.dependency_overrides[get_current_active_user] = lambda: _ADMIN

        response = client.post(
            "/api/v1/vehicles",
            json={"vehicle_name": "Zero Width", "width": 0},
        )

        assert response.status_code == 422

    def test_422_empty_vehicle_name_fails_schema_validation(self):
        # min_length=1 on vehicle_name
        app.dependency_overrides[get_db] = lambda: _db_for_create()
        app.dependency_overrides[get_current_active_user] = lambda: _ADMIN

        response = client.post(
            "/api/v1/vehicles",
            json={"vehicle_name": "", "width": 100.0},
        )

        assert response.status_code == 422


# ===========================================================================
# GET /api/v1/vehicles/{vehicle_id}
# ===========================================================================

class TestGetVehicleById:

    def test_200_returns_vehicle(self):
        app.dependency_overrides[get_db] = lambda: _db_returning_first(_MOCK_VEHICLE)
        app.dependency_overrides[get_current_active_user] = lambda: _DISPATCHER

        response = client.get(f"/api/v1/vehicles/{_VEHICLE_ID}")

        assert response.status_code == 200
        body = response.json()
        assert body["vehicle_name"] == "Test Van"
        assert body["width"] == 220.0

    def test_404_vehicle_not_found(self):
        # first() returning None → endpoint raises 404
        app.dependency_overrides[get_db] = lambda: _db_returning_first(None)
        app.dependency_overrides[get_current_active_user] = lambda: _DISPATCHER

        response = client.get(f"/api/v1/vehicles/{uuid4()}")

        assert response.status_code == 404

    def test_401_missing_token(self):
        app.dependency_overrides[get_db] = lambda: _db_returning_first(_MOCK_VEHICLE)

        response = client.get(f"/api/v1/vehicles/{_VEHICLE_ID}")

        assert response.status_code == 401
