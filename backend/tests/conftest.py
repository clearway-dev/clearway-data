"""
Root-level pytest configuration.

Sets ALL required environment variables at module level — before any app.*
module is imported. pytest loads this file first, so the module cache is
warm with correct values by the time test modules are collected.
"""
import os

# ── Security ─────────────────────────────────────────────────────────────────
# Non-default value bypasses the production guard in app/core/config.py:
#   if SECRET_KEY == _DEFAULT_SECRET and not _DEBUG: raise RuntimeError(...)
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-only")
os.environ.setdefault("DEBUG", "true")

# ── Database ──────────────────────────────────────────────────────────────────
# Integration tests require a real PostgreSQL database.
# Set TEST_DATABASE_URL in your environment before running integration tests.
#
#   export TEST_DATABASE_URL=postgresql://clearway:clearway@localhost:5432/clearway_test
#
# The dummy fallback below keeps app.database's module-level engine creation
# from raising ValueError during *unit* tests, which never open a DB connection.
_test_db_url = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://clearway:clearway@localhost:5432/clearway_test",
)
os.environ.setdefault("DATABASE_URL", _test_db_url)
