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
        representative_image TEXT
    ''',
    'albums': '''
        albumID TEXT PRIMARY KEY,
        label TEXT,
        description TEXT,
        representative_image TEXT
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
        all_images BOOLEAN,
        can_upload_images BOOLEAN,
        can_delete_images BOOLEAN,
        can_edit_groups BOOLEAN,
        can_edit_moments BOOLEAN,
        all_albums BOOLEAN,
        can_edit_albums BOOLEAN,
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
        FOREIGN KEY (profileID) REFERENCES profiles(profileID) ON DELETE CASCADE,
        FOREIGN KEY (albumID) REFERENCES albums(albumID) ON DELETE CASCADE,
        PRIMARY KEY (profileID, albumID)
    '''
}

INDEXES = [
    'CREATE INDEX IF NOT EXISTS idx_faces_imageid ON faces(imageID)',
    'CREATE INDEX IF NOT EXISTS idx_faces_groupid ON faces(groupID)',
    'CREATE INDEX IF NOT EXISTS idx_profile_images_imageid ON profile_images(imageID)',
    'CREATE INDEX IF NOT EXISTS idx_images_momentid ON images(momentID)',
    'CREATE INDEX IF NOT EXISTS idx_groups_face_representative ON groups(face_representative)',
    'CREATE INDEX IF NOT EXISTS idx_moments_representative_image ON moments(representative_image)',
    'CREATE INDEX IF NOT EXISTS idx_faces_groupid_imageid ON faces(groupID, imageID)',
    'CREATE INDEX IF NOT EXISTS idx_images_date_taken ON images(date_taken)',
    'CREATE INDEX IF NOT EXISTS idx_albums_representative_image ON albums(representative_image)',
]

VIEWS = {
    'accessible_images_helper': '''
        SELECT images.imageID
        FROM images
        WHERE EXISTS (
            SELECT 1 FROM profiles LEFT JOIN profile_images
            ON profiles.profileID = profile_images.profileID
            AND profiles.profileID = get_profile_id()
            WHERE (
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
            INNER JOIN accessible_images_helper ON faces.imageID = accessible_images_helper.imageID
            WHERE faces.groupID = groups.groupID
        )
    ''',
    'accessible_faces': '''
        SELECT faces.*
        FROM faces 
        WHERE EXISTS (
            SELECT 1 FROM accessible_images_helper WHERE accessible_images_helper.imageID = faces.imageID
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
            SELECT 1 FROM accessible_images_helper 
            INNER JOIN images ON accessible_images_helper.imageID = images.imageID
            WHERE images.momentID = moments.momentID
        )
    ''',
    'accessible_albums': '''
        SELECT albums.* FROM albums
        WHERE NOT EXISTS (
            SELECT 1 FROM album_images WHERE album_images.albumID = albums.albumID
        )
        OR EXISTS (
            SELECT 1 FROM accessible_images_helper 
            INNER JOIN album_images ON accessible_images_helper.imageID = album_images.imageID
            WHERE album_images.albumID = albums.albumID
        )
    ''',
    'accessible_images': '''
        SELECT images.*
        FROM images 
        WHERE EXISTS (
            SELECT 1 FROM accessible_images_helper WHERE accessible_images_helper.imageID = images.imageID
        )
        OR EXISTS (
            SELECT 1 FROM accessible_moments WHERE accessible_moments.representative_image = images.imageID
        )
        OR EXISTS (
            SELECT 1 FROM accessible_albums WHERE accessible_albums.representative_image = images.imageID
        )
    ''',
}

class AppDB:

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._current_profile_id = None

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
                conn.execute(index_sql)
            
            # Create views
            for view_name, view_sql in VIEWS.items():
                conn.execute(f'''CREATE VIEW IF NOT EXISTS {view_name} AS {view_sql}''')
            
            conn.commit()
        finally:
            conn.close()
        return db_path 

    def set_profile_id(self, profile_id: Optional[str]):
        """Set the current profile ID for access control."""
        self._current_profile_id = profile_id

    def get_profile_id(self) -> Optional[str]:
        """Get the current profile ID."""
        return self._current_profile_id

    @contextmanager
    def get_connection(self):
        """Context manager for database connections."""
        conn = sqlite3.connect(self.db_path)
        # Enable foreign key constraints
        conn.execute("PRAGMA foreign_keys = ON")
        # Register the get_profile_id function on every connection
        conn.create_function("get_profile_id", 0, self.get_profile_id)
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
