"""
Unit tests for app/deps.py — FastAPI dependency functions.

Functions are called directly with mock arguments (no HTTP client needed).
DB and token decoding are mocked.
"""
import types
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from jose import JWTError

from app.core.security import create_access_token
from app.deps import get_current_active_user, get_current_user, require_admin
import app.deps as deps_module


@pytest.fixture(autouse=True)
def clear_user_cache():
    """Clear the in-memory user cache before every test for isolation."""
    deps_module._user_cache.clear()
    yield
    deps_module._user_cache.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _user(email="user@test.com", role="dispatcher", is_active=True):
    return types.SimpleNamespace(email=email, role=role, is_active=is_active)


def _db_returning(user):
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = user
    return db


def _valid_token(email="user@test.com", role="dispatcher") -> str:
    return create_access_token({"sub": email, "role": role})


# ===========================================================================
# get_current_user
# ===========================================================================

class TestGetCurrentUser:

    def test_valid_token_returns_user(self):
        user = _user()
        db = _db_returning(user)
        token = _valid_token(email=user.email, role=user.role)

        result = get_current_user(token=token, db=db)

        assert result is user

    def test_expired_or_invalid_jwt_raises_401(self):
        db = _db_returning(_user())
        with pytest.raises(HTTPException) as exc_info:
            get_current_user(token="not.a.valid.jwt", db=db)
        assert exc_info.value.status_code == 401

    def test_token_missing_sub_raises_401(self):
        """JWT with no 'sub' claim must raise 401."""
        token = create_access_token({"role": "dispatcher"})   # no 'sub'
        db = _db_returning(_user())
        with pytest.raises(HTTPException) as exc_info:
            get_current_user(token=token, db=db)
        assert exc_info.value.status_code == 401

    def test_user_not_in_db_raises_401(self):
        db = _db_returning(None)   # first() returns None
        token = _valid_token()
        with pytest.raises(HTTPException) as exc_info:
            get_current_user(token=token, db=db)
        assert exc_info.value.status_code == 401

    def test_401_has_www_authenticate_header(self):
        db = _db_returning(None)
        token = _valid_token()
        with pytest.raises(HTTPException) as exc_info:
            get_current_user(token=token, db=db)
        assert "WWW-Authenticate" in exc_info.value.headers

    def test_db_queried_with_correct_email(self):
        user = _user(email="alice@example.com")
        db = _db_returning(user)
        token = _valid_token(email="alice@example.com")

        get_current_user(token=token, db=db)

        db.query.assert_called_once()


# ===========================================================================
# get_current_active_user
# ===========================================================================

class TestGetCurrentActiveUser:

    def test_active_user_is_returned(self):
        user = _user(is_active=True)
        result = get_current_active_user(current_user=user)
        assert result is user

    def test_inactive_user_raises_400(self):
        user = _user(is_active=False)
        with pytest.raises(HTTPException) as exc_info:
            get_current_active_user(current_user=user)
        assert exc_info.value.status_code == 400

    def test_inactive_user_detail_message(self):
        user = _user(is_active=False)
        with pytest.raises(HTTPException) as exc_info:
            get_current_active_user(current_user=user)
        assert "Inactive" in exc_info.value.detail


# ===========================================================================
# require_admin
# ===========================================================================

class TestRequireAdmin:

    def test_admin_user_is_returned(self):
        user = _user(role="admin")
        result = require_admin(current_user=user)
        assert result is user

    def test_dispatcher_raises_403(self):
        user = _user(role="dispatcher")
        with pytest.raises(HTTPException) as exc_info:
            require_admin(current_user=user)
        assert exc_info.value.status_code == 403

    def test_unknown_role_raises_403(self):
        user = _user(role="viewer")
        with pytest.raises(HTTPException) as exc_info:
            require_admin(current_user=user)
        assert exc_info.value.status_code == 403

    def test_403_detail_mentions_admin(self):
        user = _user(role="dispatcher")
        with pytest.raises(HTTPException) as exc_info:
            require_admin(current_user=user)
        assert "Admin" in exc_info.value.detail
