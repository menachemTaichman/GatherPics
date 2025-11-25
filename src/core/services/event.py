import os
import shutil
from datetime import datetime

from src.core.errors import Forbidden, DBPolicyError
from src.core.utils.face_utils import FaceUtils
from src.core.models.event_models import EventModels, ChildOperation
from src.core import DATA_ROOT

class Event():
    """Event model for managing event data and operations."""

    @staticmethod
    def create_event(event_id: str):
        event_dir = os.path.join(DATA_ROOT, event_id)
        os.makedirs(event_dir, exist_ok=True)
        os.makedirs(os.path.join(event_dir, 'display'), exist_ok=True)
        os.makedirs(os.path.join(event_dir, 'original'), exist_ok=True)
        os.makedirs(os.path.join(event_dir, 'thumb'), exist_ok=True)
        os.makedirs(os.path.join(event_dir, 'to_process'), exist_ok=True)
        os.makedirs(os.path.join(event_dir, 'faces'), exist_ok=True)
        os.makedirs(os.path.join(event_dir, 'high_quality'), exist_ok=True)
                
    @staticmethod
    def delete_event(event_id: str):
        face_utils = FaceUtils(event_id)
        face_utils.rek_helper.delete_collection()
        event_dir = os.path.join(DATA_ROOT, event_id)
        if os.path.exists(event_dir):
            shutil.rmtree(event_dir)
   
    def __init__(self, event_id: str, profile_id: str | None = None, public_code: str | None = None):
        event_dir = os.path.join(DATA_ROOT, event_id)
        
        self.event_id = event_id
        self.models = EventModels(event_id, profile_id, public_code)
        self.face_utils = FaceUtils(event_id)
        self.display_dir = os.path.join(event_dir, 'display')
        self.original_dir = os.path.join(event_dir, 'original')
        self.thumb_dir = os.path.join(event_dir, 'thumb')
        self.to_process_dir = os.path.join(event_dir, 'to_process')
        self.faces_dir = os.path.join(event_dir, 'faces')
        self.high_quality_dir = os.path.join(event_dir, 'high_quality')

    def delete_images(self, image_ids: list[str]) -> tuple[list[str], dict]:
        """Delete images and return list of deleted groups and dict of parents affected with parent entity as key and parent ids as value"""
        # TODO: dont access db
        if not self.models.db.event_profile_context['can_upload_and_delete_images']:
            raise Forbidden("Profile not allowed to delete images")

        for image_id in image_ids:
            if not self.models.is_image_deletable(image_id):
                raise Forbidden(f"Profile not allowed to delete {image_id}")

        parents = {}
        deleted_groups = set()
        for image_id in image_ids:
            image_parents = self.models.get_parents('images', image_id)

            face_ids = self.models.get_childs('images', image_id, 'faces', return_ids=True)
            self.models.delete('faces', face_ids)
            self.models.delete('images', image_id)
            self.face_utils.rek_helper.delete_faces(face_ids)
            for face_id in face_ids:
                try:
                    os.remove(os.path.join(self.faces_dir, f"{face_id}.webp"))
                except FileNotFoundError:
                    pass

            try:
                os.remove(os.path.join(self.original_dir, f"{image_id}.jpg"))
                os.remove(os.path.join(self.high_quality_dir, f"{image_id}.jpg"))
                os.remove(os.path.join(self.display_dir, f"{image_id}.webp"))
                os.remove(os.path.join(self.thumb_dir, f"{image_id}.webp"))
            except FileNotFoundError:
                pass
            
            for group_id in image_parents.get('groups', set()):
                if self.models.is_empty('groups', group_id):
                    try:
                        self.models.delete('groups', group_id)                    
                        deleted_groups.add(group_id)
                    except DBPolicyError as e:
                        continue
                    except Forbidden as e:
                        continue
                    
                    set(image_parents.get('groups', set())).discard(group_id)
                elif self.models.is_empty('groups', group_id, only_accessible=True):
                    self.models.ensure_representative('groups', group_id)
                    
                    deleted_groups.add(group_id)
                    set(image_parents.get('groups', set())).discard(group_id)

            for entity, entity_ids in image_parents.items():
                parents.setdefault(entity, set()).update(entity_ids)

        for entity, entity_ids in parents.items():
            parents[entity] = list(entity_ids)
            for entity_id in entity_ids:
                self.models.ensure_representative(entity, entity_id)
                
        return list(deleted_groups), parents

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
        from ..utils.image_utils import resize_image, crop_image, extract_all_metadata, save_image
        import os
        import shutil
        from PIL import Image as PILImage

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
                        file_path = os.path.join(self.to_process_dir, f)
                        if os.path.exists(file_path):
                            valid_files.append(f)
                return valid_files
            else:
                # Process all image files in the directory
                return [f for f in os.listdir(self.to_process_dir) 
                        if f.lower().endswith((".jpg", ".jpeg", ".png", ".bmp", ".tiff"))]

        def _process_face(display_img, bbox, face_id, image_id, unassociated_group_id):
            crop_img = crop_image(display_img, bbox, padding_width_percent=0.3, padding_height_percent=0.2)
            crop_path = os.path.join(self.faces_dir, f"{face_id}.webp")
            save_image(
                crop_img, crop_path, format='WEBP', quality=90, optimize=True
            )
            return {
                "image_id": image_id,
                "face_width": bbox['width'],
                "face_height": bbox['height'],
                "face_left": bbox['left'],
                "face_top": bbox['top'],
                "face_id": face_id,
                "group_id": unassociated_group_id
            }

        def _cluster_and_group_faces(face_ids: list[str], minimal_group_size: int, unassociated_group_id: str):
            clusters = self.face_utils.cluster_faces(face_ids, threshold_similarity=cluster_threshold, max_matches_faces=max_matches_faces)
            print(f"Clusters: {clusters}")
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
                        group_num = self.models.get_last_group_num() + 1
                        largest_group_id = self.models.add('groups', {'label': f"Person {group_num}"})
                        groups_created += 1
                    
                    self.models.edit_childs('groups', largest_group_id, 'faces', add_faces, operation=ChildOperation.ADD)

            return groups_created

        def _process_image(image_file, unassociated_group_id, upload_id):
            image_path = os.path.join(self.to_process_dir, image_file)
            try:
                original_img = PILImage.open(image_path)
                width, height = original_img.size
                file_size = os.path.getsize(image_path)
                # Extract all metadata (including EXIF and date_taken)
                metadata = extract_all_metadata(image_path)
                date_taken = metadata.get('date_taken')
                exif_bytes = original_img.getexif().tobytes() if original_img.getexif() else b''
                label = image_file
                i = 2
                while self.models.is_exists('images', {'label': label}):
                    label = f"{label} ({i})"
                    i += 1

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
                # Save high quality (4096px, jpg, quality=95, with EXIF)
                high_quality_img = resize_image(original_img, 4096)
                high_quality_path = os.path.join(self.high_quality_dir, f"{image_id}.jpg")
                save_image(
                    high_quality_img, high_quality_path, exif=exif_bytes, format='JPEG', quality=95, optimize=True
                )
                # Save display (2048px, webp, quality=90)
                display_img = resize_image(original_img, display_size)
                display_path = os.path.join(self.display_dir, f"{image_id}.webp")
                save_image(
                    display_img, display_path, format='WEBP', quality=90, optimize=True
                )
                # Save thumb (512px, webp, quality=80)
                thumb_img = resize_image(original_img, thumb_size)
                thumb_path = os.path.join(self.thumb_dir, f"{image_id}.webp")
                save_image(
                    thumb_img, thumb_path, format='WEBP', quality=80, optimize=True
                )
                # Save original (copy)
                original_save_path = os.path.join(self.original_dir, image_id + '.jpg')
                shutil.copy2(image_path, original_save_path)
                # Process faces for this image (use display image for AWS, crop from display)
                detected_faces = self.face_utils.detect_faces(display_img, external_image_id=image_id)
                image_faces = []
                for face_id, bbox in detected_faces:
                    face_data = _process_face(original_img, bbox, face_id, image_id, unassociated_group_id)
                    image_faces.append(face_data)
                original_img.close()
                os.remove(image_path)
                return display_img, image_id, image_faces, None
            except Exception as e:
                return None, None, [], e

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
        print(int(current_count) + len(image_files) > int(images_count_limit))
        if int(current_count) + len(image_files) > int(images_count_limit):
            error_msg = f"Upload would exceed image count limit. Current: {current_count}, Limit: {images_count_limit}, Attempting to add: {len(image_files)}"
            _log(error_msg)
            _send_progress('error', 0, 0, error_msg)
            raise DBPolicyError(error_msg)

        # Check size limits
        total_size = 0
        files_exceeding_limit = []
        for image_file in image_files:
            file_path = os.path.join(self.to_process_dir, image_file)
            file_size = os.path.getsize(file_path)
            if image_size_limit_bytes > 0 and file_size > image_size_limit_bytes:
                files_exceeding_limit.append((image_file, file_size))
            total_size += file_size
        
        if files_exceeding_limit:
            error_msg = f"{len(files_exceeding_limit)} file(s) exceed size limit of {image_size_limit_bytes} bytes: " + ", ".join([f"{name} ({size} bytes)" for name, size in files_exceeding_limit[:3]])
            _log(error_msg)
            _send_progress('error', 0, 0, error_msg)
            raise DBPolicyError(error_msg)
        
        if int(calls_used) + len(image_files) > int(calls_limit):
            error_msg = f"Upload would exceed rekognition calls limit. Current: {calls_used}, Limit: {calls_limit}, Attempting to add: {len(image_files)}"
            _log(error_msg)
            _send_progress('error', 0, 0, error_msg)
            raise DBPolicyError(error_msg)
        
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
        errors = []
        
        try:
            unassociated_group_id = self.models.get_entities('events', self.event_id, include_details=True)['unassociated_group_id']
            for i, image_file in enumerate(image_files, 1):
                _send_progress('processing', i, len(image_files), f'Processing image {i}/{len(image_files)}: {image_file}')
                _log(f"Processing image {i}/{len(image_files)}: {image_file}")
                
                self.models.add_rekognition_calls(1)
                display_img, image_id, image_faces, error = _process_image(image_file, unassociated_group_id, upload_id)
                if error is not None or display_img is None or image_id is None:
                    error_msg = f"Error processing {image_file}: {str(error) if error else 'Invalid image or id'}"
                    _log(f"  {error_msg}")
                    errors.append(error_msg)
                    continue
                _log(f"  Detected {len(image_faces)} faces")
                all_faces.extend(image_faces)
                processed_images.append(image_id)

            _log(f"Completed image processing. Detected {len(all_faces)} total faces")
            
            _send_progress('faces', 0, 1, 'Adding faces to database...')
            if all_faces:
                _log("Adding faces to database...")
                all_faces_values = [[face['face_id'], face['image_id'], face['face_width'], face['face_height'], face['face_left'], face['face_top'], face['group_id']] for face in all_faces]
                self.models.add_many('faces', ['face_id', 'image_id', 'face_width', 'face_height', 'face_left', 'face_top', 'group_id'], all_faces_values)
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

            return summary
        
        except Exception as e:
            # Update upload record with failure status
            error_msg = f"Upload failed: {str(e)}"
            errors.append(error_msg)
            self.models.edit('uploads', upload_id, {
                'completed_at': datetime.now().isoformat(),
                'status': 'failed',
                'errors': errors,
            })
            _log(f"Processing failed: {error_msg}")
            _send_progress('error', 0, 0, error_msg)
            raise
