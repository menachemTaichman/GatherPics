import json
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

        id_field = AppDB.get_id_field(table)
        query = f"""
            SELECT {id_field}
            FROM {table}
            WHERE {where_clause}
            AND {id_field} != ?
        """
        results = self.db.execute_query(query, (*where_params, exclude_id))
        return results[0][0] if results else None

    def is_empty(self, table: str, entity_id: str) -> bool:
        childs = AppDB.get_view_child(table, all=True)
        id_field = AppDB.get_id_field(table)
        for child in childs:
            query = f'SELECT EXISTS(SELECT 1 FROM {child} WHERE {id_field} = ?)'
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

    def get_entities(self, table: str, entity_ids: List[str] | str | None = None, *, exclude_empty_entities: bool = False) -> dict[str, Dict[str, Any]] | Dict[str, Any]:
        accessible_table = STRUCTURE[table]['accessible_table']
        fields = AppDB.get_view_fields(table)
        where_clause = 'WHERE 1=1'
        single_item = False

        if isinstance(entity_ids, str):
            entity_ids = [entity_ids]
            single_item = True
        
        if entity_ids:
            where_clause += f' AND {AppDB.get_id_field(table)} IN ({','.join(['?'] * len(entity_ids))})'
        else:
            entity_ids = []

        if exclude_empty_entities:
            where_clause += f' AND images_count > 0'

        query = f"""
            SELECT {fields}
            FROM {accessible_table}
            {where_clause}
        """
        results = self.db.execute_query(query, entity_ids, return_format=ReturnFormat.DICT_DICTS)
        if results and single_item:
            return results[entity_ids[0]]
        return results

    def get_childs(self, parent: str, entity_id: str, child: str) -> tuple[list[str], dict[str, dict]]:
        id_field = AppDB.get_id_field(parent)
        relation, child, child_id_field, view_fields = AppDB.get_relation(parent, child)
        accessible_child_table = STRUCTURE[child]['accessible_table']
        join_clause = ''
        parent = 'c'
        if relation != child:
            join_clause = f'INNER JOIN {relation} r ON c.{child_id_field} = r.{child_id_field}'
            parent = 'r'

        query = f"""
            SELECT {view_fields}
            FROM {accessible_child_table} c
            {join_clause}
            WHERE {parent}.{id_field} = ?
        """
        force_include_archived = False
        if parent == 'albums':
            if entity_id == self.get_archive_album():
                force_include_archived = True
        results = self.db.execute_query(query, (entity_id,), force_include_archived=force_include_archived, return_format=ReturnFormat.LIST_AND_DICT_DICTS)
        return results

    def get_enteties_changes(self, table: str, entity_ids: List[str] | str | None = None, *, exclude_empty_entities: bool = False) -> list[dict]:
        entities = self.get_entities(table, entity_ids, exclude_empty_entities=exclude_empty_entities)
        if isinstance(entity_ids, str):
            entities = {entity_ids: entities}

        changes = [{
            'type': 'UPSERT',
            'entity': table,
            'items': entities
        }]

        return changes
    
    def get_childs_changes(self, parent: str, entity_id: str, child: str) -> list[dict]:
        relation, entities = self.get_childs(parent, entity_id, child)
        changes = []
        changes.append({
            'type': 'UPSERT',
            'entity': child,
            'items': entities
        })
        changes.append({
            'type': 'RELATION_SET',
            'relation': f'{parent}.{child}',
            'parentId': entity_id,
            'ids': relation
        })
        return changes

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

    def edit(self, table: str, entity_ids: List[str] | str, fields: Dict) -> List[str]:
        return self.db.update(table, {AppDB.get_id_field(table): entity_ids}, fields)

    def ensure_representative(self, table: str, entity_id: str) -> str:
        representative = STRUCTURE[table].get('representative','')
        if not representative:
            raise ValueError(f"Representative not found")

        representative_field = representative['field']
        representative_table = representative['table']

        id_field = AppDB.get_id_field(table)
        relation, child, child_id_field, view_fields = AppDB.get_relation(table, representative_table)

        entity = self.get_entities(table, entity_id)
        representative_id = entity.get(representative_field, None)

        if representative_id:
            query = f"""SELECT r.{child_id_field}
            FROM {relation} r
            WHERE r.{id_field} = ?
            AND r.{child_id_field} = ?
            """
            if self.db.execute_query(query, (entity_id, representative_id), force_include_archived=True, return_format=ReturnFormat.VALUE):
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
        biggest = self.db.execute_query(query, (entity_id,), force_include_archived=True, return_format=ReturnFormat.VALUE)
        if biggest:
            self.edit(table, entity_id, {representative_field: biggest})
        
        return biggest

    def edit_childs(self, parent: str, entity_id: str, child: str, child_ids: List[str], *, add: bool) -> tuple[list[str], list[str], list[dict]]:
        relation, child, child_id_field, view_fields = AppDB.get_relation(parent, child)
        exclusive = relation == child
        accessible_relation = STRUCTURE[relation]['accessible_table']
        accessible_child = STRUCTURE[child]['accessible_table']
        id_field = AppDB.get_id_field(parent)

        placeholders = ','.join(['?'] * len(child_ids)) if child_ids else ''

        # Determine valid childs for this operation
        if exclusive:
            where_clause = f'(c.{id_field} <> ? OR c.{id_field} IS NULL)' if add else f'c.{id_field} = ?'
            query = f"""SELECT c.{child_id_field}
            FROM {accessible_child} c
            WHERE {where_clause} AND c.{child_id_field} IN ({placeholders})
            """
        else:
            is_null = 'NULL' if add else 'NOT NULL'
            query = f"""SELECT c.{child_id_field}
            FROM {accessible_child} c
            LEFT JOIN {accessible_relation} r ON c.{child_id_field} = r.{child_id_field} AND r.{id_field} = ?
            WHERE r.{child_id_field} IS {is_null} AND c.{child_id_field} IN ({placeholders})
            """
        valid_child_ids = self.db.execute_query(query, (entity_id, *child_ids), force_include_archived=True, return_format=ReturnFormat.LIST_VALUES)

        if not valid_child_ids:
            return [], [], []

        placeholders = ','.join(['?'] * len(valid_child_ids))

        # get old parent to remove relation and ensure representative
        old_parent_ids = {}
        if add and exclusive:
            query = f"""
                SELECT r.{id_field}, r.{child_id_field}
                FROM {accessible_relation} r
                WHERE r.{child_id_field} in ({placeholders})
                AND r.{id_field} IS NOT NULL
            """
            results = self.db.execute_query(query, valid_child_ids, force_include_archived=True, return_format=ReturnFormat.LIST_TUPLES)
            for parent_id, child_id in results:
                old_parent_ids.setdefault(parent_id, []).append(child_id)

        # Apply edit
        if exclusive:
            if add:
                query = f'UPDATE {accessible_relation} SET {id_field} = ? WHERE {child_id_field} IN ({placeholders})'
            else:
                query = f'UPDATE {accessible_relation} SET {id_field} = NULL WHERE {id_field} = ? AND {child_id_field} IN ({placeholders})'
            self.db.execute_query(query, (entity_id, *valid_child_ids), force_include_archived=True)
        else:
            if add:
                values_clause = ','.join(['(?, ?)'] * len(valid_child_ids))
                params = []
                for cid in valid_child_ids:
                    params.extend([entity_id, cid])
                query = f'INSERT OR IGNORE INTO {accessible_relation} ({id_field}, {child_id_field}) VALUES {values_clause}'
                self.db.execute_query(query, tuple(params), force_include_archived=True)
            else:
                query = f'DELETE FROM {accessible_relation} WHERE {id_field} = ? AND {child_id_field} IN ({placeholders})'
                self.db.execute_query(query, (entity_id, *valid_child_ids), force_include_archived=True)

        # ensure representative
        if STRUCTURE[parent].get('representative',''):
            for parent_id in set(old_parent_ids.keys()).union([entity_id]):
                self.ensure_representative(parent, parent_id)

        # get changes
        changes = []

        changes.append({
            'type': f'RELATION_{"ADD" if add else "REMOVE"}',
            'relation': f'{parent}.{child}',
            'parentId': entity_id,
            'ids': valid_child_ids
        })
        for parent_id, child_ids in old_parent_ids.items():
            changes.append({
                'type': f'RELATION_REMOVE',
                'relation': f'{parent}.{child}',
                'parentId': parent_id,
                'ids': child_ids
            })

        return valid_child_ids, old_parent_ids, changes

    # -------- Images helpers --------    
    def get_images(self, image_ids: List[str] | str | None = None) -> List[Dict]:
        
        images = self.get_entities('images', image_ids)
        changes = [{
            'type': 'UPSERT',
            'entity': 'images',
            'items': images
        }]
        for image_id in image_ids:
            changes.extend(self.get_childs_changes('images', image_id, 'albums'))
            changes.extend(self.get_childs_changes('images', image_id, 'faces'))
        return changes

        return_list = isinstance(image_ids, list)
        if not image_ids:
            image_ids = []
        elif isinstance(image_ids, str):
            image_ids = [image_ids]

        image_placeholders = ','.join(['?'] * len(image_ids))
        query = f'''
            WITH albums_grouped AS (
                SELECT 
                    ai.image_id,
                    json_group_array(
                        json_object(
                            'album_id', a.album_id,
                            'label', a.label,
                            'representative_image', a.representative_image
                        )
                    ) AS albums_json
                FROM accessible_albums_images ai
                INNER JOIN accessible_albums a
                    ON a.album_id = ai.album_id
                    AND LOWER(a.label) NOT IN ('archive','favorites')
                WHERE ai.image_id IN ({image_placeholders})
                GROUP BY ai.image_id
            ),
            faces_grouped AS (
                SELECT 
                    f.image_id,
                    json_group_array(
                        json_object(
                            'face_id', f.face_id,
                            'group_label', g.label,
                            'image_id', f.image_id,
                            'width', f.width,
                            'height', f.height,
                            'left', f.left,
                            'top', f.top,
                            'group_id', f.group_id
                        )
                    ) AS faces_json
                FROM accessible_faces f
                INNER JOIN accessible_groups g ON f.group_id = g.group_id
                WHERE f.image_id IN ({image_placeholders})
                GROUP BY f.image_id
            )
            SELECT 
                i.image_id,
                i.label,
                i.date_taken,
                i.file_size,
                i.width,
                i.height,
                i.moment_id,
                m.label AS moment_label,
                i.is_archived,
                i.is_favorite,
                COALESCE(a.albums_json, '[]') AS albums,
                COALESCE(f.faces_json, '[]') AS faces
            FROM accessible_images i
            LEFT JOIN accessible_moments m ON m.moment_id = i.moment_id
            LEFT JOIN albums_grouped a ON a.image_id = i.image_id
            LEFT JOIN faces_grouped f ON f.image_id = i.image_id
            WHERE i.image_id IN ({image_placeholders});
        '''

        rows = self.db.execute_query(query, image_ids * 3, return_format=ReturnFormat.LIST_DICTS)

        result = []
        for image in rows:
            albums = json.loads(image["albums"]) if image["albums"] else []
            faces_data = json.loads(image["faces"]) if image["faces"] else []
            moment_info = {
                "moment_id": image.get("moment_id"),
                "label": image.get("moment_label")
            } if image.get("moment_id") else None

            image_data = {
                "id": image["image_id"],
                "label": image["label"],
                "date_taken": image.get("date_taken"),
                "file_size": image.get("file_size"),
                "width": image.get("width"),
                "height": image.get("height"),
                "is_archived": bool(image.get("is_archived")),
                "is_favorite": bool(image.get("is_favorite")),
                "albums_count": len(albums),
                "albums": albums,
                "faces_count": len(faces_data),
                "faces": faces_data,
                "moment": moment_info,
            }

            result.append(image_data)

        if not return_list:
            result = result[0]

        return result
      
    # -------- Groups helpers --------
    def get_related_groups(self, group_ids: List[str], base_image_ids: List[str]) -> List[str]:
        """Return related group ids ordered by relevance using co-occurrence in images."""
        if not base_image_ids or not group_ids:
            return []

        group_id_placeholders = ','.join(['?'] * len(group_ids))
        image_placeholders = ','.join(['?'] * len(base_image_ids))
        accessible_groups = STRUCTURE['groups']['accessible_table']
        accessible_faces = STRUCTURE['faces']['accessible_table']

        query = f'''
            SELECT g.*
            FROM {accessible_groups} g
            JOIN {accessible_faces} f ON g.group_id = f.group_id
            WHERE f.image_id IN ({image_placeholders})
            AND g.group_id NOT IN ({group_id_placeholders})
            GROUP BY g.group_id, g.label
            ORDER BY COUNT(DISTINCT f.image_id) DESC, g.label ASC
        '''
        
        query_params = base_image_ids + group_ids

        return self.db.execute_query(query, query_params, return_format=ReturnFormat.LIST_DICTS)

    def get_filtered_images(self, group_ids: List[str], mode: str = 'and', only: bool = False, limit: int | None = None, offset: int | None = None) -> List[str]:
        
        if not group_ids:
            return []

        relation, child, child_id_field, view_fields = AppDB.get_relation('groups', 'images')
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
        else:
            query += f"WHERE f.group_id IN ({group_placeholders})"

        params.extend(group_ids)
        if only:
            having_clause.append(f"COUNT(DISTINCT CASE WHEN f.group_id NOT IN ({group_placeholders}) THEN f.group_id END) = 0")
            params.extend(group_ids)

        if having_clause:
            query += f" GROUP BY f.image_id"
            query += f" HAVING {' AND '.join(having_clause)}"

        limit_clause = ''
        if limit is not None:
            limit_clause = f' LIMIT {int(limit)}'
            if offset is not None:
                limit_clause += f' OFFSET {int(offset)}'

        query += limit_clause
        
        results = self.db.execute_query(query, params, return_format=ReturnFormat.DICT_DICTS)
        faces_mapping = {id: row['representative_face'] for id, row in results.items()}
        image_ids = list(results.keys())
        images = {}
        for id, row in results.items():
            row.pop('representative_face')
            images[id] = row
        changes = [{
            'type': 'RELATION_SET',
            'relation': 'groups.images',
            'parentId': group_ids[0],
            'ids': image_ids
        }]
        changes.append({
            'type': 'UPSERT',
            'entity': 'groups',
            'items': {group_ids[0]: {'faces_mapping': faces_mapping}}
        })
        changes.append({
            'type': 'UPSERT',
            'entity': 'images',
            'items': images
        })

        return changes

    # -------- Faces helpers --------
    def add_faces_to_group(self, *, face_ids: List[str] | None = None, target_group_id: str | None = None, new_group_name: str | None = None, source_group_id: str | None = None) -> Dict:

        # handle new group
        if face_ids is None:
            if not source_group_id:
                raise ValueError("face_ids or source_group_id must be provided")
            face_ids = [face_id['face_id'] for face_id in self.get_childs('groups', source_group_id, child='faces')]

        if new_group_name:
            if self.is_exists('groups', {'label': new_group_name}):
                raise ValueError(f"Group name '{new_group_name}' already exists")
            target_group_id = self.add('groups', {'label': new_group_name})

        if not target_group_id:
            raise ValueError("target_group_id or new_group_name must be provided")

        # handle source group deletion
        source_deleted = False
        if source_group_id:
            accessible_faces = STRUCTURE['faces']['accessible_table']
            face_placeholders = ','.join(['?'] * len(face_ids))
            query = f"""
                SELECT NOT EXISTS(SELECT 1 FROM {accessible_faces} WHERE group_id = ? AND face_id NOT IN ({face_placeholders}))
            """
            results = self.db.execute_query(query, (source_group_id, *face_ids), return_format=ReturnFormat.VALUE)
            if results:
                source_deleted = True
                        
        # edit faces
        face_ids, old_parent_ids, changes = self.edit_childs('groups', target_group_id, child='faces', child_ids=face_ids, add=True)
        result = {
            'source_deleted': source_deleted,
            'target_group_id': target_group_id,
            'new_group_created': bool(new_group_name is not None),
            'len_added': len(face_ids),
            'changes': changes
        }

        if face_ids:
            # handle source group deletion changes
            if source_deleted:           
                result['changes'].append({
                    'type': 'REMOVE',
                    'entity': 'groups',
                    'ids': [source_group_id]
                })

                if self.is_empty('groups', source_group_id):
                    self.delete('groups', source_group_id)

            result['changes'].extend(self.get_enteties_changes('groups', list(set(old_parent_ids.keys()).union([target_group_id]))))
            result['changes'].extend(self.get_enteties_changes('faces', face_ids))

            # affected images ids
            accessible_faces = STRUCTURE['faces']['accessible_table']
            placeholders = ','.join(['?'] * len(face_ids))
            query = f"""
                SELECT DISTINCT f.image_id
                FROM {accessible_faces} f
                WHERE f.group_id = ?
                AND f.face_id IN ({placeholders})
            """
            affected_images_ids = self.db.execute_query(query, (target_group_id, *face_ids), return_format=ReturnFormat.LIST_VALUES)
            result['changes'].append({
                'type': 'RELATION_ADD',
                'relation': 'groups.images',
                'parentId': target_group_id,
                'ids': affected_images_ids
            })
            
            accessible_images = STRUCTURE['images']['accessible_table']
            for old_parent_id, child_ids in old_parent_ids.items():
                query = f"""
                    SELECT DISTINCT i.image_id
                    FROM {accessible_images} i
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM {accessible_faces} f
                        WHERE f.image_id = i.image_id
                        AND f.group_id = ?
                        AND f.face_id IN ({placeholders})
                    )
                    AND EXISTS (
                        SELECT 1
                        FROM {accessible_faces} f
                        WHERE f.image_id = i.image_id
                        AND f.face_id IN ({placeholders})
                    )
                """
                removed_images_ids = self.db.execute_query(query, (old_parent_id, *child_ids, *child_ids), return_format=ReturnFormat.LIST_VALUES)
                if removed_images_ids:
                    result['changes'].append({
                        'type': 'RELATION_REMOVE',
                        'relation': 'groups.images',
                        'parentId': old_parent_id,
                        'ids': removed_images_ids
                    })
                 
        return result

    # -------- Moments helpers --------
    def edit_moment_images(self, moment_id: str, image_ids: List[str], add: bool) -> Dict:
        valid_image_ids, old_parent_ids, changes = self.edit_childs('moments', moment_id, 'images', image_ids, add=add)
        result = {
            'len_edited': len(valid_image_ids),
            'changes': changes
        }
        if valid_image_ids:
            result['changes'].extend(self.get_enteties_changes('images', valid_image_ids))

        return result

    # -------- Albums helpers --------
    def get_archive_album(self) -> str | None:
        """Get the archive album id."""
        return self.db.execute_query('SELECT album_id FROM albums WHERE LOWER(label) = "archive"', return_format=ReturnFormat.VALUE)

    def get_favorites_album(self) -> str | None:
        """Get the favorites album id."""
        return self.db.execute_query('SELECT album_id FROM albums WHERE LOWER(label) = "favorites"', return_format=ReturnFormat.VALUE)

    def edit_album_images(self, album_id: str, image_ids: List[str], add: bool) -> Dict:

        archive_album_id = self.get_archive_album()
        favorites_album_id = self.get_favorites_album()
        valid_image_ids, old_parent_ids, changes = self.edit_childs('albums', album_id, 'images', image_ids, add=add)
        result = {
            'len_edited': len(valid_image_ids),
            'changes': changes
        }
        
        if album_id == archive_album_id or album_id == favorites_album_id:
            if valid_image_ids:
                result['changes'].extend(self.get_enteties_changes('images', valid_image_ids))

            if album_id == archive_album_id:
                relation_type = 'RELATION_REMOVE' if add else 'RELATION_ADD'

                placeholders = ','.join(['?'] * len(valid_image_ids))
                query = f"""
                    SELECT r.face_id
                    FROM accessible_faces r
                    WHERE r.image_id IN ({placeholders})
                """
                faces_ids = self.db.execute_query(query, valid_image_ids, return_format=ReturnFormat.LIST_VALUES)
                relations = [
                    ('albums', 'images', valid_image_ids),
                    ('groups', 'images', valid_image_ids),
                    ('groups', 'faces', faces_ids),
                    ('moments', 'images', valid_image_ids),
                ]
                for parent, child, ids in relations:
                    placeholders = ','.join(['?'] * len(ids))
                    parent_id_field = AppDB.get_id_field(parent)
                    relation, child, child_id_field, view_fields = AppDB.get_relation(parent, child)
                    accessible_relation = STRUCTURE[relation]['accessible_table']
                    where_clause = ''
                    params = ids
                    if parent == 'albums':
                        where_clause = f"AND r.{parent_id_field} <> ?"
                        params.append(archive_album_id)
                    
                    query = f"""
                        SELECT DISTINCT r.{parent_id_field}, r.{child_id_field}
                        FROM {accessible_relation} r
                        WHERE r.{child_id_field} IN ({placeholders})
                        {where_clause}
                    """
                    parent_ids = self.db.execute_query(query, params, return_format=ReturnFormat.LIST_TUPLES)
                    change = {}
                    for parent_id, child_id in parent_ids:
                        change.setdefault(parent_id, []).append(child_id)

                for parent_id, child_ids in change.items():
                        result['changes'].append({
                            'type': relation_type,
                            'relation': f'{parent}.{child}',
                            'parentId': parent_id,
                        'ids': child_ids
                        })
                        
                        result['changes'].extend(self.get_enteties_changes(parent, parent_id))
                
        return result

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
