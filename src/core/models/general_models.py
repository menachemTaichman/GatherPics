from typing import Dict, Any
import secrets
from src.core.database.base_db import ReturnFormat
from src.core.models.base_models import BaseModels, ChildOperation
from src.core.database.general_db import GeneralDB
from src.core.services.event import Event
from src.core.errors import DBPolicyError, Forbidden

class GeneralModels(BaseModels):
    """Models manager for general database operations."""

    def __init__(self, profile_id: str | None = None):
        self.db = GeneralDB(profile_id)

    def get_current_profile(self, event_id: str | None = None) -> dict[str, Any]:
        """Get the current profile."""
        profile = self.db.execute_query('SELECT * FROM current_profile', return_format=ReturnFormat.DICT)
        _, events_relation = self.get_childs('profiles', profile['profile_id'], 'events')
        profile['events'] = events_relation
              
        if event_id:
            event = self.get_event(event_id)
            profile_event = event.models.get_current_profile()
            profile_event.pop('profile_id')
            profile_event.pop('label')
            profile['events'][event_id] = {**profile['events'][event_id], **profile_event}

        return profile

    def get_event(self, event_id: str) -> Event:
        """Get an event."""
        event = self.get_entities('events', event_id)
        if not event:
            raise Forbidden('Event not found')
        
        return Event(event_id, self.db.profile_context['profile_id'])
    
    def is_exists(self, table: str, fields: Dict, exclude_id: str = None) -> str | None:
        """Check if a record exists."""
        if table == 'events':
            url = fields.get('url')
            if url and url == 'dashboard':
                return 'dashboard'

        if table == 'profiles' and 'restricted_to_event' in fields:
            within_event = super().is_exists(table, fields, exclude_id)
            if within_event:
                return within_event
            fields['restricted_to_event'] = None

        return super().is_exists(table, fields, exclude_id)

    # Profile management
    # TODO: remove this function
    def is_public_profile(self, profile_id: str) -> bool:
        """Check if a profile is public."""
        error = Forbidden('Profile does not have permission to check if this profile is public')
        restricted_to_event_id = self.get_entities('profiles', profile_id).get('restricted_to_event')
        if not restricted_to_event_id:
            raise error
        
        event = self.get_event(restricted_to_event_id)
        
        profile = event.models.get_entities('profiles', profile_id)
        if not profile:
            raise error
        
        return profile.get('is_public')

    # TODO: remove
    def create_profile(self, label: str, password: str, hierarchy_rank: int, email: str | None = None, *, can_create_events: bool = False, event_id: str | None = None, can_delete_event: bool = False) -> str:
        """
        Create a new profile.
        Returns:
            profile_id
        """
        if event_id:
            event = self.get_event(event_id)
            if not event:
                raise Forbidden('Event not found')
            
            if hierarchy_rank < event.models.get_entities('profiles', self.db.profile_context['profile_id']).get('hierarchy_rank'):
                raise Forbidden('Profile hierarchy rank cannot be less than the event manager hierarchy rank')

        profile_id = self.generate_id()
        self.add('profiles', {'profile_id': profile_id, 'label': label, 'password': password, 'hierarchy_rank': hierarchy_rank, 'email': email, 'restricted_to_event': event_id, 'can_create_events': can_create_events})
        if event_id:
            self.add_profile_to_event(profile_id, event_id, can_delete_event)

        preferences = GeneralDB.CONSTANTS()['profiles_preferences']
        for preference_group, keys_dict in preferences.items():
            values = []
            for preference_key, (value_type, default_value) in keys_dict.items():
                # Serialize the default value before storing
                serialized_value = self.db.serialize_value(value_type, default_value)
                values.append([profile_id, preference_group, preference_key, serialized_value])

            self.db.insert_many('profiles_preferences', ['profile_id', 'preference_group', 'preference_key', 'preference_value'], values)

        return profile_id

    def delete_profile(self, profile_id: str, only_remove_from_event_id: str | None = None):
        """
        Delete a profile.
        If only_remove_from_event_id is provided, the profile will be removed from the event with the given id.
        """
        profile = self.get_entities('profiles', profile_id)
        restricted_to_event_id = profile.get('restricted_to_event')
        event_id = only_remove_from_event_id or restricted_to_event_id
        if event_id:
            self.remove_profile_from_event(profile_id, event_id)
        
        if not only_remove_from_event_id or restricted_to_event_id:
            self.delete('profiles', profile_id)

    def get_profile_password(self, profile_id: str) -> str:
        """Get the password for a profile."""
        accessible_profiles = self.db.STRUCTURE()['profiles']['accessible_table']
        query = f'SELECT password FROM {accessible_profiles} WHERE profile_id = ?'
        result = self.db.execute_query(query, (profile_id,), return_format=ReturnFormat.VALUE)
        if not result:
            raise Forbidden('Profile not found')
        
        return result
    
    def update_profile_label(self, profile_id: str, label: str):
        """Update the label for a profile."""
        self.edit('profiles', profile_id, {'label': label})
        event_ids = self.get_childs('profiles', profile_id, 'events', return_ids=True)
        for event_id in event_ids:
            self.sync_profile_to_event_db(profile_id, event_id, upsert=True)

    def update_profile_hierarchy_rank(self, profile_id: str, hierarchy_rank: int):
        """Update the hierarchy rank for a profile."""
        self.edit('profiles', profile_id, {'hierarchy_rank': hierarchy_rank})
        event_ids = self.get_childs('profiles', profile_id, 'events', return_ids=True)
        for event_id in event_ids:
            self.sync_profile_to_event_db(profile_id, event_id, upsert=True)

    def get_profile_preferences(self, profile_id: str) -> dict:
        """Get the preferences for a profile."""
        # Start with defaults from CONSTANTS
        preferences_constants = GeneralDB.CONSTANTS()['profiles_preferences']
        preferences = {}
        
        # Initialize with default values
        for group, keys_dict in preferences_constants.items():
            preferences[group] = {}
            for key, (value_type, default_value) in keys_dict.items():
                preferences[group][key] = default_value
        
        # Query database for stored values
        query = 'SELECT preference_group, preference_key, preference_value FROM profiles_preferences WHERE profile_id = ?'
        result = self.db.execute_query(query, (profile_id,), return_format=ReturnFormat.LIST_TUPLES)
        
        # Update defaults with stored values
        for group, key, value_str in result:
            if group in preferences and key in preferences[group]:
                value_type, _ = preferences_constants[group][key]
                # Deserialize from string to proper type and update
                preferences[group][key] = self.db.deserialize_value(value_type, value_str)

        return preferences

    def update_profile_preferences(self, profile_id: str, preference_group: str, preference_key: str, preference_value):
        """Update the preferences for a profile."""
        preferences_constants = GeneralDB.CONSTANTS()['profiles_preferences']
        
        if preference_group not in preferences_constants:
            raise DBPolicyError(f'Preference group {preference_group} not found')
        
        if preference_key not in preferences_constants[preference_group]:
            raise DBPolicyError(f'Preference key {preference_key} not found in preference group {preference_group}')
        
        # Get the type for this preference and serialize the value
        value_type, _ = preferences_constants[preference_group][preference_key]
        serialized_value = self.db.serialize_value(value_type, preference_value)
        
        self.db.update('profiles_preferences', {'profile_id': profile_id, 'preference_group': preference_group, 'preference_key': preference_key}, {'preference_value': serialized_value})

    def ensure_access_request_notifications(self, event: Event, request_id: str):
        """
        Ensure access request notifications are created for the managers of the access request.
        """
        query = f'''
            SELECT n.profile_id
            FROM notifications n
            WHERE n.type = 'access_request'
            AND n.data->>'access_request_id' = ?
            AND n.data->>'event_id' = ?
        '''
        exclude_ids = self.db.execute_query(query, (request_id, event.event_id), return_format=ReturnFormat.LIST_VALUES)
        managers = event.models.get_access_request_managers(request_id, exclude_ids)
        for manager in managers:
            self.add('notifications', {
                'profile_id': manager,
                'message': 'A new access request was created',
                'type': 'access_request',
                'data': {'access_request_id': request_id, 'event_id': event.event_id}
            })

    def toggle_access_request(self, event_id: str, access_request_id: str, approved_group_ids: list[str] | None = None, denied_group_ids: list[str] | None = None, closed_details: str | None = None, profile_name: str | None = None) -> str | None:
        """
        Toggle an access request.
        Returns:
            applicant_profile_id if new profile is created, None otherwise
        """
        event = self.get_event(event_id)
        if not approved_group_ids and not denied_group_ids:
            raise DBPolicyError('At least one group must be approved or denied')

        access_request = event.models.get_entities('access_requests', access_request_id)
        if not access_request:
            raise Forbidden('Access request not found')
        
        applicant_profile_id = None
        if approved_group_ids and not access_request['applicant_profile_id']:
            label = profile_name or access_request['applicant_name']
            email = access_request['applicant_email']
            password = secrets.token_urlsafe(6)
            applicant_profile_id = self.create_profile(label, password, 0, email=email, event_id=event_id)
        
        applicant_profile_id = event.models.toggle_access_request(access_request_id, approved_group_ids, denied_group_ids, closed_details, applicant_profile_id)
        if applicant_profile_id:
            self.add('notifications', {
                'profile_id': applicant_profile_id,
                'message': 'Your access request was processed',
                'type': 'access_request',
                'data': {'access_request_id': access_request_id, 'event_id': event.event_id}
            })

        return applicant_profile_id

    # Profile-Event management
    def add_profile_to_event(self, profile_id: str, event_id: str, can_delete_event: bool = True, can_edit_event: bool = True):
        """Add a profile to an event in the general DB and sync to event DB."""
        self.edit_childs('profiles', profile_id, 'events', [event_id], operation=ChildOperation.ADD, data={'can_delete_event': can_delete_event, 'can_edit_event': can_edit_event})
        self.sync_profile_to_event_db(profile_id, event_id, upsert=True)
    
    def remove_profile_from_event(self, profile_id: str, event_id: str):
        """Remove a profile from an event in the general DB and sync to event DB."""
        self.sync_profile_to_event_db(profile_id, event_id, upsert=False)
        self.edit_childs('profiles', profile_id, 'events', [event_id], operation=ChildOperation.REMOVE)
    
    def sync_profile_to_event_db(self, profile_id: str, event_id: str, upsert: bool = True):
        """Updates event DB when profile is added/removed from an event."""        
        # Get event data to find DB path
        event_data = self.get_entities('events', event_id)
        if not event_data:
            return

        event = self.get_event(event_id)
        hierarchy_rank = -1
        label = None
        if upsert:
            profile = self.get_entities('profiles', profile_id)
            hierarchy_rank = profile.get('hierarchy_rank')
            label = profile.get('label')
        
        event.sync_profile_to_event_db(profile_id, upsert=upsert, label=label, hierarchy_rank=hierarchy_rank)
        
    # Event management
    def create_event(self, data: dict) -> str:
        """Create a new event with all necessary setup.

        Args:
            data: dictionary with the event data:
            - name: name of the event
            - date: date of the event
            - url: URL of the event
            - is_public: whether the event is public
            - images_count_limit: maximum number of images that can be uploaded
            - image_size_limit_bytes: maximum size of images that can be uploaded
        Returns:
            event_id: str
        """

        event_id = self.add('events', data)
        Event.create_event(event_id)

        return event_id
    
    def delete_event(self, event_id: str):
        """Delete an event and its associated data."""
        profile_id = self.db.profile_context['profile_id']
        _, relation_data = self.get_childs('events', event_id, 'profiles', [profile_id])
        if not relation_data.get(profile_id, {}).get('can_delete_event'):
            raise Forbidden('Profile does not have permission to delete this event')

        Event.delete_event(event_id)         
        self.delete('events', event_id)
    
    def get_event_by_url(self, url: str) -> Dict[str, Any] | None:
        """Get an event by its URL."""
        fields = GeneralDB.get_view_fields('events')
        query = f'SELECT {fields} FROM events WHERE url = ?'
        return self.db.execute_query(query, (url,), return_format=ReturnFormat.DICT)

    def get_event_url(self, event_id: str) -> str | None:
        """Get event URL by event ID."""
        query = 'SELECT url FROM events WHERE event_id = ?'
        return self.db.execute_query(query, (event_id,), return_format=ReturnFormat.VALUE)

    def process_new_images(self, event_id: str, file_names: list[str] | None = None, assign_moments: bool = False, progress_callback=None) -> dict:
        """Process images for an event."""
        event = self.get_event(event_id)
        event_details = self.get_entities('events', event_id)
        return event.process_new_images(
            file_names=file_names,
            images_count_limit=event_details.get('images_count_limit', 0),
            image_size_limit_bytes=event_details.get('image_size_limit_bytes', 0),
            assign_moments=assign_moments,
            progress_callback=progress_callback
        )

    def create_access_request(self, event_id: str, request_data: dict, group_ids: list[str]) -> str:
        """Create an access request."""
        event = self.get_event(event_id)
        request_id = event.models.add('my_access_requests', request_data)
        if group_ids and isinstance(group_ids, list):
            event.models.edit_childs('my_access_requests', request_id, 'groups', group_ids, operation=ChildOperation.ADD)
            self.ensure_access_request_notifications(event, request_id)
        
        return request_id
    
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

    # Notifications helpers
    def mark_all_my_notifications_read(self, read_at: str) -> list[str]:
        """
        Mark all of my unread notifications as read.
        Returns:
            list of notification ids that were marked as read
        """
        query = 'SELECT notification_id FROM my_notifications WHERE read = 0'
        notification_ids = self.db.execute_query(query, (), return_format=ReturnFormat.LIST_VALUES)
        self.edit('my_notifications', notification_ids, {'read': 1, 'read_at': read_at})
        return notification_ids
