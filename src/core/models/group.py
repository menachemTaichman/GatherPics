from typing import Optional, List, Dict
from .base_model import BaseModel
from ..db import AppDB

class Groups(BaseModel):
    def __init__(self, db: AppDB):
        super().__init__(db, table_name='groups', id_field='groupID')

    def get_add_data(self, label: str = '', face_representative: str = '', face_IDs: List[str] = []) -> Dict:
        return {
            'label': label,
            'face_representative': face_representative
        }

    def add(self, label: str = '', face_representative: str = '', face_IDs: List[str] = []) -> Dict:
        # Handle duplicate labels by appending a number
        final_label = self._ensure_unique_label(label)
        group_data = super().add(final_label, face_representative, face_IDs)
        group_id = group_data['groupID']
        self.add_faces(group_id, face_IDs)
        return group_data

    def _ensure_unique_label(self, label: str) -> str:
        """Ensure label is unique by appending a number if needed."""
        if not label:
            return label
        
        original_label = label
        counter = 1
        for _ in range(100):
            existing = self.db.is_exists(self.table_name, {'label': label})
            if not existing:
                return label
            label = f"{original_label} ({counter})"
            counter += 1

        raise ValueError(f"Group with label '{label}' already exists")

    def edit(self, entity_id: str, fields: Dict) -> None:
        """Edit a group with validation for unique labels."""
        if 'label' in fields and fields['label']:
            # Check for duplicate labels (excluding current group) - use is_exists method
            existing_id = self.db.is_exists(self.table_name, {'label': fields['label']})
            
            if existing_id and existing_id != entity_id:
                raise ValueError(f"Group with label '{fields['label']}' already exists")
        
        try:
            super().edit(entity_id, fields)
        except Exception as e:
            raise

    def add_faces(self, group_id: str, face_ids: List[str]) -> None:
        if not face_ids:
            return
        placeholders = ','.join(['?'] * len(face_ids))
        query = f"UPDATE faces SET groupID=? WHERE faceID IN ({placeholders})"
        self.db.execute_query(query, (group_id, *face_ids))

    def get_faces(self, group_id: str) -> List[str]:
        # Use accessible_faces view for read operations
        accessible_table = self.db._get_accessible_table_name('faces')
        results = self.db.execute_query(f'SELECT faceID FROM {accessible_table} WHERE groupID=?', (group_id,))
        return [row[0] for row in results]

    def get_images(self, group_id: str) -> List[str]:
        # Use accessible_faces view joined with accessible_images for read operations
        accessible_faces = self.db._get_accessible_table_name('faces')
        query = f'''
            SELECT DISTINCT f.imageID 
            FROM {accessible_faces} f 
            WHERE f.groupID = ?
        '''
        results = self.db.execute_query(query, (group_id,))
        return [row[0] for row in results]

    def get(self, group_id: str) -> Optional[Dict]:
        group = super().get(group_id)
        if group:
            group['face_IDs'] = self.get_faces(group_id)
            group['image_ids'] = self.get_images(group_id)
        return group

    def list(self) -> List[Dict]:
        groups = super().list()
        for group in groups:
            group['face_IDs'] = self.get_faces(group['groupID'])
            group['image_ids'] = self.get_images(group['groupID'])
        return groups
    
    def check_name_conflict(self, label: str, exclude_group_id: str = '') -> Dict:
        """Check if a group name already exists and return conflict info."""
        existing_id = self.db.is_exists(self.table_name, {'label': label})
        if not existing_id or existing_id == exclude_group_id:
            return {'conflict': False}
        
        # Get the conflicting group details
        conflicting_group = self.get(existing_id)
        return {
            'conflict': True,
            'conflicting_group': conflicting_group
        }

    def find_overlaps(self) -> List[List[str]]:
        return []
