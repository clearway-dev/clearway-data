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
from scipy.signal import medfilt
from shapely.geometry import Point
from sqlalchemy import text
from sqlalchemy.orm import Session

from . import models
from .database import SessionLocal


class BatchNotFoundError(Exception):
    """Custom exception raised when batch is not found in database.
    
    This exception is used to trigger automatic retries in Celery tasks,
    handling race conditions between database commit and task execution.
    """
    pass

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://clearway-redis:6379/0")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://clearway-redis:6379/0")

# Maximum distance in metres for snapping a GPS point to a road segment.
MAP_MATCH_MAX_DISTANCE_M = 50.0
MAX_GPS_ACCURACY = 25.0  # Maximum GPS accuracy to consider a point valid for map-matching
MAX_REALISTIC_SPEED_MPS = 40.0
# Median window for width denoising. Must be an odd number.
WIDTH_MEDIAN_WINDOW = 3

celery_app = Celery(
    "clearway",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
)


@worker_process_init.connect
def setup_worker_logger(**kwargs):
    os.makedirs("/app/logs", exist_ok=True)
    logger.remove()
    logger.add(
        "/app/logs/worker.log",
        rotation="10 MB",
        retention="7 days",
        level="INFO",
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

    if measurement.speed is not None and measurement.speed < 0:
        errors.append(f"speed must be >= 0 (got {measurement.speed})")

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
    max_distance_m: float = MAP_MATCH_MAX_DISTANCE_M,
) -> tuple[float, float] | None:
    """
    Project a GPS point onto the nearest road segment using PostGIS.

    Searches road_segments within *max_distance_m* metres (geography cast for
    accurate metric distances), then returns the closest point on the winning
    segment's geometry.

    Returns (snapped_lat, snapped_lon) or None when no match is found.
    """
    row = db.execute(
        text(
            """
            SELECT
                ST_Y(ST_ClosestPoint(rs.geom,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))) AS snapped_lat,
                ST_X(ST_ClosestPoint(rs.geom,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))) AS snapped_lon
            FROM road_segments rs
            WHERE ST_DWithin(
                rs.geom::geography,
                ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                :max_dist
            )
            ORDER BY ST_Distance(
                rs.geom::geography,
                ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
            )
            LIMIT 1
            """
            # WITH p AS (
            #     SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS pt
            # )
            # SELECT
            #     ST_Y(q.cp) AS snapped_lat,
            #     ST_X(q.cp) AS snapped_lon
            # FROM p
            # CROSS JOIN LATERAL (
            #     SELECT ST_ClosestPoint(rs.geom, p.pt) AS cp
            #     FROM road_segments rs
            #     WHERE ST_DWithin(rs.geom::geography, p.pt::geography, :max_dist)
            #     ORDER BY ST_Distance(rs.geom::geography, p.pt::geography)
            #     LIMIT 1
            # ) q;
        ),
        {"lat": lat, "lon": lon, "max_dist": max_distance_m},
    ).fetchone()

    if row is None:
        return None

    return float(row.snapped_lat), float(row.snapped_lon)


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
# Celery task
# --------------------------------------------------------------------------- #

@celery_app.task(
    name="process_batch_task",
    bind=True,
    autoretry_for=(BatchNotFoundError,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    max_retries=5,
    default_retry_delay=10,
)
def process_batch_task(self, batch_id: str) -> dict:
    """
    Full async processing pipeline for a batch of raw measurements.
    
    NEW: Receives batch_id (UUID as string) instead of array of measurement IDs.
    Updates batch status throughout processing: pending -> processing -> completed/failed.

    1. Load Batch record and update status to 'processing'
    2. Load RawMeasurement rows via batch_id, joined with Session -> Vehicle
    3. Phase 1 - logical validation -> mark invalids, bulk-insert invalid_measurements
    4. Phase 2 - map-match each valid point -> compute cleaned_width,
       bulk-insert cleaned_measurements
    5. Update batch status to 'completed' or 'failed'
    6. Single db.commit() covering all changes
    
    Retry configuration:
    - Automatically retries on BatchNotFoundError (race condition handling)
    - Max retries: 5
    - Initial retry delay: 10 seconds
    - Uses exponential backoff with jitter to prevent thundering herd
    - Max backoff: 600 seconds (10 minutes)
    """
    db: Session = SessionLocal()
    try:
        import uuid
        batch_uuid = uuid.UUID(batch_id)
        
        # ------------------------------------------------------------------ #
        # LOAD BATCH and update status to 'processing'
        # ------------------------------------------------------------------ #
        batch: models.Batch = db.query(models.Batch).filter(models.Batch.id == batch_uuid).first()
        
        if not batch:
            logger.warning(
                f"Batch {batch_id} not found in database - will retry "
                f"(attempt {self.request.retries + 1}/{self.max_retries})"
            )
            # Raise custom exception to trigger automatic retry
            raise BatchNotFoundError(
                f"Batch {batch_id} not found in database. "
                f"This may be a race condition - task will retry."
            )
        
        # Update batch status to 'processing'
        batch.status = 'processing'
        db.flush()
        
        logger.info(f"process_batch_task started for batch_id={batch_id}")

        # ------------------------------------------------------------------ #
        # LOAD - measurements with session + vehicle eagerly joined
        # ------------------------------------------------------------------ #
        measurements: list[models.RawMeasurement] = (
            db.query(models.RawMeasurement)
            .join(models.RawMeasurement.batch)
            .join(models.Batch.session)
            .join(models.Session.vehicle)
            .filter(models.RawMeasurement.batch_id == batch_uuid)
            .order_by(models.RawMeasurement.measured_at.asc(), models.RawMeasurement.id.asc())
            .all()
        )

        logger.info(
            f"Batch {batch_id}: loaded {len(measurements)} measurements"
        )

        # Pre-load existing invalid IDs to avoid duplicate entries on retry.
        measurement_ids = [m.id for m in measurements]
        existing_invalid_ids: set[int] = {
            row.raw_measurement_id
            for row in db.query(models.InvalidMeasurement.raw_measurement_id)
            .filter(models.InvalidMeasurement.raw_measurement_id.in_(measurement_ids))
            .all()
        }

        # ------------------------------------------------------------------ #
        # PHASE 1 - Logical validation
        # ------------------------------------------------------------------ #
        valid_measurements: list[models.RawMeasurement] = []
        invalid_records: list[models.InvalidMeasurement] = []
        invalid_count = 0
        last_valid_point: models.RawMeasurement | None = None

        for m in measurements:
            errors = _validate_measurement_logic(m)
            if errors:
                invalid_count += 1
                m.is_valid = False
                reason = "; ".join(errors)
                if m.id not in existing_invalid_ids:
                    invalid_records.append(
                        models.InvalidMeasurement(
                            raw_measurement_id=m.id,
                            rejection_reason=reason,
                        )
                    )
                    existing_invalid_ids.add(m.id)
                logger.info(
                    "measurement_evaluation id={} status=invalid stage=logical_validation reason='{}'",
                    m.id,
                    reason,
                )
                continue

            # Urban canyon / GPS jump detection against last valid point only.
            if last_valid_point is not None:
                time_diff_s = (m.measured_at - last_valid_point.measured_at).total_seconds()
                distance_m = _haversine_distance_m(
                    last_valid_point.latitude,
                    last_valid_point.longitude,
                    m.latitude,
                    m.longitude,
                )

                is_unrealistic_jump = (
                    (time_diff_s == 0 and distance_m > 0)
                    or (time_diff_s > 0 and (distance_m / time_diff_s) > MAX_REALISTIC_SPEED_MPS)
                )

                if is_unrealistic_jump:
                    invalid_count += 1
                    m.is_valid = False
                    reason = "GPS jump detected: Unrealistic speed"
                    if m.id not in existing_invalid_ids:
                        invalid_records.append(
                            models.InvalidMeasurement(
                                raw_measurement_id=m.id,
                                rejection_reason=reason,
                            )
                        )
                        existing_invalid_ids.add(m.id)
                    speed_estimate = None if time_diff_s <= 0 else (distance_m / time_diff_s)
                    logger.info(
                        "measurement_evaluation id={} status=invalid stage=gps_jump_check reason='{}' "
                        "distance_m={:.2f} time_diff_s={:.2f} speed_mps={}",
                        m.id,
                        reason,
                        distance_m,
                        time_diff_s,
                        f"{speed_estimate:.2f}" if speed_estimate is not None else "inf",
                    )
                    # Important: do not move last_valid_point on invalid jump.
                    continue

            valid_measurements.append(m)
            last_valid_point = m
            logger.info(
                "measurement_evaluation id={} status=valid stage=logical_validation",
                m.id,
            )

        # ------------------------------------------------------------------ #
        # PHASE 2 - Map-matching + cleaned_measurements
        # ------------------------------------------------------------------ #
        cleaned_records: list[models.CleanedMeasurement] = []
        unmatched_count = 0

        matched_points: list[dict] = []

        for m in valid_measurements:
            vehicle_width: float = m.batch.session.vehicle.width

            snapped = _map_match(db, m.latitude, m.longitude)
            if snapped is None:
                # No road segment within range - mark as invalid and record reason.
                unmatched_count += 1
                invalid_count += 1
                m.is_valid = False

                if m.id not in existing_invalid_ids:
                    invalid_records.append(
                        models.InvalidMeasurement(
                            raw_measurement_id=m.id,
                            rejection_reason=(
                                f"Map matching failed: no road segment within "
                                f"{MAP_MATCH_MAX_DISTANCE_M:.0f} m"
                            ),
                        )
                    )
                    existing_invalid_ids.add(m.id)

                logger.info(
                    "measurement_evaluation id={} status=invalid stage=map_matching "
                    "reason='no road segment within {:.0f} m' lat={:.6f} lon={:.6f}",
                    m.id,
                    MAP_MATCH_MAX_DISTANCE_M,
                    m.latitude,
                    m.longitude,
                )
                continue

            snapped_lat, snapped_lon = snapped
            raw_width = m.distance_left + m.distance_right + vehicle_width

            matched_points.append(
                {
                    "measurement": m,
                    "snapped_lat": snapped_lat,
                    "snapped_lon": snapped_lon,
                    "raw_width": raw_width,
                }
            )

        # Final cleaning step: median filter AFTER map-matching.
        # Batch is already chronologically ordered and belongs to one vehicle.
        matched_points.sort(key=lambda item: (item["measurement"].measured_at, item["measurement"].id))
        matched_raw_widths = [item["raw_width"] for item in matched_points]
        filtered_widths = _apply_width_median_filter(matched_raw_widths)

        for item, filtered_width in zip(matched_points, filtered_widths):
            m = item["measurement"]
            snapped_lat = item["snapped_lat"]
            snapped_lon = item["snapped_lon"]

            cleaned_records.append(
                models.CleanedMeasurement(
                    raw_measurement_id=m.id,
                    cleaned_width=filtered_width,
                    quality_score=None,  # reserved for future scoring logic
                    cluster_id=None,
                    geom=from_shape(Point(snapped_lon, snapped_lat), srid=4326),
                )
            )

            logger.info(
                "measurement_evaluation id={} status=cleaned stage=post_map_matching_median "
                "snapped_lat={:.6f} snapped_lon={:.6f} cleaned_width={:.3f} raw_width={:.3f}",
                m.id,
                snapped_lat,
                snapped_lon,
                filtered_width,
                item["raw_width"],
            )

        if cleaned_records:
            db.bulk_save_objects(cleaned_records)

        # Add invalid rows created during phase 2 (unmatched map-matching).
        if invalid_records:
            db.bulk_save_objects(invalid_records)

        # Update batch status to 'completed'
        batch.status = 'completed'
        
        # Single transaction covering all phases
        db.commit()

        logger.info(
            f"Batch {batch_id} completed - processed={len(measurements)} invalid={invalid_count} "
            f"cleaned={len(cleaned_records)} unmatched={unmatched_count}"
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
        # Let Celery handle the retry automatically
        db.rollback()
        db.close()
        raise
    except Exception as e:
        # Update batch status to 'failed' on error
        batch: models.Batch | None = None
        try:
            if 'batch_uuid' in locals():
                batch = db.query(models.Batch).filter(models.Batch.id == batch_uuid).first()
            if batch:
                batch.status = 'failed'
                db.commit()
                logger.error(f"Batch {batch_id} failed: {str(e)}")
        except Exception as commit_error:
            logger.error(f"Failed to update batch status to 'failed': {str(commit_error)}")
        
        db.rollback()
        logger.exception(f"Unhandled error in process_batch_task for batch {batch_id}")
        raise
    finally:
        db.close()
