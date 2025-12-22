"""
Storage backend abstraction - local filesystem for dev, S3-compatible storage (R2/AWS) for production.

Similar pattern to mock_rekognition.py for consistency.
"""

import os
import shutil
from itertools import islice
from abc import ABC, abstractmethod
from typing import BinaryIO, Optional
from pathlib import Path
import boto3
from botocore.exceptions import ClientError


class StorageBackend(ABC):
    """Abstract base class for storage backends."""
    
    @abstractmethod
    def exists(self, path: str) -> bool:
        """Check if file exists."""
        pass
    
    @abstractmethod
    def read(self, path: str) -> bytes:
        """Read file contents as bytes."""
        pass
    
    @abstractmethod
    def write(self, path: str, data: bytes, content_type: Optional[str] = None) -> None:
        """Write bytes to file."""
        pass
    
    @abstractmethod
    def write_stream(self, path: str, fileobj: BinaryIO, content_type: Optional[str] = None, size_limit: Optional[int] = None) -> None:
        """Write file from stream (file-like object) with optional size limit."""
        pass
    
    @abstractmethod
    def delete(self, path: str) -> None:
        """Delete file."""
        pass
    
    @abstractmethod
    def delete_many(self, paths: list[str]) -> list[dict]:
        """Delete many files."""
        pass

    @abstractmethod
    def copy(self, source_path: str, dest_path: str, content_type: Optional[str] = None) -> None:
        """Copy file from source to destination (efficient server-side copy when possible)."""
        pass
    
    @abstractmethod
    def get_s3_reference(self, path: str) -> Optional[dict]:
        """Get S3 reference dict for Rekognition (bucket, key) or None if not S3."""
        pass
    
    @abstractmethod
    def get_url(self, path: str, expires_in: int = 3600) -> Optional[str]:
        """Get URL for file (S3 presigned URL or local path).
        
        Args:
            path: File path
            expires_in: URL expiration in seconds (for S3 presigned URLs, ignored for local storage)
        """
        pass
    
    @abstractmethod
    def get_upload_url(self, path: str, content_type: Optional[str] = None, max_size: Optional[int] = None, expires_in: int = 3600) -> Optional[dict]:
        """Get presigned URL for uploading file with conditions.
        
        Returns dict with 'url' and 'fields' for POST upload, or None.
        """
        pass
    
    @abstractmethod
    def get_file_size(self, path: str) -> int:
        """Get file size in bytes."""
        pass
    
    @abstractmethod
    def get_object_stream(self, path: str):
        """Get streaming object for file (S3 response body or file handle).
        
        Returns:
            For S3: boto3 response object with 'Body' stream
            For local: file handle or None
        """
        pass
    
    @abstractmethod
    def list_files(self, prefix: str, suffix: Optional[str] = None) -> list[str]:
        """List files with given prefix (directory path).
        
        Args:
            prefix: Directory path prefix (e.g., "event_id/original")
            suffix: Optional file suffix to filter by (e.g., ".jpg")
            
        Returns:
            List of file paths (relative to storage root)
        """
        pass


class LocalStorageBackend(StorageBackend):
    """Local filesystem storage backend for development."""
    
    def __init__(self, base_path: str):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)
    
    def _get_full_path(self, path: str) -> Path:
        """Get full filesystem path."""
        return self.base_path / path.lstrip('/')
    
    def exists(self, path: str) -> bool:
        return self._get_full_path(path).exists()
    
    def read(self, path: str) -> bytes:
        full_path = self._get_full_path(path)
        if not full_path.exists():
            raise FileNotFoundError(f"File not found: {path}")
        return full_path.read_bytes()
    
    def write(self, path: str, data: bytes, content_type: Optional[str] = None) -> None:
        """Write bytes to local filesystem (content_type ignored for local storage)."""
        full_path = self._get_full_path(path)
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_bytes(data)
    
    def write_stream(self, path: str, fileobj: BinaryIO, content_type: Optional[str] = None, size_limit: Optional[int] = None) -> None:
        """Write file from stream (file-like object) to local filesystem with optional size limit."""
        full_path = self._get_full_path(path)
        full_path.parent.mkdir(parents=True, exist_ok=True)
        bytes_read = 0
        
        with open(full_path, 'wb') as f:
            while True:
                chunk = fileobj.read(8192)  # Read in 8KB chunks
                if not chunk:
                    break
                bytes_read += len(chunk)
                if size_limit and bytes_read > size_limit:
                    raise ValueError(f"File exceeds maximum size of {size_limit} bytes")
                f.write(chunk)
    
    def delete(self, path: str) -> None:
        full_path = self._get_full_path(path)
        if full_path.exists():
            full_path.unlink()
    
    def delete_many(self, paths: list[str]) -> list[dict]:
        failures = []
        for path in paths:
            try:
                self.delete(path)
            except Exception as e:
                failures.append({
                    "path": path,
                    "code": e.code,
                    "message": str(e)
                })
        return failures
    
    def copy(self, source_path: str, dest_path: str, content_type: Optional[str] = None) -> None:
        """Copy file from source to destination (content_type ignored for local storage)."""
        source_full_path = self._get_full_path(source_path)
        dest_full_path = self._get_full_path(dest_path)
        
        if not source_full_path.exists():
            raise FileNotFoundError(f"Source file not found: {source_path}")
        
        dest_full_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_full_path, dest_full_path)
    
    def get_s3_reference(self, path: str) -> Optional[dict]:
        """Local storage doesn't support S3 references."""
        return None
    
    def get_url(self, path: str, expires_in: int = 3600) -> Optional[str]:
        """
        Return API URL for local storage (browser can't access local file paths).
        Path format: {event_id}/{dir}/{file_id}.{ext}
        Returns: /api/events/{event_id}/{dir}/{file_id}.{ext}
        """
        # Parse path: {event_id}/{dir}/{file_id}.{ext}
        # Examples: "75cb6635-879d-4386-b023-366444dc0fb2/original/452ccecd-2f02-48c4-ab45-6bf5c5aedc26.jpg"
        parts = path.split('/')
        if len(parts) < 3:
            # Invalid path format, return None
            return None
        
        event_id = parts[0]
        dir_name = parts[1]
        filename = '/'.join(parts[2:])  # Handle nested paths if any
        
        # Map directory names to API route names
        # Note: 'faces' directory maps to 'faces' route, others map to their directory name
        route_name = dir_name
        
        # Construct API URL
        api_url = f"/api/events/{event_id}/{route_name}/{filename}"
        return api_url
    
    def get_upload_url(self, path: str, content_type: Optional[str] = None, max_size: Optional[int] = None, expires_in: int = 3600) -> Optional[dict]:
        """
        Path format: {event_id}/to_process/{filename}
        Returns: dict with 'url' pointing to /api/events/{event_id}/upload/direct and
        'fields' as None. Includes 'method' to indicate HTTP verb (POST for local).
        """
        # Extract event_id from path: {event_id}/to_process/{filename}
        parts = path.split('/')
        if len(parts) < 2:
            return None
        
        event_id = parts[0]
        return {
            'url': f"/api/events/{event_id}/upload/direct",
            'fields': None,
            'method': 'POST',
            'headers': None
        }
    
    def get_file_size(self, path: str) -> int:
        """Get file size in bytes."""
        full_path = self._get_full_path(path)
        if not full_path.exists():
            raise FileNotFoundError(f"File not found: {path}")
        return full_path.stat().st_size
    
    def get_object_stream(self, path: str):
        """Get file handle for local storage."""
        full_path = self._get_full_path(path)
        if not full_path.exists():
            raise FileNotFoundError(f"File not found: {path}")
        return open(full_path, 'rb')
    
    def list_files(self, prefix: str, suffix: Optional[str] = None) -> list[str]:
        """List files with given prefix (directory path)."""
        full_path = self._get_full_path(prefix)
        if not full_path.exists() or not full_path.is_dir():
            return []
        
        files = []
        for item in full_path.iterdir():
            if item.is_file():
                if suffix is None or item.name.endswith(suffix):
                    # Return relative path from storage root
                    relative_path = str(item.relative_to(self.base_path))
                    files.append(relative_path)
        
        return files


class S3StorageBackend(StorageBackend):
    """S3 storage backend for production."""
    
    def __init__(self, bucket_name: str, base_prefix: str = '', region: Optional[str] = None):
        self.bucket_name = bucket_name
        self.base_prefix = base_prefix.rstrip('/')
        self.s3_client = boto3.client(
            's3',
            aws_access_key_id=os.getenv('R2_ACCESS_KEY_ID'),
            aws_secret_access_key=os.getenv('R2_SECRET_ACCESS_KEY'),
            region_name=os.getenv('R2_REGION'),
            endpoint_url=os.getenv('R2_ENDPOINT')
        )
    
    def _get_key(self, path: str) -> str:
        """Get S3 key from path."""
        path = path.lstrip('/')
        if self.base_prefix:
            return f"{self.base_prefix}/{path}"
        return path
    
    def exists(self, path: str) -> bool:
        try:
            self.s3_client.head_object(Bucket=self.bucket_name, Key=self._get_key(path))
            return True
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                return False
            raise
    
    def read(self, path: str) -> bytes:
        try:
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=self._get_key(path))
            return response['Body'].read()
        except ClientError as e:
            if e.response['Error']['Code'] == 'NoSuchKey':
                raise FileNotFoundError(f"File not found: {path}")
            raise
    
    def write(self, path: str, data: bytes, content_type: Optional[str] = None) -> None:
        """Write bytes to S3."""
        key = self._get_key(path)
        extra_args = {}
        if content_type:
            extra_args['ContentType'] = content_type
        
        self.s3_client.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=data,
            **extra_args
        )
    
    def write_stream(self, path: str, fileobj: BinaryIO, content_type: Optional[str] = None, size_limit: Optional[int] = None) -> None:
        """Write file from stream (file-like object) to S3 with optional size limit."""
        key = self._get_key(path)
        extra_args = {}
        if content_type:
            extra_args['ContentType'] = content_type
        
        bytes_read = 0
        
        def limiter(bytes_amount):
            nonlocal bytes_read
            bytes_read += bytes_amount
            if size_limit and bytes_read > size_limit:
                raise ValueError(f"File exceeds maximum size of {size_limit} bytes")
        
        self.s3_client.upload_fileobj(
            fileobj,
            self.bucket_name,
            key,
            Callback=limiter if size_limit else None,
            ExtraArgs=extra_args
        )
    
    def delete(self, path: str) -> None:
        try:
            self.s3_client.delete_object(Bucket=self.bucket_name, Key=self._get_key(path))
        except ClientError:
            pass  # Ignore if already deleted
    
    def delete_many(self, paths: list[str]) -> list[dict]:
        """
        Delete many files.
        Returns list of failures (dicts with 'path', 'code', 'message')
        """
        def chunks(iterable, size=1000):
            it = iter(iterable)
            while True:
                chunk = list(islice(it, size))
                if not chunk:
                    break
                yield chunk

        failures = []
        for batch in chunks(paths):
            response = self.s3_client.delete_objects(
                Bucket=self.bucket_name,
                Delete={
                    "Objects": [{"Key": self._get_key(p)} for p in batch],
                    "Quiet": True
                }
            )

            for err in response.get("Errors", []):
                failures.append({
                    "path": err.get("Key"),
                    "code": err.get("Code"),
                    "message": err.get("Message"),
                })

        return failures

    def copy(self, source_path: str, dest_path: str, content_type: Optional[str] = None) -> None:
        """Copy file from source to destination using S3 copy_object (efficient server-side copy)."""
        source_key = self._get_key(source_path)
        dest_key = self._get_key(dest_path)
        
        copy_source = {
            'Bucket': self.bucket_name,
            'Key': source_key
        }
        
        extra_args = {}
        if content_type:
            extra_args['ContentType'] = content_type
        else:
            # Try to preserve content type from source
            try:
                response = self.s3_client.head_object(Bucket=self.bucket_name, Key=source_key)
                if 'ContentType' in response:
                    extra_args['ContentType'] = response['ContentType']
            except ClientError:
                pass  # If we can't get content type, proceed without it
        
        try:
            self.s3_client.copy_object(
                CopySource=copy_source,
                Bucket=self.bucket_name,
                Key=dest_key,
                **extra_args
            )
        except ClientError as e:
            if e.response['Error']['Code'] == 'NoSuchKey':
                raise FileNotFoundError(f"Source file not found: {source_path}")
            raise
    
    def get_s3_reference(self, path: str) -> dict:
        """Get S3 reference dict for Rekognition."""
        return {
            'S3Object': {
                'Bucket': self.bucket_name,
                'Name': self._get_key(path)
            }
        }
    
    def get_url(self, path: str, expires_in: int = 3600) -> Optional[str]:
        """Get presigned URL for file."""
        try:
            return self.s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': self.bucket_name, 'Key': self._get_key(path)},
                ExpiresIn=expires_in
            )
        except ClientError:
            return None
    
    def get_upload_url(self, path: str, content_type: Optional[str] = None, max_size: Optional[int] = None, expires_in: int = 3600) -> Optional[dict]:
        """Get presigned URL for uploading file (PUT for R2/S3).
        
        Args:
            path: File path
            content_type: Required content type for the file
            max_size: Maximum file size in bytes
            expires_in: URL expiration in seconds
            
        Returns:
            Dict with 'url', 'method', optional 'headers', and 'fields' (unused for PUT)
        """
        try:
            extra_headers = {}
            if content_type:
                extra_headers['Content-Type'] = content_type

            presigned_url = self.s3_client.generate_presigned_url(
                ClientMethod="put_object",
                Params={
                    "Bucket": self.bucket_name,
                    "Key": self._get_key(path),
                    **({"ContentType": content_type} if content_type else {}),
                },
                ExpiresIn=expires_in,
            )

            return {
                'url': presigned_url,
                'fields': None,
                'method': 'PUT',
                'headers': extra_headers or None,
            }
        except ClientError:
            return None
    
    def get_file_size(self, path: str) -> int:
        """Get file size in bytes using head_object (optimized - doesn't download file)."""
        try:
            response = self.s3_client.head_object(Bucket=self.bucket_name, Key=self._get_key(path))
            return response['ContentLength']
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                raise FileNotFoundError(f"File not found: {path}")
            raise
    
    def get_object_stream(self, path: str):
        """Get S3 object response for streaming."""
        try:
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=self._get_key(path))
            return response
        except ClientError as e:
            if e.response['Error']['Code'] == 'NoSuchKey':
                raise FileNotFoundError(f"File not found: {path}")
            raise
    
    # TODO: think maybe its very expensive
    def list_files(self, prefix: str, suffix: Optional[str] = None) -> list[str]:
        """List files with given prefix (directory path) in S3."""
        return []
        key_prefix = self._get_key(prefix)
        if not key_prefix.endswith('/'):
            key_prefix += '/'
        
        files = []
        paginator = self.s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=self.bucket_name, Prefix=key_prefix)
        
        for page in pages:
            if 'Contents' in page:
                for obj in page['Contents']:
                    key = obj['Key']
                    # Remove base_prefix if present to get relative path
                    if self.base_prefix:
                        if key.startswith(self.base_prefix + '/'):
                            relative_key = key[len(self.base_prefix) + 1:]
                        else:
                            continue
                    else:
                        relative_key = key
                    
                    # Filter by suffix if specified
                    if suffix is None or relative_key.endswith(suffix):
                        files.append(relative_key)
        
        return files


def get_storage_backend() -> StorageBackend:
    """
    Factory function to get appropriate storage backend.
    
    Returns:
        LocalStorageBackend if R2_BUCKET is not configured or (in dev) USE_R2 is not enabled
        S3StorageBackend if:
            - ENVIRONMENT=PRODUCTION and R2_BUCKET is set, OR
            - ENVIRONMENT=DEVELOPMENT and USE_R2=true and R2_BUCKET is set
    """
    environment = os.getenv('ENVIRONMENT', 'DEVELOPMENT')
    use_r2 = os.getenv('USE_R2', '').lower() in ('true', '1', 'yes', 'on')
    s3_bucket = os.getenv('R2_BUCKET')
    
    # In production: use R2 if bucket is configured (no USE_R2 needed)
    # In dev: use R2 only if explicitly enabled with USE_R2=true
    should_use_r2 = (environment == 'PRODUCTION' and s3_bucket) or (environment == 'DEVELOPMENT' and use_r2 and s3_bucket)
    
    if should_use_r2:
        base_prefix = os.getenv('S3_BASE_PREFIX', '')
        region = os.getenv('R2_REGION')
        return S3StorageBackend(bucket_name=s3_bucket, base_prefix=base_prefix, region=region)
    
    # Default to local storage
    from src.core import DATA_ROOT
    return LocalStorageBackend(base_path=DATA_ROOT)

