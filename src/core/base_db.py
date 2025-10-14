import sqlite3
from typing import Any
from contextlib import contextmanager
import os
from enum import Enum
from abc import ABC, abstractmethod

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
    @abstractmethod
    def STRUCTURE(self) -> dict:
        """Database structure definition."""
        pass
    
    @classmethod
    @abstractmethod
    def TABLES(self) -> dict:
        """Table schema definitions."""
        pass
    
    @classmethod
    @abstractmethod
    def INDEXES(self) -> list:
        """Index definitions."""
        pass
    
    @classmethod
    @abstractmethod
    def VIEWS(self) -> dict:
        """View definitions."""
        pass
    
    @classmethod
    @abstractmethod
    def TRIGGERS(self) -> dict:
        """Trigger definitions."""
        pass
    
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
    def get_relation(cls, parent: str, child: str | None = None) -> tuple[str, str, str, list[str]] | list[tuple[str, str, str, list[str]]]:
        """Get the relation info for a parent and child.
        Args:
            structure: database structure dict
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
            childs = cls.STRUCTURE()[parent]['relations'].keys()

        relations = []
        for child in childs:
            relation_meta = cls.STRUCTURE()[parent]['relations'][child]
            relation_table = relation_meta['relation_table']
            child_id_field = cls.get_id_field(relation_table, remove_parent=parent)
            fields = cls._get_fields([child_id_field] + relation_meta['fields_needed'], 'c')
            relations.append((relation_table, child, child_id_field, fields))

        if return_single:
            return relations[0]
        return relations

    @classmethod
    def get_view_fields(cls, table: str, as_table: str | None = None) -> str:
        """Get view fields for a table."""
        id_field = cls.get_id_field(table)
        fields = [id_field] + cls.STRUCTURE()[table].get('fields', [])
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
            for index_sql in cls.INDEXES():
                conn.execute(f'CREATE INDEX IF NOT EXISTS {index_sql}')
            
            # Create views
            for view_name, view_sql in cls.VIEWS().items():
                conn.execute(f'CREATE VIEW IF NOT EXISTS {view_name} AS {view_sql}')
            
            # Create triggers
            for trigger_name, trigger_sql in cls.TRIGGERS().items():
                conn.execute(trigger_sql)
            
            conn.commit()
        finally:
            conn.close()
        
        return db_path

    def __init__(self, db_path: str):
        """Initialize database connection."""
        self.db_path = db_path
        if not os.path.exists(self.db_path):
            raise FileNotFoundError(f"Database file not found: {self.db_path}")

    @contextmanager
    def get_connection(self):
        """Context manager for database connections."""
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        
        try:
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

        with self.get_connection() as conn:
            cursor = conn.execute(query, params)
            has_resultset = cursor.description is not None
            if has_resultset:
                rows = cursor.fetchall()
            else:
                row_count = cursor.rowcount
            conn.commit()

        if has_resultset:
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

    def insert(self, table: str, data_list: list[dict]) -> list:
        """Insert one or more rows and return their primary keys (if defined)."""
        if not data_list:
            return []

        target = self.STRUCTURE()[table].get("accessible_table", table)
        p_keys = self.STRUCTURE()[table].get("primary_key")
        returning = ", ".join(p_keys) if isinstance(p_keys, list) else p_keys

        keys = list(data_list[0].keys())
        placeholders = ", ".join(["?"] * len(keys))
        sql = f"INSERT INTO {target} ({', '.join(keys)}) VALUES ({placeholders})"
        sql += f" RETURNING {returning}"

        inserted_ids = []
        for row in data_list:
            res = self.execute_query(sql, [row[k] for k in keys], ReturnFormat.LIST_VALUES)
            if isinstance(res, list):
                inserted_ids += res
        return inserted_ids

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

    def upsert(self, table: str, data_list: list[dict]) -> list:
        """Insert or update records by primary key (ON CONFLICT DO UPDATE)."""
        if not data_list:
            return []

        target = self.STRUCTURE()[table].get("accessible_table", table)
        p_keys = self.STRUCTURE()[table]["primary_key"]
        returning = ", ".join(p_keys) if isinstance(p_keys, list) else p_keys
        keys = list(data_list[0].keys())

        insert_cols = ", ".join(keys)
        placeholders = ", ".join(["?"] * len(keys))
        update_cols = [k for k in keys if k not in p_keys]
        set_clause = ", ".join([f"{k}=excluded.{k}" for k in update_cols])
        conflict_cols = ", ".join(p_keys)

        sql = f"""
            INSERT INTO {target} ({insert_cols}) VALUES ({placeholders}) 
            ON CONFLICT ({conflict_cols}) DO UPDATE SET {set_clause} 
            RETURNING {returning}
        """

        upserted_ids = []
        for row in data_list:
            res = self.execute_query(sql, [row[k] for k in keys], ReturnFormat.LIST_VALUES)
            if isinstance(res, list):
                upserted_ids += res
        return upserted_ids
