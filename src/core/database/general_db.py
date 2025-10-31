import sqlite3
import os
import uuid
from contextlib import contextmanager
from src.core.database.base_db import BaseDB, ReturnFormat
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
                },
                'RequestsGallery': {
                    'sortDir': (str, 'desc'),
                    'sortBy': (str, 'requested_at')
                },
                'RequestsDetail': {
                    'sortDir': (str, 'asc')
                }
            }
        }

    @classmethod
    def STRUCTURE(self) -> dict:
        return {
            'events': {
                'primary_key': 'event_id',
                'accessible_table': 'accessible_events',
                'fields': ['name', 'date', 'url', 'images_count_limit', 'image_size_limit_bytes'],
                'relations': {
                    'profiles': {'relation_table': 'profiles_events', 'fields_needed': ['can_delete']},
                },
            },
            'profiles': {
                'primary_key': 'profile_id',
                'accessible_table': 'accessible_profiles',
                'fields': ['label', 'hierarchy_rank', 'can_create_events', 'restricted_to_event'],
                'relations': {
                    'events': {'relation_table': 'profiles_events', 'fields_needed': ['can_delete']},
                },
            },
            'profiles_events': {
                'primary_key': ['profile_id', 'event_id'],
                'accessible_table': 'accessible_profiles_events',
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
            },
            'notifications': {
                'primary_key': 'id',
                'accessible_table': 'accessible_notifications',
                'fields': ['profile_id', 'message', 'created_at', 'read', 'type', 'data'],
                'serializable': {
                    'data': dict,
                }
            },
            'my_notifications': {
                'primary_key': 'id',
                'accessible_table': 'accessible_my_notifications',
                'fields': ['profile_id', 'message', 'created_at', 'read', 'type', 'data'],
            },
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
                UNIQUE (label, restricted_to_event)
                FOREIGN KEY (restricted_to_event) REFERENCES events(event_id) ON DELETE SET NULL
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
            ''',
            'notifications': '''
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                read INTEGER DEFAULT 0,
                read_at DATETIME,
                type TEXT,
                data TEXT,
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE
            ''',
        }
    
    @classmethod
    def INDEXES(self) -> dict:
        return {
            'idx_profiles_label': 'profiles(label)',
            'idx_profiles_restricted_to_event': 'profiles(restricted_to_event)',
            'idx_profiles_events_profile_id': 'profiles_events(profile_id)',
            'idx_profiles_events_event_id': 'profiles_events(event_id)',
            'idx_refresh_tokens_profile_id': 'refresh_tokens(profile_id)',
            'idx_refresh_tokens_token': 'refresh_tokens(token)',
            'idx_events_url': 'events(url)',
            'idx_notifications_profile_id': 'notifications(profile_id)',
            'idx_notifications_message': 'notifications(message)',
            'idx_notifications_read': 'notifications(read)',
            'idx_notifications_created_at': 'notifications(created_at)',
            'idx_notifications_type': 'notifications(type)',
        }
    
    @classmethod
    def VIEWS(self) -> dict:
        return {
            'accessible_events': """
                SELECT * FROM events
            """,
            'accessible_profiles': """
                SELECT * FROM profiles p
                WHERE
                    cur_profile('profile_id') = p.profile_id 
                    OR p.hierarchy_rank < cur_profile('hierarchy_rank')
            """,
            'accessible_profiles_events': """
                SELECT * FROM profiles_events pe
                INNER JOIN accessible_profiles ap ON pe.profile_id = ap.profile_id
            """,
            'my_notifications': """
                SELECT * FROM notifications
                WHERE profile_id = cur_profile('profile_id')
            """,
            'accessible_my_notifications': """
                SELECT * FROM my_notifications
            """,
            'accessible_notifications': """
                SELECT * FROM notifications
                INNER JOIN accessible_profiles ap ON notifications.profile_id = ap.profile_id
            """,
        }
    
    @classmethod
    def TRIGGERS(self) -> dict:
        return {
            # accessible_profiles
            'trg_accessible_profiles_insert': """
                INSTEAD OF INSERT ON accessible_profiles
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN NEW.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                            RAISE(ABORT, 'Permission denied: cannot create profile with higher or equal rank')
                        WHEN NEW.can_create_events = 1 AND cur_profile('can_create_events') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot create profile with can_create_events=1 if current profile does not have can_create_events=1')
                        WHEN NEW.restricted_to_event IS NOT NULL AND cur_profile('restricted_to_event') <> COALESCE(NEW.restricted_to_event, '') THEN
                            RAISE(ABORT, 'Permission denied: cannot create profile to a different event than the current profile')
                    END;

                    INSERT INTO profiles (profile_id, label, password, hierarchy_rank, can_create_events, restricted_to_event)
                    VALUES (NEW.profile_id, NEW.label, NEW.password, NEW.hierarchy_rank, NEW.can_create_events, NEW.restricted_to_event);
                END;
            """,
            'trg_accessible_profiles_update': """
                INSTEAD OF UPDATE ON accessible_profiles
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN NEW.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                            RAISE(ABORT, 'Permission denied: cannot update profile with higher or equal rank')
                        WHEN NEW.can_create_events = 1 AND cur_profile('can_create_events') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot update profile with can_create_events=1 if current profile does not have can_create_events=1')
                        WHEN NEW.restricted_to_event IS NOT NULL AND cur_profile('restricted_to_event') <> COALESCE(NEW.restricted_to_event, '') THEN
                            RAISE(ABORT, 'Permission denied: cannot update profile to a different event than the current profile')
                    END;

                    UPDATE profiles SET
                        label = NEW.label,
                        password = NEW.password,
                        hierarchy_rank = NEW.hierarchy_rank,
                        can_create_events = NEW.can_create_events,
                        restricted_to_event = NEW.restricted_to_event
                    WHERE profile_id = OLD.profile_id;
                END;
            """,
            'trg_accessible_profiles_delete': """
                INSTEAD OF DELETE ON accessible_profiles
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN OLD.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                            RAISE(ABORT, 'Permission denied: cannot delete profile with higher or equal rank')
                        WHEN cur_profile('restricted_to_event') IS NOT NULL AND cur_profile('restricted_to_event') <> COALESCE(OLD.restricted_to_event, '') THEN
                            RAISE(ABORT, 'Permission denied: cannot delete profile from a different event than the current profile')
                    END;

                    DELETE FROM profiles
                    WHERE profile_id = OLD.profile_id;
                END;
            """,
            # accessible_profiles_events
            'trg_accessible_profiles_events_insert': """
                INSTEAD OF INSERT ON accessible_profiles_events
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN NEW.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                            RAISE(ABORT, 'Permission denied: cannot edit profile event with higher or equal rank')
                        WHEN cur_profile('profile_id') NOT IN (SELECT profile_id FROM profiles_events WHERE event_id = NEW.event_id) THEN
                            RAISE(ABORT, 'Permission denied: the current profile does not have permissions in the event')
                        WHEN NEW.can_delete = 1 AND cur_profile('can_delete') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot create profile event with can_delete=1 if current profile does not have can_delete=1')
                    END;

                    INSERT INTO profiles_events (profile_id, event_id, can_delete)
                    VALUES (NEW.profile_id, NEW.event_id, NEW.can_delete);
                END;
            """,
            'trg_accessible_profiles_events_update': """
                INSTEAD OF UPDATE ON accessible_profiles_events 
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN NEW.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                            RAISE(ABORT, 'Permission denied: cannot edit profile event with higher or equal rank')
                        WHEN cur_profile('profile_id') NOT IN (SELECT profile_id FROM profiles_events WHERE event_id = NEW.event_id) THEN
                            RAISE(ABORT, 'Permission denied: the current profile does not have permissions in the event')
                        WHEN NEW.can_delete = 1 AND cur_profile('can_delete') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot edit profile event with can_delete=1 if current profile does not have can_delete=1')
                    END;

                    UPDATE profiles_events SET
                        can_delete = NEW.can_delete
                    WHERE profile_id = OLD.profile_id AND event_id = OLD.event_id;
                END;
            """,
            'trg_accessible_profiles_events_delete': """
                INSTEAD OF DELETE ON accessible_profiles_events
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN OLD.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                            RAISE(ABORT, 'Permission denied: cannot delete profile event with higher or equal rank')
                        WHEN cur_profile('profile_id') NOT IN (SELECT profile_id FROM profiles_events WHERE event_id = OLD.event_id) THEN
                            RAISE(ABORT, 'Permission denied: the current profile does not have permissions in the event')
                    END;

                    DELETE FROM profiles_events
                    WHERE profile_id = OLD.profile_id AND event_id = OLD.event_id;
                END;
            """,
            # notifications
            'trg_accessible_notifications_insert': """
                INSTEAD OF INSERT ON accessible_notifications
                BEGIN
                    INSERT INTO notifications (profile_id, message, created_at, read, type, data)
                    VALUES (NEW.profile_id, NEW.message, COALESCE(NEW.created_at, CURRENT_TIMESTAMP), COALESCE(NEW.read, 0), NEW.type, NEW.data);
                END;
            """,
            'trg_accessible_notifications_update': """
                INSTEAD OF UPDATE ON accessible_notifications
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN
                            cur_profile('hierarchy_rank') <=
                            (SELECT hierarchy_rank FROM profiles WHERE profile_id = NEW.profile_id)
                        THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible')
                    END;

                    UPDATE notifications SET
                        message = NEW.message,
                        read = COALESCE(NEW.read, read),
                        type = NEW.type,
                        data = NEW.data
                    WHERE id = OLD.id;
                END;
            """,
            'trg_accessible_notifications_delete': """
                INSTEAD OF DELETE ON accessible_notifications
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN
                            cur_profile('hierarchy_rank') <=
                            (SELECT hierarchy_rank FROM profiles WHERE profile_id = OLD.profile_id)
                        THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible')
                    END;

                    DELETE FROM notifications
                    WHERE id = OLD.id;
                END;
            """,
            
            # my_notifications
            'trg_accessible_my_notifications_update': """
                INSTEAD OF UPDATE ON accessible_my_notifications
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('profile_id') <> OLD.profile_id THEN
                            RAISE(ABORT, 'Permission denied: the notifification is not accessible')
                    END;

                    UPDATE notifications SET
                        read = COALESCE(NEW.read, read),
                        read_at = COALESCE(NEW.read_at, CURRENT_TIMESTAMP)
                    WHERE id = OLD.id;
                END;
            """,
            'trg_accessible_my_notifications_delete': """
                INSTEAD OF DELETE ON accessible_my_notifications
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('profile_id') <> OLD.profile_id THEN
                            RAISE(ABORT, 'Permission denied: the notifification is not accessible')
                    END;

                    DELETE FROM notifications
                    WHERE id = OLD.id;
                END;
            """,

            # ensure_profiles_unique
            'trg_ensure_profiles_unique_insert': """
                BEFORE INSERT ON profiles
                BEGIN
                    SELECT CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM profiles
                            WHERE
                                label = NEW.label
                                AND (
                                    COALESCE(restricted_to_event, '') = COALESCE(NEW.restricted_to_event, '')
                                    OR restricted_to_event IS NULL
                                )
                        ) THEN
                            RAISE(ABORT, 'Policy error: Profile label already exists')
                    END;
                END;
            """,
            'trg_ensure_profiles_unique_update': """
                BEFORE UPDATE ON profiles
                BEGIN
                    SELECT CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM profiles p
                            WHERE
                                p.label = NEW.label
                                AND (
                                    (p.restricted_to_event IS NOT NULL AND p.restricted_to_event = NEW.restricted_to_event)
                                    OR p.restricted_to_event IS NULL
                                )
                                AND p.profile_id <> OLD.profile_id
                        ) THEN
                            RAISE(ABORT, 'Policy error: Profile label already exists')
                    END;
                END;
            """,
        }

    @classmethod
    def current_profile_fields(cls) -> dict:
        return {
            'profile_id': '',
            'hierarchy_rank': 0,
            'can_create_events': False,
            'restricted_to_event': None,
        }

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
   
    def __init__(self, profile_id: str | None = None):
        """Initialize general database connection."""
        db_path = DB_PATH
        # Ensure database file exists
        if not os.path.exists(db_path):
            # self.create_db(db_path)
            raise Exception('General database file does not exist')

        super().__init__(db_path, profile_id)
