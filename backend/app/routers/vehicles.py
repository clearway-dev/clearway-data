from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_active_user, require_admin

router = APIRouter(prefix="/api/v1/vehicles", tags=["vehicles"])


@router.get("", response_model=List[schemas.VehicleResponse])
async def get_vehicles(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Get list of all vehicles.
    Mobile app uses this to populate the vehicle selection dropdown.

    Requires: Active user authentication
    """
    try:
        vehicles = db.query(models.Vehicle).all()
        return vehicles
    except Exception as e:
        logger.error(f"Error fetching vehicles: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch vehicles: {str(e)}"
        )


@router.post("", response_model=schemas.VehicleResponse, status_code=status.HTTP_201_CREATED)
async def create_vehicle(
    vehicle: schemas.VehicleCreate,
    db: Session = Depends(get_db),
    admin_user: models.User = Depends(require_admin)
):
    """
    Create a new vehicle.
    Used for adding measurement vehicles to the system.

    Requires: Admin role
    """
    try:
        db_vehicle = models.Vehicle(
            vehicle_name=vehicle.vehicle_name,
            width=vehicle.width
        )

        db.add(db_vehicle)
        db.commit()
        db.refresh(db_vehicle)

        logger.info(f"Created vehicle: {db_vehicle.vehicle_name} (ID: {db_vehicle.id})")
        return db_vehicle

    except Exception as e:
        db.rollback()
        logger.error(f"Error creating vehicle: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create vehicle: {str(e)}"
        )


@router.get("/{vehicle_id}", response_model=schemas.VehicleResponse)
async def get_vehicle(
    vehicle_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Get specific vehicle by ID

    Requires: Active user authentication
    """
    vehicle = db.query(models.Vehicle).filter(models.Vehicle.id == vehicle_id).first()
    if not vehicle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Vehicle with ID {vehicle_id} not found"
        )
    return vehicle
