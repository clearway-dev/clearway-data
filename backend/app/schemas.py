"""
Pydantic schemas for request/response validation.
Provides strict validation for incoming data from mobile app and responses to frontend.
"""
from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from typing import Optional
from uuid import UUID


# ==============================================
# VEHICLE SCHEMAS
# ==============================================

class VehicleBase(BaseModel):
    """Base schema for vehicle data"""
    vehicle_name: str = Field(..., min_length=1, max_length=100, description="Vehicle name/identifier")
    width: float = Field(..., gt=0, description="Vehicle width in meters")


class VehicleCreate(VehicleBase):
    """Schema for creating a new vehicle"""
    pass


class VehicleResponse(VehicleBase):
    """Schema for vehicle response"""
    id: UUID
    
    class Config:
        from_attributes = True  # Allows serialization from SQLAlchemy models


# ==============================================
# SENSOR SCHEMAS
# ==============================================

class SensorBase(BaseModel):
    """Base schema for sensor data"""
    description: Optional[str] = Field(None, description="Sensor description")
    is_active: bool = Field(True, description="Whether the sensor is active")


class SensorCreate(SensorBase):
    """Schema for creating a new sensor"""
    pass


class SensorResponse(SensorBase):
    """Schema for sensor response"""
    id: UUID
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# ==============================================
# SESSION SCHEMAS
# ==============================================

class SessionCreate(BaseModel):
    """Schema for creating a new measurement session"""
    sensor_id: UUID = Field(..., description="ID of the sensor used")
    vehicle_id: UUID = Field(..., description="ID of the vehicle used")


class SessionResponse(BaseModel):
    """Schema for session response"""
    id: UUID
    sensor_id: UUID
    vehicle_id: UUID
    
    class Config:
        from_attributes = True


# ==============================================
# RAW MEASUREMENT SCHEMAS
# ==============================================

class RawMeasurementCreate(BaseModel):
    """
    Schema for receiving raw measurement data from mobile app.
    Includes strict validation for GPS coordinates and distance measurements.
    """
    session_id: UUID = Field(..., description="ID of the measurement session")
    measured_at: datetime = Field(..., description="Exact timestamp when measurement was taken")
    
    # GPS validation - coordinates must be within valid ranges
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Latitude in decimal degrees")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Longitude in decimal degrees")
    
    # Distance validation - must be non-negative
    distance_left: float = Field(..., ge=0, description="Distance to left obstacle in meters")
    distance_right: float = Field(..., ge=0, description="Distance to right obstacle in meters")
    
    @field_validator('distance_left', 'distance_right')
    @classmethod
    def validate_distances(cls, v: float) -> float:
        """Additional validation: distances should be reasonable (< 50m)"""
        if v > 50.0:
            raise ValueError('Distance measurement seems unrealistic (> 50m)')
        return v
    
    class Config:
        json_schema_extra = {
            "example": {
                "session_id": "550e8400-e29b-41d4-a716-446655440000",
                "measured_at": "2026-02-24T10:30:00.000Z",
                "latitude": 49.8175,
                "longitude": 15.4730,
                "distance_left": 2.5,
                "distance_right": 2.8
            }
        }


class RawMeasurementResponse(BaseModel):
    """Schema for raw measurement response"""
    id: int
    session_id: UUID
    measured_at: datetime
    latitude: float
    longitude: float
    distance_left: float
    distance_right: float
    is_valid: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


# ==============================================
# BATCH MEASUREMENT SCHEMAS
# ==============================================

class BatchMeasurementCreate(BaseModel):
    """
    Schema for receiving multiple measurements at once from mobile app.
    This is useful when mobile app collects data offline and sends in batches.
    """
    session_id: UUID = Field(..., description="ID of the measurement session")
    measurements: list[RawMeasurementCreate] = Field(..., min_length=1, max_length=1000, description="List of measurements")
    
    class Config:
        json_schema_extra = {
            "example": {
                "session_id": "550e8400-e29b-41d4-a716-446655440000",
                "measurements": [
                    {
                        "session_id": "550e8400-e29b-41d4-a716-446655440000",
                        "measured_at": "2026-02-24T10:30:00.000Z",
                        "latitude": 49.8175,
                        "longitude": 15.4730,
                        "distance_left": 2.5,
                        "distance_right": 2.8
                    }
                ]
            }
        }


# ==============================================
# GENERIC RESPONSE SCHEMAS
# ==============================================

class SuccessResponse(BaseModel):
    """Generic success response"""
    success: bool = Field(True, description="Operation success status")
    message: str = Field(..., description="Human-readable message")
    data: Optional[dict] = Field(None, description="Optional response data")


class ErrorResponse(BaseModel):
    """Generic error response"""
    success: bool = Field(False, description="Operation success status")
    error: str = Field(..., description="Error message")
    detail: Optional[str] = Field(None, description="Detailed error information")