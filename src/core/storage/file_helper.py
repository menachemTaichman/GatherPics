"""
Centralized file helper for all file operations.

Provides a clean API that hides storage implementation details.
Routes and core services should use this instead of accessing storage directly.
"""

import os
from typing import Optional, BinaryIO
from io import BytesIO
import urllib.parse
from flask import send_file, redirect, Response, stream_with_context

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
    
    def write_stream(self, path: str, fileobj: BinaryIO, content_type: Optional[str] = None, size_limit: Optional[int] = None) -> None:
        """
        Write file from stream (file-like object).
        
        Args:
            path: File path (relative to storage root)
            fileobj: File-like object to read from (must support read())
            content_type: Optional content type (used for S3)
            size_limit: Optional maximum file size in bytes
        """
        self.storage.write_stream(path, fileobj, content_type=content_type, size_limit=size_limit)
    
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
    
    def get_upload_url(self, path: str, content_type: Optional[str] = None, max_size: Optional[int] = None, expires_in: int = 3600) -> Optional[dict]:
        """
        Get presigned URL for uploading file with conditions.
        
        Args:
            path: File path
            content_type: Required content type for the file
            max_size: Maximum file size in bytes
            expires_in: URL expiration in seconds (for S3 presigned URLs)
            
        Returns:
            Dict with 'url' and 'fields' for POST upload (S3) or None (local storage)
        """
        return self.storage.get_upload_url(path, content_type=content_type, max_size=max_size, expires_in=expires_in)
    
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
        
        For downloads (as_attachment=True): returns presigned URL redirect for direct S3 access.
        For viewing (as_attachment=False): proxies file through Flask server.
        For local storage: always serves file directly through Flask.
        
        Args:
            path: File path
            mimetype: MIME type
            as_attachment: Whether to serve as download
            download_name: Download filename
            
        Returns:
            Flask response (send_file for local/proxy, redirect for S3 downloads)
        """
        # Local storage - serve file directly
        if self.is_local:
            full_path = self.get_file_path(path)
            return send_file(
                full_path,
                mimetype=mimetype,
                as_attachment=as_attachment,
                download_name=download_name
            )
        else:
            # S3 storage
            if as_attachment:
                # Download: return presigned URL for direct S3 access
                presigned_url = self.get_url(path, expires_in=3600)
                if not presigned_url:
                    raise FileNotFoundError(f"Could not generate presigned URL for: {path}")
                
                # Add Content-Disposition header if needed for downloads
                # Note: We can't set headers on redirect, but S3 presigned URLs support response-content-disposition parameter
                if download_name:
                    # Add response-content-disposition parameter to presigned URL
                    parsed = urllib.parse.urlparse(presigned_url)
                    params = urllib.parse.parse_qs(parsed.query)
                    params['response-content-disposition'] = [f'attachment; filename="{download_name}"']
                    new_query = urllib.parse.urlencode(params, doseq=True)
                    presigned_url = urllib.parse.urlunparse(parsed._replace(query=new_query))
                
                return redirect(presigned_url, code=302)
            else:
                # Viewing: stream through Flask server
                if hasattr(self.storage, 'get_object_stream'):
                    # S3 Storage - Streaming Proxy
                    s3_response = self.storage.get_object_stream(path)
                    return Response(
                        stream_with_context(s3_response['Body']),
                        mimetype=mimetype,
                        direct_passthrough=True
                    )
                else:
                    # Local storage or fallback - read into memory
                    file_data = self.read(path)
                    file_stream = BytesIO(file_data)
                    return send_file(
                        file_stream,
                        mimetype=mimetype,
                        as_attachment=False,
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
        return self.storage.get_file_size(path)
    
    def copy(self, source_path: str, dest_path: str, content_type: Optional[str] = None) -> None:
        """
        Copy file from source to destination (efficient server-side copy when possible).
        
        Args:
            source_path: Source file path (relative to storage root)
            dest_path: Destination file path (relative to storage root)
            content_type: Optional content type (used for S3, preserved from source if not specified)
        """
        self.storage.copy(source_path, dest_path, content_type=content_type)
    
    def list_files(self, prefix: str, suffix: Optional[str] = None) -> list[str]:
        """
        List files with given prefix (directory path).
        
        Args:
            prefix: Directory path prefix (e.g., "event_id/original")
            suffix: Optional file suffix to filter by (e.g., ".jpg")
            
        Returns:
            List of file paths (relative to storage root)
        """
        return self.storage.list_files(prefix, suffix)


# Global instance for convenience
_file_helper = None

def get_file_helper() -> FileHelper:
    """Get global file helper instance."""
    global _file_helper
    if _file_helper is None:
        _file_helper = FileHelper()
    return _file_helper

