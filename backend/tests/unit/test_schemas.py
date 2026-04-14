"""
Unit tests for app.schemas (Pydantic v2 models).
Covers: valid payloads, missing required fields, bad types, boundary values,
        UUID / datetime format validation.
No database, no network, no external services.
"""
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from app.schemas import (
    BatchMeasurementCreate,
    BatchMeasurementResponse,
    ErrorResponse,
    MeasurementItem,
    RawMeasurementCreate,
    SensorCreate,
    SensorResponse,
    SessionCreate,
    SessionResponse,
    SuccessResponse,
    Token,
    TokenData,
    UserCreate,
    UserOut,
    UserUpdate,
    VehicleCreate,
    VehicleResponse,
)

# ---------------------------------------------------------------------------
# Shared test fixtures
# ---------------------------------------------------------------------------
_UUID = str(uuid4())
_NOW = datetime.now(timezone.utc)
_DT_STR = "2026-02-24T10:30:00Z"

_VALID_MEASUREMENT_ITEM = {
    "measured_at": _DT_STR,
    "latitude": 49.8175,
    "longitude": 15.4730,
    "distance_left": 250.0,
    "distance_right": 380.0,
    "speed": 13.5,
    "accuracy_gps": 2.1,
}


# ===========================================================================
# Auth / Token schemas
# ===========================================================================

class TestTokenSchema:
    """Token: two required string fields."""

    def test_valid(self):
        t = Token(access_token="abc123", token_type="bearer")
        assert t.access_token == "abc123"
        assert t.token_type == "bearer"

    @pytest.mark.parametrize("missing", ["access_token", "token_type"])
    def test_missing_required_field(self, missing):
        data = {"access_token": "abc", "token_type": "bearer"}
        del data[missing]
        with pytest.raises(ValidationError):
            Token(**data)

    def test_wrong_type_raises(self):
        with pytest.raises(ValidationError):
            Token(access_token=123, token_type=None)


class TestTokenDataSchema:
    """TokenData: all fields optional, default to None."""

    def test_empty_is_valid(self):
        td = TokenData()
        assert td.email is None
        assert td.role is None

    def test_with_values(self):
        td = TokenData(email="user@example.com", role="admin")
        assert td.email == "user@example.com"
        assert td.role == "admin"

    def test_partial_is_valid(self):
        td = TokenData(email="x@y.com")
        assert td.email == "x@y.com"
        assert td.role is None


# ===========================================================================
# User schemas
# ===========================================================================

class TestUserCreateSchema:
    """UserCreate: required email + password, optional fields with defaults."""

    def test_valid_minimal(self):
        u = UserCreate(email="a@b.com", password="secret")
        assert u.email == "a@b.com"
        assert u.password == "secret"

    def test_defaults_applied(self):
        u = UserCreate(email="a@b.com", password="pw")
        assert u.role == "dispatcher"
        assert u.is_active is True
        assert u.full_name is None

    def test_all_fields(self):
        u = UserCreate(
            email="admin@b.com",
            password="pw",
            full_name="Jane Doe",
            role="admin",
            is_active=False,
        )
        assert u.role == "admin"
        assert u.full_name == "Jane Doe"
        assert u.is_active is False

    @pytest.mark.parametrize("missing", ["email", "password"])
    def test_missing_required_field(self, missing):
        data = {"email": "a@b.com", "password": "pw"}
        del data[missing]
        with pytest.raises(ValidationError):
            UserCreate(**data)


class TestUserUpdateSchema:
    """UserUpdate: every field is Optional — empty update must be valid."""

    def test_empty_update_is_valid(self):
        u = UserUpdate()
        assert u.email is None
        assert u.full_name is None
        assert u.role is None
        assert u.is_active is None
        assert u.password is None

    def test_partial_update(self):
        u = UserUpdate(role="admin", is_active=False)
        assert u.role == "admin"
        assert u.is_active is False
        assert u.email is None

    def test_all_fields(self):
        u = UserUpdate(
            email="new@email.com",
            full_name="New Name",
            role="dispatcher",
            is_active=True,
            password="newpw",
        )
        assert u.email == "new@email.com"
        assert u.password == "newpw"


class TestUserOutSchema:
    """UserOut: ORM-compatible read model with required id, email, role, is_active."""

    def test_valid(self):
        u = UserOut(id=1, email="a@b.com", full_name="John", role="admin", is_active=True)
        assert u.id == 1
        assert u.full_name == "John"

    def test_full_name_can_be_none(self):
        u = UserOut(id=2, email="a@b.com", full_name=None, role="user", is_active=True)
        assert u.full_name is None

    @pytest.mark.parametrize("missing", ["id", "email", "role", "is_active"])
    def test_missing_required_field(self, missing):
        data = {
            "id": 1, "email": "a@b.com", "full_name": None,
            "role": "admin", "is_active": True,
        }
        del data[missing]
        with pytest.raises(ValidationError):
            UserOut(**data)

    def test_wrong_type_for_id(self):
        with pytest.raises(ValidationError):
            UserOut(id="not-an-int", email="a@b.com", role="admin", is_active=True)


# ===========================================================================
# Vehicle schemas
# ===========================================================================

class TestVehicleCreateSchema:
    """VehicleCreate: vehicle_name (1–100 chars), width (gt=0)."""

    def test_valid(self):
        v = VehicleCreate(vehicle_name="Truck A", width=200.5)
        assert v.vehicle_name == "Truck A"
        assert v.width == 200.5

    # --- vehicle_name boundaries ---

    def test_name_empty_string_invalid(self):
        with pytest.raises(ValidationError):
            VehicleCreate(vehicle_name="", width=100.0)

    def test_name_exactly_1_char_valid(self):
        v = VehicleCreate(vehicle_name="X", width=100.0)
        assert v.vehicle_name == "X"

    def test_name_exactly_100_chars_valid(self):
        v = VehicleCreate(vehicle_name="a" * 100, width=100.0)
        assert len(v.vehicle_name) == 100

    def test_name_101_chars_invalid(self):
        with pytest.raises(ValidationError):
            VehicleCreate(vehicle_name="a" * 101, width=100.0)

    # --- width boundaries ---

    def test_width_zero_invalid(self):
        with pytest.raises(ValidationError):
            VehicleCreate(vehicle_name="Truck", width=0)

    def test_width_negative_invalid(self):
        with pytest.raises(ValidationError):
            VehicleCreate(vehicle_name="Truck", width=-1.0)

    def test_width_very_small_positive_valid(self):
        v = VehicleCreate(vehicle_name="Bike", width=0.001)
        assert v.width == pytest.approx(0.001)

    def test_width_large_value_valid(self):
        v = VehicleCreate(vehicle_name="Wide Load", width=9999.9)
        assert v.width == pytest.approx(9999.9)

    # --- missing required ---

    @pytest.mark.parametrize("missing", ["vehicle_name", "width"])
    def test_missing_required_field(self, missing):
        data = {"vehicle_name": "Truck", "width": 100.0}
        del data[missing]
        with pytest.raises(ValidationError):
            VehicleCreate(**data)


class TestVehicleResponseSchema:
    """VehicleResponse adds a UUID id to VehicleBase."""

    def test_valid_with_uuid(self):
        v = VehicleResponse(id=uuid4(), vehicle_name="Truck", width=200.0)
        assert isinstance(v.id, UUID)

    def test_id_from_string_uuid(self):
        v = VehicleResponse(id=_UUID, vehicle_name="Truck", width=200.0)
        assert isinstance(v.id, UUID)

    def test_invalid_uuid_raises(self):
        with pytest.raises(ValidationError):
            VehicleResponse(id="not-a-uuid", vehicle_name="Truck", width=200.0)


# ===========================================================================
# Sensor schemas
# ===========================================================================

class TestSensorCreateSchema:
    """SensorCreate: both fields optional with defaults."""

    def test_all_defaults(self):
        s = SensorCreate()
        assert s.description is None
        assert s.is_active is True

    def test_explicit_values(self):
        s = SensorCreate(description="Left ultrasonic", is_active=False)
        assert s.description == "Left ultrasonic"
        assert s.is_active is False

    def test_description_can_be_none(self):
        s = SensorCreate(description=None, is_active=True)
        assert s.description is None


class TestSensorResponseSchema:
    """SensorResponse requires id (UUID), created_at, updated_at."""

    def test_valid(self):
        s = SensorResponse(
            id=uuid4(),
            description="Sensor A",
            is_active=True,
            created_at=_NOW,
            updated_at=_NOW,
        )
        assert isinstance(s.id, UUID)
        assert s.is_active is True

    @pytest.mark.parametrize("missing", ["id", "created_at", "updated_at"])
    def test_missing_required_field(self, missing):
        data = {
            "id": uuid4(),
            "description": None,
            "is_active": True,
            "created_at": _NOW,
            "updated_at": _NOW,
        }
        del data[missing]
        with pytest.raises(ValidationError):
            SensorResponse(**data)

    def test_invalid_uuid_raises(self):
        with pytest.raises(ValidationError):
            SensorResponse(
                id="bad-id", is_active=True, created_at=_NOW, updated_at=_NOW
            )

    def test_invalid_datetime_raises(self):
        with pytest.raises(ValidationError):
            SensorResponse(
                id=uuid4(), is_active=True,
                created_at="not-a-datetime", updated_at=_NOW,
            )


# ===========================================================================
# Session schemas
# ===========================================================================

class TestSessionCreateSchema:
    """SessionCreate: both sensor_id and vehicle_id are required UUIDs."""

    def test_valid(self):
        s = SessionCreate(sensor_id=_UUID, vehicle_id=_UUID)
        assert isinstance(s.sensor_id, UUID)
        assert isinstance(s.vehicle_id, UUID)

    @pytest.mark.parametrize("missing", ["sensor_id", "vehicle_id"])
    def test_missing_required_field(self, missing):
        data = {"sensor_id": _UUID, "vehicle_id": _UUID}
        del data[missing]
        with pytest.raises(ValidationError):
            SessionCreate(**data)

    @pytest.mark.parametrize("bad_uuid", [
        "not-a-uuid",
        "12345",
        "",
        "00000000-0000-0000-0000-00000000000Z",
    ])
    def test_invalid_uuid_raises(self, bad_uuid):
        with pytest.raises(ValidationError):
            SessionCreate(sensor_id=bad_uuid, vehicle_id=_UUID)


class TestSessionResponseSchema:
    """SessionResponse: id, sensor_id, vehicle_id — all required UUIDs."""

    def test_valid(self):
        uid = uuid4()
        s = SessionResponse(id=uid, sensor_id=uid, vehicle_id=uid)
        assert isinstance(s.id, UUID)

    @pytest.mark.parametrize("missing", ["id", "sensor_id", "vehicle_id"])
    def test_missing_required_field(self, missing):
        data = {"id": uuid4(), "sensor_id": uuid4(), "vehicle_id": uuid4()}
        del data[missing]
        with pytest.raises(ValidationError):
            SessionResponse(**data)


# ===========================================================================
# Measurement schemas
# ===========================================================================

class TestMeasurementItemSchema:
    """MeasurementItem: 7 required float/datetime fields, no session_id."""

    def test_valid(self):
        m = MeasurementItem(**_VALID_MEASUREMENT_ITEM)
        assert m.latitude == 49.8175
        assert m.speed == 13.5

    @pytest.mark.parametrize("missing", [
        "measured_at", "latitude", "longitude",
        "distance_left", "distance_right", "speed", "accuracy_gps",
    ])
    def test_missing_required_field(self, missing):
        data = _VALID_MEASUREMENT_ITEM.copy()
        del data[missing]
        with pytest.raises(ValidationError):
            MeasurementItem(**data)

    def test_invalid_datetime_format_raises(self):
        data = {**_VALID_MEASUREMENT_ITEM, "measured_at": "not-a-datetime"}
        with pytest.raises(ValidationError):
            MeasurementItem(**data)

    def test_invalid_float_raises(self):
        data = {**_VALID_MEASUREMENT_ITEM, "latitude": "not-a-float"}
        with pytest.raises(ValidationError):
            MeasurementItem(**data)

    def test_negative_floats_accepted(self):
        """Schema imposes no range constraints — negative values are valid."""
        data = {**_VALID_MEASUREMENT_ITEM, "latitude": -90.0, "longitude": -180.0}
        m = MeasurementItem(**data)
        assert m.latitude == -90.0


class TestRawMeasurementCreateSchema:
    """RawMeasurementCreate: MeasurementItem fields + required session_id."""

    def test_valid(self):
        data = {**_VALID_MEASUREMENT_ITEM, "session_id": _UUID}
        m = RawMeasurementCreate(**data)
        assert isinstance(m.session_id, UUID)

    def test_missing_session_id_raises(self):
        with pytest.raises(ValidationError):
            RawMeasurementCreate(**_VALID_MEASUREMENT_ITEM)

    def test_invalid_session_id_raises(self):
        with pytest.raises(ValidationError):
            RawMeasurementCreate(**{**_VALID_MEASUREMENT_ITEM, "session_id": "bad"})


class TestBatchMeasurementCreateSchema:
    """BatchMeasurementCreate: session_id + measurements list (1–10 000)."""

    def test_valid_single_measurement(self):
        b = BatchMeasurementCreate(
            session_id=_UUID,
            measurements=[_VALID_MEASUREMENT_ITEM],
        )
        assert len(b.measurements) == 1
        assert isinstance(b.session_id, UUID)

    def test_valid_multiple_measurements(self):
        b = BatchMeasurementCreate(
            session_id=_UUID,
            measurements=[_VALID_MEASUREMENT_ITEM] * 5,
        )
        assert len(b.measurements) == 5

    def test_empty_measurements_list_invalid(self):
        with pytest.raises(ValidationError):
            BatchMeasurementCreate(session_id=_UUID, measurements=[])

    def test_exceeds_max_10000_invalid(self):
        with pytest.raises(ValidationError):
            BatchMeasurementCreate(
                session_id=_UUID,
                measurements=[_VALID_MEASUREMENT_ITEM] * 10001,
            )

    def test_exactly_10000_measurements_valid(self):
        b = BatchMeasurementCreate(
            session_id=_UUID,
            measurements=[_VALID_MEASUREMENT_ITEM] * 10000,
        )
        assert len(b.measurements) == 10000

    def test_missing_session_id_raises(self):
        with pytest.raises(ValidationError):
            BatchMeasurementCreate(measurements=[_VALID_MEASUREMENT_ITEM])

    def test_invalid_session_id_raises(self):
        with pytest.raises(ValidationError):
            BatchMeasurementCreate(
                session_id="not-a-uuid",
                measurements=[_VALID_MEASUREMENT_ITEM],
            )

    def test_missing_measurements_raises(self):
        with pytest.raises(ValidationError):
            BatchMeasurementCreate(session_id=_UUID)


# ===========================================================================
# Batch response schema
# ===========================================================================

class TestBatchMeasurementResponseSchema:
    """BatchMeasurementResponse: 7 required fields, 2 optional list fields."""

    def _valid(self) -> dict:
        return {
            "success": True,
            "message": "Batch created",
            "batch_id": _UUID,
            "total_received": 5,
            "total_stored": 5,
            "total_invalid": 0,
            "total_rejected": 0,
        }

    def test_valid(self):
        r = BatchMeasurementResponse(**self._valid())
        assert r.success is True
        assert r.batch_id == UUID(_UUID)

    def test_index_lists_default_to_empty(self):
        r = BatchMeasurementResponse(**self._valid())
        assert r.invalid_indices == []
        assert r.rejected_indices == []

    def test_index_lists_can_be_set(self):
        r = BatchMeasurementResponse(
            **self._valid(),
            invalid_indices=[1, 3],
            rejected_indices=[7],
        )
        assert r.invalid_indices == [1, 3]
        assert r.rejected_indices == [7]

    def test_batch_id_is_uuid(self):
        r = BatchMeasurementResponse(**self._valid())
        assert isinstance(r.batch_id, UUID)

    @pytest.mark.parametrize("missing", [
        "success", "message", "batch_id",
        "total_received", "total_stored", "total_invalid", "total_rejected",
    ])
    def test_missing_required_field_raises(self, missing):
        data = self._valid()
        del data[missing]
        with pytest.raises(ValidationError):
            BatchMeasurementResponse(**data)

    def test_invalid_batch_id_raises(self):
        data = {**self._valid(), "batch_id": "not-a-uuid"}
        with pytest.raises(ValidationError):
            BatchMeasurementResponse(**data)


# ===========================================================================
# Generic response schemas
# ===========================================================================

class TestSuccessResponseSchema:
    """SuccessResponse: success defaults True, data optional."""

    def test_valid_minimal(self):
        r = SuccessResponse(message="Done")
        assert r.success is True
        assert r.data is None

    def test_success_flag_can_be_overridden(self):
        r = SuccessResponse(message="Done", success=False)
        assert r.success is False

    def test_with_data(self):
        r = SuccessResponse(message="Done", data={"key": "value", "count": 3})
        assert r.data == {"key": "value", "count": 3}

    def test_missing_message_raises(self):
        with pytest.raises(ValidationError):
            SuccessResponse()


class TestErrorResponseSchema:
    """ErrorResponse: success defaults False, detail optional."""

    def test_valid_minimal(self):
        r = ErrorResponse(error="Something failed")
        assert r.success is False
        assert r.detail is None

    def test_with_detail(self):
        r = ErrorResponse(error="Not found", detail="Resource ID 42 missing")
        assert r.detail == "Resource ID 42 missing"

    def test_success_defaults_false(self):
        r = ErrorResponse(error="err")
        assert r.success is False

    def test_missing_error_raises(self):
        with pytest.raises(ValidationError):
            ErrorResponse()
