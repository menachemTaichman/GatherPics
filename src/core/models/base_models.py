from typing import List, Dict, Any
from src.core.database.db import DB, ReturnFormat
from abc import ABC
import uuid
from enum import Enum

class ChildOperation(Enum):
    ADD = 'ADD'
    REMOVE = 'REMOVE'
    UPDATE = 'UPDATE'

class BaseModels(ABC):

    def __init__(self, db: DB) -> None:
        """
        Initialize the base models.
        Set self.db to the database instance.
        """
        self.db = db

    @staticmethod
    def generate_id() -> str:
        """Generate a new UUID for the entity."""
        return str(uuid.uuid4())

    def is_exists(self, table: str, fields: Dict, exclude_id: str = None) -> str | None:
        """Check if a record exists and return its id for conflict checking."""

        where_clause = ' AND '.join([f'{k}=%s' for k in fields.keys()])
        where_params = tuple(fields.values())
        if exclude_id:
            where_clause += f' AND {self.db.get_id_field(table)} != %s'
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
            query = f'SELECT EXISTS(SELECT 1 FROM {relation_table} WHERE {id_field} = %s)'
            results = self.db.execute_query(query, (entity_id,))
            if results[0][0]:
                return False
        
        return True

    def is_accessible(self, table: str, entity_id: str) -> bool:
        accessible_table = self.db.STRUCTURE()[table]['accessible_table']
        id_field = self.db.get_id_field(table)
        query = f'SELECT EXISTS(SELECT 1 FROM {accessible_table} WHERE {id_field} = %s)'
        results = self.db.execute_query(query, (entity_id,))
        return bool(results[0][0])

    def get_entities(self, table: str, entity_ids: List[str | int] | str | int | None = None, *, include_details: bool = False) -> dict[str, Dict[str, Any]] | Dict[str, Any]:
        """Get entities from a table.
        Args:
            table: table name
            entity_ids: list of entity ids or single entity id or None to get all entities
            include_details: if True, include details fields in the result
        Returns:
            dict of entities with entity ids as keys and entity data as values
            if single item is provided, return the entity data
        """
        accessible_table = self.db.STRUCTURE()[table]['accessible_table']
        fields = self.db.get_view_fields(table, include_details=include_details)
        where_clause = ''
        single_item = False

        if isinstance(entity_ids, str) or isinstance(entity_ids, int):
            entity_ids = [entity_ids]
            single_item = True
        
        if entity_ids:
            where_clause += f'WHERE {self.db.get_id_field(table)} IN ({','.join(['%s'] * len(entity_ids))})'
        else:
            entity_ids = []

        query = f"""
            SELECT {fields}
            FROM {accessible_table}
            {where_clause}
        """
        results = self.db.execute_query(query, entity_ids, return_format=ReturnFormat.DICT_DICTS)

        serialized_instructions = self.db.STRUCTURE()[table].get('serializable', {})
        if serialized_instructions:
            for entity_id, entity_data in results.items():
                for field, value_type in serialized_instructions.items():
                    if field in entity_data:
                        results[entity_id][field] = self.db.deserialize_value(value_type, entity_data[field])
        
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
        representative_id = self.db.execute_query(f'SELECT {representative_field} FROM {entity} WHERE {self.db.get_id_field(entity)} = %s', (entity_id,), return_format=ReturnFormat.VALUE)
        return representative_table, representative_id

    def get_childs(self, parent: str, entity_id: str, child: str, child_ids: list[str] | None = None, *, within: bool = True, return_ids: bool = False) -> list[str] | dict[str, dict] | tuple[list[str] | dict[str, dict], dict[str, dict]]:
        """Get childs of a parent.
        Args:
            parent: parent entity
            entity_id: parent id
            child: child entity
            child_ids: list of child ids or None to get all childs
            within: if True, get childs within the parent, if False, get childs outside the parent
            return_ids: if True, return list of child ids, if False, return dict of childs data with child ids as keys and child data as values
        Returns:
            list of child ids or dict of childs data with child ids as keys and child data as values,
            if return_ids is False and relation has fields, return also dict of relation data with child ids as keys and relation data as values

        Note:
            if within is True, child_ids will be filtered to only childs within the parent
            if child_ids is None, all childs will be returned
            if within is False, child_ids will be filtered to only childs outside the parent
            if child_ids is None, all non childs will be returned
        """
        relation_table, child_table, child_id_field, view_fields, relation_table_fields = self.db.get_relation(parent, child)
        exclusive = relation_table == child_table
        accessible_relation = self.db.STRUCTURE()[relation_table]['accessible_table']
        accessible_child = self.db.STRUCTURE()[child_table]['accessible_table']
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
                where_clause = f'c.{id_field} = %s'
            else:
                where_clause = f'(c.{id_field} <> %s OR c.{id_field} IS NULL)'
        else:
            join_clause = f' LEFT JOIN {accessible_relation} r ON c.{child_id_field} = r.{child_id_field} AND r.{id_field} = %s'
            if within:
                where_clause = f'r.{child_id_field} IS NOT NULL'
            else:
                where_clause = f'r.{child_id_field} IS NULL'

        if child_ids is not None:
            where_clause += f' AND c.{child_id_field} IN ({','.join(['%s'] * len(child_ids))})'
        else:
            child_ids = []

        query = f"""SELECT {fields}
        FROM {accessible_child} c
        {join_clause}
        WHERE {where_clause}
        """
        
        valid_childs = self.db.execute_query(query, (entity_id, *child_ids), return_format=return_format)
        if relation_table_fields and not return_ids:
            valid_child_ids = list(valid_childs.keys())
            query = f"""SELECT {relation_table_fields}
            FROM {accessible_relation} r
            WHERE r.{id_field} = %s
            AND r.{child_id_field} IN ({','.join(['%s'] * len(valid_child_ids))})
            """
            childs_data = self.db.execute_query(query, (entity_id, *valid_child_ids), return_format=ReturnFormat.DICT_DICTS)
            return valid_childs, childs_data

        return valid_childs

    def get_parents(self, child: str, entity_ids: list[str] | str, parents: list[str] | str | None = None) -> dict[str, list[str]] | list[str]:
        """Get parents of a child.
        Args:
            child: child entity
            entity_ids: list of child ids or single child id
            parents: list of parent ids or single parent id or None to get all parents
        Returns:
            if entity_ids is a single item, return the list of parent ids
            if entity_ids is a list, return dict of parents with parent ids as keys and list of child ids as values

            if parents is a single item, return the list (or dict) of parent ids
            if parents is a list, return dict of parents with parent entities as keys and list (or dict) of parent ids as values
        """
        single_parent = False
        if isinstance(parents, str):
            parents = [parents]
            single_parent = True
        elif parents is None:
            parents = [
                parent
                for parent in self.db.STRUCTURE().keys()
                if self.db.STRUCTURE()[parent].get('relations', {}).get(child, {})
            ]
        parents_to_childs = {}

        if isinstance(entity_ids, list):
            params = entity_ids
            return_format = ReturnFormat.LIST_TUPLES
        else:
            params = [entity_ids]
            return_format = ReturnFormat.LIST_VALUES

        for parent in parents:
            id_field = self.db.get_id_field(parent)
            relation, child, child_id_field, view_fields, relation_table_fields = self.db.get_relation(parent, child)
            accessible_relation = self.db.STRUCTURE()[relation]['accessible_table']
            
            if return_format == ReturnFormat.LIST_TUPLES:
                fields = f'r.{id_field}, r.{child_id_field}'
            else:
                fields = f'DISTINCT r.{id_field}'
            query = f"""
                SELECT {fields}
                FROM {accessible_relation} r
                WHERE r.{child_id_field} IN ({','.join(['%s'] * len(params))})
                AND r.{id_field} IS NOT NULL
            """
            parent_ids = self.db.execute_query(query, params, return_format=return_format)
            if return_format == ReturnFormat.LIST_TUPLES:
                parent_dict = {}
                for parent_id, child_id in parent_ids:
                    parent_dict.setdefault(parent_id, []).append(child_id)
                parent_ids = parent_dict
            
            if parent_ids or single_parent:
                parents_to_childs[parent] = parent_ids

        if single_parent:
            return parents_to_childs[parents[0]]
        
        return parents_to_childs

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

        serialized_instructions = self.db.STRUCTURE()[table].get('serializable', {})
        if serialized_instructions:
            for field, value_type in serialized_instructions.items():
                if field in data:
                    data[field] = self.db.serialize_value(value_type, data[field])

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
            id_field = self.db.get_id_field(table)
            if ", " in id_field:
                id_fields = id_field.split(', ')
            else:
                id_fields = [id_field]
            for id_field in id_fields:
                if id_field not in fields:
                    fields.append(id_field)
                    values = [[*row, self.generate_id()] for row in values]

        serialized_instructions = self.db.STRUCTURE()[table].get('serializable', {})
        if serialized_instructions:
            for field, value_type in serialized_instructions.items():
                if field in fields:
                    idx = fields.index(field)
                    values = [[*row[:idx], self.db.serialize_value(value_type, row[idx]), *row[idx+1:]] for row in values]
        
        return self.db.insert_many(table, fields, values)

    def edit(self, table: str, entity_ids: str | list[str], fields: dict) -> list[str]:
        """
        Update one or many records by their IDs.
        Returns the list of affected IDs.
        """
        condition = {self.db.get_id_field(table): entity_ids}
        serialized_instructions = self.db.STRUCTURE()[table].get('serializable', {})
        if serialized_instructions:
            for field, value_type in serialized_instructions.items():
                if field in fields:
                    fields[field] = self.db.serialize_value(value_type, fields[field])

        return self.db.update(table, condition, fields)

    def delete(self, table: str, entity_ids: str | list[str]) -> None:
        """
        Delete one or many records by their IDs.
        """
        condition = {self.db.get_id_field(table): entity_ids}
        self.db.delete(table, condition)

    def delete_all(self, table: str) -> list[str]:
        """
        Delete all records from a table.
        Returns:
            list of deleted entity ids
        """
        accessible_table = self.db.STRUCTURE()[table]['accessible_table']
        query = f'SELECT {self.db.get_id_field(table)} FROM {accessible_table}'
        entity_ids = self.db.execute_query(query, (), return_format=ReturnFormat.LIST_VALUES)
        self.delete(table, entity_ids)
        return entity_ids

    def edit_childs(self, parent: str, entity_id: str, child: str, child_ids: list[str], operation: ChildOperation, data: dict | None = None) -> tuple[list[str], dict[str, list[str]]]:
        """Edit childs of a parent.
        Args:
            parent: parent entity
            entity_id: parent id
            child: child entity
            child_ids: list of child ids
            operation: operation to perform on the childs
            data: data to add or edit in the relation table
        Returns:
            list of affected child ids, dict of detached parents with parent ids as keys and list of detached child ids as values
        """

        ADD = ChildOperation.ADD
        REMOVE = ChildOperation.REMOVE
        UPDATE = ChildOperation.UPDATE

        relation_table, child_table, child_id_field, view_fields, relation_table_fields = self.db.get_relation(parent, child)
        exclusive = relation_table == child_table
        accessible_relation_table = self.db.STRUCTURE()[relation_table]['accessible_table']
        id_field = self.db.get_id_field(parent)

        within = operation in [REMOVE, UPDATE]
        # TODO: maybe to use it only for count, not for the list of child ids
        valid_child_ids = self.get_childs(parent, entity_id, child_table, child_ids, within=within, return_ids=True)
        if not valid_child_ids:
            return [], {}

        detached_parents = {}
        if operation == ADD and exclusive:
            detached_parents = self.get_parents(child_table, valid_child_ids, parent)

        placeholders = ','.join(['%s'] * len(valid_child_ids))
        params = []
        added_data = ''
        if exclusive:
            params.extend([entity_id, *valid_child_ids])
            if data:
                added_data = ',' + ','.join([f'{k} = NULL' for k in data.keys()])

            if operation == ADD:
                query = f'UPDATE {accessible_relation_table} SET {id_field} = %s{added_data} WHERE {child_id_field} IN ({placeholders})'
            elif operation == REMOVE:
                query = f'UPDATE {accessible_relation_table} SET {id_field} = NULL{added_data} WHERE {id_field} = %s AND {child_id_field} IN ({placeholders})'
            self.db.execute_query(query, params)
        else:
            if operation == ADD:
                added_values_clause = ''
                added_data_clause = ''
                if data:
                    added_values_clause = ',' + ','.join([f'%s' for _ in range(len(data.keys()))])
                    added_data_clause = ',' + ','.join([f'{k}' for k in data.keys()])

                values_clause = ','.join([f'(%s, %s{added_values_clause})'] * len(valid_child_ids))
                for cid in valid_child_ids:
                    params.extend([entity_id, cid])
                    if data:
                        params.extend(data.values())

                query = f'INSERT INTO {accessible_relation_table} ({id_field}, {child_id_field}{added_data_clause}) VALUES {values_clause} ON CONFLICT DO NOTHING'
                self.db.execute_query(query, params)
            elif operation == REMOVE:
                params.extend([entity_id, *valid_child_ids])
                query = f'DELETE FROM {accessible_relation_table} WHERE {id_field} = %s AND {child_id_field} IN ({placeholders})'
                self.db.execute_query(query, params)
            elif operation == UPDATE:
                if data:
                    updated_data_clause = ','.join([f'{k} = %s' for k in data.keys()])
                    params = [*data.values(), entity_id, *valid_child_ids]
                    query = f'UPDATE {accessible_relation_table} SET {updated_data_clause} WHERE {id_field} = %s AND {child_id_field} IN ({placeholders})'
                    self.db.execute_query(query, params)

        return valid_child_ids, detached_parents
