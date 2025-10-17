import sqlite3
import uuid
from contextlib import contextmanager
from .base_db import BaseDB, ReturnFormat

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
                'fields': ['label', 'images_count', 'active_images_count', 'representative_face', 'representative_image'],
                'representative': {'field': 'representative_face', 'table': 'faces'},
                'relations': {
                    'images': {'relation_table': 'groups_images', 'fields_needed': ['date_taken', 'is_archived', 'is_favorite']},
                    'faces': {'relation_table': 'faces', 'fields_needed': []}
                },
            },
            'moments': {
                'primary_key': 'moment_id',
                'accessible_table': 'accessible_moments',
                'fields': ['label', 'description', 'start', 'end', 'images_count', 'active_images_count', 'representative_image'],
                'representative': {'field': 'representative_image', 'table': 'images'},
                'relations': {
                    'images': {'relation_table': 'images', 'fields_needed': ['date_taken', 'is_archived', 'is_favorite']},
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
                'primary_key': 'album_id',
                'accessible_table': 'accessible_albums_actual',
                'fields': ['label'],
            },
            'albums_images_actual': {
                'primary_key': ['album_id', 'image_id'],
                'accessible_table': 'accessible_albums_images_actual',
            },
            'profiles': {
                'primary_key': 'profile_id',
                'accessible_table': 'accessible_profiles',
                'fields': ['hierarchy_rank', 'can_upload_and_delete_images', 'can_edit', 'all_images', 'all_albums', 'save_preferences'],
                'relations': {
                    'images': {'relation_table': 'profile_images', 'fields_needed': ['date_taken']},
                    'albums': {'relation_table': 'profile_albums', 'fields_needed': ['label']},
                },
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
            'profile_albums': {
                'primary_key': ['profile_id', 'album_id'],
                'accessible_table': 'accessible_profile_albums',
            },
        }
    
    @classmethod
    def TABLES(self) -> dict:
        return {
            'faces': '''
                face_id TEXT PRIMARY KEY,
                image_id TEXT,
                width REAL,
                height REAL,
                left REAL,
                top REAL,
                group_id TEXT,
                FOREIGN KEY (image_id) REFERENCES images(image_id) ON DELETE SET NULL,
                FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE SET NULL
            ''',
            'images': '''
                image_id TEXT PRIMARY KEY,
                label TEXT,
                date_taken TEXT,
                file_size INTEGER,
                width INTEGER,
                height INTEGER,
                moment_id TEXT,
                FOREIGN KEY (moment_id) REFERENCES moments(moment_id) ON DELETE SET NULL
            ''',
            'groups': '''
                group_id TEXT PRIMARY KEY,
                label TEXT COLLATE NOCASE UNIQUE,
                representative_face TEXT,
                FOREIGN KEY (representative_face) REFERENCES faces(face_id) ON DELETE SET NULL
            ''',
            'moments': '''
                moment_id TEXT PRIMARY KEY,
                label TEXT COLLATE NOCASE UNIQUE,
                description TEXT,
                start TEXT,
                end TEXT,
                representative_image TEXT,
                FOREIGN KEY (representative_image) REFERENCES images(image_id) ON DELETE SET NULL
            ''',
            'albums': '''
                album_id TEXT PRIMARY KEY,
                label TEXT COLLATE NOCASE UNIQUE,
                description TEXT,
                representative_image TEXT,
                FOREIGN KEY (representative_image) REFERENCES images(image_id) ON DELETE SET NULL
            ''',
            'albums_images': '''
                album_id TEXT,
                image_id TEXT,
                FOREIGN KEY (album_id) REFERENCES albums(album_id) ON DELETE CASCADE,
                FOREIGN KEY (image_id) REFERENCES images(image_id) ON DELETE CASCADE,
                PRIMARY KEY (album_id, image_id)
            ''',
            'profiles': '''
                profile_id TEXT PRIMARY KEY,
                hierarchy_rank INTEGER DEFAULT 0,
                can_upload_and_delete_images BOOLEAN DEFAULT 0,
                can_edit BOOLEAN DEFAULT 0,
                all_images BOOLEAN,
                all_albums BOOLEAN,
                save_preferences BOOLEAN
            ''',
            'profile_images': '''
                profile_id TEXT,
                image_id TEXT,
                accessible BOOLEAN,
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
                FOREIGN KEY (image_id) REFERENCES images(image_id) ON DELETE CASCADE,
                PRIMARY KEY (profile_id, image_id)
            ''',
            'profile_albums': '''
                profile_id TEXT,
                album_id TEXT,
                accessible BOOLEAN,
                FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
                FOREIGN KEY (album_id) REFERENCES albums(album_id) ON DELETE CASCADE,
                PRIMARY KEY (profile_id, album_id)
            '''
        }
    
    @classmethod
    def INDEXES(self) -> list:
        return [
            'idx_faces_image_id ON faces(image_id)',
            'idx_faces_group_id ON faces(group_id)',
            'idx_profile_images_profile_id_image_id ON profile_images(profile_id, image_id)',
            'idx_profile_albums_profile_id_album_id ON profile_albums(profile_id, album_id)',
            'idx_images_moment_id ON images(moment_id)',
            'idx_groups_representative_face ON groups(representative_face)',
            'idx_moments_representative_image ON moments(representative_image)',
            'idx_faces_group_id_image_id ON faces(group_id, image_id)',
            'idx_images_date_taken ON images(date_taken)',
            'idx_albums_representative_image ON albums(representative_image)',
        ]
    
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
            'accessible_faces': '''
                SELECT f.*
                FROM faces f 
                INNER JOIN accessible_images i ON f.image_id = i.image_id
                LEFT JOIN groups g ON f.group_id = g.group_id
                WHERE cur_profile('can_edit') = 1 OR LOWER(g.label) != 'unassociated'
            ''',
            'groups_images': '''
                SELECT i.image_id as image_id, g.group_id as group_id
                FROM images i
                INNER JOIN faces ON i.image_id = faces.image_id
                INNER JOIN groups g ON faces.group_id = g.group_id
                GROUP BY i.image_id, g.group_id
            ''',
            'accessible_groups_images': '''
                SELECT groups_images.*
                FROM groups_images
                INNER JOIN accessible_images ON groups_images.image_id = accessible_images.image_id
            ''',
            'accessible_groups': '''
                SELECT 
                    g.*, af.image_id as representative_image,
                    COUNT(agi.image_id) AS images_count,
                    COUNT(agi.image_id) - COALESCE(SUM(ai.is_archived), 0) AS active_images_count
                FROM groups g
                LEFT JOIN accessible_groups_images agi 
                    ON g.group_id = agi.group_id
                LEFT JOIN accessible_images ai
                    ON agi.image_id = ai.image_id
                LEFT JOIN accessible_faces af
                    ON g.representative_face = af.face_id
                GROUP BY g.group_id
                HAVING images_count > 0
                OR (SELECT COUNT(*) FROM faces WHERE group_id = g.group_id) = 0;
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
            'accessible_profiles': '''
                SELECT
                    profile_id,
                    hierarchy_rank,
                    can_upload_and_delete_images,
                    can_edit,
                    all_images,
                    all_albums,
                    save_preferences
                FROM profiles p
                WHERE
                    cur_profile('profile_id') = p.profile_id OR p.hierarchy_rank < cur_profile('hierarchy_rank')
            ''',
            'accessible_profile_images': '''
                SELECT profile_images.*
                FROM profile_images
            ''',
            'accessible_profile_albums': '''
                SELECT profile_albums.*
                FROM profile_albums
            ''',
        }
    
    @classmethod
    def TRIGGERS(self) -> dict:
        return {
            # accessible_faces
            'trg_update_accessible_faces': """
            CREATE TRIGGER IF NOT EXISTS trg_update_accessible_faces
            INSTEAD OF UPDATE ON accessible_faces
            BEGIN
                SELECT CASE
                    WHEN cur_profile('can_edit') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                END;

                UPDATE faces
                SET group_id = NEW.group_id
                WHERE face_id = OLD.face_id;
            END;
            """,
            'trg_delete_accessible_faces': """
            CREATE TRIGGER IF NOT EXISTS trg_delete_accessible_faces
            INSTEAD OF DELETE ON accessible_faces
            BEGIN
                SELECT CASE
                    WHEN cur_profile('can_upload_and_delete_images') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                END;

                DELETE FROM faces
                WHERE face_id = OLD.face_id;
            END;
            """,
            'trg_insert_accessible_faces': """
            CREATE TRIGGER IF NOT EXISTS trg_insert_accessible_faces
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
            CREATE TRIGGER IF NOT EXISTS trg_update_accessible_images
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
            CREATE TRIGGER IF NOT EXISTS trg_delete_accessible_images
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
            CREATE TRIGGER IF NOT EXISTS trg_insert_accessible_images
            INSTEAD OF INSERT ON accessible_images
            BEGIN
                SELECT CASE
                    WHEN cur_profile('can_upload_and_delete_images') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to upload images')
                END;

                INSERT INTO images (image_id, date_taken, label, file_size, width, height, moment_id)
                VALUES (NEW.image_id, NEW.date_taken, NEW.label, NEW.file_size, NEW.width, NEW.height, NEW.moment_id);
            END;
            """,

            # accessible_groups
            'trg_update_accessible_groups': """
            CREATE TRIGGER IF NOT EXISTS trg_update_accessible_groups
            INSTEAD OF UPDATE ON accessible_groups
            BEGIN
                SELECT CASE
                    WHEN cur_profile('can_edit') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                END;

                UPDATE groups
                SET label = NEW.label,
                    representative_face = NEW.representative_face
                WHERE group_id = OLD.group_id;
            END;
            """,
            'trg_delete_accessible_groups': """
            CREATE TRIGGER IF NOT EXISTS trg_delete_accessible_groups
            INSTEAD OF DELETE ON accessible_groups
            BEGIN
                SELECT CASE
                    WHEN cur_profile('can_edit') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                END;

                DELETE FROM groups
                WHERE group_id = OLD.group_id;
            END;
            """,
            'trg_insert_accessible_groups': """
            CREATE TRIGGER IF NOT EXISTS trg_insert_accessible_groups
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
            CREATE TRIGGER IF NOT EXISTS trg_update_accessible_moments
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
            CREATE TRIGGER IF NOT EXISTS trg_delete_accessible_moments
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
            CREATE TRIGGER IF NOT EXISTS trg_insert_accessible_moments
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
            CREATE TRIGGER IF NOT EXISTS trg_update_accessible_albums
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
            CREATE TRIGGER IF NOT EXISTS trg_delete_accessible_albums
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
            CREATE TRIGGER IF NOT EXISTS trg_insert_accessible_albums
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
            CREATE TRIGGER IF NOT EXISTS trg_insert_accessible_albums_images
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
            CREATE TRIGGER IF NOT EXISTS trg_delete_accessible_albums_images
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
            CREATE TRIGGER IF NOT EXISTS trg_insert_accessible_profiles
            INSTEAD OF INSERT ON accessible_profiles
            BEGIN
                SELECT CASE
                    WHEN cur_profile('hierarchy_rank') = 0 THEN
                        RAISE(ABORT, 'Permission denied: not a profiles manager')
                    WHEN NEW.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                        RAISE(ABORT, 'Permission denied: cannot create profile with higher or equal rank')
                    WHEN NEW.all_images = 1 and cur_profile('all_images') = 0 THEN
                        RAISE(ABORT, 'Permission denied: cannot create profile with all_images=1 if current profile does not have all_images=1')
                    WHEN NEW.all_albums = 1 and cur_profile('all_albums') = 0 THEN
                        RAISE(ABORT, 'Permission denied: cannot create profile with all_albums=1 if current profile does not have all_albums=1')
                END;

                INSERT INTO profiles (profile_id, hierarchy_rank, can_upload_and_delete_images, can_edit, all_images, all_albums, save_preferences)
                VALUES (NEW.profile_id, NEW.hierarchy_rank, NEW.can_upload_and_delete_images, NEW.can_edit, NEW.all_images, NEW.all_albums, NEW.save_preferences);

                -- Create the profile_images and profile_albums tables
                INSERT INTO profile_images (profile_id, image_id, accessible)
                SELECT NEW.profile_id, image_id, accessible
                FROM profile_images
                WHERE profile_id = cur_profile('profile_id');

                INSERT INTO profile_albums (profile_id, album_id, accessible)
                SELECT NEW.profile_id, album_id, accessible
                FROM profile_albums
                WHERE profile_id = cur_profile('profile_id');
            END;
            """,
            'trg_update_accessible_profiles': """
            CREATE TRIGGER IF NOT EXISTS trg_update_accessible_profiles
            INSTEAD OF UPDATE ON accessible_profiles
            BEGIN
                SELECT CASE
                    WHEN cur_profile('hierarchy_rank') = 0 THEN
                        RAISE(ABORT, 'Permission denied: not a profiles manager')
                    WHEN OLD.hierarchy_rank >= cur_profile('hierarchy_rank') AND OLD.profile_id <> cur_profile('profile_id') THEN
                        RAISE(ABORT, 'Permission denied: cannot edit profile with higher or equal rank')
                    WHEN NEW.hierarchy_rank >= cur_profile('hierarchy_rank') AND NEW.profile_id <> cur_profile('profile_id') THEN
                        RAISE(ABORT, 'Permission denied: cannot set profile rank higher or equal to own rank')
                    WHEN NEW.all_images = 1 AND cur_profile('all_images') = 0 THEN
                        RAISE(ABORT, 'Permission denied: cannot set profile all_images=1 if current profile does not have all_images=1')
                    WHEN NEW.all_albums = 1 AND cur_profile('all_albums') = 0 THEN
                        RAISE(ABORT, 'Permission denied: cannot set profile all_albums=1 if current profile does not have all_albums=1')
                END;

                UPDATE profiles
                SET save_preferences = NEW.save_preferences,
                    hierarchy_rank = CASE WHEN OLD.profile_id = cur_profile('profile_id') THEN OLD.hierarchy_rank ELSE NEW.hierarchy_rank END,
                    can_upload_and_delete_images = CASE WHEN OLD.profile_id = cur_profile('profile_id') THEN OLD.can_upload_and_delete_images ELSE NEW.can_upload_and_delete_images END,
                    can_edit = CASE WHEN OLD.profile_id = cur_profile('profile_id') THEN OLD.can_edit ELSE NEW.can_edit END,
                    all_images = CASE WHEN OLD.profile_id = cur_profile('profile_id') THEN OLD.all_images ELSE NEW.all_images END,
                    all_albums = CASE WHEN OLD.profile_id = cur_profile('profile_id') THEN OLD.all_albums ELSE NEW.all_albums END
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
            CREATE TRIGGER IF NOT EXISTS trg_delete_accessible_profiles
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
            CREATE TRIGGER IF NOT EXISTS trg_insert_accessible_profile_images
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
            CREATE TRIGGER IF NOT EXISTS trg_delete_accessible_profile_images
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

            # accessible_profile_albums
            'trg_insert_accessible_profile_albums': """
            CREATE TRIGGER IF NOT EXISTS trg_insert_accessible_profile_albums
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
            CREATE TRIGGER IF NOT EXISTS trg_delete_accessible_profile_albums
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

            # ensure_default_albums
            'trg_delete_ensure_default_albums': """
            CREATE TRIGGER IF NOT EXISTS trg_delete_ensure_default_albums
            BEFORE DELETE ON albums
            BEGIN
                SELECT CASE
                    WHEN LOWER(OLD.label) = 'archive' OR LOWER(OLD.label) = 'favorites' THEN
                        RAISE(ABORT, 'Permission denied: cannot delete default albums')
                END;
            END;
            """,

            # ensure_default_groups
            'trg_delete_ensure_default_groups': """
            CREATE TRIGGER IF NOT EXISTS trg_delete_ensure_default_groups
            BEFORE DELETE ON groups
            BEGIN
                SELECT CASE
                    WHEN LOWER(OLD.label) = 'unassociated' THEN
                        RAISE(ABORT, 'Permission denied: cannot delete default group')
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

    def __init__(self, db_path: str, profile_id: str):
        super().__init__(db_path)
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
            'all_albums': False,
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
