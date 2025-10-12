import sqlite3
from typing import List, Dict, Union, Tuple, Any
from contextlib import contextmanager
from enum import Enum

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

STRUCTURE = {
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
        'fields': ['label', 'hierarchy_rank', 'can_upload_and_delete_images', 'can_edit', 'all_images', 'all_albums', 'save_preferences'],
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

TABLES = {
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
        label TEXT COLLATE NOCASE UNIQUE,
        password TEXT DEFAULT '',
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

INDEXES = [
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

VIEWS = {
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
            AND p.profile_id = cur_profile('profile_id')
            AND pa.album_id = a.album_id
            WHERE (
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
            label,
            password,
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

TRIGGERS = {
    # accessible_faces
    'trg_update_accessible_faces': """
    CREATE TRIGGER IF NOT EXISTS trg_update_accessible_faces
    INSTEAD OF UPDATE ON accessible_faces
    BEGIN
        SELECT CASE
            WHEN cur_profile('can_edit') = 0 THEN
                RAISE(ABORT, 'Permission denied')
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
                RAISE(ABORT, 'Permission denied')
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
                RAISE(ABORT, 'Permission denied')
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
                RAISE(ABORT, 'Permission denied')
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
                RAISE(ABORT, 'Permission denied')
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
                RAISE(ABORT, 'Permission denied')
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
                RAISE(ABORT, 'Permission denied')
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
                RAISE(ABORT, 'Permission denied')
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
                RAISE(ABORT, 'Permission denied')
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
                RAISE(ABORT, 'Permission denied')
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
                RAISE(ABORT, 'Permission denied')
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
                RAISE(ABORT, 'Permission denied')
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
                RAISE(ABORT, 'Permission denied')
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
                RAISE(ABORT, 'Permission denied')
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
                RAISE(ABORT, 'Permission denied')
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
                RAISE(ABORT, 'Permission denied')
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
                RAISE(ABORT, 'Permission denied')
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

        INSERT INTO profiles (profile_id, label, password, hierarchy_rank, can_upload_and_delete_images, can_edit, all_images, all_albums, save_preferences)
        VALUES (NEW.profile_id, NEW.label, NEW.password, NEW.hierarchy_rank, NEW.can_upload_and_delete_images, NEW.can_edit, NEW.all_images, NEW.all_albums, NEW.save_preferences);

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
        SET label = NEW.label,
            password = NEW.password,
            save_preferences = NEW.save_preferences,
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

class AppDB:

    @staticmethod
    def create_new_db_in_dir(dir_path: str, db_name: str | None = None, images_count_limit: int = 10000):
        """Create a new SQLite DB in the given directory, initializing all tables and settings."""
        import os
        if db_name is None:
            db_name = os.path.basename(os.path.normpath(dir_path)) + '.db'
        db_path = os.path.join(dir_path, db_name)
        os.makedirs(dir_path, exist_ok=True)
        # Create DB and all tables
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            # Create tables
            for table, schema in TABLES.items():
                conn.execute(f'''CREATE TABLE IF NOT EXISTS {table} ({schema})''')
            
            # Create indexes
            for index_sql in INDEXES:
                conn.execute(f'CREATE INDEX IF NOT EXISTS {index_sql}')
            
            # Create views
            for view_name, view_sql in VIEWS.items():
                conn.execute(f'''CREATE VIEW IF NOT EXISTS {view_name} AS {view_sql}''')
            
            # Create triggers
            trigger_sql = f"""
            CREATE TRIGGER IF NOT EXISTS trg_insert_images_count_limit
            BEFORE INSERT ON images
            BEGIN
                SELECT CASE
                    WHEN (SELECT COUNT(*) FROM images) >= {images_count_limit} THEN
                        RAISE(ABORT, 'Images count limit reached')
                END;
            END;
            """
            conn.execute(trigger_sql)
            
            for trigger_name, trigger_sql in TRIGGERS.items():
                conn.execute(trigger_sql)

            conn.commit()
        finally:
            conn.close()
        return db_path 

    @staticmethod
    def get_id_field(table: str, remove_parent: str | None = None) -> str:
        id_field = STRUCTURE[table].get('primary_key', '')
        if remove_parent and table != remove_parent:
            other_parent_id_field = STRUCTURE[remove_parent].get('primary_key', '')
            if isinstance(other_parent_id_field, str):
                other_parent_id_field = [other_parent_id_field]
            if isinstance(id_field, str):
                id_field = [id_field]
            id_field = [id for id in id_field if id not in other_parent_id_field]

        if isinstance(id_field, list):
            return ', '.join(id_field)
        return id_field

    @staticmethod
    def _get_fields(fields: list[str] | None, table: str | None = None) -> str:
        if table:
            table += '.'
        else:
            table = ''

        if not fields:
            fields = ["*"]
        
        fields = ', '.join([f"{table}{field}" for field in fields])
        return fields

    @staticmethod
    def get_relation(parent: str, child: str | None = None) -> tuple[str, str, str, list[str]] | list[tuple[str, str, str, list[str]]]:
        """Get the relation info for a parent and child.
        Args:
            parent: parent table
            child: child table or None to get all childs
        Returns:
            relation table, child table, child id field, and view fields for a relation.
            if child is None, return a list of all relations info.
        """
        return_single = False
        if child:
            childs = [child]
            return_single = True
        else:
            childs = STRUCTURE[parent]['relations'].keys()

        relations = []
        for child in childs:
            relation_meta = STRUCTURE[parent]['relations'][child]
            relation_table = relation_meta['relation_table']
            child_id_field = AppDB.get_id_field(relation_table, remove_parent=parent)
            fields = AppDB._get_fields([child_id_field] + relation_meta['fields_needed'], 'c')
            relations.append((relation_table, child, child_id_field, fields))

        if return_single:
            return relations[0]
        return relations

    @staticmethod
    def get_view_fields(table: str, as_table: str | None = None) -> str:
        id_field = AppDB.get_id_field(table)
        fields = [id_field] + STRUCTURE[table].get('fields', [])
        return AppDB._get_fields(fields, as_table)

    def __init__(self, db_path: str, event_id: str, profile_id: str | None = None):
        self.db_path = db_path
        self.event_id = event_id
        self._profile_context = {}
        self.set_profile_id(profile_id)

    def set_profile_id(self, profile_id: str | None = None):
        """Set the current profile id for access control."""
        
        fields = {
            'profile_id': '',
            'hierarchy_rank': 0,
            'can_upload_and_delete_images': False,
            'can_edit': False,
            'all_images': False,
            'all_albums': False,
        }
        profile = {}
        if profile_id:
            profile = self.execute_query('SELECT * FROM profiles WHERE profile_id = ?', (profile_id,), return_format=ReturnFormat.DICT)

        if not profile:
            profile = {}
        
        for field, default_val in fields.items():
            val = profile.get(field, default_val)
            self._profile_context[field] = val

    def get_profile_context(self) -> dict:
        """Get the current profile context."""
        return self._profile_context

    def is_profile_manager(self) -> bool:
        """Check if the current profile is a profile manager."""
        return self._profile_context['hierarchy_rank'] > 0

    @contextmanager
    def get_connection(self):
        """Context manager for database connections."""

        conn = sqlite3.connect(self.db_path)
        # Enable foreign key constraints
        conn.execute("PRAGMA foreign_keys = ON")
        # Register the current profile context on every connection
        conn.create_function("cur_profile", 1, lambda key: self._profile_context.get(key))

        try:
            yield conn
        finally:
            conn.close()

    def execute_query(self, query: str, params: tuple = (), return_format: ReturnFormat = None):
        """Execute a custom query and return results."""
        with self.get_connection() as conn:
            cursor = conn.execute(query, params)
            upper_query = query.strip().upper()
            results = []

            if return_format or upper_query.startswith('SELECT'):
                rows = cursor.fetchall()

                columns = [desc[0] for desc in cursor.description]
                if return_format is None:
                    return_format = ReturnFormat.LIST_TUPLES

                if return_format == ReturnFormat.VALUE:
                    results = rows[0][0] if rows else None
                elif return_format == ReturnFormat.TUPLE:
                    results = rows[0] if rows else None
                elif return_format == ReturnFormat.DICT:
                    results = dict(zip(columns, rows[0])) if rows else None
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
            conn.commit()
            return results

    # TODO: use execute_query instead
    def insert(self, table: str, data_list: List[Dict]) -> List[Union[Any, Tuple[Any, ...]]]:
        """Insert multiple records into a table/view and return their ids."""
        if not data_list:
            return []
        
        target_table = STRUCTURE[table]['accessible_table']
        
        keys = list(data_list[0].keys())
        keys_str = ', '.join(keys)
        placeholders = '(' + ', '.join(['?'] * len(keys)) + ')'
        
        sql = f'INSERT INTO {target_table} ({keys_str}) VALUES {placeholders}'

        p_keys = STRUCTURE[table]['primary_key']
        if p_keys:
            returning_str = ', '.join(p_keys) if isinstance(p_keys, tuple) else p_keys
            sql += f' RETURNING {returning_str}'
        
        inserted_ids = []
        with self.get_connection() as conn:
            for row_data in data_list:
                values = tuple(row_data[k] for k in keys)
                try:
                    cursor = conn.execute(sql, values)
                    if p_keys:
                        for row in cursor.fetchall():
                            inserted_ids.append(row[0] if len(row) == 1 else tuple(row))
                except sqlite3.IntegrityError:
                    pass  # Ignore integrity errors (e.g., duplicates)
            conn.commit()
        return inserted_ids

    # TODO: use execute_query instead
    def update(self, table: str, where: Dict, fields: Dict) -> List[Union[Any, Tuple[Any, ...]]]:
        """Update records in a table/view and return their ids."""
        if not fields:
            return []

        target_table = STRUCTURE[table]['accessible_table']
        
        set_clause = ', '.join([f'{k}=?' for k in fields.keys()])
        
        where_clauses = []
        where_values = []
        for k, v in where.items():
            if isinstance(v, list):
                if not v:
                    where_clauses.append('1=0')  # No match for empty list
                else:
                    placeholders = ','.join(['?'] * len(v))
                    where_clauses.append(f'{k} IN ({placeholders})')
                    where_values.extend(v)
            else:
                where_clauses.append(f'{k}=?')
                where_values.append(v)
        where_clause = ' AND '.join(where_clauses)

        values = tuple(fields.values()) + tuple(where_values)
        
        if table == 'groups' and where.get('label', '').lower() == 'unassociated' and ('label' in fields.keys() or 'representative_face' in fields.keys()):
            return []

        if table == 'albums' and where.get('label', '').lower() in ['favorites', 'archive'] and 'label' in fields.keys():
            return []

        sql = f'UPDATE {target_table} SET {set_clause} WHERE {where_clause}'

        p_keys = STRUCTURE[table]['primary_key']
        if p_keys:
            returning_str = ', '.join(p_keys) if isinstance(p_keys, tuple) else p_keys
            sql += f' RETURNING {returning_str}'
        
        updated_ids = []
        with self.get_connection() as conn:
            try:
                cursor = conn.execute(sql, values)
                if p_keys:
                    for row in cursor.fetchall():
                        updated_ids.append(row[0] if len(row) == 1 else tuple(row))
            except sqlite3.OperationalError:
                conn.execute(sql.replace(f' RETURNING {returning_str}', ''), values)
            conn.commit()
        return updated_ids

    # TODO: use execute_query instead
    def delete(self, table: str, where: Dict) -> List[Union[Any, Tuple[Any, ...]]]:
        """Delete records from a table/view and return their ids."""
        target_table = STRUCTURE[table]['accessible_table']
        
        where_clauses = []
        where_values = []
        for k, v in where.items():
            if isinstance(v, list):
                if not v:
                    where_clauses.append('1=0')
                else:
                    placeholders = ','.join(['?'] * len(v))
                    where_clauses.append(f'{k} IN ({placeholders})')
                    where_values.extend(v)
            else:
                where_clauses.append(f'{k}=?')
                where_values.append(v)
        where_clause = ' AND '.join(where_clauses)
        values = tuple(where_values)
        
        sql = f'DELETE FROM {target_table} WHERE {where_clause}'

        p_keys = STRUCTURE[table]['primary_key']
        if p_keys:
            returning_str = ', '.join(p_keys) if isinstance(p_keys, tuple) else p_keys
            sql += f' RETURNING {returning_str}'

        deleted_ids = []
        with self.get_connection() as conn:
            try:
                cursor = conn.execute(sql, values)
                if p_keys:
                    for row in cursor.fetchall():
                        deleted_ids.append(row[0] if len(row) == 1 else tuple(row))
            except sqlite3.OperationalError:
                conn.execute(sql.replace(f' RETURNING {returning_str}', ''), values)
            conn.commit()

        return deleted_ids
