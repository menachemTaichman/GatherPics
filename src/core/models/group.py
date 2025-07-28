from typing import Optional, List, Dict
from .base_model import BaseModel
from ..db import AppDB

class Groups(BaseModel):
    def __init__(self, db: AppDB):
        super().__init__(db, table_name='groups', id_field='groupID')

    def get_add_data(self, label: str = '', face_representive: str = '', face_IDs: List[str] = []) -> Dict:
        return {
            'label': label,
            'face_representive': face_representive
        }

    def add(self, label: str = '', face_representive: str = '', face_IDs: List[str] = []) -> Dict:
        # Handle duplicate labels by appending a number
        final_label = self._ensure_unique_label(label)
        group_data = super().add(final_label, face_representive, face_IDs)
        group_id = group_data['groupID']
        self.add_faces(group_id, face_IDs)
        return group_data

    def _ensure_unique_label(self, label: str) -> str:
        """Ensure label is unique by appending a number if needed."""
        if not label:
            return label
        
        original_label = label
        counter = 1
        while True:
            existing = self.db.get_one(self.table_name, {'label': label})
            if not existing:
                return label
            label = f"{original_label} ({counter})"
            counter += 1

    def edit(self, entity_id: str, fields: Dict) -> None:
        """Edit a group with validation for unique labels."""
        if 'label' in fields and fields['label']:
            # Check for duplicate labels (excluding current group)
            existing = self.db.get_one(self.table_name, {'label': fields['label']})
            if existing and existing[self.id_field] != entity_id:
                raise ValueError(f"Group with label '{fields['label']}' already exists")
        super().edit(entity_id, fields)

    def add_faces(self, group_id: str, face_ids: List[str]) -> None:
        if not face_ids:
            return
        placeholders = ','.join(['?'] * len(face_ids))
        query = f"UPDATE faces SET groupID=? WHERE faceID IN ({placeholders})"
        self.db.execute_query(query, (group_id, *face_ids))

    def get_faces(self, group_id: str) -> List[str]:
        results = self.db.execute_query('SELECT faceID FROM faces WHERE groupID=?', (group_id,))
        return [row[0] for row in results]

    def get_images(self, group_id: str) -> List[str]:
        query = '''
            SELECT DISTINCT f.imageID 
            FROM faces f 
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

    def merge_groups(self, group_ids: List[str], main_group_id: str = '') -> str:
        if not group_ids:
            return ''
        if not main_group_id:
            main_group_id = group_ids[0]
        placeholders = ','.join(['?'] * len(group_ids))
        query = f"UPDATE faces SET groupID=? WHERE groupID IN ({placeholders})"
        self.db.execute_query(query, (main_group_id, *group_ids))
        return main_group_id

    def find_overlaps(self) -> List[List[str]]:
        return []
