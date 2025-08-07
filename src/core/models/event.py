import os
from ..db import AppDB
from .image import Images
from .group import Groups
from .face import Faces
from .moment import Moments
from .profile import Profiles
from ..face_utils import FaceUtils
from .json_model import JsonModel
from typing import List, Dict, Optional

DATA_ROOT = os.path.join(os.path.dirname(__file__), '../../data')

class Event(JsonModel):
    DATA_FILE = os.path.join(os.path.dirname(__file__), '../../data/events.json')
    ID_FIELD = 'id'

    def __init__(self, event_id: str, load: bool = True, profile_id: Optional[str] = None):
        super().__init__(event_id, load=load)
        self.event_dir = os.path.join(DATA_ROOT, self.id)
        self.DB_PATH = os.path.join(self.event_dir, f'{self.id}.db')
        self.db = AppDB(self.DB_PATH)
        
        # Set profile ID for access control
        if profile_id:
            self.db.set_profile_id(profile_id)
        
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
        self.high_quality_dir = os.path.join(self.event_dir, 'high_quality')
        self._ensure_event_dirs()

    def set_profile_id(self, profile_id: Optional[str]):
        """Set the profile ID for access control across all models."""
        self.db.set_profile_id(profile_id)

    def get_profile_id(self) -> Optional[str]:
        """Get the current profile ID."""
        return self.db.get_profile_id()

    def _init_fields(self):
        self.name = ''
        self.date = ''
        self.events_manager = ''
        self.last_group_id = ''

    def _load_fields(self, data: dict):
        self.name = data.get('name', '')
        self.date = data.get('date', '')
        self.events_manager = data.get('events_manager', '')
        self.last_group_id = data.get('last_group_id', '')

    def get_info(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'date': self.date,
            'events_manager': self.events_manager,
            'last_group_id': self.last_group_id,
            'DB_PATH': self.DB_PATH
        }
    
    def get_crop_mapping(self, group_id: str) -> dict:
        """
        Get mapping from image_id to face_id for crop display.
        For each image in the group, returns the first face that belongs to this group.
        """
        query = '''
            SELECT DISTINCT f.imageID, f.faceID
            FROM faces f 
            WHERE f.groupID = ?
            GROUP BY f.imageID
        '''
        results = self.db.execute_query(query, (group_id,))
        return {row[0]: row[1] for row in results}

    def get_faces_by_image_and_group(self, image_id: str, group_id: str) -> List[str]:
        """
        Get all face IDs that belong to a specific group in a specific image.
        
        Args:
            image_id: The image ID
            group_id: The group ID
            
        Returns:
            List of face IDs that belong to the specified group in the specified image
        """
        query = 'SELECT faceID FROM faces WHERE imageID=? AND groupID=?'
        results = self.db.execute_query(query, (image_id, group_id))
        return [row[0] for row in results]
    
    def is_group_empty(self, group_id: str) -> bool:
        """
        Check if a group is empty by counting faces, bypassing profile access.
        This method is used for internal operations like transfer_faces where
        we need to determine if a group should be deleted regardless of profile access.
        
        Args:
            group_id: The group ID to check
            
        Returns:
            True if the group has no faces, False otherwise
        """
        query = 'SELECT COUNT(*) FROM faces WHERE groupID=?'
        results = self.db.execute_query(query, (group_id,))
        count = results[0][0] if results else 0
        return count == 0
    
    def get_filtered_images(self, groups_ids: List[str], mode: str = 'and', only: bool = False) -> List[str]:
        """
        Get filtered image IDs based on filter criteria.
        
        Args:
            groups_ids: List of group IDs
            mode: 'and' or 'or'
            only: If True, any image shouldn't belong to any groups that aren't in groups list
        
        Returns:
            List of image IDs that match the filter criteria
        """
        if not groups_ids:
            return []
        
        if mode == 'and':
            # Images must contain faces from ALL groups in the list
            placeholders = ','.join(['?'] * len(groups_ids))
            query = f'''
                SELECT f.imageID
                FROM faces f
                WHERE f.groupID IN ({placeholders})
                GROUP BY f.imageID
                HAVING COUNT(DISTINCT f.groupID) = ?
            '''
            results = self.db.execute_query(query, groups_ids + [len(groups_ids)])
            image_ids = [row[0] for row in results]
            
            if only:
                # Any image shouldn't belong to any groups that aren't in groups list
                if image_ids:
                    image_placeholders = ','.join(['?'] * len(image_ids))
                    query = f'''
                        SELECT f.imageID
                        FROM faces f
                        WHERE f.imageID IN ({image_placeholders})
                        GROUP BY f.imageID
                        HAVING COUNT(DISTINCT f.groupID) = (
                            SELECT COUNT(DISTINCT f2.groupID)
                            FROM faces f2
                            WHERE f2.imageID = f.imageID
                            AND f2.groupID IN ({placeholders})
                        )
                    '''
                    results = self.db.execute_query(query, image_ids + groups_ids)
                    return [row[0] for row in results]
                return []
            
            return image_ids
        
        else:  # mode == 'or'
            # Images must contain faces from AT LEAST ONE of the groups in the list
            placeholders = ','.join(['?'] * len(groups_ids))
            query = f'''
                SELECT DISTINCT f.imageID
                FROM faces f
                WHERE f.groupID IN ({placeholders})
            '''
            results = self.db.execute_query(query, groups_ids)
            image_ids = [row[0] for row in results]
            
            if only:
                # Any image shouldn't belong to any groups that aren't in groups list
                if image_ids:
                    image_placeholders = ','.join(['?'] * len(image_ids))
                    query = f'''
                        SELECT f.imageID
                        FROM faces f
                        WHERE f.imageID IN ({image_placeholders})
                        GROUP BY f.imageID
                        HAVING COUNT(DISTINCT f.groupID) = (
                            SELECT COUNT(DISTINCT f2.groupID)
                            FROM faces f2
                            WHERE f2.imageID = f.imageID
                            AND f2.groupID IN ({placeholders})
                        )
                    '''
                    results = self.db.execute_query(query, image_ids + groups_ids)
                    return [row[0] for row in results]
                return []
            
            return image_ids
    
    def get_related_groups(self, groups_id: List[str], mode: str = 'and', only: bool = False) -> List[str]:
        """
        Get related groups based on filtered images.
        
        Args:
            groups_id: List of group IDs
            mode: 'and' or 'or'
            only: If True, any image shouldn't belong to any groups that aren't in groups list
        
        Returns:
            List of group IDs ordered by relevance
        """
        # Get filtered images first
        filtered_images = self.get_filtered_images(groups_id, mode, only)
        
        if not filtered_images:
            return []
        
        if mode == 'or':
            # Return all groups
            query = '''
                SELECT g.groupID, g.label, g.face_representive, 
                       COUNT(DISTINCT CASE WHEN f2.groupID IN ({}) THEN f.imageID END) as common_images
                FROM groups g
                LEFT JOIN faces f ON g.groupID = f.groupID
                LEFT JOIN faces f2 ON f.imageID = f2.imageID
                WHERE g.groupID NOT IN ({})
                GROUP BY g.groupID, g.label, g.face_representive
                HAVING common_images > 0
                ORDER BY common_images DESC
            '''
            placeholders = ','.join(['?'] * len(groups_id))
            results = self.db.execute_query(query.format(placeholders, placeholders), groups_id + groups_id)
        
        else:  # mode == 'and'
            # Return groups that have images in any of filtered_images
            image_placeholders = ','.join(['?'] * len(filtered_images))
            placeholders = ','.join(['?'] * len(groups_id))
            query = f'''
                SELECT g.groupID, g.label, g.face_representive, COUNT(DISTINCT f.imageID) as shared_images
                FROM groups g
                JOIN faces f ON g.groupID = f.groupID
                WHERE f.imageID IN ({image_placeholders})
                AND g.groupID NOT IN ({placeholders})
                GROUP BY g.groupID, g.label, g.face_representive
                ORDER BY shared_images DESC
            '''
            results = self.db.execute_query(query, filtered_images + groups_id)
        
        # Return group IDs in order: first list of given groups with original order, then by num sharing
        related_group_ids = []
        
        # First add the given groups with original order
        for group_id in groups_id:
            related_group_ids.append(group_id)
        
        # Then add the related groups ordered by relevance
        for row in results:
            group_id = row[0]
            if group_id not in related_group_ids:
                related_group_ids.append(group_id)
        
        return related_group_ids
    
    def _build_complete_photo_data(self, image_id: str, group_filter: str = None) -> Dict:
        """
        Build complete photo data with all related information.
        This is similar to build_complete_photo_data in app.py but as a method.
        """
        try:
            image = self.images_model.get(image_id)
            if not image:
                return None
            
            # Get face IDs for this image
            face_ids = self.images_model.get_faces(image_id)
            
            # Build faces data
            faces_data = []
            for face_id in face_ids:
                face = self.faces_model.get(face_id)
                if face:
                    # Apply group filter if specified
                    if group_filter and face.get('groupID') != group_filter:
                        continue
                    
                    group = None
                    if face.get('groupID'):
                        group = self.groups_model.get(face['groupID'])
                    
                    face_data = {
                        'face_id': face_id,
                        'face_coords': {
                            'Left': face['left'],
                            'Top': face['top'], 
                            'Width': face['width'],
                            'Height': face['height']
                        },
                        'group_id': face.get('groupID'),
                        'group_label': group['label'] if group else 'Unknown',
                        'group_representative': group.get('face_representive') if group else None
                    }
                    faces_data.append(face_data)
            
            # Get moment info if available
            moment_info = None
            if image.get('momentID'):
                moment = self.moments_model.get(image['momentID'])
                if moment:
                    moment_info = {
                        'id': moment['id'],
                        'title': moment['title'],
                        'description': moment.get('description', ''),
                        'start': moment.get('start'),
                    }
            
            # Build complete response
            photo_data = {
                'id': image_id,
                'name': image['name'],
                'date_taken': image.get('date_taken'),
                'file_size': image.get('file_size'),
                'width': image.get('width'),
                'height': image.get('height'),
                'faces_count': len(faces_data),
                'faces': faces_data,
                'moment': moment_info,
                'urls': {
                    'display': f'/api/events/{self.id}/display/{image_id}.webp',
                    'thumbnail': f'/api/events/{self.id}/thumb/{image_id}.webp',
                    'high_quality': f'/api/events/{self.id}/high_quality/{image_id}.webp',
                    'original': f'/api/events/{self.id}/original/{image_id}.webp',
                }
            }
            
            return photo_data
        except Exception as e:
            return None

    def add(self, **fields) -> 'Event':
        super().add(**fields)
        self.last_group_id = 0
        return self

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
            os.remove(os.path.join(self.high_quality_dir, f"{image_id}.jpg"))
            os.remove(os.path.join(self.display_dir, f"{image_id}.jpg"))
            os.remove(os.path.join(self.thumb_dir, f"{image_id}.jpg"))
        except FileNotFoundError:
            pass

    def transfer_faces(self, old_group_id: str, face_ids: list, target_group_id: str = None, new_group_name: str = None) -> dict:
        """
        Transfer faces from one group to another group or create a new group.
        
        Args:
            old_group_id: ID of the source group
            face_ids: List of face IDs to transfer
            target_group_id: ID of the target group (if None, will create new group)
            new_group_name: Name for the new group (required if target_group_id is None)
            
        Returns:
            dict: Result with target_group_id, whether old group was deleted, and transferred info
        """
        if not face_ids:
            return {'target_group_id': None, 'old_group_deleted': False}
        
        # Validate old group exists
        old_group = self.groups_model.get(old_group_id)
        if not old_group:
            raise ValueError(f"Source group {old_group_id} not found")
        
        # Determine target group
        target_group_id_was_provided = target_group_id is not None
        if target_group_id:
            # Transfer to existing group
            target_group = self.groups_model.get(target_group_id)
            if not target_group:
                raise ValueError(f"Target group {target_group_id} not found")
        else:
            # Create new group
            if not new_group_name:
                raise ValueError("new_group_name is required when target_group_id is not provided")
            
            # Check for name conflicts
            conflict_check = self.groups_model.check_name_conflict(new_group_name)
            if conflict_check['conflict']:
                raise ValueError(f"Group name '{new_group_name}' already exists")
            
            # Create new group with biggest face as representative
            representative_face = self.faces_model.get_biggest_face(face_ids) if face_ids else ''
            target_group_data = self.groups_model.add(
                label=new_group_name,
                face_representive=representative_face
            )
            target_group_id = target_group_data['groupID']
        
        # Get all photos that will be added to target group (photos containing transferred faces)
        query = '''
            SELECT DISTINCT imageID 
            FROM faces 
            WHERE faceID IN ({}) AND groupID = ?
        '''.format(','.join(['?'] * len(face_ids)))
        
        photos_to_add_to_target = set()
        results = self.db.execute_query(query, (*face_ids, old_group_id))
        for row in results:
            photos_to_add_to_target.add(row[0])
        
        # Transfer faces to target group
        self.groups_model.add_faces(target_group_id, face_ids)
        
        # Check which photos no longer belong to source group after transfer
        photos_to_remove_from_source = set()
        for photo_id in photos_to_add_to_target:
            # Check if source group still has faces in this photo
            source_faces_in_photo = self.get_faces_by_image_and_group(photo_id, old_group_id)
            if not source_faces_in_photo:
                photos_to_remove_from_source.add(photo_id)
        
        # Check if any transferred face was the representative of the old group
        old_representative = old_group.get('face_representive', '')
        representative_transferred = old_representative in face_ids
        
        # Check if old group is now empty and delete it if so
        old_group_deleted = False
        if self.is_group_empty(old_group_id):
            self.groups_model.delete(old_group_id)
            old_group_deleted = True
        elif representative_transferred:
            # If the representative was transferred, choose a new representative with highest resolution
            old_group_faces = self.groups_model.get_faces(old_group_id)
            new_representative = self.faces_model.get_biggest_face(old_group_faces)
            if new_representative:
                self.groups_model.edit(old_group_id, {'face_representive': new_representative})
        
        # Get updated source group data if it wasn't deleted
        updated_source_group = None
        if not old_group_deleted:
            updated_source_group = self.groups_model.get(old_group_id)
        
        # Get updated target group data
        updated_target_group = self.groups_model.get(target_group_id)
        
        result = {
            'target_group_id': target_group_id,
            'old_group_deleted': old_group_deleted,
            'transferred_faces': face_ids,
            'photos_to_remove_from_source': list(photos_to_remove_from_source),
            'photos_to_add_to_target': list(photos_to_add_to_target),
            'updated_source_group': updated_source_group,
            'updated_target_group': updated_target_group
        }
        
        # Include new group name if a new group was created
        if not target_group_id_was_provided:
            result['new_group_name'] = new_group_name
            
        return result

    def merge_groups(self, group_ids: list, main_group_id: str = '') -> str:
        """
        Merge multiple groups into one main group.
        
        Args:
            group_ids: List of group IDs to merge
            main_group_id: ID of the main group (if not provided, will be determined by resolution)
            
        Returns:
            The ID of the main group after merging
        """
        if not group_ids:
            return ''
        
        # If no main group specified, determine it based on face representative resolution
        if not main_group_id:
            faces = []
            for group_id in group_ids:
                faces.extend(self.groups_model.get_faces(group_id))
            biggest_face = self.faces_model.get_biggest_face(faces)
            main_group_id = self.faces_model.get(biggest_face)['groupID']
        
        # Get all groups to merge
        groups_to_merge = [self.groups_model.get(gid) for gid in group_ids if gid != main_group_id]
        
        # Update all faces to point to the main group
        placeholders = ','.join(['?'] * len(group_ids))
        query = f"UPDATE faces SET groupID=? WHERE groupID IN ({placeholders})"
        self.db.execute_query(query, (main_group_id, *group_ids))
        
        # Delete the other groups
        for group in groups_to_merge:
            if group:
                self.groups_model.delete(group['groupID'])
        
        return main_group_id

    def process_new_images(self, 
                          display_size: int = 2048, 
                          thumb_size: int = 512,
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
            return self.faces_model.get_add_data(
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
                representative_face_id = self.faces_model.get_biggest_face(cluster)
                group_data = self.groups_model.add(
                    label=f"Person {group_num}",
                    face_representive=representative_face_id
                )
                group_id = group_data['groupID']
                self.groups_model.add_faces(group_id, cluster)
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
                image_id = self.images_model.add(
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
    event = Event(event_id)
    event.face_utils.rek_helper.delete_collection()
    Event.delete(event_id)
    # Remove the event directory and its contents
    event_dir = os.path.join(DATA_ROOT, event_id)
    if os.path.exists(event_dir):
        import shutil
        shutil.rmtree(event_dir)
get_event = lambda event_id, profile_id=None: Event(event_id, profile_id=profile_id)
list_events = Event.list_all 