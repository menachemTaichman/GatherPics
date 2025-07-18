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
        for image_id in image_IDs:
            self.add_image_to_moment(moment_id, image_id)
        return moment_data

    def add_image_to_moment(self, moment_id: str, image_id: str) -> None:
        self.db.execute_query('UPDATE images SET momentID=? WHERE imageID=?', (moment_id, image_id))

    def remove_image_from_moment(self, moment_id: str, image_id: str) -> None:
        self.db.execute_query('UPDATE images SET momentID=NULL WHERE imageID=? AND momentID=?', (image_id, moment_id))

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
