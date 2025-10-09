from typing import List, Dict, Union, Any
from ..db import AppDB, STRUCTURE, ReturnFormat
import uuid

class ModelsManager:

    def __init__(self, db: AppDB) -> None:
        self.db = db

    @staticmethod
    def generate_id() -> str:
        """Generate a new UUID for the entity."""
        return str(uuid.uuid4())

    def is_exists(self, table: str, fields: Dict, exclude_id: str = None) -> str | None:
        """Check if a record exists and return its id for conflict checking."""

        where_clause = ' AND '.join([f'{k}=?' for k in fields.keys()])
        where_params = tuple(fields.values())
        if exclude_id:
            where_clause += f' AND {AppDB.get_id_field(table)} != ?'
            where_params += (exclude_id,)
        id_field = AppDB.get_id_field(table)
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
        childs = AppDB.get_relation(table, child)
        if child:
            childs = [childs]
        id_field = AppDB.get_id_field(table)
        for child in childs:
            relation_table = child[0]
            if only_accessible:
                relation_table = STRUCTURE[relation_table]['accessible_table']
            query = f'SELECT EXISTS(SELECT 1 FROM {relation_table} WHERE {id_field} = ?)'
            results = self.db.execute_query(query, (entity_id,))
            if results[0][0]:
                return False
        
        return True

    def is_accessible(self, table: str, entity_id: str) -> bool:
        accessible_table = STRUCTURE[table]['accessible_table']
        id_field = AppDB.get_id_field(table)
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
        accessible_table = STRUCTURE[table]['accessible_table']
        fields = AppDB.get_view_fields(table)
        where_clause = ''
        single_item = False

        if isinstance(entity_ids, str):
            entity_ids = [entity_ids]
            single_item = True
        
        if entity_ids:
            where_clause += f'WHERE {AppDB.get_id_field(table)} IN ({','.join(['?'] * len(entity_ids))})'
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
        representative_metadata = STRUCTURE[entity].get('representative', {})
        if not representative_metadata:
            raise ValueError(f"Representative not found for {entity}")
        representative_table = representative_metadata['table']
        representative_field = representative_metadata['field']
        representative_id = self.db.execute_query(f'SELECT {representative_field} FROM {entity} WHERE {AppDB.get_id_field(entity)} = ?', (entity_id,), return_format=ReturnFormat.VALUE)
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
        relation, child, child_id_field, view_fields = AppDB.get_relation(parent, child)
        exclusive = relation == child
        accessible_relation = STRUCTURE[relation]['accessible_table']
        accessible_child = STRUCTURE[child]['accessible_table']
        id_field = AppDB.get_id_field(parent)

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
                for parent in STRUCTURE.keys()
                if STRUCTURE[parent].get('relations', {}).get(child, {})
            ]
        parents = dict.fromkeys(parents, [])

        parents_to_remove = []
        for parent in parents.keys():
            relation, child, child_id_field, view_fields = AppDB.get_relation(parent, child)
            accessible_relation = STRUCTURE[relation]['accessible_table']
            id_field = AppDB.get_id_field(parent)
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
            else:
                parents_to_remove.append(parent)

        for parent in parents_to_remove:
            parents.pop(parent)

        if single_item:
            return parents[list(parents.keys())[0]]
        
        return parents

    def add(self, table: str, data: Union[Dict, List[Dict]]) -> List[str] | str | None:
        """Insert one or many records. If a single dict is provided, return the new id.
        If a list is provided, return the inserted records list.
        """
        is_single_item = isinstance(data, dict)
        data_list = [data] if is_single_item else data
        
        for row in data_list:
            if AppDB.get_id_field(table) not in row:
                row[AppDB.get_id_field(table)] = ModelsManager.generate_id()
        
        inserted_ids = self.db.insert(table, data_list)
        
        if is_single_item:
            return inserted_ids[0] if inserted_ids else None
        return inserted_ids

    def delete(self, table: str, entity_ids: List[str] | str):
        return self.db.delete(table, {AppDB.get_id_field(table): entity_ids})

    def edit(self, table: str, entity_ids: List[str] | str, fields: Dict) -> list[str]:
        return self.db.update(table, {AppDB.get_id_field(table): entity_ids}, fields)

    def ensure_representative(self, table: str, entity_id: str) -> str | None:
        """Ensure representative of a table.
        Args:
            table: table name
            entity_id: entity id
        Returns:
            representative id if found or set, None if not found
        """
        representative = STRUCTURE[table].get('representative','')
        if not representative:
            raise ValueError(f"Representative not found")

        representative_field = representative['field']
        representative_table = representative['table']

        id_field = AppDB.get_id_field(table)
        relation, child, child_id_field, view_fields = AppDB.get_relation(table, representative_table)

        query = f"""SELECT r.{child_id_field}
        FROM {relation} r
        INNER JOIN {table} t
        ON t.{id_field} = r.{id_field}
        WHERE r.{id_field} = ?
        AND t.{representative_field} = r.{child_id_field}
        """
        representative_id = self.db.execute_query(query, (entity_id, ), return_format=ReturnFormat.VALUE)
        if representative_id:
            return representative_id
        
        accessible_child = STRUCTURE[child]['accessible_table']
        accessible_relation = STRUCTURE[relation]['accessible_table']
        join_clause = ''
        parent = 'c'
        if relation != child:
            join_clause = f'INNER JOIN {accessible_relation} r ON c.{child_id_field} = r.{child_id_field}'
            parent = 'r'

        query = f"""SELECT c.{child_id_field}
        FROM {accessible_child} c
        {join_clause}
        WHERE {parent}.{id_field} = ?
        ORDER BY c.width * c.height DESC
        LIMIT 1
        """
        biggest = self.db.execute_query(query, (entity_id,), return_format=ReturnFormat.VALUE)
        self.edit(table, entity_id, {representative_field: biggest})
        
        return biggest

    def edit_childs(self, parent: str, entity_id: str, child: str, child_ids: list[str], *, add: bool) -> tuple[list[str], dict[str, list[str]]]:
        """Edit childs of a parent.
        Args:
            parent: parent entity
            entity_id: parent id
            child: child entity
            child_ids: list of child ids
            add: if True, add childs, if False, remove childs
        Returns:
            list of affected child ids, dict of detached parents with parent ids as keys and list of detached child ids as values
        """

        relation, child, child_id_field, view_fields = AppDB.get_relation(parent, child)
        exclusive = relation == child
        accessible_relation = STRUCTURE[relation]['accessible_table']
        id_field = AppDB.get_id_field(parent)

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
        if exclusive:
            if add:
                query = f'UPDATE {accessible_relation} SET {id_field} = ? WHERE {child_id_field} IN ({placeholders})'
            else:
                query = f'UPDATE {accessible_relation} SET {id_field} = NULL WHERE {id_field} = ? AND {child_id_field} IN ({placeholders})'
            self.db.execute_query(query, (entity_id, *valid_child_ids))
        else:
            if add:
                values_clause = ','.join(['(?, ?)'] * len(valid_child_ids))
                params = []
                for cid in valid_child_ids:
                    params.extend([entity_id, cid])
                query = f'INSERT OR IGNORE INTO {accessible_relation} ({id_field}, {child_id_field}) VALUES {values_clause}'
                self.db.execute_query(query, tuple(params))
            else:
                query = f'DELETE FROM {accessible_relation} WHERE {id_field} = ? AND {child_id_field} IN ({placeholders})'
                self.db.execute_query(query, (entity_id, *valid_child_ids))

        if STRUCTURE[parent].get('representative',''):
            for parent_id in set(detached_parents.keys()).union([entity_id]):
                self.ensure_representative(parent, parent_id)

        return valid_child_ids, detached_parents

    # -------- Moments helpers --------
    def get_images_to_moments(self) -> dict[str, Dict[str, Any]]:
        """Return images to moments.
        Returns:
            dict of all images with image ids as keys and images data (date_taken, moment_id, is_archived) as values
        """
        accessible_images = STRUCTURE['images']['accessible_table']
        query = f"""
            SELECT i.image_id, i.date_taken, i.moment_id, i.is_archived
            FROM {accessible_images} i
        """
        return self.db.execute_query(query, return_format=ReturnFormat.DICT_DICTS)

    def remove_images_from_moments(self, image_ids: list[str]) -> dict[str, list[str]]:
        """Remove images from a moment."""
        valid_image_ids = list(self.get_entities('images', image_ids).keys())
        detached_moments = self.get_parents('images', valid_image_ids, 'moments')
        accessible_images = STRUCTURE['images']['accessible_table']
        query = f'UPDATE {accessible_images} SET moment_id = NULL WHERE image_id IN ({','.join(['?'] * len(valid_image_ids))})'
        self.db.execute_query(query, valid_image_ids)
        return detached_moments

    # -------- Images helpers --------
    def is_image_deletable(self, image_id: str) -> bool:
        """Check if an image is deletable.
        Args:
            image_id: image id
        Returns:
            True if image is deletable, False if not
        """
        if not self.is_accessible('images', image_id):
            return False
        
        query = f"""
            SELECT COUNT(*) FROM accessible_faces WHERE image_id = ?
        """
        accessible_faces = self.db.execute_query(query, (image_id,), return_format=ReturnFormat.VALUE)
        query = f"""
            SELECT COUNT(*) FROM faces WHERE image_id = ?
        """
        faces = self.db.execute_query(query, (image_id,), return_format=ReturnFormat.VALUE)

        return faces ==  accessible_faces

    # -------- Groups helpers --------
    def get_unassociated_group(self) -> str | None:
        """Get the unassociated group id."""
        return self.db.execute_query('SELECT group_id FROM accessible_groups WHERE LOWER(label) = "unassociated"', return_format=ReturnFormat.VALUE)

    def get_faces_mapping(self, group_id: str) -> dict[str, str]:
        """Return faces mapping for between images and faces in a group.
        Args:
            group_id: group id
        Returns:
            dict of faces mapping with image ids as keys and face id as value
        """
        accessible_groups_images = STRUCTURE['groups_images']['accessible_table']
        accessible_faces = STRUCTURE['faces']['accessible_table']
        query = f"""
            SELECT agi.image_id,
            (
                SELECT f.face_id
                FROM {accessible_faces} f
                WHERE f.image_id = agi.image_id AND f.group_id = agi.group_id
                GROUP BY f.image_id, f.group_id
                ORDER BY (f.width * f.height) DESC
                LIMIT 1
            ) as representative_face
            FROM {accessible_groups_images} agi
            WHERE agi.group_id = ?
        """
        return self.db.execute_query(query, (group_id,), return_format=ReturnFormat.DICT_VALUES)

    def get_groups(self, group_ids: list[str] | str | None = None, *, faces_mapping: bool = True) -> dict[str, Dict[str, Any]] | Dict[str, Any]:
        """Return groups.
        Args:
            group_ids: list of group ids or single group id or None to get all groups
        Returns:
            dict of groups with group ids as keys and group data as values
            if single group id is provided, return the group data
        """
        entities = self.get_entities('groups', group_ids)
        if faces_mapping:
            if isinstance(group_ids, str):
                entities['faces_mapping'] = self.get_faces_mapping(group_ids)
            else:
                for group_id, group in entities.items():
                    group['faces_mapping'] = self.get_faces_mapping(group_id)
        return entities

    def get_faces_group_in_image(self, group_id: str, image_id: str) -> list[str] | None:
        """Return the faces in an image from a group.
        Args:
            group_id: group id
            image_id: image id
        Returns:
            list of face ids if found, None if not found
        """
        accessible_faces = STRUCTURE['faces']['accessible_table']
        query = f"""
            SELECT f.face_id FROM {accessible_faces} f WHERE f.image_id = ? AND f.group_id = ?"""
        return self.db.execute_query(query, (image_id, group_id), return_format=ReturnFormat.LIST_VALUES) or None

    def get_related_groups(self, group_ids: list[str], base_image_ids: list[str]) -> tuple[list[str], dict[str, list[str]]]:
        """Return related groups to images and groups.
        Args:
            group_ids: list of group ids
            base_image_ids: list of image ids
        Returns:
            list of group ids and dicts with group id, label, representative_face as values
            ordered by relevance and then by label
        """

        if not base_image_ids or not group_ids:
            return []

        group_id_placeholders = ','.join(['?'] * len(group_ids))
        image_placeholders = ','.join(['?'] * len(base_image_ids))
        accessible_groups = STRUCTURE['groups']['accessible_table']
        accessible_faces = STRUCTURE['faces']['accessible_table']

        query = f'''
            SELECT g.group_id, g.label, g.images_count, g.active_images_count
            FROM {accessible_groups} g
            JOIN {accessible_faces} f ON g.group_id = f.group_id
            WHERE f.image_id IN ({image_placeholders})
            AND g.group_id NOT IN ({group_id_placeholders})
            GROUP BY g.group_id, g.label
            ORDER BY COUNT(DISTINCT f.image_id) DESC, g.label ASC
        '''
        query_params = base_image_ids + group_ids

        return self.db.execute_query(query, query_params, return_format=ReturnFormat.LIST_AND_DICT_DICTS)

    def get_filtered_images(self, group_ids: list[str], mode: str = 'and', only: bool = False) -> tuple[list[str], dict[str, str], dict[str, dict]]:
        """Return filtered images.
        Args:
            group_ids: list of group ids
            mode: 'and' or 'or'
            only: if True, return images without any other groups
        Returns:
            list of image ids, dict of faces mapping between images and faces, dict of images with image ids as keys and image data as values
        """

        if not group_ids:
            return []

        accessible_faces = STRUCTURE['faces']['accessible_table']
        accessible_images = STRUCTURE['images']['accessible_table']

        N = len(group_ids)
        M = min(N, 8)
        group_placeholders = ','.join(['?'] * N)
        having_clause = []
        params = []

        priority_case = "CASE sf.group_id " + " ".join(f"WHEN ? THEN {idx+1}" for idx in range(M)) + " ELSE 9999 END"

        query = f"""
            SELECT
                i.image_id,
                i.date_taken,
                i.is_archived,
                i.is_favorite,
                (
                    SELECT sf.face_id
                    FROM {accessible_faces} sf
                    WHERE sf.image_id = i.image_id AND sf.group_id IN ({group_placeholders})
                    GROUP BY sf.image_id, sf.group_id
                    ORDER BY
                        {priority_case},
                        (sf.width * sf.height) DESC
                    LIMIT 1
                ) as representative_face
            FROM {accessible_faces} f
            INNER JOIN {accessible_images} i ON f.image_id = i.image_id
        """
        params.extend(group_ids)
        params.extend(group_ids[:M])

        if mode == 'and':
            having_clause.append(f"COUNT(DISTINCT CASE WHEN f.group_id IN ({group_placeholders}) THEN f.group_id END) = {N}")
            params.extend(group_ids)
        elif mode == 'or' and not only:
            query += f"WHERE f.group_id IN ({group_placeholders})"
            params.extend(group_ids)

        if only:
            having_clause.append(f"COUNT(DISTINCT CASE WHEN f.group_id NOT IN ({group_placeholders}) THEN f.group_id END) = 0")
            params.extend(group_ids)

        query += f" GROUP BY f.image_id"
        if having_clause:
            query += f" HAVING {' AND '.join(having_clause)}"

        image_ids, images = self.db.execute_query(query, params, return_format=ReturnFormat.LIST_AND_DICT_DICTS)
        faces_mapping = {id: row['representative_face'] for id, row in images.items()}
        for row in images.values():
            row.pop('representative_face')

        return image_ids, faces_mapping, images

    def add_faces_to_group(self, *, face_ids: List[str] | None = None, target_group_id: str | None = None, new_group_name: str | None = None, source_group_id: str | None = None) -> Dict:
        """Add faces to a group.
        Args:
            face_ids: list of face ids
            target_group_id: target group id
            new_group_name: new group name
            source_group_id: source group id
        Returns:
            dict:
                detached_groups: dict of detached groups with group ids as keys and list of detached images ids as values
                length_faces_added: length of faces ids added
                images_added: dict of images ids added with image ids as keys and dict of faces entities added to the imageas values
                source_deleted: if source group is deleted
                new_group_created: if new group is created
                target_group_id: target group id
        """
        # handle new group
        if face_ids is None:
            if not source_group_id:
                raise ValueError("face_ids or source_group_id must be provided")
            face_ids = self.get_childs('groups', source_group_id, 'faces', return_ids=True)

        if new_group_name:
            if self.is_exists('groups', {'label': new_group_name}):
                raise ValueError(f"Group name '{new_group_name}' already exists")
            target_group_id = self.add('groups', {'label': new_group_name})

        if not target_group_id:
            raise ValueError("target_group_id or new_group_name must be provided")
        
        faces_added, detached_groups_faces = self.edit_childs('groups', target_group_id, child='faces', child_ids=face_ids, add=True)

        source_deleted = self.is_empty('groups', source_group_id, child='faces', only_accessible=True)
        if self.is_empty('groups', source_group_id, child='faces'):
            self.delete('groups', source_group_id)

        detached_groups_images = {}
        for group_id, detached_faces in detached_groups_faces.items():
            detached_images = []
            for detached_face in detached_faces:
                images = self.get_parents('faces', detached_face, 'images')
                detached_images.extend(self.get_childs('groups', group_id, 'images', images, within=False, return_ids=True))
            
            detached_groups_images[group_id] = list(set(detached_images))
                 
        images_added = {}
        for face_id in faces_added:
            face = self.get_entities('faces', face_id)
            images_added.setdefault(face['image_id'], {})[face_id] = face
        
        result = {
            'detached_groups': detached_groups_images,
            'length_faces_added': len(faces_added),
            'images_added': images_added,
            'source_deleted': source_deleted,
            'new_group_created': bool(new_group_name),
            'target_group_id': target_group_id,
        }

        return result

    # -------- Albums helpers --------
    def get_archive_album(self) -> str | None:
        """Get the archive album id."""
        return self.db.execute_query('SELECT album_id FROM accessible_albums WHERE LOWER(label) = "archive"', return_format=ReturnFormat.VALUE)

    def get_favorites_album(self) -> str | None:
        """Get the favorites album id."""
        return self.db.execute_query('SELECT album_id FROM accessible_albums WHERE LOWER(label) = "favorites"', return_format=ReturnFormat.VALUE)

    # -------- Profiles helpers --------
    ######## TODO: check if edit_childs replaces these
    def add_accessible_images(self, profile_id: str, image_ids: List[str]) -> List[str]:
        if not image_ids:
            return []
        to_insert = [
            {'profile_id': profile_id, 'image_id': image_id, 'accessible': 1}
            for image_id in image_ids
        ]
        inserted_pairs = self.db.insert('editable_profile_images', to_insert)
        return [pair[1] for pair in inserted_pairs]

    def remove_accessible_images(self, profile_id: str, image_ids: List[str]) -> List[str]:
        if not image_ids:
            return []
        
        deleted_pairs = self.db.delete(
            'editable_profile_images',
            {'profile_id': profile_id, 'image_id': image_ids}
        )
        return [pair[1] for pair in deleted_pairs]

    def add_accessible_albums(self, profile_id: str, album_ids: List[str]) -> List[str]:
        if not album_ids:
            return []
        to_insert = [
            {'profile_id': profile_id, 'album_id': album_id, 'accessible': 1}
            for album_id in album_ids
        ]
        inserted_pairs = self.db.insert('editable_profile_albums', to_insert)
        return [pair[1] for pair in inserted_pairs]

    def remove_accessible_albums(self, profile_id: str, album_ids: List[str]) -> List[str]:
        if not album_ids:
            return []
        
        deleted_pairs = self.db.delete(
            'editable_profile_albums',
            {'profile_id': profile_id, 'album_id': album_ids}
        )
        return [pair[1] for pair in deleted_pairs]
