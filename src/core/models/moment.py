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
            'end': end,
            'representative_image': ''
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
            images_to_add = fields.get('images_to_add', [])
            images_to_remove = fields.get('images_to_remove', [])
            
            if 'images_to_add' in fields:
                del fields['images_to_add']
            if 'images_to_remove' in fields:
                del fields['images_to_remove']

            super().edit(entity_id, fields)            
            self.add_image_to_moment(entity_id, images_to_add)
            self.remove_image_from_moment(entity_id, images_to_remove)
                
        except Exception:
            raise

    def add_image_to_moment(self, moment_id: str, image_ids: List[str]) -> None:
        if not image_ids:  # Guard against empty lists
            return
        image_placeholders = ','.join(['?'] * len(image_ids))   
        query = 'UPDATE images SET momentID=? WHERE imageID IN ({})'.format(image_placeholders)
        self.db.execute_query(query, (moment_id, *image_ids))

        representative_image = self.get(moment_id)['representative_image']
        # Set the first image ID as representative image if none exists
        if (representative_image == '' or representative_image is None) and image_ids:
            self.edit(moment_id, {'representative_image': image_ids[0]})

        for moment in self.list():
            if moment['representative_image'] in image_ids:
                if len(moment['image_IDs']) > 0:
                    new_representative_image = moment['image_IDs'][0]
                else:
                    new_representative_image = ''
                self.edit(moment['momentID'], {'representative_image': new_representative_image})

    def remove_image_from_moment(self, moment_id: str, image_ids: List[str]) -> None:
        if not image_ids:  # Guard against empty lists
            return
        image_placeholders = ','.join(['?'] * len(image_ids))
        query = 'UPDATE images SET momentID=NULL WHERE imageID IN ({}) AND momentID=?'.format(image_placeholders)
        self.db.execute_query(query, (*image_ids, moment_id))

        # Check if the current representative image is being removed
        current_representative_image = self.get(moment_id)['representative_image']
        if current_representative_image and current_representative_image in image_ids:
            # Find a new representative image from remaining images
            remaining_images = self.get_images(moment_id)
            if remaining_images:
                self.edit(moment_id, {'representative_image': remaining_images[0]})
            else:
                # No images left, clear representative image
                self.edit(moment_id, {'representative_image': ''})

    def get_images(self, moment_id: str) -> List[str]:
        # Use accessible_images view for read operations
        accessible_table = self.db._get_accessible_table_name('images')
        results = self.db.execute_query(f'SELECT imageID FROM {accessible_table} WHERE momentID=?', (moment_id,))
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

    def set_images(self, moment_id: str, image_ids: List[str]):
        """Set the images for a given moment, removing old ones."""
        # First, remove all existing images from the moment
        self.db.execute_query('UPDATE images SET momentID = NULL WHERE momentID = ?', (moment_id,))
        # Then, add the new images
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
