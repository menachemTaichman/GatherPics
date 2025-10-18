from typing import List, Dict, Any
from .base_db import ReturnFormat
from abc import ABC
import uuid

class Forbidden(Exception):
    """Exception raised for forbidden access."""
    pass

class BaseModels(ABC):

    def __init__(self) -> None:
        """
        Initialize the base models.
        Set self.db to the database instance.
        """
        self.db = None

    @staticmethod
    def generate_id() -> str:
        """Generate a new UUID for the entity."""
        return str(uuid.uuid4())

    def is_exists(self, table: str, fields: Dict, exclude_id: str = None) -> str | None:
        """Check if a record exists and return its id for conflict checking."""

        where_clause = ' AND '.join([f'{k}=?' for k in fields.keys()])
        where_params = tuple(fields.values())
        if exclude_id:
            where_clause += f' AND {self.db.get_id_field(table)} != ?'
            where_params += (exclude_id,)
        id_field = self.db.get_id_field(table)
        query = f"""
            SELECT {id_field}
            FROM {table}
            WHERE {where_clause}
        """
        results = self.db.execute_query(query, where_params)
        return results[0][0] if results else None

    def is_empty(self, table: str, entity_id: str, *, child: str | None = None, only_accessible: bool = False) -> bool:
        """Check if a table is empty.
        Args:
            table: table name
            entity_id: entity id
            child: child table to check or None to check all childs
            only_accessible: if True, check only accessible childs
        Returns:
            True if the entity has no childs, False otherwise
        """
        childs = self.db.get_relation(table, child)
        if child:
            childs = [childs]
        id_field = self.db.get_id_field(table)
        for child in childs:
            relation_table = child[0]
            if only_accessible:
                relation_table = self.db.STRUCTURE()[relation_table]['accessible_table']
            query = f'SELECT EXISTS(SELECT 1 FROM {relation_table} WHERE {id_field} = ?)'
            results = self.db.execute_query(query, (entity_id,))
            if results[0][0]:
                return False
        
        return True

    def is_accessible(self, table: str, entity_id: str) -> bool:
        accessible_table = self.db.STRUCTURE()[table]['accessible_table']
        id_field = self.db.get_id_field(table)
        query = f'SELECT EXISTS(SELECT 1 FROM {accessible_table} WHERE {id_field} = ?)'
        results = self.db.execute_query(query, (entity_id,))
        return bool(results[0][0])

    def get_entities(self, table: str, entity_ids: List[str] | str | None = None) -> dict[str, Dict[str, Any]] | Dict[str, Any]:
        """Get entities from a table.
        Args:
            table: table name
            entity_ids: list of entity ids or single entity id or None to get all entities
        Returns:
            dict of entities with entity ids as keys and entity data as values
        """
        accessible_table = self.db.STRUCTURE()[table]['accessible_table']
        fields = self.db.get_view_fields(table)
        where_clause = ''
        single_item = False

        if isinstance(entity_ids, str):
            entity_ids = [entity_ids]
            single_item = True
        
        if entity_ids:
            where_clause += f'WHERE {self.db.get_id_field(table)} IN ({','.join(['?'] * len(entity_ids))})'
        else:
            entity_ids = []

        query = f"""
            SELECT {fields}
            FROM {accessible_table}
            {where_clause}
        """
        results = self.db.execute_query(query, entity_ids, return_format=ReturnFormat.DICT_DICTS)
        if results and single_item:
            return results[entity_ids[0]]
        return results

    def get_representative(self, entity: str, entity_id: str) -> tuple[str, str]:
        """Get representative of an entity.
        Args:
            entity: entity name
            entity_id: entity id
        Returns:
            representative table, representative id
        """
        representative_metadata = self.db.STRUCTURE()[entity].get('representative', {})
        if not representative_metadata:
            raise ValueError(f"Representative not found for {entity}")
        representative_table = representative_metadata['table']
        representative_field = representative_metadata['field']
        representative_id = self.db.execute_query(f'SELECT {representative_field} FROM {entity} WHERE {self.db.get_id_field(entity)} = ?', (entity_id,), return_format=ReturnFormat.VALUE)
        return representative_table, representative_id

    def get_childs(self, parent: str, entity_id: str, child: str, child_ids: list[str] | None = None, *, within: bool = True, return_ids: bool = False) -> list[str] | dict[str, dict]:
        """Get childs of a parent.
        Args:
            parent: parent entity
            entity_id: parent id
            child: child entity
            child_ids: list of child ids or None to get all childs
            within: if True, get childs within the parent, if False, get childs outside the parent
            return_ids: if True, return list of child ids, if False, return dict of childs data with child ids as keys and child data as values
        Returns:
            list of child ids or dict of childs data with child ids as keys and child data as values

        Note:
            if within is True, child_ids will be filtered to only childs within the parent
            if child_ids is None, all childs will be returned
            if within is False, child_ids will be filtered to only childs outside the parent
            if child_ids is None, all non childs will be returned
        """
        relation, child, child_id_field, view_fields = self.db.get_relation(parent, child)
        exclusive = relation == child
        accessible_relation = self.db.STRUCTURE()[relation]['accessible_table']
        accessible_child = self.db.STRUCTURE()[child]['accessible_table']
        id_field = self.db.get_id_field(parent)

        if return_ids:
            fields = f'c.{child_id_field}'
            return_format = ReturnFormat.LIST_VALUES
        else:
            fields = view_fields
            return_format = ReturnFormat.DICT_DICTS

        join_clause = ''        
        if exclusive:
            if within:
                where_clause = f'c.{id_field} = ?'
            else:
                where_clause = f'(c.{id_field} <> ? OR c.{id_field} IS NULL)'
        else:
            join_clause = f' LEFT JOIN {accessible_relation} r ON c.{child_id_field} = r.{child_id_field} AND r.{id_field} = ?'
            if within:
                where_clause = f'r.{child_id_field} IS NOT NULL'
            else:
                where_clause = f'r.{child_id_field} IS NULL'

        if child_ids is not None:
            where_clause += f' AND c.{child_id_field} IN ({','.join(['?'] * len(child_ids))})'
        else:
            child_ids = []

        query = f"""SELECT {fields}
        FROM {accessible_child} c
        {join_clause}
        WHERE {where_clause}
        """
        
        valid_child_ids = self.db.execute_query(query, (entity_id, *child_ids), return_format=return_format)

        return valid_child_ids

    def get_parents(self, child: str, entity_id: str, parents: list[str] | str | None = None) -> dict[str, list[str]] | list[str]:
        """Get parents of a child.
        Args:
            child: child entity
            entity_id: child id
            parents: list of parent ids or single parent id or None to get all parents
        Returns:
            dict of parents with parent entities as keys and list of parent ids as values
            if single parent entity is provided, return the list of parent ids
        """
        single_item = False
        if isinstance(parents, str):
            parents = [parents]
            single_item = True
        elif parents is None:
            parents = [
                parent
                for parent in self.db.STRUCTURE().keys()
                if self.db.STRUCTURE()[parent].get('relations', {}).get(child, {})
            ]
        parents = dict.fromkeys(parents, [])

        parents_to_remove = []
        for parent in parents.keys():
            relation, child, child_id_field, view_fields = self.db.get_relation(parent, child)
            accessible_relation = self.db.STRUCTURE()[relation]['accessible_table']
            id_field = self.db.get_id_field(parent)
            params = [entity_id]
            query = f"""
                SELECT DISTINCT r.{id_field}
                FROM {accessible_relation} r
                WHERE r.{child_id_field} = ?
                AND r.{id_field} IS NOT NULL
            """
            parent_ids = self.db.execute_query(query, params, return_format=ReturnFormat.LIST_VALUES)
            if parent_ids:
                parents[parent] = parent_ids
            elif not single_item:
                parents_to_remove.append(parent)

        for parent in parents_to_remove:
            parents.pop(parent)

        if single_item:
            return parents[list(parents.keys())[0]]
        
        return parents

    def add(self, table: str, data: dict) -> str | None:
        """
        Insert one entity.
        Args:
            table: table name
            data: dictionary of entity data
        Returns:
            new entity id
        """
        if not self.db.is_auto_increment(table):
            if self.db.get_id_field(table) not in data:
                data[self.db.get_id_field(table)] = self.generate_id()
        
        return self.db.insert(table, data)

    def add_many(self, table: str, fields: list[str], values: list[list[Any]]) -> list[str]:
        """
        Insert many entities.
        Args:
            table: table name
            fields: list of field names
            values: list of lists of entity data
        Returns:
            list of new entity ids
        """
        if not self.db.is_auto_increment(table):
            if self.db.get_id_field(table) not in fields:
                fields.append(self.db.get_id_field(table))
                values = [[*row, self.generate_id()] for row in values]
        
        return self.db.insert_many(table, fields, values)

    def edit(self, table: str, entity_ids: str | list[str], fields: dict) -> list[str]:
        """
        Update one or many records by their IDs.
        Returns the list of affected IDs.
        """
        condition = {self.db.get_id_field(table): entity_ids}
        return self.db.update(table, condition, fields)

    def delete(self, table: str, entity_ids: str | list[str]) -> None:
        """
        Delete one or many records by their IDs.
        """
        condition = {self.db.get_id_field(table): entity_ids}
        self.db.delete(table, condition)

    def edit_childs(self, parent: str, entity_id: str, child: str, child_ids: list[str], *, add: bool, data: dict | None = None) -> tuple[list[str], dict[str, list[str]]]:
        """Edit childs of a parent.
        Args:
            parent: parent entity
            entity_id: parent id
            child: child entity
            child_ids: list of child ids
            add: if True, add childs, if False, remove childs
            data: data to add to the relation table
        Returns:
            list of affected child ids, dict of detached parents with parent ids as keys and list of detached child ids as values
        """

        relation, child, child_id_field, view_fields = self.db.get_relation(parent, child)
        exclusive = relation == child
        accessible_relation = self.db.STRUCTURE()[relation]['accessible_table']
        id_field = self.db.get_id_field(parent)

        valid_child_ids = self.get_childs(parent, entity_id, child, child_ids, within=not add, return_ids=True)
        if not valid_child_ids:
            return [], {}

        detached_parents = {}
        if add and exclusive:
            for child_id in valid_child_ids:
                parent_ids = self.get_parents(child, child_id, parent)
                for parent_id in parent_ids:
                    detached_parents.setdefault(parent_id, []).append(child_id)

        placeholders = ','.join(['?'] * len(valid_child_ids))
        params = []
        added_data = ''
        if exclusive:
            params.extend([entity_id, *valid_child_ids])
            if data:
                added_data = ',' + ','.join([f'{k} = NULL' for k in data.keys()])

            if add:
                query = f'UPDATE {accessible_relation} SET {id_field} = ?{added_data} WHERE {child_id_field} IN ({placeholders})'
            else:
                query = f'UPDATE {accessible_relation} SET {id_field} = NULL{added_data} WHERE {id_field} = ? AND {child_id_field} IN ({placeholders})'
            self.db.execute_query(query, params)
        else:
            if add:
                added_values_clause = ''
                added_data_clause = ''
                if data:
                    added_values_clause = ',' + ','.join([f'?' for _ in range(len(data.keys()))])
                    added_data_clause = ',' + ','.join([f'{k}' for k in data.keys()])

                values_clause = ','.join([f'(?, ?{added_values_clause})'] * len(valid_child_ids))
                for cid in valid_child_ids:
                    params.extend([entity_id, cid])
                    if data:
                        params.extend(data.values())

                query = f'INSERT OR IGNORE INTO {accessible_relation} ({id_field}, {child_id_field}{added_data_clause}) VALUES {values_clause}'
                self.db.execute_query(query, params)
            else:
                params.extend([entity_id, *valid_child_ids])
                query = f'DELETE FROM {accessible_relation} WHERE {id_field} = ? AND {child_id_field} IN ({placeholders})'
                self.db.execute_query(query, params)

        return valid_child_ids, detached_parents
