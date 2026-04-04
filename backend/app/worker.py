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
                ST_Y(ST_ClosestPoint(rs.geom,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))) AS snapped_lat,
                ST_X(ST_ClosestPoint(rs.geom,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))) AS snapped_lon,
                degrees(ST_Azimuth(
                    ST_StartPoint(rs.geom),
                    ST_EndPoint(rs.geom)
                )) AS road_heading,
                ST_Distance(
                    rs.geom::geography,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                ) AS distance
            FROM road_segments rs
            WHERE ST_DWithin(
                rs.geom::geography,
                ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                :max_dist
            )
            ORDER BY distance
            LIMIT 3
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

                # Handle duplicate timestamp or zero time difference
                if time_diff_s == 0:
                    if distance_m > 0:
                        # Duplicate timestamp but different location - reject
                        invalid_count += 1
                        m.is_valid = False
                        reason = "GPS jump detected: Duplicate timestamp with different location"
                        if m.id not in existing_invalid_ids:
                            invalid_records.append(
                                models.InvalidMeasurement(
                                    raw_measurement_id=m.id,
                                    rejection_reason=reason,
                                )
                            )
                            existing_invalid_ids.add(m.id)
                        logger.warning(
                            "measurement_evaluation id={} status=invalid stage=gps_jump_check reason='{}' "
                            "distance_m={:.2f} time_diff_s={:.2f} speed_mps=undefined",
                            m.id,
                            reason,
                            distance_m,
                            time_diff_s,
                        )
                        # Important: do not move last_valid_point on invalid jump.
                        continue
                    # else: time_diff_s == 0 and distance_m == 0 - exact duplicate, skip quietly
                    # This is likely duplicate data, ignore and continue without validation error
                
                # Check for unrealistic speed when time_diff_s > 0
                elif (distance_m / time_diff_s) > MAX_REALISTIC_SPEED_MPS:
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
                    speed_mps = distance_m / time_diff_s
                    logger.warning(
                        "measurement_evaluation id={} status=invalid stage=gps_jump_check reason='{}' "
                        "distance_m={:.2f} time_diff_s={:.2f} speed_mps={:.2f}",
                        m.id,
                        reason,
                        distance_m,
                        time_diff_s,
                        speed_mps,
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
        
        # Track previous valid measurement for heading calculation
        prev_measurement: models.RawMeasurement | None = None

        for m in valid_measurements:
            vehicle_width: float = m.batch.session.vehicle.width
            
            # Calculate vehicle heading from consecutive GPS points
            vehicle_heading: float | None = None
            if prev_measurement is not None:
                # Only calculate heading if points are different
                if (prev_measurement.latitude != m.latitude or 
                    prev_measurement.longitude != m.longitude):
                    vehicle_heading = _calculate_heading(
                        prev_measurement.latitude,
                        prev_measurement.longitude,
                        m.latitude,
                        m.longitude
                    )

            snapped = _map_match(db, m.latitude, m.longitude, vehicle_heading)
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
            
            # Update previous measurement for next heading calculation
            prev_measurement = m

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
