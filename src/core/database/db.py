import sqlite3
from typing import Any
import json
from contextlib import contextmanager
import os
from enum import Enum
from src.core.config import DATA_ROOT
from src.core.errors import Forbidden, DatabaseError, DBPolicyError

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
    
    # @staticmethod
    # def CONSTANTS() -> dict:
    #     return {
    #         'profiles_preferences': {
    #             'general': {
    #                 'select': (bool, False),
    #                 'size': (float, 1.0),
    #                 'includeArchived': (bool, False)
    #             },
    #             'ImageViewer': {
    #                 'albumsHeight': (int, 200),
    #                 'albumsOpen': (bool, False),
    #                 'facesOpen': (bool, False),
    #                 'sidebarOpen': (bool, False)
    #             },
    #             'GroupDetail': {
    #                 'sortDir': (str, 'asc')
    #             },
    #             'Moments': {
    #                 'sortDir': (str, 'asc'),
    #                 'carouselExpanded': (bool, True)
    #             },
    #             'EditMomentImagesModal': {
    #                 'filter': (str, 'all'),
    #                 'sortDir': (str, 'asc')
    #             },
    #             'GroupsGallery': {
    #                 'sortDir': (str, 'desc'),
    #                 'sortBy': (str, 'name')
    #             },
    #             'AlbumsGallery': {
    #                 'sortBy': (str, 'name'),
    #                 'sortDir': (str, 'asc')
    #             },
    #             'AlbumsDetail': {
    #                 'sortDir': (str, 'asc')
    #             },
    #             'BucketDrawer': {
    #                 'mode': (str, 'download'),
    #                 'quality': (str, 'high'),
    #                 'excludeAlready': (bool, True),
    #                 'alreadyDownloaded': (list, []),
    #                 'alreadyUploaded': (list, []),
    #                 'queue': (list, [])
    #             },
    #             'UploadsGallery': {
    #                 'sortDir': (str, 'desc'),
    #                 'sortBy': (str, 'started_at')
    #             },
    #             'UploadDetail': {
    #                 'mode': (str, 'groups'),
    #                 'sortDir': (str, 'asc')
    #             },
    #             'EventsGallery': {
    #                 'filterVisibility': (str, 'all'),
    #                 'sortDir': (str, 'desc'),
    #                 'sortBy': (str, 'date')
    #             },
    #             'RequestsGallery': {
    #                 'filterStatus': (str, 'all'),
    #                 'sortDir': (str, 'desc'),
    #                 'sortBy': (str, 'requested_at')
    #             },
    #             'RequestsDetail': {
    #                 'sortDir': (str, 'asc')
    #             },
    #             'FeedbacksGallery': {
    #                 'filterStatus': (str, 'all'),
    #                 'sortDir': (str, 'desc'),
    #                 'sortBy': (str, 'created_at')
    #             }
    #         }
    #     }

    @staticmethod
    def STRUCTURE() -> dict:
        return {
            'settings': {
                'primary_key': 'id',
                'accessible_table': 'accessible_settings',
                'fields': [
                    'image_size_limit_bytes',
                    'images_count_limit',
                    'min_rank_to_create_event',
                    'rekognition_calls_limit',
                ],
            },
            'events': {
                'primary_key': 'event_id',
                'accessible_table': 'accessible_events',
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
                    'rekognition_calls_limit',
                    'rekognition_calls_used',
                ],
                'details_fields': [
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
                        'fields_needed': ['profile_id', 'label', 'hierarchy_rank', 'is_public', 'restricted_to_event', 'has_public_access_code', 'restricted_to_event_name'],
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
                'accessible_table': 'accessible_profiles',
                'fields': ['label','email', 'hierarchy_rank', 'can_create_events', 'restricted_to_event', 'is_public', 'has_public_access_code', 'restricted_to_event_name'],
                'relations': {
                    'events': {
                        'relation_table': 'events_profiles2',
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
                'accessible_table': 'current_profile',
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
                'accessible_table': 'current_event_profile',
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
                'accessible_table': 'my_preferences',
                'fields': ['preference_value'],
            },
            'refresh_tokens': {
                'primary_key': 'token_id',
                'accessible_table': 'refresh_tokens',
                'fields': ['profile_id', 'token', 'issued_at', 'expires_at', 'user_agent', 'ip_address', 'revoked', 'revoked_at'],
            },
            'notifications': {
                'primary_key': 'notification_id',
                'accessible_table': 'accessible_notifications',
                'fields': ['profile_id', 'message', 'created_at', 'read', 'type', 'data'],
                'serializable': {
                    'data': dict,
                }
            },
            'my_notifications': {
                'original_table': 'notifications',
                'primary_key': 'notification_id',
                'accessible_table': 'accessible_my_notifications',
                'fields': ['profile_id', 'message', 'created_at', 'read', 'type', 'data'],
            },
            'feedbacks': {
                'primary_key': 'feedback_id',
                'accessible_table': 'accessible_feedbacks',
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
                ],
                'serializable': {
                    'diagnostics': dict,
                },
            },
            'my_feedbacks': {
                'original_table': 'feedbacks',
                'primary_key': 'feedback_id',
                'accessible_table': 'accessible_my_feedbacks',
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
                'primary_key': ['profile_id'],
                'accessible_table': 'accessible_events_profiles',
                'fields': ['can_manage_event', 'can_delete_event', 'can_upload_and_delete_images', 'can_edit', 'all_images', 'all_groups', 'all_albums'],
                'relations': {
                    'images': {'relation_table': 'events_profiles_images', 'fields_needed': ['date_taken']},
                    'groups': {'relation_table': 'events_profiles_groups', 'fields_needed': ['label']},
                    'albums': {'relation_table': 'events_profiles_albums', 'fields_needed': ['label']},
                }
            },
            'images': {
                'primary_key': 'image_id',
                'accessible_table': 'accessible_images',
                'fields': ['date_taken', 'is_archived', 'is_favorite', 'label', 'file_size', 'width', 'height', 'moment_id'],
                'relations': {
                    'albums': {'relation_table': 'albums_images_actual', 'fields_needed': ['label']},
                    'faces': {'relation_table': 'faces', 'fields_needed': ['group_id', 'width', 'height', 'left', 'top']},
                    'groups': {'relation_table': 'groups_images', 'fields_needed': ['label']},
                }
            },
            'faces': {
                'primary_key': 'face_id',
                'accessible_table': 'accessible_faces',
                'fields': ['image_id', 'group_id'],
            },
            'groups': {
                'primary_key': 'group_id',
                'accessible_table': 'accessible_groups',
                'fields': ['label', 'images_count', 'active_images_count', 'representative_face', 'representative_image'],
                'representative': {'field': 'representative_face', 'table': 'faces'},
                'relations': {
                    'images': {'relation_table': 'groups_images', 'fields_needed': ['date_taken', 'is_archived', 'is_favorite', 'upload_id']},
                    'faces': {'relation_table': 'faces', 'fields_needed': ['image_id', 'group_id', 'upload_id']}
                },
            },
            'moments': {
                'primary_key': 'moment_id',
                'accessible_table': 'accessible_moments',
                'fields': ['label', 'description', 'start', 'end', 'images_count', 'active_images_count', 'representative_image'],
                'representative': {'field': 'representative_image', 'table': 'images'},
                'relations': {
                    'images': {'relation_table': 'images', 'fields_needed': ['date_taken', 'is_archived', 'is_favorite', 'upload_id']},
                },
            },
            'albums': {
                'primary_key': 'album_id',
                'accessible_table': 'accessible_albums',
                'fields': ['label', 'description', 'images_count', 'active_images_count', 'representative_image'],
                'representative': {'field': 'representative_image', 'table': 'images'},
                'relations': {
                    'images': {'relation_table': 'albums_images', 'fields_needed': ['date_taken', 'is_archived', 'is_favorite']},
                },
            },
            'uploads': {
                'primary_key': 'upload_id',
                'accessible_table': 'accessible_uploads',
                'fields': ['started_at', 'completed_at', 'status', 'images_count', 'faces_count', 'clusters_count', 'moments_count', 'errors', 'notes', 'profile_id', 'profile_label'],
                'relations': {
                    'images': {'relation_table': 'images', 'fields_needed': ['date_taken', 'is_archived', 'is_favorite', 'moment_id']},
                    'faces': {'relation_table': 'uploads_faces', 'fields_needed': ['image_id', 'group_id', 'upload_id']},
                    'groups': {
                        'relation_table': 'uploads_groups',
                        'fields_needed': ['label', 'representative_face', 'faces_count'],
                        'relation_table_fields': ['group_faces_count', 'group_upload_faces_count']
                    },
                    'moments': {
                        'relation_table': 'uploads_moments',
                        'fields_needed': ['label', 'representative_image', 'images_count'],
                        'relation_table_fields': ['moment_images_count', 'moment_upload_images_count']
                    },
                },
                'serializable': {
                    'errors': list,
                }
            },
            'access_requests': {
                'primary_key': 'access_request_id',
                'accessible_table': 'accessible_access_requests',
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
                'accessible_table': 'accessible_access_requests_groups',
                'fields': ['approved', 'closed_at', 'closed_by'],
            },
            'my_access_requests': {
                'original_table': 'access_requests',
                'primary_key': 'access_request_id',
                'accessible_table': 'accessible_my_access_requests',
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
                ],
                'relations': {
                    'groups': {
                        'relation_table': 'my_access_requests_groups',
                        'fields_needed': ['label', 'representative_face'],
                        'relation_table_fields': ['approved', 'closed_at', 'closed_by']
                    },
                },
                'serializable': {
                    'closed_details': list,
                }
            },
            'my_access_requests_groups': {
                'original_table': 'access_requests_groups',
                'primary_key': ['access_request_id', 'group_id'],
                'accessible_table': 'accessible_my_access_requests_groups',
                'fields': ['approved', 'closed_at', 'closed_by'],
            },
            'albums_images_actual': {
                'original_table': 'albums_images',
                'primary_key': ['album_id', 'image_id'],
                'accessible_table': 'accessible_albums_images_actual',
            },

            # Relations tables
            'current_profile_events': {
                'primary_key': ['profile_id', 'event_id'],
                'accessible_table': 'current_profile_events',
            },
            # TODO: fix and remove this table
            'events_profiles2': {
                'original_table': 'events_profiles',
                'primary_key': ['event_id', 'profile_id'],
                'accessible_table': 'accessible_events_profiles',
                'fields': [],
            },
            'groups_images': {
                'primary_key': ['group_id', 'image_id'],
                'accessible_table': 'accessible_groups_images',
            },
            'albums_images': {
                'primary_key': ['album_id', 'image_id'],
                'accessible_table': 'accessible_albums_images',
            },
            'events_profiles_images': {
                'primary_key': ['profile_id', 'image_id'],
                'accessible_table': 'accessible_events_profiles_images',
            },
            'events_profiles_groups': {
                'primary_key': ['profile_id', 'group_id'],
                'accessible_table': 'accessible_events_profiles_groups',
            },
            'events_profiles_albums': {
                'primary_key': ['profile_id', 'album_id'],
                'accessible_table': 'accessible_events_profiles_albums',
            },
            'uploads_groups': {
                'primary_key': ['upload_id', 'group_id'],
                'accessible_table': 'accessible_uploads_groups',
            },
            'uploads_moments': {
                'primary_key': ['upload_id', 'moment_id'],
                'accessible_table': 'accessible_uploads_moments',
            },
            'uploads_faces': {
                'primary_key': ['upload_id', 'face_id'],
                'accessible_table': 'accessible_uploads_faces',
            },
        }
    
    @staticmethod
    def TABLES() -> dict:
        return {
            'settings': '''
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                developer_id TEXT,
                image_size_limit_bytes INTEGER DEFAULT 0,
                images_count_limit INTEGER DEFAULT 0,
                rekognition_calls_limit INTEGER DEFAULT 0,
                min_rank_to_create_event INTEGER DEFAULT 0,
                event_in_deletion TEXT DEFAULT NULL,
                FOREIGN KEY (developer_id) REFERENCES profiles(profile_id) ON DELETE SET NULL,
                FOREIGN KEY (event_in_deletion) REFERENCES events(event_id) ON DELETE SET NULL
            ''',
            'default_preferences': '''
                preference_group TEXT NOT NULL,
                preference_key TEXT NOT NULL,
                value_type TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (preference_group, preference_key)
            ''',
            # TODO: in postgres make create_at with default value of CURRENT_TIMESTAMP
            'events': '''
                event_id TEXT PRIMARY KEY NOT NULL,
                name TEXT COLLATE NOCASE UNIQUE NOT NULL,
                date TEXT,
                url TEXT COLLATE NOCASE UNIQUE NOT NULL,
                is_public INTEGER DEFAULT 0,
                images_count_limit INTEGER NOT NULL DEFAULT 0,
                image_size_limit_bytes INTEGER NOT NULL DEFAULT 0,
                rekognition_calls_limit INTEGER NOT NULL DEFAULT 0,
                rekognition_calls_used INTEGER NOT NULL DEFAULT 0,
                representative_image TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by TEXT,
                FOREIGN KEY (representative_image) REFERENCES images(image_id) ON DELETE SET NULL,
                FOREIGN KEY (created_by) REFERENCES profiles(profile_id) ON DELETE SET NULL
            ''',
            'profiles': '''
                profile_id TEXT PRIMARY KEY NOT NULL,
                label TEXT COLLATE NOCASE NOT NULL,
                email TEXT,
                password TEXT DEFAULT '',
                hierarchy_rank INTEGER DEFAULT 0 CHECK (hierarchy_rank >= 0),
                can_create_events INTEGER DEFAULT 0,
                restricted_to_event TEXT DEFAULT NULL,
                is_public INTEGER DEFAULT 0,
                public_access_code TEXT,
                FOREIGN KEY (restricted_to_event) REFERENCES events(event_id) ON DELETE SET NULL
            ''',
            'profiles_preferences': '''
                profile_id TEXT NOT NULL,
                preference_group TEXT NOT NULL,
                preference_key TEXT NOT NULL,
                preference_value TEXT NOT NULL,
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
                FOREIGN KEY (preference_group, preference_key) REFERENCES default_preferences(preference_group, preference_key) ON DELETE CASCADE,
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
            'notifications': '''
                notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                read INTEGER DEFAULT 0,
                read_at DATETIME,
                type TEXT,
                data TEXT,
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE
            ''',
            'feedbacks': '''
                feedback_id INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id TEXT,
                sender_name TEXT,
                sender_email TEXT,
                communication_consent INTEGER DEFAULT 0,
                title TEXT,
                type INTEGER DEFAULT 0,
                message TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                user_agent TEXT,
                ip_address TEXT,
                diagnostics TEXT,
                notes TEXT,
                is_closed INTEGER DEFAULT 0,
                solved INTEGER DEFAULT 0,
                closed_at DATETIME,
                closed_by TEXT,
                closed_details TEXT,
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
                FOREIGN KEY (closed_by) REFERENCES profiles(profile_id) ON DELETE SET NULL
            ''',
            'events_profiles': '''
                event_id TEXT,
                profile_id TEXT,
                can_manage_event BOOLEAN DEFAULT 0,
                can_delete_event BOOLEAN DEFAULT 0,
                can_upload_and_delete_images BOOLEAN DEFAULT 0,
                can_edit BOOLEAN DEFAULT 0,
                all_images BOOLEAN DEFAULT 0,
                all_groups BOOLEAN DEFAULT 0,
                all_albums BOOLEAN DEFAULT 0,
                FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
                PRIMARY KEY (event_id, profile_id)
            ''',
            'images': '''
                event_id TEXT NOT NULL,
                image_id TEXT PRIMARY KEY NOT NULL,
                label TEXT,
                date_taken TEXT,
                file_size INTEGER,
                high_quality_file_size INTEGER,
                display_file_size INTEGER,
                thumb_file_size INTEGER,
                width INTEGER,
                height INTEGER,
                moment_id TEXT,
                upload_id INTEGER,
                UNIQUE (event_id, label),
                FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
                FOREIGN KEY (moment_id) REFERENCES moments(moment_id) ON DELETE SET NULL,
                FOREIGN KEY (upload_id) REFERENCES uploads(upload_id) ON DELETE SET NULL
            ''',
            'faces': '''
                face_id TEXT PRIMARY KEY NOT NULL,
                image_id TEXT NOT NULL,
                width REAL,
                height REAL,
                left REAL,
                top REAL,
                file_size INTEGER,
                group_id TEXT NOT NULL,
                FOREIGN KEY (image_id) REFERENCES images(image_id) ON DELETE SET NULL,
                FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE RESTRICT
            ''',
            'groups': '''
                event_id TEXT NOT NULL,
                group_id TEXT PRIMARY KEY NOT NULL,
                label TEXT COLLATE NOCASE,
                representative_face TEXT,
                UNIQUE (event_id, label),
                FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
                FOREIGN KEY (representative_face) REFERENCES faces(face_id) ON DELETE SET NULL
            ''',
            'moments': '''
                event_id TEXT NOT NULL,
                moment_id TEXT PRIMARY KEY NOT NULL,
                label TEXT COLLATE NOCASE,
                description TEXT,
                start TEXT,
                end TEXT,
                representative_image TEXT,
                UNIQUE (event_id, label),
                FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
                FOREIGN KEY (representative_image) REFERENCES images(image_id) ON DELETE SET NULL
            ''',
            'albums': '''
                event_id TEXT NOT NULL,
                album_id TEXT PRIMARY KEY NOT NULL,
                label TEXT COLLATE NOCASE,
                description TEXT,
                representative_image TEXT,
                UNIQUE (event_id, label),
                FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
                FOREIGN KEY (representative_image) REFERENCES images(image_id) ON DELETE SET NULL
            ''',
            'albums_images': '''
                album_id TEXT NOT NULL,
                image_id TEXT NOT NULL,
                FOREIGN KEY (album_id) REFERENCES albums(album_id) ON DELETE CASCADE,
                FOREIGN KEY (image_id) REFERENCES images(image_id) ON DELETE CASCADE,
                PRIMARY KEY (album_id, image_id)
            ''',
            'events_profiles_images': '''
                event_id TEXT,
                profile_id TEXT,
                image_id TEXT,
                FOREIGN KEY (event_id, profile_id) REFERENCES events_profiles(event_id, profile_id) ON DELETE CASCADE,
                FOREIGN KEY (image_id) REFERENCES images(image_id) ON DELETE CASCADE,
                PRIMARY KEY (event_id, profile_id, image_id)
            ''',
            'events_profiles_groups': '''
                event_id TEXT,
                profile_id TEXT,
                group_id TEXT,
                FOREIGN KEY (event_id, profile_id) REFERENCES events_profiles(event_id, profile_id) ON DELETE CASCADE,
                FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE,
                PRIMARY KEY (event_id, profile_id, group_id)
            ''',
            'events_profiles_albums': '''
                event_id TEXT,
                profile_id TEXT,
                album_id TEXT,
                FOREIGN KEY (event_id, profile_id) REFERENCES events_profiles(event_id, profile_id) ON DELETE CASCADE,
                FOREIGN KEY (album_id) REFERENCES albums(album_id) ON DELETE CASCADE,
                PRIMARY KEY (event_id, profile_id, album_id)
            ''',
            'uploads': '''
                event_id TEXT,
                upload_id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME,
                status TEXT,
                images_count INTEGER,
                faces_count INTEGER,
                clusters_count INTEGER,
                moments_count INTEGER,
                errors TEXT,
                notes TEXT,
                profile_id TEXT,
                FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE SET NULL
            ''',
            'access_requests': '''
                event_id TEXT,
                access_request_id INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id TEXT NOT NULL,
                requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                applicant_name TEXT,
                applicant_email TEXT,
                applicant_phone TEXT,
                details TEXT,
                communication_consent BOOLEAN DEFAULT 0,
                is_closed BOOLEAN DEFAULT 0,
                closed_at DATETIME,
                closed_by TEXT,
                closed_details TEXT,
                applicant_profile_id TEXT,
                FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE SET NULL,
                FOREIGN KEY (closed_by) REFERENCES profiles(profile_id) ON DELETE SET NULL,
                FOREIGN KEY (applicant_profile_id) REFERENCES profiles(profile_id) ON DELETE SET NULL
            ''',
            'access_requests_groups': '''
                access_request_id INTEGER,
                group_id TEXT,
                approved BOOLEAN DEFAULT NULL,
                closed_at DATETIME,
                closed_by TEXT,
                closed_details TEXT,
                FOREIGN KEY (access_request_id) REFERENCES access_requests(access_request_id) ON DELETE CASCADE,
                FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE,
                FOREIGN KEY (closed_by) REFERENCES profiles(profile_id) ON DELETE SET NULL,
                PRIMARY KEY (access_request_id, group_id)
            ''',
        }
    
    @classmethod
    def INDEXES(self) -> list:
        return {
            'idx_events_name': 'events(name)',
            'idx_events_url': 'events(url)',
            'idx_events_representative_image': 'events(representative_image)',
            'idx_events_created_at': 'events(created_at)',
            'idx_events_created_by': 'events(created_by)',
            'idx_events_rekognition_calls_used': 'events(rekognition_calls_used)',
            'idx_profiles_label': 'profiles(label)',
            'idx_profiles_restricted_to_event': 'profiles(restricted_to_event)',
            'idx_profiles_public_access_code': 'profiles(public_access_code)',
            'idx_refresh_tokens_profile_id': 'refresh_tokens(profile_id)',
            'idx_refresh_tokens_token': 'refresh_tokens(token)',
            'idx_notifications_profile_id': 'notifications(profile_id)',
            'idx_notifications_notification_id': 'notifications(notification_id)',
            'idx_notifications_message': 'notifications(message)',
            'idx_notifications_read': 'notifications(read)',
            'idx_notifications_type': 'notifications(type)',
            'idx_feedbacks_profile_id': 'feedbacks(profile_id)',
            'idx_feedbacks_is_closed': 'feedbacks(is_closed)',
            'idx_feedbacks_type': 'feedbacks(type)',
            'idx_feedbacks_closed_by': 'feedbacks(closed_by)',
            'idx_feedbacks_solved': 'feedbacks(solved)',
            'idx_images_moment_id': 'images(moment_id)',
            'idx_images_upload_id': 'images(upload_id)',
            'idx_images_date_taken': 'images(date_taken)',
            'idx_faces_image_id': 'faces(image_id)',
            'idx_faces_group_id': 'faces(group_id)',
            'idx_faces_group_id_image_id': 'faces(group_id, image_id)',
            'idx_groups_representative_face': 'groups(representative_face)',
            'idx_moments_representative_image': 'moments(representative_image)',
            'idx_albums_representative_image': 'albums(representative_image)',
            'idx_uploads_profile_id': 'uploads(profile_id)',
            'idx_uploads_status': 'uploads(status)',
            'idx_uploads_started_at': 'uploads(started_at)',
            'idx_access_requests_profile_id': 'access_requests(profile_id)',
            'idx_access_requests_is_closed': 'access_requests(is_closed)',
            'idx_access_requests_requested_at': 'access_requests(requested_at)',
            'idx_access_requests_closed_by': 'access_requests(closed_by)',
            'idx_access_requests_applicant_profile_id': 'access_requests(applicant_profile_id)',
            'idx_access_requests_groups_approved': 'access_requests_groups(approved)',
            'idx_access_requests_groups_closed_by': 'access_requests_groups(closed_by)',
        }
    
    @classmethod
    def VIEWS(self) -> dict:
        return {
            # settings
            'accessible_settings': '''
                SELECT
                    s.*
                FROM settings s
                WHERE s.id = 1
                AND s.developer_id = cur_profile('profile_id')
            ''',

            # all profiles accessibility
            'albums_accessibility_helper': '''
                SELECT
                    a.event_id,
                    a.album_id,
                    ep.profile_id,
                    CASE WHEN
                        (ep.all_albums = 1 AND epa.album_id IS NULL)
                        OR (ep.all_albums = 0 AND epa.album_id IS NOT NULL)
                    THEN 1 ELSE 0 END AS is_accessible
                FROM albums a
                JOIN events_profiles ep ON a.event_id = ep.event_id
                LEFT JOIN events_profiles_albums epa ON
                    a.album_id = epa.album_id
                    AND ep.profile_id = epa.profile_id
                    AND a.album_id = epa.album_id
            ''',
            'images_accessibility': '''
                SELECT
                    i.event_id,
                    i.image_id,
                    ep.profile_id,
                    CASE WHEN
                        ((ep.all_images = 1 AND epi.image_id IS NULL)
                        OR (ep.all_images = 0 AND epi.image_id IS NOT NULL))
                        AND (aah.is_accessible = 1 OR aah.is_accessible IS NULL)
                    THEN 1 ELSE 0 END AS is_accessible
                FROM images i
                JOIN events_profiles ep ON i.event_id = ep.event_id
                LEFT JOIN events_profiles_images epi ON
                    i.image_id = epi.image_id
                    AND ep.profile_id = epi.profile_id
                    AND i.image_id = epi.image_id
                LEFT JOIN (
                    albums_images ai
                    INNER JOIN albums a ON
                        ai.album_id = a.album_id
                        AND LOWER(a.label) = 'archive'
                    INNER JOIN albums_accessibility_helper aah ON aah.album_id = ai.album_id
                ) ON i.image_id = ai.image_id AND aah.profile_id = ep.profile_id
            ''',
            'groups_accessibility_helper': '''
                SELECT
                    g.event_id,
                    g.group_id,
                    ep.profile_id,
                    CASE WHEN
                        ((ep.all_groups = 1 AND epg.group_id IS NULL)
                        OR (ep.all_groups = 0 AND epg.group_id IS NOT NULL))
                        AND (ep.can_edit = 1 OR LOWER(g.label) <> 'unassociated')
                    THEN 1 ELSE 0 END AS is_accessible_helper
                FROM groups g
                JOIN events_profiles ep ON g.event_id = ep.event_id
                LEFT JOIN events_profiles_groups epg ON
                    g.group_id = epg.group_id
                    AND ep.profile_id = epg.profile_id
                    AND g.group_id = epg.group_id
            ''',
            'faces_accessibility': '''
                SELECT
                    ep.event_id,
                    f.face_id,
                    ep.profile_id,
                    CASE WHEN
                        (ia.is_accessible = 1 AND gah.is_accessible_helper = 1)
                    THEN 1 ELSE 0 END AS is_accessible
                FROM faces f
                INNER JOIN images i ON f.image_id = i.image_id
                JOIN events_profiles ep ON i.event_id = ep.event_id
                INNER JOIN images_accessibility ia ON f.image_id = ia.image_id AND ia.profile_id = ep.profile_id
                INNER JOIN groups_accessibility_helper gah ON f.group_id = gah.group_id AND gah.profile_id = ep.profile_id
            ''',
            'groups_accessibility': '''
                SELECT
                    gah.event_id,
                    gah.group_id,
                    gah.profile_id,
                    CASE WHEN
                        gah.is_accessible_helper = 1
                        AND (ep.can_edit = 1 OR 
                            EXISTS (
                                SELECT 1
                                FROM faces_accessibility fa
                                INNER JOIN faces f ON fa.face_id = f.face_id
                                WHERE f.group_id = gah.group_id
                                AND fa.profile_id = gah.profile_id
                                AND fa.is_accessible = 1
                            )
                        )
                    THEN 1 ELSE 0 END AS is_accessible
                FROM groups_accessibility_helper gah
                JOIN events_profiles ep ON gah.event_id = ep.event_id AND gah.profile_id = ep.profile_id
            ''',
            'groups_to_request_access': '''
                SELECT
                    gah.event_id,
                    gah.profile_id,
                    gah.group_id
                FROM groups_accessibility_helper gah
                WHERE gah.is_accessible_helper = 0
                AND EXISTS (
                    SELECT 1
                    FROM groups_images gi
                    INNER JOIN images_accessibility ia ON
                        gi.image_id = ia.image_id
                        AND ia.event_id = gah.event_id
                        AND ia.profile_id = gah.profile_id
                        AND ia.is_accessible = 1
                    WHERE gi.group_id = gah.group_id
                )
            ''',
            'moments_accessibility': '''
                SELECT
                    ep.event_id,
                    m.moment_id,
                    ep.profile_id,
                    CASE WHEN
                        (ep.can_edit = 1 OR EXISTS (
                            SELECT 1
                            FROM images_accessibility ia
                            INNER JOIN images i ON i.image_id = ia.image_id
                            WHERE i.moment_id = m.moment_id
                            AND ia.profile_id = ep.profile_id
                            AND ia.is_accessible = 1
                        ))
                    THEN 1 ELSE 0 END AS is_accessible
                FROM moments m
                JOIN events_profiles ep ON m.event_id = ep.event_id
            ''',
            'albums_accessibility': '''
                SELECT
                    aah.event_id,
                    aah.album_id,
                    ep.profile_id,
                    CASE WHEN
                        aah.is_accessible = 1
                        AND (ep.can_edit = 1 OR EXISTS (
                            SELECT 1
                            FROM images_accessibility ia
                            INNER JOIN albums_images ai ON ai.image_id = ia.image_id
                            WHERE ai.album_id = aah.album_id
                            AND ia.profile_id = ep.profile_id
                            AND ia.is_accessible = 1
                        ))
                    THEN 1 ELSE 0 END AS is_accessible
                FROM albums_accessibility_helper aah
                JOIN events_profiles ep ON aah.event_id = ep.event_id AND aah.profile_id = ep.profile_id
            ''',

            # events
            'accessible_events': """
                SELECT
                    e.*,
                    (
                        SELECT COUNT(*)
                        FROM images_accessibility ia
                        WHERE ia.event_id = e.event_id
                        AND ia.profile_id = ep.profile_id
                        AND ia.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN ia.is_accessible ELSE 0 END
                    ) AS images_count,
                    (
                        SELECT SUM(i.file_size)
                        FROM images_accessibility ia
                        INNER JOIN images i ON i.image_id = ia.image_id
                        WHERE ia.event_id = e.event_id
                        AND ia.profile_id = ep.profile_id
                        AND ia.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN ia.is_accessible ELSE -1 END
                    ) AS total_original_size,
                    (
                        SELECT SUM(i.high_quality_file_size)
                        FROM images_accessibility ia
                        INNER JOIN images i ON i.image_id = ia.image_id
                        WHERE ia.event_id = e.event_id
                        AND ia.profile_id = ep.profile_id
                        AND ia.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN ia.is_accessible ELSE -1 END
                    ) AS total_high_quality_size,
                    (
                        SELECT SUM(i.file_size + i.high_quality_file_size + i.display_file_size + i.thumb_file_size)
                        FROM images_accessibility ia
                        INNER JOIN images i ON i.image_id = ia.image_id
                        WHERE ia.event_id = e.event_id
                        AND ia.profile_id = ep.profile_id
                        AND ia.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN ia.is_accessible ELSE -1 END
                    ) + (
                        SELECT SUM(f.file_size)
                        FROM faces_accessibility fa
                        INNER JOIN faces f ON f.face_id = fa.face_id
                        WHERE fa.event_id = e.event_id
                        AND fa.profile_id = ep.profile_id
                        AND fa.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN fa.is_accessible ELSE -1 END
                    ) AS total_size,
                    (
                        SELECT MAX(i.file_size)
                        FROM images_accessibility ia
                        INNER JOIN images i ON i.image_id = ia.image_id
                        WHERE ia.event_id = e.event_id
                        AND ia.profile_id = ep.profile_id
                        AND ia.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN ia.is_accessible ELSE -1 END
                    ) AS max_image_size,
                    (
                        SELECT COUNT(*)
                        FROM faces_accessibility fa
                        WHERE fa.event_id = e.event_id
                        AND fa.profile_id = ep.profile_id
                        AND fa.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN fa.is_accessible ELSE 0 END
                    ) AS faces_count,
                    (
                        SELECT COUNT(*)
                        FROM albums_accessibility aa
                        WHERE aa.event_id = e.event_id
                        AND aa.profile_id = ep.profile_id
                        AND aa.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN aa.is_accessible ELSE 0 END
                    ) AS albums_count,
                    (
                        SELECT COUNT(*)
                        FROM moments_accessibility ma
                        WHERE ma.event_id = e.event_id
                        AND ma.profile_id = ep.profile_id
                        AND ma.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN ma.is_accessible ELSE 0 END
                    ) AS moments_count
                FROM events e
                LEFT JOIN events_profiles ep ON
                    e.event_id = ep.event_id
                    AND ep.profile_id = cur_profile('profile_id')
                WHERE e.is_public = 1 OR ep.profile_id IS NOT NULL
            """,

            # profiles
            'accessible_profiles': """
                SELECT
                    p.*,
                    ae.name AS restricted_to_event_name,
                    CASE WHEN
                        cur_profile('restricted_to_event') IS NULL
                        OR cur_profile('restricted_to_event') = p.restricted_to_event
                    THEN 1 ELSE 0 END AS is_editable,
                    public_access_code IS NOT NULL AS has_public_access_code
                FROM profiles p
                LEFT JOIN accessible_events ae ON p.restricted_to_event = ae.event_id
                WHERE p.hierarchy_rank < cur_profile('hierarchy_rank')
                AND
                    (p.restricted_to_event IS NULL OR p.restricted_to_event IN (
                        SELECT event_id
                        FROM events_profiles ep
                        WHERE ep.profile_id = cur_profile('profile_id')
                    ))
            """,
            'my_preferences': """
                SELECT
                    pp.*,
                    dp.value_type
                FROM profiles_preferences pp
                INNER JOIN default_preferences dp
                ON pp.preference_group = dp.preference_group
                AND pp.preference_key = dp.preference_key
                WHERE pp.profile_id = cur_profile('profile_id')
            """,

            # current profile
            'current_groups_to_request_access': '''
                SELECT
                    gta.group_id
                FROM groups_to_request_access gta
                WHERE gta.event_id = cur_event_profile('event_id')
                AND gta.profile_id = cur_profile('profile_id')
            ''',
            'current_event_profile': '''
                SELECT
                    ep.event_id,
                    ep.profile_id,
                    can_manage_event,
                    can_delete_event,
                    can_upload_and_delete_images,
                    can_edit,
                    all_images,
                    all_groups,
                    all_albums,
                    CASE WHEN a1.album_id IS NOT NULL THEN 1 ELSE 0 END as has_archive_album,
                    CASE WHEN a2.album_id IS NOT NULL THEN 1 ELSE 0 END as has_favorites_album,
                    CASE WHEN
                        (all_images = 1 AND can_edit = 1)
                        OR EXISTS (
                            SELECT 1
                            FROM accessible_images ai
                        )
                    THEN 1 ELSE 0 END as has_images,
                    CASE WHEN
                        (all_groups = 1 AND can_edit = 1)
                        OR EXISTS (
                            SELECT 1
                            FROM accessible_groups g
                        )
                    THEN 1 ELSE 0 END as has_groups,
                    CASE WHEN
                        (all_albums = 1 AND can_edit = 1)
                        OR EXISTS (
                            SELECT 1
                            FROM accessible_albums aa
                            INNER JOIN albums a ON aa.album_id = a.album_id
                            WHERE LOWER(a.label) <> 'archive'
                            AND LOWER(a.label) <> 'favorites'
                        )
                    THEN 1 ELSE 0 END as has_albums,
                    CASE WHEN EXISTS (
                        SELECT 1
                        FROM current_groups_to_request_access cgtra
                    )
                    THEN 1 ELSE 0 END as enable_new_requests,
                    COUNT(DISTINCT aar.access_request_id) as pending_access_requests_count
                FROM events_profiles ep
                LEFT JOIN accessible_albums a1 ON LOWER(a1.label) = 'archive'
                LEFT JOIN accessible_albums a2 ON LOWER(a2.label) = 'favorites'
                LEFT JOIN accessible_access_requests aar ON aar.is_closed = 0
                LEFT JOIN current_groups_to_request_access cgtra
                WHERE ep.event_id = cur_event_profile('event_id')
                AND ep.profile_id = cur_profile('profile_id')
                GROUP BY ep.profile_id
            ''',
            'current_profile': """
                SELECT
                    p.profile_id,
                    p.label,
                    p.password,
                    p.email,
                    p.hierarchy_rank,
                    p.can_create_events,
                    p.restricted_to_event,
                    p.is_public,
                    p.hierarchy_rank > 0 AS is_profiles_manager,
                    p.hierarchy_rank > (SELECT min_rank_to_create_event FROM settings WHERE id = 1 LIMIT 1) AS can_manage_create_events,
                    COUNT(mn.notification_id) AS total_notifications,
                    COUNT(mn.notification_id) - COALESCE(SUM(mn.read), 0) AS unread_notifications,
                    (SELECT COUNT(*) FROM accessible_feedbacks WHERE is_closed = 0) AS pending_feedbacks,
                    CASE WHEN p.profile_id = (SELECT developer_id FROM settings WHERE id = 1 LIMIT 1) THEN 1 ELSE 0 END AS has_feedbacks,
                    CASE WHEN
                        p.profile_id = (SELECT developer_id FROM settings WHERE id = 1 LIMIT 1)
                    THEN 1 ELSE 0 END AS has_settings,
                    CASE WHEN
                        COALESCE(SUM(cpe.can_manage_event), 0) > 0
                        OR p.can_create_events = 1
                    THEN 1 ELSE 0 END AS has_manageable_events,
                    CASE WHEN
                        COALESCE(SUM(cpe.can_manage_event), 0) > 0
                        OR p.can_create_events = 1
                        OR p.profile_id = (SELECT developer_id FROM settings WHERE id = 1 LIMIT 1)
                    THEN 1 ELSE 0 END AS has_dashboard
                FROM profiles p
                LEFT JOIN my_notifications mn ON p.profile_id = mn.profile_id
                LEFT JOIN current_profile_events cpe ON p.profile_id = cpe.profile_id
                WHERE p.profile_id = cur_profile('profile_id')
                GROUP BY p.profile_id
            """,
            'current_profile_events': '''
                SELECT
                    ep.profile_id,
                    ep.event_id,
                    ep.can_manage_event,
                    ep.can_delete_event
                FROM events_profiles ep
                WHERE ep.profile_id = cur_profile('profile_id')
                GROUP BY ep.event_id
            ''',

            # event profiles
            'accessible_events_profiles': """
                SELECT ep.*
                FROM events_profiles ep
                INNER JOIN profiles p ON ep.profile_id = p.profile_id
                INNER JOIN accessible_events ae ON ep.event_id = ae.event_id
                WHERE p.hierarchy_rank < cur_profile('hierarchy_rank')
            """,
            'accessible_events_profiles_images': '''
                SELECT epi.*
                FROM events_profiles_images epi
                INNER JOIN accessible_events_profiles aep
                ON epi.profile_id = aep.profile_id
                AND aep.event_id = epi.event_id
                WHERE aep.event_id = cur_event_profile('event_id')
            ''',
            'accessible_events_profiles_groups': '''
                SELECT epg.*
                FROM events_profiles_groups epg
                INNER JOIN accessible_events_profiles aep
                ON epg.profile_id = aep.profile_id
                AND epg.event_id = aep.event_id
                WHERE aep.event_id = cur_event_profile('event_id')
            ''',
            'accessible_events_profiles_albums': '''
                SELECT epa.*
                FROM events_profiles_albums epa
                INNER JOIN accessible_events_profiles aep
                ON epa.profile_id = aep.profile_id
                AND epa.event_id = aep.event_id
                WHERE aep.event_id = cur_event_profile('event_id')
            ''',

            # notifications
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

            # feedbacks
            'feedbacks_details': """
                SELECT
                    fe.feedback_id,
                    fe.profile_id,
                    p.label AS profile_label,
                    p.is_public AS profile_is_public,
                    CASE WHEN p.is_public = 1 THEN fe.sender_name ELSE p.label END AS sender_name,
                    CASE WHEN p.is_public = 1 THEN fe.sender_email ELSE p.email END AS sender_email,
                    fe.communication_consent,
                    fe.title,
                    fe.type,
                    fe.message,
                    fe.created_at,
                    fe.user_agent,
                    fe.ip_address,
                    fe.diagnostics,
                    fe.notes,
                    fe.is_closed,
                    fe.solved,
                    fe.closed_at,
                    fe.closed_by,
                    fe.closed_details
                FROM feedbacks fe
                LEFT JOIN profiles p ON fe.profile_id = p.profile_id
            """,
            'my_feedbacks': """
                SELECT
                    feedback_id,
                    profile_id,
                    sender_name,
                    sender_email,
                    communication_consent,
                    title,
                    type,
                    message,
                    created_at,
                    is_closed,
                    closed_at,
                    closed_details,
                    user_agent,
                    ip_address,
                    diagnostics
                FROM feedbacks_details
                WHERE profile_id = cur_profile('profile_id')
            """,
            'accessible_my_feedbacks': """
                SELECT * FROM my_feedbacks
                INNER JOIN current_profile cp ON my_feedbacks.profile_id = cp.profile_id
                WHERE cp.is_public = 0
            """,
            'accessible_feedbacks': """
                SELECT
                    *,
                    p.label AS closed_by_label
                FROM feedbacks_details fe
                LEFT JOIN profiles p ON fe.closed_by = p.profile_id
                WHERE cur_profile('profile_id') = (SELECT developer_id FROM settings WHERE id = 1 LIMIT 1)
            """,

            # images
            'accessible_images': '''
                SELECT
                    i.*,
                    a1.album_id IS NOT NULL AS is_archived,
                    a2.album_id IS NOT NULL AS is_favorite
                FROM images i
                INNER JOIN images_accessibility ia ON i.image_id = ia.image_id
                LEFT JOIN (
                    albums_accessibility aa1
                    INNER JOIN albums a1 ON aa1.album_id = a1.album_id
                    INNER JOIN albums_images ai1 ON
                        aa1.album_id = ai1.album_id
                        AND LOWER(a1.label) = 'archive'
                        AND aa1.event_id = cur_event_profile('event_id')
                        AND aa1.profile_id = cur_profile('profile_id')
                        AND aa1.is_accessible = 1
                ) ON ai1.image_id = ia.image_id
                LEFT JOIN (
                    albums_accessibility aa2
                    INNER JOIN albums a2 ON aa2.album_id = a2.album_id
                    INNER JOIN albums_images ai2 ON
                        aa2.album_id = ai2.album_id
                        AND LOWER(a2.label) = 'favorites'
                        AND aa2.event_id = cur_event_profile('event_id')
                        AND aa2.profile_id = cur_profile('profile_id')
                        AND aa2.is_accessible = 1
                ) ON ai2.image_id = ia.image_id
                WHERE
                    ia.event_id = cur_event_profile('event_id')
                    AND ia.profile_id = cur_profile('profile_id')
                    AND ia.is_accessible = 1
            ''',

            # faces
            'accessible_faces': '''
                SELECT
                    f.*,
                    i.upload_id
                FROM faces f 
                INNER JOIN images i ON f.image_id = i.image_id
                INNER JOIN faces_accessibility fa ON
                    f.face_id = fa.face_id
                    AND fa.profile_id = cur_profile('profile_id')
                    AND fa.is_accessible = 1
                    AND fa.event_id = cur_event_profile('event_id')
                    AND fa.is_accessible = 1
            ''',

            # groups
            'groups_images': '''
                SELECT
                    i.image_id as image_id,
                    g.group_id as group_id
                FROM images i
                INNER JOIN faces f ON i.image_id = f.image_id
                INNER JOIN groups g ON f.group_id = g.group_id
                GROUP BY i.image_id, g.group_id
            ''',
            'accessible_groups_images': '''
                SELECT
                    ai.image_id as image_id,
                    af.group_id as group_id
                FROM accessible_images ai
                INNER JOIN accessible_faces af ON ai.image_id = af.image_id
                INNER JOIN groups_accessibility ga ON
                    af.group_id = ga.group_id
                    AND ga.profile_id = cur_profile('profile_id')
                    AND ga.is_accessible = 1
                    AND ga.event_id = cur_event_profile('event_id')
                GROUP BY ai.image_id, af.group_id
            ''',
            'accessible_groups': '''
                SELECT 
                    g.*,
                    rf.image_id as representative_image,
                    COUNT(DISTINCT af.face_id) AS faces_count,
                    COUNT(DISTINCT agi.image_id) AS images_count,
                    COUNT(DISTINCT CASE WHEN ai.is_archived = 0 THEN agi.image_id END) AS active_images_count
                FROM (
                    groups g
                    LEFT JOIN faces rf ON g.representative_face = rf.face_id
                )
                INNER JOIN groups_accessibility ga ON
                    g.group_id = ga.group_id
                    AND ga.profile_id = cur_profile('profile_id')
                    AND ga.is_accessible = 1
                    AND ga.event_id = cur_event_profile('event_id')
                LEFT JOIN (
                    accessible_groups_images agi
                    INNER JOIN accessible_images ai ON agi.image_id = ai.image_id
                ) ON g.group_id = agi.group_id
                LEFT JOIN accessible_faces af ON af.group_id = g.group_id
                GROUP BY g.group_id
            ''',

            # moments
            'accessible_moments': '''
                SELECT m.*,
                COUNT(ai.image_id) as images_count,
                COUNT(ai.image_id) - COALESCE(SUM(ai.is_archived), 0) AS active_images_count
                FROM moments m
                INNER JOIN moments_accessibility ma ON m.moment_id = ma.moment_id
                LEFT JOIN accessible_images ai ON ma.moment_id = ai.moment_id
                WHERE
                    ma.event_id = cur_event_profile('event_id')
                    AND ma.profile_id = cur_profile('profile_id')
                    AND ma.is_accessible = 1
                GROUP BY m.moment_id
            ''',

            # albums
            'albums_images_actual': '''
                SELECT albums_images.*
                FROM albums_images
                INNER JOIN albums ON albums_images.album_id = albums.album_id
                WHERE LOWER(albums.label) != 'archive' and LOWER(albums.label) != 'favorites'
                AND albums.event_id = cur_event_profile('event_id')
            ''',
            'accessible_albums_images': '''
                SELECT ali.*
                FROM albums_images ali
                INNER JOIN accessible_images ai ON ali.image_id = ai.image_id
                INNER JOIN albums_accessibility aa ON ali.album_id = aa.album_id
                WHERE
                    aa.event_id = cur_event_profile('event_id')
                    AND aa.profile_id = cur_profile('profile_id')
                    AND aa.is_accessible = 1
            ''',
            'accessible_albums_images_actual': '''
                SELECT aia.*
                FROM albums_images_actual aia
                INNER JOIN accessible_images ai ON aia.image_id = ai.image_id
                INNER JOIN albums_accessibility aa ON aia.album_id = aa.album_id
                WHERE
                    aa.event_id = cur_event_profile('event_id')
                    AND aa.profile_id = cur_profile('profile_id')
                    AND aa.is_accessible = 1
            ''',
            'accessible_albums': '''
                SELECT a.*,
                COUNT(ai.image_id) as images_count,
                COUNT(ai.image_id) - COALESCE(SUM(ai.is_archived), 0) AS active_images_count
                FROM albums a
                INNER JOIN albums_accessibility aa ON a.album_id = aa.album_id
                LEFT JOIN (
                    accessible_albums_images aai
                    INNER JOIN accessible_images ai ON aai.image_id = ai.image_id
                ) ON aa.album_id = aai.album_id
                WHERE
                    aa.event_id = cur_event_profile('event_id')
                    AND aa.profile_id = cur_profile('profile_id')
                    AND aa.is_accessible = 1
                GROUP BY aa.album_id
            ''',

            # uploads
            'uploads_details': '''
                SELECT
                    u.*,
                    p.label AS profile_label
                FROM uploads u
                INNER JOIN profiles p ON u.profile_id = p.profile_id
                WHERE u.event_id = cur_event_profile('event_id')
            ''',
            'accessible_uploads': '''
                SELECT u.*
                FROM uploads_details u
                WHERE cur_event_profile('can_upload_and_delete_images') = 1
            ''',
            'uploads_groups': '''
                SELECT u.*,
                g.group_id as group_id
                FROM uploads u
                INNER JOIN images i ON u.upload_id = i.upload_id
                INNER JOIN faces f ON i.image_id = f.image_id
                INNER JOIN groups g ON f.group_id = g.group_id
                WHERE u.event_id = cur_event_profile('event_id')
                GROUP BY u.upload_id, g.group_id
            ''',
            'accessible_uploads_groups': '''
                SELECT u.*,
                g.group_id as group_id,
                g.faces_count as group_faces_count,
                COUNT(DISTINCT f.face_id) as group_upload_faces_count
                FROM accessible_uploads u
                INNER JOIN accessible_images i ON u.upload_id = i.upload_id
                INNER JOIN accessible_faces f ON i.image_id = f.image_id
                INNER JOIN accessible_groups g ON f.group_id = g.group_id
                GROUP BY u.upload_id, g.group_id
            ''',
            'uploads_moments': '''
                SELECT u.*, m.moment_id as moment_id
                FROM uploads u
                INNER JOIN images i ON u.upload_id = i.upload_id
                INNER JOIN moments m ON i.moment_id = m.moment_id
                WHERE u.event_id = cur_event_profile('event_id')
                GROUP BY u.upload_id, m.moment_id
            ''',
            'accessible_uploads_moments': '''
                SELECT u.*,
                m.moment_id as moment_id,
                m.images_count as moment_images_count,
                COUNT(DISTINCT i.image_id) as moment_upload_images_count
                FROM accessible_uploads u
                INNER JOIN accessible_images i ON u.upload_id = i.upload_id
                INNER JOIN accessible_moments m ON i.moment_id = m.moment_id
                GROUP BY u.upload_id, m.moment_id
            ''',
            'uploads_faces': '''
                SELECT u.upload_id, f.face_id, f.group_id
                FROM uploads u
                INNER JOIN images i ON u.upload_id = i.upload_id
                INNER JOIN faces f ON i.image_id = f.image_id
                WHERE u.event_id = cur_event_profile('event_id')
            ''',
            'accessible_uploads_faces': '''
                SELECT u.upload_id, f.face_id, f.group_id
                FROM accessible_uploads u
                INNER JOIN accessible_images i ON u.upload_id = i.upload_id
                INNER JOIN accessible_faces f ON i.image_id = f.image_id
            ''',

            # access requests
            'access_requests_groups_details': '''
                SELECT arg.*,
                ga.is_accessible
                FROM access_requests_groups arg
                INNER JOIN groups_accessibility ga ON
                    arg.group_id = ga.group_id
                    AND ga.profile_id = cur_profile('profile_id')
                    AND ga.event_id = cur_event_profile('event_id')
            ''',
            'access_requests_details': '''
                SELECT
                    ar.*,
                    p.label AS profile_label,
                    COUNT(argd.group_id) AS groups_count,
                    COALESCE(SUM(argd.is_accessible), 0) AS accessible_groups_count,
                    COALESCE(SUM(argd.approved), 0) AS approved_groups_count,
                    SUM(1 - COALESCE(argd.approved, 1)) AS rejected_groups_count,
                    SUM(argd.approved IS NULL) AS pending_groups_count,
                    CASE 
                        WHEN
                            ar.is_closed = 0
                        THEN
                            'pending'
                        ELSE
                            (CASE
                                WHEN
                                    COALESCE(SUM(argd.approved), 0) = COUNT(argd.group_id)
                                THEN
                                    'approved'
                                WHEN
                                    COALESCE(SUM(argd.approved), 0) = 0
                                THEN
                                    'rejected'
                                ELSE
                                    'mixed'
                            END)
                    END AS status
                FROM access_requests ar
                INNER JOIN profiles p ON ((ar.profile_id = p.profile_id AND ar.applicant_profile_id IS NULL) OR ar.applicant_profile_id = p.profile_id)
                LEFT JOIN access_requests_groups_details argd ON ar.access_request_id = argd.access_request_id
                WHERE ar.event_id = cur_event_profile('event_id')
                GROUP BY ar.access_request_id
            ''',
            'my_access_requests': '''
                SELECT ard.*
                FROM access_requests_details ard
                WHERE ard.applicant_profile_id = cur_profile('profile_id')
            ''',
            'accessible_my_access_requests': '''
                SELECT mar.*
                FROM my_access_requests mar
                INNER JOIN current_profile cp ON mar.applicant_profile_id = cp.profile_id
                WHERE cp.is_public = 0
            ''',
            'my_access_requests_groups': '''
                SELECT argd.*
                FROM access_requests_groups_details argd
                INNER JOIN my_access_requests mar ON argd.access_request_id = mar.access_request_id;
            ''',
            'accessible_my_access_requests_groups': '''
                SELECT marg.*
                FROM my_access_requests_groups marg
            ''',
            'accessible_access_requests': '''
                SELECT ard.*
                FROM access_requests_details ard
                INNER JOIN accessible_profiles ap ON ard.profile_id = ap.profile_id AND ap.profile_id <> cur_profile('profile_id')
                WHERE ard.accessible_groups_count > 0 OR ard.groups_count = 0
            ''',
            'accessible_access_requests_groups': '''
                SELECT ag.*
                FROM access_requests_groups ag
                INNER JOIN accessible_access_requests ar ON ag.access_request_id = ar.access_request_id
                INNER JOIN groups_accessibility ga ON
                    ag.group_id = ga.group_id
                    AND ga.profile_id = cur_profile('profile_id')
                    AND ga.is_accessible = 1
                    AND ga.event_id = cur_event_profile('event_id')
            ''',
            'ensure_access_requests_closed': '''
                SELECT *
                FROM access_requests
            ''',

            # uuid
            'uuid': '''
                SELECT LOWER(
                substr(hex(randomblob(16)), 1, 8) || '-' ||
                substr(hex(randomblob(16)), 9, 4) || '-' ||
                substr(hex(randomblob(16)), 13, 4) || '-' ||
                substr(hex(randomblob(16)), 17, 4) || '-' ||
                substr(hex(randomblob(16)), 21, 12)
            ) AS uuid
            ''',
        }
    
    @staticmethod
    def TRIGGERS() -> dict:
        return {
            # settings
            'trg_accessible_settings_update': """
                INSTEAD OF UPDATE ON accessible_settings
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('profile_id') <> (SELECT developer_id FROM settings WHERE id = 1 LIMIT 1) THEN
                            RAISE(ABORT, 'Permission denied: only developer can update settings')
                    END;

                    UPDATE settings SET
                        image_size_limit_bytes = NEW.image_size_limit_bytes,
                        images_count_limit = NEW.images_count_limit,
                        min_rank_to_create_event = NEW.min_rank_to_create_event,
                        rekognition_calls_limit = NEW.rekognition_calls_limit
                    WHERE id = 1;
                END;
            """,

            # events
            'trg_accessible_events_insert': """
                INSTEAD OF INSERT ON accessible_events
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('can_create_events') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot create event')
                    END;

                    INSERT INTO events (
                        event_id,
                        name,
                        date,
                        url,
                        is_public,
                        images_count_limit,
                        image_size_limit_bytes,
                        representative_image,
                        created_at,
                        created_by,
                        rekognition_calls_limit
                    )
                    VALUES (
                        NEW.event_id,
                        NEW.name,
                        NEW.date,
                        NEW.url,
                        COALESCE(NEW.is_public, 0),
                        COALESCE(NEW.images_count_limit, 0),
                        COALESCE(NEW.image_size_limit_bytes, NULL),
                        NEW.representative_image,
                        COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
                        cur_profile('profile_id'),
                        (SELECT rekognition_calls_limit FROM settings WHERE id = 1 LIMIT 1)
                    );

                    INSERT OR IGNORE INTO events_profiles (
                        profile_id,
                        event_id,
                        can_manage_event,
                        can_delete_event,
                        can_upload_and_delete_images,
                        can_edit,
                        all_images,
                        all_groups,
                        all_albums
                    )
                    VALUES (cur_profile('profile_id'), NEW.event_id, 1, 1, 1, 1, 1, 1, 1);
                END;
            """,
            'trg_accessible_events_update': """
                INSTEAD OF UPDATE ON accessible_events
                BEGIN
                    SELECT CASE
                        WHEN (
                            SELECT can_manage_event
                            FROM events_profiles
                            WHERE profile_id = cur_profile('profile_id') AND event_id = OLD.event_id
                        ) = 0
                        THEN
                            RAISE(ABORT, 'Permission denied: cannot manage event')
                        WHEN NEW.rekognition_calls_limit <> (
                            SELECT rekognition_calls_limit FROM settings WHERE id = 1 LIMIT 1
                        ) AND cur_profile('profile_id') <> (
                            SELECT developer_id FROM settings WHERE id = 1 LIMIT 1
                        )
                        THEN
                            RAISE(ABORT, 'Permission denied: cannot update rekognition calls limit')
                    END;

                    UPDATE events SET
                        name = NEW.name,
                        date = NEW.date,
                        url = NEW.url,
                        is_public = NEW.is_public,
                        images_count_limit = NEW.images_count_limit,
                        image_size_limit_bytes = NEW.image_size_limit_bytes,
                        representative_image = NEW.representative_image,
                        rekognition_calls_limit = NEW.rekognition_calls_limit
                    WHERE event_id = OLD.event_id;
                END;
            """,
            'trg_accessible_events_delete': """
                INSTEAD OF DELETE ON accessible_events
                BEGIN
                    SELECT CASE
                        WHEN (
                            SELECT can_delete_event
                            FROM events_profiles
                            WHERE event_id = OLD.event_id AND profile_id = cur_profile('profile_id')
                        ) = 0
                        THEN
                            RAISE(ABORT, 'Permission denied: cannot delete event')
                    END;

                    DELETE FROM events
                    WHERE event_id = OLD.event_id;
                END;
            """,

            # current_profile
            'trg_current_profile_update': """
                INSTEAD OF UPDATE ON current_profile
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('is_public') = 1 THEN
                            RAISE(ABORT, 'Permission denied: cannot update current profile to a public profile')
                    END;

                    UPDATE profiles SET
                        label = NEW.label,
                        email = NEW.email,
                        password = NEW.password
                    WHERE profile_id = cur_profile('profile_id');
                END;
            """,

            # accessible_profiles
            'trg_accessible_profiles_insert': """
                INSTEAD OF INSERT ON accessible_profiles
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN NEW.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                            RAISE(ABORT, 'Permission denied: cannot create profile with higher or equal rank')
                        WHEN NEW.can_create_events = 1 AND cur_profile('hierarchy_rank') <= (
                            SELECT min_rank_to_create_event FROM settings WHERE id = 1 LIMIT 1
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile dose not have permission to manage create events permissions')
                        WHEN NEW.restricted_to_event IS NOT NULL AND cur_profile('restricted_to_event') <> COALESCE(NEW.restricted_to_event, '') THEN
                            RAISE(ABORT, 'Permission denied: cannot create profile to a different event than the current profile')
                        WHEN NEW.restricted_to_event IS NOT NULL AND NEW.restricted_to_event NOT IN (SELECT event_id FROM accessible_events) THEN
                            RAISE(ABORT, 'Permission denied: the event is not accessible')
                    END;

                    INSERT INTO profiles (profile_id, label, email, password, hierarchy_rank, can_create_events, restricted_to_event, is_public)
                    VALUES (
                        NEW.profile_id,
                        NEW.label,
                        NEW.email,
                        NEW.password,
                        COALESCE(NEW.hierarchy_rank, 0),
                        COALESCE(NEW.can_create_events, 0),
                        NEW.restricted_to_event,
                        COALESCE(NEW.is_public, 0)
                    );
                END;
            """,
            'trg_accessible_profiles_update': """
                INSTEAD OF UPDATE ON accessible_profiles
                BEGIN
                    SELECT CASE
                        WHEN OLD.profile_id NOT IN (
                            SELECT profile_id FROM accessible_profiles ap
                            WHERE ap.profile_id = OLD.profile_id
                            AND ap.is_editable = 1
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible')
                        WHEN NEW.hierarchy_rank >= cur_profile('hierarchy_rank') AND NEW.profile_id <> cur_profile('profile_id') THEN
                            RAISE(ABORT, 'Permission denied: cannot update profile to a higher or equal rank than the current profile')
                        WHEN
                            NEW.can_create_events = 1 AND OLD.can_create_events = 0
                            AND cur_profile('hierarchy_rank') <= (
                                SELECT min_rank_to_create_event FROM settings WHERE id = 1 LIMIT 1
                            )
                        THEN
                            RAISE(ABORT, 'Permission denied: the profile dose not have permission to manage create events permissions')
                        WHEN NEW.restricted_to_event IS NOT NULL AND cur_profile('restricted_to_event') <> COALESCE(NEW.restricted_to_event, '') THEN
                            RAISE(ABORT, 'Permission denied: cannot update profile to a different event than the current profile')
                        WHEN NEW.restricted_to_event IS NOT NULL AND NEW.restricted_to_event NOT IN (SELECT event_id FROM accessible_events) THEN
                            RAISE(ABORT, 'Permission denied: the event is not accessible')
                    END;

                    UPDATE profiles SET
                        label = NEW.label,
                        email = NEW.email,
                        password = NEW.password,
                        hierarchy_rank = NEW.hierarchy_rank,
                        can_create_events = NEW.can_create_events,
                        restricted_to_event = NEW.restricted_to_event,
                        is_public = NEW.is_public,
                        public_access_code = NEW.public_access_code
                    WHERE profile_id = OLD.profile_id;
                END;
            """,
            'trg_accessible_profiles_delete': """
                INSTEAD OF DELETE ON accessible_profiles
                BEGIN
                    SELECT CASE
                        WHEN OLD.profile_id NOT IN (
                            SELECT profile_id FROM accessible_profiles ap
                            WHERE ap.profile_id = OLD.profile_id
                            AND ap.is_editable = 1
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible')
                        WHEN EXISTS (
                            SELECT 1
                            FROM events_profiles ep
                            WHERE ep.profile_id = OLD.profile_id
                        ) THEN
                            RAISE(ABORT, 'Policy error: the profile is associated with an event. Please remove the profile from all events first.')
                    END;

                    DELETE FROM profiles
                    WHERE profile_id = OLD.profile_id;
                END;
            """,

            # my_preferences
            'trg_my_preferences_update': """
                INSTEAD OF UPDATE ON my_preferences
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('profile_id') <> OLD.profile_id THEN
                            RAISE(ABORT, 'Permission denied: cannot update preferences for another profile')
                    END;

                    UPDATE profiles_preferences SET
                        preference_value = NEW.preference_value
                    WHERE profile_id = OLD.profile_id AND preference_group = OLD.preference_group AND preference_key = OLD.preference_key;
                END;
            """,

            # notifications
            'trg_accessible_notifications_insert': """
                INSTEAD OF INSERT ON accessible_notifications
                BEGIN
                    SELECT CASE
                        WHEN NEW.profile_id NOT IN (
                            SELECT profile_id FROM accessible_profiles
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible')
                    END;

                    INSERT INTO notifications (profile_id, message, created_at, read, type, data)
                    VALUES (NEW.profile_id, NEW.message, COALESCE(NEW.created_at, CURRENT_TIMESTAMP), COALESCE(NEW.read, 0), NEW.type, NEW.data);
                END;
            """,
            
            # my_notifications
            'trg_accessible_my_notifications_update': """
                INSTEAD OF UPDATE ON accessible_my_notifications
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('profile_id') <> OLD.profile_id THEN
                            RAISE(ABORT, 'Permission denied: the notification is not accessible')
                    END;

                    UPDATE notifications SET
                        read = COALESCE(NEW.read, read),
                        read_at = COALESCE(NEW.read_at, CURRENT_TIMESTAMP)
                    WHERE notification_id = OLD.notification_id;
                END;
            """,
            'trg_accessible_my_notifications_delete': """
                INSTEAD OF DELETE ON accessible_my_notifications
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('profile_id') <> OLD.profile_id THEN
                            RAISE(ABORT, 'Permission denied: the notification is not accessible')
                    END;

                    DELETE FROM notifications
                    WHERE notification_id = OLD.notification_id;
                END;
            """,

            # my_feedbacks
            'trg_accessible_my_feedbacks_insert': """
                INSTEAD OF INSERT ON accessible_my_feedbacks
                BEGIN
                    SELECT CASE
                        WHEN NEW.profile_id <> cur_profile('profile_id') THEN
                            RAISE(ABORT, 'Permission denied: cannot create feedback for another profile')
                    END;

                    INSERT INTO feedbacks (
                        profile_id,
                        sender_name,
                        sender_email,
                        communication_consent,
                        title,
                        type,
                        message,
                        created_at,
                        user_agent,
                        ip_address,
                        diagnostics
                    )
                    VALUES (
                        NEW.profile_id,
                        NEW.sender_name,
                        NEW.sender_email,
                        COALESCE(NEW.communication_consent, 0),
                        NEW.title,
                        COALESCE(NEW.type, 0),
                        NEW.message,
                        COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
                        NEW.user_agent,
                        NEW.ip_address,
                        NEW.diagnostics
                    );
                
                    INSERT INTO notifications (
                        profile_id,
                        message,
                        created_at,
                        read,
                        type,
                        data
                    )
                    SELECT
                        developer_id,
                        'New feedback received',
                        CURRENT_TIMESTAMP,
                        0,
                        'feedback',
                        last_insert_rowid()
                    FROM settings
                    WHERE settings.id = 1;
                END;
            """,
            'trg_accessible_my_feedbacks_update': """
                INSTEAD OF UPDATE ON accessible_my_feedbacks
                BEGIN
                    SELECT CASE
                        WHEN OLD.profile_id <> cur_profile('profile_id') THEN
                            RAISE(ABORT, 'Permission denied: cannot update feedback for another profile')
                        WHEN cur_profile('is_public') = 1 THEN
                            RAISE(ABORT, 'Permission denied: the feedback is not accessible')
                        WHEN OLD.is_closed = 1 THEN
                            RAISE(ABORT, 'Permission denied: cannot update closed feedback')
                    END;

                    UPDATE feedbacks SET
                        title = NEW.title,
                        type = NEW.type,
                        message = NEW.message,
                        communication_consent = NEW.communication_consent
                    WHERE feedback_id = OLD.feedback_id;
                END;
            """,
            'trg_accessible_my_feedbacks_delete': """
                INSTEAD OF DELETE ON accessible_my_feedbacks
                BEGIN
                    SELECT CASE
                        WHEN OLD.profile_id <> cur_profile('profile_id') THEN
                            RAISE(ABORT, 'Permission denied: cannot delete feedback for another profile')
                        WHEN cur_profile('is_public') = 1 THEN
                            RAISE(ABORT, 'Permission denied: the feedback is not accessible')
                        WHEN OLD.is_closed = 1 THEN
                            RAISE(ABORT, 'Permission denied: cannot delete closed feedback')
                    END;

                    DELETE FROM feedbacks
                    WHERE feedback_id = OLD.feedback_id;
                END;
            """,

            # accessible_feedbacks
            'trg_accessible_feedbacks_update': """
                INSTEAD OF UPDATE ON accessible_feedbacks
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('profile_id') <> (SELECT developer_id FROM settings WHERE id = 1 LIMIT 1) THEN
                            RAISE(ABORT, 'Permission denied: only developer can update feedbacks')
                    END;

                    UPDATE feedbacks SET
                        type = NEW.type,
                        notes = NEW.notes,
                        is_closed = NEW.is_closed,
                        solved = NEW.solved,
                        closed_at = COALESCE(NEW.closed_at, CURRENT_TIMESTAMP),
                        closed_by = cur_profile('profile_id'),
                        closed_details = NEW.closed_details
                    WHERE feedback_id = OLD.feedback_id;

                    INSERT INTO notifications (
                        profile_id,
                        message,
                        created_at,
                        read,
                        type,
                        data
                    )
                    SELECT
                        p.profile_id,
                        'Your feedback has been updated',
                        CURRENT_TIMESTAMP,
                        0,
                        'my_feedback',
                        feedback_id
                    FROM feedbacks
                    INNER JOIN profiles p ON feedbacks.profile_id = p.profile_id
                    WHERE feedback_id = OLD.feedback_id
                    AND NEW.is_closed = 1
                    AND p.is_public = 0;
                END;
            """,
            'trg_accessible_feedbacks_delete': """
                INSTEAD OF DELETE ON accessible_feedbacks
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('profile_id') <> (SELECT developer_id FROM settings WHERE id = 1 LIMIT 1) THEN
                            RAISE(ABORT, 'Permission denied: only developer can delete feedbacks')
                    END;

                    DELETE FROM feedbacks
                    WHERE feedback_id = OLD.feedback_id;
                END;
            """,

            # accessible_events_profiles
            'trg_insert_accessible_events_profiles': """
                INSTEAD OF INSERT ON accessible_events_profiles
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN NEW.profile_id NOT IN (
                            SELECT profile_id
                            FROM accessible_profiles ap
                            WHERE ap.is_editable = 1
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible')
                        WHEN NEW.all_images = 1 and cur_event_profile('all_images') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot create profile with all_images=1 if current profile does not have all_images=1')
                        WHEN NEW.all_groups = 1 and cur_event_profile('all_groups') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot create profile with all_groups=1 if current profile does not have all_groups=1')
                        WHEN NEW.all_albums = 1 and cur_event_profile('all_albums') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot create profile with all_albums=1 if current profile does not have all_albums=1')
                    END;

                    INSERT INTO events_profiles (
                        profile_id,
                        event_id,
                        can_manage_event,
                        can_delete_event,
                        can_upload_and_delete_images,
                        can_edit,
                        all_images,
                        all_groups,
                        all_albums
                    )
                    VALUES (
                        NEW.profile_id,
                        cur_event_profile('event_id'),
                        COALESCE(NEW.can_manage_event, 0),
                        COALESCE(NEW.can_delete_event, 0),
                        COALESCE(NEW.can_upload_and_delete_images, 0),
                        COALESCE(NEW.can_edit, 0),
                        COALESCE(NEW.all_images, 0),
                        COALESCE(NEW.all_groups, 0),
                        COALESCE(NEW.all_albums, 0)
                    );

                    -- Create the events_profiles_images and events_profiles_groups and events_profiles_albums tables
                    -- TODO: use IF
                    INSERT INTO events_profiles_images (event_id, profile_id, image_id)
                    SELECT epi.event_id, NEW.profile_id, epi.image_id
                    FROM events_profiles_images epi
                    INNER JOIN events_profiles ep ON epi.event_id = ep.event_id AND epi.profile_id = ep.profile_id
                    WHERE epi.event_id = cur_event_profile('event_id')
                    AND ep.profile_id = cur_profile('profile_id')
                    AND ep.all_images = 1;

                    INSERT INTO events_profiles_groups (event_id, profile_id, group_id)
                    SELECT epg.event_id, NEW.profile_id, epg.group_id
                    FROM events_profiles_groups epg
                    INNER JOIN events_profiles ep ON epg.event_id = ep.event_id AND epg.profile_id = ep.profile_id
                    WHERE epg.event_id = cur_event_profile('event_id')
                    AND ep.profile_id = cur_profile('profile_id')
                    AND ep.all_groups = 1;
                    
                    INSERT INTO events_profiles_albums (event_id, profile_id, album_id)
                    SELECT epa.event_id, NEW.profile_id, epa.album_id
                    FROM events_profiles_albums epa
                    INNER JOIN events_profiles ep ON epa.event_id = ep.event_id AND epa.profile_id = ep.profile_id
                    WHERE epa.event_id = cur_event_profile('event_id')
                    AND ep.profile_id = cur_profile('profile_id')
                    AND ep.all_albums = 1;

                END;
            """,
            'trg_update_accessible_events_profiles': """
                INSTEAD OF UPDATE ON accessible_events_profiles
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN OLD.profile_id NOT IN (
                            SELECT profile_id
                            FROM accessible_events_profiles
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible')
                        WHEN NEW.all_images = 1 AND OLD.all_images = 0 AND cur_event_profile('all_images') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot set profile all_images=1 if current profile does not have all_images=1')
                        WHEN NEW.all_groups = 1 AND OLD.all_groups = 0 AND cur_event_profile('all_groups') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot set profile all_groups=1 if current profile does not have all_groups=1')
                        WHEN NEW.all_albums = 1 AND OLD.all_albums = 0 AND cur_event_profile('all_albums') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot set profile all_albums=1 if current profile does not have all_albums=1')
                    END;

                    UPDATE events_profiles
                    SET
                        can_manage_event = NEW.can_manage_event,
                        can_delete_event = NEW.can_delete_event,
                        can_upload_and_delete_images = NEW.can_upload_and_delete_images,
                        can_edit = NEW.can_edit,
                        all_images = NEW.all_images,
                        all_groups = NEW.all_groups,
                        all_albums = NEW.all_albums
                    WHERE event_id = cur_event_profile('event_id')
                    AND profile_id = OLD.profile_id;

                    -- TODO: use IF
                    DELETE FROM events_profiles_images 
                    WHERE event_id = cur_event_profile('event_id')
                    AND profile_id = OLD.profile_id 
                    AND OLD.all_images = 1
                    AND NEW.all_images = 0;

                    INSERT INTO events_profiles_images (event_id, profile_id, image_id)
                    SELECT epi.event_id, OLD.profile_id, epi.image_id
                    FROM events_profiles_images epi
                    INNER JOIN events_profiles ep ON epi.event_id = ep.event_id AND epi.profile_id = ep.profile_id
                    WHERE epi.event_id = cur_event_profile('event_id')
                    AND ep.profile_id = cur_profile('profile_id')
                    AND NEW.all_images = 1 
                    AND OLD.all_images = 0;

                    DELETE FROM events_profiles_groups 
                    WHERE event_id = cur_event_profile('event_id')
                    AND profile_id = OLD.profile_id 
                    AND OLD.all_groups = 1
                    AND NEW.all_groups = 0;

                    INSERT INTO events_profiles_groups (event_id, profile_id, group_id)
                    SELECT epg.event_id, OLD.profile_id, epg.group_id
                    FROM events_profiles_groups epg
                    INNER JOIN events_profiles ep ON epg.event_id = ep.event_id AND epg.profile_id = ep.profile_id
                    WHERE epg.event_id = cur_event_profile('event_id')
                    AND ep.profile_id = cur_profile('profile_id')
                    AND NEW.all_groups = 1 
                    AND OLD.all_groups = 0;

                    DELETE FROM events_profiles_albums 
                    WHERE event_id = cur_event_profile('event_id')
                    AND profile_id = OLD.profile_id 
                    AND OLD.all_albums = 1
                    AND NEW.all_albums = 0;

                    INSERT INTO events_profiles_albums (event_id, profile_id, album_id)
                    SELECT epa.event_id, OLD.profile_id, epa.album_id
                    FROM events_profiles_albums epa
                    INNER JOIN events_profiles ep ON epa.event_id = ep.event_id AND epa.profile_id = ep.profile_id
                    WHERE epa.event_id = cur_event_profile('event_id')
                    AND ep.profile_id = cur_profile('profile_id')
                    AND NEW.all_albums = 1 
                    AND OLD.all_albums = 0;

                END;
            """,
            'trg_delete_accessible_events_profiles': """
                INSTEAD OF DELETE ON accessible_events_profiles
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN OLD.profile_id NOT IN (
                            SELECT profile_id
                            FROM accessible_events_profiles
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible')
                    END;

                    DELETE FROM events_profiles WHERE event_id = cur_event_profile('event_id') AND profile_id = OLD.profile_id;
                END;
            """,

            # accessible_events_profiles_images
            'trg_insert_accessible_events_profiles_images': """
                INSTEAD OF INSERT ON accessible_events_profiles_images
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN NEW.profile_id NOT IN (
                            SELECT profile_id
                            FROM accessible_events_profiles
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible')
                        WHEN NOT EXISTS (
                            SELECT 1
                            FROM accessible_images
                            WHERE image_id = NEW.image_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the image is not accessible')
                    END;

                    INSERT OR IGNORE INTO events_profiles_images (event_id, profile_id, image_id)
                    VALUES (cur_event_profile('event_id'), NEW.profile_id, NEW.image_id);
                END;
            """,
            'trg_delete_accessible_events_profiles_images': """
                INSTEAD OF DELETE ON accessible_events_profiles_images
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN OLD.profile_id NOT IN (
                            SELECT profile_id
                            FROM accessible_events_profiles
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible')
                        WHEN NOT EXISTS (
                            SELECT 1
                            FROM accessible_images
                            WHERE image_id = OLD.image_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the image is not accessible')
                    END;

                    DELETE FROM events_profiles_images
                    WHERE event_id = cur_event_profile('event_id')
                    AND profile_id = OLD.profile_id
                    AND image_id = OLD.image_id;
                END;
            """,

            # accessible_events_profiles_groups
            'trg_insert_accessible_events_profiles_groups': """
                INSTEAD OF INSERT ON accessible_events_profiles_groups
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN NEW.profile_id NOT IN (
                            SELECT profile_id
                            FROM accessible_events_profiles
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible')
                        WHEN NOT EXISTS (
                            SELECT 1
                            FROM accessible_groups
                            WHERE group_id = NEW.group_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the group is not accessible')
                    END;

                    INSERT OR IGNORE INTO events_profiles_groups (event_id, profile_id, group_id)
                    VALUES (cur_event_profile('event_id'), NEW.profile_id, NEW.group_id);
                END;
            """,
            'trg_delete_accessible_events_profiles_groups': """
                INSTEAD OF DELETE ON accessible_events_profiles_groups
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN OLD.profile_id NOT IN (
                            SELECT profile_id
                            FROM accessible_events_profiles
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible')
                        WHEN NOT EXISTS (
                            SELECT 1
                            FROM accessible_groups
                            WHERE group_id = OLD.group_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the group is not accessible')
                    END;

                    DELETE FROM events_profiles_groups
                    WHERE event_id = cur_event_profile('event_id')
                    AND profile_id = OLD.profile_id
                    AND group_id = OLD.group_id;
                END;
            """,

            # accessible_events_profiles_albums
            'trg_insert_accessible_events_profiles_albums': """
                INSTEAD OF INSERT ON accessible_events_profiles_albums
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN NEW.profile_id NOT IN (
                            SELECT profile_id
                            FROM accessible_events_profiles
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible')
                        WHEN NOT EXISTS (
                            SELECT 1 FROM accessible_albums
                            WHERE album_id = NEW.album_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the album is not accessible')
                    END;

                    INSERT OR IGNORE INTO events_profiles_albums (event_id, profile_id, album_id)
                    VALUES (cur_event_profile('event_id'), NEW.profile_id, NEW.album_id);
                END;
            """,
            'trg_delete_accessible_events_profiles_albums': """
                INSTEAD OF DELETE ON accessible_events_profiles_albums
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN OLD.profile_id NOT IN (
                            SELECT profile_id
                            FROM accessible_events_profiles
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible')
                        WHEN NOT EXISTS (
                            SELECT 1 FROM accessible_albums
                            WHERE album_id = OLD.album_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the album is not accessible')
                    END;

                    DELETE FROM events_profiles_albums
                    WHERE event_id = cur_event_profile('event_id')
                    AND profile_id = OLD.profile_id
                    AND album_id = OLD.album_id;
                END;
            """,

            # accessible_faces
            'trg_update_accessible_faces': """
                INSTEAD OF UPDATE ON accessible_faces
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                        WHEN face_id NOT IN (SELECT face_id FROM accessible_faces) THEN
                            RAISE(ABORT, 'Permission denied: the face is not accessible')
                        WHEN NEW.group_ID IS NOT NULL AND NEW.group_ID NOT IN (SELECT group_id FROM accessible_groups) THEN
                            RAISE(ABORT, 'Permission denied: the target group is not accessible')
                    END;

                    UPDATE faces
                    SET group_id = NEW.group_id
                    WHERE face_id = OLD.face_id;
                END;
            """,
            'trg_delete_accessible_faces': """
                INSTEAD OF DELETE ON accessible_faces
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_upload_and_delete_images') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;

                    DELETE FROM faces
                    WHERE face_id = OLD.face_id
                    AND EXISTS (
                        SELECT 1 FROM accessible_faces f
                        WHERE f.face_id = OLD.face_id
                    );
                END;
            """,
            'trg_insert_accessible_faces': """
                INSTEAD OF INSERT ON accessible_faces
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_upload_and_delete_images') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to upload images')
                    END;

                    INSERT INTO faces (
                        event_id,
                        face_id,
                        image_id,
                        group_id,
                        width,
                        height,
                        left,
                        top
                    )
                    VALUES (
                        cur_event_profile('event_id'),
                        NEW.face_id,
                        NEW.image_id,
                        NEW.group_id,
                        COALESCE(NEW.width, 0),
                        COALESCE(NEW.height, 0),
                        COALESCE(NEW.left, 0),
                        COALESCE(NEW.top, 0)
                    );
                END;
            """,

            # accessible_images
            'trg_update_accessible_images': """
                INSTEAD OF UPDATE ON accessible_images
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;

                    UPDATE images
                    SET moment_id = NEW.moment_id
                    WHERE image_id = OLD.image_id;
                END;
            """,
            'trg_delete_accessible_images': """
                INSTEAD OF DELETE ON accessible_images
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_upload_and_delete_images') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to delete images')
                    END;

                    DELETE FROM images
                    WHERE image_id = OLD.image_id;
                END;
            """,
            'trg_insert_accessible_images': """
                INSTEAD OF INSERT ON accessible_images
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_upload_and_delete_images') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to upload images')
                    END;

                    INSERT INTO images (
                        image_id,
                        event_id,
                        date_taken,
                        label,
                        file_size,
                        width,
                        height,
                        moment_id,
                        upload_id
                    )
                    VALUES (
                        NEW.image_id,
                        cur_event_profile('event_id'),
                        NEW.date_taken,
                        NEW.label,
                        COALESCE(NEW.file_size, 0),
                        COALESCE(NEW.width, 0),
                        COALESCE(NEW.height, 0),
                        NEW.moment_id,
                        NEW.upload_id
                    );
                END;
            """,

            # accessible_groups
            'trg_update_accessible_groups': """
                INSTEAD OF UPDATE ON accessible_groups
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                        WHEN OLD.group_ID NOT IN (SELECT group_id FROM accessible_groups) THEN
                            RAISE(ABORT, 'Permission denied: the group is not accessible')
                    END;

                    UPDATE groups
                    SET label = NEW.label,
                        representative_face = NEW.representative_face
                    WHERE group_id = OLD.group_id;
                END;
            """,
            'trg_delete_accessible_groups': """
                INSTEAD OF DELETE ON accessible_groups
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                        WHEN OLD.group_ID NOT IN (SELECT group_id FROM accessible_groups) THEN
                            RAISE(ABORT, 'Permission denied: the group is not accessible')
                    END;

                    DELETE FROM groups
                    WHERE group_id = OLD.group_id;
                END;
            """,
            'trg_insert_accessible_groups': """
                INSTEAD OF INSERT ON accessible_groups
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;

                    INSERT INTO groups (
                        group_id,
                        event_id,
                        label,
                        representative_face
                    )
                    VALUES (
                        NEW.group_id,
                        cur_event_profile('event_id'),
                        NEW.label,
                        NEW.representative_face
                    );
                END;
            """,

            # accessible_moments
            'trg_update_accessible_moments': """
                INSTEAD OF UPDATE ON accessible_moments
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;

                    UPDATE moments
                    SET label = NEW.label,
                        description = NEW.description,
                        start = NEW.start,
                        end = NEW.end,
                        representative_image = NEW.representative_image
                    WHERE moment_id = OLD.moment_id;
                END;
            """,
            'trg_delete_accessible_moments': """
                INSTEAD OF DELETE ON accessible_moments
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;

                    DELETE FROM moments
                    WHERE moment_id = OLD.moment_id;
                END;
            """,
            'trg_insert_accessible_moments': """
                INSTEAD OF INSERT ON accessible_moments
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;

                    INSERT INTO moments (
                        moment_id,
                        event_id,
                        label,
                        description,
                        start,
                        end,
                        representative_image
                    )
                    VALUES (
                        NEW.moment_id,
                        cur_event_profile('event_id'),
                        NEW.label,
                        NEW.description,
                        NEW.start,
                        NEW.end,
                        NEW.representative_image
                    );
                END;
            """,

            # accessible_albums
            'trg_update_accessible_albums': """
                INSTEAD OF UPDATE ON accessible_albums
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;

                    UPDATE albums
                    SET label = NEW.label,
                        description = NEW.description,
                        representative_image = NEW.representative_image
                    WHERE album_id = OLD.album_id;
                END;
            """,
            'trg_delete_accessible_albums': """
                INSTEAD OF DELETE ON accessible_albums
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;

                    DELETE FROM albums
                    WHERE album_id = OLD.album_id;
                END;
            """,
            'trg_insert_accessible_albums': """
                INSTEAD OF INSERT ON accessible_albums
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;
                    INSERT INTO albums (
                        album_id,
                        event_id,
                        label,
                        description,
                        representative_image
                    )
                    VALUES (
                        NEW.album_id,
                        cur_event_profile('event_id'),
                        NEW.label,
                        NEW.description,
                        NEW.representative_image
                    );
                END;
            """,

            # accessible_albums_images
            'trg_insert_accessible_albums_images': """
                INSTEAD OF INSERT ON accessible_albums_images
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;

                    INSERT OR IGNORE INTO albums_images (album_id, image_id)
                    SELECT accessible_albums.album_id, accessible_images.image_id
                    FROM accessible_albums
                    JOIN accessible_images
                    WHERE accessible_albums.album_id = NEW.album_id
                    AND accessible_images.image_id = NEW.image_id;
                END;
            """,
            'trg_delete_accessible_albums_images': """
                INSTEAD OF DELETE ON accessible_albums_images
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;

                    DELETE FROM albums_images
                    WHERE album_id = OLD.album_id
                    AND image_id = OLD.image_id;
                END;
            """,

            # accessible_uploads
            'trg_insert_accessible_uploads': """
                INSTEAD OF INSERT ON accessible_uploads
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_upload_and_delete_images') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot upload and delete images')
                    END;

                    INSERT OR IGNORE INTO uploads (
                        event_id,
                        profile_id,
                        started_at,
                        completed_at,
                        status,
                        images_count,
                        faces_count,
                        clusters_count,
                        moments_count, errors, notes)
                    VALUES (
                        cur_event_profile('event_id'),
                        cur_profile('profile_id'),
                        NEW.started_at,
                        NEW.completed_at,
                        NEW.status,
                        COALESCE(NEW.images_count, 0),
                        COALESCE(NEW.faces_count, 0),
                        COALESCE(NEW.clusters_count, 0),
                        COALESCE(NEW.moments_count, 0),
                        NEW.errors,
                        NEW.notes
                    );
                    
                END;
            """,
            'trg_delete_accessible_uploads': """
                INSTEAD OF DELETE ON accessible_uploads
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_upload_and_delete_images') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot upload and delete images')
                        WHEN NOT EXISTS (
                            SELECT 1 FROM accessible_uploads
                            WHERE accessible_uploads.upload_id = OLD.upload_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the upload is not accessible')
                        WHEN OLD.profile_id NOT IN (
                            SELECT profile_id FROM accessible_events_profiles
                            WHERE event_id = cur_event_profile('event_id')
                            AND profile_id = OLD.profile_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible')
                    END;

                    DELETE FROM uploads WHERE upload_id = OLD.upload_id;
                END;
            """,
            'trg_update_accessible_uploads': """
                INSTEAD OF UPDATE ON accessible_uploads
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_event_profile('can_upload_and_delete_images') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot upload and delete images')
                        WHEN NOT EXISTS (
                            SELECT 1 FROM accessible_uploads
                            WHERE accessible_uploads.upload_id = OLD.upload_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the upload is not accessible')
                        WHEN OLD.profile_id NOT IN (
                            SELECT profile_id FROM accessible_events_profiles
                            WHERE event_id = cur_event_profile('event_id')
                            AND profile_id = OLD.profile_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible')
                    END;

                    UPDATE uploads
                    SET
                        completed_at = NEW.completed_at,
                        status = NEW.status,
                        images_count = NEW.images_count,
                        faces_count = NEW.faces_count,
                        clusters_count = NEW.clusters_count,
                        moments_count = NEW.moments_count,
                        errors = NEW.errors,
                        notes = NEW.notes
                    WHERE upload_id = OLD.upload_id;
                END;
            """,

            # accessible_my_access_requests
            'trg_insert_accessible_my_access_requests': """
                INSTEAD OF INSERT ON accessible_my_access_requests
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN NEW.profile_id <> cur_profile('profile_id') OR (NEW.applicant_profile_id IS NOT NULL AND NEW.applicant_profile_id <> cur_profile('profile_id')) THEN
                            RAISE(ABORT, 'Permission denied: cannot create access request for another profile')
                        WHEN
                            cur_profile('is_public') = 1 AND (
                                NEW.applicant_name IS NULL
                                OR NEW.applicant_email IS NULL
                            )
                        THEN
                            RAISE(ABORT, 'Permission denied: access request by public profile is only allowed for another profile with name and email required')
                        WHEN
                            NEW.applicant_profile_id IS NULL AND COALESCE(NEW.communication_consent, 0) = 0 THEN
                                RAISE(ABORT, 'Policy error: communication consent is required for anonymous access request')
                    END;

                    INSERT INTO access_requests (
                        event_id,
                        profile_id,
                        requested_at,
                        applicant_name,
                        applicant_email,
                        applicant_phone,
                        details,
                        applicant_profile_id,
                        communication_consent)
                    VALUES (
                        cur_event_profile('event_id'),
                        NEW.profile_id,
                        COALESCE(NEW.requested_at, CURRENT_TIMESTAMP),
                        CASE WHEN cur_profile('is_public') = 1 THEN NEW.applicant_name ELSE NULL END,
                        CASE WHEN cur_profile('is_public') = 1 THEN NEW.applicant_email ELSE NULL END,
                        CASE WHEN cur_profile('is_public') = 1 THEN NEW.applicant_phone ELSE NULL END,
                        NEW.details,
                        CASE WHEN cur_profile('is_public') = 0 THEN NEW.applicant_profile_id ELSE NULL END,
                        COALESCE(NEW.communication_consent, 0)
                    );
                END;
            """,
            'trg_update_accessible_my_access_requests': """
                INSTEAD OF UPDATE ON accessible_my_access_requests
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN OLD.profile_id <> cur_profile('profile_id') THEN
                            RAISE(ABORT, 'Permission denied: the access request is not accessible')
                        WHEN cur_profile('is_public') = 1 THEN
                            RAISE(ABORT, 'Permission denied: the access request is not accessible')
                        WHEN OLD.is_closed = 1 THEN
                            RAISE(ABORT, 'Permission denied: cannot update closed access request')
                    END;

                    UPDATE access_requests SET
                        details = NEW.details,
                        communication_consent = COALESCE(NEW.communication_consent, 0)
                    WHERE access_request_id = OLD.access_request_id;
                END;
            """,
            'trg_delete_accessible_my_access_requests': """
                INSTEAD OF DELETE ON accessible_my_access_requests
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN OLD.profile_id <> cur_profile('profile_id') THEN
                            RAISE(ABORT, 'Permission denied: the access request is not accessible')
                        WHEN cur_profile('is_public') = 1 THEN
                            RAISE(ABORT, 'Permission denied: the access request is not accessible')
                        WHEN OLD.is_closed = 1 THEN
                            RAISE(ABORT, 'Permission denied: cannot delete closed access request')
                    END;

                    DELETE FROM access_requests WHERE access_request_id = OLD.access_request_id;
                END;
            """,

            # accessible_my_access_requests_groups
            'trg_insert_accessible_my_access_requests_groups': """
                INSTEAD OF INSERT ON accessible_my_access_requests_groups
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_profile('profile_id') <> (
                            SELECT ar.profile_id
                            FROM access_requests ar
                            WHERE NEW.access_request_id = ar.access_request_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the access request is not accessible')
                        WHEN (SELECT is_closed FROM access_requests WHERE access_request_id = NEW.access_request_id) = 1 THEN
                            RAISE(ABORT, 'Permission denied: the access request is closed')
                    END;

                    INSERT INTO access_requests_groups
                    (access_request_id, group_id)
                    SELECT NEW.access_request_id as access_request_id, cgtra.group_id
                    FROM current_groups_to_request_access cgtra
                    WHERE cgtra.group_id = NEW.group_id;

                    -- ensure notifications
                    INSERT INTO notifications (
                        profile_id,
                        message,
                        type,
                        data
                    )
                    SELECT
                        p.profile_id,
                        'A new access request was created',
                        'access_request',
                        json_object('access_request_id', NEW.access_request_id, 'event_id', cur_event_profile('event_id'))
                    FROM events_profiles ep
                    INNER JOIN profiles p ON ep.profile_id = p.profile_id
                    WHERE
                        ep.event_id = cur_event_profile('event_id')
                        AND p.hierarchy_rank > 0
                        AND NOT EXISTS (
                            SELECT 1
                            FROM notifications n
                            WHERE n.type = 'access_request'
                            AND n.profile_id = p.profile_id
                            AND n.data->>'access_request_id' = NEW.access_request_id
                            AND n.data->>'event_id' = cur_event_profile('event_id')
                        )
                        AND EXISTS (
                            SELECT 1
                            FROM groups_accessibility ga
                            WHERE ga.group_id = NEW.group_id
                            AND ga.profile_id = p.profile_id
                            AND ga.event_id = cur_event_profile('event_id')
                            AND ga.is_accessible = 1
                        );

                END;
            """,
            'trg_delete_accessible_my_access_requests_groups': """
                INSTEAD OF DELETE ON accessible_my_access_requests_groups
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN cur_profile('profile_id') <> (
                            SELECT ar.profile_id
                            FROM access_requests ar
                            WHERE OLD.access_request_id = ar.access_request_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the access request is not accessible')
                        WHEN (SELECT is_closed FROM access_requests WHERE access_request_id = OLD.access_request_id) = 1 THEN
                            RAISE(ABORT, 'Permission denied: the access request is closed')
                    END;

                    DELETE FROM access_requests_groups WHERE access_request_id = OLD.access_request_id AND group_id = OLD.group_id;
                END;
            """,

            # accessible_access_requests
            'trg_update_accessible_access_requests': """
                INSTEAD OF UPDATE ON accessible_access_requests
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN NOT EXISTS (
                            SELECT 1 FROM accessible_access_requests
                            WHERE accessible_access_requests.access_request_id = OLD.access_request_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the access request is not accessible')
                        WHEN OLD.is_closed = 1 THEN
                            RAISE(ABORT, 'Permission denied: the access request is closed')
                    END;

                    UPDATE access_requests SET
                        applicant_profile_id = NEW.applicant_profile_id
                    WHERE access_request_id = OLD.access_request_id;
                
                END;
            """,
            'trg_delete_accessible_access_requests': """
                INSTEAD OF DELETE ON accessible_access_requests
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN NOT EXISTS (
                            SELECT 1 FROM accessible_access_requests
                            WHERE accessible_access_requests.access_request_id = OLD.access_request_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the access request is not accessible')
                    END;

                    DELETE FROM access_requests WHERE access_request_id = OLD.access_request_id;
                END;
            """,

            # accessible_access_requests_groups
            'trg_update_accessible_access_requests_groups': """
                INSTEAD OF UPDATE ON accessible_access_requests_groups
                BEGIN
                    SELECT CASE
                        WHEN cur_event_profile('event_id') IS NULL THEN
                            RAISE(ABORT, 'Permission denied: event not found')
                        WHEN NOT EXISTS (
                            SELECT 1 FROM accessible_access_requests aar
                            WHERE aar.access_request_id = OLD.access_request_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the access request is not accessible')
                        WHEN (SELECT is_closed FROM access_requests WHERE access_request_id = OLD.access_request_id) = 1 THEN
                            RAISE(ABORT, 'Permission denied: the access request is closed')
                        WHEN OLD.approved IS NOT NULL THEN
                            RAISE(ABORT, 'Permission denied: the access request group is closed')
                        WHEN NEW.approved = 1 AND OLD.group_id NOT IN (
                            SELECT group_id FROM accessible_groups
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the group is not accessible')
                    END;

                    -- TODO: use IF
                    INSERT OR IGNORE INTO events_profiles_groups (event_id, profile_id, group_id)
                    SELECT
                        aar.event_id as event_id,
                        aar.applicant_profile_id as profile_id,
                        OLD.group_id as group_id
                    FROM accessible_access_requests aar
                    INNER JOIN accessible_events_profiles aep
                        ON aep.profile_id = aar.applicant_profile_id
                    WHERE aar.access_request_id = OLD.access_request_id
                    AND aep.all_groups = 0 AND NEW.approved = 1;

                    DELETE FROM events_profiles_groups
                    WHERE rowid IN (
                        SELECT epg.rowid
                        FROM events_profiles ep
                        INNER JOIN events_profiles_groups epg ON
                            ep.event_id = epg.event_id
                            AND ep.profile_id = epg.profile_id
                        INNER JOIN access_requests ar ON
                            ar.applicant_profile_id = ep.profile_id
                            AND ar.event_id = ep.event_id
                        WHERE ar.access_request_id = OLD.access_request_id
                        AND epg.group_id = OLD.group_id
                        AND ep.all_groups = 1
                        AND NEW.approved = 1
                    );

                    UPDATE access_requests_groups SET
                        approved = NEW.approved,
                        closed_at = COALESCE(NEW.closed_at, CURRENT_TIMESTAMP),
                        closed_by = cur_profile('profile_id')
                    WHERE access_request_id = OLD.access_request_id
                    AND group_id = OLD.group_id;

                    INSERT INTO ensure_access_requests_closed (access_request_id, closed_at)
                    VALUES (OLD.access_request_id, NEW.closed_at);
                END;
            """,

            # prevent_reserved_event_urls
            'trg_prevent_reserved_event_urls_insert': """
                BEFORE INSERT ON events
                BEGIN
                    SELECT CASE
                        WHEN NEW.url = 'dashboard' THEN
                            RAISE(ABORT, 'Policy error: The URL "dashboard" is reserved and cannot be used for events')
                    END;
                END;
            """,
            'trg_prevent_reserved_event_urls_update': """
                BEFORE UPDATE ON events
                BEGIN
                    SELECT CASE
                        WHEN NEW.url = 'dashboard' THEN
                            RAISE(ABORT, 'Policy error: The URL "dashboard" is reserved and cannot be used for events')
                    END;
                END;
            """,

            # ensure_events_valid
            'trg_ensure_events_images_limit_valid_insert': """
                BEFORE INSERT ON events
                BEGIN
                    SELECT CASE
                        WHEN NEW.images_count_limit < 0 OR NEW.images_count_limit > (SELECT images_count_limit FROM settings WHERE id = 1 LIMIT 1) THEN
                            RAISE(ABORT, 'Policy error: Invalid images count limit')
                    END;
                END;
            """,
            'trg_ensure_events_images_limit_valid_update': """
                BEFORE UPDATE ON events
                BEGIN
                    SELECT CASE
                        WHEN NEW.images_count_limit < 0 OR NEW.images_count_limit > (SELECT images_count_limit FROM settings WHERE id = 1 LIMIT 1) THEN
                            RAISE(ABORT, 'Policy error: Invalid images count limit')
                    END;
                END;
            """,
            'trg_ensure_events_image_size_limit_valid_insert': """
                BEFORE INSERT ON events
                BEGIN
                    SELECT CASE
                        WHEN NEW.image_size_limit_bytes < 0 OR NEW.image_size_limit_bytes > (SELECT image_size_limit_bytes FROM settings WHERE id = 1 LIMIT 1) THEN
                            RAISE(ABORT, 'Policy error: Invalid image size limit')
                    END;
                END;
            """,
            'trg_ensure_events_image_size_limit_valid_update': """
                BEFORE UPDATE ON events
                BEGIN
                    SELECT CASE
                        WHEN NEW.image_size_limit_bytes < 0 OR NEW.image_size_limit_bytes > (SELECT image_size_limit_bytes FROM settings WHERE id = 1 LIMIT 1) THEN
                            RAISE(ABORT, 'Policy error: Invalid image size limit')
                    END;
                END;
            """,

            # ensure_defaults_in_event
            'trg_ensure_defaults_in_event_insert': """
                AFTER INSERT ON events
                BEGIN
                    INSERT OR IGNORE INTO events_profiles (
                        event_id,
                        profile_id,
                        can_manage_event,
                        can_delete_event,
                        can_upload_and_delete_images,
                        can_edit,
                        all_images,
                        all_groups,
                        all_albums
                    )
                    SELECT
                        NEW.event_id, developer_id, 1, 1, 1, 1, 1, 1, 1
                    FROM settings
                    WHERE settings.id = 1;

                    INSERT INTO albums (event_id, album_id, label)
                    SELECT NEW.event_id, uuid, 'Archive'
                    FROM uuid
                    LIMIT 1;

                    INSERT INTO albums (event_id, album_id, label)
                    SELECT NEW.event_id, uuid, 'Favorites'
                    FROM uuid
                    LIMIT 1;

                    INSERT INTO groups (event_id, group_id, label)
                    SELECT NEW.event_id, uuid, 'Unassociated'
                    FROM uuid
                    LIMIT 1;
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
                                LOWER(label) = LOWER(NEW.label)
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
                                LOWER(p.label) = LOWER(NEW.label)
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

            # insert default preferences into profiles_preferences
            'trg_profiles_insert_default_preferences': """
                AFTER INSERT ON profiles
                BEGIN
                    INSERT OR IGNORE INTO profiles_preferences (
                        profile_id,
                        preference_group,
                        preference_key,
                        preference_value
                    )
                    SELECT
                        NEW.profile_id,
                        dp.preference_group,
                        dp.preference_key,
                        dp.value
                    FROM default_preferences dp;
                END;
            """,

            # ensure_profiles_publicity_policy
            'trg_insert_ensure_profiles_publicity': """
                BEFORE INSERT ON profiles
                BEGIN
                    SELECT CASE
                        WHEN NEW.is_public = 1 AND NEW.hierarchy_rank > 0 THEN
                            RAISE(ABORT, 'Policy error: cannot set manager profile to public')
                        WHEN NEW.is_public = 1 AND NEW.restricted_to_event IS NULL THEN
                            RAISE(ABORT, 'Policy error: cannot set profile to public if it is not restricted to an event')
                    END;
                END;
            """,
            'trg_update_ensure_profiles_publicity': """
                BEFORE UPDATE ON profiles
                BEGIN
                    SELECT CASE
                        WHEN NEW.is_public = 1 AND NEW.hierarchy_rank > 0 THEN
                            RAISE(ABORT, 'Policy error: cannot set manager profile to public')
                        WHEN NEW.is_public = 1 AND NEW.restricted_to_event IS NULL THEN
                            RAISE(ABORT, 'Policy error: cannot set profile to public if it is not restricted to an event')
                    END;
                END;
            """,
            'trg_insert_ensure_profiles_public_access_code': """
                BEFORE INSERT ON profiles
                BEGIN
                    SELECT CASE
                        WHEN NEW.is_public = 0 AND NEW.public_access_code IS NOT NULL THEN
                            RAISE(ABORT, 'Policy error: cannot set public access code if profile is not public')
                    END;
                END;
            """,
            'trg_update_ensure_profiles_public_access_code': """
                AFTER UPDATE ON profiles
                BEGIN
                    -- use IF
                    UPDATE profiles
                    SET public_access_code = NULL
                    WHERE profile_id = OLD.profile_id
                    AND is_public = 0;
                END;
            """,

            # revoke refresh tokens when profile password is updated
            'trg_revoke_refresh_tokens_when_profile_password_updated': """
                AFTER UPDATE ON profiles
                BEGIN
                    -- use IF
                    UPDATE refresh_tokens SET
                        revoked = 1,
                        revoked_at = CURRENT_TIMESTAMP
                    WHERE profile_id = OLD.profile_id
                    AND revoked = 0
                    AND NEW.password <> OLD.password
                    AND (NEW.password IS NOT NULL OR NEW.password <> '' OR OLD.password IS NOT NULL OR OLD.password <> '');
                END;
            """,

            # ensure_access_requests_groups_validity
            'trg_ensure_access_requests_closed': """
                INSTEAD OF INSERT ON ensure_access_requests_closed
                BEGIN
                    UPDATE access_requests SET
                        is_closed = 1,
                        closed_at = COALESCE(NEW.closed_at, CURRENT_TIMESTAMP),
                        closed_by = cur_profile('profile_id')
                    WHERE event_id = cur_event_profile('event_id')
                    AND access_request_id = COALESCE(NEW.access_request_id, access_request_id)
                    AND NOT EXISTS (
                        SELECT 1 FROM access_requests_groups arg
                        WHERE arg.access_request_id = access_requests.access_request_id
                        AND arg.approved IS NULL
                    );
                END;
            """,
            'trg_update_profile_ensure_access_requests_groups_validity': """
                AFTER UPDATE ON events_profiles
                BEGIN
                    UPDATE access_requests_groups SET
                        approved = 1,
                        closed_at = CURRENT_TIMESTAMP,
                        closed_by = cur_profile('profile_id')
                    WHERE (
                        (SELECT ar.applicant_profile_id FROM access_requests ar WHERE access_requests_groups.access_request_id = ar.access_request_id)
                        = OLD.profile_id
                    AND approved IS NULL)
                    AND (OLD.all_groups = 0 AND NEW.all_groups = 1);

                    INSERT INTO ensure_access_requests_closed (access_request_id, closed_at)
                    VALUES (NULL, NULL);
                END;
            """,
            'trg_insert_events_profiles_groups_ensure_access_requests_groups_validity': """
                AFTER INSERT ON events_profiles_groups
                BEGIN
                    UPDATE access_requests_groups SET
                        approved = 1,
                        closed_at = CURRENT_TIMESTAMP,
                        closed_by = cur_profile('profile_id')
                    WHERE
                        group_id = NEW.group_id
                        AND (
                            SELECT ar.applicant_profile_id
                            FROM access_requests ar
                            INNER JOIN events_profiles ep ON ep.profile_id = ar.applicant_profile_id
                            WHERE ar.access_request_id = access_requests_groups.access_request_id
                            AND ep.all_groups = 0
                        ) = NEW.profile_id
                        AND approved IS NULL
                    ;

                    INSERT INTO ensure_access_requests_closed (access_request_id, closed_at)
                    VALUES (NULL, NULL);
                END;
            """,
            'trg_delete_events_profiles_groups_ensure_access_requests_groups_validity': """
                AFTER DELETE ON events_profiles_groups
                BEGIN
                    UPDATE access_requests_groups SET
                        approved = 1,
                        closed_at = CURRENT_TIMESTAMP,
                        closed_by = cur_profile('profile_id')
                    WHERE (
                        OLD.profile_id = (
                            SELECT ar.applicant_profile_id
                            FROM access_requests ar
                            INNER JOIN events_profiles ep ON ep.profile_id = ar.applicant_profile_id
                            WHERE ar.access_request_id = access_requests_groups.access_request_id
                            AND ep.all_groups = 1
                        )
                        AND group_id = OLD.group_id
                    ) AND approved IS NULL;

                    INSERT INTO ensure_access_requests_closed (access_request_id, closed_at)
                    VALUES (NULL, NULL);
                END;
            """,

            # ensure_default_albums
            'trg_update_ensure_default_albums': """
                BEFORE UPDATE ON albums
                BEGIN
                    SELECT CASE
                        WHEN (LOWER(OLD.label) = 'archive' OR LOWER(OLD.label) = 'favorites') AND LOWER(NEW.label) <> LOWER(OLD.label) THEN
                            RAISE(ABORT, 'Policy error: cannot update default albums')
                    END;
                END;
            """,
            'trg_delete_ensure_default_albums': """
                BEFORE DELETE ON albums
                BEGIN
                    SELECT CASE
                        WHEN
                            (LOWER(OLD.label) = 'archive' OR LOWER(OLD.label) = 'favorites')
                            AND (SELECT event_in_deletion FROM settings WHERE id = 1 LIMIT 1) <> OLD.event_id
                        THEN
                            RAISE(ABORT, 'Policy error: cannot delete default albums')
                    END;
                END;
            """,

            # ensure_default_groups
            'trg_update_ensure_default_groups': """
                BEFORE UPDATE ON groups
                BEGIN
                    SELECT CASE
                        WHEN LOWER(OLD.label) = 'unassociated' AND COALESCE(OLD.label, '') <> COALESCE(NEW.label, '') THEN
                            RAISE(ABORT, 'Policy error: cannot update default group label')
                        WHEN LOWER(NEW.label) = 'unassociated' AND COALESCE(OLD.representative_face, '') <> COALESCE(NEW.representative_face, '') THEN
                            RAISE(ABORT, 'Policy error: cannot update default group representative face')
                    END;
                END;
            """,
            'trg_delete_ensure_default_groups': """
                BEFORE DELETE ON groups
                BEGIN
                    SELECT CASE
                        WHEN
                            LOWER(OLD.label) = 'unassociated'
                            AND (SELECT event_in_deletion FROM settings WHERE id = 1 LIMIT 1) <> OLD.event_id
                        THEN
                            RAISE(ABORT, 'Policy error: cannot delete default group')
                    END;
                END;
            """,
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
    def serialize_value(value_type: type | str, value: Any) -> str:
        if isinstance(value_type, str):
            value_type = DB.resolve_value_type(value_type)
        """Convert a Python value to a string for database storage."""
        
        if value_type == bool:
            return 1 if value else 0
        elif value_type == int:
            return str(int(value))
        elif value_type == float:
            return str(float(value))
        elif value_type in (list, dict):
            return json.dumps(value if value is not None else [])
        else:  # str
            return str(value)
    
    @staticmethod
    def deserialize_value(value_type: type | str, value_str: str) -> bool | int | float | list | dict | str:
        """Convert a database string to a Python value."""
        if isinstance(value_type, str):
            value_type = DB.resolve_value_type(value_type)
        if value_type == bool:
            return value_str.lower() in ('true', '1', 'yes') or int(value_str) == 1
        elif value_type == int:
            return int(value_str)
        elif value_type == float:
            return float(value_str)
        elif value_type in (list, dict):
            return json.loads(value_str if value_str is not None else '[]')
        else:  # str
            return value_str

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
    def is_auto_increment(table: str) -> bool:
        """Check if the table has an auto increment field."""

        return 'AUTOINCREMENT' in DB.TABLES()[DB.get_original_table(table)]

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

    @staticmethod
    def create_db(db_path: str):
        """Create a new SQLite DB with all tables and initial data."""
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        
        try:
            # Create tables            
            for table, schema in DB.TABLES().items():
                conn.execute(f'CREATE TABLE IF NOT EXISTS {table} ({schema})')
            
            # Create indexes
            for index_name, index_query in DB.INDEXES().items():
                conn.execute(f'CREATE INDEX IF NOT EXISTS {index_name} ON {index_query}')
            
            # Create views
            for view_name, view_sql in DB.VIEWS().items():
                conn.execute(f'CREATE VIEW IF NOT EXISTS {view_name} AS {view_sql}')
            
            # Create triggers
            for trigger_name, trigger_sql in DB.TRIGGERS().items():
                conn.execute(f'CREATE TRIGGER IF NOT EXISTS {trigger_name} {trigger_sql}')
            
            conn.commit()
        finally:
            conn.close()
        
        return db_path

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

    def __init__(self, *, event_id: str | None = None, profile_id: str | None = None, public_code: str | None = None):
        """Initialize database connection."""
        self.event_id = event_id
        self.db_path = os.path.join(DATA_ROOT, 'database.db')
        if not os.path.exists(self.db_path):
            file_name = os.path.basename(self.db_path)
            raise FileNotFoundError(f"Database file not found: {file_name}")

        self.profile_context = self.current_profile_fields()
        self.event_profile_context = self.current_event_profile_fields()
        
        if not profile_id and public_code:
            if not event_id:
                raise Forbidden('Access denied: no event ID provided')
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('SELECT profile_id FROM profiles WHERE public_access_code = ?', (public_code,))
                result = cursor.fetchone()
                if result:
                    self.profile_id = result[0]
                else:
                    raise Forbidden(f'Access denied: public access code {public_code} is invalid')

        self.profile_id = profile_id

    @property
    def profile_id(self) -> str | None:
        """Get the current profile id for access control."""
        return self.profile_context.get('profile_id')

    @profile_id.setter
    def profile_id(self, profile_id: str | None):
        """Set the current profile id for access control."""        
        profile = self.execute_query('SELECT * FROM profiles WHERE profile_id = ?', (profile_id,), return_format=ReturnFormat.DICT)

        if profile:
            for field, default_val in self.current_profile_fields().items():
                val = profile.get(field, default_val)
                self.profile_context[field] = val
            
            if self.event_id:
                event_profile = self.execute_query('SELECT * FROM events_profiles WHERE event_id = ? AND profile_id = ?', (self.event_id, profile_id), return_format=ReturnFormat.DICT)
                for field, default_val in self.current_event_profile_fields().items():
                    val = event_profile.get(field, default_val)
                    self.event_profile_context[field] = val

    # TODO: intigrate with execute_query
    @contextmanager
    def get_connection(self):
        """Context manager for database connections with profile context."""
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        
        try:
            conn.create_function("cur_profile", 1, lambda key: self.profile_context.get(key))
            conn.create_function("cur_event_profile", 1, lambda key: self.event_profile_context.get(key))
            yield conn
        finally:
            conn.close()

    def execute_query(self, query: str, params: tuple | list = (), return_format: ReturnFormat | None = None) -> Any:
        """Execute any SQL query and return results according to return_format.

        Supports SELECT and action queries (INSERT, UPDATE, DELETE, UPSERT)
        with optional RETURNING clause.
        """
        results = None
        row_count = None

        try:
            with self.get_connection() as conn:
                cursor = conn.execute(query, params)
                has_resultset = cursor.description is not None
                if has_resultset:
                    rows = cursor.fetchall()
                else:
                    row_count = cursor.rowcount
                conn.commit()
        
        except sqlite3.IntegrityError as e:
            if "Policy error" in str(e):
                raise DBPolicyError(f"Database policy error: {str(e)}") from e
            elif "Permission denied" in str(e):
                raise Forbidden(f"Permission denied: {e}") from e
            else:
                raise DatabaseError(f"Integrity error: {str(e)}") from e

        except sqlite3.Error as e:
            raise DatabaseError(f"Database error: {str(e)}") from e
        
        if has_resultset:
            columns = [desc[0] for desc in cursor.description]

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
                key_col, value_cols = columns[0], columns[1:]
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
                key_col, value_cols = columns[0], columns[1:]
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
                    placeholders = ",".join(["?"] * len(v))
                    clauses.append(f"{k} IN ({placeholders})")
                    values += v
            else:
                clauses.append(f"{k}=?")
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

        target = self.STRUCTURE()[table].get("accessible_table", table)
        p_keys = self.STRUCTURE()[table].get("primary_key")
        returning = ", ".join(p_keys) if isinstance(p_keys, list) else p_keys
        return_format = ReturnFormat.LIST_TUPLES if isinstance(p_keys, list) else ReturnFormat.LIST_VALUES

        keys = list(fields)
        row_placeholders = f"({", ".join(["?"] * len(keys))})"
        value_placeholders = ", ".join([row_placeholders] * len(values))
        sql = f"INSERT INTO {target} ({', '.join(keys)}) VALUES {value_placeholders}"
        # sql += f" RETURNING {returning}"

        all_values = []
        for value in values:
            for v in value:
                all_values.append(v)

        _ = self.execute_query(sql, all_values, ReturnFormat.VALUE)
        len_inserted = len(values)

        return self.execute_query(f'SELECT {self.get_id_field(table)} FROM {table} ORDER BY rowid DESC LIMIT {len_inserted}', (), return_format)

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

        target = self.STRUCTURE()[table].get("accessible_table", table)
        p_keys = self.STRUCTURE()[table].get("primary_key")
        returning = ", ".join(p_keys) if isinstance(p_keys, list) else p_keys

        keys = list(data.keys())
        placeholders = ", ".join(["?"] * len(keys))
        sql = f"INSERT INTO {target} ({', '.join(keys)}) VALUES ({placeholders})"
        sql += f" RETURNING {returning}"

        self.execute_query(sql, [data[k] for k in keys], ReturnFormat.VALUE)

        return self.execute_query(f'SELECT {self.get_id_field(table)} FROM {self.get_original_table(table)} ORDER BY rowid DESC LIMIT 1', (), ReturnFormat.VALUE)

    def update(self, table: str, where: dict, fields: dict) -> list:
        """Update rows matching WHERE clause and return their primary keys (if defined)."""
        if not fields:
            return []

        target = self.STRUCTURE()[table].get("accessible_table", table)
        p_keys = self.STRUCTURE()[table].get("primary_key")
        returning = ", ".join(p_keys) if isinstance(p_keys, list) else p_keys

        set_clause = ", ".join([f"{k}=?" for k in fields])
        where_clause, where_values = self._build_where(where)
        sql = f"UPDATE {target} SET {set_clause} WHERE {where_clause}"
        sql += f" RETURNING {returning}"

        params = list(fields.values()) + list(where_values)
        return self.execute_query(sql, params, ReturnFormat.LIST_VALUES)

    def delete(self, table: str, where: dict) -> list:
        """Delete rows matching WHERE clause and return their primary keys (if defined)."""
        target = self.STRUCTURE()[table].get("accessible_table", table)
        p_keys = self.STRUCTURE()[table].get("primary_key")
        returning = ", ".join(p_keys) if isinstance(p_keys, list) else p_keys

        where_clause, where_values = self._build_where(where)
        sql = f"DELETE FROM {target} WHERE {where_clause}"
        sql += f" RETURNING {returning}"

        return self.execute_query(sql, where_values, ReturnFormat.LIST_VALUES)
