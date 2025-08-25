from typing import List, Dict
from .base_model import BaseModel
from ..db import AppDB

class Images(BaseModel):
    def __init__(self, db: AppDB):
        super().__init__(db, table_name='images', id_field='imageID')

    def get_add_data(self, name: str = '', date_taken: str = '', file_size: int = 0, width: int = 0, height: int = 0, moment_id: str = '') -> Dict:
        return {
            'name': name,
            'date_taken': date_taken,
            'file_size': file_size,
            'width': width,
            'height': height,
            'momentID': moment_id if moment_id else None
        }

    def add(self, *args, **kwargs) -> Dict:
        data = super().add(*args, **kwargs)
        # Note: face_utils.rek_helper.index_faces would need to be called from the Event level
        # to avoid circular references
        return data
    
    def find_broken_images(self) -> List[str]:
        # Implement logic if needed
        return []
    
    def get_faces(self, image_id: str) -> List[str]:
        # Use accessible_faces view for read operations
        accessible_table = self.db._get_accessible_table_name('faces')
        results = self.db.execute_query(f'SELECT faceID FROM {accessible_table} WHERE imageID=?', (image_id,))
        return [row[0] for row in results]