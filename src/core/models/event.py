import os
from ..db import AppDB, ReturnFormat
from ..face_utils import FaceUtils
from .json_model import JsonModel
from .models_manager import ModelsManager

DATA_ROOT = os.path.join(os.path.dirname(__file__), '../../data')

class Event(JsonModel):
    DATA_FILE = os.path.join(os.path.dirname(__file__), '../../data/events.json')
    ID_FIELD = 'id'

    # event utils
    def __init__(self, event_id: str, load: bool = True, profile_id: str | None = None, include_archived: bool = False):
        super().__init__(event_id, load=load)
        self.event_dir = os.path.join(DATA_ROOT, self.id)
        self.DB_PATH = os.path.join(self.event_dir, f'{self.id}.db')
        self.db = AppDB(self.DB_PATH, self.id)
        
        # Set profile id for access control
        if profile_id:
            self.db.set_profile_id(profile_id)
        
        self.models_manager = ModelsManager(self.db)
        self.face_utils = None
        self.display_dir = os.path.join(self.event_dir, 'display')
        self.original_dir = os.path.join(self.event_dir, 'original')
        self.thumb_dir = os.path.join(self.event_dir, 'thumb')
        self.to_process_dir = os.path.join(self.event_dir, 'to_process')
        self.faces_dir = os.path.join(self.event_dir, 'faces')
        self.high_quality_dir = os.path.join(self.event_dir, 'high_quality')
        self._ensure_event_dirs()

    def _init_fields(self):
        self.name = ''
        self.date = ''
        self.events_manager = ''
        self.url = ''
        self.last_group_id = ''
        self.images_count_limit = 0
        self.image_size_limit_bytes = 0

    def _load_fields(self, data: dict):
        self.name = data.get('name', '')
        self.date = data.get('date', '')
        self.events_manager = data.get('events_manager', '')
        self.url = data.get('url', '')
        self.last_group_id = data.get('last_group_id', '')
        self.images_count_limit = data.get('images_count_limit', 0)
        self.image_size_limit_bytes = data.get('image_size_limit_bytes', 0)

    def _ensure_event_dirs(self):
        os.makedirs(self.event_dir, exist_ok=True)
        os.makedirs(self.display_dir, exist_ok=True)
        os.makedirs(self.original_dir, exist_ok=True)
        os.makedirs(self.thumb_dir, exist_ok=True)
        os.makedirs(self.to_process_dir, exist_ok=True)
        os.makedirs(self.faces_dir, exist_ok=True)
        os.makedirs(self.high_quality_dir, exist_ok=True)
        # Ensure {event_id}.db exists as an SQLite DB
        if not os.path.exists(self.DB_PATH):
            AppDB.create_new_db_in_dir(self.event_dir, f'{self.id}.db')
            self._initialize_default_profiles()
            self._initialize_default_albums()
            self._initialize_default_groups()

    def _initialize_default_profiles(self, default_profiles: dict = {}):
        """Initialize default profiles for the event: Main Manager and Event Manager"""
        for default_profile, hierarchy_rank in {'developer': 3, 'event_manager': 2, 'main_manager': 1}:
            profile = default_profiles.get(default_profile, {})
            profile['profile_id'] = profile.get('profile_id', self.models_manager.generate_id())
            profile['label'] = profile.get('label', default_profile)
            profile['password'] = profile.get('password', '')
            profile['hierarchy_rank'] = profile.get('hierarchy_rank', hierarchy_rank)

        values = tuple(profile.values() for profile in default_profiles.values())

        self.db.execute_query(f'''
            INSERT INTO profiles (profile_id, label, password, hierarchy_rank, is_profiles_manager, can_upload_and_delete_images, can_edit, all_images, all_albums, save_preferences)
            VALUES (?, ?, ?, ?, 1, 1, 1, 1, 1, 1),
                   (?, ?, ?, ?, 1, 1, 1, 1, 1, 1),
                   (?, ?, ?, ?, 1, 1, 1, 1, 1, 1)
        ''', values)

    def _initialize_default_groups(self):
        """Initialize default groups for the event: Unassociated"""
        Unassociated_group_id = self.models_manager.get_unassociated_group()
        if not Unassociated_group_id:
            self.models_manager.add('groups', {'label': 'Unassociated'})

    def _initialize_default_albums(self):
        """Initialize default albums for the event: Main Album and Event Album"""
        archive_album_id = self.models_manager.get_archive_album()
        favorites_album_id = self.models_manager.get_favorites_album()
        if not archive_album_id:
            self.models_manager.add('albums', {'label': 'Archive'})
        
        if not favorites_album_id:
            self.models_manager.add('albums', {'label': 'Favorites'})

    def add(self, **fields) -> 'Event':
        super().add(**fields)
        self.last_group_id = 0
        return self

    def set_profile_id(self, profile_id: str | None = None):
        """Set the profile id for access control across all models."""
        self.db.set_profile_id(profile_id)

    def get_profile_id(self) -> str | None:
        """Get the current profile id."""
        return self.db.get_profile_id()

    def can_profile_upload_and_delete_images(self) -> bool:
        """Check if the current profile can upload and delete images."""
        profile_id = self.get_profile_id()
        if not profile_id:
            return False

        query = f"""
            SELECT can_upload_and_delete_images FROM profiles WHERE profile_id = ?
        """
        can_upload_and_delete_images = self.db.execute_query(query, (profile_id,), return_format=ReturnFormat.VALUE)
        return can_upload_and_delete_images

    def get_last_group_id(self) -> int:
        """Get the last group id."""
        return self.last_group_id

    def set_last_group_id(self, last_group_id: int):
        """Set the last group id."""
        self.last_group_id = last_group_id
        self.save()

    def get_info(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'date': self.date,
            'events_manager': self.events_manager,
            'last_group_id': self.last_group_id,
            'images_count_limit': self.images_count_limit,
            'image_size_limit_bytes': self.image_size_limit_bytes,
            'url': self.url,
            'DB_PATH': self.DB_PATH
        }

    def get_images_count(self) -> int:
        """Get the number of images in the event."""
        return self.db.execute_query('SELECT COUNT(*) FROM images', return_format=ReturnFormat.VALUE)

    def delete_images(self, image_ids: list[str]) -> tuple[list[str], dict]:
        """Delete images and return list of deleted groups and dict of parents affected with parent entity as key and parent ids as value"""
        
        if not self.can_profile_upload_and_delete_images():
            raise Exception("Profile not allowed to delete images")

        for image_id in image_ids:
            if not self.models_manager.is_image_deletable(image_id):
                raise Exception(f"Profile not allowed to delete {image_id}")

        parents = {}
        deleted_groups = set()
        for image_id in image_ids:
            image_parents = self.models_manager.get_parents('images', image_id)

            face_ids = self.models_manager.get_childs('images', image_id, 'faces', return_ids=True)
            if not self.face_utils:
                self.face_utils = FaceUtils(self.id)
            
            self.models_manager.delete('faces', face_ids)
            self.models_manager.delete('images', image_id)
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
                if self.models_manager.is_empty('groups', group_id):
                    self.models_manager.delete('groups', group_id)
                    deleted_groups.add(group_id)
                    image_parents.get('groups', set()).discard(group_id)
                elif self.models_manager.is_empty('groups', group_id, only_accessible=True):
                    self.models_manager.ensure_representative('groups', group_id)
                    deleted_groups.add(group_id)
                    image_parents.get('groups', set()).discard(group_id)

            for entity, entity_ids in image_parents.items():
                parents.setdefault(entity, set()).update(entity_ids)

        for entity, entity_ids in parents.items():
            parents[entity] = list(entity_ids)
            for entity_id in entity_ids:
                self.models_manager.ensure_representative(entity, entity_id)
                
        return list(deleted_groups), parents

    def process_new_images(
        self,
        display_size: int = 2048,
        thumb_size: int = 512,
        cluster_threshold: int = 90,
        max_matches_faces: int = 100,
        verbose: bool = True,
        assign_moments: bool = False,
        progress_callback=None
    ) -> dict:
        """
        Process new images from to_process folder.
        Args:
            display_size: Size for display images (width, height)
            thumb_size: Size for thumbnail images (width, height) 
            cluster_threshold: Similarity threshold for face clustering (0-100)
            max_matches_faces: Maximum number of faces to match for clustering
            verbose: Whether to print progress messages
            assign_moments: Whether to assign images to moments by time
            progress_callback: Optional callback function to report progress (receives dict with step info)
        Returns:
            dict: Summary of processing results
        """
        from ..image_utils import resize_image, crop_image, extract_all_metadata, save_image
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
            group_num = self.last_group_id + 1
            for _ in range(1000):
                label = f"Person {group_num}"
                if self.models_manager.is_exists('groups', {'label': label}):
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
                    existing_group_id = self.models_manager.get_entities('faces', existing_face_id).get('group_id', None)
                    if existing_group_id:
                        # Add new faces to the existing group
                        self.models_manager.edit_childs('groups', existing_group_id, 'faces', new_faces, add=True)
                        continue

                    new_faces += [existing_face_id]

                group_num = _get_valid_group_label_number()
                group_id = self.models_manager.add('groups', [{'label': f"Person {group_num}"}])[0]
                self.set_last_group_id(group_num)
                self.models_manager.edit_childs('groups', group_id, 'faces', new_faces, add=True)
                groups_created += 1

            return groups_created

        def _process_image(image_file, unassociated_group_id):
            image_path = os.path.join(self.to_process_dir, image_file)
            try:
                original_img = PILImage.open(image_path)
                width, height = original_img.size
                file_size = os.path.getsize(image_path)
                # Extract all metadata (including EXIF and date_taken)
                metadata = extract_all_metadata(image_path)
                date_taken = metadata.get('date_taken')
                exif_bytes = original_img.getexif().tobytes() if original_img.getexif() else b''
                image_id = self.models_manager.add(
                    'images',
                    {
                        'label': image_file,
                        'date_taken': date_taken,
                        'file_size': file_size,
                        'width': width,
                        'height': height
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
        
        if verbose:
            print(f"Starting image processing for event: {self.name}")
        
        # Get current image count
        current_count = self.get_images_count()
        
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
        if current_count + len(image_files) > self.images_count_limit:
            error_msg = f"Upload would exceed image count limit. Current: {current_count}, Limit: {self.images_count_limit}, Attempting to add: {len(image_files)}"
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
            if self.image_size_limit_bytes > 0 and file_size > self.image_size_limit_bytes:
                files_exceeding_limit.append((image_file, file_size))
            total_size += file_size
        
        if files_exceeding_limit:
            error_msg = f"{len(files_exceeding_limit)} file(s) exceed size limit of {self.image_size_limit_bytes} bytes: " + ", ".join([f"{name} ({size} bytes)" for name, size in files_exceeding_limit[:3]])
            if verbose:
                print(error_msg)
            _send_progress('error', 0, 0, error_msg)
            raise ValueError(error_msg)
        
        if verbose:
            print(f"Found {len(image_files)} images to process")
        
        _send_progress('validation', 1, 1, f'Validation complete. Processing {len(image_files)} images...')
        
        if not self.face_utils:
            self.face_utils = FaceUtils(self.id)
        all_faces = []
        processed_images = []
        errors = []
        
        unassociated_group_id = self.models_manager.get_unassociated_group()
        for i, image_file in enumerate(image_files, 1):
            _send_progress('processing', i, len(image_files), f'Processing image {i}/{len(image_files)}: {image_file}')
            if verbose:
                print(f"Processing image {i}/{len(image_files)}: {image_file}")
            display_img, image_id, image_faces, error = _process_image(image_file, unassociated_group_id)
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
            self.models_manager.add('faces', all_faces)
            _send_progress('clustering', 0, 1, 'Clustering faces...')
            if verbose:
                print("Clustering faces...")
            groups_created = _cluster_and_group_faces([face['face_id'] for face in all_faces])
        else:
            groups_created = 0
        
        # Assign moments by time if requested
        assigned_moments = {}
        if assign_moments and processed_images:
            _send_progress('moments', 0, 1, 'Assigning images to moments by time...')
            if verbose:
                print("Assigning images to moments by time...")
            assigned_moments = self.models_manager.assign_moments_by_time(processed_images)
            if verbose:
                print(f"  Assigned {sum(len(imgs) for imgs in assigned_moments.values())} images to {len(assigned_moments)} moments")
        
        summary = {
            'images_processed': len(processed_images),
            'faces_detected': len(all_faces),
            'groups_created': groups_created,
            'processed_image_ids': processed_images,
            'assigned_moments': assigned_moments,
            'errors': errors
        }
        
        _send_progress('complete', 1, 1, f'Processing complete! Processed {len(processed_images)} images.')
        
        if verbose:
            print(f"Processing complete!")
            print(f"  - Images processed: {summary['images_processed']}")
            print(f"  - Faces detected: {summary['faces_detected']}")
            print(f"  - Groups created: {summary['groups_created']}")
            if assign_moments:
                print(f"  - Images assigned to moments: {sum(len(imgs) for imgs in assigned_moments.values())}")
        return summary

# Convenience functions for compatibility
add_event = Event.add
def delete_event(event_id: str) -> None:
    # Remove from JSON
    event = Event(event_id)
    if not event.face_utils:
        event.face_utils = FaceUtils(event_id)

    event.face_utils.rek_helper.delete_collection()
    Event.delete(event_id)
    # Remove the event directory and its contents
    event_dir = os.path.join(DATA_ROOT, event_id)
    if os.path.exists(event_dir):
        import shutil
        shutil.rmtree(event_dir)
get_event = lambda event_id, profile_id=None, include_archived=False: Event(event_id, profile_id=profile_id, include_archived=include_archived)
list_events = Event.list_all 