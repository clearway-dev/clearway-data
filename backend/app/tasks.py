"""
Celery task definitions for asynchronous batch processing.
"""
import os
from celery import Celery

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://redis:6379/0")

celery_app = Celery(
    "clearway",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
)


@celery_app.task(name="process_batch_task")
def process_batch_task(inserted_ids: list[int]) -> dict:
    """
    Placeholder async task for post-processing inserted raw measurements.
    Business/logical validation will be implemented here later.
    """
    return {
        "status": "queued",
        "count": len(inserted_ids),
        "inserted_ids": inserted_ids,
    }
