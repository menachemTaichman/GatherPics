import os
from ..db import AppDB
from .image import Images
from .group import Groups
from .face import Faces
from .moment import Moments
from .profile import Profiles
from ..face_utils import FaceUtils
from .json_model import JsonModel

DATA_ROOT = os.path.join(os.path.dirname(__file__), '../../data')

class Event(JsonModel):
    DATA_FILE = os.path.join(os.path.dirname(__file__), '../../data/events.json')
    ID_FIELD = 'id'

    def __init__(self, event_id: str, load: bool = True):
        super().__init__(event_id, load=load)
        self.event_dir = os.path.join(DATA_ROOT, self.id)
        self.DB_PATH = os.path.join(self.event_dir, f'{self.id}.db')
        self.db = AppDB(self.DB_PATH)
        self.images_model = Images(self.db)
        self.groups_model = Groups(self.db)
        self.faces_model = Faces(self.db)
        self.moments_model = Moments(self.db)
        self.profile_model = Profiles(self.db)
        self.face_utils = FaceUtils(self.id)
        self.display_dir = os.path.join(self.event_dir, 'display')
        self.original_dir = os.path.join(self.event_dir, 'original')
        self.thumb_dir = os.path.join(self.event_dir, 'thumb')
        self.to_process_dir = os.path.join(self.event_dir, 'to_process')
        self.faces_dir = os.path.join(self.event_dir, 'faces')
        self._ensure_event_dirs()

    def _init_fields(self):
        self.name = ''
        self.date = ''
        self.events_manager = ''

    def _load_fields(self, data: dict):
        self.name = data.get('name', '')
        self.date = data.get('date', '')
        self.events_manager = data.get('events_manager', '')

    def get_info(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'date': self.date,
            'events_manager': self.events_manager,
            'DB_PATH': self.DB_PATH
        }

    def _ensure_event_dirs(self):
        os.makedirs(self.event_dir, exist_ok=True)
        os.makedirs(self.display_dir, exist_ok=True)
        os.makedirs(self.original_dir, exist_ok=True)
        os.makedirs(self.thumb_dir, exist_ok=True)
        os.makedirs(self.to_process_dir, exist_ok=True)
        os.makedirs(self.faces_dir, exist_ok=True)
        # Ensure {event_id}.db exists as an SQLite DB
        if not os.path.exists(self.DB_PATH):
            db = AppDB(self.DB_PATH)
            db.create_new_db_in_dir(self.event_dir, f'{self.id}.db')
            self._initialize_default_profiles()

    def _initialize_default_profiles(self):
        """Initialize default profiles for the event: Main Manager and Event Manager"""
        # Check if profiles already exist to avoid duplicates
        existing_profiles = self.profile_model.list()
        if existing_profiles:
            return  # Profiles already exist, don't create duplicates
        
        # Create Main Manager profile (full permissions)
        main_manager_profile = self.profile_model.add(
            label="Main Manager",
            all_images=True,
            can_edit_groups=True,
            can_upload_photos=True,
            can_edit_moments=True
        )
        
        # Create Event Manager profile (limited permissions)
        event_manager_profile = self.profile_model.add(
            label="Event Manager", 
            all_images=True,
            can_edit_groups=True,
            can_upload_photos=True,
            can_edit_moments=True
        )

    def delete_image(self, image_id: str) -> None:
        faces = self.images_model.get_faces(image_id)
        self.face_utils.rek_helper.delete_faces(faces)
        for face in faces:
            try:
                os.remove(os.path.join(self.faces_dir, f"{face}.jpg"))
            except FileNotFoundError:
                pass

        self.images_model.delete(image_id)
        try:
            os.remove(os.path.join(self.original_dir, f"{image_id}.jpg"))
            os.remove(os.path.join(self.display_dir, f"{image_id}.jpg"))
            os.remove(os.path.join(self.thumb_dir, f"{image_id}.jpg"))
        except FileNotFoundError:
            pass

    def process_new_images(self, 
                          display_size: int = 1080, 
                          thumb_size: int = 300,
                          cluster_threshold: int = 90,
                          max_matches_faces: int = 100,
                          verbose: bool = True
    ) -> dict:
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
        from ..image_utils import resize_image, crop_image
        from datetime import datetime
        import os
        import shutil
        from PIL import Image as PILImage

        def _extract_date_taken(image):
            date_taken = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            try:
                exif = image.getexif()
                if exif:
                    # Try multiple EXIF date tags in order of preference
                    date_tags = [36867, 306, 36868]  # DateTimeOriginal, DateTime, DateTimeDigitized
                    for tag in date_tags:
                        if tag in exif:
                            date_str = exif[tag]
                            if date_str and isinstance(date_str, str):
                                # EXIF dates are typically in format: "YYYY:MM:DD HH:MM:SS"
                                # Convert to our format: "YYYY-MM-DD HH:MM:SS"
                                if ':' in date_str and len(date_str) >= 19:
                                    date_taken = date_str.replace(':', '-', 2)  # Replace first two colons
                                    break
            except Exception as e:
                if verbose:
                    print(f"  Warning: Could not extract EXIF date: {e}")
            return date_taken

        def _get_images_to_process():
            return [f for f in os.listdir(self.to_process_dir) 
                    if f.lower().endswith((".jpg", ".jpeg", ".png", ".bmp", ".tiff"))]

        def _save_image_with_exif(img, path, original_img, date_taken):
            """Save image with preserved EXIF data including date_taken"""
            exif = original_img.getexif()
            if exif:
                # Update or add date taken to EXIF
                exif_dict = dict(exif)
                # Convert date_taken to EXIF format (YYYY:MM:DD HH:MM:SS)
                exif_date = date_taken.replace('-', ':', 2)
                exif_dict[36867] = exif_date  # DateTimeOriginal
                exif_dict[306] = exif_date    # DateTime
                exif_dict[36868] = exif_date  # DateTimeDigitized
                
                # Use the original exif object and update it
                for tag_id, value in exif_dict.items():
                    exif[tag_id] = value
                
                img.save(path, 'JPEG', quality=90, exif=exif.tobytes())
            else:
                img.save(path, 'JPEG', quality=90)

        def _process_face(img, bbox, face_id, image_id, date_taken):
            crop_img = crop_image(img, bbox, padding_width=40, padding_height=0)
            crop_path = os.path.join(self.faces_dir, f"{face_id}.jpg")
            _save_image_with_exif(crop_img, crop_path, img, date_taken)
            return self.faces_model.get_add_data(
                image_ID=image_id,
                width=bbox['Width'],
                height=bbox['Height'],
                left=bbox['Left'],
                top=bbox['Top'],
                face_ID=face_id,
                group_ID=''
            )

        def _cluster_and_group_faces(face_ids):
            clusters = self.face_utils.cluster_faces(face_ids, threshold_similarity=cluster_threshold, max_matches_faces=max_matches_faces)
            num_groups = len(self.groups_model.list())
            for cluster_idx, cluster in enumerate(clusters, num_groups + 1):
                representative_face_id = cluster[0]
                group_data = self.groups_model.add(
                    label=f"Person {cluster_idx}",
                    face_representive=representative_face_id
                )
                group_id = group_data['groupID']
                self.groups_model.add_faces(group_id, cluster)
            return len(clusters)

        def _process_image(image_file):
            def _resize_and_save_images(original_img, image_id, date_taken):
                display_img = resize_image(original_img, display_size)
                thumb_img = resize_image(original_img, thumb_size)
                display_path = os.path.join(self.display_dir, f"{image_id}.jpg")
                thumb_path = os.path.join(self.thumb_dir, f"{image_id}.jpg")
                
                _save_image_with_exif(display_img, display_path, original_img, date_taken)
                _save_image_with_exif(thumb_img, thumb_path, original_img, date_taken)
                
                return display_img

            image_path = os.path.join(self.to_process_dir, image_file)
            try:
                original_img = PILImage.open(image_path)
                width, height = original_img.size
                file_size = os.path.getsize(image_path)
                date_taken = _extract_date_taken(original_img)
                image_id = self.images_model.add(
                    name=image_file,
                    date_taken=date_taken,
                    file_size=file_size,
                    width=width,
                    height=height
                )["imageID"]
                display_img = _resize_and_save_images(original_img, image_id, date_taken)
                original_save_path = os.path.join(self.original_dir, image_id + '.jpg')
                shutil.copy2(image_path, original_save_path)
                
                # Process faces for this image (use display image for AWS, crop from original)
                detected_faces = self.face_utils.detect_faces(display_img, external_image_id=image_id)
                image_faces = []
                for face_id, bbox in detected_faces:
                    face_data = _process_face(original_img, bbox, face_id, image_id, date_taken)
                    image_faces.append(face_data)
                
                original_img.close()
                os.remove(image_path)
                return display_img, image_id, image_faces, None
            except Exception as e:
                return None, None, [], e

        if verbose:
            print(f"Starting image processing for event: {self.name}")
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
            self.faces_model.add_many(all_faces)
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
    Event.delete(event_id)
    # Remove the event directory and its contents
    event_dir = os.path.join(DATA_ROOT, event_id)
    if os.path.exists(event_dir):
        import shutil
        shutil.rmtree(event_dir)
get_event = lambda event_id: Event(event_id)
list_events = Event.list_all 