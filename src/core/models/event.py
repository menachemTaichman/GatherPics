import os
from ..db import AppDB
from ..face_utils import FaceUtils
from .json_model import JsonModel
from .models_manager import ModelsManager
from typing import Optional

DATA_ROOT = os.path.join(os.path.dirname(__file__), '../../data')

class Event(JsonModel):
    DATA_FILE = os.path.join(os.path.dirname(__file__), '../../data/events.json')
    ID_FIELD = 'id'

    # event utils
    def __init__(self, event_id: str, load: bool = True, profile_id: Optional[str] = None):
        super().__init__(event_id, load=load)
        self.event_dir = os.path.join(DATA_ROOT, self.id)
        self.DB_PATH = os.path.join(self.event_dir, f'{self.id}.db')
        self.db = AppDB(self.DB_PATH)
        
        # Set profile ID for access control
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

    def _load_fields(self, data: dict):
        self.name = data.get('name', '')
        self.date = data.get('date', '')
        self.events_manager = data.get('events_manager', '')
        self.url = data.get('url', '')
        self.last_group_id = data.get('last_group_id', '')

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
            db = AppDB(self.DB_PATH)
            db.create_new_db_in_dir(self.event_dir, f'{self.id}.db')
            self._initialize_default_profiles()

    def _initialize_default_profiles(self):
        """Initialize default profiles for the event: Main Manager and Event Manager"""
        # Check if profiles already exist to avoid duplicates
        existing_profiles = self.models_manager.get_all('profiles')
        if existing_profiles:
            return  # Profiles already exist, don't create duplicates
        
        developer_id = self.models_manager.profiles_model.generate_id()
        event_manager_id = self.models_manager.profiles_model.generate_id()
        main_manager_id = self.models_manager.profiles_model.generate_id()
        developer_password = ''
        event_manager_password = ''
        main_manager_password = ''

        # create directly in db, include password and id

        self.db.execute_query(f'''
            INSERT INTO profiles (profileID, label, password, hierarchy_rank, is_profiles_manager, can_edit, all_images, all_albums, save_preferences)
            VALUES (?, 'Developer', ?, 3, 1, 1, 1, 1, 1),
                   (?, 'Event Manager', ?, 2, 1, 1, 1, 1, 1),
                   (?, 'Main Manager', ?, 1, 1, 1, 1, 1, 1)
        ''', (developer_id, developer_password, event_manager_id, event_manager_password, main_manager_id, main_manager_password))

        self.set_profile_id(developer_id)

        return self.models_manager.get_all('profiles')

    def add(self, **fields) -> 'Event':
        super().add(**fields)
        self.last_group_id = 0
        return self

    def set_profile_id(self, profile_id: Optional[str]):
        """Set the profile ID for access control across all models."""
        self.db.set_profile_id(profile_id)

    def get_profile_id(self) -> Optional[str]:
        """Get the current profile ID."""
        return self.db.profile_context.get('profileID')

    def get_info(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'date': self.date,
            'events_manager': self.events_manager,
            'last_group_id': self.last_group_id,
            'url': self.url,
            'DB_PATH': self.DB_PATH
        }

    def delete_image(self, image_id: str) -> None:
        faces = self.models_manager.get_image_faces(image_id)
        if not self.face_utils:
            self.face_utils = FaceUtils(self.id)
        
        self.face_utils.rek_helper.delete_faces(faces)
        for face in faces:
            try:
                os.remove(os.path.join(self.faces_dir, f"{face}.jpg"))
            except FileNotFoundError:
                pass

        self.models_manager.delete('images', image_id)
        try:
            os.remove(os.path.join(self.original_dir, f"{image_id}.jpg"))
            os.remove(os.path.join(self.high_quality_dir, f"{image_id}.jpg"))
            os.remove(os.path.join(self.display_dir, f"{image_id}.jpg"))
            os.remove(os.path.join(self.thumb_dir, f"{image_id}.jpg"))
        except FileNotFoundError:
            pass

    def process_new_images(self, display_size: int = 2048, thumb_size: int = 512, cluster_threshold: int = 90, max_matches_faces: int = 100, verbose: bool = True) -> dict:
        """
        Process new images from to_process folder.
        Args:
            display_size: Size for display images (width, height)
            thumb_size: Size for thumbnail images (width, height) 
            cluster_threshold: Similarity threshold for face clustering (0-100)
            max_matches_faces: Maximum number of faces to match for clustering
            verbose: Whether to print progress messages
        Returns:
            dict: Summary of processing results
        """
        from ..image_utils import resize_image, crop_image, extract_all_metadata, save_image
        import os
        import shutil
        from PIL import Image as PILImage

        def _get_images_to_process():
            return [f for f in os.listdir(self.to_process_dir) 
                    if f.lower().endswith((".jpg", ".jpeg", ".png", ".bmp", ".tiff"))]

        def _process_face(display_img, bbox, face_id, image_id):
            crop_img = crop_image(display_img, bbox, padding_width_percent=0.3, padding_height_percent=0.2)
            crop_path = os.path.join(self.faces_dir, f"{face_id}.webp")
            save_image(
                crop_img, crop_path, format='WEBP', quality=90, optimize=True
            )
            return self.models_manager.faces_model.get_add_data(
                image_ID=image_id,
                width=bbox['width'],
                height=bbox['height'],
                left=bbox['left'],
                top=bbox['top'],
                face_ID=face_id,
                group_ID=''
            )

        def _cluster_and_group_faces(face_ids):
            clusters = self.face_utils.cluster_faces(face_ids, threshold_similarity=cluster_threshold, max_matches_faces=max_matches_faces)
            for cluster in clusters:
                group_num = self.last_group_id + 1
                # Create group without computing representative here; it will be set by add_faces_to_group
                group_data = self.models_manager.add('groups', [{
                    'label': f"Person {group_num}",
                    'representative_face': ''
                }])[0]
                group_id = group_data['groupID']
                self.models_manager.add_faces_to_group(group_id, cluster)
                self.last_group_id = group_num
            return len(clusters)

        def _process_image(image_file):
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
                    name=image_file,
                    date_taken=date_taken,
                    file_size=file_size,
                    width=width,
                    height=height
                )["imageID"]
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
                    face_data = _process_face(original_img, bbox, face_id, image_id)
                    image_faces.append(face_data)
                original_img.close()
                os.remove(image_path)
                return display_img, image_id, image_faces, None
            except Exception as e:
                return None, None, [], e

        if verbose:
            print(f"Starting image processing for event: {self.name}")
        
        if not self.face_utils:
            self.face_utils = FaceUtils(self.id)

        image_files = _get_images_to_process()
        if not image_files:
            if verbose:
                print("No images found in to_process folder")
            return {
                'images_processed': 0,
                'faces_detected': 0,
                'groups_created': 0
            }
        if verbose:
            print(f"Found {len(image_files)} images to process")
        all_faces = []
        processed_images = []
        for i, image_file in enumerate(image_files, 1):
            if verbose:
                print(f"Processing image {i}/{len(image_files)}: {image_file}")
            display_img, image_id, image_faces, error = _process_image(image_file)
            if error is not None or display_img is None or image_id is None:
                if verbose:
                    print(f"  Error processing {image_file}: {str(error) if error else 'Invalid image or ID'}")
                continue
            if verbose:
                print(f"  Detected {len(image_faces)} faces")
            all_faces.extend(image_faces)
            processed_images.append(image_id)

        if verbose:
            print(f"Completed image processing. Detected {len(all_faces)} total faces")
        if all_faces:
            if verbose:
                print("Adding faces to database...")
            self.models_manager.add('faces', all_faces)
            if verbose:
                print("Clustering faces...")
            groups_created = _cluster_and_group_faces([face['faceID'] for face in all_faces])
        else:
            groups_created = 0
        summary = {
            'images_processed': len(processed_images),
            'faces_detected': len(all_faces),
            'groups_created': groups_created
        }
        if verbose:
            print(f"Processing complete!")
            print(f"  - Images processed: {summary['images_processed']}")
            print(f"  - Faces detected: {summary['faces_detected']}")
            print(f"  - Groups created: {summary['groups_created']}")
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
get_event = lambda event_id, profile_id=None: Event(event_id, profile_id=profile_id)
list_events = Event.list_all 