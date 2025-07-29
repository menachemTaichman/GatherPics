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
            'groupID': group_ID if group_ID else None
        }

    def find_broken_faces(self) -> List[str]:
        return []

    def delete(self, face_ID: str):
        super().delete(face_ID)
        # Note: face_utils.rek_helper.delete_faces would need to be called from the Event level
        # to avoid circular references

    def get_biggest_face(self, face_ids: List[str]) -> str:
        """
        Get the face with the highest resolution from a list of face IDs.
        
        Args:
            face_ids: List of face IDs to compare
            
        Returns:
            The face ID with the highest resolution, or the first face if none found
        """
        if not face_ids:
            return ''
        
        max_resolution = 0
        biggest_face_id = face_ids[0]  # Default to first face
        
        for face_id in face_ids:
            face = self.get(face_id)
            if face:
                resolution = face.get('width', 0) * face.get('height', 0)
                if resolution > max_resolution:
                    max_resolution = resolution
                    biggest_face_id = face_id
        
        return biggest_face_id

