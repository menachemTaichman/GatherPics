import json
import os
import uuid
from typing import Optional, List
from .db import AppDB
from .image import Images
from .group import Groups
from .face import Faces
from ..face_utils import FaceUtils

DATA_FILE = os.path.join(os.path.dirname(__file__), '../../data/events.json')
DATA_ROOT = os.path.join(os.path.dirname(__file__), '../../data')

class Event:
    def __init__(self, event_id: str, load: bool = True):
        self.id = event_id
        self.event_dir = os.path.join(DATA_ROOT, self.id)
        self.DB_PATH = os.path.join(self.event_dir, f'{self.id}.db')
        self.db = AppDB(self.DB_PATH)
        self.images_model = Images(self)
        self.groups_model = Groups(self)
        self.faces_model = Faces(self)
        self.face_utils = FaceUtils(self.id)
        self.display_dir = os.path.join(self.event_dir, 'display')
        self.original_dir = os.path.join(self.event_dir, 'original')
        self.thumb_dir = os.path.join(self.event_dir, 'thumb')
        self.to_process_dir = os.path.join(self.event_dir, 'to_process')
        self.faces_dir = os.path.join(self.event_dir, 'faces')
        if not load:
            self.name = ''
            self.date = ''
            self.events_manager = ''
            self._ensure_event_dirs()
            return
        event = _get_event_dict(event_id)
        if event:
            self.name = event.get('name', '')
            self.date = event.get('date', '')
            self.events_manager = event.get('events_manager', '')
        else:
            self.name = ''
            self.date = ''
            self.events_manager = ''
        self._ensure_event_dirs()

    def _ensure_event_dirs(self):
        os.makedirs(self.event_dir, exist_ok=True)
        os.makedirs(self.display_dir, exist_ok=True)
        os.makedirs(self.original_dir, exist_ok=True)
        os.makedirs(self.thumb_dir, exist_ok=True)
        os.makedirs(self.to_process_dir, exist_ok=True)
        os.makedirs(self.faces_dir, exist_ok=True)
        # Ensure {event_id}.db exists as an SQLite DB
        if not os.path.exists(self.DB_PATH):
            from .db import AppDB
            db = AppDB(self.DB_PATH)
            db.create_new_db_in_dir(self.event_dir, f'{self.id}.db')

    def edit_fields(self, fields: dict):
        for key, value in fields.items():
            if hasattr(self, key):
                setattr(self, key, value)

    def save(self):
        events = _load_events()
        # Remove old if exists
        events = [e for e in events if e['id'] != self.id]
        events.append(self.get_info())
        _save_events(events)
        self._ensure_event_dirs()

    def get_info(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'date': self.date,
            'events_manager': self.events_manager,
            'DB_PATH': self.DB_PATH
        }

    def process_new_images(self, 
                          display_size: tuple = (1920, 1080), 
                          thumb_size: tuple = (300, 300),
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

        def _get_images_to_process():
            return [f for f in os.listdir(self.to_process_dir) 
                    if f.lower().endswith((".jpg", ".jpeg", ".png", ".bmp", ".tiff"))]

        def _process_face(display_img, bbox, face_id, image_id):
            crop_img = crop_image(display_img, (
                int(bbox['Left'] * display_img.width),
                int(bbox['Top'] * display_img.height),
                int((bbox['Left'] + bbox['Width']) * display_img.width),
                int((bbox['Top'] + bbox['Height']) * display_img.height)
            ))
            crop_path = os.path.join(self.faces_dir, f"{face_id}.jpg")
            crop_img.save(crop_path, 'JPEG', quality=90)
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
            for cluster_idx, cluster in enumerate(clusters, 1):
                representative_face_id = cluster[0]
                group_data = self.groups_model.add(
                    label=f"Person {cluster_idx}",
                    face_representive=representative_face_id
                )
                group_id = group_data['groupID']
                self.groups_model.add_faces(group_id, cluster)
            return len(clusters)

        def _process_image(image_file):
            def _extract_date_taken(image):
                date_taken = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                try:
                    exif = image.getexif()
                    if exif and 36867 in exif:  # DateTimeOriginal
                        date_taken = exif[36867]
                except:
                    pass
                return date_taken

            def _resize_and_save_images(original_img, image_id):
                display_img = resize_image(original_img, display_size)
                thumb_img = resize_image(original_img, thumb_size)
                display_path = os.path.join(self.display_dir, f"{image_id}.jpg")
                thumb_path = os.path.join(self.thumb_dir, f"{image_id}.jpg")
                display_img.save(display_path, 'JPEG', quality=90)
                thumb_img.save(thumb_path, 'JPEG', quality=90)
                return display_img

            image_path = os.path.join(self.to_process_dir, image_file)
            try:
                original_img = PILImage.open(image_path)
                width, height = original_img.size
                file_size = os.path.getsize(image_path)
                date_taken = _extract_date_taken(original_img)
                original_save_path = os.path.join(self.original_dir, image_file)
                shutil.copy2(image_path, original_save_path)
                image_id = self.images_model.add(
                    name=image_file,
                    date_taken=date_taken,
                    file_size=file_size,
                    width=width,
                    height=height
                )["imageID"]
                os.remove(image_path)
                display_img = _resize_and_save_images(original_img, image_id)
                return display_img, image_id, None
            except Exception as e:
                return None, None, e

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
            display_img, image_id, error = _process_image(image_file)
            if error is not None or display_img is None or image_id is None:
                if verbose:
                    print(f"  Error processing {image_file}: {str(error) if error else 'Invalid image or ID'}")
                continue
            detected_faces = self.face_utils.detect_faces(display_img, external_image_id=image_id)
            if verbose:
                print(f"  Detected {len(detected_faces)} faces")
            for face_id, bbox in detected_faces:
                face_data = _process_face(display_img, bbox, face_id, image_id)
                all_faces.append(face_data)
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

def _load_events() -> List[dict]:
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def _save_events(events: List[dict]):
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(events, f, ensure_ascii=False, indent=2)

def _get_event_dict(event_id: str) -> Optional[dict]:
    for event in _load_events():
        if event['id'] == event_id:
            return event
    return None

def add_event(name: str, date: str, events_manager: str) -> Event:
    event = Event(event_id=str(uuid.uuid4()), load=False)
    event.edit_fields({'name': name, 'date': date, 'events_manager': events_manager})
    event.save()
    # Insert event_manager profile
    event.db.insert('profiles', {
        'profileID': str(uuid.uuid4()),
        'label': events_manager,
        'can_edit_groups': True,
        'can_upload_photos': True,
        'can_edit_moments': True
    })
    # Insert manager profile
    event.db.insert('profiles', {
        'profileID': str(uuid.uuid4()),
        'label': 'manager',
        'can_edit_groups': True,
        'can_upload_photos': True,
        'can_edit_moments': True
    })
    return event

def delete_event(event_id: str) -> None:
    events = _load_events()
    events = [e for e in events if e['id'] != event_id]
    _save_events(events)
    # Remove the event directory and its contents
    event_dir = os.path.join(DATA_ROOT, event_id)
    if os.path.exists(event_dir):
        import shutil
        shutil.rmtree(event_dir)

def get_event(event_id: str) -> Event:
    return Event(event_id)

def list_events() -> List[Event]:
    return [Event(e['id']) for e in _load_events()] 