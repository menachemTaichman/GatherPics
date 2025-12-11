"""
Centralized file helper for all file operations.

Provides a clean API that hides storage implementation details.
Routes and core services should use this instead of accessing storage directly.
"""

import os
from typing import Optional, BinaryIO
from io import BytesIO
from flask import send_file, redirect

from .storage_backend import get_storage_backend, StorageBackend


class FileHelper:
    """
    Centralized helper for file operations.
    
    Handles all file operations transparently, whether using local storage or S3.
    """
    
    def __init__(self, storage: Optional[StorageBackend] = None):
        """Initialize with storage backend (uses default if not provided)."""
        self.storage = storage or get_storage_backend()
        self.is_local = hasattr(self.storage, 'base_path')
    
    def exists(self, path: str) -> bool:
        """Check if file exists."""
        return self.storage.exists(path)
    
    def read(self, path: str) -> bytes:
        """Read file contents as bytes."""
        return self.storage.read(path)
    
    def write(self, path: str, data: bytes, content_type: Optional[str] = None) -> None:
        """
        Write bytes to file.
        
        Args:
            path: File path (relative to storage root)
            data: File contents as bytes
            content_type: Optional content type (used for S3)
        """
        self.storage.write(path, data, content_type=content_type)
    
    def delete(self, path: str) -> None:
        """Delete file."""
        self.storage.delete(path)
    
    def get_file_path(self, path: str) -> str:
        """
        Get full filesystem path for local storage.
        
        Args:
            path: Relative path
            
        Returns:
            Full filesystem path (local) or relative path (S3)
        """
        if self.is_local:
            return os.path.join(self.storage.base_path, path)
        return path
    
    def get_url(self, path: str, expires_in: int = 3600) -> Optional[str]:
        """
        Get URL for file.
        
        Args:
            path: File path
            expires_in: URL expiration in seconds (for S3 presigned URLs)
            
        Returns:
            Presigned URL (S3) or local file path (local storage)
        """
        return self.storage.get_url(path, expires_in=expires_in)
    
    def get_s3_reference(self, path: str) -> Optional[dict]:
        """
        Get S3 reference dict for Rekognition.
        
        Args:
            path: File path
            
        Returns:
            S3 reference dict or None if not using S3
        """
        return self.storage.get_s3_reference(path)
    
    def serve_file(self, path: str, mimetype: str, as_attachment: bool = False, download_name: Optional[str] = None):
        """
        Serve file via Flask response.
        
        In production with S3, redirects to presigned URL.
        In development, serves file directly.
        
        Args:
            path: File path
            mimetype: MIME type
            as_attachment: Whether to serve as download
            download_name: Download filename
            
        Returns:
            Flask response (redirect or send_file)
        """
        # In production with S3, redirect to presigned URL
        if os.getenv('ENVIRONMENT') == 'PRODUCTION' and not self.is_local:
            url = self.get_url(path)
            if url:
                return redirect(url, code=302)
        
        # Local storage or fallback - serve file directly
        if self.is_local:
            full_path = self.get_file_path(path)
            return send_file(
                full_path,
                mimetype=mimetype,
                as_attachment=as_attachment,
                download_name=download_name
            )
        else:
            # Fallback: read from storage and serve
            file_data = self.read(path)
            return send_file(
                BytesIO(file_data),
                mimetype=mimetype,
                as_attachment=as_attachment,
                download_name=download_name
            )
    
    def get_file_size(self, path: str) -> int:
        """
        Get file size in bytes.
        
        Args:
            path: File path
            
        Returns:
            File size in bytes
        """
        if self.is_local:
            full_path = self.get_file_path(path)
            return os.path.getsize(full_path)
        else:
            # For S3, read to get size (could be optimized with head_object)
            return len(self.read(path))


# Global instance for convenience
_file_helper = None

def get_file_helper() -> FileHelper:
    """Get global file helper instance."""
    global _file_helper
    if _file_helper is None:
        _file_helper = FileHelper()
    return _file_helper

