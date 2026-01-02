from psycopg2 import errors as psycopg2_errors
from psycopg2.pool import ThreadedConnectionPool
from typing import Any
import json
import ast
import os
import socket
import threading
from enum import Enum
from src.core.errors import Forbidden, DatabaseError, PolicyError

# Thread-local storage for tracking DB instances (works in both Flask and Celery contexts)
_thread_local = threading.local()

# Load environment variables from .env file if it exists (development only)
# In production (AWS), environment variables are already set
if os.path.exists('.env'):
    from dotenv import load_dotenv
    load_dotenv()

environment = os.getenv('ENVIRONMENT', 'DEVELOPMENT')
hostname = os.getenv('HOSTNAME') or socket.gethostname()
app_instance_name = os.getenv('APP_INSTANCE_NAME') or 'GatherPics'
application_name = f'{app_instance_name}_{environment}_{hostname}'

class ReturnFormat(Enum):
    VALUE = 'value'
    TUPLE = 'tuple'
    DICT = 'dict'
    LIST_VALUES = 'list_values'
    LIST_TUPLES = 'list_tuples'
    LIST_DICTS = 'list_dicts'
    DICT_DICTS = 'dict_dicts'
    DICT_VALUES = 'dict_values'
    LIST_AND_DICT_DICTS = 'list_and_dict_dicts'

class DB:
    """Database connection and query handler with row-level security."""
    
    # Class-level connection pool (shared across all instances)
    _connection_pool = None
    # Cache for developer_id (rarely changes, queried frequently)
    _developer_id_cache = None
    
    @classmethod
    def _get_connection_pool(cls):
        """Get or create the shared connection pool.
        """
        if cls._connection_pool is None:
            maxconn = int(os.getenv('DB_POOL_MAX_CONN', '20'))
            minconn = int(os.getenv('DB_POOL_MIN_CONN', '1'))
            
            cls._connection_pool = ThreadedConnectionPool(
                minconn=minconn,
                maxconn=maxconn,
                host=os.getenv('DB_HOST', 'localhost'),
                database=os.getenv('DB_NAME', 'photo_app_db'),
                user=os.getenv('DB_USER', 'postgres'),
                password=os.getenv('DB_PASSWORD', ''),
                port=os.getenv('DB_PORT', '5432'),
                options=f"-c application_name={application_name}"
            )
        return cls._connection_pool
    
    @staticmethod
    def STRUCTURE() -> dict:
        return {
            'settings': {
                'id_type': 'INTEGER',
                'primary_key': 'id',
                'fields': [
                    'image_size_limit_bytes',
                    'images_count_limit',
                    'min_rank_to_create_event',
                    'rekognition_requests_limit',
                ],
            },
            'rekognition_requests': {
                'id_type': 'INTEGER',
                'primary_key': 'rekognition_request_id',
                'fields': [
                    'rekognition_request_id',
                    'event_id',
                    'event_label',
                    'profile_id',
                    'profile_label',
                    'requests_count',
                    'created_at',
                ],
            },
            'errors': {
                'id_type': 'INTEGER',
                'primary_key': 'error_id',
                'fields': [
                    'error_id',
                    'error_type',
                    'error_message',
                    'traceback',
                    'profile_id',
                    'event_id',
                    'request_path',
                    'request_method',
                    'user_agent',
                    'ip_address',
                    'created_at',
                ],
            },
            'audit_logs': {
                'id_type': 'INTEGER',
                'primary_key': 'audit_log_id',
                'fields': [
                    'audit_log_id',
                    'timestamp',
                    'actor_profile_id',
                    'actor_profile_label',
                    'action',
                    'severity',
                    'ip_address',
                    'details',
                ],
                'serializable': {
                    'details': dict,
                },
            },
            'events': {
                'primary_key': 'event_id',
                'fields': [
                    'name',
                    'date',
                    'url',
                    'representative_image',
                    'is_public',
                    'images_count',
                    'faces_count',
                    'albums_count',
                    'moments_count',
                    'total_size',
                    'created_at',
                    'status',
                ],
                'details_fields': [
                    'archive_album_id',
                    'favorites_album_id',
                    'unassociated_group_id',
                    'rekognition_requests_limit',
                    'rekognition_requests_count',
                    'images_count_limit',
                    'image_size_limit_bytes',
                    'max_image_size',
                    'total_original_size',
                    'total_high_quality_size',
                    'created_by',
                ],
                'relations': {
                    'profiles': {
                        'relation_table': 'events_profiles',
                        'fields_needed': ['profile_id', 'label', 'hierarchy_rank', 'is_public', 'restricted_to_event', 'has_public_access_code', 'restricted_to_event_name', 'is_editable'],
                        'relation_table_fields': [
                            'can_delete_event',
                            'can_manage_event',
                            'can_upload_and_delete_images',
                            'all_images',
                            'all_groups',
                            'all_albums',
                            'can_edit',
                        ]
                    },
                },
            },
            'profiles': {
                'primary_key': 'profile_id',
                'fields': ['label','email', 'hierarchy_rank', 'can_create_events', 'restricted_to_event', 'is_public', 'has_public_access_code', 'restricted_to_event_name', 'is_editable'],
                'relations': {
                    'events': {
                        'relation_table': 'events_profiles',
                        'fields_needed': ['event_id'],
                        'relation_table_fields': [
                            'can_delete_event',
                            'can_manage_event',
                            'can_upload_and_delete_images',
                            'all_images',
                            'all_groups',
                            'all_albums',
                            'can_edit',
                        ]
                    },
                },
            },
            'current_profile': {
                'primary_key': 'profile_id',
                'fields': [
                    'profile_id',
                    'label',
                    'email',
                    'hierarchy_rank',
                    'can_create_events',
                    'restricted_to_event',
                    'is_public',
                    'is_profiles_manager',
                    'can_manage_create_events',
                    'total_notifications',
                    'unread_notifications',
                    'pending_feedbacks',
                    'has_feedbacks',
                    'has_settings',
                    'has_manageable_events',
                    'has_dashboard',
                ],
                'relations': {
                    'events': {
                        'relation_table': 'current_profile_events',
                        'fields_needed': ['event_id'],
                        'relation_table_fields': [
                            'can_manage_event',
                            'can_delete_event',
                        ],
                    },
                },
            },
            'current_event_profile': {
                'primary_key': 'event_id',
                'fields': [
                    'can_manage_event',
                    'can_delete_event',
                    'can_upload_and_delete_images',
                    'can_edit',
                    'all_images',
                    'all_groups',
                    'all_albums',
                    'has_archive_album',
                    'has_favorites_album',
                    'has_images',
                    'has_groups',
                    'has_albums',
                    'enable_new_requests',
                    'pending_access_requests_count',
                ],
            },
            'my_preferences': {
                'primary_key': ['profile_id', 'preference_group', 'preference_key'],
                'fields': ['preference_value'],
            },
            'refresh_tokens': {
                'id_type': 'INTEGER',
                'primary_key': 'token_id',
                'fields': ['profile_id', 'token', 'issued_at', 'expires_at', 'user_agent', 'ip_address', 'revoked', 'revoked_at'],
            },
            'notifications': {
                'id_type': 'INTEGER',
                'primary_key': 'notification_id',
                'fields': ['profile_id', 'message', 'created_at', 'read', 'type', 'data'],
                'serializable': {
                    'data': dict,
                }
            },
            'my_notifications': {
                'original_table': 'notifications',
                'primary_key': 'notification_id',
                'fields': ['profile_id', 'message', 'created_at', 'read', 'type', 'data'],
            },
            'feedbacks': {
                'id_type': 'INTEGER',
                'primary_key': 'feedback_id',
                'fields': [
                    'profile_id',
                    'sender_name',
                    'sender_email',
                    'profile_is_public',
                    'profile_label',
                    'communication_consent',
                    'title',
                    'type',
                    'message',
                    'created_at',
                    'is_closed',
                    'solved',
                    'closed_at',
                    'closed_by',
                    'closed_by_label',
                    'closed_details'
                ],
                'details_fields': [
                    'user_agent',
                    'ip_address',
                    'diagnostics',
                    'notes',
                    'error_ids',
                ],
                'serializable': {
                    'diagnostics': dict,
                },
            },
            'my_feedbacks': {
                'original_table': 'feedbacks',
                'primary_key': 'feedback_id',
                'fields': [
                    'communication_consent',
                    'title',
                    'type',
                    'message',
                    'created_at',
                    'is_closed',
                    'closed_at',
                    'closed_details'
                ],
                'serializable': {
                    'diagnostics': dict,
                }
            },
            'events_profiles': {
                'primary_key': ['event_id', 'profile_id'],
                'fields': ['can_manage_event', 'can_delete_event', 'can_upload_and_delete_images', 'can_edit', 'all_images', 'all_groups', 'all_albums'],
            },
            # within the event for view only
            'events_profiles_ctx': {
                'original_table': 'events_profiles',
                'primary_key': ['profile_id'],
                'fields': ['can_manage_event', 'can_delete_event', 'can_upload_and_delete_images', 'can_edit', 'all_images', 'all_groups', 'all_albums'],
                'relations': {
                    'images': {'relation_table': 'profiles_images', 'fields_needed': ['date_taken']},
                    'groups': {'relation_table': 'profiles_groups', 'fields_needed': ['label']},
                    'albums': {'relation_table': 'profiles_albums', 'fields_needed': ['label']},
                }
            },
            'images': {
                'primary_key': 'image_id',
                'fields': [
                    'date_taken',
                    'is_archived',
                    'is_favorite',
                    'label',
                    'description',
                    'moment_id',
                    'width',
                    'height',
                    'status',
                ],
                'details_fields': [
                    'label',
                    'file_size',
                    'high_quality_file_size',
                ],
                'relations': {
                    'albums': {'relation_table': 'albums_images_actual', 'fields_needed': ['label']},
                    'faces': {'relation_table': 'faces', 'fields_needed': ['group_id', 'face_width', 'face_height', 'face_left', 'face_top']},
                    'groups': {'relation_table': 'groups_images', 'fields_needed': ['label']},
                }
            },
            'faces': {
                'primary_key': 'face_id',
                'fields': ['image_id', 'group_id'],
            },
            'groups': {
                'primary_key': 'group_id',
                'fields': ['label', 'images_count', 'active_images_count', 'representative_face', 'representative_image'],
                'representative': {'field': 'representative_face', 'table': 'faces'},
                'relations': {
                    'images': {'relation_table': 'groups_images', 'fields_needed': ['date_taken', 'is_archived', 'is_favorite', 'upload_id', 'width', 'height']},
                    'faces': {'relation_table': 'faces', 'fields_needed': ['image_id', 'group_id', 'upload_id']}
                },
            },
            'moments': {
                'primary_key': 'moment_id',
                'fields': ['label', 'description', 'start_date', 'end_date', 'images_count', 'active_images_count', 'representative_image'],
                'representative': {'field': 'representative_image', 'table': 'images'},
                'relations': {
                    'images': {'relation_table': 'images', 'fields_needed': ['date_taken', 'is_archived', 'is_favorite', 'upload_id', 'width', 'height']},
                },
            },
            'albums': {
                'primary_key': 'album_id',
                'fields': ['label', 'description', 'images_count', 'active_images_count', 'representative_image'],
                'representative': {'field': 'representative_image', 'table': 'images'},
                'relations': {
                    'images': {'relation_table': 'albums_images', 'fields_needed': ['date_taken', 'is_archived', 'is_favorite', 'width', 'height']},
                },
            },
            'uploads': {
                'id_type': 'INTEGER',
                'primary_key': 'upload_id',
                'fields': ['started_at', 'completed_at', 'status', 'images_count', 'faces_count', 'clusters_count', 'moments_count', 'errors', 'notes', 'profile_id', 'profile_label'],
                'relations': {
                    'images': {'relation_table': 'images', 'fields_needed': ['date_taken', 'is_archived', 'is_favorite', 'moment_id', 'width', 'height']},
                    'faces': {'relation_table': 'uploads_faces', 'fields_needed': ['image_id', 'group_id', 'upload_id']},
                    'groups': {
                        'relation_table': 'uploads_groups',
                        'fields_needed': ['label', 'representative_face'],
                        'relation_table_fields': ['faces_count', 'upload_faces_count']
                    },
                    'moments': {
                        'relation_table': 'uploads_moments',
                        'fields_needed': ['label', 'representative_image', 'images_count'],
                        'relation_table_fields': ['images_count', 'upload_images_count']
                    },
                },
            },
            'access_requests': {
                'id_type': 'INTEGER',
                'primary_key': 'access_request_id',
                'fields': [
                    'profile_id',
                    'requested_at',
                    'applicant_name',
                    'applicant_email',
                    'applicant_phone',
                    'details',
                    'communication_consent',
                    'status',
                    'is_closed',
                    'closed_at',
                    'closed_by',
                    'closed_details',
                    'applicant_profile_id',
                    'profile_label',
                    'approved_groups_count',
                    'pending_groups_count',
                    'rejected_groups_count',
                    'accessible_groups_count',
                ],
                'relations': {
                    'groups': {
                        'relation_table': 'access_requests_groups',
                        'fields_needed': ['label', 'representative_face'],
                        'relation_table_fields': ['approved', 'closed_at', 'closed_by']
                    },
                },
                'serializable': {
                    'closed_details': list,
                }
            },
            'access_requests_groups': {
                'primary_key': ['access_request_id', 'group_id'],
                'fields': ['approved', 'closed_at', 'closed_by'],
            },
            'my_access_requests': {
                'original_table': 'access_requests',
                'primary_key': 'access_request_id',
                'fields': [
                    'profile_id',
                    'requested_at',
                    'applicant_name',
                    'applicant_email',
                    'applicant_phone',
                    'details',
                    'communication_consent',
                    'status',
                    'is_closed',
                    'closed_at',
                    'closed_by',
                    'closed_details',
                    'applicant_profile_id',
                    'profile_label',
                    'is_deletable',
                ],
                'relations': {
                    'groups': {
                        'relation_table': 'my_access_requests_groups',
                        'fields_needed': ['group_id'],
                        'relation_table_fields': ['group_id', 'label', 'representative_face', 'approved', 'closed_at', 'closed_by']
                    },
                },
                'serializable': {
                    'closed_details': list,
                }
            },
            'my_access_requests_groups': {
                'original_table': 'access_requests_groups',
                'primary_key': ['access_request_id', 'group_id'],
                'fields': ['approved', 'closed_at', 'closed_by'],
            },
            'albums_images_actual': {
                'original_table': 'albums_images',
                'primary_key': ['album_id', 'image_id'],
            },

            # Relations tables
            'current_profile_events': {
                'original_table': 'events_profiles',
                'primary_key': ['profile_id', 'event_id'],
            },
            'groups_images': {
                'primary_key': ['group_id', 'image_id'],
            },
            'albums_images': {
                'primary_key': ['album_id', 'image_id'],
            },
            'profiles_images': {
                'primary_key': ['profile_id', 'image_id'],
            },
            'profiles_groups': {
                'primary_key': ['profile_id', 'group_id'],
            },
            'profiles_albums': {
                'primary_key': ['profile_id', 'album_id'],
            },
            'uploads_groups': {
                'primary_key': ['upload_id', 'group_id'],
            },
            'uploads_moments': {
                'primary_key': ['upload_id', 'moment_id'],
            },
            'uploads_faces': {
                'primary_key': ['upload_id', 'face_id'],
            },
        }
    
    @staticmethod
    def resolve_value_type(value_type: str) -> type:
        """Resolve a value type from a string."""
        type_map = {
            'bool': bool,
            'int': int,
            'float': float,
            'str': str,
            'list': list,
            'dict': dict,
        }
        return type_map.get(value_type, str)

    @staticmethod
    def serialize_value(value_type: type | str, value: Any) -> Any:
        if isinstance(value_type, str):
            value_type = DB.resolve_value_type(value_type)
        """Convert a Python value for database storage.
        
        For TEXT/JSONB columns storing lists/dicts, serializes to JSON string.
        PostgreSQL arrays are handled directly by psycopg2, not through this method.
        """
        
        if value_type == bool:
            return 1 if value else 0
        elif value_type == int:
            return str(int(value))
        elif value_type == float:
            return str(float(value))
        elif value_type == list:
            # For TEXT/JSONB columns storing lists, serialize to JSON string
            # (PostgreSQL arrays would be handled directly by psycopg2, not through serialize_value)
            return json.dumps(value if value is not None else [])
        elif value_type == dict:
            # For JSONB fields, serialize to JSON string
            return json.dumps(value if value is not None else {})
        else:  # str
            return str(value)
    
    @staticmethod
    def deserialize_value(value_type: type | str, value: Any) -> bool | int | float | list | dict | str:
        """Convert a database string to a Python value.
        
        Handles both string values that need parsing (from TEXT/JSONB columns)
        and native Python types (from PostgreSQL arrays, JSONB, etc.)
        """
        if isinstance(value_type, str):
            value_type = DB.resolve_value_type(value_type)
        
        # Handle None values
        if value is None:
            if value_type == bool:
                return False
            elif value_type == int:
                return 0
            elif value_type == float:
                return 0.0
            elif value_type == list:
                return []
            elif value_type == dict:
                return {}
            else:  # str
                return ''
        
        # If value is already of the expected type (e.g., PostgreSQL arrays are already lists)
        if value_type in (list, dict) and isinstance(value, value_type):
            return value
        
        if value_type == bool:
            if isinstance(value, bool):
                return value
            value_str = str(value)
            return value_str.lower() in ('true', '1', 'yes') or (value_str.isdigit() and int(value_str) == 1)
        elif value_type == int:
            if isinstance(value, int):
                return value
            return int(value)
        elif value_type == float:
            if isinstance(value, float):
                return value
            return float(value)
        elif value_type == list:
            # PostgreSQL INTEGER[] arrays are already lists
            if isinstance(value, list):
                return value
            # Only parse JSON if value is a string
            if isinstance(value, str):
                try:
                    return json.loads(value)
                except json.JSONDecodeError:
                    # Fallback: try to parse as Python literal (e.g., "[1, 2, 3]")
                    try:
                        parsed = ast.literal_eval(value)
                        if isinstance(parsed, list):
                            return parsed
                    except (ValueError, SyntaxError):
                        pass
                    # If all parsing fails, return empty list
                    return []
            # Fallback: try to convert to list
            return list(value) if value else []
        elif value_type == dict:
            # JSONB columns are already dicts
            if isinstance(value, dict):
                return value
            # Only parse JSON if value is a string
            if isinstance(value, str):
                try:
                    return json.loads(value)
                except json.JSONDecodeError:
                    # Fallback: try to parse as Python literal (e.g., "{'key': 'value'}")
                    try:
                        parsed = ast.literal_eval(value)
                        if isinstance(parsed, dict):
                            return parsed
                    except (ValueError, SyntaxError):
                        pass
                    # If all parsing fails, return empty dict
                    return {}
            # Fallback
            return {}
        else:  # str
            return str(value)

    @staticmethod
    def get_original_table(table: str) -> str:
        """Get the original table name for a table."""
        return DB.STRUCTURE()[table].get('original_table', table)

    @staticmethod
    def get_id_field(table: str, remove_parent: str | None = None) -> str:
        """Get the ID field(s) for a table."""
        id_field = DB.STRUCTURE()[table].get('primary_key', '')
        if remove_parent and table != remove_parent:
            other_parent_id_field = DB.STRUCTURE()[remove_parent].get('primary_key', '')
            if isinstance(other_parent_id_field, str):
                other_parent_id_field = [other_parent_id_field]
            if isinstance(id_field, str):
                id_field = [id_field]
            id_field = [id for id in id_field if id not in other_parent_id_field]

        if isinstance(id_field, list):
            return ', '.join(id_field)
        return id_field

    @staticmethod
    def get_id_type(table: str) -> str:
        """Get the ID type for a table."""
        return DB.STRUCTURE()[DB.get_original_table(table)].get('id_type', 'UUID')

    @staticmethod
    def _get_fields(fields: list[str] | None, table: str | None = None) -> str:
        """Format fields for SQL query."""
        if table:
            table += '.'
        else:
            table = ''

        if not fields:
            fields = ["*"]
        
        fields = ', '.join([f"{table}{field}" for field in fields])
        return fields

    @staticmethod
    def get_relation(parent: str, child: str | None = None) -> tuple[str, str, str, list[str], list[str]] | list[tuple[str, str, str, list[str], list[str]]]:
        """Get the relation info for a parent and child.
        Args:
            parent: parent table
            child: child table or None to get all childs
        Returns:
            tuple with relation table, child table, child id field, view fields and relation table fields for a relation.
            if child is None, return a list of all relations info.
        """
        return_single = False
        if child:
            childs = [child]
            return_single = True
        else:
            childs = DB.STRUCTURE()[parent]['relations'].keys()

        relations = []
        for child in childs:
            relation_meta = DB.STRUCTURE()[parent]['relations'][child]
            relation_table = relation_meta['relation_table']
            child_id_field = DB.get_id_field(relation_table, remove_parent=parent)
            fields = DB._get_fields([child_id_field] + relation_meta['fields_needed'], 'c')
            relation_table_fields = relation_meta.get('relation_table_fields', [])
            if relation_table_fields:
                relation_table_fields = DB._get_fields([child_id_field] + relation_table_fields, 'r')
            relations.append((relation_table, child, child_id_field, fields, relation_table_fields))

        if return_single:
            return relations[0]
        return relations

    @staticmethod
    def get_view_fields(table: str, as_table: str | None = None, include_details: bool = False) -> str:
        """Get view fields for a table.
        Args:
            table: table name
            as_table: table name to be used as the table prefix
            include_details: if True, include details fields in the result
        Returns:
            string of fields
        """
        id_field = DB.get_id_field(table)
        fields = [id_field] + DB.STRUCTURE()[table].get('fields', [])
        if include_details:
            fields.extend(DB.STRUCTURE()[table].get('details_fields', []))
        return DB._get_fields(fields, as_table)

    # TODO: remove those 2 methods
    @staticmethod
    def current_profile_fields() -> dict:
        return {
            'profile_id': None,
            'hierarchy_rank': 0,
            'can_create_events': False,
            'restricted_to_event': None,
            'is_public': False,
        }

    @staticmethod
    def current_event_profile_fields() -> dict:
        return {
            'event_id': None,
            'can_manage_event': False,
            'can_delete_event': False,
            'can_upload_and_delete_images': False,
            'can_edit': False,
            'all_images': False,
            'all_groups': False,
            'all_albums': False,
        }
    
    @staticmethod
    def cleanup_db_connections():
        """
        Close all DB instances tracked in thread-local storage.
        This method should be called from Flask teardown handlers and Celery task cleanup.
        Thread-local storage works in all contexts (Flask, Celery, scripts, tests).
        """
        if hasattr(_thread_local, 'db_instances'):
            db_instances = list(_thread_local.db_instances)  # Copy to avoid modification during iteration
            for db_instance in db_instances:
                try:
                    db_instance.close()
                except Exception:
                    # Ignore errors during cleanup
                    pass
            _thread_local.db_instances = []

    def __init__(self, *, event_id: str | None = None, profile_id: str | None = None, public_code: str | None = None):
        """Initialize database connection.
        
        Each DB instance holds a single connection for its entire lifetime.
        The connection has context variables set and is reused for all queries.
        Must call close() or use as context manager to return connection to pool.
        """
        self.event_id = event_id
        self.connection_pool = self._get_connection_pool()
        
        # Get a connection from the pool and keep it for the lifetime of this instance
        self.conn = self.connection_pool.getconn()

        self.profile_context = self.current_profile_fields()
        self.event_profile_context = self.current_event_profile_fields()
        
        # Handle public_code lookup (before setting profile_id)
        if not profile_id and public_code:
            if not event_id:
                self.close()
                raise Forbidden('Access denied: no event ID provided')
            with self.conn.cursor() as cursor:
                cursor.execute('SELECT profile_id FROM profiles WHERE public_access_code = %s', (public_code,))
                result = cursor.fetchone()
                if result:
                    profile_id = result[0]
                else:
                    self.close()
                    raise Forbidden(f'Access denied: public access code {public_code} is invalid')
            self.conn.commit()

        # Set profile_id (this populates profile_context and event_profile_context via the setter)
        self.profile_id = profile_id
        
        # Set context variables on this specific connection
        self._set_context_on_connection()
        
        # Track in thread-local storage (works in Flask, Celery, and other contexts)
        if not hasattr(_thread_local, 'db_instances'):
            _thread_local.db_instances = []
        _thread_local.db_instances.append(self)

    @property
    def profile_id(self) -> str | None:
        """Get the current profile id for access control."""
        return self.profile_context.get('profile_id')

    @profile_id.setter
    def profile_id(self, profile_id: str | None):
        """Set the current profile id for access control."""        
        # Store profile_id in context (for Python code access)
        self.profile_context['profile_id'] = profile_id
        
        # Store event_id in event_profile_context (for Python code access)
        # The SQL functions will query the database tables directly
        self.event_profile_context['event_id'] = self.event_id
        
        # Still populate other fields in context for Python code that might use them
        if profile_id:
            profile = self.execute_query('SELECT * FROM profiles WHERE profile_id = %s', (profile_id,), return_format=ReturnFormat.DICT)
            if profile:
                for field, default_val in self.current_profile_fields().items():
                    if field != 'profile_id':  # Already set above
                        val = profile.get(field, default_val)
                        self.profile_context[field] = val
                
                # Compute is_developer field (O(1) access in SQL)
                # Cache developer_id since it rarely changes but is queried frequently
                if DB._developer_id_cache is None:
                    settings = self.execute_query('SELECT developer_id FROM settings WHERE id = 1 LIMIT 1', (), return_format=ReturnFormat.DICT)
                    DB._developer_id_cache = settings.get('developer_id') if settings else None
                developer_id = DB._developer_id_cache
                self.profile_context['is_developer'] = (developer_id == profile_id) if developer_id else False
            
            if self.event_id:
                event_profile = self.execute_query('SELECT * FROM events_profiles WHERE event_id = %s AND profile_id = %s', (self.event_id, profile_id), return_format=ReturnFormat.DICT)
                if event_profile:
                    for field, default_val in self.current_event_profile_fields().items():
                        if field != 'event_id':  # Already set above
                            val = event_profile.get(field, default_val)
                            self.event_profile_context[field] = val

    def _set_context_on_connection(self):
        """Set context variables on self.conn (the instance's dedicated connection)."""
        sql_commands = []
        params = []

        for key, value in self.profile_context.items():
            val_str = str(value) if value is not None else ''
            sql_commands.append("SELECT set_profile_context(%s, %s);")
            params.extend([key, val_str])

        for key, value in self.event_profile_context.items():
            val_str = str(value) if value is not None else ''
            sql_commands.append("SELECT set_event_profile_context(%s, %s);")
            params.extend([key, val_str])

        if self.event_id and 'event_id' not in self.event_profile_context:
            sql_commands.append("SELECT set_event_profile_context(%s, %s);")
            params.extend(['event_id', str(self.event_id)])

        if sql_commands:
            full_query = "\n".join(sql_commands)
            with self.conn.cursor() as cursor:
                cursor.execute(full_query, params)
            self.conn.commit()

    def close(self):
        """Return the connection to the pool. Must be called when done with this DB instance."""
        if self.conn:
            try:
                self.conn.rollback()
                
                self.conn.autocommit = True
                
                with self.conn.cursor() as cursor:
                    cursor.execute("DISCARD ALL")
                    
            except Exception:
                pass
            finally:
                try:
                    self.conn.autocommit = False
                except Exception:
                    pass

                self.connection_pool.putconn(self.conn)
                self.conn = None
        
        # Remove from thread-local tracking
        if hasattr(_thread_local, 'db_instances'):
            try:
                _thread_local.db_instances.remove(self)
            except ValueError:
                pass
    
    def __enter__(self):
        """Support for context manager protocol: with DB(...) as db:"""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Support for context manager protocol: automatically close on exit"""
        self.close()

    def execute_query(self, query: str, params: tuple | list = (), return_format: ReturnFormat | None = None) -> Any:
        """Execute any SQL query and return results according to return_format.

        Supports SELECT and action queries (INSERT, UPDATE, DELETE, UPSERT)
        with optional RETURNING clause.
        
        Uses the instance's dedicated connection (self.conn) which already has context set.
        """
        if not self.conn:
            raise DatabaseError("Database connection is closed. Cannot execute query.")
        
        results = None
        row_count = None
        has_resultset = False

        try:
            with self.conn.cursor() as cursor:
                cursor.execute(query, params)
                has_resultset = cursor.description is not None
                if has_resultset:
                    columns = [desc[0] for desc in cursor.description]
                    rows = cursor.fetchall()
                else:
                    row_count = cursor.rowcount
                    rows = []
                    columns = []
            self.conn.commit()
        
        except psycopg2_errors.Error as e:
            # Rollback the transaction on any error to reset the transaction state
            # This prevents "current transaction is aborted" errors on subsequent queries
            try:
                self.conn.rollback()
            except Exception:
                # If rollback fails, connection might be in a bad state, but we'll still raise the original error
                pass
            
            error_str = str(e)
            # Strip CONTEXT and SQL statement details from PostgreSQL errors
            # Format: "Error message\nCONTEXT: ..."
            if "\nCONTEXT:" in error_str:
                error_str = error_str.split("\nCONTEXT:")[0].strip()
            
            if "Policy error" in error_str:
                error_message = error_str.replace("Policy error: ", "")
                raise PolicyError(f"Policy error: {error_message}") from e
            elif "Permission denied" in error_str:
                error_message = error_str.replace("Permission denied: ", "")
                raise Forbidden(f"Permission denied: {error_message}") from e
            else:
                if isinstance(e, psycopg2_errors.IntegrityError):
                    error_message = error_str.replace("Integrity error: ", "")
                    raise DatabaseError(f"Integrity error: {error_message}") from e
                else:
                    error_message = error_str.replace("Database error: ", "")
                    raise DatabaseError(f"Internal error: {error_message}") from e
        
        if has_resultset or return_format:

            if return_format is None:
                return_format = ReturnFormat.LIST_TUPLES

            if return_format == ReturnFormat.VALUE:
                results = rows[0][0] if rows else None
            elif return_format == ReturnFormat.TUPLE:
                results = rows[0] if rows else ()
            elif return_format == ReturnFormat.DICT:
                results = dict(zip(columns, rows[0])) if rows else {}
            elif return_format == ReturnFormat.LIST_VALUES:
                results = [row[0] for row in rows] if rows else []
            elif return_format == ReturnFormat.LIST_TUPLES:
                results = rows
            elif return_format == ReturnFormat.LIST_DICTS:
                results = [dict(zip(columns, row)) for row in rows] if rows else []
            elif return_format == ReturnFormat.DICT_DICTS:
                value_cols = columns[1:] if has_resultset else []
                results = {
                    row[0]: dict(zip(value_cols, row[1:]))
                    for row in rows
                } if rows else {}
            elif return_format == ReturnFormat.DICT_VALUES:
                results = {
                    row[0]: row[1]
                    for row in rows
                } if rows else {}
            elif return_format == ReturnFormat.LIST_AND_DICT_DICTS:
                value_cols = columns[1:] if has_resultset else []
                list_results = []
                dict_results = {}
                for row in rows:
                    list_results.append(row[0])
                    dict_results[row[0]] = dict(zip(value_cols, row[1:]))
                results = (list_results, dict_results)
        else:
            results = row_count

        return results

    def _build_where(self, where: dict) -> tuple[str, list]:
        clauses = []
        values = []
        for k, v in where.items():
            if isinstance(v, list):
                if not v:
                    clauses.append("1=0")
                else:
                    placeholders = ",".join(["%s"] * len(v))
                    clauses.append(f"{k} IN ({placeholders})")
                    values += v
            else:
                clauses.append(f"{k}=%s")
                values.append(v)
        return " AND ".join(clauses), values

    def insert_many(self, table: str, fields: list, values: list[list]) -> list:
        """
        Insert multiple rows and return their primary keys.
        Args:
            table: table name
            fields: list of field names
            values: list of lists, each list is a row to insert
        Returns:
            list of primary keys
        """
        if not values:
            return []

        target = f"{table}_ctx"
        p_keys = self.STRUCTURE()[table].get("primary_key")
        returning = ", ".join(p_keys) if isinstance(p_keys, list) else p_keys
        return_format = ReturnFormat.LIST_TUPLES if isinstance(p_keys, list) else ReturnFormat.LIST_VALUES

        keys = list(fields)
        row_placeholders = f"({', '.join(['%s'] * len(keys))})"
        value_placeholders = ", ".join([row_placeholders] * len(values))
        sql = f"INSERT INTO {target} ({', '.join(keys)}) VALUES {value_placeholders}"
        sql += f" RETURNING {returning}"

        all_values = []
        for value in values:
            for v in value:
                all_values.append(v)

        return self.execute_query(sql, all_values, return_format)

    def insert(self, table: str, data: dict) -> str | None:
        """
        Insert one entity and return its primary key.
        Args:
            table: table name
            data: dictionary of entity data
        Returns:
            new entity id
        """
        if not data:
            return []

        target = f"{table}_ctx"
        p_keys = self.STRUCTURE()[table].get("primary_key")
        returning = ", ".join(p_keys) if isinstance(p_keys, list) else p_keys

        keys = list(data.keys())
        placeholders = ", ".join(["%s"] * len(keys))
        sql = f"INSERT INTO {target} ({', '.join(keys)}) VALUES ({placeholders})"
        sql += f" RETURNING {returning}"

        return self.execute_query(sql, [data[k] for k in keys], ReturnFormat.VALUE)

    def update(self, table: str, where: dict, fields: dict) -> list:
        """Update rows matching WHERE clause and return their primary keys (if defined)."""
        if not fields:
            return []

        target = f"{table}_ctx"
        p_keys = self.STRUCTURE()[table].get("primary_key")
        returning = ", ".join(p_keys) if isinstance(p_keys, list) else p_keys

        set_clause = ", ".join([f"{k}=%s" for k in fields])
        where_clause, where_values = self._build_where(where)
        sql = f"UPDATE {target} SET {set_clause} WHERE {where_clause}"
        sql += f" RETURNING {returning}"

        params = list(fields.values()) + list(where_values)
        return self.execute_query(sql, params, ReturnFormat.LIST_VALUES)

    def delete(self, table: str, where: dict) -> list:
        """Delete rows matching WHERE clause and return their primary keys (if defined)."""
        target = f"{table}_ctx"
        p_keys = self.STRUCTURE()[table].get("primary_key")
        returning = ", ".join(p_keys) if isinstance(p_keys, list) else p_keys

        where_clause, where_values = self._build_where(where)
        sql = f"DELETE FROM {target} WHERE {where_clause}"
        sql += f" RETURNING {returning}"

        return self.execute_query(sql, where_values, ReturnFormat.LIST_VALUES)
