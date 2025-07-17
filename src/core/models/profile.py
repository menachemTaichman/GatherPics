from typing import Optional, List, Dict
from .base_model import BaseModel
from .event import Event

class Profiles(BaseModel):
    def __init__(self, event: Event):
        super().__init__(event, table_name='profiles', id_field='profileID')

    def get_add_data(self, label: str = '', accessible_image_IDs: List[str] = [], can_edit_groups: bool = False, can_upload_photos: bool = False, can_edit_moments: bool = False) -> Dict:
        return {
            'label': label,
            'can_edit_groups': can_edit_groups,
            'can_upload_photos': can_upload_photos,
            'can_edit_moments': can_edit_moments
        }

    def add(self, label: str = '', accessible_image_IDs: List[str] = [], can_edit_groups: bool = False, can_upload_photos: bool = False, can_edit_moments: bool = False) -> Dict:
        profile_data = super().add(label, accessible_image_IDs, can_edit_groups, can_upload_photos, can_edit_moments)
        profile_id = profile_data['profileID']
        for image_id in accessible_image_IDs:
            self.add_accessible_image(profile_id, image_id)
        return profile_data

    def add_accessible_image(self, profile_id: str, image_id: str) -> None:
        existing = self.db.get_one('profile_images', {'profileID': profile_id, 'imageID': image_id})
        if not existing:
            self.db.insert('profile_images', {'profileID': profile_id, 'imageID': image_id})

    def remove_accessible_image(self, profile_id: str, image_id: str) -> None:
        self.db.delete('profile_images', {'profileID': profile_id, 'imageID': image_id})

    def can_access_image(self, profile_id: str, image_id: str) -> bool:
        existing = self.db.get_one('profile_images', {'profileID': profile_id, 'imageID': image_id})
        return existing is not None

    def get_accessible_images(self, profile_id: str) -> List[str]:
        results = self.db.execute_query('SELECT imageID FROM profile_images WHERE profileID=?', (profile_id,))
        return [row[0] for row in results]

    def get(self, profile_id: str) -> Optional[Dict]:
        profile = super().get(profile_id)
        if profile:
            profile['accessible_image_IDs'] = self.get_accessible_images(profile_id)
            profile['can_edit_groups'] = profile.get('can_edit_groups', False)
            profile['can_upload_photos'] = profile.get('can_upload_photos', False)
            profile['can_edit_moments'] = profile.get('can_edit_moments', False)
        return profile

    def list(self) -> List[Dict]:
        profiles = super().list()
        for profile in profiles:
            profile['accessible_image_IDs'] = self.get_accessible_images(profile['profileID'])
            profile['can_edit_groups'] = profile.get('can_edit_groups', False)
            profile['can_upload_photos'] = profile.get('can_upload_photos', False)
            profile['can_edit_moments'] = profile.get('can_edit_moments', False)
        return profiles

