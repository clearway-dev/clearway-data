# Load Testing — ClearWay Batch Ingestion Endpoint

This directory contains a [Locust](https://locust.io/) load test that targets the primary data-ingestion endpoint:

```
POST /api/measurements/raw-data/batch
```

The test proves that the **FastAPI layer remains non-blocking** under heavy load because it commits data to the database and immediately hands processing off to **Celery + Redis**, returning `HTTP 201` before any map-matching work begins.

---

## Prerequisites

### 1. Install Locust

```bash
pip install locust
```

### 2. Start the backend stack

The API, PostgreSQL, Redis, and at least one Celery worker must all be running:

```bash
# From the project root
docker compose up -d
```

### 3. Set credentials

The load test must authenticate as an **admin** user (vehicle and sensor creation require the admin role). Export these before running any scenario:

```bash
export LOAD_TEST_USER="your-admin@example.com"
export LOAD_TEST_PASS="your-password"
```

> **Windows (PowerShell):** `$env:LOAD_TEST_USER="..."` / `$env:LOAD_TEST_PASS="..."`

---

## How the test works

| Phase | What happens |
|---|---|
| **Module load** | `dataset_part1.json` is read from disk once into memory (1 296 real Plzeň GPS points). |
| **Test run start** | One shared `vehicle` and one `sensor` are created in the database (admin call, executed exactly once across all virtual users). |
| **`on_start` per user** | Each virtual user logs in and creates its own `session`, mirroring how the mobile app works in production. |
| **Each task** | The user picks a random consecutive slice of 100–500 GPS points from the in-memory dataset, re-anchors timestamps to the current wall-clock time (preserving original inter-measurement deltas), and POSTs the batch. |
| **Test run stop** | `dataset_part1.json` remains in memory until Locust exits. Shared DB resources (vehicle, sensor, sessions) are **not deleted** — see the [Cleanup](#cleanup) section. |

---

## Scenarios

Run all commands from the `backend/` directory.

locust -f tests/load/locustfile.py --host=http://localhost:8000

---

### Scenario 1 — Baseline Test

**Goal:** Establish a stable performance baseline under light, realistic traffic.  
**Expected outcome:** P95 response time < 200 ms, 0% error rate.

```bash
locust \
  -f tests/load/locustfile.py \
  --host http://localhost:8000 \
  --users 5 \
  --spawn-rate 1 \
  --run-time 5m \
  --headless \
  --html tests/load/results/baseline.html \
  --csv  tests/load/results/baseline
```

| Parameter | Value | Meaning |
|---|---|---|
| `--users` | `5` | 5 concurrent virtual mobile clients |
| `--spawn-rate` | `1` | 1 new user spawned per second (soft start) |
| `--run-time` | `5m` | Run for 5 minutes then stop automatically |
| `--headless` | — | No browser UI; results go to files |
| `--html` | path | Self-contained HTML report |
| `--csv` | prefix | Per-request CSV data for further analysis |

---

### Scenario 2 — Spike Test

**Goal:** Simulate a sudden burst of 100 simultaneous clients (e.g., a fleet of vehicles returning from a route and uploading at the same time). This is the primary scenario for demonstrating **Celery queue absorption** — the API must return `201` within milliseconds even while the Redis queue fills up.

**Expected outcome:** API response time stays low (< 500 ms P95) even as the Celery queue depth spikes. Error rate should remain 0%.

```bash
locust \
  -f tests/load/locustfile.py \
  --host http://localhost:8000 \
  --users 100 \
  --spawn-rate 20 \
  --run-time 3m \
  --headless \
  --html tests/load/results/spike.html \
  --csv  tests/load/results/spike
```

| Parameter | Value | Meaning |
|---|---|---|
| `--users` | `100` | Peak of 100 concurrent clients |
| `--spawn-rate` | `20` | 20 users per second → full load in 5 seconds (the spike) |
| `--run-time` | `3m` | Short window — focuses on the burst behaviour |

> **Thesis note:** Monitor the Celery queue depth in Flower (`http://localhost:5555`) or via the Prometheus/Grafana dashboard in parallel. The key metric is that queue depth grows (proving offloading) while API latency stays flat (proving non-blocking behaviour).

---

### Scenario 3 — Stress Test

**Goal:** Gradually ramp up load until the server degrades or fails, establishing the **absolute breaking point** of the current single-node setup.

**Expected outcome:** Identify the user count at which error rate rises above 1% or P95 latency exceeds 2 000 ms.

```bash
locust \
  -f tests/load/locustfile.py \
  --host http://localhost:8000 \
  --users 500 \
  --spawn-rate 10 \
  --run-time 60m \
  --headless \
  --html tests/load/results/stress.html \
  --csv  tests/load/results/stress
```

| Parameter | Value | Meaning |
|---|---|---|
| `--users` | `500` | Target ceiling — adjust upward if the server does not break |
| `--spawn-rate` | `10` | 10 new users per minute → gradual, controlled ramp |
| `--run-time` | `60m` | Long enough for 50 ramp steps to complete |

> Alternatively, use the **Locust Web UI** for this scenario so you can watch the charts in real time and stop the test manually the moment failure is observed:
>
> ```bash
> locust \
>   -f tests/load/locustfile.py \
>   --host http://localhost:8000
> ```
> Then open `http://localhost:8089`, set users to `500`, spawn rate to `10`, and start the test.

---

## Interpreting results

| Metric | What it tells you |
|---|---|
| **Requests/s** | Throughput of the API under load |
| **P50 / P95 / P99 response time** | Typical and worst-case latency for the batch endpoint |
| **Failure rate** | Percentage of requests that did not return `201` |
| **Celery queue depth** (Flower / Prometheus) | Confirms that tasks are being offloaded — should grow during spike without affecting API latency |

For the thesis, the key evidence is: **Failure rate = 0% and P95 < threshold during the Spike Test**, demonstrating that the architecture decouples data ingestion from data processing.

---

## Cleanup

There are no `DELETE` endpoints for sessions, vehicles, or sensors in the current API. After load testing, test data can be removed directly from the database:

```sql
-- Connect to the PostgreSQL container
-- docker exec -it clearway-postgres psql -U postgres -d clearway

DELETE FROM raw_measurements
  WHERE batch_id IN (
    SELECT b.id FROM batches b
    JOIN sessions s ON b.session_id = s.id
    JOIN vehicles v ON s.vehicle_id = v.id
    WHERE v.vehicle_name = 'locust-load-test'
  );

DELETE FROM batches
  WHERE session_id IN (
    SELECT s.id FROM sessions s
    JOIN vehicles v ON s.vehicle_id = v.id
    WHERE v.vehicle_name = 'locust-load-test'
  );

DELETE FROM sessions
  WHERE vehicle_id IN (
    SELECT id FROM vehicles WHERE vehicle_name = 'locust-load-test'
  );

DELETE FROM sensors  WHERE description = 'locust-load-test-sensor';
DELETE FROM vehicles WHERE vehicle_name = 'locust-load-test';
```

---

## Distributed mode (optional)

For higher load than a single machine can generate, Locust supports a master/worker model:

```bash
# Master node (coordinates workers, serves UI)
locust -f tests/load/locustfile.py --master --host http://localhost:8000

# Worker nodes (each on a separate machine or terminal)
locust -f tests/load/locustfile.py --worker --master-host <master-ip>
```

> In distributed mode, each **worker process** will independently create its own shared vehicle and sensor (the `_setup_done` event is process-local, not network-shared). This results in one vehicle/sensor pair per worker, which is acceptable for load testing purposes.
