"""
SQLAlchemy models matching the ClearWay database schema.
Models correspond exactly to tables defined in db_schema.sql
"""
from datetime import datetime
from sqlalchemy import Column, String, Float, Boolean, ForeignKey, BigInteger, Double, DateTime, Text, Date, Integer, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from geoalchemy2 import Geometry
import uuid

# Import Base from database configuration
from .database import Base


class Sensor(Base):
    """Vehicle-mounted sensors collecting road width measurements"""
    __tablename__ = "sensors"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()"))
    description: Mapped[str] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.current_timestamp())

    # Relationships
    sessions = relationship("Session", back_populates="sensor")


class Vehicle(Base):
    """Vehicles used for measurement collection"""
    __tablename__ = "vehicles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()"))
    vehicle_name: Mapped[str] = mapped_column(String(100), nullable=False)
    width: Mapped[float] = mapped_column(Float, nullable=False)

    # Relationships
    sessions = relationship("Session", back_populates="vehicle")


class Session(Base):
    """Measurement collection sessions from sensors"""
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()"))
    sensor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sensors.id", ondelete="CASCADE"), nullable=False)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False)

    # Relationships
    sensor = relationship("Sensor", back_populates="sessions")
    vehicle = relationship("Vehicle", back_populates="sessions")
    raw_measurements = relationship("RawMeasurement", back_populates="session")


class RawMeasurement(Base):
    """Raw unprocessed sensor measurements"""
    __tablename__ = "raw_measurements"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.current_timestamp())
    latitude: Mapped[float] = mapped_column(Double, nullable=False)
    longitude: Mapped[float] = mapped_column(Double, nullable=False)
    distance_left: Mapped[float] = mapped_column(Float, nullable=False)
    distance_right: Mapped[float] = mapped_column(Float, nullable=False)
    is_valid: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.current_timestamp())

    # Relationships
    session = relationship("Session", back_populates="raw_measurements")
    cleaned_measurement = relationship("CleanedMeasurement", back_populates="raw_measurement", uselist=False)
    invalid_measurement = relationship("InvalidMeasurement", back_populates="raw_measurement", uselist=False)


class RoadSegment(Base):
    """Road segments from OpenStreetMap"""
    __tablename__ = "road_segments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()"))
    osm_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=True)
    road_type: Mapped[str] = mapped_column(String(50), nullable=True)
    geom = Column(Geometry(geometry_type='LINESTRING', srid=4326), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.current_timestamp())

    # Relationships
    clusters = relationship("Cluster", back_populates="road_segment")
    statistics = relationship("SegmentStatistic", back_populates="segment")


class Cluster(Base):
    """Aggregated measurements grouped by location"""
    __tablename__ = "clusters"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()"))
    road_segment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("road_segments.id", ondelete="SET NULL"), nullable=True)
    avg_width: Mapped[float] = mapped_column(Float, nullable=False)
    min_width: Mapped[float] = mapped_column(Float, nullable=False)
    max_width: Mapped[float] = mapped_column(Float, nullable=False)
    geom = Column(Geometry(geometry_type='POINT', srid=4326), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.current_timestamp())

    # Relationships
    road_segment = relationship("RoadSegment", back_populates="clusters")
    cleaned_measurements = relationship("CleanedMeasurement", back_populates="cluster")


class CleanedMeasurement(Base):
    """Validated and processed measurements"""
    __tablename__ = "cleaned_measurements"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    raw_measurement_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("raw_measurements.id", ondelete="CASCADE"), nullable=False)
    cleaned_width: Mapped[float] = mapped_column(Float, nullable=False)
    quality_score: Mapped[float] = mapped_column(Float, nullable=True)
    cluster_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="SET NULL"), nullable=True)
    geom = Column(Geometry(geometry_type='POINT', srid=4326), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.current_timestamp())

    # Relationships
    raw_measurement = relationship("RawMeasurement", back_populates="cleaned_measurement")
    cluster = relationship("Cluster", back_populates="cleaned_measurements")


class InvalidMeasurement(Base):
    """Rejected measurements with reasons"""
    __tablename__ = "invalid_measurements"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    raw_measurement_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("raw_measurements.id", ondelete="CASCADE"), nullable=False)
    rejection_reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.current_timestamp())

    # Relationships
    raw_measurement = relationship("RawMeasurement", back_populates="invalid_measurement")


class SegmentStatistic(Base):
    """Daily statistics for road segments"""
    __tablename__ = "segment_statistics"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()"))
    segment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("road_segments.id", ondelete="CASCADE"), nullable=False)
    stat_date: Mapped[datetime] = mapped_column(Date, nullable=False)
    avg_width: Mapped[float] = mapped_column(Float, nullable=True)
    min_width: Mapped[float] = mapped_column(Float, nullable=True)
    max_width: Mapped[float] = mapped_column(Float, nullable=True)
    measurements_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.current_timestamp())

    # Relationships
    segment = relationship("RoadSegment", back_populates="statistics")


class TargetVehicle(Base):
    """IZS and other vehicles whose road passability is evaluated"""
    __tablename__ = "target_vehicles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=True)
    width: Mapped[float] = mapped_column(Float, nullable=True)
    height: Mapped[float] = mapped_column(Float, nullable=True)
    weight: Mapped[float] = mapped_column(Float, nullable=True)
    length: Mapped[float] = mapped_column(Float, nullable=True)
    turning_diameter_track: Mapped[float] = mapped_column(Float, nullable=True)
    turning_diameter_clearance: Mapped[float] = mapped_column(Float, nullable=True)
    stabilization_width: Mapped[float] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.current_timestamp())


class Station(Base):
    """Emergency service dispatch stations (fire, police, ambulance)"""
    __tablename__ = "stations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=True)
    address: Mapped[str] = mapped_column(String(500), nullable=True)
    lat: Mapped[float] = mapped_column(Double, nullable=False)
    lon: Mapped[float] = mapped_column(Double, nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.current_timestamp())