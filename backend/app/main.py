"""
ClearWay FastAPI Backend
Main application entry point with API endpoints for data ingestion.
"""
import os
from typing import List
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from . import models, schemas
from .worker import process_batch_task
from .database import get_db, engine, Base
from .routers import auth
from .routers.auth import get_current_active_user, require_admin

# Configure Loguru for FastAPI process
os.makedirs("/app/logs", exist_ok=True)
logger.remove()
logger.add(
    "/app/logs/fastapi.log",
    rotation="10 MB",
    retention="14 days",
    level="INFO",
)


# Initialize FastAPI app
app = FastAPI(
    title="ClearWay API",
    version="0.1.0",
    description="API for road width measurement data collection and processing"
)


# ==============================================
# HEALTH CHECK ENDPOINTS
# ==============================================

@app.get("/", tags=["health"])
async def root():
    """Root endpoint - API status check"""
    return {
        "message": "ClearWay API is running",
        "version": "0.1.0",
        "status": "operational"
    }


@app.get("/health", tags=["health"])
async def health_check():
    """Health check endpoint for monitoring"""
    return {"status": "healthy"}


@app.get("/db-check", tags=["health"])
async def check_database_connection(db: Session = Depends(get_db)):
    """
    Database connection check endpoint.
    Verifies that the API can successfully connect to PostgreSQL.
    """
    try:
        # Execute simple query to verify connection
        db.execute(text("SELECT 1"))
        return {
            "status": "success",
            "message": "Připojení k databázi funguje!",
            "database": "PostgreSQL"
        }
    except Exception as e:
        logger.error(f"Database connection failed: {str(e)}")
        return {
            "status": "error",
            "message": f"Chyba připojení: {str(e)}"
        }


# ==============================================
# VEHICLES ENDPOINTS
# ==============================================

vehicles_router = APIRouter(prefix="/api/vehicles", tags=["vehicles"])


@vehicles_router.get("", response_model=List[schemas.VehicleResponse])
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


@vehicles_router.post("", response_model=schemas.VehicleResponse, status_code=status.HTTP_201_CREATED)
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
        # Create new vehicle instance
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


@vehicles_router.get("/{vehicle_id}", response_model=schemas.VehicleResponse)
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


# ==============================================
# SENSORS ENDPOINTS
# ==============================================

sensors_router = APIRouter(prefix="/api/sensors", tags=["sensors"])


@sensors_router.get("", response_model=List[schemas.SensorResponse])
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


@sensors_router.post("", response_model=schemas.SensorResponse, status_code=status.HTTP_201_CREATED)
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


# ==============================================
# SESSIONS ENDPOINTS
# ==============================================

sessions_router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@sessions_router.post("", response_model=schemas.SessionResponse, status_code=status.HTTP_201_CREATED)
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
        
        logger.info(f"Created session: {db_session.id} (Vehicle: {vehicle.vehicle_name})")
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


# ==============================================
# RAW MEASUREMENTS ENDPOINTS
# ==============================================

measurements_router = APIRouter(prefix="/api/measurements", tags=["measurements"])


@measurements_router.get("/recent", response_model=List[schemas.RawMeasurementResponse])
async def get_recent_measurements(
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Get recent measurements for debugging/monitoring.
    Returns the most recent measurements ordered by timestamp.
    
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


@measurements_router.post("/raw-data/batch", response_model=schemas.BatchMeasurementResponse, status_code=status.HTTP_201_CREATED, tags=["measurements"])
async def ingest_batch_measurements(
    payload: schemas.BatchMeasurementCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Ingest batch of measurements from mobile app (OFFLINE-FIRST ARCHITECTURE).
    
    This is the PRIMARY endpoint for mobile data ingestion.
    Mobile app collects measurements offline and sends them as a single batch.
    
    Requires: Active user authentication
    
    This endpoint:
    1. Validates session existence
    2. Creates a new batch record with status='pending'
    3. Stores incoming measurements using bulk insert (db.add_all()) with batch_id FK
    4. Commits transaction FIRST
    5. Enqueues Celery task process_batch_task AFTER successful commit
    
    Performance: Can handle up to 10,000 measurements per request.
    
    RACE CONDITION FIX:
    - Celery task is triggered ONLY after db.commit() succeeds
    - Task will retry automatically if batch is not found (handles Redis faster than Postgres)
    
    Args:
        payload: BatchMeasurementCreate containing session_id and list of measurements
        db: Database session dependency
        
    Returns:
        BatchMeasurementResponse with statistics about processed measurements
    """
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
        
        logger.info(f"Processing batch of {total_received} measurements for session {payload.session_id}")
        
        # 2. Create new batch record with status='pending'
        new_batch = models.Batch(
            session_id=payload.session_id,
            status='pending'
        )
        
        db.add(new_batch)
        db.flush()  # Get the generated batch UUID
        
        batch_id = new_batch.id
        logger.info(f"Created batch {batch_id} for session {payload.session_id}")
        
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
        
        # 4. Perform BULK INSERT (efficient!)
        if measurements_to_insert:
            try:
                db.add_all(measurements_to_insert)
                db.flush()  # Flush to assign IDs
                
                total_stored = len(measurements_to_insert)

                # CRITICAL: Commit FIRST, then queue task
                db.commit()
                
                logger.info(
                    f"Batch {batch_id}: {total_stored} measurements committed to database"
                )
                
                # 5. Queue task AFTER successful commit - prevents race condition
                try:
                    process_batch_task.delay(str(batch_id))
                    logger.info(
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


# ==============================================
# REGISTER ROUTERS
# ==============================================

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])  # Authentication endpoints
app.include_router(vehicles_router)
app.include_router(sensors_router)
app.include_router(sessions_router)
app.include_router(measurements_router)


# ==============================================
# STARTUP/SHUTDOWN EVENTS
# ==============================================

@app.on_event("startup")
async def startup_event():
    """Log startup information"""
    logger.info("=" * 50)
    logger.info("ClearWay API Starting Up")
    logger.info("=" * 50)


@app.on_event("shutdown")
async def shutdown_event():
    """Log shutdown information"""
    logger.info("ClearWay API Shutting Down")


# ==============================================
# MAIN ENTRY POINT
# ==============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
