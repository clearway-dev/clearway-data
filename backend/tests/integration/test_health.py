"""
Isolated API tests for health endpoints (routers/health.py).

No real database. /db-check uses a dependency_overrides mock that either
succeeds or raises an exception to cover both branches.
"""
import pytest
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db

client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# GET /
# ---------------------------------------------------------------------------

class TestRoot:

    def test_returns_200(self):
        assert client.get("/").status_code == 200

    def test_body_contains_status_operational(self):
        body = client.get("/").json()
        assert body["status"] == "operational"

    def test_body_contains_version(self):
        body = client.get("/").json()
        assert "version" in body


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

class TestHealthCheck:

    def test_returns_200(self):
        assert client.get("/health").status_code == 200

    def test_body_status_is_healthy(self):
        body = client.get("/health").json()
        assert body["status"] == "healthy"


# ---------------------------------------------------------------------------
# GET /db-check
# ---------------------------------------------------------------------------

class TestDbCheck:

    def test_db_ok_returns_success(self):
        db = MagicMock()
        app.dependency_overrides[get_db] = lambda: db

        body = client.get("/db-check").json()

        assert body["status"] == "success"
        db.execute.assert_called_once()

    def test_db_ok_mentions_postgresql(self):
        app.dependency_overrides[get_db] = lambda: MagicMock()

        body = client.get("/db-check").json()

        assert body["database"] == "PostgreSQL"

    def test_db_error_returns_error_status(self):
        db = MagicMock()
        db.execute.side_effect = Exception("connection refused")
        app.dependency_overrides[get_db] = lambda: db

        body = client.get("/db-check").json()

        assert body["status"] == "error"

    def test_db_error_includes_message(self):
        db = MagicMock()
        db.execute.side_effect = Exception("timeout")
        app.dependency_overrides[get_db] = lambda: db

        body = client.get("/db-check").json()

        assert "timeout" in body["message"]
