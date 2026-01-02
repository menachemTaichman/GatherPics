import os
import shutil
import gc
from datetime import datetime
import re
import logging
import json
from collections import defaultdict

from ..utils.image_utils import resize_image, extract_metadata_from_bytes, crop_image
from PIL import Image as PILImage
from io import BytesIO

from src.core.errors import Forbidden, PolicyError
from src.core.utils.face_utils import FaceUtils
from src.core.models.event_models import EventModels, ChildOperation
from src.core.database.db import ReturnFormat
from src.core.audit_log import AuditAction, log_audit
from src.core.storage import get_file_helper

from src.core import DATA_ROOT

logger = logging.getLogger(__name__)

class Event():
    """Event model for managing event data and operations."""

    @staticmethod
    def create_event(event_id: str):
        """Create event directories (local) or ensure S3 paths exist (S3)."""
        file_helper = get_file_helper()
        if file_helper.is_local:
            # Local storage - create directories
            event_dir = os.path.join(DATA_ROOT, event_id)
            os.makedirs(event_dir, exist_ok=True)
            os.makedirs(os.path.join(event_dir, 'display'), exist_ok=True)
            os.makedirs(os.path.join(event_dir, 'original'), exist_ok=True)
            os.makedirs(os.path.join(event_dir, 'thumb'), exist_ok=True)
            os.makedirs(os.path.join(event_dir, 'to_process'), exist_ok=True)
            os.makedirs(os.path.join(event_dir, 'faces'), exist_ok=True)
            os.makedirs(os.path.join(event_dir, 'high_quality'), exist_ok=True)
        # For S3, directories are virtual - no need to create
                
    def __init__(self, event_id: str, profile_id: str | None = None, public_code: str | None = None):
        self.event_id = event_id
        self.file_helper = get_file_helper()
        
        # Use relative paths for both local and S3 (FileHelper handles the difference)
        self.display_dir = f"{event_id}/display"
        self.original_dir = f"{event_id}/original"
        self.thumb_dir = f"{event_id}/thumb"
        self.to_process_dir = f"{event_id}/to_process"
        self.faces_dir = f"{event_id}/faces"
        self.high_quality_dir = f"{event_id}/high_quality"
        
        self.models = EventModels(event_id, profile_id, public_code)
        self.face_utils = FaceUtils(event_id, storage_backend=self.file_helper.storage)

    def close(self):
        """Close the DB connection used by this Event instance."""
        if self.models and self.models.db:
            self.models.db.close()

    def __enter__(self):
        """Support for context manager protocol: with Event(...) as event:"""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Support for context manager protocol: automatically close DB connection on exit"""
        self.close()

    def prepare_upload_urls(self, files_data: list[dict]) -> dict:
        """
        Prepare presigned URLs for direct S3 uploads.
        Creates upload record and image records, generates presigned URLs.
        
        Args:
            files_data: List of dicts with 'filename' and 'size' keys
            
        Returns:
            dict with 'upload_id' and 'upload_urls' list
            Each upload_url dict contains: image_id, filename, upload_url, upload_fields, filepath
        """
        
        def sanitize_filename(filename: str) -> str:
            """Sanitize filename while preserving spaces."""
            if not filename:
                return ''
            
            # Remove any path components
            filename = os.path.basename(filename)
            
            # Remove null bytes and control characters
            filename = filename.replace('\x00', '')
            filename = ''.join(char for char in filename if ord(char) >= 32 or char in ['\t', '\n', '\r'])
            
            # Remove dangerous characters: / \ : * ? " < > |
            filename = re.sub(r'[<>:"/\\|?*]', '', filename)
            
            # Remove leading/trailing spaces and dots
            filename = filename.strip(' .')
            
            # Limit length
            if len(filename) > 255:
                name, ext = os.path.splitext(filename)
                filename = name[:255 - len(ext)] + ext
            
            # If empty after sanitization, use a default name
            if not filename:
                filename = 'image'
            
            return filename

        # check limitations
        if not self.models.db.event_profile_context['can_upload_and_delete_images']:
            raise Forbidden("Profile not allowed to upload images")
        
        event_data = self.models.get_entities('events', self.event_id, include_details=True)
        images_count_limit = event_data['images_count_limit']
        images_count = self.models.get_images_count()
        image_size_limit_bytes = event_data['image_size_limit_bytes']
        if len(files_data) + images_count > images_count_limit:
            raise PolicyError(f"Upload would exceed image count limit. Current: {images_count}, Limit: {images_count_limit}, Attempting to add: {len(files_data)}")
        max_file_size = max(file_info['size'] for file_info in files_data)
        if max_file_size > image_size_limit_bytes:
            raise PolicyError(f"Max file size allowed is {image_size_limit_bytes} bytes, but file with size {max_file_size} bytes was provided")
        self.models.ensure_rekognition_requests_limit(len(files_data))

        # Create upload session
        upload_id = self.models.add('uploads', {
            'started_at': datetime.now().isoformat(),
            'requested_images_count': len(files_data),
        })
        
        # Log audit event for upload
        actor_profile_id = self.models.db.profile_context.get('profile_id')
        log_audit(
            action=AuditAction.UPLOAD_MADE,
            actor_profile_id=actor_profile_id,
            details={
                'upload_id': upload_id,
                'event_id': self.event_id,
                'images_requested': len(files_data),
            }
        )
        
        # Prepare all filenames and generate unique labels in bulk (optimized for large batches)
        filenames = []
        image_names = []
        image_exts = []
        file_sizes = []
        
        for file_info in files_data:
            original_filename = file_info['filename']
            file_size = file_info['size']
            
            # Filename extension is already validated by the API validator
            filename = sanitize_filename(original_filename)
            image_name, image_ext = os.path.splitext(filename)
            
            filenames.append(filename)
            image_names.append(image_name)
            image_exts.append(image_ext)
            file_sizes.append(file_size)
        
        # Generate all unique labels at once (single DB query instead of N queries)
        labels = self.models.get_unique_labels(
            'images', 
            image_names, 
            suffix='',  # Not used when suffixes is provided
            brackets=True, 
            separator='.', 
            event_id=self.event_id,
            suffixes=image_exts  # Each file can have different extension
        )
        
        upload_urls = []
        
        values = []
        for label in labels:
            values.extend([self.event_id, label, upload_id])
        query = f"""
            INSERT INTO images (event_id, label, upload_id)
            VALUES {','.join(['(%s, %s, %s)'] * len(labels))}
            RETURNING image_id;
        """
        image_ids = self.models.db.execute_query(query, values, return_format=ReturnFormat.LIST_VALUES)
        for i, file_info in enumerate(files_data):
            filename = filenames[i]
            file_size = file_sizes[i]
            label = labels[i]
            
            stored_filename = f"{image_ids[i]}.jpg"  # processing pipeline expects lowercase .jpg
            filepath = f"{self.to_process_dir}/{stored_filename}"
            
            upload_info = self.file_helper.get_upload_url(
                filepath, 
                content_type='image/jpeg', 
                max_size=file_size,
                expires_in=3600 * 3
            )
            
            if not upload_info:
                raise ValueError(f"Failed to generate upload URL for {file_info['filename']}")
            
            upload_urls.append({
                "image_id": image_ids[i],
                "filename": filename,  # original filename for UI/display
                "stored_filename": stored_filename,  # actual object name used in storage
                "upload_url": upload_info['url'],
                "upload_fields": upload_info.get('fields'),
                "upload_method": upload_info.get('method', 'POST'),
                "upload_headers": upload_info.get('headers'),
                "filepath": filepath
            })
        
        return {
            "upload_id": upload_id,
            "upload_urls": upload_urls
        }

    def _process_face_crop(self, source_img, bbox, face_id) -> tuple[str, int]:
        """
        Process a single face: crop, resize, save.
        
        Args:
            source_img: PIL Image to crop from
            bbox: Bounding box dict with width, height, left, top
            face_id: UUID for the face
            
        Returns:
            tuple: (face_id, file_size)
        """
        
        # Crop face with padding
        crop_img = crop_image(source_img, bbox, padding_width_percent=0.3, padding_height_percent=0.2)
        
        # Resize to max 150x150
        crop_img.thumbnail((150, 150), PILImage.Resampling.LANCZOS)
        
        # Save to storage
        crop_path = f"{self.faces_dir}/{face_id}.webp"
        face_file_size = self.file_helper.save_image(crop_img, crop_path, 'WEBP', 70, True)
        
        logger.verbose(f"Face crop saved: face_id={face_id}, file_size={face_file_size} bytes")
        
        del crop_img
        
        return (face_id, face_file_size)

    def _process_single_image(
        self,
        image_id: str,
        display_size: int = 2048,
        thumb_size: int = 512,
    ) -> dict | None:
        """
        Process a single image: resize, detect faces, crop faces, copy original.
        
        Args:
            image_id: UUID of the image (already exists in DB)
            display_size: Size for display images
            thumb_size: Size for thumbnail images
            
        Returns:
            dict with face_ids list, or None on failure
        """
        logger.info(f"Starting to process image: image_id={image_id}")

        try:
            # Read image from storage
            image_path = f"{self.to_process_dir}/{image_id}.jpg"
            logger.verbose(f"Reading image from storage: {image_path}")
            image_bytes = self.file_helper.read(image_path)
            image_stream = BytesIO(image_bytes)
            file_size = len(image_bytes)
            logger.verbose(f"Image read: file_size={file_size} bytes")
            
            # TODO: see if exif_bytes is enough for date_taken
            # Extract metadata
            metadata = extract_metadata_from_bytes(image_bytes)
            del image_bytes

            # Open image with context manager
            with PILImage.open(image_stream) as original_img:
                width, height = original_img.size
                date_taken = metadata.get('date_taken')
                logger.verbose(f"Image dimensions: {width}x{height}, date_taken={date_taken}")
                
                # Extract EXIF for high quality version
                exif_bytes = original_img.getexif().tobytes() if original_img.getexif() else b''
                
                # Display (WebP)
                logger.verbose("Creating display image...")
                display_img = resize_image(original_img, display_size)
                display_path = f"{self.display_dir}/{image_id}.webp"
                display_file_size = self.file_helper.save_image(display_img, display_path, 'WEBP', 90, True)
                logger.verbose(f"Display image saved: {display_file_size} bytes")
                del display_img
                
                # Thumb (WebP)
                logger.verbose("Creating thumbnail image...")
                thumb_img = resize_image(original_img, thumb_size)
                thumb_path = f"{self.thumb_dir}/{image_id}.webp"
                thumb_file_size = self.file_helper.save_image(thumb_img, thumb_path, 'WEBP', 80, True)
                logger.verbose(f"Thumbnail image saved: {thumb_file_size} bytes")
                del thumb_img

                # High Quality (JPEG)
                logger.verbose("Creating high quality image...")
                high_quality_img = resize_image(original_img, 4096)
                high_quality_path = f"{self.high_quality_dir}/{image_id}.jpg"
                high_quality_file_size = self.file_helper.save_image(high_quality_img, high_quality_path, 'JPEG', 95, True, exif_bytes)
                logger.verbose(f"High quality image saved: {high_quality_file_size} bytes")
                
            event_data = self.models.get_entities('events', self.event_id, include_details=True)
            unassociated_group_id = event_data['unassociated_group_id']
            self.models.edit_rekognition_requests(1, request_type='DETECT_FACES', details={'image_id': image_id})
            logger.verbose(f"Detecting faces in image: image_id={image_id}")
            detected_faces = self.face_utils.detect_faces(
                image=high_quality_img,
                external_image_id=image_id
            )
            
            faces_count = len(detected_faces)
            logger.verbose(f"Detected {faces_count} faces in image: image_id={image_id}")

            if faces_count > 0:
                # Batch insert all face records (without file_size initially)
                faces_values = []
                for face_id, bbox in detected_faces:
                    faces_values.extend([face_id, image_id, bbox['width'], bbox['height'], bbox['left'], bbox['top'], unassociated_group_id])
                
                query = f"""
                    INSERT INTO faces (face_id, image_id, face_width, face_height, face_left, face_top, group_id)
                    VALUES {','.join(['(%s, %s, %s, %s, %s, %s, %s)'] * faces_count)}
                """
                self.models.db.execute_query(query, faces_values)
                
                # Process all faces (saves files)
                face_file_sizes_values = []
                for face_id, bbox in detected_faces:                
                    logger.verbose(f"Processing face crop: face_id={face_id}, image_id={image_id}")
                    face_id, file_size = self._process_face_crop(high_quality_img, bbox, face_id)
                    face_file_sizes_values.extend([face_id, file_size])
                
                # Batch update file_size for all faces in a single query
                logger.verbose(f"Batch updating file_size for {faces_count} faces...")
                query = f"""
                    UPDATE faces f
                    SET file_size = v.file_size
                    FROM (VALUES {','.join(['(%s, %s)'] * faces_count)}) AS v(face_id, file_size)
                    WHERE f.face_id = v.face_id::uuid
                """
                self.models.db.execute_query(query, face_file_sizes_values)
            
            # Free high quality image from memory
            del high_quality_img
            
            # Move original image to original directory and delete from to_process directory
            logger.verbose("Moving original image to original directory...")
            original_path = f"{self.original_dir}/{image_id}.jpg"
            self.file_helper.copy(image_path, original_path, content_type='image/jpeg')
            self.file_helper.delete(image_path)

            # Update DB record with data
            logger.verbose("Updating database record...")
            query = f"""
                UPDATE images SET
                    date_taken = %s,
                    file_size = %s,
                    width = %s,
                    height = %s,
                    high_quality_file_size = %s,
                    display_file_size = %s,
                    thumb_file_size = %s
                WHERE image_id = %s;
            """
            self.models.db.execute_query(query, (date_taken, file_size, width, height, high_quality_file_size, display_file_size, thumb_file_size, image_id))
            # Cleanup
            gc.collect()
            logger.info(f"Completed processing image: image_id={image_id}, faces_detected={faces_count}")
            return True

        except Exception as e:
            logger.error(f"Error processing image {image_id}: {str(e)}", exc_info=True)
            gc.collect()
            raise

    def _cluster_faces(self, face_ids: list[str], minimal_group_size: int = 2, cluster_threshold: int = 90):
        """
        Cluster faces and create/update groups.
        Reads face matches from database and performs clustering using UnionFind.
        
        Args:
            face_ids: List of face IDs to cluster
            minimal_group_size: Minimum number of faces required to create/join a group
            cluster_threshold: Similarity threshold for face clustering (0-100) - used to filter matches
        """        
        # Get unassociated group ID
        query = """
            SELECT unassociated_group_id FROM events WHERE event_id = %s;
        """
        unassociated_group_id = self.models.db.execute_query(query, (self.event_id,), return_format=ReturnFormat.VALUE)
        
        # UnionFind data structure for clustering
        class UnionFind:
            def __init__(self):
                self.parent = {}

            def find(self, x):
                if x not in self.parent:
                    self.parent[x] = x
                if self.parent[x] != x:
                    self.parent[x] = self.find(self.parent[x])
                return self.parent[x]

            def union(self, x, y):
                self.parent[self.find(x)] = self.find(y)

        face_matches = self.get_face_matches(face_ids)
        
        uf = UnionFind()
        all_faces = set(face_ids)
        
        for face_id, matches in face_matches.items():
            for match in matches:
                similarity = match.get('Similarity', 0)
                match_id = match['Face']['FaceId']
                
                # Filter by cluster_threshold (only include matches above threshold)
                if similarity >= cluster_threshold:
                    uf.union(face_id, match_id)
                    all_faces.add(match_id)
        
        # Group faces by root parent
        clusters_dict = defaultdict(list)
        for face_id in all_faces:
            clusters_dict[uf.find(face_id)].append(face_id)
        
        # Convert to list of tuples: (new_faces, existing_faces)
        clusters = []
        for root, cluster_faces_list in clusters_dict.items():
            new_faces = [face_id for face_id in cluster_faces_list if face_id in face_ids]
            similar_faces = [face_id for face_id in cluster_faces_list if face_id not in face_ids]
            clusters.append((new_faces, similar_faces))
        
        for new_faces, existing_faces in clusters:
            if len(new_faces) + len(existing_faces) < minimal_group_size:
                continue

            partition = {}
            if existing_faces:
                query = f"""
                    WITH face_ids AS (
                        SELECT DISTINCT unnest(%s::uuid[]) AS face_id
                    )
                    SELECT face_id, group_id FROM faces f
                    INNER JOIN face_ids fi ON f.face_id = fi.face_id
                """
                rows = self.models.db.execute_query(query, (existing_faces,), return_format=ReturnFormat.LIST_TUPLES)
                for face_id, group_id in rows:
                    partition.setdefault(group_id, []).append(face_id)

            # Find the largest non-unassociated group to assign faces to
            largest_group_id = max(
                (group_id for group_id in partition.keys() if group_id != unassociated_group_id), 
                key=lambda x: len(partition[x]), 
                default=None
            )
            largest_group_faces = partition.get(largest_group_id, [])
            add_faces = new_faces + largest_group_faces + partition.get(unassociated_group_id, [])

            if len(add_faces) >= minimal_group_size:
                if largest_group_id is None or largest_group_id == unassociated_group_id:
                    group_label = self.models.get_unique_label('groups', 'Person', '', brackets=False, event_id=self.event_id)
                    query = f"""
                        INSERT INTO groups (event_id, label) VALUES (%s, %s) RETURNING group_id;
                    """
                    largest_group_id = self.models.db.execute_query(query, (self.event_id, group_label), return_format=ReturnFormat.VALUE)
                
                query = f"""
                    WITH face_ids AS (
                        SELECT DISTINCT unnest(%s::uuid[]) AS face_id
                    )
                    UPDATE faces AS f
                    SET group_id = %s
                    FROM face_ids fi
                    WHERE f.face_id = fi.face_id
                """
                self.models.db.execute_query(query, (add_faces, largest_group_id))
                self.models.ensure_representative('groups', largest_group_id)

    def store_face_matches(self, face_matches: dict[str, list[dict]]):

        if not face_matches:
            return
        
        values = []
        for face_id, matches in face_matches.items():
            raw_matches_json = json.dumps(matches)
            values.extend([face_id, raw_matches_json])
        
        query = f"""
            INSERT INTO face_matches_raw (face_id, raw_matches)
            VALUES {','.join(['(%s, %s::jsonb)'] * len(face_matches))}
            ON CONFLICT (face_id) 
            DO UPDATE SET 
                raw_matches = EXCLUDED.raw_matches;
        """
        self.models.db.execute_query(query, values)

    def get_face_matches(self, face_ids: list[str]) -> dict[str, list[dict]]:
        """
        Retrieve face matches from the database.
        
        Args:
            face_ids: List of face IDs to retrieve matches for
            
        Returns:
            Dictionary mapping face_id to list of match dictionaries
        """
        if not face_ids:
            return {}
        
        query = """
            WITH face_ids AS (
                SELECT DISTINCT unnest(%s::uuid[]) AS face_id
            )
            SELECT face_id, raw_matches 
            FROM face_matches_raw fm
            INNER JOIN face_ids fi ON fm.face_id = fi.face_id;
        """
        results = self.models.db.execute_query(query, (face_ids,), return_format=ReturnFormat.LIST_DICTS)
        
        face_matches = {}
        for row in results:
            face_id = row['face_id']
            raw_matches = row['raw_matches']
            face_matches[face_id] = raw_matches if isinstance(raw_matches, list) else []
        
        return face_matches

    def delete_unready_images_in_upload(self, upload_id: int) -> int:
        """Delete unready images in an upload.
        Args:
            upload_id: upload id
        Returns:
            number of deleted images
        """
        images = self.models.get_upload_images(upload_id, status='READY', exclude_status=True)
        if images:
            self.delete_images(images)

        return len(images)

    def fail_pending_images(self, upload_id: int) -> int:
        """Fail pending images in an upload.
        Args:
            upload_id: upload id
        Returns:
            number of failed images
        """
        query = f"""
            UPDATE images SET status = 'FAILED' WHERE upload_id = %s AND status = 'PENDING_UPLOAD';
        """
        self.models.db.execute_query(query, (upload_id,))

    def delete_images(self, image_ids: list[str]) -> tuple[list[str], dict]:
        """Delete images and return list of deleted groups and dict of parents affected with parent entity as key and parent ids as value"""
        if not self.models.db.event_profile_context['can_upload_and_delete_images']:
            raise Forbidden("Profile not allowed to delete images")

        if not self.models.is_accessible('images', image_ids):
            raise Forbidden(f"Some of the images are not accessible to the profile")

        actor_profile_id = self.models.db.profile_context.get('profile_id')
        
        # Get image info for audit logging
        parents = self.models.get_parents('images', image_ids, bypass_ctx=True)
        self.models.update_image_status(image_ids, 'DELETING')
        
        from src.backend.tasks import delete_images_task
        delete_images_task.delay(self.event_id, actor_profile_id, image_ids)
        
        deleted_groups = []
        for group_id in parents.get('groups', []):
            if self.models.is_empty('groups', group_id):
                try:
                    self.models.delete('groups', group_id)                    
                    deleted_groups.append(group_id)
                except PolicyError as e:
                    continue
                except Forbidden as e:
                    continue
            elif self.models.is_empty('groups', group_id, only_accessible=True):
                deleted_groups.append(group_id)

        for entity, entity_ids in parents.items():
            parents[entity] = list(entity_ids)
            for entity_id in entity_ids:
                self.models.ensure_representative(entity, entity_id)
        
        # Log audit events for each deleted image
        return list(deleted_groups), parents
