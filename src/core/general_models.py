from typing import Dict, Any
from .base_db import ReturnFormat
from .base_models import BaseModels
from .general_db import GeneralDB
from .event import Event
from .errors import Forbidden

class GeneralModels(BaseModels):
    """Models manager for general database operations."""

    def __init__(self, profile_id: str | None = None):
        self.db = GeneralDB()
        self.profile_id = profile_id

    @property
    def profile_id(self) -> str | None:
        return self._profile_id
    
    @profile_id.setter
    def profile_id(self, profile_id: str | None):
        """
        Set the current profile id for access control
        Allow profile_id to be None for general operations, but raise an error if the id provided is not in the profiles table.
        """
        if profile_id is not None:
            query = 'SELECT profile_id FROM profiles WHERE profile_id = ?'
            profile_id = self.db.execute_query(query, (profile_id,), return_format=ReturnFormat.VALUE)
            if not profile_id:
                raise Exception(f'Profile {profile_id} not found')

        self._profile_id = profile_id

    @property
    def profile_context(self) -> dict:
        """Get the current profile id, ensuring it is set."""
        if self.profile_id is None:
            raise Exception('Profile id is not set')
        profile = self.get_entities('profiles', self.profile_id)
        profile['profile_id'] = self.profile_id
        return profile
    
    def is_exists(self, table: str, fields: Dict, exclude_id: str = None) -> str | None:
        """Check if a profile exists."""
        if table == 'profiles' and exclude_id and 'restricted_to_event' not in fields:
            profile = self.get_entities('profiles', exclude_id)
            if not profile:
                profile = {}

            fields['restricted_to_event'] = profile.get('restricted_to_event', None)

        return super().is_exists(table, fields, exclude_id)

    # Profile management
    def is_managable_profile(self, profile_id: str) -> bool:
        """Check if a profile is managable by the current profile."""
        profile = self.get_entities('profiles', profile_id)
        if not profile:
            return False
        
        return self.profile_context['hierarchy_rank'] > profile.get('hierarchy_rank') or self.profile_context['profile_id'] == profile_id

    def create_profile(self, label: str, password: str, hierarchy_rank: int, event_id: str | None = None, can_delete: bool = False) -> str:
        """
        Create a new profile.
        Returns:
            profile_id
        """
        if hierarchy_rank < 0:
            raise Exception('Profile hierarchy rank cannot be less than 0')
        
        if hierarchy_rank >= self.profile_context['hierarchy_rank']:
            raise Exception('Profile hierarchy rank cannot be updated to a higher rank than the current profile')
        
        if event_id and event_id not in self.get_childs('profiles', self.profile_context['profile_id'], 'events', return_ids=True):
            raise Exception('Profile does not have permissions in this event')

        profile_id = self.generate_id()
        self.add('profiles', {'profile_id': profile_id, 'label': label, 'password': password, 'hierarchy_rank': hierarchy_rank, 'restricted_to_event': event_id})
        if event_id:
            self.add_profile_to_event(profile_id, event_id, can_delete)

        return profile_id

    def delete_profile(self, profile_id: str, only_remove_from_event_id: str | None = None):
        """
        Delete a profile.
        If only_remove_from_event_id is provided, the profile will be removed from the event with the given id.
        """
        if not self.is_managable_profile(profile_id):
            raise Exception('Profile does not have permission to delete this profile')

        profile = self.get_entities('profiles', profile_id)
        restricted_to_event_id = profile.get('restricted_to_event')
        if only_remove_from_event_id and not restricted_to_event_id:
            self.remove_profile_from_event(profile_id, only_remove_from_event_id)
        else:
            self.delete('profiles', profile_id)

    def get_profile_password(self, profile_id: str) -> str:
        """Get the password for a profile."""
        if not self.is_managable_profile(profile_id):
            # raise forbidden instead of exception
            raise Forbidden(f'Profile does not have permission to get this profile password')
        
        query = 'SELECT password FROM profiles WHERE profile_id = ?'
        return self.db.execute_query(query, (profile_id,), return_format=ReturnFormat.VALUE)
    
    def update_profile(self, profile_id: str, *, password: str | None = None, label: str | None = None):
        """Update the password for a profile."""
        if not self.is_managable_profile(profile_id):
            raise Exception('Profile does not have permission to update this profile password')
        
        data = {}
        if password:
            data['password'] = password
        if label:
            data['label'] = label
        
        self.edit('profiles', profile_id, data)

        if password:
            self.revoke_all_refresh_tokens(profile_id)

    def update_profile_hierarchy_rank(self, profile_id: str, hierarchy_rank: int):
        """Update the hierarchy rank for a profile."""
        if not self.is_managable_profile(profile_id) or profile_id == self.profile_context['profile_id']:
            raise Exception('Profile does not have permission to update this profile hierarchy rank')

        if hierarchy_rank >= self.profile_context['hierarchy_rank']:
            raise Exception('Profile hierarchy rank cannot be updated to a higher rank than the current profile')

        self.edit('profiles', profile_id, {'hierarchy_rank': hierarchy_rank})
        event_ids = self.get_childs('profiles', profile_id, 'events', return_ids=True)
        for event_id in event_ids:
            self.sync_profile_to_event_db(profile_id, event_id, upsert=True)

    # Profile-Event management
    def add_profile_to_event(self, profile_id: str, event_id: str, can_delete: bool = True):
        """Add a profile to an event in the general DB and sync to event DB."""
        print(self.get_childs('profiles', profile_id, 'events', return_ids=True))
        if not event_id in self.get_childs('profiles', self.profile_context['profile_id'], 'events', return_ids=True):
            raise Exception('Profile does not have permissions in this event')

        if not self.is_managable_profile(profile_id):
            raise Exception('Profile does not have permissions in this profile')
        
        self.edit_childs('profiles', profile_id, 'events', [event_id], add=True, data={'can_delete': can_delete})
        self.sync_profile_to_event_db(profile_id, event_id, upsert=True)
    
    def remove_profile_from_event(self, profile_id: str, event_id: str):
        """Remove a profile from an event in the general DB and sync to event DB."""
        if not self.profile_context['profile_id'] in self.get_childs('profiles', profile_id, 'events', return_ids=True):
            raise Exception('Profile does not have permissions in this event')
        
        if not self.is_managable_profile(profile_id):
            raise Exception('Profile does not have permissions in this profile')
        
        self.sync_profile_to_event_db(profile_id, event_id, upsert=False)
        self.edit_childs('profiles', profile_id, 'events', [event_id], add=False)
    
    def sync_profile_to_event_db(self, profile_id: str, event_id: str, upsert: bool = True):
        """Updates event DB when profile is added/removed from an event."""        
        # Get event data to find DB path
        event_data = self.get_entities('events', event_id)
        if not event_data:
            return

        event = Event(event_id, self.profile_id)
        hierarchy_rank = -1
        if upsert:
            hierarchy_rank = self.get_entities('profiles', profile_id).get('hierarchy_rank')
        
        event.sync_profile_to_event_db(profile_id, upsert=upsert, hierarchy_rank=hierarchy_rank)
        
    # Event management
    def create_event(self, name: str, date: str, event_manager: str, url: str) -> str:
        """Create a new event with all necessary setup.

        Args:
            name: name of the event
            date: date of the event
            url: URL of the event
            event_manager: profile_id of the event manager
        
        Returns:
            event_id: str
        """
        if not self.profile_context['can_create_events']:
            raise Exception('Profile does not have permission to create events')
        
        settings = self.get_settings()
        developer_id = settings.get('developer_id')

        if self.profile_context['profile_id'] not in (developer_id, event_manager):
            raise Exception('Profile does not have permission to create this event')
                
        # Create event record
        event_id = self.add('events', {
            'name': name,
            'date': date,
            'url': url,
        })

        Event.create_event(event_id)
        self.add_profile_to_event(developer_id, event_id, can_delete=True)
        self.add_profile_to_event(event_manager, event_id, can_delete=True)

        return event_id
    
    def delete_event(self, event_id: str):
        """Delete an event and its associated data."""
        profile_id = self.profile_context['profile_id']
        query = 'SELECT can_delete FROM profiles_events WHERE profile_id = ? AND event_id = ?'
        can_delete = self.db.execute_query(query, (profile_id, event_id), return_format=ReturnFormat.VALUE)
        if not can_delete:
            raise Exception('Profile does not have permission to delete this event')

        Event.delete_event(event_id)         
        self.delete('events', event_id)
    
    def get_event_by_url(self, url: str) -> Dict[str, Any] | None:
        """Get an event by its URL."""
        fields = GeneralDB.get_view_fields('events')
        query = f'SELECT {fields} FROM events WHERE url = ?'
        return self.db.execute_query(query, (url,), return_format=ReturnFormat.DICT)

    def process_new_images(self, event_id: str, assign_moments: bool = False) -> dict:
        """Process new images for an event."""
        event = Event(event_id, self.profile_context['profile_id'])
        event_details = self.get_entities('events', event_id)
        return event.process_new_images(
            images_count_limit=event_details.get('images_count_limit', 0),
            image_size_limit_bytes=event_details.get('image_size_limit_bytes', 0),
            assign_moments=assign_moments
        )

    # Settings
    def get_settings(self) -> Dict[str, Any]:
        """Get system settings."""
        query = 'SELECT * FROM settings WHERE id = 1'
        result = self.db.execute_query(query, return_format=ReturnFormat.DICT)
        if not result:
            raise Exception('Settings not found')

        result['developer_hierarchy_rank'] = 10

        return result
    
    def update_settings(self, fields: Dict):
        """Update system settings."""
        self.edit('settings', 1, fields)

    # Auth helpers
    def authenticate_profile(self, label: str, password: str) -> str | None:
        """Authenticate a profile by label and password.
        
        Returns:
            profile_id if authenticated, None otherwise
        """
        query = 'SELECT profile_id FROM profiles WHERE label = ? AND password = ?'
        return self.db.execute_query(query, (label, password), return_format=ReturnFormat.VALUE)
    
    def create_refresh_token(self, profile_id: str, token: str, expires_at: str, user_agent: str = None, ip_address: str = None) -> int:
        """Create a new refresh token."""
        result = self.add('refresh_tokens', {
            'profile_id': profile_id,
            'token': token,
            'expires_at': expires_at,
            'user_agent': user_agent,
            'ip_address': ip_address
        })
        return result
    
    def validate_refresh_token(self, token: str) -> str | None:
        """Validate a refresh token and return profile_id if valid.
        
        Returns:
            profile_id if token is valid and not revoked/expired, None otherwise
        """
        query = '''
            SELECT profile_id
            FROM refresh_tokens
            WHERE token = ?
            AND revoked = 0
            AND datetime(expires_at) > datetime('now')
        '''
        return self.db.execute_query(query, (token,), return_format=ReturnFormat.VALUE)
    
    def revoke_refresh_token(self, token: str):
        """Revoke a refresh token."""
        query = '''
            UPDATE refresh_tokens
            SET revoked = 1, revoked_at = datetime('now')
            WHERE token = ?
        '''
        self.db.execute_query(query, (token,))

    def revoke_all_refresh_tokens(self, profile_id: str | None = None):
        """Revoke all refresh tokens for a profile."""
        query = '''
            UPDATE refresh_tokens
            SET revoked = 1, revoked_at = datetime('now')
            WHERE 1=1
        '''
        params = ()
        if profile_id:
            query += ' AND profile_id = ?'
            params = (profile_id,)

        self.db.execute_query(query, params)
