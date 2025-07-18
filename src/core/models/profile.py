from typing import Optional, List, Dict
from .base_model import BaseModel
from ..db import AppDB

class Profiles(BaseModel):
    def __init__(self, db: AppDB):
        super().__init__(db, table_name='profiles', id_field='profileID')

    def get_add_data(self, label: str = '', all_images: bool = False, accessible_image_IDs: List[str] = [], can_edit_groups: bool = False, can_upload_photos: bool = False, can_edit_moments: bool = False) -> Dict:
        return {
            'label': label,
            'all_images': all_images,
            'can_edit_groups': can_edit_groups,
            'can_upload_photos': can_upload_photos,
            'can_edit_moments': can_edit_moments
        }

    def add_accessible_images(self, profile_id: str, image_ids: List[str]) -> None:
        if self.is_all_images(profile_id):
            return
        # Get existing image IDs for this profile
        existing_ids = set(self.get_accessible_images(profile_id))
        to_insert = [
            {'profileID': profile_id, 'imageID': image_id, 'accessible': True}
            for image_id in image_ids if image_id not in existing_ids
        ]
        if to_insert:
            self.add_many(to_insert)

    def add(self, label: str = '', all_images: bool = False, accessible_image_IDs: List[str] = [], can_edit_groups: bool = False, can_upload_photos: bool = False, can_edit_moments: bool = False) -> Dict:
        profile_data = super().add(label, all_images, accessible_image_IDs, can_edit_groups, can_upload_photos, can_edit_moments)
        if not all_images:
            profile_id = profile_data['profileID']
            self.add_accessible_images(profile_id, accessible_image_IDs)
        return profile_data

    def remove_accessible_image(self, profile_id: str, image_id: str) -> None:
        self.db.delete('profile_images', {'profileID': profile_id, 'imageID': image_id})

    def is_all_images(self, profile_id: str) -> bool:
        profile = self.get(profile_id)
        return profile['all_images'] if profile else False

    def can_access_image(self, profile_id: str, image_id: str) -> bool:
        existing = self.db.get_one('profile_images', {'profileID': profile_id, 'imageID': image_id})
        return existing is not None

    def get_accessible_images(self, profile_id: str) -> List[str]:
        if self.is_all_images(profile_id):
            # Return all images except those marked accessible=0 for this profile
            query = '''
                SELECT images.imageID
                FROM images
                LEFT JOIN profile_images ON images.imageID = profile_images.imageID AND profile_images.profileID = ?
                WHERE profile_images.accessible IS NULL OR profile_images.accessible != 0
            '''
            results = self.db.execute_query(query, (profile_id,))
        else:
            results = self.db.execute_query('SELECT imageID FROM profile_images WHERE profileID=? AND accessible=1', (profile_id,))
        return [row[0] for row in results]

    def get(self, profile_id: str) -> Optional[Dict]:
        profile = super().get(profile_id)
        if profile:
            profile['all_images'] = profile.get('all_images', False)
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

