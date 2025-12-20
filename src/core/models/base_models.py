from typing import List, Dict, Any
from src.core.database.db import DB, ReturnFormat
from abc import ABC
from enum import Enum
import re

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
                relation_table = f'{relation_table}_ctx'
            query = f'SELECT EXISTS(SELECT 1 FROM {relation_table} WHERE {id_field} = %s)'
            results = self.db.execute_query(query, (entity_id,))
            if results[0][0]:
                return False
        
        return True

    def is_accessible(self, table: str, entity_ids: str | list[str]) -> bool:
        """Check if entities are accessible.
        Args:
            table: table name
            entity_ids: list of entity ids or single entity id
        Returns:
            True if all entities are accessible, False if not
        """
        original_table = self.db.get_original_table(table)
        ctx_table = f'{original_table}_ctx'
        id_field = self.db.get_id_field(table)
        if not isinstance(entity_ids, list):
            entity_ids = [entity_ids]
        query = f"SELECT COUNT(*) FROM {ctx_table} WHERE {id_field} IN ({','.join(['%s'] * len(entity_ids))})"
        results = self.db.execute_query(query, entity_ids, return_format=ReturnFormat.VALUE)
        return results == len(entity_ids)

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
        ext_table = f'{table}_ext'
        fields = self.db.get_view_fields(table, include_details=include_details)
        where_clause = ''
        single_item = False

        if not (entity_ids is None or isinstance(entity_ids, list)):
            entity_ids = [entity_ids]
            single_item = True
        
        if entity_ids:
            where_clause += f"WHERE {self.db.get_id_field(table)} IN ({','.join(['%s'] * len(entity_ids))})"
        else:
            entity_ids = []

        query = f"""
            SELECT {fields}
            FROM {ext_table}
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
        ctx_relation = f'{relation_table}_ctx'
        id_field = self.db.get_id_field(parent)

        if return_ids:
            child_data_table = f'{child_table}_ctx'
            fields = f'c.{child_id_field}'
            return_format = ReturnFormat.LIST_VALUES
        else:
            child_data_table = f'{child_table}_ext'
            fields = view_fields
            return_format = ReturnFormat.DICT_DICTS

        join_clause = ''        
        if exclusive:
            if within:
                where_clause = f'c.{id_field} = %s'
            else:
                where_clause = f'(c.{id_field} <> %s OR c.{id_field} IS NULL)'
        else:
            if within:
                join_clause = f' INNER JOIN {ctx_relation} r ON c.{child_id_field} = r.{child_id_field} AND r.{id_field} = %s'
                where_clause = '1=1' 
            else:
                join_clause = f' LEFT JOIN {ctx_relation} r ON c.{child_id_field} = r.{child_id_field} AND r.{id_field} = %s'
                where_clause = f'r.{child_id_field} IS NULL'

        if child_ids is not None:
            where_clause += f" AND c.{child_id_field} IN ({','.join(['%s'] * len(child_ids))})"
        else:
            child_ids = []

        query = f"""SELECT {fields}
        FROM {child_data_table} c
        {join_clause}
        WHERE {where_clause}
        """
        
        valid_childs = self.db.execute_query(query, (entity_id, *child_ids), return_format=return_format)
        if relation_table_fields and not return_ids:
            if not valid_childs:
                return valid_childs, {}
            valid_child_ids = list(valid_childs.keys())
            ext_relation = f'{relation_table}_ext'
            query = f"""SELECT {relation_table_fields}
            FROM {ext_relation} r
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
            relation, child_table, child_id_field, view_fields, relation_table_fields = self.db.get_relation(parent, child)
            ctx_relation = f'{relation}_ctx'
            
            if return_format == ReturnFormat.LIST_TUPLES:
                fields = f'r.{id_field}, r.{child_id_field}'
            else:
                fields = f'DISTINCT r.{id_field}'
            query = f"""
                SELECT {fields}
                FROM {ctx_relation} r
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
        ctx_table = f'{table}_ctx'
        query = f'SELECT {self.db.get_id_field(table)} FROM {ctx_table}'
        entity_ids = self.db.execute_query(query, (), return_format=ReturnFormat.LIST_VALUES)
        self.delete(table, entity_ids)
        return entity_ids

    def edit_childs(self, parent: str, entity_id: str, child: str, child_ids: list[str], operation: ChildOperation, data: dict = {}) -> tuple[list[str], dict[str, list[str]]]:
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

        if not child_ids:
            return [], {}

        relation_table, child_table, child_id_field, view_fields, relation_table_fields = self.db.get_relation(parent, child)
        exclusive = relation_table == child_table
        ctx_relation_table = f'{relation_table}_ctx'
        id_field = self.db.get_id_field(parent)
        id_type = self.db.STRUCTURE()[child_table].get('id_type', 'UUID')

        detached_parents = {}
        if exclusive:
            if operation == ADD:
                update_clause = f'{id_field} = %s'
                if data:
                    update_clause += ',' + ','.join([f'{k} = %s' for k in data.keys()])
                where_clause = f' AND r.{id_field} IS DISTINCT FROM %s'
                params = [child_ids, entity_id, *data.values(), entity_id]
            elif operation == UPDATE:
                update_clause = ', '.join([f'{k} = %s' for k in data.keys()])
                where_clause = f' AND r.{id_field} = %s'
                params = [child_ids, *data.values(), entity_id]
            elif operation == REMOVE:
                update_clause = f'{id_field} = NULL'
                if relation_table_fields:
                    update_clause += ',' + ','.join([f'{k} = NULL' for k in relation_table_fields])
                where_clause = f' AND r.{id_field} = %s'
                params = [child_ids, entity_id]

            query = f"""
                WITH child_ids AS (
                    SELECT DISTINCT unnest(%s::{id_type}[]) AS {child_id_field} 
                ),
                old_parents AS (
                    SELECT r.{child_id_field}, r.{id_field} AS old_parent_id
                    FROM {ctx_relation_table} r
                    INNER JOIN child_ids c ON r.{child_id_field} = c.{child_id_field}
                    WHERE r.{id_field} IS NOT NULL
                ),
                updated AS (
                    UPDATE {ctx_relation_table} AS r
                    SET {update_clause}
                    FROM child_ids c
                    WHERE r.{child_id_field} = c.{child_id_field}
                    {where_clause}
                    RETURNING r.{child_id_field}
                )
                SELECT u.{child_id_field}, op.old_parent_id
                FROM updated u
                LEFT JOIN old_parents op ON u.{child_id_field} = op.{child_id_field}
            """
            result = self.db.execute_query(query, params, return_format=ReturnFormat.LIST_TUPLES)
            
            affected_child_ids = [row[0] for row in result]
            for child_id, old_parent_id in result:
                if old_parent_id:
                    detached_parents.setdefault(old_parent_id, []).append(child_id)
        else:
            params = []
            cte_part = f"""
                WITH child_ids AS (
                    SELECT DISTINCT unnest(%s::{id_type}[]) AS {child_id_field} 
                )
            """

            if operation == ADD:
                columns = [id_field, child_id_field]
                value_placeholders = [f'%s', f'c.{child_id_field}']
                params = [child_ids, entity_id]
                
                if data:
                    columns.extend(data.keys())
                    value_placeholders.extend(['%s'] * len(data))
                    params.extend(data.values())
                
                cols_str = ', '.join(columns)
                vals_str = ', '.join(value_placeholders)
                                
                query = f"""
                    {cte_part}
                    INSERT INTO {ctx_relation_table} ({cols_str})
                    SELECT {vals_str}
                    FROM child_ids c
                    ON CONFLICT DO NOTHING
                    RETURNING {child_id_field}
                """

            elif operation == UPDATE:
                update_clause = ', '.join([f'{k} = %s' for k in data.keys()])
                params = [child_ids, *data.values(), entity_id]
                
                query = f"""
                    {cte_part}
                    UPDATE {ctx_relation_table} AS r
                    SET {update_clause}
                    FROM child_ids c
                    WHERE r.{child_id_field} = c.{child_id_field}
                    AND r.{id_field} = %s
                    RETURNING r.{child_id_field}
                """

            elif operation == REMOVE:
                params = [child_ids, entity_id]
                
                query = f"""
                    {cte_part}
                    DELETE FROM {ctx_relation_table} AS r
                    USING child_ids c
                    WHERE r.{child_id_field} = c.{child_id_field}
                    AND r.{id_field} = %s
                    RETURNING r.{child_id_field}
                """

            result = self.db.execute_query(query, params, return_format=ReturnFormat.LIST_TUPLES)
            affected_child_ids = [row[0] for row in result]

            if operation == REMOVE and affected_child_ids:
                detached_parents[entity_id] = affected_child_ids

        return affected_child_ids, detached_parents

    def get_unique_label(
        self,
        table: str,
        prefix: str,
        suffix: str = '',
        *,
        separator: str = '',
        brackets: bool = False,
        exclude_id: str = None,
        event_id: str = None,
        start_from: int = 2
    ) -> str:
        """Get a unique label by appending a counter if needed.
        Args:
            table: table name
            prefix: prefix for the label
            suffix: suffix for the label (e.g., file extension like '.jpg')
            separator: separator between the prefix and the suffix
            brackets: if True, use format ' (2)', if False, use format ' 2'
            exclude_id: entity id to exclude from uniqueness check (for updates)
            event_id: event id for event-scoped tables (optional)
            start_from: starting number for the counter
        Returns:
            unique label with counter appended if needed
        """
        original_table = self.db.get_original_table(table)
        id_field = self.db.get_id_field(table)

        if brackets:
            str_mid_prefix = ' ('
            str_mid_suffix = f'){separator}'
            
            re_mid_prefix = ' \\('  
            re_mid_suffix = f'\\){re.escape(separator)}'
            
            # Pattern to match counter at the end
            counter_pattern = re.compile(r' \(\d+\)' + (re.escape(separator) if separator else '') + r'?$')
        else:
            str_mid_prefix = ' '
            str_mid_suffix = separator 
            
            re_mid_prefix = ' '
            re_mid_suffix = re.escape(separator)
            
            counter_pattern = re.compile(r' \d+' + (re.escape(separator) if separator else '') + r'?$')

        base_prefix = prefix
        while True:
            new_prefix = counter_pattern.sub('', base_prefix)
            if new_prefix == base_prefix:
                break
            base_prefix = new_prefix
        
        full_suffix = f'{suffix}' if suffix else ''
        
        safe_base_prefix = re.escape(base_prefix)

        query = f"""
            SELECT 
                COALESCE(
                    substring(label
                        FROM ('^' || %s || %s || '([0-9]+)' || %s || %s || '$')
                    )::bigint,
                    0
                ) AS label_num
            FROM {original_table}
            WHERE
                (
                    label LIKE %s || %s || '%%' || %s || %s
                    OR label = %s || %s || %s
                )
        """

        params = [
            safe_base_prefix, re_mid_prefix, re_mid_suffix, re.escape(full_suffix), # Regex params
            base_prefix, str_mid_prefix, str_mid_suffix, full_suffix,               # LIKE params
            base_prefix, separator, full_suffix,                                    # Equality params
        ]

        if exclude_id:
            query += f' AND {id_field} IS DISTINCT FROM %s'
            params.append(exclude_id)

        if event_id:
            query += f' AND event_id = %s'
            params.append(event_id)
        
        query += ';'

        results = self.db.execute_query(query, params, return_format=ReturnFormat.LIST_TUPLES)
        
        numbers = [row[0] for row in results] if results else []
        
        if not numbers:
            return f'{base_prefix}{separator}{full_suffix}'
        
        max_num = max(numbers)
        
        if max_num == 0:
            next_num = start_from
        else:
            next_num = max_num + 1
        
        return f'{base_prefix}{str_mid_prefix}{next_num}{str_mid_suffix}{full_suffix}'

    def get_unique_labels(
        self,
        table: str,
        prefixes: list[str],
        suffix: str = '',
        *,
        separator: str = '',
        brackets: bool = False,
        exclude_ids: list[str] = None,
        event_id: str = None,
        start_from: int = 2,
        suffixes: list[str] = None
    ) -> list[str]:
        """Get multiple unique labels by appending counters if needed.
        This is optimized for bulk operations - fetches all existing labels once
        and generates unique labels in Python.
        
        Args:
            table: table name
            prefixes: list of prefixes for the labels
            suffix: suffix for the label (e.g., file extension like '.jpg') - used if suffixes is None
            separator: separator between the prefix and the suffix
            brackets: if True, use format ' (2)', if False, use format ' 2'
            exclude_ids: list of entity ids to exclude from uniqueness check (for updates)
            event_id: event id for event-scoped tables (optional)
            start_from: starting number for the counter
            suffixes: optional list of suffixes (one per prefix). If provided, overrides suffix parameter
        Returns:
            list of unique labels with counters appended if needed
        """
        if not prefixes:
            return []
        
        # If suffixes provided, use them; otherwise use single suffix for all
        if suffixes is not None:
            if len(suffixes) != len(prefixes):
                raise ValueError("suffixes list must have same length as prefixes list")
            prefix_suffix_pairs = list(zip(prefixes, suffixes))
        else:
            prefix_suffix_pairs = [(prefix, suffix) for prefix in prefixes]
        
        original_table = self.db.get_original_table(table)
        id_field = self.db.get_id_field(table)

        if brackets:
            str_mid_prefix = ' ('
            str_mid_suffix = f'){separator}'
            
            re_mid_prefix = ' \\('  
            re_mid_suffix = f'\\){re.escape(separator)}'
            
            # Pattern to match counter at the end
            counter_pattern = re.compile(r' \(\d+\)' + (re.escape(separator) if separator else '') + r'?$')
        else:
            str_mid_prefix = ' '
            str_mid_suffix = separator 
            
            re_mid_prefix = ' '
            re_mid_suffix = re.escape(separator)
            
            counter_pattern = re.compile(r' \d+' + (re.escape(separator) if separator else '') + r'?$')
        
        # Fetch all existing labels for this event once
        query = f"""
            SELECT label
            FROM {original_table}
            WHERE 1=1
        """
        
        params = []
        
        if exclude_ids:
            query += f' AND {id_field} NOT IN ({",".join(["%s"] * len(exclude_ids))})'
            params.extend(exclude_ids)

        if event_id:
            query += f' AND event_id = %s'
            params.append(event_id)
        
        query += ';'

        results = self.db.execute_query(query, params, return_format=ReturnFormat.LIST_TUPLES)
        existing_labels = {row[0] for row in results} if results else set()
        
        # Generate unique labels for each prefix-suffix pair
        unique_labels = []
        used_labels = set()  # Track labels we're generating in this batch
        
        for prefix, current_suffix in prefix_suffix_pairs:
            full_suffix = f'{current_suffix}' if current_suffix else ''
            
            base_prefix = prefix
            # Strip any existing counter from the prefix
            while True:
                new_prefix = counter_pattern.sub('', base_prefix)
                if new_prefix == base_prefix:
                    break
                base_prefix = new_prefix
            
            # Find the next available number
            base_label = f'{base_prefix}{separator}{full_suffix}'
            
            # Check if base label (without number) exists
            base_exists = base_label in existing_labels or base_label in used_labels
            
            if not base_exists:
                # Use base label without number
                unique_labels.append(base_label)
                used_labels.add(base_label)
                continue
            
            # Find all matching labels and extract their numbers
            numbers = []
            safe_base_prefix = re.escape(base_prefix)
            pattern = re.compile(
                f'^{safe_base_prefix}{re_mid_prefix}(\\d+){re_mid_suffix}{re.escape(full_suffix)}$'
            )
            
            # Check existing labels
            for label in existing_labels:
                match = pattern.match(label)
                if match:
                    numbers.append(int(match.group(1)))
            
            # Check labels we're generating in this batch
            for label in used_labels:
                match = pattern.match(label)
                if match:
                    numbers.append(int(match.group(1)))
            
            # Determine next number
            if not numbers:
                next_num = start_from
            else:
                max_num = max(numbers)
                if max_num == 0:
                    next_num = start_from
                else:
                    next_num = max_num + 1
            
            unique_label = f'{base_prefix}{str_mid_prefix}{next_num}{str_mid_suffix}{full_suffix}'
            unique_labels.append(unique_label)
            used_labels.add(unique_label)
        
        return unique_labels