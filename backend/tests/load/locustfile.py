"""
ClearWay Load Test — batch GPS ingestion endpoint.

Target:  POST /api/v1/measurements/raw-data/batch
Goal:    Demonstrate that the FastAPI layer returns HTTP 201 quickly regardless
         of batch size because heavy processing is offloaded to Celery + Redis.

Dataset: Real Plzeň GPS measurements loaded once at module start.
         Each task picks a random consecutive slice (200–300 points) so that
         every request contains valid coordinates that will survive map-matching.

Setup per test run (once, thread-safe):
  1. Login as admin  → JWT token
  2. Create vehicle  → vehicle_id  (shared across all virtual users)
  3. Create sensor   → sensor_id   (shared across all virtual users)

Setup per virtual user (on_start):
  4. Login as admin  → own JWT token
  5. Create session  → own session_id  (isolated, mirrors real mobile app)

Credentials are read from environment variables:
  LOAD_TEST_USER  (default: admin@clearway.test)
  LOAD_TEST_PASS  (default: changeme)
"""

import json
import os
import random
import threading
from datetime import datetime, timezone
from pathlib import Path

from locust import HttpUser, between, events, task

# ── Dataset — loaded once when Locust imports this module ─────────────────────
_DATASET_PATH = Path(__file__).parent / "../../../dataset_part1.json"
with _DATASET_PATH.open(encoding="utf-8") as _f:
    _MEASUREMENTS: list[dict] = json.load(_f)["measurements"]

_DATASET_LEN = len(_MEASUREMENTS)

# ── Shared infrastructure — one vehicle + sensor for the entire test run ───────
_shared: dict[str, str | None] = {"vehicle_id": None, "sensor_id": None}
_setup_lock = threading.Lock()
_setup_done = threading.Event()

# ── Credentials ────────────────────────────────────────────────────────────────
_ADMIN_USER = os.getenv("LOAD_TEST_USER", "admin@clearway.cz")
_ADMIN_PASS = os.getenv("LOAD_TEST_PASS", "admin123")


@events.test_stop.add_listener
def _reset_shared_state(environment, **kwargs):
    """Reset shared state so re-runs within the same Locust session work correctly."""
    _setup_done.clear()
    _shared["vehicle_id"] = None
    _shared["sensor_id"] = None


# ── Payload builder ────────────────────────────────────────────────────────────

def _build_batch(session_id: str, size: int) -> dict:
    """
    Slice `size` consecutive points from the real dataset starting at a random
    offset, then re-anchor all timestamps to the current wall-clock time while
    preserving the original inter-measurement deltas.

    Re-anchoring ensures the backend never sees "future" or stale timestamps,
    which matters if the Celery pipeline applies any time-based filtering.
    """
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
        # Format as ISO 8601 with millisecond precision and Z suffix
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
    Simulates a mobile app client:
      - Authenticates once on startup
      - Owns a single measurement session
      - Repeatedly sends batches of 200–300 GPS points
    """

    wait_time = between(50, 60)

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    def on_start(self) -> None:
        self._token: str | None = None
        self._session_id: str | None = None

        if not self._login():
            # Abort this user — misconfigured credentials or server is down
            self.environment.runner.quit()
            return

        self._ensure_shared_resources()
        self._create_session()

    def on_stop(self) -> None:
        # There are no DELETE endpoints for sessions, vehicles, or sensors.
        # Test data accumulates in the database; see README.md for cleanup instructions.
        pass

    # ── Auth ───────────────────────────────────────────────────────────────────

    def _auth_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}"}

    def _login(self) -> bool:
        with self.client.post(
            "/api/v1/auth/login/access-token",
            data={"username": _ADMIN_USER, "password": _ADMIN_PASS},
            catch_response=True,
            name="[setup] POST /api/v1/auth/login/access-token",
        ) as resp:
            if resp.status_code == 200:
                self._token = resp.json()["access_token"]
                resp.success()
                return True
            resp.failure(f"Login failed — HTTP {resp.status_code}: {resp.text[:300]}")
            return False

    # ── One-time shared resource creation ─────────────────────────────────────

    def _ensure_shared_resources(self) -> None:
        """
        The first virtual user to reach this point creates the shared vehicle
        and sensor; all subsequent users skip creation and use the stored IDs.
        The threading.Lock + threading.Event pattern guarantees exactly-once
        execution even when Locust spawns many greenlets concurrently.
        """
        if _setup_done.is_set():
            return

        with _setup_lock:
            if _setup_done.is_set():
                return

            r = self.client.post(
                "/api/v1/vehicles",
                json={"vehicle_name": "locust-load-test", "width": 180.0},
                headers=self._auth_headers(),
                name="[setup] POST /api/v1/vehicles",
            )
            r.raise_for_status()
            _shared["vehicle_id"] = r.json()["id"]

            r = self.client.post(
                "/api/v1/sensors",
                json={"description": "locust-load-test-sensor", "is_active": True},
                headers=self._auth_headers(),
                name="[setup] POST /api/v1/sensors",
            )
            r.raise_for_status()
            _shared["sensor_id"] = r.json()["id"]

            _setup_done.set()

    # ── Per-user session ───────────────────────────────────────────────────────

    def _create_session(self) -> None:
        r = self.client.post(
            "/api/v1/sessions",
            json={
                "vehicle_id": _shared["vehicle_id"],
                "sensor_id": _shared["sensor_id"],
            },
            headers=self._auth_headers(),
            name="[setup] POST /api/v1/sessions",
        )
        r.raise_for_status()
        self._session_id = r.json()["id"]

    # ── Main task ──────────────────────────────────────────────────────────────

    @task
    def send_batch(self) -> None:
        """
        Send a batch of 500–600 real Plzeň GPS measurements.
        The API should respond with HTTP 201 almost immediately;
        the Celery worker picks up the heavy map-matching asynchronously.
        """
        if not self._session_id:
            return

        batch_size = random.randint(500, 600)
        payload = _build_batch(self._session_id, batch_size)

        with self.client.post(
            "/api/v1/measurements/raw-data/batch",
            json=payload,
            headers=self._auth_headers(),
            catch_response=True,
            name="POST /api/v1/measurements/raw-data/batch",
        ) as resp:
            if resp.status_code == 201:
                resp.success()
            else:
                resp.failure(
                    f"Expected 201, got HTTP {resp.status_code}: {resp.text[:300]}"
                )
