from typing import List, Dict
from PIL import Image as PILImage
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

    def get_pil_image(self, image_id: str, version: str = 'original') -> 'PILImage.Image':
        import os
        from PIL import Image as PILImage
        image_path = os.path.join('src', 'data', version, f'{image_id}.jpg')
        return PILImage.open(image_path)

    def get_faces(self, image_id: str) -> List[str]:
        results = self.db.execute_query('SELECT faceID FROM faces WHERE imageID=?', (image_id,))
        return [row[0] for row in results]