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
import logging
import os

from celery import Celery
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy import text
from sqlalchemy.orm import Session

from . import models
from .database import SessionLocal

logger = logging.getLogger(__name__)

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://clearway-redis:6379/0")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://clearway-redis:6379/0")

# Maximum distance in metres for snapping a GPS point to a road segment.
MAP_MATCH_MAX_DISTANCE_M = 50.0

celery_app = Celery(
    "clearway",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
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
        ),
        {"lat": lat, "lon": lon, "max_dist": max_distance_m},
    ).fetchone()

    if row is None:
        return None

    return float(row.snapped_lat), float(row.snapped_lon)


# --------------------------------------------------------------------------- #
# Celery task
# --------------------------------------------------------------------------- #

@celery_app.task(name="process_batch_task")
def process_batch_task(measurement_ids: list[int]) -> dict:
    """
    Full async processing pipeline for a batch of raw measurements.

    1. Load RawMeasurement rows joined with Session -> Vehicle (to get vehicle.width).
    2. Phase 1 - logical validation -> mark invalids, bulk-insert invalid_measurements.
    3. Phase 2 - map-match each valid point -> compute cleaned_width,
       bulk-insert cleaned_measurements.
    4. Single db.commit() covering all changes.
    """
    db: Session = SessionLocal()
    try:
        if not measurement_ids:
            return {
                "processed": 0,
                "invalid": 0,
                "cleaned": 0,
                "message": "No measurement IDs received",
            }

        # ------------------------------------------------------------------ #
        # LOAD - measurements with session + vehicle eagerly joined
        # ------------------------------------------------------------------ #
        measurements: list[models.RawMeasurement] = (
            db.query(models.RawMeasurement)
            .join(models.RawMeasurement.session)
            .join(models.Session.vehicle)
            .filter(models.RawMeasurement.id.in_(measurement_ids))
            .all()
        )

        # Pre-load existing invalid IDs to avoid duplicate entries on retry.
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

        for m in measurements:
            errors = _validate_measurement_logic(m)
            if errors:
                invalid_count += 1
                m.is_valid = False
                if m.id not in existing_invalid_ids:
                    invalid_records.append(
                        models.InvalidMeasurement(
                            raw_measurement_id=m.id,
                            rejection_reason="; ".join(errors),
                        )
                    )
                    existing_invalid_ids.add(m.id)
            else:
                valid_measurements.append(m)

        # ------------------------------------------------------------------ #
        # PHASE 2 - Map-matching + cleaned_measurements
        # ------------------------------------------------------------------ #
        cleaned_records: list[models.CleanedMeasurement] = []
        unmatched_count = 0

        for m in valid_measurements:
            vehicle_width: float = m.session.vehicle.width

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

                logger.debug(
                    "No road match for measurement id=%d (%.6f, %.6f)",
                    m.id,
                    m.latitude,
                    m.longitude,
                )
                continue

            snapped_lat, snapped_lon = snapped
            cleaned_width = m.distance_left + m.distance_right + vehicle_width

            cleaned_records.append(
                models.CleanedMeasurement(
                    raw_measurement_id=m.id,
                    cleaned_width=cleaned_width,
                    quality_score=None,  # reserved for future scoring logic
                    cluster_id=None,
                    geom=from_shape(Point(snapped_lon, snapped_lat), srid=4326),
                )
            )

        if cleaned_records:
            db.bulk_save_objects(cleaned_records)

        # Add invalid rows created during phase 2 (unmatched map-matching).
        if invalid_records:
            db.bulk_save_objects(invalid_records)

        # Single transaction covering all phases
        db.commit()

        logger.info(
            "process_batch_task done - processed=%d invalid=%d cleaned=%d unmatched=%d",
            len(measurements),
            invalid_count,
            len(cleaned_records),
            unmatched_count,
        )

        return {
            "processed": len(measurements),
            "invalid": invalid_count,
            "cleaned": len(cleaned_records),
            "unmatched": unmatched_count,
            "message": "Batch processing completed",
        }
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
