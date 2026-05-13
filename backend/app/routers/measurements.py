import time
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app import models, schemas
from app.database import get_db
from app.deps import get_current_active_user
from app.worker import process_batch_task
from app.metrics import batches_received_total, batch_size_measurements

router = APIRouter(prefix="/api/v1/measurements", tags=["measurements"])


@router.get("/recent", response_model=List[schemas.RawMeasurementResponse])
async def get_recent_measurements(
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Get recent measurements for debugging/monitoring.
    Returns the most recent measurements ordered by timestamp (newest first).

    Query params:
        limit: maximum number of records to return (default 100)

    Requires: Active user authentication
    """
    try:
        measurements = db.query(models.RawMeasurement)\
            .order_by(models.RawMeasurement.measured_at.desc())\
            .limit(limit)\
            .all()
        return measurements
    except Exception as e:
        logger.error(f"Error fetching recent measurements: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch measurements: {str(e)}"
        )


@router.post("/raw-data/batch", response_model=schemas.BatchMeasurementResponse, status_code=status.HTTP_201_CREATED)
async def ingest_batch_measurements(
    payload: schemas.BatchMeasurementCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Ingest a batch of measurements from the mobile app (offline-first architecture).

    Primary endpoint for mobile data ingestion. The app collects measurements
    offline and sends them as a single batch when connectivity is restored.

    Processing pipeline:
    1. Validates that the session exists
    2. Creates a batch record (status=pending) and stores all measurements
    3. Commits the transaction
    4. Enqueues an async Celery task for logical validation and map-matching

    The Celery task runs asynchronously — this endpoint returns immediately after
    the data is committed. If the task queue is unavailable, data is still saved
    and only a warning is logged.

    Accepts up to 10,000 measurements per request.

    Requires: Active user authentication
    """
    start_time = time.time()
    batch_id = None  # Initialize for exception handling

    try:
        # 1. Verify session exists
        db_session = db.query(models.Session).filter(models.Session.id == payload.session_id).first()
        if not db_session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session with ID {payload.session_id} not found"
            )

        total_received = len(payload.measurements)
        total_stored = 0

        logger.debug(f"Processing batch of {total_received} measurements for session {payload.session_id}")

        # 2. Create new batch record with status='pending'
        new_batch = models.Batch(
            session_id=payload.session_id,
            status='pending'
        )

        db.add(new_batch)
        db.flush()  # Get the generated batch UUID

        batch_id = new_batch.id
        logger.debug(f"Created batch {batch_id} for session {payload.session_id}")

        batches_received_total.labels(status="pending").inc()
        batch_size_measurements.observe(total_received)

        # 3. Prepare measurements with batch_id FK
        measurements_to_insert = []

        for measurement in payload.measurements:
            # Structural validation is handled by Pydantic schema.
            # Business/logical validation is delegated to Celery pipeline.
            new_measurement = models.RawMeasurement(
                batch_id=batch_id,
                measured_at=measurement.measured_at,
                latitude=measurement.latitude,
                longitude=measurement.longitude,
                distance_left=measurement.distance_left,
                distance_right=measurement.distance_right,
                speed=measurement.speed,
                accuracy_gps=measurement.accuracy_gps,
                is_valid=True
            )

            measurements_to_insert.append(new_measurement)

        # 4. Bulk insert all measurements
        if measurements_to_insert:
            try:
                db.add_all(measurements_to_insert)
                db.flush()  # Flush to assign IDs

                total_stored = len(measurements_to_insert)

                # CRITICAL: Commit FIRST, then queue task
                db.commit()

                logger.debug(
                    f"Batch {batch_id}: {total_stored} measurements committed to database"
                )

                # 5. Queue task AFTER successful commit - prevents race condition
                try:
                    process_batch_task.delay(str(batch_id))
                    logger.debug(
                        f"Batch {batch_id}: Celery task queued for async processing"
                    )
                except Exception as celery_error:
                    # Log error but don't fail the request - data is already saved
                    logger.error(
                        f"Failed to queue Celery task for batch {batch_id}: {str(celery_error)}. "
                        f"Data is saved but processing will not happen automatically."
                    )

            except IntegrityError as ie:
                db.rollback()
                logger.error(f"Bulk insert failed - likely foreign key violation: {str(ie)}")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Database constraint violation - check that session_id exists: {str(ie)}"
                )

        latency_ms = int((time.time() - start_time) * 1000)

        logger.info(
            f"Batch {batch_id} processed: {total_received} received, {total_stored} valid, "
            f"queued for Celery in {latency_ms}ms"
        )

        return schemas.BatchMeasurementResponse(
            success=True,
            message=f"Batch {batch_id} created: {total_stored}/{total_received} measurements stored",
            batch_id=batch_id,
            total_received=total_received,
            total_stored=total_stored,
            total_invalid=0,
            total_rejected=0,
            invalid_indices=[],
            rejected_indices=[]
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error processing batch: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process batch: {str(e)}"
        )
