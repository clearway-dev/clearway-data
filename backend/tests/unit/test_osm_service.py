"""
Unit tests for app/osm_service.py — OSMService class.

osmnx network calls are patched; no real HTTP requests or DB connections needed.
"""
import types
from unittest.mock import MagicMock, call, patch

import pytest

from app.osm_service import OSMService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_edge_row(u=1, v=2, key=0, name="Main St", highway="residential", geom=None):
    """Simulate a single row from gdf_edges.iterrows()."""
    row = MagicMock()
    row.__getitem__ = lambda self, k: {
        "u": u, "v": v, "key": key, "geometry": geom or MagicMock()
    }[k]
    row.get = lambda k, default=None: {
        "name": name, "highway": highway
    }.get(k, default)
    return row


def _make_gdf(rows):
    """Return a mock GeoDataFrame whose iterrows() yields the given rows."""
    gdf = MagicMock()
    gdf.reset_index.return_value = gdf
    gdf.__len__ = lambda self: len(rows)
    gdf.iterrows.return_value = iter(enumerate(rows))
    return gdf


def _service_with_mock_db():
    db = MagicMock()
    return OSMService(db=db), db


# ---------------------------------------------------------------------------
# __init__
# ---------------------------------------------------------------------------

class TestOSMServiceInit:

    def test_db_stored(self):
        db = MagicMock()
        svc = OSMService(db=db)
        assert svc.db is db


# ---------------------------------------------------------------------------
# import_segments_for_place
# ---------------------------------------------------------------------------

class TestImportSegmentsForPlace:

    def _run(self, rows, place="TestPlace"):
        """Patch osmnx and from_shape, run import, return (service, db)."""
        svc, db = _service_with_mock_db()
        gdf = _make_gdf(rows)

        with patch("app.osm_service.ox.graph_from_place") as mock_graph, \
             patch("app.osm_service.ox.graph_to_gdfs", return_value=(MagicMock(), gdf)), \
             patch("app.osm_service.from_shape", return_value=MagicMock()):
            svc.import_segments_for_place(place)

        return svc, db

    def test_no_edges_commits_once(self):
        _, db = self._run([])
        db.commit.assert_called_once()

    def test_single_edge_merges_one_segment(self):
        _, db = self._run([_make_edge_row()])
        db.merge.assert_called_once()

    def test_single_edge_commits_once(self):
        _, db = self._run([_make_edge_row()])
        db.commit.assert_called_once()

    def test_osm_id_format(self):
        """Segment osm_id must be 'u-v-key'."""
        svc, db = _service_with_mock_db()
        row = _make_edge_row(u=100, v=200, key=3)
        gdf = _make_gdf([row])

        captured = []
        db.merge.side_effect = captured.append

        with patch("app.osm_service.ox.graph_from_place"), \
             patch("app.osm_service.ox.graph_to_gdfs", return_value=(MagicMock(), gdf)), \
             patch("app.osm_service.from_shape", return_value=MagicMock()):
            svc.import_segments_for_place()

        assert captured[0].osm_id == "100-200-3"

    def test_name_list_uses_first_element(self):
        """If 'name' is a list, only the first element is used."""
        svc, db = _service_with_mock_db()
        row = _make_edge_row(name=["Alpha St", "Beta St"])
        gdf = _make_gdf([row])

        captured = []
        db.merge.side_effect = captured.append

        with patch("app.osm_service.ox.graph_from_place"), \
             patch("app.osm_service.ox.graph_to_gdfs", return_value=(MagicMock(), gdf)), \
             patch("app.osm_service.from_shape", return_value=MagicMock()):
            svc.import_segments_for_place()

        assert captured[0].name == "Alpha St"

    def test_none_name_becomes_unknown(self):
        row = _make_edge_row(name=None)
        svc, db = _service_with_mock_db()
        gdf = _make_gdf([row])

        captured = []
        db.merge.side_effect = captured.append

        with patch("app.osm_service.ox.graph_from_place"), \
             patch("app.osm_service.ox.graph_to_gdfs", return_value=(MagicMock(), gdf)), \
             patch("app.osm_service.from_shape", return_value=MagicMock()):
            svc.import_segments_for_place()

        assert captured[0].name == "Unknown"

    def test_highway_list_uses_first_element(self):
        svc, db = _service_with_mock_db()
        row = _make_edge_row(highway=["primary", "secondary"])
        gdf = _make_gdf([row])

        captured = []
        db.merge.side_effect = captured.append

        with patch("app.osm_service.ox.graph_from_place"), \
             patch("app.osm_service.ox.graph_to_gdfs", return_value=(MagicMock(), gdf)), \
             patch("app.osm_service.from_shape", return_value=MagicMock()):
            svc.import_segments_for_place()

        assert captured[0].road_type == "primary"

    def test_intermediate_commit_every_1000(self):
        """An intermediate db.commit() must happen after every 1000 segments."""
        rows = [_make_edge_row(u=i, v=i + 1, key=0) for i in range(1001)]
        _, db = self._run(rows)
        # 1 intermediate commit at count==1000, plus 1 final commit = 2 total
        assert db.commit.call_count == 2

    def test_exactly_1000_edges_two_commits(self):
        rows = [_make_edge_row(u=i, v=i + 1, key=0) for i in range(1000)]
        _, db = self._run(rows)
        assert db.commit.call_count == 2

    def test_999_edges_one_commit(self):
        rows = [_make_edge_row(u=i, v=i + 1, key=0) for i in range(999)]
        _, db = self._run(rows)
        assert db.commit.call_count == 1

    def test_default_place_name_is_plzen(self):
        """Default argument must be 'Plzeň, Czechia'."""
        svc, db = _service_with_mock_db()
        gdf = _make_gdf([])

        with patch("app.osm_service.ox.graph_from_place") as mock_graph, \
             patch("app.osm_service.ox.graph_to_gdfs", return_value=(MagicMock(), gdf)), \
             patch("app.osm_service.from_shape", return_value=MagicMock()):
            svc.import_segments_for_place()
            mock_graph.assert_called_once_with("Plzeň, Czechia", network_type="drive")
