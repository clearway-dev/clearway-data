"""
Prometheus metrics shared between the FastAPI app (main.py) and the Celery worker (worker.py).
"""

from prometheus_client import Counter, Histogram, Gauge

batches_received_total = Counter(
    "clearway_batches_received_total",
    "Total number of measurement batches received",
    ["status"]  # Labels: pending, completed, failed
)

invalid_measurements_total = Counter(
    "clearway_invalid_measurements_total",
    "Total number of discarded invalid measurement points",
    ["reason"]  # Labels: logical_validation, gps_jump_duplicate_timestamp,
               #         gps_jump_unrealistic_speed, map_matching_failed
)

batch_size_measurements = Histogram(
    "clearway_batch_size_measurements",
    "Distribution of received batch sizes (number of measurement points)",
    buckets=[10, 50, 100, 200, 500, 1000, 2000, 5000]
)

active_sessions = Gauge(
    "clearway_active_sessions",
    "Number of currently active measurement sessions in the system"
)

# Pre-initialise label series so /metrics always shows these counters, even before
# the first batch is processed. Without this, Grafana shows "No data" instead of 0.
for _status in ("pending", "completed", "failed"):
    batches_received_total.labels(status=_status)

for _reason in ("logical_validation", "gps_jump_duplicate_timestamp",
                "gps_jump_unrealistic_speed", "map_matching_failed"):
    invalid_measurements_total.labels(reason=_reason)
