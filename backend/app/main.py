"""
ClearWay FastAPI Backend
Main application entry point with API endpoints for data ingestion.
"""
import logging
from typing import List
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text
from . import models, schemas
from .database import get_db, engine, Base

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
def ingest_raw_measurement(payload: schemas.RawMeasurementCreate, db: Session = Depends(get_db)):
    """
    Ingest raw measurement data from mobile app.
    
    This endpoint:
    1. Validates incoming data (GPS coordinates, distances)
    2. Checks that the session exists
    3. Stores measurement in raw_measurements table
    
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
        
        # Create new measurement record
        new_measurement = models.RawMeasurement(
            session_id=payload.session_id,
            measured_at=payload.measured_at,
            latitude=payload.latitude,
            longitude=payload.longitude,
            distance_left=payload.distance_left,
            distance_right=payload.distance_right
        )
        
        db.add(new_measurement)
        db.commit()
        db.refresh(new_measurement)
        
        logger.info(f"Ingested measurement: {new_measurement.id} for session {payload.session_id}")
        
        # TODO: In Phase 2, trigger Celery task here
        # process_measurement.delay(new_measurement.id)
        
        return schemas.SuccessResponse(
            success=True,
            message="Measurement successfully received and stored",
            data={"measurement_id": new_measurement.id}
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
