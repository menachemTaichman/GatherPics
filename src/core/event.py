import os
import shutil
from datetime import datetime
from .errors import Forbidden, DBConstant
from .face_utils import FaceUtils
from .event_db import EventDB
from .event_models import EventModels

DATA_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../data'))

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
        
        # Create event DB
        event_db_path = os.path.join(event_dir, f'{event_id}.db')
        _ = EventDB.create_db(event_db_path)
        
    @staticmethod
    def delete_event(event_id: str):
        face_utils = FaceUtils(event_id)
        face_utils.rek_helper.delete_collection()
        event_dir = os.path.join(DATA_ROOT, event_id)
        shutil.rmtree(event_dir)
   
    def __init__(self, event_id: str, profile_id: str):
        event_dir = os.path.join(DATA_ROOT, event_id)
        
        self.event_id = event_id
        self.models = EventModels(event_id, profile_id)
        self.face_utils = None
        self.display_dir = os.path.join(event_dir, 'display')
        self.original_dir = os.path.join(event_dir, 'original')
        self.thumb_dir = os.path.join(event_dir, 'thumb')
        self.to_process_dir = os.path.join(event_dir, 'to_process')
        self.faces_dir = os.path.join(event_dir, 'faces')
        self.high_quality_dir = os.path.join(event_dir, 'high_quality')

    @property
    def profile_context(self) -> dict | None:
        """Get the current profile context."""
        return self.models.db.profile_context

    def sync_profile_to_event_db(self, profile_id: str, upsert: bool = True, hierarchy_rank: int = 0):
        self.models.sync_profile_to_event_db(profile_id, upsert=upsert, hierarchy_rank=hierarchy_rank)

    def delete_images(self, image_ids: list[str]) -> tuple[list[str], dict]:
        """Delete images and return list of deleted groups and dict of parents affected with parent entity as key and parent ids as value"""
        if not self.profile_context['can_upload_and_delete_images']:
            raise Forbidden("Profile not allowed to delete images")

        for image_id in image_ids:
            if not self.models.is_image_deletable(image_id):
                raise Forbidden(f"Profile not allowed to delete {image_id}")

        parents = {}
        deleted_groups = set()
        for image_id in image_ids:
            image_parents = self.models.get_parents('images', image_id)

            face_ids = self.models.get_childs('images', image_id, 'faces', return_ids=True)
            if not self.face_utils:
                self.face_utils = FaceUtils(self.event_id)
            
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
                    except DBConstant as e:
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
        verbose: bool = True,
        assign_moments: bool = False,
        progress_callback=None,
        images_count_limit: int = 0,
        image_size_limit_bytes: int = 0
    ) -> dict:
        """
        Process images from to_process folder.
        Args:
            file_names: List of specific file names to process. If None, processes all image files in to_process folder.
            display_size: Size for display images (width, height)
            thumb_size: Size for thumbnail images (width, height) 
            cluster_threshold: Similarity threshold for face clustering (0-100)
            max_matches_faces: Maximum number of faces to match for clustering
            verbose: Whether to print progress messages
            assign_moments: Whether to assign images to moments by time
            progress_callback: Optional callback function to report progress (receives dict with step info)
            images_count_limit: Limit of the event images count
            image_size_limit_bytes: Limit of the event image size
        Returns:
            dict: Summary of processing results
        """
        from .image_utils import resize_image, crop_image, extract_all_metadata, save_image
        import os
        import shutil
        from PIL import Image as PILImage

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
                "width": bbox['width'],
                "height": bbox['height'],
                "left": bbox['left'],
                "top": bbox['top'],
                "face_id": face_id,
                "group_id": unassociated_group_id
            }

        def _get_valid_group_label_number() -> str:
            group_num = self.models.get_last_group_num() + 1
            for _ in range(1000):
                label = f"Person {group_num}"
                if self.models.is_exists('groups', {'label': label}):
                    group_num += 1
                else:
                    return group_num
            
            raise Exception(f"Failed to find a unique group label after 100 attempts")

        def _cluster_and_group_faces(face_ids):
            clusters = self.face_utils.cluster_faces(face_ids, threshold_similarity=cluster_threshold, max_matches_faces=max_matches_faces)
            groups_created = 0
            for cluster_identifier, new_faces in clusters:
                if cluster_identifier != 'new':
                    existing_face_id = cluster_identifier
                    existing_group_id = self.models.get_entities('faces', existing_face_id).get('group_id', None)
                    if existing_group_id:
                        # Add new faces to the existing group
                        self.models.edit_childs('groups', existing_group_id, 'faces', new_faces, add=True)
                        continue

                    new_faces += [existing_face_id]

                group_num = _get_valid_group_label_number()
                group_id = self.models.add('groups', {'label': f"Person {group_num}"})
                self.models.edit_childs('groups', group_id, 'faces', new_faces, add=True)
                groups_created += 1

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
                image_id = self.models.add(
                    'images',
                    {
                        'label': image_file,
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

        if not self.profile_context['can_upload_and_delete_images']:
            raise Forbidden("Profile not allowed to process new images")

        # Check limitations before starting
        _send_progress('validation', 0, 1, 'Checking upload limits...')
        
        if verbose:
            print(f"Starting image processing")
        
        # Get current image count
        current_count = self.models.get_images_count()
        
        image_files = _get_images_to_process()
        if not image_files:
            if verbose:
                print("No images found in to_process folder")
            _send_progress('complete', 0, 0, 'No images to process')
            return {
                'images_processed': 0,
                'faces_detected': 0,
                'groups_created': 0,
                'errors': []
            }
        
        # Check count limit
        if current_count + len(image_files) > images_count_limit:
            error_msg = f"Upload would exceed image count limit. Current: {current_count}, Limit: {images_count_limit}, Attempting to add: {len(image_files)}"
            if verbose:
                print(error_msg)
            _send_progress('error', 0, 0, error_msg)
            raise ValueError(error_msg)
        
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
            if verbose:
                print(error_msg)
            _send_progress('error', 0, 0, error_msg)
            raise ValueError(error_msg)
        
        if verbose:
            print(f"Found {len(image_files)} images to process")
        
        _send_progress('validation', 1, 1, f'Validation complete. Processing {len(image_files)} images...')

        upload_id = self.models.add('uploads', {
            'started_at': datetime.now().isoformat(),
            'status': 'processing',
            'images_count': len(image_files),
            'faces_count': 0,
            'clusters_count': 0,
            'moments_count': 0,
            'errors': [],
            'profile_id': self.profile_context['profile_id'],
        })

        all_faces = []
        processed_images = []
        errors = []
        
        try:
            if not self.face_utils:
                self.face_utils = FaceUtils(self.event_id)
            
            unassociated_group_id = self.models.get_unassociated_group()
            for i, image_file in enumerate(image_files, 1):
                _send_progress('processing', i, len(image_files), f'Processing image {i}/{len(image_files)}: {image_file}')
                if verbose:
                    print(f"Processing image {i}/{len(image_files)}: {image_file}")
                display_img, image_id, image_faces, error = _process_image(image_file, unassociated_group_id, upload_id)
                if error is not None or display_img is None or image_id is None:
                    error_msg = f"Error processing {image_file}: {str(error) if error else 'Invalid image or id'}"
                    if verbose:
                        print(f"  {error_msg}")
                    errors.append(error_msg)
                    continue
                if verbose:
                    print(f"  Detected {len(image_faces)} faces")
                all_faces.extend(image_faces)
                processed_images.append(image_id)

            if verbose:
                print(f"Completed image processing. Detected {len(all_faces)} total faces")
            
            _send_progress('faces', 0, 1, 'Adding faces to database...')
            if all_faces:
                if verbose:
                    print("Adding faces to database...")
                all_faces_values = [[face['face_id'], face['image_id'], face['width'], face['height'], face['left'], face['top'], face['group_id']] for face in all_faces]
                self.models.add_many('faces', ['face_id', 'image_id', 'width', 'height', 'left', 'top', 'group_id'], all_faces_values)
                _send_progress('clustering', 0, 1, 'Clustering faces...')
                if verbose:
                    print("Clustering faces...")
                groups_created = _cluster_and_group_faces([face[0] for face in all_faces_values])
            else:
                groups_created = 0
            
            # Assign moments by time if requested
            assigned_moments = {}
            if assign_moments and processed_images:
                _send_progress('moments', 0, 1, 'Assigning images to moments by time...')
                if verbose:
                    print("Assigning images to moments by time...")
                assigned_moments = self.models.assign_moments_by_time(processed_images)
                if verbose:
                    print(f"  Assigned {sum(len(imgs) for imgs in assigned_moments.values())} images to {len(assigned_moments)} moments")
            
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
            
            if verbose:
                print(f"Processing complete!")
                print(f"  - Images processed: {summary['images_processed']}")
                print(f"  - Faces detected: {summary['faces_detected']}")
                print(f"  - Groups created: {summary['groups_created']}")
                if assign_moments:
                    print(f"  - Images assigned to moments: {sum(len(imgs) for imgs in assigned_moments.values())}")
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
            if verbose:
                print(f"Processing failed: {error_msg}")
            _send_progress('error', 0, 0, error_msg)
            raise
