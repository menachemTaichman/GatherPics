from cProfile import label
from typing import Dict, Any
import secrets
from datetime import timedelta, datetime, timezone
from src.core.database.db import DB, ReturnFormat
from src.core.models.base_models import BaseModels, ChildOperation
from src.core.services.event import Event
from src.core.errors import PolicyError, Forbidden, DatabaseError
from src.core.utils.password_utils import hash_password, verify_password

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
            if url and url in ['dashboard', 'reset-password', 'about']:
                return url

        if table == 'profiles' and 'restricted_to_event' in fields:
            within_event = super().is_exists(table, fields, exclude_id)
            if within_event:
                return within_event
            fields['restricted_to_event'] = None

        return super().is_exists(table, fields, exclude_id)

    # Profile management
    def duplicate_profile(self, profile_id: str, overrides: dict = {}) -> tuple[str, str, str, list[str]]:
        """
        Duplicate a profile.

        Args:
            profile_id: id of the profile to duplicate
            overrides: dictionary of overrides for the new profile
                - label: label of the new profile
                - hierarchy_rank: hierarchy rank of the new profile
                - can_create_events: whether the new profile can create events
                - restricted_to_event: event id of the new profile
                - is_public: whether the new profile is public
                - email: email of the new profile

        Returns:
            new_profile_id: id of the new profile
            label: label of the new profile
            password: password of the new profile
            incomplete_events: list of events that could not be duplicated
        """
        profile = self.get_entities('profiles', profile_id)
        if not profile:
            raise Forbidden('Profile not found')
            
        if 'label' in overrides.keys():
            label = overrides['label']
        else:
            label = self.get_unique_label('profiles', f"Copy", f"of {profile['label']}", separator=' ', brackets=False)
        
        if 'password' in overrides.keys():
            password = overrides['password']
        else:
            password = secrets.token_urlsafe(6)

        hierarchy_rank = overrides.get('hierarchy_rank', profile['hierarchy_rank'])
        can_create_events = overrides.get('can_create_events', profile['can_create_events'])
        restricted_to_event = overrides.get('restricted_to_event', profile['restricted_to_event'])
        is_public = overrides.get('is_public', profile['is_public'])
        email = overrides.get('email', None) if not is_public else None
        
        incomplete_events = []
        profile_data = {
            'label': label,
            'password': hash_password(password),
            'hierarchy_rank': hierarchy_rank,
            'can_create_events': can_create_events,
            'restricted_to_event': restricted_to_event,
            'is_public': is_public,
        }
        # Add email if provided (for non-public profiles)
        if email is not None:
            profile_data['email'] = email
        
        new_profile_id = self.add('profiles', profile_data)
        _, event_profiles = self.get_childs('profiles', profile_id, 'events')
        for event_id, event_relation in event_profiles.items():
            try:
                event = self.get_event(event_id)
                event.models.edit_childs('events', event_id, 'profiles', [new_profile_id], operation=ChildOperation.ADD, data=event_relation)
                childs = ['images', 'albums', 'groups']
                for child in childs:
                    child_ids = event.models.get_childs('events_profiles_ctx', profile_id, child, return_ids=True)
                    event.models.edit_childs('events_profiles_ctx', new_profile_id, child, child_ids, operation=ChildOperation.ADD)
            except Forbidden as e:
                incomplete_events.append(event_id)
                try:
                    event.models.edit_childs('events', event_id, 'profiles', [new_profile_id], operation=ChildOperation.REMOVE)
                except Forbidden as e:
                    pass

        return new_profile_id, label, password, incomplete_events
    
    def delete_profile(self, profile_id: str, only_remove_from_event_id: str | None = None) -> bool:
        """
        Delete a profile.
        If only_remove_from_event_id is provided, the profile will be removed from the event with the given id.
        If the profile is restricted to an event, it will be deleted from the event and the general profile.
        Returns:
            True if the profile was deleted completely, False if it was only removed from the event.
        """
        profile = self.get_entities('profiles', profile_id)
        restricted_to_event_id = profile.get('restricted_to_event')
        event_id = only_remove_from_event_id or restricted_to_event_id
        if event_id:
            event = self.get_event(event_id)
            event.models.edit_childs('events', event_id, 'profiles', [profile_id], operation=ChildOperation.REMOVE)

        complete_delete = not only_remove_from_event_id or restricted_to_event_id is not None
        if complete_delete:
            self.delete('profiles', profile_id)

        return complete_delete
        
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
                WHERE preference_group = %s AND preference_key = %s
            ''',
            (preference_group, preference_key),
            return_format=ReturnFormat.VALUE
        )

        if not type_label:
            raise PolicyError(f'Preference {preference_group}.{preference_key} not found')

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
        query = f'SELECT public_access_code FROM profiles_ctx WHERE profile_id = %s'
        result = self.db.execute_query(query, (profile_id,), return_format=ReturnFormat.VALUE)
        if not result:
            raise Forbidden('Profile not found')
        
        return result

    def revoke_public_access_code(self, profile_id: str):
        """Revoke public access code for a profile."""
        self.edit('profiles', profile_id, {'public_access_code': None})
    
    def toggle_access_request(
        self,
        event_id: str,
        access_request_id: str,
        approved_group_ids: list[str] | None = None,
        denied_group_ids: list[str] | None = None,
        closed_details: str | None = None,
        profile_name: str | None = None
    ) -> tuple[str | None, str | None, str | None]:
        """
        Toggle an access request.
        Returns:
            applicant_profile_id if new profile is created, None otherwise
            label: label of the new profile
            password: password of the new profile
        """
        event = self.get_event(event_id)
        if not approved_group_ids and not denied_group_ids:
            raise PolicyError('At least one group must be approved or denied')

        access_request = event.models.get_entities('access_requests', access_request_id)
        if not access_request:
            raise Forbidden('Access request not found')
        
        applicant_profile_id = None
        label = None
        password = None
        if approved_group_ids and not access_request['applicant_profile_id']:
            requester_profile_id = access_request['profile_id']
            overrides = {
                'label': profile_name or access_request['applicant_name'],
                'email': access_request['applicant_email'],
                'hierarchy_rank': 0,
                'is_public': False,
            }

            applicant_profile_id, label, password, incomplete_events = self.duplicate_profile(requester_profile_id, overrides)
            if event_id in incomplete_events:
                raise DatabaseError('Failed to create new profile')
            
            event.models.edit('access_requests', access_request_id, {'applicant_profile_id': applicant_profile_id})
        
        event.models.toggle_access_request(access_request_id, approved_group_ids, denied_group_ids, closed_details)

        return applicant_profile_id, label, password

    # Event management
    def get_uploads_limits(self) -> dict:
        """Get the uploads limits for an event."""
        current_profile = self.get_current_profile()
        if not current_profile['has_manageable_events']:
            raise Forbidden('Permission denied: the information is not accessible')
        
        query = 'SELECT images_count_limit, image_size_limit_bytes, rekognition_calls_limit FROM settings WHERE id = 1'
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
        self.db.execute_query("SELECT set_transaction_context('temp_event_in_deletion', %s)", (event_id,))
        self.delete('events', event_id)
        self.db.execute_query('ANALYZE;')
    
    def get_event_by_url(self, url: str) -> Dict[str, Any] | None:
        """Get an event by its URL."""
        fields = self.db.get_view_fields('events')
        query = f'SELECT {fields} FROM events_ext WHERE url = %s'
        event = self.db.execute_query(query, (url,), return_format=ReturnFormat.DICT)
        if not event:
            return self.db.execute_query("SELECT event_id FROM events WHERE url = %s", (url,), return_format=ReturnFormat.DICT)
        return event

    def get_event_url(self, event_id: str) -> str | None:
        """Get event URL by event ID."""
        query = 'SELECT url FROM events WHERE event_id = %s'
        return self.db.execute_query(query, (event_id,), return_format=ReturnFormat.VALUE)

    def process_new_images(self, event_id: str, file_names: list[str] | None = None, assign_moments: bool = False, progress_callback=None) -> dict:
        """Process images for an event."""
        event = self.get_event(event_id)
        if not self.get_current_profile(event_id).get('events', {}).get(event_id, {}).get('can_upload_and_delete_images', False):
            raise Forbidden('Permission denied: cannot upload and delete images')
        
        return event.process_new_images(
            file_names=file_names,
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
        result['rekognition_usage'] = self.get_entities('rekognition_usaged')
        result['errors'] = self.get_entities('errors')

        return result
    
    def update_settings(self, fields: Dict):
        """Update system settings."""
        self.edit('settings', 1, fields)

    # Auth helpers
    def authenticate_profile_label(self, label: str, password: str) -> str | None:
        """Authenticate a profile by label and password.
        
        Returns:
            profile_id if authenticated, None otherwise
        """
        query = 'SELECT profile_id, password FROM profiles WHERE label = %s'
        result = self.db.execute_query(query, (label,), return_format=ReturnFormat.TUPLE)
        if not result:
            return None
        
        profile_id, hashed_password = result
        if verify_password(hashed_password, password):
            return profile_id
        return None

    def authenticate_profile_id(self, profile_id: str, password: str) -> bool:
        """Verify if the given password matches the profile's current password.
        
        Args:
            profile_id: The profile ID to verify password for
            password: The password to verify
            
        Returns:
            True if password matches, False otherwise
        """
        query = f'SELECT password FROM profiles WHERE profile_id = %s'
        hashed_password = self.db.execute_query(query, (profile_id,), return_format=ReturnFormat.VALUE)
        return verify_password(hashed_password, password)

    def authenticate_public_access(self, event_id: str, public_code: str) -> str:
        """Authenticate a profile by public access code.
        
        Returns:
            profile_id if authenticated, None otherwise
        """
        query = '''
            SELECT profile_id
            FROM profiles
            WHERE public_access_code = %s
            AND restricted_to_event = %s
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
            WHERE token = %s
            AND NOT revoked
            AND expires_at > NOW()
        '''
        return self.db.execute_query(query, (token,), return_format=ReturnFormat.VALUE)
    
    def revoke_refresh_token(self, token: str):
        """Revoke a refresh token."""
        query = '''
            UPDATE refresh_tokens
            SET revoked = TRUE, revoked_at = NOW()
            WHERE token = %s
        '''
        self.db.execute_query(query, (token,))

    def revoke_all_refresh_tokens(self, profile_id: str | None = None):
        """Revoke all refresh tokens for a profile."""
        query = '''
            UPDATE refresh_tokens
            SET revoked = TRUE, revoked_at = NOW()
            WHERE 1=1
        '''
        params = ()
        if profile_id:
            query += ' AND profile_id = %s'
            params = (profile_id,)

        self.db.execute_query(query, params)
    
    # Password reset helpers
    def request_password_reset(self, email: str, reset_url_base: str) -> tuple[str, str, str, str] | None:
        """Request a password reset link. Creates token and returns reset URL.
        
        Args:
            email: Email address of the profile
            reset_url_base: Base URL for the reset link (e.g., "https://example.com")
            
        Returns:
            (profile_id, profile_label, reset_token, reset_url) if profile found, None otherwise
        """
        query = 'SELECT profile_id, label FROM profiles WHERE email = %s'
        profile_id, profile_label = self.db.execute_query(query, (email,), return_format=ReturnFormat.TUPLE)
        
        if profile_id:
            reset_token = secrets.token_urlsafe(32)
            expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
            query = """
                INSERT INTO password_reset_links (profile_id, token, expires_at)
                VALUES (%s, %s, %s)
                RETURNING reset_id
            """
            self.db.execute_query(query, (profile_id, reset_token, expires_at), return_format=ReturnFormat.VALUE)
            
            reset_url = f"{reset_url_base.rstrip('/')}/reset-password/{reset_token}"
            
            return profile_id, profile_label, reset_token, reset_url
        
        return None

    def validate_reset_token(self, token: str) -> tuple[str, str] | None:
        """Validate a reset token.
        
        Returns:
            profile_id, label if token is valid, None otherwise
        """
        query = '''
            SELECT
                p.profile_id,
                p.label
            FROM password_reset_links
            INNER JOIN profiles p ON password_reset_links.profile_id = p.profile_id
            WHERE token = %s
            AND NOT used
            AND expires_at > NOW()
        '''
        result = self.db.execute_query(query, (token,), return_format=ReturnFormat.TUPLE)
        
        if not result:
            return None

        return result
    
    def reset_password_with_token(self, token: str, new_password: str) -> tuple[str, str]:
        """Reset password using reset token.
        
        Returns:
            profile_id, label if successful
        """
        query = '''
            SELECT
                p.profile_id,
                p.label
            FROM password_reset_links
            INNER JOIN profiles p ON password_reset_links.profile_id = p.profile_id
            WHERE token = %s
            AND NOT used
            AND expires_at > NOW()
        '''
        profile = self.db.execute_query(query, (token,), return_format=ReturnFormat.TUPLE)
        
        if not profile:
            raise Forbidden('Invalid or expired reset token')

        profile_id, label = profile

        # self.db.execute_query('UPDATE password_reset_links SET used = TRUE, used_at = NOW() WHERE token = %s', (token,))
        hashed_password = hash_password(new_password)
        self.db.execute_query('UPDATE profiles SET password = %s WHERE profile_id = %s', (hashed_password, profile_id))
        
        return profile_id, label

    # Notifications helpers
    def mark_all_my_notifications_read(self, read_at: str) -> list[str]:
        """
        Mark all of my unread notifications as read.
        Returns:
            list of notification ids that were marked as read
        """
        query = 'SELECT notification_id FROM my_notifications_ctx WHERE NOT read'
        notification_ids = self.db.execute_query(query, (), return_format=ReturnFormat.LIST_VALUES)
        self.edit('my_notifications', notification_ids, {'read': True, 'read_at': read_at})
        return notification_ids
