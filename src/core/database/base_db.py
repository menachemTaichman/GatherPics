import sqlite3
from typing import Any
import json
from contextlib import contextmanager
import os
from enum import Enum
from abc import ABC, abstractmethod
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

class BaseDB(ABC):
    """Abstract base class for database operations."""
    
    @classmethod
    def CONSTANTS(self) -> dict:
        """
        Database constants.
        Returns:
            dict: constants

        Example:
        {
            'id_length': 36,
        }
        """
        return {}

    @classmethod
    @abstractmethod
    def STRUCTURE(self) -> dict:
        """
        Database structure definition.
        Returns:
            dict with table names as keys and table structures as values
            the table structure is a dict with the following keys:
            - original_table: original table name if it is a view. default is the table name.
            - primary_key: str or list of primary key fields
            - accessible_table: accessible table name
            - fields: list of fields to be returned by the get_entities query
            - relations: dict with other_table_name as keys and relation info as values
                - relation_table: relation table name
                - fields_needed: list of fields needed to be returned by the get_childs query
                - relation_table_fields: list of relation_table fields to be returned by the get_childs query. default is none.
            - serializable: dict with field names as keys and field types as values, for all fields that need to be serialized
        
        Example:
        {
            'faces': {
                'primary_key': 'face_id',
                'accessible_table': 'faces',
                'fields': ['face_name', 'bbox'],
                'relations': {'images': {'relation_table': 'faces', 'fields_needed': ['date_taken']}},
                'serializable': {'bbox': list},
            },
        }
        """
        pass
    
    @classmethod
    @abstractmethod
    def TABLES(self) -> dict:
        """
        Table schema definitions.
        Returns:
            dict with table names as keys and table schemas as values
        
        Example:
        {
            'faces': '''
                face_id TEXT PRIMARY KEY NOT NULL,
                face_name TEXT NOT NULL,
                image_id TEXT NOT NULL,
                bbox TEXT NOT NULL,
                FOREIGN KEY (image_id) REFERENCES images(image_id) ON DELETE SET NULL
            '''
        }
        """
        pass
    
    @classmethod
    @abstractmethod
    def INDEXES(self) -> dict:
        """
        Index definitions.
        Returns:
            dict with index names as keys and index queries as values

        Example:
        {
            'idx_faces_image_id': 'faces(image_id)',
        }
        """
        pass
    
    @classmethod
    @abstractmethod
    def VIEWS(self) -> dict:
        """View definitions.
        Returns:
            dict with view names as keys and view queries as values

        Example:
        {
            'v_faces': 'SELECT face_id, face_name, image_id, bbox FROM faces',
        }
        """
        pass
    
    @classmethod
    @abstractmethod
    def TRIGGERS(self) -> dict:
        """Trigger definitions.
        Returns:
            dict with trigger names as keys and trigger queries as values

        Example:
        {
            'tr_faces_image_id': 'AFTER UPDATE ON faces UPDATE images SET date_taken = NEW.date_taken WHERE image_id = NEW.image_id',
        }
        """
        pass

    @classmethod
    @abstractmethod
    def current_profile_fields(self) -> dict:
        """Get the current profile fields."""
        return {}

    @staticmethod
    def serialize_value(value_type: type, value: Any) -> str:
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
    def deserialize_value(value_type: type, value_str: str) -> bool | int | float | list | dict | str:
        """Convert a database string to a Python value."""
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

    @classmethod
    def get_original_table(cls, table: str) -> str:
        """Get the original table name for a table."""
        return cls.STRUCTURE()[table].get('original_table', table)

    @classmethod
    def get_id_field(cls, table: str, remove_parent: str | None = None) -> str:
        """Get the ID field(s) for a table."""
        id_field = cls.STRUCTURE()[table].get('primary_key', '')
        if remove_parent and table != remove_parent:
            other_parent_id_field = cls.STRUCTURE()[remove_parent].get('primary_key', '')
            if isinstance(other_parent_id_field, str):
                other_parent_id_field = [other_parent_id_field]
            if isinstance(id_field, str):
                id_field = [id_field]
            id_field = [id for id in id_field if id not in other_parent_id_field]

        if isinstance(id_field, list):
            return ', '.join(id_field)
        return id_field

    @classmethod
    def is_auto_increment(cls, table: str) -> bool:
        """Check if the table has an auto increment field."""

        return 'AUTOINCREMENT' in cls.TABLES()[cls.get_original_table(table)]

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

    @classmethod
    def get_relation(cls, parent: str, child: str | None = None) -> tuple[str, str, str, list[str], list[str]] | list[tuple[str, str, str, list[str], list[str]]]:
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
            childs = cls.STRUCTURE()[parent]['relations'].keys()

        relations = []
        for child in childs:
            relation_meta = cls.STRUCTURE()[parent]['relations'][child]
            relation_table = relation_meta['relation_table']
            child_id_field = cls.get_id_field(relation_table, remove_parent=parent)
            fields = cls._get_fields([child_id_field] + relation_meta['fields_needed'], 'c')
            relation_table_fields = relation_meta.get('relation_table_fields', [])
            if relation_table_fields:
                relation_table_fields = cls._get_fields([child_id_field] + relation_table_fields, 'r')
            relations.append((relation_table, child, child_id_field, fields, relation_table_fields))

        if return_single:
            return relations[0]
        return relations

    @classmethod
    def get_view_fields(cls, table: str, as_table: str | None = None, include_details: bool = False) -> str:
        """Get view fields for a table.
        Args:
            table: table name
            as_table: table name to be used as the table prefix
            include_details: if True, include details fields in the result
        Returns:
            string of fields
        """
        id_field = cls.get_id_field(table)
        fields = [id_field] + cls.STRUCTURE()[table].get('fields', [])
        if include_details:
            fields.extend(cls.STRUCTURE()[table].get('details_fields', []))
        return cls._get_fields(fields, as_table)

    @classmethod
    def create_db(cls, db_path: str):
        """Create a new SQLite DB with all tables and initial data."""
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        
        try:
            # Create tables            
            for table, schema in cls.TABLES().items():
                conn.execute(f'CREATE TABLE IF NOT EXISTS {table} ({schema})')
            
            # Create indexes
            for index_name, index_query in cls.INDEXES().items():
                conn.execute(f'CREATE INDEX IF NOT EXISTS {index_name} ON {index_query}')
            
            # Create views
            for view_name, view_sql in cls.VIEWS().items():
                conn.execute(f'CREATE VIEW IF NOT EXISTS {view_name} AS {view_sql}')
            
            # Create triggers
            for trigger_name, trigger_sql in cls.TRIGGERS().items():
                conn.execute(f'CREATE TRIGGER IF NOT EXISTS {trigger_name} {trigger_sql}')
            
            conn.commit()
        finally:
            conn.close()
        
        return db_path

    def __init__(self, db_path: str, profile_id: str | None = None):
        """Initialize database connection."""
        self.db_path = db_path
        if not os.path.exists(self.db_path):
            file_name = os.path.basename(self.db_path)
            raise FileNotFoundError(f"Database file not found: {file_name}")

        self.profile_id = profile_id

    @property
    def profile_id(self) -> str | None:
        """Get the current profile id for access control."""
        return self._profile_context.get('profile_id')

    @profile_id.setter
    def profile_id(self, profile_id: str | None):
        """Set the current profile id for access control."""
        
        profile = self.execute_query('SELECT * FROM profiles WHERE profile_id = ?', (profile_id,), return_format=ReturnFormat.DICT)

        self._profile_context = {}
        if profile:
            for field, default_val in self.current_profile_fields().items():
                val = profile.get(field, default_val)
                self._profile_context[field] = val

    @property
    def profile_context(self) -> dict:
        return self._profile_context

    @contextmanager
    def get_connection(self):
        """Context manager for database connections with profile context."""
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        
        try:
            conn.create_function("cur_profile", 1, lambda key: self.profile_context.get(key))
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
