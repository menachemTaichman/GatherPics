from typing import Optional, List, Dict
from .base_model import BaseModel
from ..db import AppDB

class Profiles(BaseModel):
    def __init__(self, db: AppDB):
        super().__init__(db, table_name='profiles', id_field='profileID')

    def get_add_data(self,
        label: str = '',
        hierarchy_rank: int = 0,
        all_images: bool = False,
        can_upload_images: bool = False,
        can_delete_images: bool = False,
        can_edit_groups: bool = False,
        can_edit_moments: bool = False,
        all_albums: bool = False,
        can_edit_albums: bool = False,
        save_preferences: bool = False
    ) -> Dict:
        return {
            'label': label,
            'hierarchy_rank': hierarchy_rank,
            'all_images': all_images,
            'can_upload_images': can_upload_images,
            'can_delete_images': can_delete_images,
            'can_edit_groups': can_edit_groups,
            'can_edit_moments': can_edit_moments,
            'all_albums': all_albums,
            'can_edit_albums': can_edit_albums,
            'save_preferences': save_preferences
        }

    def add(
        self,
        label: str = '',
        hierarchy_rank: int = 0,
        all_images: bool = False,
        can_upload_images: bool = False,
        can_delete_images: bool = False,
        can_edit_groups: bool = False,
        can_edit_moments: bool = False,
        all_albums: bool = False,
        can_edit_albums: bool = False,
        save_preferences: bool = False,
        accessible_image_IDs: List[str] = None,
    ) -> Dict:
        profile_data = super().add(label, hierarchy_rank, all_images, can_upload_images, can_delete_images, can_edit_groups, can_edit_moments, all_albums, can_edit_albums, save_preferences)
        if not all_images:
            profile_id = profile_data['profileID']
            self.add_accessible_images(profile_id, accessible_image_IDs)
        return profile_data

    def edit(self, profile_id: str, fields: Dict) -> Dict:
        current_profile = self.get(profile_id)
        explicit_images = fields.get('explicit_images', None)
        explicit_albums = fields.get('explicit_albums', None)
        del fields['explicit_images']
        del fields['explicit_albums']
        
        if 'all_images' in fields.keys() and current_profile['all_images'] != fields['all_images']:
            self.db.secure_delete('profile_images', {'profileID': profile_id})

        if 'all_albums' in fields.keys() and current_profile['all_albums'] != fields['all_albums']:
            self.db.secure_delete('profile_albums', {'profileID': profile_id})
        
        result = super().edit(profile_id, fields)

        if explicit_images:
            if result['all_images']:
                self.remove_accessible_images(profile_id, explicit_images)
            else:
                self.add_accessible_images(profile_id, explicit_images)
        if explicit_albums:
            if result['all_albums']:
                self.remove_accessible_albums(profile_id, explicit_albums)
            else:
                self.add_accessible_albums(profile_id, explicit_albums)
        
        return self.get(profile_id)

    def get(self, profile_id: str) -> Optional[Dict]:
        profile = super().get(profile_id)
        if profile:
            profile['label'] = profile.get('label', '')
            profile['hierarchy_rank'] = profile.get('hierarchy_rank', 0)
            profile['all_images'] = profile.get('all_images', False)
            profile['can_upload_images'] = profile.get('can_upload_images', False)
            profile['can_delete_images'] = profile.get('can_delete_images', False)
            profile['can_edit_groups'] = profile.get('can_edit_groups', False)
            profile['can_edit_moments'] = profile.get('can_edit_moments', False)
            profile['all_albums'] = profile.get('all_albums', False)
            profile['can_edit_albums'] = profile.get('can_edit_albums', False)
            profile['save_preferences'] = profile.get('save_preferences', False)
        return profile

    def list(self) -> List[Dict]:
        profiles = super().list()
        for profile in profiles:
            profile['label'] = profile.get('label', '')
            profile['hierarchy_rank'] = profile.get('hierarchy_rank', 0)
            profile['all_images'] = profile.get('all_images', False)
            profile['can_upload_images'] = profile.get('can_upload_images', False)
            profile['can_delete_images'] = profile.get('can_delete_images', False)
            profile['can_edit_groups'] = profile.get('can_edit_groups', False)
            profile['can_edit_moments'] = profile.get('can_edit_moments', False)
            profile['all_albums'] = profile.get('all_albums', False)
            profile['can_edit_albums'] = profile.get('can_edit_albums', False)
            profile['save_preferences'] = profile.get('save_preferences', False)
        return profiles

    def add_accessible_images(self, profile_id: str, image_ids: List[str]) -> bool:
        is_all_images = self.get(profile_id)['all_images']
        # Get existing accessible image IDs for this profile
        existing_accessible_ids = set(self._get_explicitly_accessible_images(profile_id))
        to_insert = [
            {'profileID': profile_id, 'imageID': image_id} if is_all_images else {'profileID': profile_id, 'imageID': image_id, 'accessible': 1}
            for image_id in image_ids if image_id not in existing_accessible_ids
        ]
        if is_all_images:
            return self.db.secure_delete('profile_images', to_insert)
        else:
            return self.db.secure_insert('profile_images', to_insert)

    def remove_accessible_images(self, profile_id: str, image_ids: List[str]) -> bool:
        is_all_images = self.get(profile_id)['all_images']
        to_remove = [
            {'profileID': profile_id, 'imageID': image_id, 'accessible': 0} if is_all_images else {'profileID': profile_id, 'imageID': image_id}
            for image_id in image_ids
            if image_id in self._get_explicitly_accessible_images(profile_id)
        ]
        if is_all_images:
            return self.db.secure_insert('profile_images', to_remove)
        else:
            return self.db.secure_delete('profile_images', to_remove)

    def _get_explicitly_accessible_images(self, profile_id: str) -> List[str]:
        if self.get(profile_id)['all_images']:
            # Return all images except those explicitly excluded (accessible=0) for this profile
            # Use accessible_images view for read operations
            accessible_table = self.db._get_accessible_table_name('images')
            query = f'''
                SELECT {accessible_table}.imageID
                FROM {accessible_table}
                LEFT JOIN profile_images ON {accessible_table}.imageID = profile_images.imageID AND profile_images.profileID = ?
                WHERE profile_images.accessible IS NULL OR profile_images.accessible != 0
            '''
            results = self.db.execute_query(query, (profile_id,))
        else:
            # Return only explicitly allowed images (accessible=1) for this profile
            results = self.db.execute_query('SELECT imageID FROM profile_images WHERE profileID=? AND accessible=1', (profile_id,))
        return [row[0] for row in results]

    def add_accessible_albums(self, profile_id: str, album_ids: List[str]) -> bool:
        is_all_albums = self.get(profile_id)['all_albums']
        # Get existing accessible image IDs for this profile
        existing_accessible_ids = set(self._get_explicitly_accessible_albums(profile_id))
        to_insert = [
            {'profileID': profile_id, 'albumID': album_id} if is_all_albums else {'profileID': profile_id, 'albumID': album_id, 'accessible': 1}
            for album_id in album_ids if album_id not in existing_accessible_ids
        ]
        if is_all_albums:
            return self.db.secure_delete('profile_albums', to_insert)
        else:
            return self.db.secure_insert('profile_albums', to_insert)

    def remove_accessible_albums(self, profile_id: str, album_ids: List[str]) -> bool:
        is_all_albums = self.get(profile_id)['all_albums']
        to_remove = [
            {'profileID': profile_id, 'albumID': album_id, 'accessible': 0} if is_all_albums else {'profileID': profile_id, 'albumID': album_id}
            for album_id in album_ids
            if album_id in self._get_explicitly_accessible_albums(profile_id)
        ]
        if is_all_albums:
            return self.db.secure_insert('profile_albums', to_remove)
        else:
            return self.db.secure_delete('profile_albums', to_remove)

    def _get_explicitly_accessible_albums(self, profile_id: str) -> List[str]:
        if self.get(profile_id)['all_albums']:
            # Return all albums except those explicitly excluded (accessible=0) for this profile
            # Use accessible_albums view for read operations
            accessible_table = self.db._get_accessible_table_name('albums')
            query = f'''
                SELECT {accessible_table}.albumID
                FROM {accessible_table}
                LEFT JOIN profile_albums ON {accessible_table}.albumID = profile_albums.albumID AND profile_albums.profileID = ?
                WHERE profile_albums.accessible IS NULL OR profile_albums.accessible != 0
            '''
            results = self.db.execute_query(query, (profile_id,))
        else:
            # Return only explicitly allowed albums (accessible=1) for this profile
            results = self.db.execute_query('SELECT albumID FROM profile_albums WHERE profileID=? AND accessible=1', (profile_id,))
        return [row[0] for row in results]