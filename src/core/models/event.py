import json
import os
import uuid
import shutil
from typing import Optional, List
from PIL import Image as PILImage
from .db import AppDB

DATA_FILE = os.path.join(os.path.dirname(__file__), '../../data/events.json')
DATA_ROOT = os.path.join(os.path.dirname(__file__), '../../data')

class Event:
    def __init__(self, event_id: str, load: bool = True):
        self.id = event_id
        self.event_dir = os.path.join(DATA_ROOT, self.id)
        self.DB_PATH = os.path.join(self.event_dir, f'{self.id}.db')
        self.db = AppDB(self.DB_PATH)
        self.display_dir = os.path.join(self.event_dir, 'display')
        self.original_dir = os.path.join(self.event_dir, 'original')
        self.thumb_dir = os.path.join(self.event_dir, 'thumb')
        self.to_process_dir = os.path.join(self.event_dir, 'to_process')
        self.faces_dir = os.path.join(self.event_dir, 'faces')
        if not load:
            self.name = ''
            self.date = ''
            self.photographer = ''
            self._ensure_event_dirs()
            return
        event = _get_event_dict(event_id)
        if event:
            self.name = event.get('name', '')
            self.date = event.get('date', '')
            self.photographer = event.get('photographer', '')
        else:
            self.name = ''
            self.date = ''
            self.photographer = ''
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
            'photographer': self.photographer,
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
        from .image import Images
        from .group import Groups
        from .face import Faces
        from ..face_utils import FaceUtils
        from ..image_utils import resize_image, crop_image
        from datetime import datetime
        
        if verbose:
            print(f"Starting image processing for event: {self.name}")
        
        # Get list of images to process
        image_files = [f for f in os.listdir(self.to_process_dir) 
                      if f.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.tiff'))]
        
        if not image_files:
            if verbose:
                print("No images found in to_process folder")
            return {'images_processed': 0, 'faces_detected': 0, 'groups_created': 0}
        
        if verbose:
            print(f"Found {len(image_files)} images to process")
        
        # Initialize database models
        images_model = Images(self)
        groups_model = Groups(self)
        faces_model = Faces(self)
        face_utils = FaceUtils(self.id)
        
        # Temporary storage for faces before clustering
        all_faces = []
        processed_images = []
        
        # Step 1: Process each image
        for i, image_file in enumerate(image_files, 1):
            if verbose:
                print(f"Processing image {i}/{len(image_files)}: {image_file}")
            
            image_path = os.path.join(self.to_process_dir, image_file)
            
            try:
                # Load original image
                original_img = PILImage.open(image_path)
                
                # Get image metadata
                width, height = original_img.size
                file_size = os.path.getsize(image_path)
                
                # Extract date_taken from EXIF or use current time
                date_taken = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                try:
                    # Try to get EXIF data using getexif() method
                    exif = original_img.getexif()
                    if exif and 36867 in exif:  # DateTimeOriginal
                        date_taken = exif[36867]
                except:
                    pass
                
                # a. Copy to original folder
                original_save_path = os.path.join(self.original_dir, image_file)
                shutil.copy2(image_path, original_save_path)
                
                # b. Add to database
                image_data = images_model.add(
                    name=image_file,
                    date_taken=date_taken,
                    file_size=file_size,
                    width=width,
                    height=height
                )
                image_id = image_data['imageID']
                processed_images.append(image_id)
                
                # c. Resize for display and thumb
                display_img = resize_image(original_img, display_size)
                thumb_img = resize_image(original_img, thumb_size)
                
                # Save resized images
                display_path = os.path.join(self.display_dir, f"{image_id}.jpg")
                thumb_path = os.path.join(self.thumb_dir, f"{image_id}.jpg")
                
                display_img.save(display_path, 'JPEG', quality=90)
                thumb_img.save(thumb_path, 'JPEG', quality=90)
                
                # d. Detect faces using display size image
                if verbose:
                    print(f"  Detecting faces in {image_file}...")
                
                detected_faces = face_utils.detect_faces(display_img, external_image_id=image_id)
                
                if verbose:
                    print(f"  Detected {len(detected_faces)} faces")
                
                # e. Process each detected face
                for face_id, bbox in detected_faces:
                    # A. Save face crop
                    crop_img = crop_image(display_img, (
                        int(bbox['Left'] * display_img.width),
                        int(bbox['Top'] * display_img.height),
                        int((bbox['Left'] + bbox['Width']) * display_img.width),
                        int((bbox['Top'] + bbox['Height']) * display_img.height)
                    ))
                    
                    crop_filename = f"{face_id}.jpg"
                    crop_path = os.path.join(self.faces_dir, crop_filename)
                    crop_img.save(crop_path, 'JPEG', quality=90)
                    
                    # B. Add to faces temp list
                    all_faces.append({
                        'face_id': face_id,
                        'image_id': image_id,
                        'bbox': bbox,
                        'crop_filename': crop_filename,
                        'groupid': ''
                    })
                
                # Remove processed image from to_process
                os.remove(image_path)
                
            except Exception as e:
                if verbose:
                    print(f"  Error processing {image_file}: {str(e)}")
                continue
        
        if verbose:
            print(f"Completed image processing. Detected {len(all_faces)} total faces")
        
        # Step 2: Cluster faces
        if all_faces:
            if verbose:
                print("Clustering faces...")
            
            face_ids = [face['face_id'] for face in all_faces]
            clusters = face_utils.cluster_faces(face_ids, threshold_similarity=cluster_threshold, max_matches_faces=max_matches_faces)
            
            if verbose:
                print(f"Found {len(clusters)} face clusters")
            
            # Step 3: Process clusters
            if verbose:
                print("Processing face clusters...")
            
            for cluster_idx, cluster in enumerate(clusters, 1):
                if verbose:
                    print(f"  Processing cluster {cluster_idx}/{len(clusters)} with {len(cluster)} faces")
                
                # Get faces in this cluster
                cluster_faces = [face for face in all_faces if face['face_id'] in cluster]
                
                # Use first face as representative
                representative_face = cluster_faces[0]
                
                # a. Add group to database
                group_data = groups_model.add(
                    label=f"Person {cluster_idx}",
                    face_representive=representative_face['face_id']
                )
                group_id = group_data['groupID']
                
                # b. Update all faces in cluster with groupid
                for face in cluster_faces:
                    face['groupid'] = group_id
                
                # Add faces to group
                face_ids = [face['face_id'] for face in cluster_faces]
                groups_model.add_faces(group_id, face_ids)
            
            # Step 4: Add all faces to database
            if verbose:
                print("Adding faces to database...")
            
            for face in all_faces:
                # Convert bbox coordinates to absolute values
                bbox = face['bbox']
                faces_model.add(
                    image_ID=face['image_id'],
                    crop_filename=face['crop_filename'],
                    width=bbox['Width'],
                    height=bbox['Height'],
                    left=bbox['Left'],
                    top=bbox['Top'],
                    face_ID=face['face_id'],
                    group_ID=face['groupid']
                )
        
        # Summary
        summary = {
            'images_processed': len(processed_images),
            'faces_detected': len(all_faces),
            'groups_created': len(clusters) if all_faces else 0
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

def add_event(name: str, date: str, photographer: str) -> Event:
    event = Event(event_id=str(uuid.uuid4()), load=False)
    event.edit_fields({'name': name, 'date': date, 'photographer': photographer})
    event.save()
    # Insert photographer profile
    event.db.insert('profiles', {
        'profileID': str(uuid.uuid4()),
        'label': photographer,
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