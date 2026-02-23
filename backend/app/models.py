from datetime import datetime
from pydantic import BaseModel, Field
from sqlalchemy import Column, String, Float, Boolean, ForeignKey, BigInteger, Double, DateTime, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from geoalchemy2 import Geometry
import uuid


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
    


class Base(DeclarativeBase):
    pass

class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()"))
    vehicle_name: Mapped[str] = mapped_column(String(100), nullable=False)
    width: Mapped[float] = mapped_column(Float, nullable=False)

class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()"))
    sensor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sensors.id", ondelete="CASCADE"), nullable=False)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False)

class RawMeasurement(Base):
    __tablename__ = "raw_measurements"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    measured_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    latitude: Mapped[float] = mapped_column(Double, nullable=False)
    longitude: Mapped[float] = mapped_column(Double, nullable=False)
    distance_left: Mapped[float] = mapped_column(Float, nullable=False)
    distance_right: Mapped[float] = mapped_column(Float, nullable=False)
    is_valid: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class CleanedMeasurement(Base):
    """Ukázka pro budoucí Fázi 4 s využitím PostGIS"""
    __tablename__ = "cleaned_measurements"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    raw_measurement_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("raw_measurements.id", ondelete="CASCADE"), nullable=False)
    cleaned_width: Mapped[float] = mapped_column(Float, nullable=False)
    quality_score: Mapped[float] = mapped_column(Float, nullable=True)
    cluster_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="SET NULL"), nullable=True)
    # Zde je klíčová integrace PostGIS přes GeoAlchemy2
    geom = Column(Geometry(geometry_type='POINT', srid=4326), nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())