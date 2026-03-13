"""
Celery worker module for asynchronous logical validation of measurements.
"""
import os
from celery import Celery
from sqlalchemy.orm import Session

from .database import SessionLocal
from . import models

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://clearway-redis:6379/0")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://clearway-redis:6379/0")

celery_app = Celery(
    "clearway",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
)


def _validate_measurement_logic(measurement: models.RawMeasurement) -> list[str]:
    errors: list[str] = []

    if measurement.distance_left < 0:
        errors.append(f"distance_left must be >= 0 (got {measurement.distance_left})")

    if measurement.distance_right < 0:
        errors.append(f"distance_right must be >= 0 (got {measurement.distance_right})")

    if not (-90.0 <= measurement.latitude <= 90.0):
        errors.append(f"latitude out of range [-90, 90] (got {measurement.latitude})")

    if not (-180.0 <= measurement.longitude <= 180.0):
        errors.append(f"longitude out of range [-180, 180] (got {measurement.longitude})")

    return errors


@celery_app.task(name="process_batch_task")
def process_batch_task(measurement_ids: list[int]) -> dict:
    """
    Async logical validation task for already inserted raw measurements.

    For invalid rows:
    - sets raw_measurements.is_valid = False
    - creates invalid_measurements row with rejection_reason
    """
    db: Session = SessionLocal()
    try:
        if not measurement_ids:
            return {
                "processed": 0,
                "invalid": 0,
                "message": "No measurement IDs received",
            }

        measurements = (
            db.query(models.RawMeasurement)
            .filter(models.RawMeasurement.id.in_(measurement_ids))
            .all()
        )

        existing_invalid_ids = {
            row.raw_measurement_id
            for row in db.query(models.InvalidMeasurement.raw_measurement_id)
            .filter(models.InvalidMeasurement.raw_measurement_id.in_(measurement_ids))
            .all()
        }

        invalid_count = 0

        for measurement in measurements:
            errors = _validate_measurement_logic(measurement)
            if not errors:
                continue

            invalid_count += 1
            measurement.is_valid = False

            if measurement.id not in existing_invalid_ids:
                db.add(
                    models.InvalidMeasurement(
                        raw_measurement_id=measurement.id,
                        rejection_reason="; ".join(errors),
                    )
                )

        db.commit()

        return {
            "processed": len(measurements),
            "invalid": invalid_count,
            "message": "Logical validation completed",
        }
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
