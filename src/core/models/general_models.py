from typing import Dict, Any
import secrets
from src.core.database.db import DB, ReturnFormat
from src.core.models.base_models import BaseModels, ChildOperation
from src.core.services.event import Event
from src.core.errors import DBPolicyError, Forbidden, DatabaseError

class GeneralModels(BaseModels):
    """Models manager for general database operations."""

    def __init__(self, profile_id: str | None = None):
        self.db = DB(profile_id=profile_id)

    def get_current_profile(self, event_id: str | None = None) -> dict[str, Any]:
        """Get the current profile."""
        profile = self.get_entities('current_profile', self.db.profile_context['profile_id'])
        _, events_relation = self.get_childs('current_profile', self.db.profile_context['profile_id'], 'events')
        profile['events'] = events_relation
        if event_id:
            if not profile['events'].get(event_id):
                raise Forbidden('Event not found')
            
            event = self.get_event(event_id)
            profile_event = event.models.get_entities('current_event_profile', event_id)
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
    def duplicate_profile(self, profile_id: str) -> str:
        """Duplicate a profile."""
        profile = self.get_entities('profiles', profile_id)
        if not profile:
            raise Forbidden('Profile not found')
        new_profile_label = f"Copy of {profile['label']}"
        pattern = f"{new_profile_label} [0-9]*"
        query = f"""
            SELECT MAX(CAST(SUBSTR(label, LENGTH(?) + 2) AS INTEGER)) AS last_profile_num
            FROM profiles
            WHERE label GLOB ?
        """
        last_profile_num = self.db.execute_query(
            query,
            [new_profile_label, pattern],
            return_format=ReturnFormat.VALUE
        )
        if last_profile_num:
            new_profile_label = f"{new_profile_label} {last_profile_num + 1}"
        new_password = secrets.token_urlsafe(6)
        
        incomplete_events = []
        new_profile_id = self.add('profiles', {
            'label': new_profile_label,
            'password': new_password,
            'hierarchy_rank': profile['hierarchy_rank'],
            'can_create_events': profile['can_create_events'],
            'restricted_to_event': profile['restricted_to_event'],
            'is_public': profile['is_public'],
        })
        _, event_profiles = self.get_childs('profiles', profile_id, 'events')
        for event_id, event_relation in event_profiles.items():
            try:
                event = self.get_event(event_id)
                event.models.edit_childs('events', event_id, 'profiles', [new_profile_id], operation=ChildOperation.ADD, data=event_relation)
                childs = ['images', 'albums', 'groups']
                for child in childs:
                    child_ids = event.models.get_childs('events_profiles', profile_id, child, return_ids=True)
                    event.models.edit_childs('events_profiles', new_profile_id, child, child_ids, operation=ChildOperation.ADD)
            except Forbidden as e:
                incomplete_events.append(event_id)
                try:
                    event.models.edit_childs('events', event_id, 'profiles', [new_profile_id], operation=ChildOperation.REMOVE)
                except Forbidden as e:
                    pass

        return new_profile_id, incomplete_events
    
    def delete_profile(self, profile_id: str, only_remove_from_event_id: str | None = None):
        """
        Delete a profile.
        If only_remove_from_event_id is provided, the profile will be removed from the event with the given id.
        """
        profile = self.get_entities('profiles', profile_id)
        restricted_to_event_id = profile.get('restricted_to_event')
        if not only_remove_from_event_id or restricted_to_event_id:
            self.delete('profiles', profile_id)
            return

        if only_remove_from_event_id:
            event = self.get_event(only_remove_from_event_id)
            event.models.edit_childs('events', only_remove_from_event_id, 'profiles', [profile_id], operation=ChildOperation.REMOVE)
        
    def get_profile_password(self, profile_id: str) -> str:
        """Get the password for a profile."""
        if self.db.profile_context['profile_id'] != profile_id:
            accessible_profiles = self.db.STRUCTURE()['profiles']['accessible_table']
        else:
            accessible_profiles = 'current_profile'
        query = f'SELECT password FROM {accessible_profiles} WHERE profile_id = ?'
        result = self.db.execute_query(query, (profile_id,), return_format=ReturnFormat.VALUE)
        if not result:
            raise Forbidden('Profile not found')
        
        return result
    
    def get_my_preferences(self) -> dict:
        """Get the preferences for a profile."""

        query = '''
            SELECT preference_group, preference_key, preference_value, value_type
            FROM my_preferences
        '''
        results = self.db.execute_query(query, return_format=ReturnFormat.LIST_TUPLES)
        preferences = {}
        for group, key, value_str, value_type in results:
            preferences.setdefault(group, {})
            preferences[group][key] = self.db.deserialize_value(value_type, value_str)

        return preferences

    def update_my_preferences(self, preference_group: str, preference_key: str, preference_value):
        """Update the preferences for a profile."""
        type_label = self.db.execute_query(
            '''
                SELECT value_type
                FROM default_preferences
                WHERE preference_group = ? AND preference_key = ?
            ''',
            (preference_group, preference_key),
            return_format=ReturnFormat.VALUE
        )

        if not type_label:
            raise DBPolicyError(f'Preference {preference_group}.{preference_key} not found')

        serialized_value = self.db.serialize_value(type_label, preference_value)

        self.db.update(
            'my_preferences',
            {
                'preference_group': preference_group,
                'preference_key': preference_key
            },
            {'preference_value': serialized_value}
        )

    def generate_public_access_code(self, profile_id: str):
        """Generate a 12-character public access code for a profile."""
        
        # Generate a 12-character code
        code = secrets.token_urlsafe(9)[:12]  # Remove padding chars, take first 12
        
        # Ensure uniqueness
        while self.is_exists('profiles', {'public_access_code': code}):
            code = secrets.token_urlsafe(9)[:12]
        
        # Update profile with the code
        self.edit('profiles', profile_id, {'public_access_code': code})

    def get_public_access_code(self, profile_id: str) -> str:
        """Get the public access code for a profile."""
        query = f'SELECT public_access_code FROM accessible_profiles WHERE profile_id = ?'
        result = self.db.execute_query(query, (profile_id,), return_format=ReturnFormat.VALUE)
        if not result:
            raise Forbidden('Profile not found')
        
        return result

    def revoke_public_access_code(self, profile_id: str):
        """Revoke public access code for a profile."""
        self.edit('profiles', profile_id, {'public_access_code': None})
    
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
            attemp = 0
            max_attemp = 10
            while self.is_exists('profiles', {'password': password, 'label': label}) and attemp < max_attemp:
                attemp += 1
                password = secrets.token_urlsafe(6)
            if attemp == max_attemp:
                raise DatabaseError('Failed to generate a unique password. Please try again with a different name')
            
            data = {
                'label': label,
                'password': password,
                'hierarchy_rank': 0,
                'email': email,
                'restricted_to_event': event_id
            }
            applicant_profile_id = self.add('profiles', data)
            requester_profile_id = access_request['profile_id']
            requester_profile, requester_event_profile = self.get_childs('events', event_id, 'profiles', [requester_profile_id])
            requester_event_profile = requester_event_profile[requester_profile_id]
            relation_fields = [
                'can_delete_event',
                'can_manage_event',
                'can_upload_and_delete_images',
                'all_images',
                'all_groups',
                'all_albums',
                'can_edit',
            ]
            data = {field: requester_event_profile[field] for field in relation_fields}
            event.models.edit_childs('events', event_id, 'profiles', [applicant_profile_id], operation=ChildOperation.ADD, data=data)
            for child in ['images', 'albums', 'groups']:
                requester_profile_childs = event.models.get_childs('events_profiles', requester_profile_id, child)
                event.models.edit_childs('events_profiles', applicant_profile_id, child, requester_profile_childs, operation=ChildOperation.ADD)

            event.models.edit('access_requests', access_request_id, {'applicant_profile_id': applicant_profile_id})
        
        event.models.toggle_access_request(access_request_id, approved_group_ids, denied_group_ids, closed_details)
        if applicant_profile_id:
            self.add('notifications', {
                'profile_id': applicant_profile_id,
                'message': 'Your access request was processed',
                'type': 'my_access_request',
                'data': {'access_request_id': access_request_id, 'event_id': event.event_id}
            })

        return applicant_profile_id

    # Event management
    def get_uploads_limits(self) -> dict:
        """Get the uploads limits for an event."""
        current_profile = self.get_current_profile()
        if not current_profile['has_manageable_events']:
            raise Forbidden('Permission denied: the information is not accessible')
        
        query = 'SELECT images_count_limit, image_size_limit_bytes FROM settings WHERE id = 1'
        result = self.db.execute_query(query, (), return_format=ReturnFormat.DICT)
        if not result:
            raise Exception('Settings not found')

        return result
    
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
        current_profile = self.get_current_profile()['events'].get(event_id)
        if not current_profile.get('can_delete_event'):
            raise Forbidden('Profile does not have permission to delete this event')

        Event.delete_event(event_id)
        self.delete('events', event_id)
    
    def get_event_by_url(self, url: str) -> Dict[str, Any] | None:
        """Get an event by its URL."""
        fields = self.db.get_view_fields('events')
        query = f'SELECT {fields} FROM accessible_events WHERE url = ?'
        event = self.db.execute_query(query, (url,), return_format=ReturnFormat.DICT)
        if not event:
            return self.db.execute_query("SELECT event_id FROM events WHERE url = ?", (url,), return_format=ReturnFormat.DICT)
        return event

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

    def authenticate_public_access(self, event_id: str, public_code: str) -> str:
        """Authenticate a profile by public access code.
        
        Returns:
            profile_id if authenticated, None otherwise
        """
        query = '''
            SELECT profile_id
            FROM profiles
            WHERE public_access_code = ?
            AND restricted_to_event = ?
        '''
        profile_id = self.db.execute_query(query, (public_code, event_id), return_format=ReturnFormat.VALUE)
        if not profile_id:
            raise Forbidden('Public access code is invalid')
        
        return profile_id

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
