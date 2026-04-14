"""
Unit tests for app/tasks.py — the Celery placeholder task.

The task function is called directly (bypassing Celery broker) using
Celery's .run() or by calling the underlying function directly via __wrapped__
or by calling the task object itself (Celery tasks are callable).
"""
import pytest

from app.tasks import process_batch_task


class TestProcessBatchTask:
    """Tests for the process_batch_task placeholder."""

    def _call(self, inserted_ids):
        """Call the underlying Python function, bypassing Celery."""
        return process_batch_task(inserted_ids)

    def test_returns_queued_status(self):
        result = self._call([1, 2, 3])
        assert result["status"] == "queued"

    def test_count_matches_list_length(self):
        ids = [10, 20, 30, 40, 50]
        result = self._call(ids)
        assert result["count"] == len(ids)

    def test_inserted_ids_preserved(self):
        ids = [7, 14, 21]
        result = self._call(ids)
        assert result["inserted_ids"] == ids

    def test_empty_list(self):
        result = self._call([])
        assert result["status"] == "queued"
        assert result["count"] == 0
        assert result["inserted_ids"] == []

    def test_single_element(self):
        result = self._call([99])
        assert result["count"] == 1
        assert result["inserted_ids"] == [99]

    def test_result_has_required_keys(self):
        result = self._call([1])
        assert set(result.keys()) == {"status", "count", "inserted_ids"}
