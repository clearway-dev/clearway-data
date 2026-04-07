"""
Prometheus metriky pro monitoring aplikace ClearWay.

Tento modul definuje všechny custom Prometheus metriky, které jsou sdíleny
mezi FastAPI aplikací (main.py) a Celery workerem (worker.py).
"""

from prometheus_client import Counter, Histogram, Gauge

# ===========================================================================================
# CUSTOM BUSINESS METRIKY - Požadované v diplomové práci
# ===========================================================================================

# Metrika 1: Počet přijatých dávek (batches) podle statusu
batches_received_total = Counter(
    "clearway_batches_received_total",
    "Celkový počet přijatých měřicích dávek (batches)",
    ["status"]  # Labels: pending, completed, failed
)

# Metrika 2: Počet invalidních měřicích bodů podle důvodu zahození
invalid_measurements_total = Counter(
    "clearway_invalid_measurements_total",
    "Celkový počet zahozených invalidních měřicích bodů",
    ["reason"]  # Labels: logical_validation, gps_jump_duplicate_timestamp, 
               #         gps_jump_unrealistic_speed, map_matching_failed
)

# ===========================================================================================
# DOPLŇKOVÉ METRIKY - Poskytují další kontext pro analýzu
# ===========================================================================================

# Velikost přijatých dávek (kolik měřicích bodů v každé dávce)
batch_size_measurements = Histogram(
    "clearway_batch_size_measurements",
    "Distribuce velikosti přijatých dávek (počet měřicích bodů)",
    buckets=[10, 50, 100, 200, 500, 1000, 2000, 5000]  # Typické velikosti dávek
)

# Počet aktivních měřicích session (sessions) v současné chvíli
active_sessions = Gauge(
    "clearway_active_sessions",
    "Počet aktuálně aktivních měřicích session v systému"
)
