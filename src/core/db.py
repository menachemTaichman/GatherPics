import sqlite3
from typing import List, Dict
from contextlib import contextmanager

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
        face_representive TEXT
    ''',
    'moments': '''
        momentID TEXT PRIMARY KEY,
        label TEXT,
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
        with self.get_connection() as conn:
            cursor = conn.execute(f'SELECT * FROM {table}')
            columns = [desc[0] for desc in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]

    def get_one(self, table: str, where: Dict) -> Dict | None:
        with self.get_connection() as conn:
            clause = ' AND '.join([f'{k}=?' for k in where.keys()])
            values = tuple(where.values())
            cursor = conn.execute(f'SELECT * FROM {table} WHERE {clause}', values)
            row = cursor.fetchone()
            if row:
                columns = [desc[0] for desc in cursor.description]
                return dict(zip(columns, row))
            return None

    def delete(self, table: str, where: Dict):
        with self.get_connection() as conn:
            clause = ' AND '.join([f'{k}=?' for k in where.keys()])
            values = tuple(where.values())
            conn.execute(f'DELETE FROM {table} WHERE {clause}', values)
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
        with self.get_connection() as conn:
            set_clause = ', '.join([f'{k}=?' for k in fields.keys()])
            where_clause = ' AND '.join([f'{k}=?' for k in where.keys()])
            values = tuple(fields.values()) + tuple(where.values())
            conn.execute(f'UPDATE {table} SET {set_clause} WHERE {where_clause}', values)
            conn.commit()

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