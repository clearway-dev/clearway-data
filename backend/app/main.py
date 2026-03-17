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

# Configure Loguru for FastAPI process
os.makedirs("/app/logs", exist_ok=True)
logger.remove()
logger.add(
    "/app/logs/fastapi.log",
    rotation="10 MB",
    retention="14 days",
    level="INFO",
)

# Create all database tables
# Note: In production, use Alembic migrations instead
Base.metadata.create_all(bind=engine)

# Initialize FastAPI app
app = FastAPI(
    title="ClearWay API",
    version="0.1.0",
    description="API for road width measurement data collection and processing"
)

# Configure CORS - allows requests from React Native mobile app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to specific domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==============================================
# HEALTH CHECK ENDPOINTS
# ==============================================

@app.get("/", tags=["health"])
def root():
    """Root endpoint - API status check"""
    return {
        "message": "ClearWay API is running",
        "version": "0.1.0",
        "status": "operational"
    }


@app.get("/health", tags=["health"])
def health_check():
    """Health check endpoint for monitoring"""
    return {"status": "healthy"}


@app.get("/db-check", tags=["health"])
def check_database_connection(db: Session = Depends(get_db)):
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
def get_vehicles(db: Session = Depends(get_db)):
    """
    Get list of all vehicles.
    Mobile app uses this to populate the vehicle selection dropdown.
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
def create_vehicle(vehicle: schemas.VehicleCreate, db: Session = Depends(get_db)):
    """
    Create a new vehicle.
    Used for adding measurement vehicles to the system.
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
def get_vehicle(vehicle_id: str, db: Session = Depends(get_db)):
    """Get specific vehicle by ID"""
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
def get_sensors(db: Session = Depends(get_db)):
    """Get list of all sensors"""
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
def create_sensor(sensor: schemas.SensorCreate, db: Session = Depends(get_db)):
    """Create a new sensor"""
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
def create_session(session: schemas.SessionCreate, db: Session = Depends(get_db)):
    """
    Create a new measurement session.
    Mobile app calls this when starting a new measurement run.
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


@measurements_router.post("/raw", response_model=schemas.SuccessResponse, status_code=status.HTTP_201_CREATED)
def ingest_raw_measurement(payload: schemas.RawMeasurementCreateLax, db: Session = Depends(get_db)):
    """
    Ingest raw measurement data from mobile app.
    
    This endpoint:
    1. Accepts structurally valid payload (Pydantic handles 422 for bad structure)
    2. Stores data into raw_measurements
    3. Queues async post-processing task in Celery
    
    Future: Will trigger async processing via Celery
    """
    try:
        # Verify session exists
        db_session = db.query(models.Session).filter(models.Session.id == payload.session_id).first()
        if not db_session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session with ID {payload.session_id} not found"
            )
        
        try:
            new_measurement = models.RawMeasurement(
                session_id=payload.session_id,
                measured_at=payload.measured_at,
                latitude=payload.latitude,
                longitude=payload.longitude,
                distance_left=payload.distance_left,
                distance_right=payload.distance_right,
                speed=payload.speed,
                accuracy_gps=payload.accuracy_gps,
                is_valid=True
            )
            
            db.add(new_measurement)
            db.flush()

            process_batch_task.delay([new_measurement.id])

            db.commit()
            db.refresh(new_measurement)

            logger.info(f"Stored measurement {new_measurement.id} for session {payload.session_id} and queued async task")
            
            return schemas.SuccessResponse(
                success=True,
                message="Measurement received, stored, and queued for async processing",
                data={
                    "measurement_id": new_measurement.id,
                    "queued": True
                }
            )
            
        except IntegrityError as ie:
            db.rollback()
            logger.error(f"DB constraint violation for session {payload.session_id}: {str(ie)}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Database constraint violation: {str(ie)}"
            )
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error ingesting measurement: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to ingest measurement: {str(e)}"
        )


@measurements_router.get("/recent", response_model=List[schemas.RawMeasurementResponse])
def get_recent_measurements(limit: int = 100, db: Session = Depends(get_db)):
    """
    Get recent measurements for debugging/monitoring.
    Returns the most recent measurements ordered by timestamp.
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


@app.post("/raw-data/batch", response_model=schemas.BatchMeasurementResponse, status_code=status.HTTP_201_CREATED, tags=["measurements"])
def ingest_batch_measurements(payload: schemas.BatchMeasurementCreate, db: Session = Depends(get_db)):
    """
    Ingest batch of measurements from mobile app (OFFLINE-FIRST ARCHITECTURE).
    
    This is the PRIMARY endpoint for mobile data ingestion.
    Mobile app collects measurements offline and sends them as a single batch.
    
    This endpoint:
    1. Validates session existence
    2. Stores incoming measurements using bulk insert (db.add_all())
    3. Calls db.flush() to retrieve generated BIGSERIAL IDs
    4. Enqueues Celery task process_batch_task with inserted IDs
    5. Commits transaction and returns summary
    
    Performance: Can handle up to 10,000 measurements per request.
    
    Args:
        payload: BatchMeasurementCreate containing session_id and list of measurements
        db: Database session dependency
        
    Returns:
        BatchMeasurementResponse with statistics about processed measurements
    """
    try:
        # Verify session exists
        db_session = db.query(models.Session).filter(models.Session.id == payload.session_id).first()
        if not db_session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session with ID {payload.session_id} not found"
            )
        
        total_received = len(payload.measurements)
        total_stored = 0
        
        # Prepare list for bulk insert
        measurements_to_insert = []
        inserted_ids = []
        
        logger.info(f"Processing batch of {total_received} measurements for session {payload.session_id}")
        
        # Process each measurement
        for measurement in payload.measurements:
            # Structural validation is handled by Pydantic schema.
            # Business/logical validation is delegated to Celery pipeline.
            new_measurement = models.RawMeasurement(
                session_id=payload.session_id,
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
        
        # Perform BULK INSERT (efficient!)
        if measurements_to_insert:
            try:
                db.add_all(measurements_to_insert)
                db.flush()  # Flush to get IDs without committing

                inserted_ids = [measurement.id for measurement in measurements_to_insert if measurement.id is not None]
                
                total_stored = len(measurements_to_insert)

                process_batch_task.delay(inserted_ids)
                
                db.commit()
                
                logger.info(
                    f"Batch processed: {total_stored} stored and queued for async processing "
                    f"for session {payload.session_id}"
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
            message=f"Batch processed: {total_stored}/{total_received} measurements stored",
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
