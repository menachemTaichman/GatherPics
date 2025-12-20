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
from src.core import DATA_ROOT
from src.core.audit_log import AuditAction, log_audit
from src.core.storage import get_file_helper

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
        
        for i, file_info in enumerate(files_data):
            filename = filenames[i]
            file_size = file_sizes[i]
            label = labels[i]
            
            # Always store pending uploads in to_process using the generated image_id
            # so processing can rely on a stable "{image_id}.jpg" naming convention.
            image_id = self.models.add('images', {
                'label': label,
                'upload_id': upload_id,
                'status': 'PENDING_UPLOAD',
            })
            stored_filename = f"{image_id}.jpg"  # processing pipeline expects lowercase .jpg
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
                "image_id": image_id,
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

    def _process_face_crop(self, source_img, bbox, face_id, image_id, unassociated_group_id):
        """
        Process a single face: crop, resize, save.
        
        Args:
            source_img: PIL Image to crop from
            bbox: Bounding box dict with width, height, left, top
            face_id: UUID for the face
            image_id: UUID of the parent image
            unassociated_group_id: Group ID for unassociated faces
            
        Returns:
            dict with face data
        """
        logger.debug(f"Processing face crop: face_id={face_id}, image_id={image_id}")
        
        # Crop face with padding
        crop_img = crop_image(source_img, bbox, padding_width_percent=0.3, padding_height_percent=0.2)
        
        # Resize to max 150x150
        crop_img.thumbnail((150, 150), PILImage.Resampling.LANCZOS)
        
        # Save to buffer then upload via stream
        crop_path = f"{self.faces_dir}/{face_id}.webp"
        face_buffer = BytesIO()
        crop_img.save(face_buffer, format='WEBP', quality=70, optimize=True)
        face_file_size = face_buffer.tell()
        face_buffer.seek(0)
        self.file_helper.write_stream(crop_path, face_buffer, content_type='image/webp')
        
        logger.debug(f"Face crop saved: face_id={face_id}, file_size={face_file_size} bytes")
        
        del crop_img
        
        return {
            "image_id": image_id,
            "face_width": bbox['width'],
            "face_height": bbox['height'],
            "face_left": bbox['left'],
            "face_top": bbox['top'],
            "face_id": face_id,
            "group_id": unassociated_group_id,
            "file_size": face_file_size
        }

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
        
        def _save_image_to_storage(
            image: PILImage.Image,
            path: str,
            format: str,
            quality: int,
            optimize: bool,
            exif_bytes: bytes | None = None
            ) -> int:
            """Save image to storage and return file size"""
            content_type_dict = {
                'JPEG': 'image/jpeg',
                'WEBP': 'image/webp',
                'PNG': 'image/png'
            }
            content_type = content_type_dict[format]
            buffer = BytesIO()
            # Only pass exif parameter if it's not None and format supports it (JPEG)
            save_kwargs = {
                'format': format,
                'quality': quality,
                'optimize': optimize
            }
            if exif_bytes is not None and format == 'JPEG':
                save_kwargs['exif'] = exif_bytes
            image.save(buffer, **save_kwargs)
            file_size = buffer.tell()
            buffer.seek(0)
            self.file_helper.write_stream(path, buffer, content_type=content_type)
            return file_size

        try:
            # Read image from storage
            image_path = f"{self.to_process_dir}/{image_id}.jpg"
            logger.debug(f"Reading image from storage: {image_path}")
            image_bytes = self.file_helper.read(image_path)
            image_stream = BytesIO(image_bytes)
            file_size = len(image_bytes)
            logger.debug(f"Image read: file_size={file_size} bytes")
            
            # TODO: see if exif_bytes is enough for date_taken
            # Extract metadata
            metadata = extract_metadata_from_bytes(image_bytes)
            del image_bytes

            # Open image with context manager
            with PILImage.open(image_stream) as original_img:
                width, height = original_img.size
                date_taken = metadata.get('date_taken')
                logger.debug(f"Image dimensions: {width}x{height}, date_taken={date_taken}")
                
                # Extract EXIF for high quality version
                exif_bytes = original_img.getexif().tobytes() if original_img.getexif() else b''
                
                # Display (WebP)
                logger.debug("Creating display image...")
                display_img = resize_image(original_img, display_size)
                display_path = f"{self.display_dir}/{image_id}.webp"
                display_file_size = _save_image_to_storage(display_img, display_path, 'WEBP', 90, True)
                logger.debug(f"Display image saved: {display_file_size} bytes")
                del display_img
                
                # Thumb (WebP)
                logger.debug("Creating thumbnail image...")
                thumb_img = resize_image(original_img, thumb_size)
                thumb_path = f"{self.thumb_dir}/{image_id}.webp"
                thumb_file_size = _save_image_to_storage(thumb_img, thumb_path, 'WEBP', 80, True)
                logger.debug(f"Thumbnail image saved: {thumb_file_size} bytes")
                del thumb_img

                # High Quality (JPEG)
                logger.debug("Creating high quality image...")
                high_quality_img = resize_image(original_img, 4096)
                high_quality_path = f"{self.high_quality_dir}/{image_id}.jpg"
                high_quality_file_size = _save_image_to_storage(high_quality_img, high_quality_path, 'JPEG', 95, True, exif_bytes)
                logger.debug(f"High quality image saved: {high_quality_file_size} bytes")
                
            event_data = self.models.get_entities('events', self.event_id, include_details=True)
            unassociated_group_id = event_data['unassociated_group_id']
            rekognition_calls_used = event_data['rekognition_calls_used']
            rekognition_calls_limit = event_data['rekognition_calls_limit']
            if rekognition_calls_used + 1 > rekognition_calls_limit:
                raise PolicyError(f"Processing image would exceed rekognition calls limit. Current: {rekognition_calls_used}, Limit: {rekognition_calls_limit}, Attempting to add: {1}")
            self.models.add_rekognition_calls(1)
            logger.debug(f"Detecting faces in image: image_id={image_id}")
            detected_faces = self.face_utils.detect_faces(
                image=high_quality_img,
                external_image_id=image_id
            )
            image_faces = []
            
            logger.debug(f"Detected {len(detected_faces)} faces in image: image_id={image_id}")
            for face_id, bbox in detected_faces:
                face_data = self._process_face_crop(high_quality_img, bbox, face_id, image_id, unassociated_group_id)
                image_faces.append(face_data)
            
            # Free high quality image from memory
            del high_quality_img
            
            # Move original image to original directory and delete from to_process directory
            logger.debug("Moving original image to original directory...")
            original_path = f"{self.original_dir}/{image_id}.jpg"
            self.file_helper.copy(image_path, original_path, content_type='image/jpeg')
            self.file_helper.delete(image_path)

            # Update DB record with data
            logger.debug("Updating database record...")
            query = f"""
                SELECT set_transaction_context('include_pending_images', 'true');
                UPDATE images_ctx SET
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

            # Add faces to database
            if image_faces:
                logger.debug(f"Adding {len(image_faces)} faces to database for image: image_id={image_id}")
                all_faces_values = [[
                    face['face_id'], 
                    face['image_id'], 
                    face['face_width'], 
                    face['face_height'], 
                    face['face_left'], 
                    face['face_top'], 
                    face['group_id'], 
                    face['file_size']
                ] for face in image_faces]
                self.models.add_many('faces', [
                    'face_id', 'image_id', 'face_width', 'face_height', 
                    'face_left', 'face_top', 'group_id', 'file_size'
                ], all_faces_values)

            query = f"""
                SELECT set_transaction_context('include_pending_images', 'false');
            """
            self.models.db.execute_query(query)

            # Cleanup
            gc.collect()
            logger.info(f"Completed processing image: image_id={image_id}, faces_detected={len(image_faces)}")
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
        event_data = self.models.get_entities('events', self.event_id, include_details=True)
        unassociated_group_id = event_data['unassociated_group_id']
        rekognition_calls_used = event_data['rekognition_calls_used']
        rekognition_calls_limit = event_data['rekognition_calls_limit']
        if rekognition_calls_used + len(face_ids) > rekognition_calls_limit:
            raise PolicyError(f"Clustering would exceed rekognition calls limit. Current: {rekognition_calls_used}, Limit: {rekognition_calls_limit}, Attempting to add: {len(face_ids)}")

        self.models.add_rekognition_calls(len(face_ids))
        logger.debug(f"Clustering {len(face_ids)} faces using rekognition...")
        clusters = self.face_utils.cluster_faces(
            face_ids, 
            threshold_similarity=cluster_threshold, 
            max_matches_faces=max_matches_faces
        )
        logger.debug(f"Face clustering completed: found {len(clusters)} clusters")
        groups_created = 0
        groups_related = 1 if len(face_ids) > 0 else 0

        for new_faces, existing_faces in clusters:
            if len(new_faces) + len(existing_faces) < minimal_group_size:
                logger.debug(f"Skipping cluster: new_faces={len(new_faces)}, existing_faces={len(existing_faces)}, below minimal_group_size={minimal_group_size}")
                continue

            partition = {}
            for existing_face_id in existing_faces:
                group_id = self.models.get_entities('faces', existing_face_id).get('group_id')
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
                    largest_group_id = self.models.add('groups', {'label': group_label})
                    groups_created += 1
                    logger.debug(f"Created new group: group_id={largest_group_id}, label={group_label}, faces_count={len(add_faces)}")
                else:
                    logger.debug(f"Updating existing group: group_id={largest_group_id}, adding {len(add_faces)} faces")
                
                self.models.edit_childs('groups', largest_group_id, 'faces', add_faces, operation=ChildOperation.ADD)
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
            SELECT set_transaction_context('include_pending_images', 'true');
            UPDATE images_ctx SET status = 'FAILED' WHERE upload_id = %s AND status = 'PENDING_UPLOAD';
            SELECT set_transaction_context('include_pending_images', 'false');
        """
        self.models.db.execute_query(query, (upload_id,))

    def delete_images(self, image_ids: list[str]) -> tuple[list[str], dict]:
        """Delete images and return list of deleted groups and dict of parents affected with parent entity as key and parent ids as value"""
        # TODO: dont access db
        if not self.models.db.event_profile_context['can_upload_and_delete_images']:
            raise Forbidden("Profile not allowed to delete images")

        query = f"""
            SELECT set_transaction_context('include_pending_images', 'true');
        """
        self.models.db.execute_query(query)
        if not self.models.is_accessible('images', image_ids):
            raise Forbidden(f"Some of the images are not accessible to the profile")

        parents = {}
        deleted_groups = set()
        deleted_images_info = []
        actor_profile_id = self.models.db.profile_context.get('profile_id')
        
        # Get image info for audit logging
        query = f"""
            SELECT set_transaction_context('include_pending_images', 'true');
            SELECT image_id, label, status
            FROM images_ctx
            WHERE image_id IN ({','.join(['%s'] * len(image_ids))});
        """
        images_details = self.models.db.execute_query(query, image_ids, return_format=ReturnFormat.LIST_TUPLES)

        for image_id, label, status in images_details:
            image_parents = self.models.get_parents('images', image_id)

            face_ids = self.models.get_childs('images', image_id, 'faces', return_ids=True)
            self.models.delete('faces', face_ids)
            self.models.delete('images', image_id)
            self.face_utils.rek_helper.delete_faces(face_ids)
            for face_id in face_ids:
                face_path = f"{self.faces_dir}/{face_id}.webp"
                self.file_helper.delete(face_path)

            # Delete image files
            if status != 'READY':
                self.file_helper.delete(f"{self.to_process_dir}/{image_id}.jpg")
            self.file_helper.delete(f"{self.original_dir}/{image_id}.jpg")
            self.file_helper.delete(f"{self.high_quality_dir}/{image_id}.jpg")
            self.file_helper.delete(f"{self.display_dir}/{image_id}.webp")
            self.file_helper.delete(f"{self.thumb_dir}/{image_id}.webp")
            
            for group_id in image_parents.get('groups', set()):
                if self.models.is_empty('groups', group_id):
                    try:
                        self.models.delete('groups', group_id)                    
                        deleted_groups.add(group_id)
                    except PolicyError as e:
                        continue
                    except Forbidden as e:
                        continue
                    
                    set(image_parents.get('groups', set())).discard(group_id)
                elif self.models.is_empty('groups', group_id, only_accessible=True):
                    self.models.ensure_representative('groups', group_id)
                    
                    deleted_groups.add(group_id)
                    set(image_parents.get('groups', set())).discard(group_id)

            # Store image info for audit log
            deleted_images_info.append({
                'image_id': image_id,
                'image_label': label,
                'faces_count': len(face_ids)
            })
            
            for entity, entity_ids in image_parents.items():
                parents.setdefault(entity, set()).update(entity_ids)

        query = f"""
            SELECT set_transaction_context('include_pending_images', 'false');
        """
        self.models.db.execute_query(query)

        for entity, entity_ids in parents.items():
            parents[entity] = list(entity_ids)
            for entity_id in entity_ids:
                self.models.ensure_representative(entity, entity_id)
        
        # Log audit events for each deleted image
        for img_info in deleted_images_info:
            log_audit(
                action=AuditAction.IMAGE_DELETED,
                actor_profile_id=actor_profile_id,
                details={
                    'image_id': img_info['image_id'],
                    'image_label': img_info['image_label'],
                    'event_id': self.event_id,
                    'faces_count': img_info['faces_count'],
                }
            )
                
        return list(deleted_groups), parents

    # TODO: remove
    def process_new_images(
        self,
        file_names: list[str] | None = None,
        display_size: int = 2048,
        thumb_size: int = 512,
        cluster_threshold: int = 90,
        max_matches_faces: int = 100,
        minimal_group_size: int = 2,
        verbose: bool = True,
        assign_moments: bool = False,
        progress_callback=None,
    ) -> dict:
        """
        Process images from to_process folder.
        Args:
            file_names: List of specific file names to process. If None, processes all image files in to_process folder.
            display_size: Size for display images (width, height)
            thumb_size: Size for thumbnail images (width, height) 
            cluster_threshold: Similarity threshold for face clustering (0-100)
            max_matches_faces: Maximum number of faces to match for clustering
            minimal_group_size: Minimum number of faces required to create/join a group
            verbose: Whether to print progress messages
            assign_moments: Whether to assign images to moments by time
            progress_callback: Optional callback function to report progress (receives dict with step info)
        Returns:
            dict: Summary of processing results
        """
        from ..utils.image_utils import resize_image, crop_image, extract_metadata_from_bytes, save_image
        import os
        from PIL import Image as PILImage
        from io import BytesIO

        def _log(message: str):
            if verbose:
                print(f"{datetime.now().isoformat()}: {message}")

        def _send_progress(step: str, current: int = 0, total: int = 0, message: str = ''):
            """Send progress update to callback if provided."""
            if progress_callback:
                progress_callback({
                    'step': step,
                    'current': current,
                    'total': total,
                    'message': message
                })

        def _get_images_to_process():
            if file_names is not None:
                # Validate that specified files exist and have valid extensions
                valid_files = []
                for f in file_names:
                    if f.lower().endswith((".jpg", ".jpeg", ".png", ".bmp", ".tiff")):
                        file_path = f"{self.to_process_dir}/{f}"
                        if self.file_helper.exists(file_path):
                            valid_files.append(f)
                return valid_files
            else:
                # Process all image files
                if self.file_helper.is_local:
                    # Local storage - list directory
                    full_path = self.file_helper.get_file_path(self.to_process_dir)
                    return [f for f in os.listdir(full_path) 
                            if f.lower().endswith((".jpg", ".jpeg", ".png", ".bmp", ".tiff"))]
                else:
                    # S3 storage - would need to list objects (simplified for now)
                    # In production, you'd use boto3 list_objects_v2
                    # For now, return empty - files should be specified by name
                    return []

        def _process_face(source_img, bbox, face_id, image_id, unassociated_group_id):
            # 1. Crop face with padding
            crop_img = crop_image(source_img, bbox, padding_width_percent=0.3, padding_height_percent=0.2)
            
            # 2. Resize to max 150x150 for smaller file size (maintains aspect ratio)
            crop_img.thumbnail((150, 150), PILImage.Resampling.LANCZOS)
            
            # 3. Save to buffer then upload via stream (avoids reading entire buffer into memory)
            crop_path = f"{self.faces_dir}/{face_id}.webp"
            face_buffer = BytesIO()
            crop_img.save(face_buffer, format='WEBP', quality=70, optimize=True)
            face_file_size = face_buffer.tell()  # Get size before seeking
            face_buffer.seek(0)
            self.file_helper.write_stream(crop_path, face_buffer, content_type='image/webp')
            
            del crop_img
            
            return {
                "image_id": image_id,
                "face_width": bbox['width'],  # Original bbox dimensions from detection
                "face_height": bbox['height'],
                "face_left": bbox['left'],
                "face_top": bbox['top'],
                "face_id": face_id,
                "group_id": unassociated_group_id,
                "file_size": face_file_size
            }

        def _cluster_and_group_faces(face_ids: list[str], minimal_group_size: int, unassociated_group_id: str):
            clusters = self.face_utils.cluster_faces(face_ids, threshold_similarity=cluster_threshold, max_matches_faces=max_matches_faces)
            groups_created = 0
            
            for new_faces, existing_faces in clusters:
                if len(new_faces) + len(existing_faces) < minimal_group_size:
                    continue

                partition = {}
                for existing_face_id in existing_faces:
                    group_id = self.models.get_entities('faces', existing_face_id).get('group_id')
                    partition.setdefault(group_id, []).append(existing_face_id)

                # Find the largest non-unassociated group to assign faces to
                largest_group_id = max((group_id for group_id in partition.keys() if group_id != unassociated_group_id), key=lambda x: len(partition[x]), default=None)
                largest_group_faces = partition.get(largest_group_id, [])
                add_faces = new_faces + largest_group_faces + partition.get(unassociated_group_id, [])

                if len(add_faces) >= minimal_group_size:
                    if largest_group_id is None or largest_group_id == unassociated_group_id:
                        group_label = self.models.get_unique_label('groups', 'Person', '', brackets=False, event_id=self.event_id)
                        largest_group_id = self.models.add('groups', {'label': group_label})
                        groups_created += 1
                    
                    self.models.edit_childs('groups', largest_group_id, 'faces', add_faces, operation=ChildOperation.ADD)

            return groups_created

        def _process_image(image_file, unassociated_group_id: str, upload_id: str):
            # Read image from storage once
            image_path = f"{self.to_process_dir}/{image_file}"
            image_bytes = self.file_helper.read(image_path)
            image_stream = BytesIO(image_bytes)
            file_size = len(image_bytes)
            
            # Extract metadata (lightweight operation)
            metadata = extract_metadata_from_bytes(image_bytes)
            
            try:
                # Open image with context manager for proper resource management
                with PILImage.open(image_stream) as original_img:
                    width, height = original_img.size
                    date_taken = metadata.get('date_taken')
                    image_name, image_ext = os.path.splitext(image_file)
                    
                    # Extract EXIF for high quality version
                    exif_bytes = original_img.getexif().tobytes() if original_img.getexif() else b''
                    
                    # Create DB record
                    label = self.models.get_unique_label('images', image_name, image_ext, brackets=True, event_id=self.event_id)
                    image_id = self.models.add(
                        'images',
                        {
                            'label': label,
                            'date_taken': date_taken,
                            'file_size': file_size,
                            'width': width,
                            'height': height,
                            'upload_id': upload_id
                        }
                    )
                    
                    # --- STAGE A: High Quality (used for face detection and cropping) ---
                    high_quality_img = resize_image(original_img, 4096)
                    high_quality_path = f"{self.high_quality_dir}/{image_id}.jpg"
                    
                    # Save HQ to buffer then upload via stream (avoids reading entire buffer into memory)
                    hq_buffer = BytesIO()
                    high_quality_img.save(hq_buffer, format='JPEG', quality=95, optimize=True, exif=exif_bytes)
                    high_quality_file_size = hq_buffer.tell()  # Get size from buffer position (before seeking)
                    hq_buffer.seek(0)
                    self.file_helper.write_stream(high_quality_path, hq_buffer, content_type='image/jpeg')
                    
                    # --- STAGE B: Face Detection & Cropping (use high quality for better results) ---
                    # Rekognition now always receives raw bytes; image_path kept only for storage bookkeeping.
                    detected_faces = self.face_utils.detect_faces(image=high_quality_img, external_image_id=image_id)
                    image_faces = []
                    for face_id, bbox in detected_faces:
                        # Use high_quality_img for better face cropping quality
                        face_data = _process_face(high_quality_img, bbox, face_id, image_id, unassociated_group_id)
                        image_faces.append(face_data)
                    
                    # Free high quality image from memory after face processing
                    del high_quality_img
                    
                    # --- STAGE C: Display & Thumb ---
                    # Display (WebP)
                    display_img = resize_image(original_img, display_size)
                    display_path = f"{self.display_dir}/{image_id}.webp"
                    
                    disp_buffer = BytesIO()
                    display_img.save(disp_buffer, format='WEBP', quality=90, optimize=True)
                    display_file_size = disp_buffer.tell()  # Get size before seeking
                    disp_buffer.seek(0)
                    self.file_helper.write_stream(display_path, disp_buffer, content_type='image/webp')
                    del display_img
                    
                    # Thumb (WebP)
                    thumb_img = resize_image(original_img, thumb_size)
                    thumb_path = f"{self.thumb_dir}/{image_id}.webp"
                    
                    thumb_buffer = BytesIO()
                    thumb_img.save(thumb_buffer, format='WEBP', quality=80, optimize=True)
                    thumb_file_size = thumb_buffer.tell()  # Get size before seeking
                    thumb_buffer.seek(0)
                    self.file_helper.write_stream(thumb_path, thumb_buffer, content_type='image/webp')
                    del thumb_img
                
                # --- STAGE D: Original Copy (server-side copy, no data transfer) ---
                original_path = f"{self.original_dir}/{image_id}.jpg"
                self.file_helper.copy(image_path, original_path, content_type='image/jpeg')
                
                # Update DB with file sizes
                self.models.edit('images', image_id, {
                    'high_quality_file_size': high_quality_file_size,
                    'display_file_size': display_file_size,
                    'thumb_file_size': thumb_file_size
                })
                
                # Cleanup
                del image_bytes  # Free original bytes from memory
                self.file_helper.delete(image_path)  # Delete processed file
                gc.collect()  # Free memory after processing
                
                return image_id, image_faces, None

            except Exception as e:
                # Cleanup on error
                gc.collect()
                # TODO: Should we delete the file here on error? Or let outer handler clean up?
                # Current: File remains in to_process if _process_image fails
                return None, [], e

        # Check limitations before starting
        _send_progress('validation', 0, 1, 'Checking upload limits...')
        
        _log("Starting image processing")
        
        # Get current image count
        current_count = self.models.get_images_count()
        event_data = self.models.get_entities('events', self.event_id, include_details=True)
        images_count_limit = event_data['images_count_limit']
        image_size_limit_bytes = event_data['image_size_limit_bytes']
        calls_limit = event_data['rekognition_calls_limit']
        calls_used = event_data['rekognition_calls_used']
        
        image_files = _get_images_to_process()
        if not image_files:
            _log("No images found in to_process folder")
            _send_progress('complete', 0, 0, 'No images to process')
            return {
                'images_processed': 0,
                'faces_detected': 0,
                'groups_created': 0,
                'errors': []
            }
        
        # Check count limit
        if int(current_count) + len(image_files) > int(images_count_limit):
            error_msg = f"Upload would exceed image count limit. Current: {current_count}, Limit: {images_count_limit}, Attempting to add: {len(image_files)}"
            _log(error_msg)
            _send_progress('error', 0, 0, error_msg)
            raise PolicyError(error_msg)

        # Check size limits
        total_size = 0
        files_exceeding_limit = []
        for image_file in image_files:
            file_path = f"{self.to_process_dir}/{image_file}"
            file_size = self.file_helper.get_file_size(file_path)
            if image_size_limit_bytes > 0 and file_size > image_size_limit_bytes:
                files_exceeding_limit.append((image_file, file_size))
            total_size += file_size
        
        if files_exceeding_limit:
            error_msg = f"{len(files_exceeding_limit)} file(s) exceed size limit of {image_size_limit_bytes} bytes: " + ", ".join([f"{name} ({size} bytes)" for name, size in files_exceeding_limit[:3]])
            _log(error_msg)
            _send_progress('error', 0, 0, error_msg)
            raise PolicyError(error_msg)
        
        if int(calls_used) + len(image_files) > int(calls_limit):
            error_msg = f"Upload would exceed rekognition calls limit. Current: {calls_used}, Limit: {calls_limit}, Attempting to add: {len(image_files)}"
            _log(error_msg)
            _send_progress('error', 0, 0, error_msg)
            raise PolicyError(error_msg)
        
        _log(f"Found {len(image_files)} images to process")
        
        _send_progress('validation', 1, 1, f'Validation complete. Processing {len(image_files)} images...')

        upload_id = self.models.add('uploads', {
            'started_at': datetime.now().isoformat(),
            'status': 'processing',
            'images_count': len(image_files),
            'faces_count': 0,
            'clusters_count': 0,
            'moments_count': 0,
            'errors': [],
        })

        all_faces = []
        processed_images = []
        processed_file_names = []  # Track which files were successfully processed
        errors = []
        
        try:
            unassociated_group_id = self.models.get_entities('events', self.event_id, include_details=True)['unassociated_group_id']
            for i, image_file in enumerate(image_files, 1):
                _send_progress('processing', i, len(image_files), f'Processing image {i}/{len(image_files)}: {image_file}')
                _log(f"Processing image {i}/{len(image_files)}: {image_file}")
                
                self.models.add_rekognition_calls(1)
                image_id, image_faces, error = _process_image(image_file, unassociated_group_id, upload_id)
                if error is not None or image_id is None:
                    error_msg = f"Error processing {image_file}: {str(error) if error else 'Invalid image or id'}"
                    _log(f"  {error_msg}")
                    errors.append(error_msg)
                    continue
                _log(f"  Detected {len(image_faces)} faces")
                all_faces.extend(image_faces)
                processed_images.append(image_id)
                processed_file_names.append(image_file)  # Track successfully processed file
                gc.collect()  # Free memory between image processing iterations

            _log(f"Completed image processing. Detected {len(all_faces)} total faces")
            
            _send_progress('faces', 0, 1, 'Adding faces to database...')
            if all_faces:
                _log("Adding faces to database...")
                all_faces_values = [[face['face_id'], face['image_id'], face['face_width'], face['face_height'], face['face_left'], face['face_top'], face['group_id'], face['file_size']] for face in all_faces]
                self.models.add_many('faces', ['face_id', 'image_id', 'face_width', 'face_height', 'face_left', 'face_top', 'group_id', 'file_size'], all_faces_values)
                _send_progress('clustering', 0, 1, 'Clustering faces...')
                _log("Clustering faces...")

                self.models.add_rekognition_calls(len(all_faces_values))
                groups_created = _cluster_and_group_faces([face[0] for face in all_faces_values], minimal_group_size, unassociated_group_id)
            else:
                groups_created = 0
            
            # Assign moments by time if requested
            assigned_moments = {}
            if assign_moments and processed_images:
                _send_progress('moments', 0, 1, 'Assigning images to moments by time...')
                _log("Assigning images to moments by time...")
                assigned_moments = self.models.assign_moments_by_time(processed_images)
                _log(f"  Assigned {sum(len(imgs) for imgs in assigned_moments.values())} images to {len(assigned_moments)} moments")
            
            self.models.edit('uploads', upload_id, {
                'completed_at': datetime.now().isoformat(),
                'status': 'completed',
                'faces_count': len(all_faces),
                'clusters_count': groups_created,
                'moments_count': sum(len(imgs) for imgs in assigned_moments.values()),
                'errors': errors,
            })

            summary = {
                'upload_id': upload_id,
                'images_processed': len(processed_images),
                'faces_detected': len(all_faces),
                'groups_created': groups_created,
                'processed_image_ids': processed_images,
                'assigned_moments': assigned_moments,
                'errors': errors
            }
            
            _send_progress('finalizing', 1, 1, f'Processing complete! Processed {len(processed_images)} images.')
            
            _log("Processing complete!")
            _log(f"  - Images processed: {summary['images_processed']}")
            _log(f"  - Faces detected: {summary['faces_detected']}")
            _log(f"  - Groups created: {summary['groups_created']}")
            if assign_moments:
                _log(f"  - Images assigned to moments: {sum(len(imgs) for imgs in assigned_moments.values())}")

            self.models.db.execute_query('ANALYZE;')
            
            # Log audit event for upload
            actor_profile_id = self.models.db.profile_context.get('profile_id')
            log_audit(
                action=AuditAction.UPLOAD_MADE,
                actor_profile_id=actor_profile_id,
                details={
                    'upload_id': upload_id,
                    'event_id': self.event_id,
                    'images_processed': summary['images_processed'],
                    'faces_detected': summary['faces_detected'],
                }
            )

            return summary
        
        except Exception as e:
            # Update upload record with failure status
            error_msg = f"Upload failed: {str(e)}"
            errors.append(error_msg)
            
            # Cleanup unprocessed files only (files that weren't successfully processed)
            cleanup_errors = []
            if file_names is not None:
                unprocessed_files = [f for f in file_names if f not in processed_file_names]
                if unprocessed_files:
                    _log(f"Cleaning up {len(unprocessed_files)} unprocessed files")
                    for unprocessed_file in unprocessed_files:
                        try:
                            file_path = f"{self.to_process_dir}/{unprocessed_file}"
                            if self.file_helper.exists(file_path):
                                self.file_helper.delete(file_path)
                        except Exception as cleanup_error:
                            cleanup_error_msg = f"Failed to cleanup {unprocessed_file}: {str(cleanup_error)}"
                            _log(f"  {cleanup_error_msg}")
                            cleanup_errors.append(cleanup_error_msg)
            
            # Add cleanup errors to the errors list
            errors.extend(cleanup_errors)
            
            # Update upload record with all errors (including cleanup errors)
            self.models.edit('uploads', upload_id, {
                'completed_at': datetime.now().isoformat(),
                'status': 'failed',
                'errors': errors,
            })
            _log(f"Processing failed: {error_msg}")
            _send_progress('error', 0, 0, error_msg)
            
            raise
