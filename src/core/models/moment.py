from typing import Optional, List, Dict
from .base_model import BaseModel
from ..db import AppDB

class Moments(BaseModel):
    def __init__(self, db: AppDB):
        super().__init__(db, table_name='moments', id_field='momentID')

    def get_add_data(self, label: str = '', description: str = '', start: str = '', end: str = '', image_IDs: List[str] = []) -> Dict:
        return {
            'label': label,
            'description': description,
            'start': start,
            'end': end
        }

    def add(self, label: str = '', description: str = '', start: str = '', end: str = '', image_IDs: List[str] = []) -> Dict:
        moment_data = super().add(label, description, start, end, image_IDs)
        moment_id = moment_data['momentID']
        if image_IDs:  # Only process if there are images
            self.add_image_to_moment(moment_id, image_IDs)
        return moment_data

    def edit(self, entity_id: str, fields: Dict) -> None:
        """Edit a moment with validation for unique labels."""
        
        if 'label' in fields and fields['label']:
            # Check for duplicate labels (excluding current moment) - use is_exists method
            existing_id = self.db.is_exists(self.table_name, {'label': fields['label']})
            
            if existing_id and existing_id != entity_id:
                raise ValueError(f"Moment with label '{fields['label']}' already exists")
        
        try:
            super().edit(entity_id, fields)
            
            # Handle photo updates - support both incremental and full replacement
            if 'image_IDs' in fields:
                # Use set_photos which handles the complete replacement logic
                self.set_photos(entity_id, fields['image_IDs'])
            elif 'photos_to_add' in fields or 'photos_to_remove' in fields:
                # Handle incremental updates
                photos_to_add = fields.get('photos_to_add', [])
                photos_to_remove = fields.get('photos_to_remove', [])
                self.update_photos_incrementally(entity_id, photos_to_add, photos_to_remove)
                
        except Exception as e:
            raise

    def add_image_to_moment(self, moment_id: str, image_ids: List[str]) -> None:
        if not image_ids:  # Guard against empty lists
            return
        image_placeholders = ','.join(['?'] * len(image_ids))   
        query = 'UPDATE images SET momentID=? WHERE imageID IN ({})'.format(image_placeholders)
        self.db.execute_query(query, (moment_id, *image_ids))

    def remove_image_from_moment(self, moment_id: str, image_ids: List[str]) -> None:
        if not image_ids:  # Guard against empty lists
            return
        image_placeholders = ','.join(['?'] * len(image_ids))
        query = 'UPDATE images SET momentID=NULL WHERE imageID IN ({}) AND momentID=?'.format(image_placeholders)
        self.db.execute_query(query, (moment_id, *image_ids))

    def update_photos_incrementally(self, moment_id: str, photos_to_add: List[str], photos_to_remove: List[str]) -> None:
        """Update moment photos incrementally by adding and removing specific photos."""
        
        try:
            # Remove photos first
            if photos_to_remove:
                self.remove_image_from_moment(moment_id, photos_to_remove)
            
            # Add new photos
            if photos_to_add:
                self.add_image_to_moment(moment_id, photos_to_add)
            
        except Exception:
            raise

    def get_images(self, moment_id: str) -> List[str]:
        results = self.db.execute_query('SELECT imageID FROM images WHERE momentID=?', (moment_id,))
        return [row[0] for row in results]

    def get(self, moment_id: str) -> Optional[Dict]:
        moment = super().get(moment_id)
        if moment:
            moment['image_IDs'] = self.get_images(moment_id)
        return moment

    def list(self) -> List[Dict]:
        moments = super().list()
        for moment in moments:
            moment['image_IDs'] = self.get_images(moment['momentID'])
        return moments

    def set_photos(self, moment_id: str, image_ids: List[str]):
        """Set the photos for a given moment, removing old ones."""
        # First, remove all existing photos from the moment
        self.db.execute_query('UPDATE images SET momentID = NULL WHERE momentID = ?', (moment_id,))
        # Then, add the new photos
        if image_ids:  # Only add if there are new images
            self.add_image_to_moment(moment_id, image_ids)

    def check_name_conflict(self, label: str, exclude_moment_id: str = '') -> Dict:
        """Check if a moment name already exists and return conflict info."""
        existing_id = self.db.is_exists(self.table_name, {'label': label})
        if not existing_id or existing_id == exclude_moment_id:
            return {'conflict': False}
        
        # Get the conflicting moment details
        conflicting_moment = self.get(existing_id)
        return {
            'conflict': True,
            'conflicting_moment': conflicting_moment
        }
