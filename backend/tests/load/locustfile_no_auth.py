"""
ClearWay Load Test — batch GPS ingestion, shared-token variant.

Target:  POST /api/measurements/raw-data/batch
Goal:    Same as locustfile.py but login happens exactly ONCE for the entire
         test run.  All 500 virtual users reuse the same JWT token, so the
         server performs bcrypt only once instead of 500 times.

Setup per test run (once, thread-safe):
  1. Login → shared JWT token
  2. Create vehicle  → vehicle_id  (shared across all virtual users)
  3. Create sensor   → sensor_id   (shared across all virtual users)

Setup per virtual user (on_start):
  4. Reuse shared token  (no HTTP call)
  5. Create session  → own session_id  (isolated, mirrors real mobile app)

Environment variables:
  LOAD_TEST_USER    admin email    (default: admin@clearway.cz)
  LOAD_TEST_PASS    admin password (default: admin123)
"""

import json
import os
import random
import threading
from datetime import datetime, timezone
from pathlib import Path

from locust import HttpUser, between, events, task

# ── Credentials ────────────────────────────────────────────────────────────────
_ADMIN_USER = os.getenv("LOAD_TEST_USER", "admin@clearway.cz")
_ADMIN_PASS = os.getenv("LOAD_TEST_PASS", "admin123")

# ── Dataset — loaded once when Locust imports this module ─────────────────────
_DATASET_PATH = Path(__file__).parent / "../../../dataset_part1.json"
with _DATASET_PATH.open(encoding="utf-8") as _f:
    _MEASUREMENTS: list[dict] = json.load(_f)["measurements"]

_DATASET_LEN = len(_MEASUREMENTS)

# ── Shared state — one login + one vehicle + one sensor for the whole run ──────
_shared: dict[str, str | None] = {
    "token": None,
    "vehicle_id": None,
    "sensor_id": None,
}
_setup_lock = threading.Lock()
_setup_done = threading.Event()


@events.test_stop.add_listener
def _reset_shared_state(environment, **kwargs):
    _setup_done.clear()
    _shared["token"] = None
    _shared["vehicle_id"] = None
    _shared["sensor_id"] = None


# ── Payload builder ────────────────────────────────────────────────────────────

def _build_batch(session_id: str, size: int) -> dict:
    size = min(size, _DATASET_LEN)
    start = random.randint(0, _DATASET_LEN - size)
    chunk = _MEASUREMENTS[start : start + size]

    ref_ts = datetime.fromisoformat(chunk[0]["measured_at"].replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    time_shift = now - ref_ts

    measurements = []
    for point in chunk:
        original_ts = datetime.fromisoformat(point["measured_at"].replace("Z", "+00:00"))
        shifted_ts = original_ts + time_shift
        new_ts = shifted_ts.strftime("%Y-%m-%dT%H:%M:%S.") + f"{shifted_ts.microsecond // 1000:03d}Z"
        measurements.append(
            {
                "measured_at": new_ts,
                "latitude": point["latitude"],
                "longitude": point["longitude"],
                "distance_left": point["distance_left"],
                "distance_right": point["distance_right"],
                "speed": point["speed"],
                "accuracy_gps": point["accuracy_gps"],
            }
        )

    return {"session_id": session_id, "measurements": measurements}


# ── Virtual user ───────────────────────────────────────────────────────────────

class MeasurementUser(HttpUser):
    """
    Simulates a mobile app client.  Login happens once for the whole test run —
    all users share the same JWT so the server runs bcrypt exactly once.
    """

    wait_time = between(20, 30)

    def on_start(self) -> None:
        self._session_id: str | None = None
        self._ensure_shared_resources()
        self._create_session()

    def on_stop(self) -> None:
        pass

    def _auth_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {_shared['token']}"}

    # ── One-time setup: login + vehicle + sensor ───────────────────────────────

    def _ensure_shared_resources(self) -> None:
        if _setup_done.is_set():
            return

        with _setup_lock:
            if _setup_done.is_set():
                return

            # Single login for the entire test run
            r = self.client.post(
                "/api/auth/login/access-token",
                data={"username": _ADMIN_USER, "password": _ADMIN_PASS},
                name="[setup] POST /api/auth/login/access-token",
            )
            r.raise_for_status()
            _shared["token"] = r.json()["access_token"]

            r = self.client.post(
                "/api/vehicles",
                json={"vehicle_name": "locust-load-test", "width": 180.0},
                headers=self._auth_headers(),
                name="[setup] POST /api/vehicles",
            )
            r.raise_for_status()
            _shared["vehicle_id"] = r.json()["id"]

            r = self.client.post(
                "/api/sensors",
                json={"description": "locust-load-test-sensor", "is_active": True},
                headers=self._auth_headers(),
                name="[setup] POST /api/sensors",
            )
            r.raise_for_status()
            _shared["sensor_id"] = r.json()["id"]

            _setup_done.set()

    # ── Per-user session ───────────────────────────────────────────────────────

    def _create_session(self) -> None:
        r = self.client.post(
            "/api/sessions",
            json={
                "vehicle_id": _shared["vehicle_id"],
                "sensor_id": _shared["sensor_id"],
            },
            headers=self._auth_headers(),
            name="[setup] POST /api/sessions",
        )
        r.raise_for_status()
        self._session_id = r.json()["id"]

    # ── Main task ──────────────────────────────────────────────────────────────

    @task
    def send_batch(self) -> None:
        if not self._session_id:
            return

        batch_size = random.randint(200, 300)
        payload = _build_batch(self._session_id, batch_size)

        with self.client.post(
            "/api/measurements/raw-data/batch",
            json=payload,
            headers=self._auth_headers(),
            catch_response=True,
            name="POST /api/measurements/raw-data/batch",
        ) as resp:
            if resp.status_code == 201:
                resp.success()
            else:
                resp.failure(
                    f"Expected 201, got HTTP {resp.status_code}: {resp.text[:300]}"
                )
