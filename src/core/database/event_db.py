import sqlite3
import uuid
from contextlib import contextmanager
from src.core.errors import Forbidden
from src.core.database.base_db import BaseDB, ReturnFormat

class EventDB(BaseDB):
    """Event-specific database for images, groups, albums, moments."""
    
    @classmethod
    def STRUCTURE(self) -> dict:
        return {
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
                'fields': ['label', 'images_count', 'active_images_count', 'representative_face', 'representative_image', 'is_accessible'],
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
            'albums_actual': {
                'original_table': 'albums',
                'primary_key': 'album_id',
                'accessible_table': 'accessible_albums_actual',
                'fields': ['label'],
            },
            'albums_images_actual': {
                'original_table': 'albums_images',
                'primary_key': ['album_id', 'image_id'],
                'accessible_table': 'accessible_albums_images_actual',
            },
            'uploads': {
                'primary_key': 'upload_id',
                'accessible_table': 'accessible_uploads',
                'fields': ['started_at', 'completed_at', 'status', 'images_count', 'faces_count', 'clusters_count', 'moments_count', 'errors', 'notes', 'profile_id'],
                'relations': {
                    'images': {'relation_table': 'images', 'fields_needed': ['date_taken', 'is_archived', 'is_favorite']},
                    'groups': {'relation_table': 'uploads_groups', 'fields_needed': ['label', 'representative_face', 'faces_count']},
                    'moments': {'relation_table': 'uploads_moments', 'fields_needed': ['label', 'representative_image', 'images_count']},
                },
                'serializable': {
                    'errors': list,
                }
            },
            'profiles': {
                'primary_key': 'profile_id',
                'accessible_table': 'accessible_profiles',
                'fields': ['hierarchy_rank', 'can_upload_and_delete_images', 'can_edit', 'all_images', 'all_groups', 'all_albums', 'is_public', 'public_access_code'],
                'relations': {
                    'images': {'relation_table': 'profile_images', 'fields_needed': ['date_taken']},
                    'groups': {'relation_table': 'profile_groups', 'fields_needed': ['label']},
                    'albums': {'relation_table': 'profile_albums', 'fields_needed': ['label']},
                }
            },
            'access_requests': {
                'primary_key': 'access_request_id',
                'accessible_table': 'accessible_access_requests',
                'fields': ['profile_id', 'requested_at', 'applicant_name', 'applicant_email', 'applicant_phone', 'details', 'is_closed', 'closed_at', 'closed_by', 'closed_details', 'applicant_profile_id'],
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
                'fields': ['profile_id', 'requested_at', 'applicant_name', 'applicant_email', 'applicant_phone', 'details', 'is_closed', 'closed_at', 'closed_by', 'closed_details', 'applicant_profile_id'],
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
            'groups_images': {
                'primary_key': ['group_id', 'image_id'],
                'accessible_table': 'accessible_groups_images',
            },
            'albums_images': {
                'primary_key': ['album_id', 'image_id'],
                'accessible_table': 'accessible_albums_images',
            },
            'profile_images': {
                'primary_key': ['profile_id', 'image_id'],
                'accessible_table': 'accessible_profile_images',
            },
            'profile_groups': {
                'primary_key': ['profile_id', 'group_id'],
                'accessible_table': 'accessible_profile_groups',
            },
            'profile_albums': {
                'primary_key': ['profile_id', 'album_id'],
                'accessible_table': 'accessible_profile_albums',
            },
            'uploads_groups': {
                'primary_key': ['upload_id', 'group_id'],
                'accessible_table': 'accessible_uploads_groups',
            },
            'uploads_moments': {
                'primary_key': ['upload_id', 'moment_id'],
                'accessible_table': 'accessible_uploads_moments',
            },
        }
    
    @classmethod
    def TABLES(self) -> dict:
        return {
            'faces': '''
                face_id TEXT PRIMARY KEY NOT NULL,
                image_id TEXT NOT NULL,
                width REAL,
                height REAL,
                left REAL,
                top REAL,
                group_id TEXT NOT NULL,
                FOREIGN KEY (image_id) REFERENCES images(image_id) ON DELETE SET NULL,
                FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE RESTRICT
            ''',
            'images': '''
                image_id TEXT PRIMARY KEY NOT NULL,
                label TEXT,
                date_taken TEXT,
                file_size INTEGER,
                width INTEGER,
                height INTEGER,
                moment_id TEXT,
                upload_id INTEGER,
                FOREIGN KEY (moment_id) REFERENCES moments(moment_id) ON DELETE SET NULL,
                FOREIGN KEY (upload_id) REFERENCES uploads(upload_id) ON DELETE SET NULL
            ''',
            'groups': '''
                group_id TEXT PRIMARY KEY NOT NULL,
                label TEXT COLLATE NOCASE UNIQUE,
                representative_face TEXT,
                FOREIGN KEY (representative_face) REFERENCES faces(face_id) ON DELETE SET NULL
            ''',
            'moments': '''
                moment_id TEXT PRIMARY KEY NOT NULL,
                label TEXT COLLATE NOCASE UNIQUE,
                description TEXT,
                start TEXT,
                end TEXT,
                representative_image TEXT,
                FOREIGN KEY (representative_image) REFERENCES images(image_id) ON DELETE SET NULL
            ''',
            'albums': '''
                album_id TEXT PRIMARY KEY NOT NULL,
                label TEXT COLLATE NOCASE UNIQUE,
                description TEXT,
                representative_image TEXT,
                FOREIGN KEY (representative_image) REFERENCES images(image_id) ON DELETE SET NULL
            ''',
            'albums_images': '''
                album_id TEXT NOT NULL,
                image_id TEXT NOT NULL,
                FOREIGN KEY (album_id) REFERENCES albums(album_id) ON DELETE CASCADE,
                FOREIGN KEY (image_id) REFERENCES images(image_id) ON DELETE CASCADE,
                PRIMARY KEY (album_id, image_id)
            ''',
            'profiles': '''
                profile_id TEXT PRIMARY KEY NOT NULL,
                hierarchy_rank INTEGER DEFAULT 0,
                can_upload_and_delete_images BOOLEAN DEFAULT 0,
                can_edit BOOLEAN DEFAULT 0,
                all_images BOOLEAN DEFAULT 0,
                all_groups BOOLEAN DEFAULT 0,
                all_albums BOOLEAN DEFAULT 0,
                is_public BOOLEAN DEFAULT 0,
                public_access_code TEXT
            ''',
            'profile_images': '''
                profile_id TEXT NOT NULL,
                image_id TEXT NOT NULL,
                accessible BOOLEAN,
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
                FOREIGN KEY (image_id) REFERENCES images(image_id) ON DELETE CASCADE,
                PRIMARY KEY (profile_id, image_id)
            ''',
            'profile_groups': '''
                profile_id TEXT NOT NULL,
                group_id TEXT NOT NULL,
                accessible BOOLEAN,
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
                FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE,
                PRIMARY KEY (profile_id, group_id)
            ''',
            'profile_albums': '''
                profile_id TEXT NOT NULL,
                album_id TEXT NOT NULL,
                accessible BOOLEAN,
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
                FOREIGN KEY (album_id) REFERENCES albums(album_id) ON DELETE CASCADE,
                PRIMARY KEY (profile_id, album_id)
            ''',
            'uploads': '''
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
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE SET NULL
            ''',
            'access_requests': '''
                access_request_id INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id TEXT NOT NULL,
                requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                applicant_name TEXT NOT NULL,
                applicant_email TEXT,
                applicant_phone TEXT,
                details TEXT,
                is_closed BOOLEAN DEFAULT 0,
                closed_at DATETIME,
                closed_by TEXT,
                closed_details TEXT,
                applicant_profile_id TEXT,
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE SET NULL,
                FOREIGN KEY (closed_by) REFERENCES profiles(profile_id) ON DELETE SET NULL,
                FOREIGN KEY (applicant_profile_id) REFERENCES profiles(profile_id) ON DELETE SET NULL
            ''',
            'access_requests_groups': '''
                access_request_id INTEGER NOT NULL,
                group_id TEXT NOT NULL,
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
            'idx_images_moment_id': 'images(moment_id)',
            'idx_images_upload_id': 'images(upload_id)',
            'idx_images_date_taken': 'images(date_taken)',
            'idx_faces_image_id': 'faces(image_id)',
            'idx_faces_group_id': 'faces(group_id)',
            'idx_faces_group_id_image_id': 'faces(group_id, image_id)',
            'idx_groups_representative_face': 'groups(representative_face)',
            'idx_moments_representative_image': 'moments(representative_image)',
            'idx_albums_representative_image': 'albums(representative_image)',
            'idx_profiles_public_access_code': 'profiles(public_access_code)',
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
            'images_details': '''
                SELECT images.*,
                    CASE WHEN a1.image_id IS NOT NULL THEN 1 ELSE 0 END AS is_archived,
                    CASE WHEN a2.image_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite_helper
                FROM images
                LEFT JOIN (albums_images a1 INNER JOIN albums b1 ON a1.album_id = b1.album_id)
                ON a1.image_id = images.image_id AND LOWER(b1.label) = 'archive'
                LEFT JOIN (albums_images a2 INNER JOIN albums b2 ON a2.album_id = b2.album_id)
                ON a2.image_id = images.image_id AND LOWER(b2.label) = 'favorites';
            ''',
            'accessible_albums_helper': '''
                SELECT a.* FROM albums a
                WHERE EXISTS (
                    SELECT 1
                    FROM profiles p
                    LEFT JOIN profile_albums pa
                    ON p.profile_id = pa.profile_id
                    AND pa.album_id = a.album_id
                    WHERE p.profile_id = cur_profile('profile_id') AND (
                        (p.all_albums = 1 AND pa.album_id IS NULL)
                        OR (p.all_albums = 0 AND pa.accessible = 1)
                    )
                )
            ''',
            'accessible_images': '''
                SELECT i.*,
                (a2.album_id IS NOT NULL AND i.is_favorite_helper = 1) AS is_favorite
                FROM images_details as i
                LEFT JOIN accessible_albums_helper as a1 on LOWER(a1.label) = 'archive'
                LEFT JOIN accessible_albums_helper as a2 on LOWER(a2.label) = 'favorites'
                WHERE EXISTS (
                    SELECT 1
                    FROM profiles LEFT JOIN profile_images
                    ON profiles.profile_id = profile_images.profile_id AND i.image_id = profile_images.image_id
                    WHERE profiles.profile_id = cur_profile('profile_id') AND (
                        (profiles.all_images = 1 AND (profile_images.image_id IS NULL OR profile_images.accessible = 1))
                        OR (profiles.all_images = 0 AND profile_images.accessible = 1)
                    )
                )
                AND (a1.album_id IS NOT NULL OR i.is_archived = 0)
            ''',
            'accessible_groups_helper': '''
                SELECT g.*,
                CASE WHEN
                    ((cur_profile('all_groups') = 1 AND pg.group_id IS NULL)
                    OR (cur_profile('all_groups') = 0 AND pg.accessible = 1))
                    AND (LOWER(g.label) != 'unassociated' OR cur_profile('can_edit') = 1)
                THEN 1 ELSE 0 END AS is_accessible
                FROM groups g
                LEFT JOIN profile_groups pg ON g.group_id = pg.group_id AND pg.profile_id = cur_profile('profile_id')
            ''',
            'accessible_faces': '''
                SELECT f.*, i.upload_id
                FROM faces f 
                INNER JOIN accessible_images i ON f.image_id = i.image_id
                INNER JOIN accessible_groups_helper g ON f.group_id = g.group_id
                WHERE g.is_accessible = 1
            ''',
            'groups_images': '''
                SELECT i.image_id as image_id, g.group_id as group_id
                FROM images i
                INNER JOIN faces ON i.image_id = faces.image_id
                INNER JOIN groups g ON faces.group_id = g.group_id
                GROUP BY i.image_id, g.group_id
            ''',
            'accessible_groups_images': '''
                SELECT ai.image_id as image_id, af.group_id as group_id
                FROM accessible_images ai
                INNER JOIN accessible_faces af ON ai.image_id = af.image_id
                INNER JOIN accessible_groups_helper g ON af.group_id = g.group_id
                GROUP BY ai.image_id, af.group_id
            ''',
            'accessible_groups': '''
                SELECT 
                    g.*, rf.image_id as representative_image,
                    COUNT(DISTINCT f.face_id) AS faces_count,
                    COUNT(DISTINCT agi.image_id) AS images_count,
                    COUNT(DISTINCT CASE WHEN ai.is_archived = 0 THEN agi.image_id END) AS active_images_count
                FROM accessible_groups_helper g
                LEFT JOIN accessible_groups_images agi 
                    ON g.group_id = agi.group_id
                LEFT JOIN accessible_images ai
                    ON agi.image_id = ai.image_id
                LEFT JOIN faces f
                    ON f.group_id = g.group_id
                LEFT JOIN faces rf
                    ON g.representative_face = rf.face_id
                GROUP BY g.group_id
            ''',
            'accessible_moments': '''
                SELECT m.*,
                COUNT(i.image_id) as images_count,
                COUNT(i.image_id) - COALESCE(SUM(i.is_archived), 0) AS active_images_count
                FROM moments m
                LEFT JOIN accessible_images i ON m.moment_id = i.moment_id
                GROUP BY m.moment_id
            ''',
            'albums_images_actual': '''
                SELECT albums_images.*
                FROM albums_images
                INNER JOIN albums ON albums_images.album_id = albums.album_id
                WHERE LOWER(albums.label) != 'archive' and LOWER(albums.label) != 'favorites'
            ''',
            'accessible_albums_images': '''
                SELECT albums_images.*
                FROM albums_images
                INNER JOIN accessible_images ON albums_images.image_id = accessible_images.image_id
                INNER JOIN accessible_albums_helper aa ON albums_images.album_id = aa.album_id
            ''',
            'accessible_albums_images_actual': '''
                SELECT albums_images_actual.*
                FROM albums_images_actual
                INNER JOIN accessible_images ON albums_images_actual.image_id = accessible_images.image_id
                INNER JOIN accessible_albums_helper aa ON albums_images_actual.album_id = aa.album_id
            ''',
            'albums_actual': '''
                SELECT a.* FROM albums a
                WHERE LOWER(a.label) != 'archive' and LOWER(a.label) != 'favorites'
            ''',
            'accessible_albums': '''
                SELECT aa.*,
                COUNT(aia.image_id) as images_count,
                COUNT(aia.image_id) - COALESCE(SUM(ai.is_archived), 0) AS active_images_count
                FROM accessible_albums_helper aa
                LEFT JOIN accessible_albums_images aia ON aa.album_id = aia.album_id
                LEFT JOIN accessible_images ai ON aia.image_id = ai.image_id
                GROUP BY aa.album_id
            ''',
            'accessible_albums_actual': '''
                SELECT aa.* FROM accessible_albums aa
                WHERE LOWER(aa.label) != 'archive' and LOWER(aa.label) != 'favorites'
            ''',
            'current_profile': '''
                SELECT profile_id,
                    hierarchy_rank,
                    can_upload_and_delete_images,
                    can_edit,
                    all_images,
                    all_groups,
                    all_albums,
                    is_public,
                    CASE WHEN hierarchy_rank = 0 THEN 0 ELSE 1 END as is_profiles_manager,
                    CASE WHEN a1.album_id IS NOT NULL THEN 1 ELSE 0 END as has_archive_album,
                    CASE WHEN a2.album_id IS NOT NULL THEN 1 ELSE 0 END as has_favorites_album,
                    CASE WHEN COUNT(i.image_id) > 0 OR all_images = 1 THEN 1 ELSE 0 END as has_images,
                    CASE WHEN SUM(g.is_accessible) > 0 OR all_groups = 1 THEN 1 ELSE 0 END as has_groups,
                    CASE WHEN COUNT(a.album_id) > 0 OR all_albums = 1 THEN 1 ELSE 0 END as has_albums,
                    CASE WHEN SUM(g.is_accessible) <> COUNT(g.group_id) THEN 1 ELSE 0 END as enable_requests
                FROM profiles p
                LEFT JOIN accessible_albums a1 ON LOWER(a1.label) = 'archive'
                LEFT JOIN accessible_albums a2 ON LOWER(a2.label) = 'favorites'
                LEFT JOIN accessible_images i
                LEFT JOIN accessible_groups g
                LEFT JOIN accessible_albums a
                WHERE p.profile_id = cur_profile('profile_id')
                GROUP BY p.profile_id
            ''',
            'profiles_details': '''
                SELECT
                    profile_id,
                    hierarchy_rank,
                    can_upload_and_delete_images,
                    can_edit,
                    all_images,
                    all_groups,
                    all_albums,
                    is_public,
                    public_access_code
                FROM profiles p
            ''',
            'accessible_profiles': '''
                SELECT p.*
                FROM profiles_details p
                WHERE
                    cur_profile('profile_id') = p.profile_id 
                    OR p.hierarchy_rank < cur_profile('hierarchy_rank')
            ''',
            'accessible_profile_images': '''
                SELECT profile_images.*
                FROM profile_images
            ''',
            'accessible_profile_groups': '''
                SELECT profile_groups.*
                FROM profile_groups
                INNER JOIN accessible_groups_helper g ON profile_groups.group_id = g.group_id
            ''',
            'accessible_profile_albums': '''
                SELECT profile_albums.*
                FROM profile_albums
            ''',
            'uploads_details': '''
                SELECT
                    u.*
                FROM uploads u
            ''',
            'accessible_uploads': '''
                SELECT u.*
                FROM uploads_details u
                WHERE cur_profile('can_upload_and_delete_images') = 1
            ''',
            'uploads_groups': '''
                SELECT u.*, g.group_id as group_id
                FROM uploads u
                INNER JOIN images i ON u.upload_id = i.upload_id
                INNER JOIN faces f ON i.image_id = f.image_id
                INNER JOIN groups g ON f.group_id = g.group_id
                GROUP BY u.upload_id, g.group_id
            ''',
            'accessible_uploads_groups': '''
                SELECT u.*, g.group_id as group_id
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
                GROUP BY u.upload_id, m.moment_id
            ''',
            'accessible_uploads_moments': '''
                SELECT u.*, m.moment_id as moment_id
                FROM accessible_uploads u
                INNER JOIN accessible_images i ON u.upload_id = i.upload_id
                INNER JOIN accessible_moments m ON i.moment_id = m.moment_id
                GROUP BY u.upload_id, m.moment_id
            ''',
            'access_requests_groups_details': '''
                SELECT arg.*,
                agh.is_accessible
                FROM access_requests_groups arg
                INNER JOIN accessible_groups_helper agh ON arg.group_id = agh.group_id
            ''',
            'access_requests_details': '''
                SELECT
                    ar.*,
                    COUNT(argd.group_id) AS groups_count,
                    SUM(argd.is_accessible) AS accessible_groups_count
                FROM access_requests ar
                LEFT JOIN access_requests_groups_details argd ON ar.access_request_id = argd.access_request_id
                GROUP BY ar.access_request_id
            ''',
            'my_access_requests': '''
                SELECT ard.*
                FROM access_requests_details ard
                WHERE ard.profile_id = cur_profile('profile_id')
                AND cur_profile('is_public') = 0
            ''',
            'accessible_my_access_requests': '''
                SELECT mar.*
                FROM my_access_requests mar;
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
            ''',
            'ensure_access_requests_closed': '''
                SELECT *
                FROM access_requests
            ''',
        }
    
    @classmethod
    def TRIGGERS(self) -> dict:
        return {
            # accessible_faces
            'trg_update_accessible_faces': """
                INSTEAD OF UPDATE ON accessible_faces
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                        WHEN NOT EXISTS (SELECT face_id FROM accessible_faces WHERE face_id = OLD.face_id) THEN
                            RAISE(ABORT, 'Permission denied: the face is not accessible')
                        WHEN NEW.group_ID IS NOT NULL AND (SELECT is_accessible FROM accessible_groups_helper WHERE group_id = NEW.group_ID) = 0 THEN
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
                        WHEN cur_profile('can_upload_and_delete_images') = 0 THEN
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
                        WHEN cur_profile('can_upload_and_delete_images') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to upload images')
                    END;

                    INSERT INTO faces (face_id, image_id, group_id, width, height, left, top)
                    VALUES (NEW.face_id, NEW.image_id, NEW.group_id, NEW.width, NEW.height, NEW.left, NEW.top);
                END;
            """,

            # accessible_images
            'trg_update_accessible_images': """
                INSTEAD OF UPDATE ON accessible_images
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('can_edit') = 0 THEN
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
                        WHEN cur_profile('can_upload_and_delete_images') = 0 THEN
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
                        WHEN cur_profile('can_upload_and_delete_images') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to upload images')
                    END;

                    INSERT INTO images (image_id, date_taken, label, file_size, width, height, moment_id, upload_id)
                    VALUES (NEW.image_id, NEW.date_taken, NEW.label, NEW.file_size, NEW.width, NEW.height, NEW.moment_id, NEW.upload_id);
                END;
            """,

            # accessible_groups
            'trg_update_accessible_groups': """
                INSTEAD OF UPDATE ON accessible_groups
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;

                    UPDATE groups
                    SET label = NEW.label,
                        representative_face = NEW.representative_face
                    WHERE group_id = OLD.group_id
                    AND EXISTS (
                        SELECT 1 FROM accessible_groups_helper g
                        WHERE g.group_id = OLD.group_id
                        AND g.is_accessible = 1
                    );
                END;
            """,
            'trg_delete_accessible_groups': """
                INSTEAD OF DELETE ON accessible_groups
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;

                    DELETE FROM groups
                    WHERE group_id = OLD.group_id
                    AND EXISTS (
                        SELECT 1 FROM accessible_groups_helper g
                        WHERE g.group_id = OLD.group_id
                        AND g.is_accessible = 1
                    );
                END;
            """,
            'trg_insert_accessible_groups': """
                INSTEAD OF INSERT ON accessible_groups
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;

                    INSERT INTO groups (group_id, label, representative_face)
                    VALUES (NEW.group_id, NEW.label, NEW.representative_face);
                END;
            """,

            # accessible_moments
            'trg_update_accessible_moments': """
                INSTEAD OF UPDATE ON accessible_moments
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('can_edit') = 0 THEN
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
                        WHEN cur_profile('can_edit') = 0 THEN
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
                        WHEN cur_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;

                    INSERT INTO moments (moment_id, label, description, start, end, representative_image)
                    VALUES (NEW.moment_id, NEW.label, NEW.description, NEW.start, NEW.end, NEW.representative_image);
                END;
            """,

            # accessible_albums
            'trg_update_accessible_albums': """
                INSTEAD OF UPDATE ON accessible_albums
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('can_edit') = 0 THEN
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
                        WHEN cur_profile('can_edit') = 0 THEN
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
                        WHEN cur_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;
                    INSERT INTO albums (album_id, label, description, representative_image)
                    VALUES (NEW.album_id, NEW.label, NEW.description, NEW.representative_image);
                END;
            """,

            # accessible_albums_images
            'trg_insert_accessible_albums_images': """
                INSTEAD OF INSERT ON accessible_albums_images
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('can_edit') = 0 THEN
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
                        WHEN cur_profile('can_edit') = 0 THEN
                            RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    END;

                    DELETE FROM albums_images
                    WHERE album_id = OLD.album_id
                    AND image_id = OLD.image_id;
                END;
            """,

            # accessible_profiles
            'trg_insert_accessible_profiles': """
                INSTEAD OF INSERT ON accessible_profiles
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN NEW.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                            RAISE(ABORT, 'Permission denied: cannot create profile with higher or equal rank')
                        WHEN NEW.all_images = 1 and cur_profile('all_images') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot create profile with all_images=1 if current profile does not have all_images=1')
                        WHEN NEW.all_groups = 1 and cur_profile('all_groups') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot create profile with all_groups=1 if current profile does not have all_groups=1')
                        WHEN NEW.all_albums = 1 and cur_profile('all_albums') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot create profile with all_albums=1 if current profile does not have all_albums=1')
                    END;

                    INSERT INTO profiles (profile_id, hierarchy_rank, can_upload_and_delete_images, can_edit, all_images, all_groups, all_albums, is_public, public_access_code)
                    VALUES (NEW.profile_id, NEW.hierarchy_rank, NEW.can_upload_and_delete_images, NEW.can_edit, NEW.all_images, NEW.all_groups, NEW.all_albums, NEW.is_public, CASE WHEN NEW.is_public = 1 THEN NEW.public_access_code ELSE NULL END);

                    -- Create the profile_images and profile_albums tables
                    INSERT INTO profile_images (profile_id, image_id, accessible)
                    SELECT NEW.profile_id, image_id, accessible
                    FROM profile_images
                    WHERE profile_id = cur_profile('profile_id');

                    INSERT INTO profile_groups (profile_id, group_id, accessible)
                    SELECT NEW.profile_id, group_id, accessible
                    FROM profile_groups
                    WHERE profile_id = cur_profile('profile_id');
                    
                    INSERT INTO profile_albums (profile_id, album_id, accessible)
                    SELECT NEW.profile_id, album_id, accessible
                    FROM profile_albums
                    WHERE profile_id = cur_profile('profile_id');

                END;
            """,
            'trg_update_accessible_profiles': """
                INSTEAD OF UPDATE ON accessible_profiles
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN OLD.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                            RAISE(ABORT, 'Permission denied: cannot edit profile with higher or equal rank')
                        WHEN NEW.hierarchy_rank >= cur_profile('hierarchy_rank') AND NEW.profile_id <> cur_profile('profile_id') THEN
                            RAISE(ABORT, 'Permission denied: cannot set profile rank higher or equal to own rank')
                        WHEN NEW.all_images = 1 AND cur_profile('all_images') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot set profile all_images=1 if current profile does not have all_images=1')
                        WHEN NEW.all_groups = 1 AND cur_profile('all_groups') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot set profile all_groups=1 if current profile does not have all_groups=1')
                        WHEN NEW.all_albums = 1 AND cur_profile('all_albums') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot set profile all_albums=1 if current profile does not have all_albums=1')
                    END;

                    UPDATE profiles
                    SET hierarchy_rank = NEW.hierarchy_rank,
                        can_upload_and_delete_images = NEW.can_upload_and_delete_images,
                        can_edit = NEW.can_edit,
                        all_images = NEW.all_images,
                        all_groups = NEW.all_groups,
                        all_albums = NEW.all_albums,
                        is_public = NEW.is_public,
                        public_access_code = CASE WHEN NEW.is_public = 1 THEN NEW.public_access_code ELSE NULL END
                    WHERE profile_id = OLD.profile_id;

                    DELETE FROM profile_images 
                    WHERE profile_id = OLD.profile_id 
                    AND OLD.profile_id <> cur_profile('profile_id')
                    AND NEW.all_images <> OLD.all_images;

                    INSERT INTO profile_images (profile_id, image_id, accessible)
                    SELECT OLD.profile_id, image_id, accessible
                    FROM profile_images 
                    WHERE profile_id = cur_profile('profile_id')
                    AND OLD.profile_id <> cur_profile('profile_id')
                    AND NEW.all_images = 1 
                    AND NEW.all_images <> OLD.all_images;

                    DELETE FROM profile_groups 
                    WHERE profile_id = OLD.profile_id 
                    AND OLD.profile_id <> cur_profile('profile_id')
                    AND NEW.all_groups <> OLD.all_groups;

                    INSERT INTO profile_groups (profile_id, group_id, accessible)
                    SELECT OLD.profile_id, group_id, accessible
                    FROM profile_groups 
                    WHERE profile_id = cur_profile('profile_id')
                    AND OLD.profile_id <> cur_profile('profile_id')
                    AND NEW.all_groups = 1
                    AND NEW.all_groups <> OLD.all_groups;

                    DELETE FROM profile_albums 
                    WHERE profile_id = OLD.profile_id 
                    AND OLD.profile_id <> cur_profile('profile_id')
                    AND NEW.all_albums <> OLD.all_albums;

                    INSERT INTO profile_albums (profile_id, album_id, accessible)
                    SELECT OLD.profile_id, album_id, accessible
                    FROM profile_albums 
                    WHERE profile_id = cur_profile('profile_id')
                    AND OLD.profile_id <> cur_profile('profile_id')
                    AND NEW.all_albums = 1
                    AND NEW.all_albums <> OLD.all_albums;
                END;
            """,
            'trg_delete_accessible_profiles': """
                INSTEAD OF DELETE ON accessible_profiles
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN OLD.profile_id = cur_profile('profile_id') THEN
                            RAISE(ABORT, 'Permission denied: cannot delete own profile')
                        WHEN OLD.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                            RAISE(ABORT, 'Permission denied: cannot delete profile with higher or equal rank')
                    END;

                    DELETE FROM profiles WHERE profile_id = OLD.profile_id;
                END;
            """,

            # accessible_profile_images
            'trg_insert_accessible_profile_images': """
                INSTEAD OF INSERT ON accessible_profile_images
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN NEW.profile_id = cur_profile('profile_id') THEN
                            RAISE(ABORT, 'Permission denied: cannot edit own permissions')
                        WHEN EXISTS (
                            SELECT 1 FROM profiles
                            WHERE profile_id = NEW.profile_id AND hierarchy_rank >= cur_profile('hierarchy_rank')
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot edit permissions for profile with higher or equal rank')
                        WHEN NOT EXISTS ( -- Check if image is accessible to current manager
                            SELECT 1 FROM accessible_images WHERE image_id = NEW.image_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot grant access to an inaccessible image')
                    END;

                    INSERT OR IGNORE INTO profile_images (profile_id, image_id, accessible)
                    VALUES (NEW.profile_id, NEW.image_id, NEW.accessible);
                END;
            """,
            'trg_delete_accessible_profile_images': """
                INSTEAD OF DELETE ON accessible_profile_images
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN OLD.profile_id = cur_profile('profile_id') THEN
                            RAISE(ABORT, 'Permission denied: cannot edit own permissions')
                        WHEN EXISTS (
                            SELECT 1 FROM profiles
                            WHERE profile_id = OLD.profile_id AND hierarchy_rank >= cur_profile('hierarchy_rank')
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot edit permissions for profile with higher or equal rank')
                        WHEN NOT EXISTS (
                            SELECT 1 FROM accessible_images WHERE image_id = OLD.image_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot revoke access to an inaccessible image')
                    END;

                    DELETE FROM profile_images WHERE profile_id = OLD.profile_id AND image_id = OLD.image_id;
                END;
            """,

            # accessible_profile_groups
            'trg_insert_accessible_profile_groups': """
                INSTEAD OF INSERT ON accessible_profile_groups
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN NEW.profile_id = cur_profile('profile_id') THEN
                            RAISE(ABORT, 'Permission denied: cannot edit own permissions')
                        WHEN EXISTS (
                            SELECT 1 FROM profiles
                            WHERE profile_id = NEW.profile_id AND hierarchy_rank >= cur_profile('hierarchy_rank')
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot edit permissions for profile with higher or equal rank')
                        WHEN NOT EXISTS ( -- Check if group is accessible to current manager
                            SELECT 1 FROM accessible_groups WHERE group_id = NEW.group_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot grant access to an inaccessible group')
                    END;

                    INSERT OR IGNORE INTO profile_groups (profile_id, group_id, accessible)
                    VALUES (NEW.profile_id, NEW.group_id, NEW.accessible);
                END;
            """,
            'trg_delete_accessible_profile_groups': """
                INSTEAD OF DELETE ON accessible_profile_groups
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN OLD.profile_id = cur_profile('profile_id') THEN
                            RAISE(ABORT, 'Permission denied: cannot edit own permissions')
                        WHEN EXISTS (
                            SELECT 1 FROM profiles
                            WHERE profile_id = OLD.profile_id AND hierarchy_rank >= cur_profile('hierarchy_rank')
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot edit permissions for profile with higher or equal rank')
                        WHEN NOT EXISTS (
                            SELECT 1 FROM accessible_groups WHERE group_id = OLD.group_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot revoke access to an inaccessible group')
                    END;

                    DELETE FROM profile_groups WHERE profile_id = OLD.profile_id AND group_id = OLD.group_id;
                END;
            """,

            # accessible_profile_albums
            'trg_insert_accessible_profile_albums': """
                INSTEAD OF INSERT ON accessible_profile_albums
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN NEW.profile_id = cur_profile('profile_id') THEN
                            RAISE(ABORT, 'Permission denied: cannot edit own permissions')
                        WHEN EXISTS (
                            SELECT 1 FROM profiles
                            WHERE profile_id = NEW.profile_id AND hierarchy_rank >= cur_profile('hierarchy_rank')
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot edit permissions for profile with higher or equal rank')
                        WHEN NOT EXISTS (
                            SELECT 1 FROM accessible_albums WHERE album_id = NEW.album_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot grant access to an inaccessible album')
                    END;

                    INSERT OR IGNORE INTO profile_albums (profile_id, album_id, accessible)
                    VALUES (NEW.profile_id, NEW.album_id, NEW.accessible);
                END;
            """,
            'trg_delete_accessible_profile_albums': """
                INSTEAD OF DELETE ON accessible_profile_albums
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') = 0 THEN
                            RAISE(ABORT, 'Permission denied: not a profiles manager')
                        WHEN OLD.profile_id = cur_profile('profile_id') THEN
                            RAISE(ABORT, 'Permission denied: cannot edit own permissions')
                        WHEN EXISTS (
                            SELECT 1 FROM profiles
                            WHERE profile_id = OLD.profile_id AND hierarchy_rank >= cur_profile('hierarchy_rank')
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot edit permissions for profile with higher or equal rank')
                        WHEN NOT EXISTS (
                            SELECT 1 FROM accessible_albums WHERE album_id = OLD.album_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot revoke access to an inaccessible album')
                    END;

                    DELETE FROM profile_albums WHERE profile_id = OLD.profile_id AND album_id = OLD.album_id;
                END;
            """,

            # accessible_uploads
            'trg_insert_accessible_uploads': """
                INSTEAD OF INSERT ON accessible_uploads
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('can_upload_and_delete_images') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot upload and delete images')
                        WHEN NOT EXISTS (
                            SELECT 1 FROM profiles
                            WHERE profile_id = NEW.profile_id
                            AND (hierarchy_rank < cur_profile('hierarchy_rank') OR profile_id = cur_profile('profile_id'))
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot access this profile')
                    END;

                    INSERT OR IGNORE INTO uploads (profile_id, started_at, completed_at, status, images_count, faces_count, clusters_count, moments_count, errors, notes)
                    VALUES (NEW.profile_id, NEW.started_at, NEW.completed_at, NEW.status, NEW.images_count, NEW.faces_count, NEW.clusters_count, NEW.moments_count, NEW.errors, NEW.notes);
                    
                END;
            """,
            'trg_delete_accessible_uploads': """
                INSTEAD OF DELETE ON accessible_uploads
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('can_upload_and_delete_images') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot upload and delete images')
                        WHEN NOT EXISTS (
                            SELECT 1 FROM profiles
                            WHERE profile_id = OLD.profile_id
                            AND (hierarchy_rank < cur_profile('hierarchy_rank') OR profile_id = cur_profile('profile_id'))
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot access this profile')
                    END;

                    DELETE FROM uploads WHERE upload_id = OLD.upload_id;
                END;
            """,
            'trg_update_accessible_uploads': """
                INSTEAD OF UPDATE ON accessible_uploads
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('can_upload_and_delete_images') = 0 THEN
                            RAISE(ABORT, 'Permission denied: cannot upload and delete images')
                        WHEN NOT EXISTS (
                            SELECT 1 FROM profiles
                            WHERE profile_id = OLD.profile_id
                            AND (hierarchy_rank < cur_profile('hierarchy_rank') OR profile_id = cur_profile('profile_id'))
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot access this profile')
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
                    WHEN NEW.profile_id <> cur_profile('profile_id') OR (NEW.applicant_profile_id IS NOT NULL AND NEW.applicant_profile_id <> cur_profile('profile_id')) THEN
                        RAISE(ABORT, 'Permission denied: cannot create access request for another profile')
                    WHEN
                        cur_profile('is_public') = 1 AND (
                            NEW.applicant_name IS NULL
                            OR NEW.applicant_email IS NULL
                        )
                    THEN
                        RAISE(ABORT, 'Permission denied: access request by public profile is only allowed for another profile with name and email required')
                    END;

                    INSERT INTO access_requests
                    (profile_id, requested_at, applicant_name, applicant_email, applicant_phone, details, applicant_profile_id)
                    VALUES (
                        NEW.profile_id,
                        COALESCE(NEW.requested_at, CURRENT_TIMESTAMP),
                        CASE WHEN cur_profile('is_public') = 1 THEN NEW.applicant_name ELSE NULL END,
                        CASE WHEN cur_profile('is_public') = 1 THEN NEW.applicant_email ELSE NULL END,
                        CASE WHEN cur_profile('is_public') = 1 THEN NEW.applicant_phone ELSE NULL END,
                        NEW.details,
                        CASE WHEN cur_profile('is_public') = 0 THEN NEW.applicant_profile_id ELSE NULL END
                    );
                END;
            """,
            'trg_update_accessible_my_access_requests': """
                INSTEAD OF UPDATE ON accessible_my_access_requests
                BEGIN
                    SELECT CASE
                        WHEN OLD.profile_id <> cur_profile('profile_id') THEN
                            RAISE(ABORT, 'Permission denied: cannot update access request for another profile')
                        WHEN OLD.is_closed = 1 THEN
                            RAISE(ABORT, 'Permission denied: cannot update closed access request')
                    END;

                    UPDATE access_requests SET
                        applicant_name = CASE WHEN cur_profile('is_public') = 1 THEN NEW.applicant_name ELSE NULL END,
                        applicant_email = CASE WHEN cur_profile('is_public') = 1 THEN NEW.applicant_email ELSE NULL END,
                        applicant_phone = CASE WHEN cur_profile('is_public') = 1 THEN NEW.applicant_phone ELSE NULL END,
                        details = NEW.details
                    WHERE access_request_id = OLD.access_request_id;
                END;
            """,
            'trg_delete_accessible_my_access_requests': """
                INSTEAD OF DELETE ON accessible_my_access_requests
                BEGIN
                    SELECT CASE
                        WHEN OLD.profile_id <> cur_profile('profile_id') THEN
                            RAISE(ABORT, 'Permission denied: cannot delete access request for another profile')
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
                        WHEN
                            (
                                SELECT ar.profile_id
                                FROM access_requests ar
                                WHERE NEW.access_request_id = ar.access_request_id
                            ) <> cur_profile('profile_id')
                        THEN
                            RAISE(ABORT, 'Permission denied: cannot edit access request for another profile')
                        WHEN (SELECT is_closed FROM access_requests WHERE access_request_id = NEW.access_request_id) = 1 THEN
                            RAISE(ABORT, 'Permission denied: cannot edit closed access request')
                    END;

                    INSERT INTO access_requests_groups
                    (access_request_id, group_id)
                    SELECT NEW.access_request_id, agh.group_id
                    FROM accessible_groups_helper agh
                    WHERE agh.group_id = NEW.group_id
                    AND agh.is_accessible = 0;
                END;
            """,
            'trg_delete_accessible_my_access_requests_groups': """
                INSTEAD OF DELETE ON accessible_my_access_requests_groups
                BEGIN
                    SELECT CASE
                        WHEN 
                            (
                                SELECT ar.profile_id
                                FROM access_requests ar
                                WHERE OLD.access_request_id = ar.access_request_id
                            ) <> cur_profile('profile_id')
                        THEN
                            RAISE(ABORT, 'Permission denied: cannot edit access request for another profile')
                        WHEN (SELECT is_closed FROM access_requests WHERE access_request_id = OLD.access_request_id) = 1 THEN
                            RAISE(ABORT, 'Permission denied: cannot edit closed access request')
                    END;

                    DELETE FROM access_requests_groups WHERE access_request_id = OLD.access_request_id AND group_id = OLD.group_id;
                END;
            """,

            # accessible_access_requests
            'trg_update_accessible_access_requests': """
                INSTEAD OF UPDATE ON accessible_access_requests
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') < (
                            SELECT hierarchy_rank FROM profiles WHERE profile_id = OLD.profile_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible to the current profile')
                        WHEN OLD.is_closed = 1 THEN
                            RAISE(ABORT, 'Permission denied: cannot edit closed access request')
                    END;

                    UPDATE access_requests SET
                        applicant_profile_id = NEW.applicant_profile_id,
                        is_closed = NEW.is_closed,
                        closed_at = COALESCE(NEW.closed_at, CURRENT_TIMESTAMP),
                        closed_details = NEW.closed_details
                    WHERE access_request_id = OLD.access_request_id;
                
                    UPDATE accessible_access_requests_groups SET
                        approved = 0
                    WHERE access_request_id = OLD.access_request_id
                    AND approved IS NULL
                    AND NEW.is_closed = 1;

                END;
            """,
            'trg_delete_accessible_access_requests': """
                INSTEAD OF DELETE ON accessible_access_requests
                BEGIN
                    SELECT CASE
                        WHEN cur_profile('hierarchy_rank') < (
                            SELECT hierarchy_rank FROM profiles WHERE profile_id = OLD.profile_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: the profile is not accessible to the current profile')
                    END;

                    DELETE FROM access_requests WHERE access_request_id = OLD.access_request_id;
                END;
            """,

            # accessible_access_requests_groups
            'trg_update_accessible_access_requests_groups': """
                INSTEAD OF UPDATE ON accessible_access_requests_groups
                BEGIN
                    SELECT CASE
                        WHEN NOT EXISTS (
                            SELECT 1 FROM accessible_access_requests aar
                            WHERE aar.access_request_id = OLD.access_request_id
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot update permissions for an inaccessible access request')
                        WHEN NEW.approved = 1 AND NOT EXISTS (
                            SELECT 1 FROM accessible_groups_helper ag
                            WHERE ag.group_id = OLD.group_id
                            AND ag.is_accessible = 1
                        ) THEN
                            RAISE(ABORT, 'Permission denied: cannot update permissions for an inaccessible group')
                        WHEN OLD.approved IS NOT NULL THEN
                            RAISE(ABORT, 'Permission denied: cannot update approved access request group')
                    END;

                    INSERT INTO profile_groups (profile_id, group_id, accessible)
                    SELECT
                        aar.applicant_profile_id as profile_id,
                        OLD.group_id as group_id,
                        CASE WHEN ap.all_groups = 0 AND NEW.approved = 1 THEN 1 ELSE 0 END as accessible
                    FROM accessible_access_requests aar
                    INNER JOIN accessible_profiles ap
                        ON ap.profile_id = aar.applicant_profile_id
                        AND aar.access_request_id = OLD.access_request_id
                    LEFT JOIN profile_groups pg ON pg.profile_id = aar.applicant_profile_id AND pg.group_id = OLD.group_id
                    WHERE pg.profile_id IS NULL AND NEW.approved IS NOT NULL
                    AND ((ap.all_groups = 0 AND NEW.approved = 1) OR (ap.all_groups = 1 AND NEW.approved = 0));
                
                    DELETE FROM profile_groups
                    WHERE profile_id = (SELECT ar.applicant_profile_id FROM access_requests ar WHERE OLD.access_request_id = ar.access_request_id)
                    AND group_id = OLD.group_id
                    AND EXISTS (
                        SELECT 1
                        FROM accessible_profiles ap
                        INNER JOIN accessible_access_requests aar
                            ON aar.applicant_profile_id = ap.profile_id
                            AND aar.access_request_id = OLD.access_request_id
                        WHERE
                            ap.all_groups = 1 AND NEW.approved = 1
                            OR (ap.all_groups = 0 AND NEW.approved = 0)
                    );

                    INSERT INTO ensure_access_requests_closed (access_request_id, closed_at)
                    VALUES (OLD.access_request_id, NEW.closed_at);
                END;
            """,

            # ensure_profiles_policy
            'trg_insert_ensure_profiles_publicity': """
                BEFORE INSERT ON profiles
                BEGIN
                    SELECT CASE
                        WHEN NEW.is_public = 1 AND NEW.hierarchy_rank > 0 THEN
                            RAISE(ABORT, 'Policy error: cannot set manager profile to public')
                    END;
                END;
            """,
            'trg_insert_ensure_profiles_public_access_code': """
                AFTER INSERT ON profiles
                BEGIN
                    UPDATE profiles
                    SET public_access_code = NULL
                    WHERE profile_id = NEW.profile_id
                    AND is_public = 0;
                END;
            """,
            'trg_update_ensure_profiles_publicity': """
                BEFORE UPDATE ON profiles
                BEGIN
                    SELECT CASE
                        WHEN NEW.is_public = 1 AND NEW.hierarchy_rank > 0 THEN
                            RAISE(ABORT, 'Policy error: cannot set manager profile to public')
                    END;
                END;
            """,
            'trg_update_ensure_profiles_public_access_code': """
                AFTER UPDATE ON profiles
                BEGIN
                    UPDATE profiles
                    SET public_access_code = NULL
                    WHERE profile_id = OLD.profile_id
                    AND is_public = 0;
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
                    WHERE access_request_id = COALESCE(NEW.access_request_id, access_request_id)
                    AND NOT EXISTS (
                        SELECT 1 FROM access_requests_groups arg
                        WHERE arg.access_request_id = access_requests.access_request_id
                        AND arg.approved IS NULL
                    );
                END;
            """,
            'trg_update_profile_ensure_access_requests_groups_validity': """
                AFTER UPDATE ON profiles
                BEGIN
                    UPDATE access_requests_groups SET
                        approved = 1,
                        closed_at = CURRENT_TIMESTAMP,
                        closed_by = cur_profile('profile_id'),
                        closed_details = 'Indirect approval by setting all_groups = 1'
                    WHERE (
                        (SELECT ar.applicant_profile_id FROM access_requests ar WHERE access_requests_groups.access_request_id = ar.access_request_id)
                        = NEW.profile_id
                    AND approved IS NULL)
                    AND (OLD.all_groups = 0 AND NEW.all_groups = 1);

                    INSERT INTO ensure_access_requests_closed (access_request_id, closed_at)
                    VALUES (NULL, NULL);
                END;
            """,
            'trg_insert_profile_groups_ensure_access_requests_groups_validity': """
                AFTER INSERT ON profile_groups
                BEGIN
                    UPDATE access_requests_groups SET
                        approved = 1,
                        closed_at = CURRENT_TIMESTAMP,
                        closed_by = cur_profile('profile_id'),
                        closed_details = 'Indirect approval by adding group to profile'
                    WHERE
                        group_id = NEW.group_id
                        AND (
                            SELECT ar.applicant_profile_id
                            FROM access_requests ar
                            INNER JOIN profiles p ON p.profile_id = ar.applicant_profile_id
                            WHERE ar.access_request_id = access_requests_groups.access_request_id
                            AND p.all_groups = 0
                        ) = NEW.profile_id
                        AND approved IS NULL
                    ;

                    INSERT INTO ensure_access_requests_closed (access_request_id, closed_at)
                    VALUES (NULL, NULL);
                END;
            """,
            'trg_delete_profile_groups_ensure_access_requests_groups_validity': """
                AFTER DELETE ON profile_groups
                BEGIN
                    UPDATE access_requests_groups SET
                        approved = 1,
                        closed_at = CURRENT_TIMESTAMP,
                        closed_by = cur_profile('profile_id'),
                        closed_details = 'Indirect approval by adding group to profile'
                    WHERE (
                        OLD.profile_id = (
                            SELECT ar.applicant_profile_id
                            FROM access_requests ar
                            INNER JOIN profiles p ON p.profile_id = ar.applicant_profile_id
                            WHERE ar.access_request_id = access_requests_groups.access_request_id
                            AND p.all_groups = 1
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
                        WHEN LOWER(OLD.label) = 'archive' OR LOWER(OLD.label) = 'favorites' THEN
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
                        WHEN LOWER(OLD.label) = 'unassociated' THEN
                            RAISE(ABORT, 'Policy error: cannot delete default group')
                    END;
                END;
            """,
        }

    @classmethod
    def create_db(cls, db_path: str) -> tuple[str, str, str]:
        """Create a new event database with all tables and initial data.
        Returns:
            archive_album_id: str
            favorites_album_id: str
            unassociated_group_id: str
        """
        super().create_db(db_path)

        # Insert default settings row
        archive_album_id = str(uuid.uuid4())
        favorites_album_id = str(uuid.uuid4())
        unassociated_group_id = str(uuid.uuid4())
        conn = sqlite3.connect(db_path)
        conn.execute('''
                INSERT OR IGNORE INTO albums (album_id, label)
                VALUES (?, ?), (?, ?)
            ''', (archive_album_id, 'Archive', favorites_album_id, 'Favorites'))
        conn.execute('''
                INSERT OR IGNORE INTO groups (group_id, label)
                VALUES (?, ?)
            ''', (unassociated_group_id, 'Unassociated'))

        conn.commit()
        conn.close()
        
        return archive_album_id, favorites_album_id, unassociated_group_id

    def __init__(self, db_path: str, profile_id: str | None = None, public_code: str | None = None):
        super().__init__(db_path)
        if not profile_id:
            if not public_code:
                raise Forbidden('Access denied: no profile ID or public code provided')
            with super().get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('SELECT profile_id FROM profiles WHERE public_access_code = ?', (public_code,))
                result = cursor.fetchone()
                if result:
                    profile_id = result[0]
                else:
                    raise Forbidden(f'Access denied: public access code {public_code} is invalid')

        self.profile_id = profile_id
    
    @property
    def profile_id(self) -> str:
        """Get the current profile id for access control."""
        return self._profile_context['profile_id']

    @profile_id.setter
    def profile_id(self, profile_id: str):
        """Set the current profile id for access control."""
        
        fields = {
            'profile_id': '',
            'hierarchy_rank': 0,
            'can_upload_and_delete_images': False,
            'can_edit': False,
            'all_images': False,
            'all_groups': False,
            'all_albums': False,
            'is_public': False,
        }
        profile = self.execute_query('SELECT * FROM profiles WHERE profile_id = ?', (profile_id,), return_format=ReturnFormat.DICT)

        if not profile:
            raise Exception(f'Profile {profile_id} not found')
        
        self._profile_context = {}
        for field, default_val in fields.items():
            val = profile.get(field, default_val)
            self._profile_context[field] = val

    @property
    def profile_context(self) -> dict:
        return self._profile_context

    @contextmanager
    def get_connection(self):
        """Context manager for database connections with profile context."""
        with super().get_connection() as conn:
            conn.create_function("cur_profile", 1, lambda key: self.profile_context.get(key))
            yield conn
