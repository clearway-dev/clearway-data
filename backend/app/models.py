from datetime import datetime
from pydantic import BaseModel, Field


class MeasurementInput(BaseModel):
    """
    Input model for road measurement data.
    
    Attributes:
        latitude: GPS latitude coordinate
        longitude: GPS longitude coordinate
        left_width: Width of the road on the left side in meters
        right_width: Width of the road on the right side in meters
        timestamp: ISO 8601 timestamp when the measurement was taken
    """
    latitude: float = Field(..., description="GPS latitude coordinate")
    longitude: float = Field(..., description="GPS longitude coordinate")
    left_width: float = Field(..., ge=0, description="Width on the left side in meters")
    right_width: float = Field(..., ge=0, description="Width on the right side in meters")
    timestamp: str = Field(..., description="ISO 8601 timestamp")
    
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "latitude": 49.8175,
                    "longitude": 15.4730,
                    "left_width": 2.5,
                    "right_width": 2.8,
                    "timestamp": "2026-01-13T10:30:00.000Z"
                }
            ]
        }
    }


class MeasurementResponse(BaseModel):
    """
    Response model for measurement submission.
    
    Attributes:
        success: Whether the measurement was successfully received
        message: Human-readable response message
        measurement_id: Optional identifier for the measurement
    """
    success: bool = Field(..., description="Success status")
    message: str = Field(..., description="Response message")
    measurement_id: str | None = Field(None, description="Measurement identifier")
