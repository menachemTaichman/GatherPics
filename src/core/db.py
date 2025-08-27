import sqlite3
from typing import List, Dict, Optional, Union
from contextlib import contextmanager

ACCESSIBLE_VIEWS = {
    'images': 'accessible_images',
    'faces': 'accessible_faces',
    'groups': 'accessible_groups',
    'moments': 'accessible_moments',
    'albums': 'accessible_albums'
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
        FOREIGN KEY (imageID) REFERENCES images(imageID) ON DELETE SET NULL
        FOREIGN KEY (groupID) REFERENCES groups(groupID) ON DELETE SET NULL
    ''',
    'images': '''
        imageID TEXT PRIMARY KEY,
        name TEXT,
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
        face_representative TEXT
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
        label TEXT,
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
    'idx_profile_images_imageid ON profile_images(imageID)',
    'idx_images_momentid ON images(momentID)',
    'idx_groups_face_representative ON groups(face_representative)',
    'idx_moments_representative_image ON moments(representative_image)',
    'idx_faces_groupid_imageid ON faces(groupID, imageID)',
    'idx_images_date_taken ON images(date_taken)',
    'idx_albums_representative_image ON albums(representative_image)',
]

VIEWS = {
    'accessible_images': '''
        SELECT images.*
        FROM images
        WHERE EXISTS (
            SELECT 1
            FROM profiles LEFT JOIN profile_images
            ON profiles.profileID = profile_images.profileID AND images.imageID = profile_images.imageID
            WHERE profiles.profileID = cur_profile('profileID') AND (
                (profiles.all_images = 1 AND (profile_images.imageID IS NULL OR profile_images.accessible = 1))
                OR (profiles.all_images = 0 AND profile_images.accessible = 1)
            )
        )
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
        WHERE EXISTS (
            SELECT 1 FROM accessible_images WHERE accessible_images.imageID = faces.imageID
        )
        OR EXISTS (
            SELECT 1 FROM accessible_groups 
            WHERE accessible_groups.groupID = faces.groupID 
            AND accessible_groups.face_representative = faces.faceID
        )
    ''',
    'accessible_moments': '''
        SELECT moments.* FROM moments
        WHERE NOT EXISTS (
            SELECT 1 FROM images WHERE images.momentID = moments.momentID
        )
        OR EXISTS (
            SELECT 1 FROM accessible_images 
            INNER JOIN images ON accessible_images.imageID = images.imageID
            WHERE images.momentID = moments.momentID
        )
    ''',
    'accessible_albums': '''
        SELECT albums.* FROM albums
        WHERE EXISTS (
            SELECT 1
            FROM profiles LEFT JOIN profile_albums
            ON profiles.profileID = profile_albums.profileID
            AND profiles.profileID = cur_profile('profileID')
            WHERE (
                (profiles.all_albums = 1 AND (profile_albums.albumID IS NULL))
                OR (profiles.all_albums = 0 AND profile_albums.accessible = 1)
            )
        )
    ''',
    'accessible_albums_images': '''
        SELECT album_images.*
        FROM album_images
        INNER JOIN accessible_images ON album_images.imageID = accessible_images.imageID
        INNER JOIN accessible_albums ON album_images.albumID = accessible_albums.albumID
    ''',
    'representative_images': '''
        SELECT DISTINCT images.imageID
        FROM images
        LEFT JOIN accessible_moments ON images.imageID = accessible_moments.representative_image
        LEFT JOIN accessible_albums ON images.imageID = accessible_albums.representative_image
        WHERE (accessible_moments.representative_image IS NOT NULL OR accessible_albums.representative_image IS NOT NULL)
    ''',
    'representative_faces': '''
        SELECT faces.faceID
        FROM faces INNER JOIN accessible_groups ON faces.faceID = accessible_groups.face_representative
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
    INSTEAD OF UPDATE ON accessible_groups
    BEGIN
        SELECT CASE
            WHEN cur_profile('can_edit') = 0 THEN
                RAISE(ABORT, 'Permission denied')
        END;

        UPDATE groups
        SET label = NEW.label,
            face_representative = NEW.face_representative
        WHERE groupID = OLD.groupID;
    END;
    """,
    'trg_delete_accessible_groups': """
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

    # accessible_moments
    'trg_update_accessible_moments': """
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

    # accessible_albums
    'trg_update_accessible_albums': """
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

    # accessible_albums_images
    'trg_insert_accessible_albums_images': """
    INSTEAD OF INSERT ON accessible_albums_images
    BEGIN
        SELECT CASE
            WHEN cur_profile('can_edit') = 0 THEN
                RAISE(ABORT, 'Permission denied')
            WHEN NOT EXISTS (SELECT 1 FROM accessible_albums WHERE albumID = NEW.albumID) THEN
                RAISE(ABORT, 'Album not accessible')
            WHEN NOT EXISTS (SELECT 1 FROM accessible_images WHERE imageID = NEW.imageID) THEN
                RAISE(ABORT, 'Image not accessible')
        END;

        INSERT INTO album_images (albumID, imageID)
        VALUES (NEW.albumID, NEW.imageID);
    END;
    """,
    
    # editable_full_profiles
    'trg_insert_editable_full_profiles': """
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

    END;
    """,
    'trg_delete_editable_full_profiles': """
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
    INSTEAD OF INSERT ON editable_profile_images
    BEGIN
        SELECT CASE
            WHEN cur_profile('is_profiles_manager') = 0 THEN
                RAISE(ABORT, 'Permission denied: not a profiles manager')
            WHEN NOT EXISTS ( -- Check rank of target profile
                SELECT 1 FROM profiles
                WHERE profileID = NEW.profileID AND hierarchy_rank < cur_profile('hierarchy_rank')
            ) THEN
                RAISE(ABORT, 'Permission denied: cannot edit permissions for this profile')
            WHEN NOT EXISTS ( -- Check if image is accessible to current manager
                SELECT 1 FROM accessible_images WHERE imageID = NEW.imageID
            ) THEN
                RAISE(ABORT, 'Permission denied: cannot grant access to an inaccessible image')
        END;

        INSERT INTO profile_images (profileID, imageID, accessible)
        VALUES (NEW.profileID, NEW.imageID, NEW.accessible);
    END;
    """,

    # editable_profile_albums
    'trg_insert_editable_profile_albums': """
    INSTEAD OF INSERT ON editable_profile_albums
    BEGIN
        SELECT CASE
            WHEN cur_profile('is_profiles_manager') = 0 THEN
                RAISE(ABORT, 'Permission denied: not a profiles manager')
            WHEN NOT EXISTS (
                SELECT 1 FROM profiles
                WHERE profileID = NEW.profileID AND hierarchy_rank < cur_profile('hierarchy_rank')
            ) THEN
                RAISE(ABORT, 'Permission denied: cannot edit permissions for this profile')
            WHEN NOT EXISTS (
                SELECT 1 FROM accessible_albums WHERE albumID = NEW.albumID
            ) THEN
                RAISE(ABORT, 'Permission denied: cannot grant access to an inaccessible album')
        END;

        INSERT INTO profile_albums (profileID, albumID, accessible)
        VALUES (NEW.profileID, NEW.albumID, NEW.accessible);
    END;
    """,
}

class AppDB:

    def __init__(self, db_path: str, profile_id: str | None = None):
        self.db_path = db_path
        self.set_profile_id(profile_id)

    def create_new_db_in_dir(self, dir_path: str, db_name: str | None = None):
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
            for trigger_sql in TRIGGERS:
                conn.execute(trigger_sql)

            conn.commit()
        finally:
            conn.close()
        return db_path 

    def set_profile_id(self, profile_id: Optional[str]):
        """Set the current profile ID for access control."""
        
        fields = {'profileID': '', 'hierarchy_rank': 0, 'is_profiles_manager': False, 'can_edit': False, 'all_images': False, 'all_albums': False}
        self.profile_context = {}
        if profile_id:
            profile = self.get_one('profiles', {'profileID': profile_id})
        
        for field, default_val in fields.items():
            val = default_val
            if profile:
                val = profile.get(field, default_val)
            self.profile_context[field] = val

    @contextmanager
    def get_connection(self):
        """Context manager for database connections."""

        conn = sqlite3.connect(self.db_path)
        # Enable foreign key constraints
        conn.execute("PRAGMA foreign_keys = ON")
        # Register the current profile context on every connection
        conn.create_function("cur_profile", 1, lambda key: self.profile_context.get(key))

        try:
            yield conn
        finally:
            conn.close()

    def get_all(self, table: str) -> List[Dict]:

        accessible_table = self._get_accessible_table_name(table)
        with self.get_connection() as conn:
            cursor = conn.execute(f'SELECT * FROM {accessible_table}')
            columns = [desc[0] for desc in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]

    def get_one(self, table: str, where: Dict) -> Dict | None:

        accessible_table = self._get_accessible_table_name(table)
        where_clause = ' AND '.join([f'{k}=?' for k in where.keys()])
        where_params = tuple(where.values())
        
        with self.get_connection() as conn:
            cursor = conn.execute(f'SELECT * FROM {accessible_table} WHERE {where_clause}', where_params)
            row = cursor.fetchone()
            if row:
                columns = [desc[0] for desc in cursor.description]
                return dict(zip(columns, row))
            return None

    def is_exists(self, table: str, where: Dict) -> str | None:
        """Check if a record exists and return its ID for conflict checking."""

        where_clause = ' AND '.join([f'{k}=?' for k in where.keys()])
        where_params = tuple(where.values())
        
        with self.get_connection() as conn:
            cursor = conn.execute(f'SELECT * FROM {table} WHERE {where_clause}', where_params)
            row = cursor.fetchone()
            if row:
                columns = [desc[0] for desc in cursor.description]
                record = dict(zip(columns, row))
                # Return the ID field (assuming it's the first field or named 'id')
                id_field = [col for col in columns if col.endswith('ID') or col == 'id'][0]
                return record[id_field]
            return None

    def is_representative_image(self, image_id: str) -> bool:
        """Check if an image is a representative image."""
        return self.execute_query(f'SELECT 1 FROM representative_images WHERE imageID = ?', (image_id,))
    
    def is_representative_face(self, face_id: str) -> bool:
        """Check if a face is a representative face."""
        return self.execute_query(f'SELECT 1 FROM representative_faces WHERE faceID = ?', (face_id,))

    def execute_query(self, query: str, params: tuple = ()) -> List[tuple]:
        """Execute a custom query and return results."""
        with self.get_connection() as conn:
            cursor = conn.execute(query, params)
            # For SELECT queries, fetch and return results
            if query.strip().upper().startswith('SELECT'):
                return cursor.fetchall()
            # For non-SELECT queries (INSERT, UPDATE, DELETE), commit and return empty list
            conn.commit()
            return []

    def secure_action_query(self, action_type: str, table: str, where: Dict, fields: Dict = None, data_list: List[Dict] = None) -> bool:
        """
        Execute an action query (UPDATE, DELETE, INSERT) with security checks.
        
        Args:
            action_type: 'UPDATE', 'DELETE', or 'INSERT'
            table: Table name to operate on
            where: WHERE clause conditions (for UPDATE/DELETE)
            fields: For UPDATE operations, the fields to update
            data_list: For INSERT operations, list of records to insert
            
        Returns:
            bool: True if action was executed successfully, False if security check failed
            
        Security checks:
        1. Profile has permission to perform the action
        2. Target records are accessible to the profile
        """
        if not self._current_profile_id:
            return False
            
        # Check profile permissions first
        is_allowed, fields, data_list = self._check_profile_permissions(action_type, table, where, fields, data_list)
        if not is_allowed:
            return False
            
        # Execute the action
        try:
            with self.get_connection() as conn:
                if action_type.upper() == 'UPDATE':
                    if not fields:
                        return True
                    final_where, final_params = self._get_secure_where_clause(table, where)
                    set_clause = ', '.join([f'{k}=?' for k in fields.keys()])
                    values = tuple(fields.values()) + final_params
                    query = f'UPDATE {table} SET {set_clause} WHERE {final_where}'
                    conn.execute(query, values)
                elif action_type.upper() == 'DELETE':
                    final_where, final_params = self._get_secure_where_clause(table, where)
                    query = f'DELETE FROM {table} WHERE {final_where}'
                    conn.execute(query, final_params)
                elif action_type.upper() == 'INSERT':
                    if not data_list:
                        return True
                    keys = list(data_list[0].keys())
                    keys_str = ', '.join(keys)
                    placeholders = '(' + ', '.join(['?'] * len(keys)) + ')'
                    all_placeholders = ', '.join([placeholders] * len(data_list))
                    values = [v for row in data_list for v in row.values()]
                    sql = f'INSERT INTO {table} ({keys_str}) VALUES {all_placeholders}'
                    conn.execute(sql, values)
                else:
                    raise ValueError(f"Unsupported action type: {action_type}")
                conn.commit()
            return True
        except Exception:
            return False

    def secure_update(self, table: str, where: Dict, fields: Dict) -> bool:
        """Securely update records with permission and accessibility checks."""
        return self.secure_action_query('UPDATE', table, where, fields)

    def secure_delete(self, table: str, where: Union[Dict, List[Dict]]) -> bool:
        """Securely delete records with permission and accessibility checks."""
        return self.secure_action_query('DELETE', table, where)

    def secure_insert(self, table: str, data_list: List[Dict]) -> bool:
        """Securely insert multiple records with permission checks."""
        return self.secure_action_query('INSERT', table, {}, data_list=data_list)

    def _get_accessible_table_name(self, table: str) -> str:
        """
        Get the accessible view name for a table if it exists and profile filtering is enabled.
        Returns the original table name if no accessible view exists or profile filtering is disabled.
        """
        if not self._current_profile_id or table not in ACCESSIBLE_VIEWS:
            return table
        return ACCESSIBLE_VIEWS[table]

    def _get_secure_where_clause(self, table: str, where: Union[Dict, List[Dict]]) -> tuple:
        """
        Get a WHERE clause that restricts operations to accessible records only.
        If any records in the `where` scope are restricted, it adds a filter
        to ensure the operation only applies to records accessible by the current profile.
        """
        where_clause = "1=1"
        where_params = ()

        if isinstance(where, list):
            if not where:
                return ('1=0', ()) # Nothing to delete
            
            conditions = []
            params = []
            for item in where:
                item_conditions = []
                for k, v in item.items():
                    item_conditions.append(f'{k}=?')
                    params.append(v)
                conditions.append('(' + ' AND '.join(item_conditions) + ')')
            where_clause = ' OR '.join(conditions)
            where_params = tuple(params)

        elif isinstance(where, dict) and where:
            where_clause = ' AND '.join([f'{k}=?' for k in where.keys()])
            where_params = tuple(where.values())

        if not self._current_profile_id:
            # No profile, allow if not a restricted table for actions
            if table in ['images', 'faces', 'albums']:
                return ('1=0', ())  # No access
            return (where_clause, where_params)

        # Groups and moments only need permission checks, no accessibility restrictions on actions
        if table not in ['images', 'faces', 'albums']:
            return (where_clause, where_params)

        pk_map = {'images': 'imageID', 'faces': 'faceID', 'albums': 'albumID'}
        pk_col = pk_map.get(table)
        if not pk_col:
            return ('1=0', ())  # Fail safe

        accessible_table = self._get_accessible_table_name(table)

        # Check if there are any records in scope that are not accessible
        restricted_query = f"""
            SELECT EXISTS(
                SELECT 1 FROM {table} t
                WHERE {where_clause}
                AND NOT EXISTS (
                    SELECT 1 FROM {accessible_table} a
                    WHERE a.{pk_col} = t.{pk_col}
                )
            )
        """
        restricted_result = self.execute_query(restricted_query, where_params)
        has_restricted = bool(restricted_result and restricted_result[0][0])

        if has_restricted:
            # Restrict to accessible records within the original scope
            if where:
                secure_where_clause = f"({where_clause}) AND {pk_col} IN (SELECT {pk_col} FROM {accessible_table})"
            else:
                secure_where_clause = f"{pk_col} IN (SELECT {pk_col} FROM {accessible_table})"
            return (secure_where_clause, where_params)

        # All records are accessible, no extra filter needed
        return (where_clause, where_params)

    def _check_hierarchy_permissions(self, action_type: str, table: str, where: Dict = None, fields: Dict = None, data_list: List[Dict] = None) -> tuple:
        current_profile = self.get_one('profiles', {'profileID': self._current_profile_id})
        if not current_profile:
            return False, fields, data_list

        current_rank = current_profile['hierarchy_rank']

        if action_type.upper() == 'UPDATE':
            if table == 'profiles':
                target_profile_id = where.get('profileID')
                if not target_profile_id or len(where.keys()) > 1:
                    return False, fields, data_list

                if target_profile_id == self._current_profile_id:
                    if current_rank == 0:
                        return True, fields, data_list
                    else:
                        allowed_fields = {'label', 'password'}
                        new_fields = {}
                        if fields:
                            for field, value in fields.items():
                                if field in allowed_fields:
                                    new_fields[field] = value
                        return True, new_fields, data_list
                else:
                    target_profile = self.get_one('profiles', {'profileID': target_profile_id})
                    if not target_profile:
                        return False, fields, data_list
                    
                    if target_profile['hierarchy_rank'] < current_rank:
                        return True, fields, data_list
                    else:
                        return False, fields, data_list
            
            elif table in ['profile_images', 'profile_albums']:
                target_profile_id = where.get('profileID')
                if not target_profile_id:
                    return False, fields, data_list

                if target_profile_id == self._current_profile_id:
                    return True, fields, data_list
                
                target_profile = self.get_one('profiles', {'profileID': target_profile_id})
                if not target_profile: return False, fields, data_list
                
                if target_profile['hierarchy_rank'] < current_rank:
                    return True, fields, data_list
                
                return False, fields, data_list

        if action_type.upper() == 'DELETE':
            if isinstance(where, list):
                target_profile_ids = {item.get('profileID') for item in where}
            else:
                target_profile_ids = {where.get('profileID')}

            for target_profile_id in target_profile_ids:
                if not target_profile_id:
                    return False, fields, data_list

                if target_profile_id == self._current_profile_id:
                    return False, fields, data_list

                target_profile = self.get_one('profiles', {'profileID': target_profile_id})
                if not target_profile:
                    continue

                if target_profile['hierarchy_rank'] >= current_rank:
                    return False, fields, data_list
            return True, fields, data_list

        if action_type.upper() == 'INSERT':
            if table == 'profiles':
                if not all(item.get('hierarchy_rank', 0) < current_rank for item in data_list):
                    return False, fields, data_list
                return True, fields, data_list

            elif table in ['profile_images', 'profile_albums']:
                target_profile_ids = {item.get('profileID') for item in data_list if item.get('profileID') != self._current_profile_id}
                if target_profile_ids:
                    placeholders = ','.join(['?'] * len(target_profile_ids))
                    query = f"SELECT profileID, hierarchy_rank FROM profiles WHERE profileID IN ({placeholders})"
                    results = self.execute_query(query, tuple(target_profile_ids))
                    ranks = {row[0]: row[1] for row in results}
                    
                    if len(ranks) != len(target_profile_ids):
                        return False, fields, data_list

                    for pid in target_profile_ids:
                        if ranks[pid] >= current_rank:
                            return False, fields, data_list
                return True, fields, data_list
        
        return False, fields, data_list

    def _check_profile_permissions(self, action_type: str, table: str, where: Dict = None, fields: Dict = None, data_list: List[Dict] = None) -> tuple:
        """
        Check if the current profile has permission to perform the action on the table.
        For profiles, it also modifies fields based on hierarchy.
        Returns: (is_allowed, modified_fields, modified_data_list)
        """
        if not self._current_profile_id:
            return False, fields, data_list
        
        if table in ['profiles', 'profile_images', 'profile_albums']:
            return self._check_hierarchy_permissions(action_type, table, where, fields, data_list)
            
        # Get profile permissions
        profile_query = """
            SELECT can_edit_groups, can_edit_moments, can_edit_albums, 
                   can_upload_images, can_delete_images
            FROM profiles 
            WHERE profileID = ?
        """
        result = self.execute_query(profile_query, (self._current_profile_id,))
        if not result:
            return False, fields, data_list
            
        profile = result[0]
        
        # Map table names to permission flags
        table_permissions = {
            'groups': profile[0],      # can_edit_groups
            'moments': profile[1],     # can_edit_moments
            'albums': profile[2],      # can_edit_albums
            'images': profile[3],      # can_upload_images (for updates)
            'faces': profile[0],       # can_edit_groups (faces are part of groups)
        }
        
        # For DELETE operations, check delete permission
        if action_type.upper() == 'DELETE':
            allow = False
            if table == 'images':
                allow = bool(profile[4])  # can_delete_images
            elif table == 'albums':
                allow = bool(profile[2])  # can_edit_albums
            elif table == 'moments':
                allow = bool(profile[1])  # can_edit_moments
            elif table == 'groups':
                allow = bool(profile[0])  # can_edit_groups
            return allow, fields, data_list
            
        # For INSERT operations, check appropriate permission
        if action_type.upper() == 'INSERT':
            allow = True
            if table == 'images':
                allow = bool(profile[3])  # can_upload_images
            elif table in ['groups', 'moments', 'albums']:
                allow = bool(table_permissions.get(table, False))
            return allow, fields, data_list
            
        # For other operations, check edit permission for the table
        return bool(table_permissions.get(table, True)), fields, data_list
