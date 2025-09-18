import sqlite3
from typing import List, Dict, Union, Tuple, Any
from contextlib import contextmanager

STRUCTURE = {
    'images': {
        'primary_key': 'imageID',
        'sort_by': 'date_taken',
        'sub_table': 'faces',
        'fields_as_sub_table': '',
        'accessible_table': 'accessible_images',
    },
    'faces': {
        'primary_key': 'faceID',
        'sort_by': '',
        'sub_table': '',
        'fields_as_sub_table': '',
        'accessible_table': 'accessible_faces',
    },
    'groups': {
        'primary_key': 'groupID',
        'sort_by': 'label',
        'sub_table': 'groups_images',
        'fields_as_sub_table': '',
        'accessible_table': 'accessible_groups',
    },
    'moments': {
        'primary_key': 'momentID',
        'sort_by': 'start, label',
        'sub_table': 'images',
        'fields_as_sub_table': '',
        'accessible_table': 'accessible_moments',
    },
    'albums': {
        'primary_key': 'albumID',
        'sort_by': 'label',
        'sub_table': 'album_images',
        'fields_as_sub_table': '',
        'accessible_table': 'accessible_albums',
    },
    'profiles': {
        'primary_key': 'profileID',
        'sort_by': 'label',
        'sub_table': '',
        'fields_as_sub_table': '',
        'accessible_table': '',
    },
    'groups_images': {
        'primary_key': 'groupID, imageID',
        'sort_by': 'label',
        'sub_table': '',
        'fields_as_sub_table': ['imageID', 'label', 'date_taken', 'is_archived', 'is_favorite', 'representative_face'],
        'accessible_table': 'accessible_groups_images',
    },
}

TABLES = {
    'faces': '''
        faceID TEXT PRIMARY KEY,
        imageID TEXT,
        width REAL,
        height REAL,
        left REAL,
        top REAL,
        groupID TEXT,
        FOREIGN KEY (imageID) REFERENCES images(imageID) ON DELETE SET NULL,
        FOREIGN KEY (groupID) REFERENCES groups(groupID) ON DELETE SET NULL
    ''',
    'images': '''
        imageID TEXT PRIMARY KEY,
        label TEXT,
        date_taken TEXT,
        file_size INTEGER,
        width INTEGER,
        height INTEGER,
        momentID TEXT,
        FOREIGN KEY (momentID) REFERENCES moments(momentID) ON DELETE SET NULL
    ''',
    'groups': '''
        groupID TEXT PRIMARY KEY,
        label TEXT UNIQUE,
        representative_face TEXT
    ''',
    'moments': '''
        momentID TEXT PRIMARY KEY,
        label TEXT UNIQUE,
        description TEXT,
        start TEXT,
        end TEXT,
        representative_image TEXT,
        FOREIGN KEY (representative_image) REFERENCES images(imageID) ON DELETE SET NULL
    ''',
    'albums': '''
        albumID TEXT PRIMARY KEY,
        label TEXT UNIQUE,
        description TEXT,
        representative_image TEXT,
        FOREIGN KEY (representative_image) REFERENCES images(imageID) ON DELETE SET NULL
    ''',
    'album_images': '''
        albumID TEXT,
        imageID TEXT,
        FOREIGN KEY (albumID) REFERENCES albums(albumID) ON DELETE CASCADE,
        FOREIGN KEY (imageID) REFERENCES images(imageID) ON DELETE CASCADE,
        PRIMARY KEY (albumID, imageID)
    ''',
    'profiles': '''
        profileID TEXT PRIMARY KEY,
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
        profileID TEXT,
        imageID TEXT,
        accessible BOOLEAN,
        FOREIGN KEY (profileID) REFERENCES profiles(profileID) ON DELETE CASCADE,
        FOREIGN KEY (imageID) REFERENCES images(imageID) ON DELETE CASCADE,
        PRIMARY KEY (profileID, imageID)
    ''',
    'profile_albums': '''
        profileID TEXT,
        albumID TEXT,
        accessible BOOLEAN,
        FOREIGN KEY (profileID) REFERENCES profiles(profileID) ON DELETE CASCADE,
        FOREIGN KEY (albumID) REFERENCES albums(albumID) ON DELETE CASCADE,
        PRIMARY KEY (profileID, albumID)
    '''
}

INDEXES = [
    'idx_faces_imageid ON faces(imageID)',
    'idx_faces_groupid ON faces(groupID)',
    'idx_profile_images_profileid_imageid ON profile_images(profileID, imageID)',
    'idx_profile_albums_profileid_albumid ON profile_albums(profileID, albumID)',
    'idx_images_momentid ON images(momentID)',
    'idx_groups_representative_face ON groups(representative_face)',
    'idx_moments_representative_image ON moments(representative_image)',
    'idx_faces_groupid_imageid ON faces(groupID, imageID)',
    'idx_images_date_taken ON images(date_taken)',
    'idx_albums_label ON albums(label)',
    'idx_albums_representative_image ON albums(representative_image)',
]

VIEWS = {
    'images_with_albums': '''
        SELECT images.*,
            CASE WHEN a1.imageID IS NOT NULL THEN 1 ELSE 0 END AS is_archived,
            CASE WHEN a2.imageID IS NOT NULL THEN 1 ELSE 0 END AS is_favorite_helper
        FROM images
        LEFT JOIN (album_images a1 INNER JOIN albums b1 ON a1.albumID = b1.albumID)
        ON a1.imageID = images.imageID AND LOWER(b1.label) = 'archive'
        LEFT JOIN (album_images a2 INNER JOIN albums b2 ON a2.albumID = b2.albumID)
        ON a2.imageID = images.imageID AND LOWER(b2.label) = 'favorites';
    ''',
    'accessible_albums': '''
        SELECT albums.* FROM albums
        WHERE EXISTS (
            SELECT 1
            FROM profiles LEFT JOIN profile_albums
            ON profiles.profileID = profile_albums.profileID
            AND profiles.profileID = cur_profile('profileID')
            WHERE (
                profiles.profileID = cur_profile('profileID')
                AND ((profiles.all_albums = 1 AND (profile_albums.albumID IS NULL))
                OR (profiles.all_albums = 0 AND profile_albums.accessible = 1))
            )
        )
    ''',
    'accessible_images': '''
        SELECT i.*,
        (a2.albumID IS NOT NULL AND i.is_favorite_helper = 1) AS is_favorite
        FROM images_with_albums as i
        LEFT JOIN accessible_albums as a1 on LOWER(a1.label) = 'archive'
        LEFT JOIN accessible_albums as a2 on LOWER(a2.label) = 'favorites'
        WHERE EXISTS (
            SELECT 1
            FROM profiles LEFT JOIN profile_images
            ON profiles.profileID = profile_images.profileID AND i.imageID = profile_images.imageID
            WHERE profiles.profileID = cur_profile('profileID') AND (
                (profiles.all_images = 1 AND (profile_images.imageID IS NULL OR profile_images.accessible = 1))
                OR (profiles.all_images = 0 AND profile_images.accessible = 1)
            )
        )
        AND (a1.albumID IS NOT NULL OR i.is_archived = 0)
        AND (include_archived() = 1 OR i.is_archived = 0)
    ''',
    'accessible_groups': '''
        SELECT groups.* FROM groups
        WHERE NOT EXISTS (
            SELECT 1 FROM faces WHERE faces.groupID = groups.groupID
        )
        OR EXISTS (
            SELECT 1
            FROM faces 
            INNER JOIN accessible_images ON faces.imageID = accessible_images.imageID
            WHERE faces.groupID = groups.groupID
        )
    ''',
    'accessible_faces': '''
        SELECT faces.*
        FROM faces 
        INNER JOIN accessible_images ON faces.imageID = accessible_images.imageID
    ''',
    'groups_images': '''
        SELECT DISTINCT i.*, groups.groupID, min(faces.faceID) as representative_face
        FROM images_with_albums i
        INNER JOIN faces ON i.imageID = faces.imageID
        INNER JOIN groups ON faces.groupID = groups.groupID
        GROUP BY i.imageID, groups.groupID
    ''',
    'accessible_groups_images': '''
        SELECT accessible_images.*, groups_images.groupID, groups_images.representative_face
        FROM groups_images
        INNER JOIN accessible_images ON groups_images.imageID = accessible_images.imageID
    ''',
    'accessible_moments': '''
        SELECT moments.* FROM moments
    ''',
    'accessible_albums_images': '''
        SELECT album_images.*
        FROM album_images
        INNER JOIN accessible_images ON album_images.imageID = accessible_images.imageID
        INNER JOIN accessible_albums ON album_images.albumID = accessible_albums.albumID
    ''',
    'editable_profiles_details': '''
        SELECT profileID, label, password FROM profiles
        WHERE (profileID = cur_profile('profileID') AND hierarchy_rank > 0)
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
        SET groupID = NEW.groupID
        WHERE faceID = OLD.faceID;
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
        SET momentID = NEW.momentID
        WHERE imageID = OLD.imageID;
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
        WHERE imageID = OLD.imageID;
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
        WHERE groupID = OLD.groupID;
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
        WHERE groupID = OLD.groupID;
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

        INSERT INTO groups (groupID, label, representative_face)
        VALUES (NEW.groupID, NEW.label, NEW.representative_face);
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
        WHERE momentID = OLD.momentID;
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
        WHERE momentID = OLD.momentID;
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

        INSERT INTO moments (momentID, label, description, start, end, representative_image)
        VALUES (NEW.momentID, NEW.label, NEW.description, NEW.start, NEW.end, NEW.representative_image);
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
        WHERE albumID = OLD.albumID;
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
        WHERE albumID = OLD.albumID;
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
        INSERT INTO albums (albumID, label, description, representative_image)
        VALUES (NEW.albumID, NEW.label, NEW.description, NEW.representative_image);
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

        INSERT OR IGNORE INTO album_images (albumID, imageID)
        SELECT accessible_albums.albumID, accessible_images.imageID
        FROM accessible_albums
        JOIN accessible_images
        WHERE accessible_albums.albumID = NEW.albumID
        AND accessible_images.imageID = NEW.imageID;
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

        DELETE FROM album_images
        WHERE albumID = OLD.albumID
        AND imageID = OLD.imageID;
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

        INSERT INTO profiles (profileID, label, password, hierarchy_rank, is_profiles_manager, can_edit, all_images, all_albums, save_preferences)
        VALUES (NEW.profileID, NEW.label, NEW.password, NEW.hierarchy_rank, NEW.is_profiles_manager, NEW.can_edit, NEW.all_images, NEW.all_albums, NEW.save_preferences);

        -- Create the profile_images and profile_albums tables
        INSERT INTO profile_images (profileID, imageID, accessible)
        SELECT NEW.profileID, imageID, accessible
        FROM profile_images
        WHERE profileID = cur_profile('profileID');

        INSERT INTO profile_albums (profileID, albumID, accessible)
        SELECT NEW.profileID, albumID, accessible
        FROM profile_albums
        WHERE profileID = cur_profile('profileID');
    END;
    """,
    'trg_update_editable_full_profiles': """
    CREATE TRIGGER IF NOT EXISTS trg_update_editable_full_profiles
    INSTEAD OF UPDATE ON editable_full_profiles
    BEGIN
        SELECT CASE
            WHEN cur_profile('is_profiles_manager') = 0 THEN
                RAISE(ABORT, 'Permission denied: not a profiles manager')
            WHEN OLD.profileID = cur_profile('profileID') THEN
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
        WHERE profileID = OLD.profileID;

        -- Update the profile_images and profile_albums tables
        DELETE FROM profile_images WHERE profileID = OLD.profileID AND NEW.all_images <> OLD.all_images;
        
        INSERT INTO profile_images (profileID, imageID, accessible)
        SELECT OLD.profileID, imageID, accessible
        FROM profile_images 
        WHERE profileID = cur_profile('profileID')
          AND NEW.all_images = 1 
          AND NEW.all_images <> OLD.all_images;

        DELETE FROM profile_albums WHERE profileID = OLD.profileID AND NEW.all_albums <> OLD.all_albums;
        
        INSERT INTO profile_albums (profileID, albumID, accessible)
        SELECT OLD.profileID, albumID, accessible
        FROM profile_albums 
        WHERE profileID = cur_profile('profileID')
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
            WHEN OLD.profileID = cur_profile('profileID') THEN
                RAISE(ABORT, 'Permission denied: cannot delete own profile')
            WHEN OLD.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                RAISE(ABORT, 'Permission denied: cannot delete profile with higher or equal rank')
        END;

        DELETE FROM profiles WHERE profileID = OLD.profileID;
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
        WHERE profileID = OLD.profileID;
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
            WHEN NEW.profileID = cur_profile('profileID') THEN
                RAISE(ABORT, 'Permission denied: cannot edit own permissions')
            WHEN EXISTS (
                SELECT 1 FROM profiles
                WHERE profileID = NEW.profileID AND hierarchy_rank >= cur_profile('hierarchy_rank')
            ) THEN
                RAISE(ABORT, 'Permission denied: cannot edit permissions for profile with higher or equal rank')
            WHEN NOT EXISTS ( -- Check if image is accessible to current manager
                SELECT 1 FROM accessible_images WHERE imageID = NEW.imageID
            ) THEN
                RAISE(ABORT, 'Permission denied: cannot grant access to an inaccessible image')
        END;

        INSERT OR IGNORE INTO profile_images (profileID, imageID, accessible)
        VALUES (NEW.profileID, NEW.imageID, NEW.accessible);
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
            WHEN NEW.profileID = cur_profile('profileID') THEN
                RAISE(ABORT, 'Permission denied: cannot edit own permissions')
            WHEN EXISTS (
                SELECT 1 FROM profiles
                WHERE profileID = NEW.profileID AND hierarchy_rank >= cur_profile('hierarchy_rank')
            ) THEN
                RAISE(ABORT, 'Permission denied: cannot edit permissions for profile with higher or equal rank')
            WHEN NOT EXISTS (
                SELECT 1 FROM accessible_albums WHERE albumID = NEW.albumID
            ) THEN
                RAISE(ABORT, 'Permission denied: cannot grant access to an inaccessible album')
        END;

        INSERT OR IGNORE INTO profile_albums (profileID, albumID, accessible)
        VALUES (NEW.profileID, NEW.albumID, NEW.accessible);
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

    def __init__(self, db_path: str, event_id: str, profile_id: str | None = None, include_archived: bool = False):
        self.db_path = db_path
        self.event_id = event_id
        self._profile_context = {}
        self.set_profile_id(profile_id)
        self.set_include_archived(include_archived)

    def _get_accessible_table_name(self, table: str) -> str:
        """
        Get the accessible view name for a table if it exists and profile filtering is enabled.
        Returns the original table name if no accessible view exists or profile filtering is disabled.
        """
        if not self.get_profile_id() or table not in STRUCTURE:
            return table
        return STRUCTURE[table]['accessible_table']

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

    def set_profile_id(self, profile_id: str | None = None):
        """Set the current profile ID for access control."""
        
        fields = {
            'profileID': '',
            'hierarchy_rank': 0,
            'is_profiles_manager': False,
            'can_edit': False,
            'all_images': False,
            'all_albums': False
        }
        profile = {}
        if profile_id:
            profile = self.execute_query('SELECT * FROM profiles WHERE profileID = ?', (profile_id,), include_columns=True)[0]

        if not profile:
            profile = {}
        
        for field, default_val in fields.items():
            val = profile.get(field, default_val)
            self._profile_context[field] = val

    def get_profile_id(self) -> str | None:
        """Get the current profile ID."""
        return self._profile_context.get('profileID')

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

    def is_exists(self, table: str, where: Dict, exclude_id: str = None) -> str | None:
        """Check if a record exists and return its ID for conflict checking."""

        id_field = STRUCTURE[table]['primary_key']

        where_clause = ' AND '.join([f'{k}=?' for k in where.keys()])
        where_params = tuple(where.values())
        
        with self.get_connection(include_archived=True) as conn:
            cursor = conn.execute(f'SELECT * FROM {table} WHERE {where_clause} AND {id_field} != ?', where_params + (exclude_id,))
            row = cursor.fetchone()
            if row:
                columns = [desc[0] for desc in cursor.description]
                record = dict(zip(columns, row))
                # Return the ID field (assuming it's the first field or named 'id')
                return record[id_field]
            return None

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
    def insert(self, table: str, data_list: List[Dict], bypass_access_control: bool = False) -> List[Union[Any, Tuple[Any, ...]]]:
        """Insert multiple records into a table/view and return their IDs."""
        if not data_list:
            return []
        
        target_table = table if bypass_access_control else self._get_accessible_table_name(table)
        
        keys = list(data_list[0].keys())
        keys_str = ', '.join(keys)
        placeholders = '(' + ', '.join(['?'] * len(keys)) + ')'
        
        sql = f'INSERT INTO {target_table} ({keys_str}) VALUES {placeholders}'

        p_keys = STRUCTURE[target_table]['primary_key']
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
    def update(self, table: str, where: Dict, fields: Dict, bypass_access_control: bool = False) -> List[Union[Any, Tuple[Any, ...]]]:
        """Update records in a table/view and return their IDs."""
        if not fields:
            return []

        target_table = table if bypass_access_control else self._get_accessible_table_name(table)
        
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

        p_keys = STRUCTURE[target_table]['primary_key']
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
    def delete(self, table: str, where: Dict, bypass_access_control: bool = False) -> List[Union[Any, Tuple[Any, ...]]]:
        """Delete records from a table/view and return their IDs."""
        target_table = table if bypass_access_control else self._get_accessible_table_name(table)
        
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

        p_keys = STRUCTURE[target_table]['primary_key']
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
