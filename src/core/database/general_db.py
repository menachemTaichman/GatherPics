import sqlite3
import os
import uuid
from src.core.database.base_db import BaseDB
from src.core.config import DATA_ROOT

DB_PATH = os.path.join(DATA_ROOT, 'general.db')

class GeneralDB(BaseDB):
    """General database for cross-event data (events, profiles, authentication, settings)."""

    @classmethod
    def CONSTANTS(self) -> dict:
        return {
            'profiles_preferences': {
                'general': {
                    'select': (bool, False),
                    'size': (float, 1.0),
                    'includeArchived': (bool, False)
                },
                'ImageViewer': {
                    'albumsHeight': (int, 200),
                    'albumsOpen': (bool, False),
                    'facesOpen': (bool, False),
                    'sidebarOpen': (bool, False)
                },
                'GroupDetail': {
                    'sortDir': (str, 'asc')
                },
                'Moments': {
                    'sortDir': (str, 'asc'),
                    'carouselExpanded': (bool, True)
                },
                'EditMomentImagesModal': {
                    'filter': (str, 'all'),
                    'sortDir': (str, 'asc')
                },
                'GroupsGallery': {
                    'sortDir': (str, 'desc'),
                    'sortBy': (str, 'name')
                },
                'AlbumsGallery': {
                    'sortBy': (str, 'name'),
                    'sortDir': (str, 'asc')
                },
                'AlbumsDetail': {
                    'sortDir': (str, 'asc')
                },
                'BucketDrawer': {
                    'mode': (str, 'download'),
                    'quality': (str, 'high'),
                    'excludeAlready': (bool, True),
                    'alreadyDownloaded': (list, []),
                    'alreadyUploaded': (list, []),
                    'queue': (list, [])
                },
                'UploadsGallery': {
                    'sortDir': (str, 'desc'),
                    'sortBy': (str, 'started_at')
                },
                'UploadDetail': {
                    'mode': (str, 'groups'),
                    'sortDir': (str, 'asc')
                }
            }
        }

    @classmethod
    def STRUCTURE(self) -> dict:
        return {
            'events': {
                'primary_key': 'event_id',
                'accessible_table': 'events',
                'fields': ['name', 'date', 'url', 'images_count_limit', 'image_size_limit_bytes'],
                'relations': {
                    'profiles': {'relation_table': 'profiles_events', 'fields_needed': ['can_delete']},
                },
            },
            'profiles': {
                'primary_key': 'profile_id',
                'accessible_table': 'profiles',
                'fields': ['label', 'hierarchy_rank', 'can_create_events', 'restricted_to_event', 'save_preferences'],
                'relations': {
                    'events': {'relation_table': 'profiles_events', 'fields_needed': ['can_delete']},
                },
            },
            'profiles_events': {
                'primary_key': ['profile_id', 'event_id'],
                'accessible_table': 'profiles_events',
                'fields': ['can_delete'],
            },
            'profiles_preferences': {
                'primary_key': ['profile_id', 'preference_group', 'preference_key'],
                'accessible_table': 'profiles_preferences',
                'fields': ['preference_value'],
            },
            'refresh_tokens': {
                'primary_key': 'token_id',
                'accessible_table': 'refresh_tokens',
                'fields': ['profile_id', 'token', 'issued_at', 'expires_at', 'user_agent', 'ip_address', 'revoked', 'revoked_at'],
            },
            'settings': {
                'primary_key': 'id',
                'accessible_table': 'settings',
                'fields': ['developer_id', 'image_size_limit_bytes', 'images_count_limit'],
            }
        }
    
    @classmethod
    def TABLES(self) -> dict:
        return {
            'events': '''
                event_id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                date TEXT,
                url TEXT UNIQUE,
                images_count_limit INTEGER DEFAULT 0,
                image_size_limit_bytes INTEGER DEFAULT 0
            ''',
            'profiles': '''
                profile_id TEXT PRIMARY KEY NOT NULL,
                label TEXT COLLATE NOCASE NOT NULL,
                password TEXT DEFAULT '',
                hierarchy_rank INTEGER DEFAULT 0 CHECK (hierarchy_rank >= 0),
                can_create_events INTEGER DEFAULT 0,
                restricted_to_event TEXT DEFAULT NULL,
                save_preferences INTEGER DEFAULT 0,
                UNIQUE (label, restricted_to_event)
            ''',
            'profiles_events': '''
                profile_id TEXT NOT NULL,
                event_id TEXT NOT NULL,
                can_delete INTEGER DEFAULT 0,
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
                FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
                PRIMARY KEY (profile_id, event_id)
            ''',
            'profiles_preferences': '''
                profile_id TEXT NOT NULL,
                preference_group TEXT NOT NULL,
                preference_key TEXT NOT NULL,
                preference_value TEXT,
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
                PRIMARY KEY (profile_id, preference_group, preference_key)
            ''',
            'refresh_tokens': '''
                token_id INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id TEXT NOT NULL,
                token TEXT NOT NULL UNIQUE,
                issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NOT NULL,
                user_agent TEXT,
                ip_address TEXT,
                revoked INTEGER DEFAULT 0,
                revoked_at DATETIME,
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE
            ''',
            'settings': '''
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                developer_id TEXT,
                image_size_limit_bytes INTEGER DEFAULT 0,
                images_count_limit INTEGER DEFAULT 0,
                FOREIGN KEY (developer_id) REFERENCES profiles(profile_id) ON DELETE SET NULL
            '''
        }
    
    @classmethod
    def INDEXES(self) -> list:
        return [
            'idx_profiles_label ON profiles(label)',
            'idx_profiles_restricted_to_event ON profiles(restricted_to_event)',
            'idx_profiles_events_profile_id ON profiles_events(profile_id)',
            'idx_profiles_events_event_id ON profiles_events(event_id)',
            'idx_refresh_tokens_profile_id ON refresh_tokens(profile_id)',
            'idx_refresh_tokens_token ON refresh_tokens(token)',
            'idx_events_url ON events(url)',
        ]
    
    @classmethod
    def VIEWS(self) -> dict:
        return {}
    
    @classmethod
    def TRIGGERS(self) -> dict:
        return {}

    @classmethod
    def create_db(cls) -> str:
        """
        Create a new general database with all tables and initial data.
        Returns:
            developer_id: str
        """
        
        db_path = DB_PATH
        super().create_db(db_path)

        # Insert default settings row
        developer_id = str(uuid.uuid4())
        conn = sqlite3.connect(db_path)
        conn.execute('''
                INSERT OR IGNORE INTO profiles (profile_id, label, password, hierarchy_rank, can_create_events)
                VALUES (?, ?, ?, ?, ?)
            ''', (developer_id, 'Developer', '', 10, 1))
        conn.execute('''
                INSERT OR IGNORE INTO settings (id, image_size_limit_bytes, images_count_limit, developer_id)
                VALUES (1, 13631488, 6000, ?)
            ''', (developer_id,))
            
        conn.commit()
        conn.close()
        
        return developer_id
   
    def __init__(self):
        """Initialize general database connection."""
        db_path = DB_PATH
        super().__init__(db_path)
        # Ensure database file exists
        if not os.path.exists(db_path):
            self.create_general_db(db_path)
    