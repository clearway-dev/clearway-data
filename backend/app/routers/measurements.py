import logging
from datetime import datetime
from fastapi import APIRouter, HTTPException, status

from app.models import MeasurementInput, MeasurementResponse

# Configure logger
logger = logging.getLogger(__name__)

# Create router
router = APIRouter(
    prefix="/measurements",
    tags=["measurements"],
)


@router.post(
    "",
    response_model=MeasurementResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit road measurement data",
    description="Accepts measurement data including GPS coordinates and road width measurements"
)
async def create_measurement(measurement: MeasurementInput) -> MeasurementResponse:
    """
    Receive and process road measurement data.
    
    This endpoint accepts measurement data from the mobile application,
    validates it, and logs it for processing.
    
    Args:
        measurement: Validated measurement data
        
    Returns:
        MeasurementResponse with success confirmation
    """
    try:
        # Log the received measurement data
        logger.info("=" * 80)
        logger.info("NEW MEASUREMENT RECEIVED")
        logger.info(f"Timestamp: {measurement.timestamp}")
        logger.info(f"Location: ({measurement.latitude}, {measurement.longitude})")
        logger.info(f"Left width: {measurement.left_width}m")
        logger.info(f"Right width: {measurement.right_width}m")
        logger.info("=" * 80)
        
        # Also print to console for development
        print(f"\n📍 Measurement received at {datetime.now().isoformat()}")
        print(f"   GPS: {measurement.latitude}, {measurement.longitude}")
        print(f"   Widths: L={measurement.left_width}m, R={measurement.right_width}m")
        print(f"   Timestamp: {measurement.timestamp}\n")
        
        # Generate a simple measurement ID (in production, this would come from database)
        measurement_id = f"meas_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        return MeasurementResponse(
            success=True,
            message="Measurement data received successfully",
            measurement_id=measurement_id
        )
        
    except Exception as e:
        logger.error(f"Error processing measurement: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing measurement data"
        )
