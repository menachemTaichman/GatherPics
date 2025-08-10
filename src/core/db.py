import sqlite3
from typing import List, Dict, Optional
from contextlib import contextmanager

# Define which tables are restricted by profile access
RESTRICTED_TABLES = {
    'images': 'imageID',
    'faces': 'imageID',  # Faces are restricted via their associated images
    'groups': 'groupID',  # Groups are restricted if they have no accessible images
    'moments': 'momentID'  # Moments are restricted if they have no accessible images
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
        end TEXT
    ''',
    'profiles': '''
        profileID TEXT PRIMARY KEY,
        label TEXT,
        all_images BOOLEAN,
        can_edit_groups BOOLEAN,
        can_upload_photos BOOLEAN,
        can_edit_moments BOOLEAN
    ''',
    'profile_images': '''
        profileID TEXT,
        imageID TEXT,
        accessible BOOLEAN,
        FOREIGN KEY (profileID) REFERENCES profiles(profileID) ON DELETE CASCADE,
        FOREIGN KEY (imageID) REFERENCES images(imageID) ON DELETE CASCADE,
        PRIMARY KEY (profileID, imageID)
    '''
}

class AppDB:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._current_profile_id = None

    def set_profile_id(self, profile_id: Optional[str]):
        """Set the current profile ID for access control."""
        self._current_profile_id = profile_id

    def get_profile_id(self) -> Optional[str]:
        """Get the current profile ID."""
        return self._current_profile_id

    def _get_accessible_images_condition(self, profile_id: str) -> tuple:
        """
        Get SQL condition and parameters for accessible images based on profile.
        Returns (condition, params) where condition is a WHERE clause fragment.
        """
        if not profile_id:
            return ("1=1", ())  # No restriction if no profile
        
        # Check if profile has all_images access
        profile_query = "SELECT all_images FROM profiles WHERE profileID = ?"
        result = self.execute_query(profile_query, (profile_id,))
        if not result:
            return ("1=0", ())  # Profile doesn't exist, no access
        
        has_all_images = bool(result[0][0])
        
        if has_all_images:
            # Profile has access to all images except those explicitly excluded
            condition = """
                imageID NOT IN (
                    SELECT imageID FROM profile_images 
                    WHERE profileID = ? AND accessible = 0
                )
            """
            return (condition, (profile_id,))
        else:
            # Profile only has access to explicitly allowed images
            condition = """
                imageID IN (
                    SELECT imageID FROM profile_images 
                    WHERE profileID = ? AND accessible = 1
                )
            """
            return (condition, (profile_id,))

    def _get_accessible_groups_condition(self, profile_id: str) -> tuple:
        """
        Get SQL condition for accessible groups (groups with at least one accessible image or empty groups).
        """
        if not profile_id:
            return ("1=1", ())  # No restriction if no profile
        
        accessible_images_condition, params = self._get_accessible_images_condition(profile_id)
        condition = f"""
            groupID IN (
                SELECT DISTINCT groupID FROM faces 
                WHERE groupID IS NOT NULL 
                AND imageID IN (
                    SELECT imageID FROM images WHERE {accessible_images_condition}
                )
            )
            OR groupID NOT IN (
                SELECT DISTINCT groupID FROM faces 
                WHERE groupID IS NOT NULL
            )
        """
        return (condition, params)

    def _get_accessible_moments_condition(self, profile_id: str) -> tuple:
        """
        Get SQL condition for accessible moments (moments with at least one accessible image or empty moments).
        """
        if not profile_id:
            return ("1=1", ())  # No restriction if no profile
        
        accessible_images_condition, params = self._get_accessible_images_condition(profile_id)
        condition = f"""
            momentID IN (
                SELECT DISTINCT momentID FROM images 
                WHERE momentID IS NOT NULL 
                AND {accessible_images_condition}
            )
            OR momentID NOT IN (
                SELECT DISTINCT momentID FROM images 
                WHERE momentID IS NOT NULL
            )
        """
        return (condition, params)

    def _apply_profile_filter(self, table: str, where_clause: str = "", where_params: tuple = ()) -> tuple:
        """
        Apply profile-based filtering to queries.
        Returns (final_where_clause, final_params)
        """
        if not self._current_profile_id or table not in RESTRICTED_TABLES:
            return (where_clause, where_params)
        
        profile_conditions = {
            'images': self._get_accessible_images_condition,
            'faces': self._get_accessible_images_condition,  # Filter via imageID
            'groups': self._get_accessible_groups_condition,
            'moments': self._get_accessible_moments_condition
        }
        
        if table not in profile_conditions:
            return (where_clause, where_params)
        
        profile_condition, profile_params = profile_conditions[table](self._current_profile_id)
        
        if table == 'faces':
            # For faces, we need to join with images to apply the filter
            profile_condition = f"""
                imageID IN (
                    SELECT imageID FROM images WHERE {profile_condition}
                )
            """
        
        if where_clause:
            final_where = f"({where_clause}) AND ({profile_condition})"
            final_params = where_params + profile_params
        else:
            final_where = profile_condition
            final_params = profile_params
        
        return (final_where, final_params)

    @contextmanager
    def get_connection(self):
        """Context manager for database connections."""
        conn = sqlite3.connect(self.db_path)
        # Enable foreign key constraints
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
        finally:
            conn.close()

    def create_table(self, table_name: str, schema: str):
        with self.get_connection() as conn:
            conn.execute(f'''CREATE TABLE IF NOT EXISTS {table_name} ({schema})''')
            conn.commit()

    def insert(self, table: str, data: Dict):
        with self.get_connection() as conn:
            keys = ', '.join(data.keys())
            placeholders = ', '.join(['?'] * len(data))
            values = tuple(data.values())
            conn.execute(f'''INSERT OR REPLACE INTO {table} ({keys}) VALUES ({placeholders})''', values)
            conn.commit()

    def insert_many(self, table: str, data_list: List[Dict]):
        if not data_list:
            return
        keys = list(data_list[0].keys())
        keys_str = ', '.join(keys)
        placeholders = '(' + ', '.join(['?'] * len(keys)) + ')'
        all_placeholders = ', '.join([placeholders] * len(data_list))
        values = [v for row in data_list for v in row.values()]
        sql = f'INSERT OR REPLACE INTO {table} ({keys_str}) VALUES {all_placeholders}'
        with self.get_connection() as conn:
            conn.execute(sql, values)
            conn.commit()

    def get_all(self, table: str) -> List[Dict]:
        where_clause, params = self._apply_profile_filter(table)
        with self.get_connection() as conn:
            if where_clause:
                cursor = conn.execute(f'SELECT * FROM {table} WHERE {where_clause}', params)
            else:
                cursor = conn.execute(f'SELECT * FROM {table}')
            columns = [desc[0] for desc in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]

    def get_one(self, table: str, where: Dict) -> Dict | None:
        where_clause = ' AND '.join([f'{k}=?' for k in where.keys()])
        where_params = tuple(where.values())
        
        # Apply profile filtering
        final_where, final_params = self._apply_profile_filter(table, where_clause, where_params)
        
        with self.get_connection() as conn:
            cursor = conn.execute(f'SELECT * FROM {table} WHERE {final_where}', final_params)
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

    def delete(self, table: str, where: Dict):
        where_clause = ' AND '.join([f'{k}=?' for k in where.keys()])
        where_params = tuple(where.values())
        
        # Apply profile filtering for restricted tables
        final_where, final_params = self._apply_profile_filter(table, where_clause, where_params)
        
        with self.get_connection() as conn:
            conn.execute(f'DELETE FROM {table} WHERE {final_where}', final_params)
            conn.commit()

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

    def update(self, table: str, where: Dict, fields: Dict):
        where_clause = ' AND '.join([f'{k}=?' for k in where.keys()])
        where_params = tuple(where.values())
        
        # Don't apply profile filtering for UPDATE operations
        # Users should be able to update groups they have access to
        final_where = where_clause
        final_params = where_params
        
        with self.get_connection() as conn:
            try:
                set_clause = ', '.join([f'{k}=?' for k in fields.keys()])
                values = tuple(fields.values()) + final_params
                query = f'UPDATE {table} SET {set_clause} WHERE {final_where}'
                result = conn.execute(query, values)
                conn.commit()
            except Exception as e:
                raise

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
            for table, schema in TABLES.items():
                conn.execute(f'''CREATE TABLE IF NOT EXISTS {table} ({schema})''')
            conn.commit()
        finally:
            conn.close()
        return db_path 