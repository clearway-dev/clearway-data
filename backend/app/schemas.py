"""
Pydantic schemas for request/response validation.
Provides strict validation for incoming data from mobile app and responses to frontend.
"""
from pydantic import BaseModel, Field, field_validator
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID


# ==============================================
# VEHICLE SCHEMAS
# ==============================================

class VehicleBase(BaseModel):
    """Base schema for vehicle data"""
    vehicle_name: str = Field(..., min_length=1, max_length=100, description="Vehicle name/identifier")
    width: float = Field(..., gt=0, description="Vehicle width in centimeters")


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

class RawMeasurementCreateLax(BaseModel):
    """
    Lax schema for receiving raw measurement data from mobile app.
    No strict validation - allows storing invalid data with is_valid=false.
    """
    session_id: UUID = Field(..., description="ID of the measurement session")
    measured_at: datetime = Field(..., description="Exact timestamp when measurement was taken")
    latitude: float = Field(..., description="Latitude in decimal degrees")
    longitude: float = Field(..., description="Longitude in decimal degrees")
    distance_left: float = Field(..., description="Distance to left obstacle in centimeters")
    distance_right: float = Field(..., description="Distance to right obstacle in centimeters")


class RawMeasurementCreate(BaseModel):
    """
    Schema for receiving raw measurement data from mobile app.
    Includes strict validation for GPS coordinates and distance measurements.
    """
    session_id: UUID = Field(..., description="ID of the measurement session")
    measured_at: datetime = Field(..., description="Exact timestamp when measurement was taken")
    
    # GPS validation World - coordinates must be within valid ranges 
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Latitude in decimal degrees")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Longitude in decimal degrees")

    # # GPS validation Europe - coordinates must be within valid ranges 
    # latitude: float = Field(..., ge=34.0, le=81.0, description="Latitude in decimal degrees")
    # longitude: float = Field(..., ge=-25, le=40, description="Longitude in decimal degrees")

    # # GPS validation Czech Republic - coordinates must be within valid ranges 
    # latitude: float = Field(..., ge=48.5, le=51.1, description="Latitude in decimal degrees")
    # longitude: float = Field(..., ge=12.0, le=18.9, description="Longitude in decimal degrees")

    # # GPS validation Pilsen - coordinates must be within valid ranges 
    # latitude: float = Field(..., ge=49.6, le=50.1, description="Latitude in decimal degrees")
    # longitude: float = Field(..., ge=12.8, le=13.5, description="Longitude in decimal degrees")
    
    # Distance validation - must be non-negative
    distance_left: float = Field(..., ge=0, description="Distance to left obstacle in centimeters")
    distance_right: float = Field(..., ge=0, description="Distance to right obstacle in centimeters")

    @field_validator('measured_at')
    @classmethod
    def validate_timestamp(cls, v: datetime) -> datetime:
        """Validate that timestamp is not from the future (with 5 min tolerance for clock skew)"""
        now = datetime.now(timezone.utc)
        # Allow 5 minutes tolerance for clock synchronization issues
        max_allowed = now + timedelta(minutes=5)
        
        # Make timestamp timezone-aware if it isn't
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        
        if v > max_allowed:
            raise ValueError(f'Timestamp cannot be from the future. Current time: {now.isoformat()}, received: {v.isoformat()}')
        return v

    @field_validator('distance_left', 'distance_right')
    @classmethod
    def validate_distances(cls, v: float) -> float:
        """Additional validation: distances should be reasonable (< 150m)"""
        if v > 15000.0:  # 150m 
            raise ValueError('Distance measurement seems unrealistic (> 150m)')
        return v
    
    class Config:
        json_schema_extra = {
            "example": {
                "session_id": "550e8400-e29b-41d4-a716-446655440000",
                "measured_at": "2026-02-24T10:30:00.000Z",
                "latitude": 49.8175,
                "longitude": 15.4730,
                "distance_left": 250,
                "distance_right": 380
            }
        }


def validate_measurement_data(data: RawMeasurementCreateLax) -> tuple[bool, str | None]:
    """
    Manually validate measurement data and return validation status.
    
    Returns:
        tuple[bool, str | None]: (is_valid, error_message)
    """
    errors = []
    
    # Validate GPS coordinates
    if not (-90.0 <= data.latitude <= 90.0):
        errors.append(f"Invalid latitude: {data.latitude} (must be between -90 and 90)")
    
    if not (-180.0 <= data.longitude <= 180.0):
        errors.append(f"Invalid longitude: {data.longitude} (must be between -180 and 180)")
    
    # Validate distances
    if data.distance_left < 0:
        errors.append(f"Invalid distance_left: {data.distance_left} (must be >= 0)")
    
    if data.distance_right < 0:
        errors.append(f"Invalid distance_right: {data.distance_right} (must be >= 0)")
    
    if data.distance_left > 15000.0:
        errors.append(f"Unrealistic distance_left: {data.distance_left} cm (> 150m)")
    
    if data.distance_right > 15000.0:
        errors.append(f"Unrealistic distance_right: {data.distance_right} cm (> 150m)")
    
    # Validate timestamp
    now = datetime.now(timezone.utc)
    max_allowed = now + timedelta(minutes=5)
    measured_at = data.measured_at
    
    if measured_at.tzinfo is None:
        measured_at = measured_at.replace(tzinfo=timezone.utc)
    
    if measured_at > max_allowed:
        errors.append(f"Timestamp from future: {measured_at.isoformat()} (current: {now.isoformat()})")
    
    if errors:
        return False, "; ".join(errors)
    
    return True, None


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

class MeasurementItem(BaseModel):
    """
    Single measurement item for batch upload (without session_id).
    Used in offline-first architecture where mobile app collects data and sends in batches.
    """
    measured_at: datetime = Field(..., description="Exact timestamp when measurement was taken")
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Latitude in decimal degrees")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Longitude in decimal degrees")
    distance_left: float = Field(..., ge=0, description="Distance to left obstacle in centimeters")
    distance_right: float = Field(..., ge=0, description="Distance to right obstacle in centimeters")
    
    @field_validator('measured_at')
    @classmethod
    def validate_timestamp(cls, v: datetime) -> datetime:
        """Validate that timestamp is not from the future (with 5 min tolerance for clock skew)"""
        now = datetime.now(timezone.utc)
        max_allowed = now + timedelta(minutes=5)
        
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        
        if v > max_allowed:
            raise ValueError(f'Timestamp cannot be from the future')
        return v
    
    @field_validator('distance_left', 'distance_right')
    @classmethod
    def validate_distances(cls, v: float) -> float:
        """Additional validation: distances should be reasonable (< 150m)"""
        if v > 15000.0:  # 150m in cm
            raise ValueError(f'Distance measurement seems unrealistic (> 150m)')
        return v


class MeasurementItemLax(BaseModel):
    """
    Single measurement item without strict validation for batch upload.
    Allows storing invalid data with is_valid=false flag.
    """
    measured_at: datetime = Field(..., description="Exact timestamp when measurement was taken")
    latitude: float = Field(..., description="Latitude in decimal degrees")
    longitude: float = Field(..., description="Longitude in decimal degrees")
    distance_left: float = Field(..., description="Distance to left obstacle in centimeters")
    distance_right: float = Field(..., description="Distance to right obstacle in centimeters")


class BatchMeasurementCreate(BaseModel):
    """
    Schema for receiving multiple measurements at once from mobile app.
    This is the PRIMARY endpoint for offline-first mobile architecture.
    
    Mobile app collects measurements offline and sends them in one batch.
    """
    session_id: UUID = Field(..., description="ID of the measurement session")
    measurements: list[MeasurementItem] = Field(
        ..., 
        min_length=1, 
        max_length=10000, 
        description="List of measurements (max 10,000 per batch)"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "session_id": "550e8400-e29b-41d4-a716-446655440000",
                "measurements": [
                    {
                        "measured_at": "2026-02-24T10:30:00.000Z",
                        "latitude": 49.8175,
                        "longitude": 15.4730,
                        "distance_left": 250,
                        "distance_right": 380
                    },
                    {
                        "measured_at": "2026-02-24T10:30:01.000Z",
                        "latitude": 49.8176,
                        "longitude": 15.4731,
                        "distance_left": 255,
                        "distance_right": 385
                    }
                ]
            }
        }


class BatchMeasurementCreateLax(BaseModel):
    """
    Schema for receiving multiple measurements with lax validation.
    Accepts all data and marks invalid entries with is_valid=false.
    """
    session_id: UUID = Field(..., description="ID of the measurement session")
    measurements: list[MeasurementItemLax] = Field(
        ..., 
        min_length=1, 
        max_length=10000, 
        description="List of measurements (max 10,000 per batch)"
    )


class BatchMeasurementResponse(BaseModel):
    """Response for batch measurement upload"""
    success: bool = Field(..., description="Overall success status")
    message: str = Field(..., description="Summary message")
    total_received: int = Field(..., description="Total measurements received")
    total_stored: int = Field(..., description="Total measurements successfully stored")
    total_invalid: int = Field(..., description="Total measurements marked as invalid")
    total_rejected: int = Field(..., description="Total measurements rejected (DB constraint violations)")
    invalid_indices: list[int] = Field(default_factory=list, description="Indices of invalid measurements")
    rejected_indices: list[int] = Field(default_factory=list, description="Indices of rejected measurements")


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