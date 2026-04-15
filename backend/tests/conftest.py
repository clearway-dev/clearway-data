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
os.environ.setdefault("TESTING", "true")
