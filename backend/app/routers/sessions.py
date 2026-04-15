from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_active_user

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=schemas.SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    session: schemas.SessionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Create a new measurement session.
    Mobile app calls this when starting a new measurement run.

    Requires: Active user authentication
    """
    try:
        # Verify sensor exists
        sensor = db.query(models.Sensor).filter(models.Sensor.id == session.sensor_id).first()
        if not sensor:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Sensor with ID {session.sensor_id} not found"
            )

        # Verify vehicle exists
        vehicle = db.query(models.Vehicle).filter(models.Vehicle.id == session.vehicle_id).first()
        if not vehicle:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Vehicle with ID {session.vehicle_id} not found"
            )

        # Create new session
        db_session = models.Session(
            sensor_id=session.sensor_id,
            vehicle_id=session.vehicle_id
        )

        db.add(db_session)
        db.commit()
        db.refresh(db_session)

        logger.info(f"Session created: {db_session.id} (Vehicle: {vehicle.vehicle_name}, Sensor: {sensor.description or sensor.id})")
        return db_session

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating session: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create session: {str(e)}"
        )
