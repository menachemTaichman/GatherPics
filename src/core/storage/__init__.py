"""
Storage abstraction layer for file operations.

Provides a unified interface for local file system (dev) and S3 (production).
Similar pattern to mock_rekognition.py for consistency.
"""

import os
from typing import Optional

# Load environment variables from .env file if it exists (development only)
if os.path.exists('.env'):
    from dotenv import load_dotenv
    load_dotenv()

from .storage_backend import get_storage_backend
from .file_helper import FileHelper, get_file_helper

__all__ = ['get_storage_backend', 'StorageBackend', 'FileHelper', 'get_file_helper']

# Re-export for convenience
from .storage_backend import StorageBackend

