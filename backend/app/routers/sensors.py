from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_active_user, require_admin

router = APIRouter(prefix="/api/sensors", tags=["sensors"])


@router.get("", response_model=List[schemas.SensorResponse])
async def get_sensors(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Get list of all sensors

    Requires: Active user authentication
    """
    try:
        sensors = db.query(models.Sensor).filter(models.Sensor.is_active == True).all()
        return sensors
    except Exception as e:
        logger.error(f"Error fetching sensors: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch sensors: {str(e)}"
        )


@router.post("", response_model=schemas.SensorResponse, status_code=status.HTTP_201_CREATED)
async def create_sensor(
    sensor: schemas.SensorCreate,
    db: Session = Depends(get_db),
    admin_user: models.User = Depends(require_admin)
):
    """
    Create a new sensor

    Requires: Admin role
    """
    try:
        db_sensor = models.Sensor(
            description=sensor.description,
            is_active=sensor.is_active
        )

        db.add(db_sensor)
        db.commit()
        db.refresh(db_sensor)

        logger.info(f"Created sensor: {db_sensor.id}")
        return db_sensor

    except Exception as e:
        db.rollback()
        logger.error(f"Error creating sensor: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create sensor: {str(e)}"
        )
