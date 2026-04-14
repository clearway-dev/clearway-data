"""
Isolated API tests for /api/auth (routers/auth.py).

POST /login/access-token  — happy path, wrong password, unknown user
GET  /users/me            — 200, 401
GET  /users               — admin 200, dispatcher 403
POST /users               — admin creates, duplicate email 409
PUT  /users/{id}          — admin updates, user not found 404
DELETE /users/{id}        — admin deletes, cannot delete self 400
"""
import pytest
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db
from app.deps import get_current_active_user
from app.core.security import get_password_hash

# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

_HASHED_PW = get_password_hash("testpassword")  # pre-hashed so verify_password succeeds

_MOCK_USER = SimpleNamespace(
    id=1,
    email="user@test.com",
    full_name="Test User",
    role="dispatcher",
    is_active=True,
    hashed_password=_HASHED_PW,
)

_MOCK_ADMIN = SimpleNamespace(
    id=2,
    email="admin@test.com",
    full_name="Admin User",
    role="admin",
    is_active=True,
    hashed_password=get_password_hash("adminpassword"),
)

_DISPATCHER = SimpleNamespace(id=1, email="user@test.com",  role="dispatcher", is_active=True, full_name="Test User")
_ADMIN      = SimpleNamespace(id=2, email="admin@test.com", role="admin",       is_active=True, full_name="Admin User")

client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


# ===========================================================================
# POST /api/auth/login/access-token
# ===========================================================================

class TestLogin:

    def test_200_returns_access_token(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = _MOCK_USER
        app.dependency_overrides[get_db] = lambda: db

        response = client.post(
            "/api/auth/login/access-token",
            data={"username": "user@test.com", "password": "testpassword"},
        )

        assert response.status_code == 200
        body = response.json()
        assert "access_token" in body
        assert body["token_type"] == "bearer"

    def test_401_wrong_password(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = _MOCK_USER
        app.dependency_overrides[get_db] = lambda: db

        response = client.post(
            "/api/auth/login/access-token",
            data={"username": "user@test.com", "password": "WRONG"},
        )

        assert response.status_code == 401

    def test_401_unknown_email(self):
        db = MagicMock()
        # user not found in DB → returns None
        db.query.return_value.filter.return_value.first.return_value = None
        app.dependency_overrides[get_db] = lambda: db

        response = client.post(
            "/api/auth/login/access-token",
            data={"username": "nobody@example.com", "password": "pw"},
        )

        assert response.status_code == 401


# ===========================================================================
# GET /api/auth/users/me
# ===========================================================================

class TestUsersMe:

    def test_200_returns_current_user(self):
        # No get_db override needed — endpoint has no db dependency
        app.dependency_overrides[get_current_active_user] = lambda: _DISPATCHER

        response = client.get("/api/auth/users/me")

        assert response.status_code == 200
        body = response.json()
        assert body["email"] == "user@test.com"
        assert body["role"] == "dispatcher"

    def test_401_missing_token(self):
        # No overrides at all — real JWT validation raises 401
        response = client.get("/api/auth/users/me")

        assert response.status_code == 401


# ===========================================================================
# GET /api/auth/users  (admin only)
# ===========================================================================

class TestListUsers:

    def test_200_admin_gets_user_list(self):
        db = MagicMock()
        db.query.return_value.order_by.return_value.all.return_value = [_MOCK_USER, _MOCK_ADMIN]
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_active_user] = lambda: _ADMIN

        response = client.get("/api/auth/users")

        assert response.status_code == 200
        emails = [u["email"] for u in response.json()]
        assert "user@test.com"  in emails
        assert "admin@test.com" in emails

    def test_403_dispatcher_cannot_list_users(self):
        app.dependency_overrides[get_db] = lambda: MagicMock()
        app.dependency_overrides[get_current_active_user] = lambda: _DISPATCHER

        response = client.get("/api/auth/users")

        assert response.status_code == 403


# ===========================================================================
# POST /api/auth/users  (admin only)
# ===========================================================================

class TestCreateUser:

    def test_201_admin_creates_user(self):
        db = MagicMock()
        # No existing user with this email
        db.query.return_value.filter.return_value.first.return_value = None
        # db.refresh assigns an id
        db.refresh.side_effect = lambda obj: setattr(obj, "id", 99)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_active_user] = lambda: _ADMIN

        response = client.post(
            "/api/auth/users",
            json={"email": "new@test.com", "password": "pw", "role": "dispatcher"},
        )

        assert response.status_code == 201
        assert response.json()["email"] == "new@test.com"

    def test_409_duplicate_email(self):
        db = MagicMock()
        # existing user found → 409
        db.query.return_value.filter.return_value.first.return_value = _MOCK_USER
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_active_user] = lambda: _ADMIN

        response = client.post(
            "/api/auth/users",
            json={"email": "user@test.com", "password": "pw"},
        )

        assert response.status_code == 409

    def test_403_dispatcher_cannot_create_user(self):
        app.dependency_overrides[get_db] = lambda: MagicMock()
        app.dependency_overrides[get_current_active_user] = lambda: _DISPATCHER

        response = client.post(
            "/api/auth/users",
            json={"email": "x@x.com", "password": "pw"},
        )

        assert response.status_code == 403


# ===========================================================================
# PUT /api/auth/users/{user_id}  (admin only)
# ===========================================================================

class TestUpdateUser:

    def test_200_admin_updates_user(self):
        # Build a mutable user object so the endpoint can write to its fields
        target = SimpleNamespace(
            id=1, email="user@test.com", full_name="Old Name",
            role="dispatcher", is_active=True, hashed_password=_HASHED_PW,
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = target
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_active_user] = lambda: _ADMIN

        response = client.put(
            "/api/auth/users/1",
            json={"full_name": "New Name"},
        )

        assert response.status_code == 200
        assert response.json()["full_name"] == "New Name"

    def test_404_user_not_found(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_active_user] = lambda: _ADMIN

        response = client.put("/api/auth/users/999", json={"full_name": "Ghost"})

        assert response.status_code == 404


# ===========================================================================
# DELETE /api/auth/users/{user_id}  (admin only)
# ===========================================================================

class TestDeleteUser:

    def test_204_admin_deletes_other_user(self):
        target = SimpleNamespace(id=1, email="user@test.com", full_name="Test",
                                  role="dispatcher", is_active=True)
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = target
        app.dependency_overrides[get_db] = lambda: db
        # Admin has id=2 → deleting user with id=1 → not self
        app.dependency_overrides[get_current_active_user] = lambda: _ADMIN

        response = client.delete("/api/auth/users/1")

        assert response.status_code == 204

    def test_400_cannot_delete_self(self):
        app.dependency_overrides[get_db] = lambda: MagicMock()
        # current_user.id == 2, trying to delete id=2 → self
        app.dependency_overrides[get_current_active_user] = lambda: _ADMIN

        response = client.delete("/api/auth/users/2")

        assert response.status_code == 400
