"""
Celery worker – full two-phase processing pipeline for raw measurements.

Phase 1 – Logical validation:
    Filters out physically impossible values (GPS bounds, negative distances).
    Invalid records → is_valid = False + row in invalid_measurements.

Phase 2 – Map-matching + cleaning:
    Snaps each valid GPS point to the nearest road segment (PostGIS ST_ClosestPoint).
    cleaned_width = distance_left + distance_right + vehicle.width
    Result → row in cleaned_measurements with matched geometry.
"""
import math
import os

from celery import Celery
from celery.signals import worker_process_init
from geoalchemy2.shape import from_shape
from loguru import logger
from prometheus_client import start_http_server
from scipy.signal import medfilt
from shapely.geometry import Point
from sqlalchemy import text
from sqlalchemy.orm import Session

from . import models
from .database import SessionLocal

# ==============================================
# PROMETHEUS CUSTOM METRICS (shared with main.py)
# ==============================================

# Import metrics from dedicated metrics module (avoids circular imports)
from .metrics import invalid_measurements_total, batches_received_total


class BatchNotFoundError(Exception):
    """Custom exception raised when batch is not found in database.
    
    This exception is used to trigger automatic retries in Celery tasks,
    handling race conditions between database commit and task execution.
    """
    pass

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://clearway-redis:6379/0")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://clearway-redis:6379/0")
WORKER_METRICS_PORT = int(os.getenv("WORKER_METRICS_PORT", "8001"))

_worker_metrics_server_started = False

# Maximum distance in metres for snapping a GPS point to a road segment.
MAP_MATCH_MAX_DISTANCE_M = 50.0
MAX_GPS_ACCURACY = 25.0  # Maximum GPS accuracy to consider a point valid for map-matching
MAX_REALISTIC_SPEED_MPS = 40.0
MIN_VALID_SPEED_MPS = 0.1  # below 0.1 m/s treated as sensor noise / GPS glitch
# Median window for width denoising. Must be an odd number.
WIDTH_MEDIAN_WINDOW = 5

celery_app = Celery(
    "clearway",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    # Serializace
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,

    # Spolehlivost — globální výchozí hodnoty (přepisují se dekorátorem na tasku)
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_track_started=True,

    # Prefetch: worker si bere jen 1 task najednou — klíčové pro dlouhé batch úlohy
    worker_prefetch_multiplier=1,

    # Time limity: soft → graceful SIGTERM, hard → SIGKILL
    task_soft_time_limit=270,
    task_time_limit=300,

    # Výsledky: ukládáme (potřebujeme status), ale po 1h z Redis zmizí
    task_ignore_result=False,
    result_expires=3600,

    # Redis broker: visibility_timeout musí být >= task_time_limit
    # Pokud worker nestihne task za 600s, Redis ho vrátí do fronty (re-queue)
    broker_transport_options={
        "visibility_timeout": 600,
        "retry_policy": {"timeout": 5.0},
    },
)


@worker_process_init.connect
def setup_worker_logger(**kwargs):
    global _worker_metrics_server_started

    os.makedirs("/app/logs", exist_ok=True)
    logger.remove()
    logger.add(
        "/app/logs/worker.log",
        rotation="10 MB",
        retention="7 days",
        level="INFO",
    )

    # Expose Prometheus metrics via HTTP.
    # With PROMETHEUS_MULTIPROC_DIR set, each forked child writes its counters to
    # shared files; the one child that wins the port serves aggregated metrics
    # from ALL children via MultiProcessCollector.
    if not _worker_metrics_server_started:
        try:
            multiproc_dir = os.getenv("PROMETHEUS_MULTIPROC_DIR")
            if multiproc_dir:
                from prometheus_client import CollectorRegistry
                from prometheus_client.multiprocess import MultiProcessCollector

                os.makedirs(multiproc_dir, exist_ok=True)
                registry = CollectorRegistry()
                MultiProcessCollector(registry)
                start_http_server(WORKER_METRICS_PORT, registry=registry)
            else:
                start_http_server(WORKER_METRICS_PORT)

            _worker_metrics_server_started = True
            logger.info(
                f"Celery worker metrics endpoint started on :{WORKER_METRICS_PORT}/metrics"
            )
        except OSError as exc:
            logger.warning(
                f"Celery worker metrics endpoint could not start on :{WORKER_METRICS_PORT}: {exc}"
            )


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _validate_measurement_logic(measurement: models.RawMeasurement) -> list[str]:
    """Return a list of human-readable error strings; empty list means valid."""
    errors: list[str] = []

    if measurement.distance_left < 0:
        errors.append(f"distance_left must be >= 0 (got {measurement.distance_left})")

    if measurement.distance_right < 0:
        errors.append(f"distance_right must be >= 0 (got {measurement.distance_right})")

    if measurement.distance_left == 0.0 and measurement.distance_right == 0.0:
        errors.append("Both distance_left and distance_right are zero")

    if not (-90.0 <= measurement.latitude <= 90.0):
        errors.append(f"latitude out of range [-90, 90] (got {measurement.latitude})")

    if not (-180.0 <= measurement.longitude <= 180.0):
        errors.append(f"longitude out of range [-180, 180] (got {measurement.longitude})")

    if not (49.68 <= measurement.latitude <= 49.81):
        errors.append(f"latitude out of range [49.68, 49.81] Pilsner (got {measurement.latitude})")

    if not (13.30 <= measurement.longitude <= 13.47):
        errors.append(f"longitude out of range [13.30, 13.47] Pilsner(got {measurement.longitude})")    

    if measurement.speed is not None and measurement.speed < MIN_VALID_SPEED_MPS:
        errors.append(f"speed must be >= {MIN_VALID_SPEED_MPS} m/s (got {measurement.speed})")

    if measurement.accuracy_gps is not None and measurement.accuracy_gps < 0:
        errors.append(f"accuracy_gps must be >= 0 (got {measurement.accuracy_gps})")

    if measurement.accuracy_gps is not None and measurement.accuracy_gps > MAX_GPS_ACCURACY:
        errors.append(
            f"accuracy_gps must be <= {MAX_GPS_ACCURACY} m (got {measurement.accuracy_gps})"
        )

    return errors


def _map_match(
    db: Session,
    lat: float,
    lon: float,
    vehicle_heading: float | None = None,
    max_distance_m: float = MAP_MATCH_MAX_DISTANCE_M,
) -> tuple[float, float] | None:
    """
    Project a GPS point onto the nearest road segment using PostGIS with heading-aware selection.

    Searches road_segments within *max_distance_m* metres (geography cast for
    accurate metric distances), returns the top 3 closest candidates, and selects
    the best match based on heading alignment when vehicle_heading is provided.

    Args:
        db: Database session
        lat: GPS latitude
        lon: GPS longitude
        vehicle_heading: Optional vehicle heading in degrees (0-360)
        max_distance_m: Maximum distance to search for road segments

    Returns (snapped_lat, snapped_lon) or None when no match is found.
    """
    rows = db.execute(
        text(
            """
            SELECT
                ST_Y(ST_ClosestPoint(rs.geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))) AS snapped_lat,
                ST_X(ST_ClosestPoint(rs.geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))) AS snapped_lon,
                degrees(ST_Azimuth(ST_StartPoint(rs.geom), ST_EndPoint(rs.geom))) AS road_heading,
                ST_Distance(rs.geom::geography, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography) AS distance
            FROM road_segments rs
            -- Nejprve pomocí rychlého indexu ořízneme hledání na malý čtvereček (cca odpovídá tvému max_dist)
            WHERE rs.geom && ST_Expand(ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :max_dist / 111320.0) 
            -- Následně seřadíme podle skutečné geometrické vzdálenosti pomocí bleskového operátoru <->
            ORDER BY rs.geom <-> ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)
            LIMIT 3;
            """
        ),
        {"lat": lat, "lon": lon, "max_dist": max_distance_m},
    ).fetchall()

    if not rows:
        return None

    # If no vehicle heading provided, return the closest segment (index 0)
    if vehicle_heading is None:
        logger.debug(
            f"map_match selection_method=fallback_no_heading lat={lat:.6f} lon={lon:.6f} "
            f"snapped_lat={rows[0].snapped_lat:.6f} snapped_lon={rows[0].snapped_lon:.6f}"
        )
        return float(rows[0].snapped_lat), float(rows[0].snapped_lon)

    # Helper: Calculate angular difference with 360-degree wrap-around
    def angular_diff(angle1: float, angle2: float) -> float:
        """Calculate the minimum angular difference between two angles (0-180 degrees)."""
        diff = abs(angle1 - angle2) % 360
        return min(diff, 360 - diff)

    # Iterate through candidates and select the first one that passes heading check
    for idx, row in enumerate(rows):
        road_heading = float(row.road_heading) if row.road_heading is not None else None
        
        if road_heading is None:
            # Skip segments without valid heading (e.g., zero-length segments)
            continue
        
        diff = angular_diff(vehicle_heading, road_heading)
        
        # Bidirectional check: same direction (<=45°) or opposite direction (>=135°)
        is_valid = diff <= 45.0 or diff >= 135.0
        
        if is_valid:
            logger.debug(
                f"map_match selection_method=heading_validated candidate={idx+1}/3 "
                f"vehicle_heading={vehicle_heading:.1f}° road_heading={road_heading:.1f}° "
                f"angular_diff={diff:.1f}° lat={lat:.6f} lon={lon:.6f} "
                f"snapped_lat={row.snapped_lat:.6f} snapped_lon={row.snapped_lon:.6f}"
            )
            return float(row.snapped_lat), float(row.snapped_lon)

    # Fallback: None of the 3 candidates passed heading check, return the closest
    logger.debug(
        f"map_match selection_method=fallback_no_valid_heading vehicle_heading={vehicle_heading:.1f}° "
        f"lat={lat:.6f} lon={lon:.6f} snapped_lat={rows[0].snapped_lat:.6f} snapped_lon={rows[0].snapped_lon:.6f}"
    )
    return float(rows[0].snapped_lat), float(rows[0].snapped_lon)


def _haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return great-circle distance between 2 GPS points in meters."""
    earth_radius_m = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return earth_radius_m * c


def _calculate_heading(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the bearing/heading from point 1 to point 2 in degrees (0-360).
    
    Uses the forward azimuth formula. 0° = North, 90° = East, 180° = South, 270° = West.
    
    Args:
        lat1, lon1: Coordinates of the starting point
        lat2, lon2: Coordinates of the ending point
        
    Returns:
        Heading in degrees (0-360)
    """
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lon = math.radians(lon2 - lon1)
    
    x = math.sin(delta_lon) * math.cos(lat2_rad)
    y = math.cos(lat1_rad) * math.sin(lat2_rad) - math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(delta_lon)
    
    heading_rad = math.atan2(x, y)
    heading_deg = math.degrees(heading_rad)
    
    # Normalize to 0-360 range
    return (heading_deg + 360) % 360


def _apply_width_median_filter(widths: list[float], window: int = WIDTH_MEDIAN_WINDOW) -> list[float]:
    """Apply 1D median filter on width series only (no GPS smoothing)."""
    if not widths:
        return []

    kernel_size = max(1, window)
    if kernel_size % 2 == 0:
        kernel_size += 1

    # medfilt requires odd kernel and behaves best when kernel <= series length.
    if kernel_size > len(widths):
        kernel_size = len(widths) if len(widths) % 2 == 1 else max(1, len(widths) - 1)

    filtered = medfilt(widths, kernel_size=kernel_size)
    return [float(value) for value in filtered]


# --------------------------------------------------------------------------- #
# Task helpers – each covers one well-defined responsibility
# --------------------------------------------------------------------------- #

def _check_batch_idempotence(
    db: Session, batch_uuid, batch_id: str, retries: int, max_retries: int
) -> dict | None:
    """Return a completed-response dict if batch is already done, None if processing should proceed.

    Raises BatchNotFoundError when the batch row is missing (triggers Celery retry).
    """
    batch = db.query(models.Batch).filter(models.Batch.id == batch_uuid).first()
    if not batch:
        logger.warning(
            f"Batch {batch_id} not found in database - will retry "
            f"(attempt {retries + 1}/{max_retries})"
        )
        raise BatchNotFoundError(
            f"Batch {batch_id} not found in database. "
            f"This may be a race condition - task will retry."
        )
    if batch.status == "completed":
        logger.info(
            f"Batch {batch_id} already completed (idempotence check) - skipping duplicate processing"
        )
        return {"batch_id": batch_id, "status": "completed", "message": "Batch already completed (idempotent retry)"}
    return None


def _load_measurements(db: Session, batch_uuid) -> list[models.RawMeasurement]:
    """Load all measurements for the batch with session + vehicle eagerly joined."""
    return (
        db.query(models.RawMeasurement)
        .join(models.RawMeasurement.batch)
        .join(models.Batch.session)
        .join(models.Session.vehicle)
        .filter(models.RawMeasurement.batch_id == batch_uuid)
        .order_by(models.RawMeasurement.measured_at.asc(), models.RawMeasurement.id.asc())
        .all()
    )


def _preload_existing_invalid_ids(db: Session, measurements: list[models.RawMeasurement]) -> set[int]:
    """Return IDs already present in invalid_measurements to avoid duplicate inserts on retry."""
    measurement_ids = [m.id for m in measurements]
    return {
        row.raw_measurement_id
        for row in db.query(models.InvalidMeasurement.raw_measurement_id)
        .filter(models.InvalidMeasurement.raw_measurement_id.in_(measurement_ids))
        .all()
    }


def _reject_measurement(
    m: models.RawMeasurement,
    reason: str,
    prometheus_label: str,
    existing_invalid_ids: set[int],
    invalid_records: list[models.InvalidMeasurement],
) -> None:
    """Mark a measurement invalid and append an InvalidMeasurement record (deduplication guard)."""
    m.is_valid = False
    if m.id not in existing_invalid_ids:
        invalid_records.append(
            models.InvalidMeasurement(raw_measurement_id=m.id, rejection_reason=reason)
        )
        existing_invalid_ids.add(m.id)
        invalid_measurements_total.labels(reason=prometheus_label).inc()


def _check_gps_jump(
    m: models.RawMeasurement,
    last_valid: models.RawMeasurement,
) -> tuple[str, str] | None:
    """Detect a GPS jump between *m* and the last accepted point.

    Returns (rejection_reason, prometheus_label) when a jump is detected, None otherwise.
    A time_diff==0 and distance==0 (exact duplicate) is silently accepted as None.
    """
    time_diff_s = (m.measured_at - last_valid.measured_at).total_seconds()
    distance_m = _haversine_distance_m(
        last_valid.latitude, last_valid.longitude, m.latitude, m.longitude
    )

    if time_diff_s == 0:
        if distance_m > 0:
            reason = "GPS jump detected: Duplicate timestamp with different location"
            logger.warning(
                "measurement_evaluation id={} status=invalid stage=gps_jump_check reason='{}' "
                "distance_m={:.2f} time_diff_s={:.2f} speed_mps=undefined",
                m.id, reason, distance_m, time_diff_s,
            )
            return reason, "gps_jump_duplicate_timestamp"
        return None  # exact duplicate (time=0, dist=0) – accepted silently

    if (distance_m / time_diff_s) > MAX_REALISTIC_SPEED_MPS:
        reason = "GPS jump detected: Unrealistic speed"
        logger.warning(
            "measurement_evaluation id={} status=invalid stage=gps_jump_check reason='{}' "
            "distance_m={:.2f} time_diff_s={:.2f} speed_mps={:.2f}",
            m.id, reason, distance_m, time_diff_s, distance_m / time_diff_s,
        )
        return reason, "gps_jump_unrealistic_speed"

    return None


def _run_phase1_validation(
    measurements: list[models.RawMeasurement],
    existing_invalid_ids: set[int],
) -> tuple[list[models.RawMeasurement], list[models.InvalidMeasurement], int]:
    """Phase 1 – logical validation and GPS-jump detection.

    Returns (valid_measurements, invalid_records, invalid_count).
    Mutates *existing_invalid_ids* in-place so Phase 2 sees the updated set.
    """
    valid_measurements: list[models.RawMeasurement] = []
    invalid_records: list[models.InvalidMeasurement] = []
    invalid_count = 0
    last_valid_point: models.RawMeasurement | None = None

    for m in measurements:
        errors = _validate_measurement_logic(m)
        if errors:
            invalid_count += 1
            reason = "; ".join(errors)
            _reject_measurement(m, reason, "logical_validation", existing_invalid_ids, invalid_records)
            logger.debug(f"Measurement {m.id} rejected at logical validation: {reason}")
            continue

        if last_valid_point is not None:
            jump = _check_gps_jump(m, last_valid_point)
            if jump is not None:
                invalid_count += 1
                _reject_measurement(m, jump[0], jump[1], existing_invalid_ids, invalid_records)
                continue  # do NOT advance last_valid_point on a rejected jump

        valid_measurements.append(m)
        last_valid_point = m
        logger.debug(f"Measurement {m.id} passed logical validation")

    return valid_measurements, invalid_records, invalid_count


def _compute_vehicle_heading(
    prev: models.RawMeasurement | None,
    current: models.RawMeasurement,
) -> float | None:
    """Return the bearing from *prev* to *current*, or None when undefined."""
    if prev is None:
        return None
    if prev.latitude == current.latitude and prev.longitude == current.longitude:
        return None
    return _calculate_heading(prev.latitude, prev.longitude, current.latitude, current.longitude)


def _run_phase2_map_matching(
    db: Session,
    valid_measurements: list[models.RawMeasurement],
    existing_invalid_ids: set[int],
) -> tuple[list[dict], list[models.InvalidMeasurement], int, int]:
    """Phase 2 – snap each valid point to the nearest road segment.

    Returns (matched_points, invalid_records, unmatched_count, invalid_count).
    Mutates *existing_invalid_ids* in-place (same set passed from Phase 1).
    """
    invalid_records: list[models.InvalidMeasurement] = []
    matched_points: list[dict] = []
    unmatched_count = 0
    invalid_count = 0
    prev_measurement: models.RawMeasurement | None = None

    for m in valid_measurements:
        vehicle_width: float = m.batch.session.vehicle.width
        vehicle_heading = _compute_vehicle_heading(prev_measurement, m)

        snapped = _map_match(db, m.latitude, m.longitude, vehicle_heading)
        if snapped is None:
            unmatched_count += 1
            invalid_count += 1
            reason = f"Map matching failed: no road segment within {MAP_MATCH_MAX_DISTANCE_M:.0f} m"
            _reject_measurement(m, reason, "map_matching_failed", existing_invalid_ids, invalid_records)
            logger.debug(
                f"Measurement {m.id} rejected at map matching: no road segment within {MAP_MATCH_MAX_DISTANCE_M:.0f}m"
            )
            continue

        snapped_lat, snapped_lon = snapped
        matched_points.append({
            "measurement": m,
            "snapped_lat": snapped_lat,
            "snapped_lon": snapped_lon,
            "raw_width": m.distance_left + m.distance_right + vehicle_width,
        })
        prev_measurement = m

    return matched_points, invalid_records, unmatched_count, invalid_count


def _build_cleaned_records(matched_points: list[dict]) -> list[models.CleanedMeasurement]:
    """Apply median filter to widths and produce CleanedMeasurement rows."""
    matched_points.sort(key=lambda item: (item["measurement"].measured_at, item["measurement"].id))
    filtered_widths = _apply_width_median_filter([item["raw_width"] for item in matched_points])

    records: list[models.CleanedMeasurement] = []
    for item, filtered_width in zip(matched_points, filtered_widths):
        m = item["measurement"]
        records.append(
            models.CleanedMeasurement(
                raw_measurement_id=m.id,
                cleaned_width=filtered_width,
                quality_score=None,
                cluster_id=None,
                geom=from_shape(Point(item["snapped_lon"], item["snapped_lat"]), srid=4326),
            )
        )
        logger.debug(
            f"Measurement {m.id} map-matched. Width cleaned: {item['raw_width']:.3f} -> {filtered_width:.3f}"
        )
    return records


def _mark_batch_failed(batch_uuid, batch_id: str) -> None:
    """Open a fresh DB session and persist batch status = 'failed' (separate transaction)."""
    db_fail = SessionLocal()
    try:
        failed_batch = db_fail.query(models.Batch).filter(models.Batch.id == batch_uuid).first()
        if failed_batch:
            failed_batch.status = "failed"
            db_fail.commit()
            batches_received_total.labels(status="failed").inc()
            logger.info(f"Batch {batch_id} marked as 'failed' in database (separate transaction)")
        else:
            logger.warning(f"Could not find batch {batch_id} to mark as failed")
    except Exception as commit_error:
        logger.error(f"Failed to update batch {batch_id} status to 'failed': {str(commit_error)}")
        db_fail.rollback()
    finally:
        db_fail.close()


# --------------------------------------------------------------------------- #
# Celery task – thin orchestrator, delegates work to helpers above
# --------------------------------------------------------------------------- #

@celery_app.task(
    name="process_batch_task",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(BatchNotFoundError,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    max_retries=5,
    default_retry_delay=10,
)
def process_batch_task(self, batch_id: str) -> dict:
    """Full async processing pipeline: pending → processing → completed/failed.

    Phase 0 – idempotence check (read-only, separate session).
    Phase 1 – logical validation + GPS-jump detection.
    Phase 2 – map-matching + median-filter cleaning.
    Single ACID commit covers all writes.
    """
    import uuid

    batch_uuid = uuid.UUID(batch_id)

    # ---------------------------------------------------------------------- #
    # Phase 0: idempotence check (separate read-only transaction)
    # ---------------------------------------------------------------------- #
    db = SessionLocal()
    try:
        early_return = _check_batch_idempotence(
            db, batch_uuid, batch_id, self.request.retries, self.max_retries
        )
        if early_return is not None:
            return early_return
    except BatchNotFoundError:
        raise
    except Exception as e:
        logger.error(f"Error during idempotence check for batch {batch_id}: {str(e)}")
        raise
    finally:
        db.close()

    # ---------------------------------------------------------------------- #
    # Main transaction: all-or-nothing ACID processing
    # ---------------------------------------------------------------------- #
    db = SessionLocal()
    try:
        batch = db.query(models.Batch).filter(models.Batch.id == batch_uuid).first()
        if not batch:
            raise BatchNotFoundError(f"Batch {batch_id} disappeared between checks")
        batch.status = "processing"

        measurements = _load_measurements(db, batch_uuid)
        logger.info(f"Worker started processing batch {batch_id} ({len(measurements)} measurements)")

        existing_invalid_ids = _preload_existing_invalid_ids(db, measurements)

        valid_measurements, phase1_invalid, invalid_count = _run_phase1_validation(
            measurements, existing_invalid_ids
        )
        matched_points, phase2_invalid, unmatched_count, phase2_invalid_count = _run_phase2_map_matching(
            db, valid_measurements, existing_invalid_ids
        )
        invalid_count += phase2_invalid_count

        cleaned_records = _build_cleaned_records(matched_points)

        all_invalid = phase1_invalid + phase2_invalid
        if all_invalid:
            db.bulk_save_objects(all_invalid)
        if cleaned_records:
            db.bulk_save_objects(cleaned_records)

        batch.status = "completed"
        db.commit()

        batches_received_total.labels(status="completed").inc()
        logger.info(
            f"Batch {batch_id} completed - processed={len(measurements)} "
            f"valid/cleaned={len(cleaned_records)} dropped={invalid_count} unmatched={unmatched_count}"
        )
        return {
            "batch_id": batch_id,
            "status": "completed",
            "processed": len(measurements),
            "invalid": invalid_count,
            "cleaned": len(cleaned_records),
            "unmatched": unmatched_count,
            "message": "Batch processing completed successfully",
        }

    except BatchNotFoundError:
        logger.warning(f"Batch {batch_id} not found during processing - rolling back transaction")
        db.rollback()
        db.close()
        raise

    except Exception as e:
        logger.error(f"Error during batch {batch_id} processing: {str(e)} - rolling back all changes")
        db.rollback()
        db.close()

        if self.request.retries < 3:
            logger.warning(
                f"Batch {batch_id} encountered error (attempt {self.request.retries + 1}/3): {str(e)} - will retry in 60s"
            )
            raise self.retry(exc=e, countdown=60, max_retries=3)

        logger.error(
            f"Batch {batch_id} failed after {self.request.retries + 1} attempts (poison pill detected): {str(e)}"
        )
        _mark_batch_failed(batch_uuid, batch_id)
        logger.exception(f"Full traceback for failed batch {batch_id}")
        raise

    finally:
        try:
            db.close()
        except Exception:
            pass
