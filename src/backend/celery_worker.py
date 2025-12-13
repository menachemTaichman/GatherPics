"""
Celery worker configuration for background task processing.
Uses Redis as both broker and result backend.
"""

import os
from celery import Celery

# Load environment variables from .env file if it exists (development only)
if os.path.exists('.env'):
    from dotenv import load_dotenv
    load_dotenv()

# Get Redis URL from environment (defaults to localhost for development)
REDIS_HOST = os.getenv('REDIS_HOST', 'redis')
REDIS_PORT = os.getenv('REDIS_PORT', '6379')
REDIS_DB = os.getenv('REDIS_DB', '0')
REDIS_URL = f"redis://{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}"

# Create Celery app
celery = Celery(
    'photo_app',
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=['src.backend.tasks']
)

# Celery configuration
celery.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='Asia/Jerusalem',
    enable_utc=True,
    task_track_started=True,
    task_time_limit=300,  # 5 minutes max per task
    task_soft_time_limit=240,  # 4 minutes soft limit
    worker_prefetch_multiplier=1,  # Process one task at a time per worker
    worker_max_tasks_per_child=50,  # Restart worker after 50 tasks to prevent memory leaks
)

if __name__ == '__main__':
    celery.start()

