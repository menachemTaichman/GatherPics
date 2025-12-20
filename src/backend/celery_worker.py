"""
Celery worker configuration for background task processing.
Uses Redis as both broker and result backend.
"""

import os
import logging
from celery import Celery
from celery.schedules import crontab

# Load environment variables from .env file if it exists (development only)
if os.path.exists('.env'):
    from dotenv import load_dotenv
    load_dotenv()

# Define VERBOSE logging level (15) between DEBUG (10) and INFO (20)
VERBOSE = 15
logging.addLevelName(VERBOSE, "VERBOSE")

# Add verbose() method to Logger class
def verbose(self, message, *args, **kwargs):
    if self.isEnabledFor(VERBOSE):
        self._log(VERBOSE, message, args, **kwargs)

logging.Logger.verbose = verbose

# Filter to block exifread DEBUG spam and other unwanted DEBUG messages
class ExifreadDebugFilter(logging.Filter):
    def filter(self, record):
        # Block DEBUG messages that look like exifread output
        if record.levelno == logging.DEBUG:
            message = str(record.getMessage())
            # Filter out exifread tag messages
            if any(pattern in message for pattern in [
                'tag: ',
                'Tag ',
                'save: ',
                'type: ',
                'value: ',
                'Tag Location:',
                'Data Location:',
            ]):
                return False
        return True

# Configure logging for Celery workers using Celery's logging system
# Use VERBOSE level to filter out exifread DEBUG spam while keeping your verbose logs
log_level = logging.INFO if os.getenv('ENVIRONMENT', 'DEVELOPMENT') == 'PRODUCTION' else VERBOSE
logging.basicConfig(
    level=log_level,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# Apply filter to root logger to block exifread DEBUG spam
logging.getLogger().addFilter(ExifreadDebugFilter())

# Set common third-party loggers to INFO to suppress their DEBUG spam
logging.getLogger('exifread').setLevel(logging.INFO)
# Also set any other loggers that might be used by exifread
for logger_name in ['exifread', 'PIL', 'Pillow']:
    logging.getLogger(logger_name).setLevel(logging.INFO)

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
    beat_schedule={
        # Run once per day at 2 AM to check for expired upload URLs
        'expire-pending-uploads': {
            'task': 'expire_pending_uploads_task',
            'schedule': crontab(hour=2, minute=0),  # Run daily at 2 AM
        },
    },
)

if __name__ == '__main__':
    celery.start()

