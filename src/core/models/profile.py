from typing import Optional, List, Dict
from .base_model import BaseModel
from ..db import AppDB

class Profiles(BaseModel):
    def __init__(self, db: AppDB):
        super().__init__(db, table_name='profiles', id_field='profileID')

    def get_add_data(self,
        label: str = '',
        password: str = '',
        hierarchy_rank: int = 0,
        is_profiles_manager: bool = False,
        can_edit: bool = False,
        all_images: bool = False,
        all_albums: bool = False,
        save_preferences: bool = False
    ) -> Dict:
        return {
            'label': label,
            'password': password,
            'hierarchy_rank': hierarchy_rank,
            'is_profiles_manager': is_profiles_manager,
            'can_edit': can_edit,
            'all_images': all_images,
            'all_albums': all_albums,
            'save_preferences': save_preferences
        }

    def get(self, profile_id: str) -> Optional[Dict]:
        profile = super().get(profile_id)
        if profile:
            profile['label'] = profile.get('label', '')
            profile['password'] = profile.get('password', '')
            profile['hierarchy_rank'] = profile.get('hierarchy_rank', 0)
            profile['is_profiles_manager'] = profile.get('is_profiles_manager', False)
            profile['can_edit'] = profile.get('can_edit', False)
            profile['all_images'] = profile.get('all_images', False)
            profile['all_albums'] = profile.get('all_albums', False)
            profile['save_preferences'] = profile.get('save_preferences', False)
        return profile

    def list(self) -> List[Dict]:
        profiles = super().list()
        for profile in profiles:
            profile['label'] = profile.get('label', '')
            profile['password'] = profile.get('password', '')
            profile['hierarchy_rank'] = profile.get('hierarchy_rank', 0)
            profile['all_images'] = profile.get('all_images', False)
            profile['all_albums'] = profile.get('all_albums', False)
            profile['is_profiles_manager'] = profile.get('is_profiles_manager', False)
            profile['can_edit'] = profile.get('can_edit', False)
            profile['save_preferences'] = profile.get('save_preferences', False)
        return profiles

    def add_accessible_images(self, profile_id: str, image_ids: List[str]):
        if not image_ids:
            return
        to_insert = [
            {'profileID': profile_id, 'imageID': image_id, 'accessible': 1}
            for image_id in image_ids
        ]
        self.db.insert('editable_profile_images', to_insert)

    def remove_accessible_images(self, profile_id: str, image_ids: List[str]):
        if not image_ids:
            return
        for image_id in image_ids:
            self.db.delete('editable_profile_images', {'profileID': profile_id, 'imageID': image_id})

    def add_accessible_albums(self, profile_id: str, album_ids: List[str]):
        if not album_ids:
            return
        to_insert = [
            {'profileID': profile_id, 'albumID': album_id, 'accessible': 1}
            for album_id in album_ids
        ]
        self.db.insert('editable_profile_albums', to_insert)

    def remove_accessible_albums(self, profile_id: str, album_ids: List[str]):
        if not album_ids:
            return
        for album_id in album_ids:
            self.db.delete('editable_profile_albums', {'profileID': profile_id, 'albumID': album_id})