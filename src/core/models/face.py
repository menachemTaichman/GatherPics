from typing import List, Dict
from .base_model import BaseModel
from ..db import AppDB

class Faces(BaseModel):
    def __init__(self, db: AppDB):
        super().__init__(db, table_name='faces', id_field='faceID')

    def get_add_data(self, image_ID: str = '', width: float = 0.0, height: float = 0.0, left: float = 0.0, top: float = 0.0, face_ID: str = '', group_ID: str = '') -> Dict:
        return {
            'imageID': image_ID,
            'width': width,
            'height': height,
            'left': left,
            'top': top,
            'faceID': face_ID,
            'groupID': group_ID
        }

    def find_broken_faces(self) -> List[str]:
        return []

    def delete(self, face_ID: str):
        super().delete(face_ID)
        # Note: face_utils.rek_helper.delete_faces would need to be called from the Event level
        # to avoid circular references

