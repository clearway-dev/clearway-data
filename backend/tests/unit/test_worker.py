"""
Unit tests for app/worker.py — pure helpers AND process_batch_task.

Helper tests (TestValidate*, TestHaversine*, TestCalculate*, TestApply*, TestMapMatch*)
are DB-free.  process_batch_task tests patch SessionLocal and run the task
synchronously via .run() — no broker, no Redis required.
"""
import math
import types
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.worker import (
    MAX_GPS_ACCURACY,
    BatchNotFoundError,
    _apply_width_median_filter,
    _calculate_heading,
    _haversine_distance_m,
    _map_match,
    _validate_measurement_logic,
    process_batch_task,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_measurement(**kwargs):
    """Return a SimpleNamespace that looks like a valid RawMeasurement row."""
    defaults = dict(
        distance_left=1.5,
        distance_right=1.5,
        latitude=49.75,
        longitude=13.38,
        speed=10.0,
        accuracy_gps=5.0,
    )
    defaults.update(kwargs)
    return types.SimpleNamespace(**defaults)


def _make_row(snapped_lat, snapped_lon, road_heading=None):
    """Return a SimpleNamespace that looks like a PostGIS result row."""
    return types.SimpleNamespace(
        snapped_lat=snapped_lat,
        snapped_lon=snapped_lon,
        road_heading=road_heading,
    )


# ===========================================================================
# _validate_measurement_logic
# ===========================================================================

class TestValidateMeasurementLogic:

    def test_valid_measurement_returns_no_errors(self):
        m = _make_measurement()
        assert _validate_measurement_logic(m) == []

    def test_negative_distance_left(self):
        m = _make_measurement(distance_left=-0.1)
        errors = _validate_measurement_logic(m)
        assert any("distance_left" in e for e in errors)

    def test_negative_distance_right(self):
        m = _make_measurement(distance_right=-1.0)
        errors = _validate_measurement_logic(m)
        assert any("distance_right" in e for e in errors)

    def test_both_distances_zero(self):
        m = _make_measurement(distance_left=0.0, distance_right=0.0)
        errors = _validate_measurement_logic(m)
        assert any("Both distance_left and distance_right are zero" in e for e in errors)

    def test_latitude_too_high(self):
        m = _make_measurement(latitude=91.0)
        errors = _validate_measurement_logic(m)
        assert any("latitude" in e for e in errors)

    def test_latitude_too_low(self):
        m = _make_measurement(latitude=-90.1)
        errors = _validate_measurement_logic(m)
        assert any("latitude" in e for e in errors)

    def test_latitude_boundary_values_are_valid(self):
        assert _validate_measurement_logic(_make_measurement(latitude=49.68)) == []
        assert _validate_measurement_logic(_make_measurement(latitude=49.81)) == []

    def test_latitude_outside_pilsen_is_invalid(self):
        errors = _validate_measurement_logic(_make_measurement(latitude=90.0))
        assert any("latitude" in e for e in errors)

    def test_longitude_out_of_range(self):
        m = _make_measurement(longitude=181.0)
        errors = _validate_measurement_logic(m)
        assert any("longitude" in e for e in errors)

    def test_longitude_boundary_values_are_valid(self):
        assert _validate_measurement_logic(_make_measurement(longitude=13.30)) == []
        assert _validate_measurement_logic(_make_measurement(longitude=13.47)) == []

    def test_longitude_outside_pilsen_is_invalid(self):
        errors = _validate_measurement_logic(_make_measurement(longitude=180.0))
        assert any("longitude" in e for e in errors)

    def test_negative_speed(self):
        m = _make_measurement(speed=-1.0)
        errors = _validate_measurement_logic(m)
        assert any("speed" in e for e in errors)

    def test_none_speed_is_valid(self):
        assert _validate_measurement_logic(_make_measurement(speed=None)) == []

    def test_negative_accuracy_gps(self):
        m = _make_measurement(accuracy_gps=-0.5)
        errors = _validate_measurement_logic(m)
        assert any("accuracy_gps" in e for e in errors)

    def test_accuracy_gps_exceeds_max(self):
        m = _make_measurement(accuracy_gps=MAX_GPS_ACCURACY + 0.1)
        errors = _validate_measurement_logic(m)
        assert any(f"<= {MAX_GPS_ACCURACY}" in e for e in errors)

    def test_accuracy_gps_at_max_is_valid(self):
        assert _validate_measurement_logic(_make_measurement(accuracy_gps=MAX_GPS_ACCURACY)) == []

    def test_none_accuracy_gps_is_valid(self):
        assert _validate_measurement_logic(_make_measurement(accuracy_gps=None)) == []

    def test_multiple_errors_returned(self):
        m = _make_measurement(
            distance_left=-1.0,
            latitude=200.0,
            longitude=-200.0,
        )
        errors = _validate_measurement_logic(m)
        assert len(errors) >= 3


# ===========================================================================
# _haversine_distance_m
# ===========================================================================

class TestHaversineDistanceM:

    def test_same_point_is_zero(self):
        assert _haversine_distance_m(50.0, 14.0, 50.0, 14.0) == pytest.approx(0.0, abs=1e-6)

    def test_result_is_non_negative(self):
        d = _haversine_distance_m(48.8566, 2.3522, 51.5074, -0.1278)
        assert d > 0

    def test_one_degree_latitude_approx_111km(self):
        # Moving 1° latitude from equator along prime meridian
        d = _haversine_distance_m(0.0, 0.0, 1.0, 0.0)
        assert d == pytest.approx(111195, rel=0.01)

    def test_symmetry(self):
        d1 = _haversine_distance_m(50.0, 14.0, 51.0, 15.0)
        d2 = _haversine_distance_m(51.0, 15.0, 50.0, 14.0)
        assert d1 == pytest.approx(d2, rel=1e-9)

    def test_known_prague_brno_distance(self):
        # Prague (50.0755, 14.4378) to Brno (49.1951, 16.6068) ≈ 187 km
        d = _haversine_distance_m(50.0755, 14.4378, 49.1951, 16.6068)
        assert d == pytest.approx(187_000, rel=0.02)


# ===========================================================================
# _calculate_heading
# ===========================================================================

class TestCalculateHeading:

    def test_due_north(self):
        # Moving north: same longitude, higher latitude
        heading = _calculate_heading(50.0, 14.0, 51.0, 14.0)
        assert heading == pytest.approx(0.0, abs=0.1)

    def test_due_south(self):
        heading = _calculate_heading(51.0, 14.0, 50.0, 14.0)
        assert heading == pytest.approx(180.0, abs=0.1)

    def test_due_east(self):
        # Moving east along equator
        heading = _calculate_heading(0.0, 0.0, 0.0, 1.0)
        assert heading == pytest.approx(90.0, abs=0.1)

    def test_due_west(self):
        heading = _calculate_heading(0.0, 1.0, 0.0, 0.0)
        assert heading == pytest.approx(270.0, abs=0.1)

    def test_result_in_range_0_to_360(self):
        for (lat1, lon1, lat2, lon2) in [
            (0.0, 0.0, 1.0, 1.0),
            (10.0, 20.0, -5.0, 30.0),
            (50.0, 14.0, 50.5, 13.5),
        ]:
            h = _calculate_heading(lat1, lon1, lat2, lon2)
            assert 0.0 <= h < 360.0


# ===========================================================================
# _apply_width_median_filter
# ===========================================================================

class TestApplyWidthMedianFilter:

    def test_empty_list_returns_empty(self):
        assert _apply_width_median_filter([]) == []

    def test_single_element_unchanged(self):
        result = _apply_width_median_filter([3.5])
        assert result == pytest.approx([3.5])

    def test_returns_same_length_as_input(self):
        data = [1.0, 2.0, 3.0, 4.0, 5.0]
        result = _apply_width_median_filter(data)
        assert len(result) == len(data)

    def test_filters_out_spike(self):
        # Middle spike should be smoothed by median filter
        data = [3.0, 3.0, 100.0, 3.0, 3.0]
        result = _apply_width_median_filter(data, window=3)
        assert result[2] < 100.0

    def test_even_window_adjusted_to_odd(self):
        # Even window (4) should be bumped to 5 internally — must not raise
        data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]
        result = _apply_width_median_filter(data, window=4)
        assert len(result) == len(data)

    def test_window_larger_than_list_does_not_crash(self):
        data = [1.0, 2.0, 3.0]
        result = _apply_width_median_filter(data, window=10)
        assert len(result) == len(data)

    def test_returns_list_of_floats(self):
        result = _apply_width_median_filter([1, 2, 3, 4, 5])
        assert all(isinstance(v, float) for v in result)

    def test_flat_signal_unchanged(self):
        data = [5.0] * 7
        result = _apply_width_median_filter(data)
        assert result == pytest.approx(data)


# ===========================================================================
# _map_match
# ===========================================================================

class TestMapMatch:

    def _db_with_rows(self, rows):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = rows
        return db

    def test_no_rows_returns_none(self):
        db = self._db_with_rows([])
        assert _map_match(db, 50.0, 14.0) is None

    def test_no_heading_returns_first_row(self):
        rows = [
            _make_row(50.1, 14.1, road_heading=90.0),
            _make_row(50.2, 14.2, road_heading=0.0),
        ]
        db = self._db_with_rows(rows)
        result = _map_match(db, 50.0, 14.0, vehicle_heading=None)
        assert result == (50.1, 14.1)

    def test_heading_selects_aligned_segment(self):
        # Vehicle heading = 90° (East). Second row aligns (road_heading=90), first does not (road_heading=0).
        rows = [
            _make_row(50.1, 14.1, road_heading=0.0),    # diff = 90° → rejected
            _make_row(50.2, 14.2, road_heading=90.0),   # diff = 0° → accepted
        ]
        db = self._db_with_rows(rows)
        result = _map_match(db, 50.0, 14.0, vehicle_heading=90.0)
        assert result == (50.2, 14.2)

    def test_heading_accepts_opposite_direction(self):
        # Bidirectional road: vehicle heading = 0° (North), road heading = 180° (South) → diff = 180° → valid
        rows = [_make_row(50.1, 14.1, road_heading=180.0)]
        db = self._db_with_rows(rows)
        result = _map_match(db, 50.0, 14.0, vehicle_heading=0.0)
        assert result == (50.1, 14.1)

    def test_fallback_to_closest_when_no_candidate_passes(self):
        # Vehicle heading = 0°, all roads are perpendicular (90° diff — neither <= 45 nor >= 135)
        rows = [
            _make_row(50.1, 14.1, road_heading=90.0),
            _make_row(50.2, 14.2, road_heading=270.0),
        ]
        db = self._db_with_rows(rows)
        result = _map_match(db, 50.0, 14.0, vehicle_heading=0.0)
        # Fallback: return closest (first row)
        assert result == (50.1, 14.1)

    def test_skips_rows_with_none_road_heading(self):
        # First row has no heading (skip), second row aligns
        rows = [
            _make_row(50.1, 14.1, road_heading=None),
            _make_row(50.2, 14.2, road_heading=45.0),
        ]
        db = self._db_with_rows(rows)
        result = _map_match(db, 50.0, 14.0, vehicle_heading=45.0)
        assert result == (50.2, 14.2)

    def test_returns_float_tuple(self):
        rows = [_make_row(50.1, 14.1, road_heading=0.0)]
        db = self._db_with_rows(rows)
        result = _map_match(db, 50.0, 14.0)
        assert isinstance(result, tuple)
        assert isinstance(result[0], float)
        assert isinstance(result[1], float)


# ===========================================================================
# process_batch_task
# ===========================================================================
#
# Helpers shared by all task tests.
# ---------------------------------------------------------------------------

_BATCH_ID_STR = "aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb"
_BATCH_UUID = uuid.UUID(_BATCH_ID_STR)

_TS_BASE = datetime(2024, 6, 1, 10, 0, 0, tzinfo=timezone.utc)


def _batch_ns(status="pending"):
    """SimpleNamespace that looks like a Batch ORM row."""
    return types.SimpleNamespace(id=_BATCH_UUID, status=status)


def _valid_measurement_ns(
    id=1,
    lat=49.75,
    lon=13.38,
    dist_left=1.2,
    dist_right=1.3,
    ts=None,
    vehicle_width=2.0,
):
    """SimpleNamespace that looks like a RawMeasurement ORM row (with nested joins)."""
    vehicle = types.SimpleNamespace(width=vehicle_width)
    session_obj = types.SimpleNamespace(vehicle=vehicle)
    batch_obj = types.SimpleNamespace(session=session_obj)
    return types.SimpleNamespace(
        id=id,
        distance_left=dist_left,
        distance_right=dist_right,
        latitude=lat,
        longitude=lon,
        speed=10.0,
        accuracy_gps=5.0,
        is_valid=True,
        measured_at=ts or _TS_BASE,
        batch=batch_obj,
        batch_id=_BATCH_UUID,
    )


def _make_phase0_db(batch):
    """DB mock used for Phase 0 idempotence check (1st SessionLocal call)."""
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = batch
    return db


def _make_main_db(batch, measurements, invalid_rows=None):
    """
    DB mock for the main transaction (2nd SessionLocal call).

    Call order inside process_batch_task:
      1st db.query() → Batch lookup
      2nd db.query() → RawMeasurement with 3 joins
      3rd db.query() → InvalidMeasurement.raw_measurement_id (pre-load)
    """
    if invalid_rows is None:
        invalid_rows = []

    db = MagicMock()
    call_n = [0]

    def _q(arg):
        call_n[0] += 1
        q = MagicMock()
        n = call_n[0]
        if n == 1:
            # Batch lookup
            q.filter.return_value.first.return_value = batch
        elif n == 2:
            # RawMeasurement – 3 joins, then filter, order_by, all
            (
                q.join.return_value
                .join.return_value
                .join.return_value
                .filter.return_value
                .order_by.return_value
                .all.return_value
            ) = measurements
        else:
            # InvalidMeasurement.raw_measurement_id pre-load
            q.filter.return_value.all.return_value = invalid_rows
        return q

    db.query.side_effect = _q
    return db


def _run_task(batch_id, phase0_db, main_db=None):
    """
    Call process_batch_task.run() with patched SessionLocal.
    Returns the task result or re-raises whatever the task raises.
    """
    dbs = [phase0_db] if main_db is None else [phase0_db, main_db]
    with patch("app.worker.SessionLocal") as mock_sl:
        mock_sl.side_effect = dbs
        return process_batch_task.run(batch_id)


# ---------------------------------------------------------------------------
# BatchNotFoundError class
# ---------------------------------------------------------------------------

class TestBatchNotFoundError:

    def test_is_exception_subclass(self):
        assert issubclass(BatchNotFoundError, Exception)

    def test_message_preserved(self):
        err = BatchNotFoundError("missing batch")
        assert "missing batch" in str(err)


# ---------------------------------------------------------------------------
# Phase 0 — idempotence check
# ---------------------------------------------------------------------------

class TestProcessBatchTaskPhase0:

    def test_batch_already_completed_returns_early(self):
        db0 = _make_phase0_db(_batch_ns(status="completed"))
        result = _run_task(_BATCH_ID_STR, db0)
        assert result["status"] == "completed"
        assert result["batch_id"] == _BATCH_ID_STR
        assert "idempotent" in result["message"].lower()

    def test_batch_not_found_raises(self):
        """BatchNotFoundError (wrapped in Celery Retry or propagated raw)."""
        db0 = _make_phase0_db(None)          # first() returns None
        main_db = _make_main_db(_batch_ns(), [])
        with pytest.raises(Exception):       # BatchNotFoundError or Retry
            _run_task(_BATCH_ID_STR, db0, main_db)

    def test_invalid_uuid_raises(self):
        db0 = MagicMock()
        with pytest.raises(Exception):
            _run_task("not-a-valid-uuid", db0)


# ---------------------------------------------------------------------------
# Main transaction — happy paths
# ---------------------------------------------------------------------------

class TestProcessBatchTaskMainTransaction:

    def test_empty_batch_completes_successfully(self):
        batch = _batch_ns()
        db0 = _make_phase0_db(batch)
        db1 = _make_main_db(batch, measurements=[])

        result = _run_task(_BATCH_ID_STR, db0, db1)

        assert result["status"] == "completed"
        assert result["batch_id"] == _BATCH_ID_STR
        assert result["processed"] == 0
        assert result["cleaned"] == 0
        assert result["invalid"] == 0
        assert result["unmatched"] == 0

    def test_empty_batch_commits(self):
        batch = _batch_ns()
        db0 = _make_phase0_db(batch)
        db1 = _make_main_db(batch, measurements=[])

        _run_task(_BATCH_ID_STR, db0, db1)

        db1.commit.assert_called_once()

    def test_empty_batch_sets_status_completed(self):
        batch = _batch_ns()
        db0 = _make_phase0_db(batch)
        main_batch = _batch_ns()
        db1 = _make_main_db(main_batch, measurements=[])

        _run_task(_BATCH_ID_STR, db0, db1)

        assert main_batch.status == "completed"


# ---------------------------------------------------------------------------
# Phase 1 — logical validation inside the task
# ---------------------------------------------------------------------------

class TestProcessBatchTaskPhase1:

    def test_invalid_measurement_increments_invalid_count(self):
        batch = _batch_ns()
        bad_m = _valid_measurement_ns(dist_left=-1.0)   # triggers distance_left error

        db0 = _make_phase0_db(batch)
        db1 = _make_main_db(batch, measurements=[bad_m])

        result = _run_task(_BATCH_ID_STR, db0, db1)

        assert result["invalid"] == 1
        assert result["cleaned"] == 0

    def test_invalid_measurement_marks_is_valid_false(self):
        batch = _batch_ns()
        bad_m = _valid_measurement_ns(dist_left=-5.0)

        db0 = _make_phase0_db(batch)
        db1 = _make_main_db(batch, measurements=[bad_m])
        _run_task(_BATCH_ID_STR, db0, db1)

        assert bad_m.is_valid is False

    def test_valid_measurement_passes_phase1(self):
        batch = _batch_ns()
        good_m = _valid_measurement_ns()

        db0 = _make_phase0_db(batch)
        db1 = _make_main_db(batch, measurements=[good_m])

        # patch _map_match so phase 2 doesn't need PostGIS
        with patch("app.worker._map_match", return_value=None), \
             patch("app.worker.from_shape", return_value=MagicMock()):
            result = _run_task(_BATCH_ID_STR, db0, db1)

        # passes phase 1 but fails map-match → unmatched, not cleaned
        assert result["invalid"] == 1      # unmatched counts as invalid
        assert result["unmatched"] == 1

    def test_already_existing_invalid_id_not_duplicated(self):
        """If raw_measurement_id already in invalid_measurements, don't re-insert."""
        batch = _batch_ns()
        bad_m = _valid_measurement_ns(id=42, dist_left=-1.0)

        existing = [types.SimpleNamespace(raw_measurement_id=42)]

        db0 = _make_phase0_db(batch)
        db1 = _make_main_db(batch, measurements=[bad_m], invalid_rows=existing)
        result = _run_task(_BATCH_ID_STR, db0, db1)

        # invalid count still goes up, but no new insert
        assert result["invalid"] == 1
        db1.bulk_save_objects.assert_not_called()


# ---------------------------------------------------------------------------
# Phase 2 — map-matching inside the task
# ---------------------------------------------------------------------------

class TestProcessBatchTaskPhase2:

    def test_map_match_success_creates_cleaned_record(self):
        batch = _batch_ns()
        good_m = _valid_measurement_ns()

        db0 = _make_phase0_db(batch)
        db1 = _make_main_db(batch, measurements=[good_m])

        with patch("app.worker._map_match", return_value=(50.076, 14.438)), \
             patch("app.worker.from_shape", return_value=MagicMock()):
            result = _run_task(_BATCH_ID_STR, db0, db1)

        assert result["cleaned"] == 1
        assert result["unmatched"] == 0
        db1.bulk_save_objects.assert_called()

    def test_map_match_failure_counts_unmatched(self):
        batch = _batch_ns()
        good_m = _valid_measurement_ns()

        db0 = _make_phase0_db(batch)
        db1 = _make_main_db(batch, measurements=[good_m])

        with patch("app.worker._map_match", return_value=None):
            result = _run_task(_BATCH_ID_STR, db0, db1)

        assert result["unmatched"] == 1
        assert result["cleaned"] == 0

    def test_heading_calculated_for_consecutive_measurements(self):
        """Second measurement should get a heading calculated from the first."""
        batch = _batch_ns()
        m1 = _valid_measurement_ns(id=1, lat=49.75, lon=13.38, ts=_TS_BASE)
        # Points ~7 m apart in 1 s → 7 m/s << MAX_REALISTIC_SPEED_MPS (40)
        m2 = _valid_measurement_ns(
            id=2, lat=49.75005, lon=13.38005,
            ts=datetime(2024, 6, 1, 10, 0, 1, tzinfo=timezone.utc),
        )

        db0 = _make_phase0_db(batch)
        db1 = _make_main_db(batch, measurements=[m1, m2])

        captured_headings: list = []
        call_n = [0]

        def _fake_map_match(db, lat, lon, vehicle_heading=None, **kw):
            captured_headings.append(vehicle_heading)
            call_n[0] += 1
            # First call succeeds so prev_measurement is updated;
            # second call can return None.
            return (lat + 0.001, lon + 0.001) if call_n[0] == 1 else None

        with patch("app.worker._map_match", side_effect=_fake_map_match), \
             patch("app.worker.from_shape", return_value=MagicMock()):
            _run_task(_BATCH_ID_STR, db0, db1)

        # First measurement: no previous point → heading is None
        assert captured_headings[0] is None
        # Second measurement: prev_measurement was set → heading is computed
        assert captured_headings[1] is not None

    def test_two_valid_measurements_median_filter_applied(self):
        """With 2 matched measurements the median filter must not crash."""
        batch = _batch_ns()
        m1 = _valid_measurement_ns(id=1, ts=_TS_BASE)
        m2 = _valid_measurement_ns(
            id=2, ts=datetime(2024, 6, 1, 10, 0, 2, tzinfo=timezone.utc),
        )

        db0 = _make_phase0_db(batch)
        db1 = _make_main_db(batch, measurements=[m1, m2])

        with patch("app.worker._map_match", return_value=(50.076, 14.438)), \
             patch("app.worker.from_shape", return_value=MagicMock()):
            result = _run_task(_BATCH_ID_STR, db0, db1)

        assert result["cleaned"] == 2
