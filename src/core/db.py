import sqlite3
from typing import List, Dict, Union, Tuple, Any
from contextlib import contextmanager

# TODO: remove fields_as_child

STRUCTURE = {
    'images': {
        'primary_key': 'image_id',
        'sort_by': 'date_taken',
        'accessible_table': 'accessible_images',
        'childs': {
            'view': ['faces', 'albums_images']
        }
    },
    'faces': {
        'primary_key': 'face_id',
        'accessible_table': 'accessible_faces',
        'fields_as_child': ['face_id'],
    },
    'groups': {
        'primary_key': 'group_id',
        'sort_by': 'label',
        'accessible_table': 'accessible_groups',
        'representative_field': 'representative_face',
        'childs': {
            'view': ['groups_images', 'faces'],
            'edit': {
                'faces': {
                    'other_parent': 'groups',
                    'relation': 'group.images'
                }
            }
        },
    },
    'moments': {
        'primary_key': 'moment_id',
        'sort_by': 'start, label',
        'accessible_table': 'accessible_moments',
        'representative_field': 'representative_image',
        'childs': {
            'view': ['images'],
            'edit': {
                'images': {
                    'other_parent': 'moments',
                    'relation': 'moment.images'
                }
            }
        },
    },
    'albums': {
        'primary_key': 'album_id',
        'sort_by': 'label',
        'accessible_table': 'accessible_albums',
        'representative_field': 'representative_image',
        'childs': {
            'view': ['albums_images'],
            'edit': {
                'albums_images': {
                    'other_parent': 'images',
                    'relation': 'album.images'
                }
            }
        },
    },
    'profiles': {
        'primary_key': 'profile_id',
        'sort_by': 'label',
        'accessible_table': '',
        'childs': {
            'view': ['profile_images', 'profile_albums'],
            'edit': {
                'profile_images': {
                    'other_parent': 'images',
                    'relation': 'profile.images'
                },
                'profile_albums': {
                    'other_parent': 'albums',
                    'relation': 'profile.albums'
                }
            }
        },
    },
    'groups_images': {
        'primary_key': 'group_id, image_id',
        'sort_by': 'label',
        'fields_as_child': ['image_id', 'label', 'date_taken', 'is_archived', 'is_favorite', 'representative_face'],
        'accessible_table': 'accessible_groups_images',
    },
    'albums_images': {
        'primary_key': 'album_id, image_id',
        'accessible_table': 'accessible_albums_images',
    },
    'profile_images': {
        'primary_key': 'profile_id, image_id',
        'accessible_table': 'editable_profile_images',
    },
    'profile_albums': {
        'primary_key': 'profile_id, album_id',
        'accessible_table': 'editable_profile_albums',
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
        label TEXT UNIQUE,
        representative_face TEXT
    ''',
    'moments': '''
        moment_id TEXT PRIMARY KEY,
        label TEXT UNIQUE,
        description TEXT,
        start TEXT,
        end TEXT,
        representative_image TEXT,
        FOREIGN KEY (representative_image) REFERENCES images(image_id) ON DELETE SET NULL
    ''',
    'albums': '''
        album_id TEXT PRIMARY KEY,
        label TEXT UNIQUE,
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
        label TEXT,
        password TEXT DEFAULT '',
        hierarchy_rank INTEGER DEFAULT 0,
        is_profiles_manager BOOLEAN DEFAULT 0,
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
    'idx_albums_label ON albums(label)',
    'idx_albums_representative_image ON albums(representative_image)',
]

VIEWS = {
    'images_with_albums': '''
        SELECT images.*,
            CASE WHEN a1.image_id IS NOT NULL THEN 1 ELSE 0 END AS is_archived,
            CASE WHEN a2.image_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite_helper
        FROM images
        LEFT JOIN (albums_images a1 INNER JOIN albums b1 ON a1.album_id = b1.album_id)
        ON a1.image_id = images.image_id AND LOWER(b1.label) = 'archive'
        LEFT JOIN (albums_images a2 INNER JOIN albums b2 ON a2.album_id = b2.album_id)
        ON a2.image_id = images.image_id AND LOWER(b2.label) = 'favorites';
    ''',
    'accessible_albums': '''
        SELECT albums.* FROM albums
        WHERE EXISTS (
            SELECT 1
            FROM profiles LEFT JOIN profile_albums
            ON profiles.profile_id = profile_albums.profile_id
            AND profiles.profile_id = cur_profile('profile_id')
            WHERE (
                profiles.profile_id = cur_profile('profile_id')
                AND ((profiles.all_albums = 1 AND (profile_albums.album_id IS NULL))
                OR (profiles.all_albums = 0 AND profile_albums.accessible = 1))
            )
        )
    ''',
    'accessible_images': '''
        SELECT i.*,
        (a2.album_id IS NOT NULL AND i.is_favorite_helper = 1) AS is_favorite
        FROM images_with_albums as i
        LEFT JOIN accessible_albums as a1 on LOWER(a1.label) = 'archive'
        LEFT JOIN accessible_albums as a2 on LOWER(a2.label) = 'favorites'
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
        AND (include_archived() = 1 OR i.is_archived = 0)
    ''',
    'accessible_groups': '''
        SELECT groups.* FROM groups
        WHERE NOT EXISTS (
            SELECT 1 FROM faces WHERE faces.group_id = groups.group_id
        )
        OR EXISTS (
            SELECT 1
            FROM faces 
            INNER JOIN accessible_images ON faces.image_id = accessible_images.image_id
            WHERE faces.group_id = groups.group_id
        )
    ''',
    'accessible_faces': '''
        SELECT faces.*
        FROM faces 
        INNER JOIN accessible_images ON faces.image_id = accessible_images.image_id
    ''',
    'groups_images': '''
        SELECT DISTINCT i.*, groups.group_id, min(faces.face_id) as representative_face
        FROM images_with_albums i
        INNER JOIN faces ON i.image_id = faces.image_id
        INNER JOIN groups ON faces.group_id = groups.group_id
        GROUP BY i.image_id, groups.group_id
    ''',
    'accessible_groups_images': '''
        SELECT accessible_images.*, groups_images.group_id, groups_images.representative_face
        FROM groups_images
        INNER JOIN accessible_images ON groups_images.image_id = accessible_images.image_id
    ''',
    'accessible_moments': '''
        SELECT moments.* FROM moments
    ''',
    'accessible_albums_images': '''
        SELECT albums_images.*
        FROM albums_images
        INNER JOIN accessible_images ON albums_images.image_id = accessible_images.image_id
        INNER JOIN accessible_albums ON albums_images.album_id = accessible_albums.album_id
    ''',
    'editable_profiles_details': '''
        SELECT profile_id, label, password FROM profiles
        WHERE (profile_id = cur_profile('profile_id') AND hierarchy_rank > 0)
        OR (cur_profile('is_profiles_manager') = 1 AND cur_profile('hierarchy_rank') > hierarchy_rank)
    ''',
    'editable_full_profiles': '''
        SELECT * FROM profiles
        WHERE (cur_profile('is_profiles_manager') = 1 AND cur_profile('hierarchy_rank') > hierarchy_rank)
    ''',
    'editable_profile_images': '''
        SELECT profile_images.*
        FROM profile_images
    ''',
    'editable_profile_albums': '''
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
            WHEN cur_profile('can_edit') = 0 THEN
                RAISE(ABORT, 'Permission denied')
        END;

        DELETE FROM images
        WHERE image_id = OLD.image_id;
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

    # editable_full_profiles
    'trg_insert_editable_full_profiles': """
    CREATE TRIGGER IF NOT EXISTS trg_insert_editable_full_profiles
    INSTEAD OF INSERT ON editable_full_profiles
    BEGIN
        SELECT CASE
            WHEN cur_profile('is_profiles_manager') = 0 THEN
                RAISE(ABORT, 'Permission denied: not a profiles manager')
            WHEN NEW.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                RAISE(ABORT, 'Permission denied: cannot create profile with higher or equal rank')
            WHEN NEW.all_images = 1 and cur_profile('all_images') = 0 THEN
                RAISE(ABORT, 'Permission denied: cannot create profile with all_images=1 if current profile does not have all_images=1')
            WHEN NEW.all_albums = 1 and cur_profile('all_albums') = 0 THEN
                RAISE(ABORT, 'Permission denied: cannot create profile with all_albums=1 if current profile does not have all_albums=1')
        END;

        INSERT INTO profiles (profile_id, label, password, hierarchy_rank, is_profiles_manager, can_edit, all_images, all_albums, save_preferences)
        VALUES (NEW.profile_id, NEW.label, NEW.password, NEW.hierarchy_rank, NEW.is_profiles_manager, NEW.can_edit, NEW.all_images, NEW.all_albums, NEW.save_preferences);

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
    'trg_update_editable_full_profiles': """
    CREATE TRIGGER IF NOT EXISTS trg_update_editable_full_profiles
    INSTEAD OF UPDATE ON editable_full_profiles
    BEGIN
        SELECT CASE
            WHEN cur_profile('is_profiles_manager') = 0 THEN
                RAISE(ABORT, 'Permission denied: not a profiles manager')
            WHEN OLD.profile_id = cur_profile('profile_id') THEN
                RAISE(ABORT, 'Permission denied: cannot edit own permissions')
            WHEN OLD.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                RAISE(ABORT, 'Permission denied: cannot edit profile with higher or equal rank')
            WHEN NEW.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                RAISE(ABORT, 'Permission denied: cannot set profile rank higher or equal to own rank')
            WHEN NEW.all_images = 1 and cur_profile('all_images') = 0 THEN
                RAISE(ABORT, 'Permission denied: cannot set profile all_images=1 if current profile does not have all_images=1')
            WHEN NEW.all_albums = 1 and cur_profile('all_albums') = 0 THEN
                RAISE(ABORT, 'Permission denied: cannot set profile all_albums=1 if current profile does not have all_albums=1')
        END;

        -- Update the profiles table
        UPDATE profiles
        SET label = NEW.label,
            password = NEW.password,
            hierarchy_rank = NEW.hierarchy_rank,
            is_profiles_manager = NEW.is_profiles_manager,
            can_edit = NEW.can_edit,
            all_images = NEW.all_images,
            all_albums = NEW.all_albums,
            save_preferences = NEW.save_preferences
        WHERE profile_id = OLD.profile_id;

        -- Update the profile_images and profile_albums tables
        DELETE FROM profile_images WHERE profile_id = OLD.profile_id AND NEW.all_images <> OLD.all_images;
        
        INSERT INTO profile_images (profile_id, image_id, accessible)
        SELECT OLD.profile_id, image_id, accessible
        FROM profile_images 
        WHERE profile_id = cur_profile('profile_id')
          AND NEW.all_images = 1 
          AND NEW.all_images <> OLD.all_images;

        DELETE FROM profile_albums WHERE profile_id = OLD.profile_id AND NEW.all_albums <> OLD.all_albums;
        
        INSERT INTO profile_albums (profile_id, album_id, accessible)
        SELECT OLD.profile_id, album_id, accessible
        FROM profile_albums 
        WHERE profile_id = cur_profile('profile_id')
          AND NEW.all_albums = 1
          AND NEW.all_albums <> OLD.all_albums;
    END;
    """,
    'trg_delete_editable_full_profiles': """
    CREATE TRIGGER IF NOT EXISTS trg_delete_editable_full_profiles
    INSTEAD OF DELETE ON editable_full_profiles
    BEGIN
        SELECT CASE
            WHEN cur_profile('is_profiles_manager') = 0 THEN
                RAISE(ABORT, 'Permission denied: not a profiles manager')
            WHEN OLD.profile_id = cur_profile('profile_id') THEN
                RAISE(ABORT, 'Permission denied: cannot delete own profile')
            WHEN OLD.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                RAISE(ABORT, 'Permission denied: cannot delete profile with higher or equal rank')
        END;

        DELETE FROM profiles WHERE profile_id = OLD.profile_id;
    END;
    """,

    # editable_profiles_details
    'trg_update_editable_profiles_details': """
    CREATE TRIGGER IF NOT EXISTS trg_update_editable_profiles_details
    INSTEAD OF UPDATE ON editable_profiles_details
    BEGIN
        SELECT CASE
            WHEN (cur_profile('hierarchy_rank') = 0 OR OLD.hierarchy_rank > cur_profile('hierarchy_rank')) THEN
                RAISE(ABORT, 'Permission denied')
        END;

        UPDATE profiles
        SET label = NEW.label,
            password = NEW.password
        WHERE profile_id = OLD.profile_id;
    END;
    """,

    # editable_profile_images
    'trg_insert_editable_profile_images': """
    CREATE TRIGGER IF NOT EXISTS trg_insert_editable_profile_images
    INSTEAD OF INSERT ON editable_profile_images
    BEGIN
        SELECT CASE
            WHEN cur_profile('is_profiles_manager') = 0 THEN
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

    # editable_profile_albums
    'trg_insert_editable_profile_albums': """
    CREATE TRIGGER IF NOT EXISTS trg_insert_editable_profile_albums
    INSTEAD OF INSERT ON editable_profile_albums
    BEGIN
        SELECT CASE
            WHEN cur_profile('is_profiles_manager') = 0 THEN
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

    # ensure_default_albums
    'trg_delete_ensure_default_albums': """
    CREATE TRIGGER IF NOT EXISTS trg_delete_ensure_default_albums
    BEFORE DELETE ON albums
    BEGIN
        SELECT CASE
            WHEN OLD.label = 'archive' OR OLD.label = 'favorites' THEN
                RAISE(ABORT, 'Permission denied: cannot delete default albums')
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
    def get_view_child(table: str, child: str | None = None, *, all: bool = False) -> str:
        if child:
            return child
        
        childs = STRUCTURE[table]['childs'].get('view', None)
        if all:
            return childs

        return childs[0]

    @staticmethod
    def get_edit_child(table: str, child: str | None = None) -> str | tuple[str, str, str, str]:
        childs = STRUCTURE[table]['childs'].get('edit', None)
        if not child:
            child = list(childs.keys())[0]
        child_meta = childs[child]

        other_parent = child_meta['other_parent']
        exclusive = other_parent == table
        child_id_field = STRUCTURE[child]['primary_key'] if exclusive else STRUCTURE[other_parent]['primary_key']

        return child, other_parent, child_meta['relation'], child_id_field

    @staticmethod
    def get_fields_as_child(table: str, as_table: str | None = None) -> str:
        if table not in STRUCTURE:
            return table
        
        if as_table:
            as_table += '.'

        fields_as_child = STRUCTURE[table].get('fields_as_child', None)
        return ', '.join([f"{as_table}{field}" for field in fields_as_child]) if fields_as_child else f'{as_table}*'

    def __init__(self, db_path: str, event_id: str, profile_id: str | None = None, include_archived: bool = False):
        self.db_path = db_path
        self.event_id = event_id
        self._profile_context = {}
        self.set_profile_id(profile_id)
        self.set_include_archived(include_archived)

    def set_profile_id(self, profile_id: str | None = None):
        """Set the current profile id for access control."""
        
        fields = {
            'profile_id': '',
            'hierarchy_rank': 0,
            'is_profiles_manager': False,
            'can_edit': False,
            'all_images': False,
            'all_albums': False
        }
        profile = {}
        if profile_id:
            profile = self.execute_query('SELECT * FROM profiles WHERE profile_id = ?', (profile_id,), include_columns=True)[0]

        if not profile:
            profile = {}
        
        for field, default_val in fields.items():
            val = profile.get(field, default_val)
            self._profile_context[field] = val

    def get_profile_id(self) -> str | None:
        """Get the current profile id."""
        return self._profile_context.get('profile_id')

    def set_include_archived(self, include_archived: bool) -> bool:
        """Set the include archived flag."""
        self._include_archived = include_archived

    def get_include_archived(self) -> bool:
        """Get the include archived flag."""
        return self._include_archived

    @contextmanager
    def get_connection(self, force_include_archived: bool = False):
        """Context manager for database connections."""

        conn = sqlite3.connect(self.db_path)
        # Enable foreign key constraints
        conn.execute("PRAGMA foreign_keys = ON")
        # Register the current profile context on every connection
        conn.create_function("cur_profile", 1, lambda key: self._profile_context.get(key))
        include_archived = force_include_archived or self.get_include_archived()
        conn.create_function("include_archived", 0, lambda: include_archived)

        try:
            yield conn
        finally:
            conn.close()

    def execute_query(self, query: str, params: tuple = (), *, force_include_archived: bool = False, include_columns: bool = False) -> List[tuple | dict]:
        """Execute a custom query and return results."""
        with self.get_connection(force_include_archived) as conn:
            cursor = conn.execute(query, params)
            upper_query = query.strip().upper()

            if upper_query.startswith('SELECT') or 'RETURNING' in upper_query or upper_query.startswith('WITH'):
                if include_columns:
                    columns = [desc[0] for desc in cursor.description]
                    results = [dict(zip(columns, row)) for row in cursor.fetchall()]
                else:
                    results = cursor.fetchall()

                if 'RETURNING' in upper_query:
                    conn.commit()

                return results

            conn.commit()
            return []

    ########## TODO: use execute_query instead
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
        with self.get_connection(True) as conn:
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

    ########## TODO: use execute_query instead
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
        
        sql = f'UPDATE {target_table} SET {set_clause} WHERE {where_clause}'

        p_keys = STRUCTURE[table]['primary_key']
        if p_keys:
            returning_str = ', '.join(p_keys) if isinstance(p_keys, tuple) else p_keys
            sql += f' RETURNING {returning_str}'
        
        updated_ids = []
        with self.get_connection(True) as conn:
            try:
                cursor = conn.execute(sql, values)
                if p_keys:
                    for row in cursor.fetchall():
                        updated_ids.append(row[0] if len(row) == 1 else tuple(row))
            except sqlite3.OperationalError:
                conn.execute(sql.replace(f' RETURNING {returning_str}', ''), values)
            conn.commit()
        return updated_ids

    ########## TODO: use execute_query instead
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
        with self.get_connection(True) as conn:
            try:
                cursor = conn.execute(sql, values)
                if p_keys:
                    for row in cursor.fetchall():
                        deleted_ids.append(row[0] if len(row) == 1 else tuple(row))
            except sqlite3.OperationalError:
                conn.execute(sql.replace(f' RETURNING {returning_str}', ''), values)
            conn.commit()

        return deleted_ids
