import os
import shutil
import gc
from datetime import datetime
import re
import logging

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
                
    @staticmethod
    def delete_event(event_id: str):
        file_helper = get_file_helper()
        face_utils = FaceUtils(event_id, storage_backend=file_helper.storage)
        face_utils.rek_helper.delete_collection()
        
        if file_helper.is_local:
            # Local storage - delete directory
            event_dir = os.path.join(DATA_ROOT, event_id)
            if os.path.exists(event_dir):
                shutil.rmtree(event_dir)
        else:
            # S3 storage - delete all files with event_id prefix
            # Note: This is a simplified approach - in production you might want
            # to list and delete all objects with the prefix
            pass  # S3 cleanup can be handled by lifecycle policies or separate cleanup job
   
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
        rekognition_calls_limit = event_data['rekognition_calls_limit']
        rekognition_calls_used = event_data['rekognition_calls_used']
        if len(files_data) + images_count > images_count_limit:
            raise PolicyError(f"Upload would exceed image count limit. Current: {images_count}, Limit: {images_count_limit}, Attempting to add: {len(files_data)}")
        max_file_size = max(file_info['size'] for file_info in files_data)
        if max_file_size > image_size_limit_bytes:
            raise PolicyError(f"Max file size allowed is {image_size_limit_bytes} bytes, but file with size {max_file_size} bytes was provided")
        if rekognition_calls_used + len(files_data) > rekognition_calls_limit:
            raise PolicyError(f"Upload would exceed rekognition calls limit. Current: {rekognition_calls_used}, Limit: {rekognition_calls_limit}, Attempting to add: {len(files_data)}")
        
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
            rekognition_calls_used = event_data['rekognition_calls_used']
            rekognition_calls_limit = event_data['rekognition_calls_limit']
            if rekognition_calls_used + 1 > rekognition_calls_limit:
                raise PolicyError(f"Processing image would exceed rekognition calls limit. Current: {rekognition_calls_used}, Limit: {rekognition_calls_limit}, Attempting to add: {1}")
            self.models.add_rekognition_calls(1)
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

    def _cluster_faces(
        self,
        face_ids: list[str],
        minimal_group_size: int = 2,
        cluster_threshold: int = 90,
        max_matches_faces: int = 100,
    ) -> tuple[int, int]:
        """
        Cluster faces and create/update groups.
        
        Args:
            face_ids: List of face IDs to cluster
            minimal_group_size: Minimum number of faces required to create/join a group
            cluster_threshold: Similarity threshold for face clustering (0-100)
            max_matches_faces: Maximum number of faces to match for clustering
            
        Returns:
            Number of groups created, Number of groups related
        """        
        logger.info(f"Starting face clustering: face_ids_count={len(face_ids)}, cluster_threshold={cluster_threshold}, minimal_group_size={minimal_group_size}")
        
        # Get unassociated group ID
        query = f"""
            SELECT unassociated_group_id, rekognition_calls_used, rekognition_calls_limit FROM events WHERE event_id = %s;
        """
        unassociated_group_id, rekognition_calls_used, rekognition_calls_limit = self.models.db.execute_query(query, (self.event_id,), return_format=ReturnFormat.TUPLE)
        if rekognition_calls_used + len(face_ids) > rekognition_calls_limit:
            raise PolicyError(f"Clustering would exceed rekognition calls limit. Current: {rekognition_calls_used}, Limit: {rekognition_calls_limit}, Attempting to add: {len(face_ids)}")

        self.models.add_rekognition_calls(len(face_ids))
        logger.verbose(f"Clustering {len(face_ids)} faces using rekognition...")
        clusters = self.face_utils.cluster_faces(
            face_ids, 
            threshold_similarity=cluster_threshold, 
            max_matches_faces=max_matches_faces
        )
        logger.verbose(f"Face clustering completed: found {len(clusters)} clusters")
        groups_created = 0
        groups_related = 1 if len(face_ids) > 0 else 0

        for new_faces, existing_faces in clusters:
            if len(new_faces) + len(existing_faces) < minimal_group_size:
                logger.verbose(f"Skipping cluster: new_faces={len(new_faces)}, existing_faces={len(existing_faces)}, below minimal_group_size={minimal_group_size}")
                continue

            partition = {}
            for existing_face_id in existing_faces:
                query = f"""
                    SELECT group_id FROM faces WHERE face_id = %s;
                """
                group_id = self.models.db.execute_query(query, (existing_face_id,), return_format=ReturnFormat.VALUE)
                partition.setdefault(group_id, []).append(existing_face_id)

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
                    groups_created += 1
                    logger.verbose(f"Created new group: group_id={largest_group_id}, label={group_label}, faces_count={len(add_faces)}")
                else:
                    logger.verbose(f"Updating existing group: group_id={largest_group_id}, adding {len(add_faces)} faces")
                
                # Update faces directly in upload pipeline
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
                groups_related += 1

        logger.info(f"Face clustering completed: groups_created={groups_created}")

        return groups_created, groups_related

    def delete_unready_images_in_upload(self, upload_id: int) -> int:
        """Delete unready images in an upload.
        Args:
            upload_id: upload id
        Returns:
            number of deleted images
        """
        images = self.models.get_upload_images(upload_id)
        unready_image_ids = [img['image_id'] for img in images if img['status'] != 'READY']
        if unready_image_ids:
            self.delete_images(unready_image_ids)

        return len(unready_image_ids)

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
