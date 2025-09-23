import json
from typing import List, Dict, Union
from ..db import AppDB, STRUCTURE
import uuid

class ModelsManager:

    def __init__(self, db: AppDB) -> None:
        self.db = db

    @staticmethod
    def generate_id() -> str:
        """Generate a new UUID for the entity."""
        return str(uuid.uuid4())

    def is_exists(self, table: str, fields: Dict, exclude_id: str = None) -> str | None:
        """Check if a record exists and return its ID for conflict checking."""

        where_clause = ' AND '.join([f'{k}=?' for k in fields.keys()])
        where_params = tuple(fields.values())

        query = f"""
            SELECT {STRUCTURE[table]["primary_key"]}
            FROM {table}
            WHERE {where_clause}
            AND {STRUCTURE[table]["primary_key"]} != ?
        """
        results = self.db.execute_query(query, (*where_params, exclude_id))
        return results[0][0] if results else None

    def is_empty(self, table: str, entity_id: str) -> bool:
        childs = AppDB.get_view_child(table, all=True)
        id_field = STRUCTURE[table]['primary_key']
        for child in childs:
            query = f'SELECT EXISTS(SELECT 1 FROM {child} WHERE {id_field} = ?)'
            results = self.db.execute_query(query, (entity_id,))
            if results[0][0]:
                return False
        
        return True

    def is_accessible(self, table: str, entity_id: str) -> bool:
        accessible_table = STRUCTURE[table]['accessible_table']
        id_field = STRUCTURE[table]['primary_key']
        query = f'SELECT EXISTS(SELECT 1 FROM {accessible_table} WHERE {id_field} = ?)'
        results = self.db.execute_query(query, (entity_id,))
        return bool(results[0][0])

    def get_summary(self, table: str, entity_ids: List[str] | str | None = None, *, exclude_empty_entities: bool = False, sort: bool = False) -> List[Dict] | Dict:
        return_list = True
        if isinstance(entity_ids, str):
            entity_ids = [entity_ids]
            return_list = False

        accessible_table = STRUCTURE[table]['accessible_table']
        child = AppDB.get_view_child(table)
        accessible_child = STRUCTURE[child]['accessible_table']
        id_field = STRUCTURE[table]['primary_key']
        sort_field = STRUCTURE[table]['sort_by']

        where_clause = ''
        if entity_ids:
            where_clause += f'WHERE t.{id_field} IN ({','.join(['?'] * len(entity_ids))})'
        else:
            entity_ids = []

        having_clause = ''
        if exclude_empty_entities:
            having_clause = f'HAVING COUNT(s.{id_field}) > 0'

        order_by = ''
        if sort_field and sort:
            order_by = f'ORDER BY t.{sort_field}'

        query = f'''
            SELECT t.*, COUNT(s.{id_field}) AS count
            FROM {accessible_table} t
            LEFT JOIN {accessible_child} s ON t.{id_field} = s.{id_field}
            {where_clause}
            GROUP BY t.{id_field}
            {having_clause}
            {order_by}
        '''
        results = self.db.execute_query(query, entity_ids, include_columns=True)
        if return_list:
            return results
        if results:
            return results[0]
        return None

    def get_childs(self, table: str, entity_id: str, *, child: str | None = None, sort: bool = False, limit: int | None = None, offset: int | None = None) -> List[Dict]:

        child = AppDB.get_view_child(table, child=child)
        if not child:
            return []

        accessible_child = STRUCTURE[child]['accessible_table']
        id_field = STRUCTURE[table]['primary_key']
        sort_field = STRUCTURE[child].get('sort_by','')
        fields_as_child = AppDB.get_fields_as_child(child, 'c')
        
        order_by = ''
        if sort_field and sort:
            order_by = f'ORDER BY c.{sort_field}'

        limit_clause = ''
        if limit is not None:
            limit_clause = f'LIMIT {int(limit)}'
            if offset is not None:
                limit_clause += f' OFFSET {int(offset)}'
        
        query = f'''
            SELECT {fields_as_child}
            FROM {accessible_child} c
            WHERE {id_field} = ?
            {order_by}
            {limit_clause}
        '''
        results = self.db.execute_query(query, (entity_id,), include_columns=True)
        return results

    def add(self, table: str, data: Union[Dict, List[Dict]]) -> List[str] | str | None:
        """Insert one or many records. If a single dict is provided, return the new ID.
        If a list is provided, return the inserted records list.
        """
        is_single_item = isinstance(data, dict)
        data_list = [data] if is_single_item else data
        
        for row in data_list:
            if STRUCTURE[table]['primary_key'] not in row:
                row[STRUCTURE[table]['primary_key']] = ModelsManager.generate_id()
        
        inserted_ids = self.db.insert(table, data_list)
        
        if is_single_item:
            return inserted_ids[0] if inserted_ids else None
        return inserted_ids

    def delete(self, table: str, entity_ids: List[str] | str):
        return self.db.delete(table, {STRUCTURE[table]['primary_key']: entity_ids})

    def edit(self, table: str, entity_ids: List[str] | str, fields: Dict) -> List[str]:
        return self.db.update(table, {STRUCTURE[table]['primary_key']: entity_ids}, fields)

    def ensure_representative(self, table: str, entity_id: str) -> str:
        representative_field = STRUCTURE[table].get('representative_field','')
        if not representative_field:
            raise ValueError(f"Representative field not found")

        id_field = STRUCTURE[table]['primary_key']
        child, other_parent, relation_name, child_id_field = AppDB.get_edit_child(table)

        entity = self.get_summary(table, entity_id)

        if entity.get(representative_field):
            representative_id = entity.get(representative_field)
            query = f"""SELECT c.{child_id_field}
            FROM {child} c
            WHERE c.{id_field} = ?
            AND c.{child_id_field} = ?
            """
            if len(self.db.execute_query(query, (entity_id, representative_id))) > 0:
                return representative_id
        
        accessible_child = STRUCTURE[child]['accessible_table']

        query = f"""SELECT s.{child_id_field}
        FROM {accessible_child} s
        WHERE s.{id_field} = ?
        ORDER BY width * height DESC
        LIMIT 1
        """
        biggest = self.db.execute_query(query, (entity_id,), force_include_archived=True)
        if biggest:
            self.edit(table, entity_id, {representative_field: biggest[0][0]})
        
        return biggest

    def edit_childs(self, table: str, entity_id: str, child_ids: List[str], *, add: bool, child: str | None = None, force_include_archived: bool = False) -> Dict:
        child, other_parent, relation_name, child_id_field = AppDB.get_edit_child(table, child=child)
        exclusive = other_parent == table
        accessible_other_parent = STRUCTURE[other_parent]['accessible_table']
        accessible_child = STRUCTURE[child]['accessible_table']
        id_field = STRUCTURE[table]['primary_key']
        accessible_images = STRUCTURE['images']['accessible_table']

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
            query = f"""SELECT o.{child_id_field}
            FROM {accessible_other_parent} o
            LEFT JOIN {accessible_child} c ON o.{child_id_field} = c.{child_id_field} AND c.{id_field} = ?
            WHERE c.{child_id_field} IS {is_null} AND o.{child_id_field} IN ({placeholders})
            """
        valid_child_ids = self.db.execute_query(query, (entity_id, *child_ids), force_include_archived=force_include_archived)
        valid_child_ids = [row[0] for row in valid_child_ids]

        if not valid_child_ids:
            return {
                'affected_images_ids': [],
                'old_parent_ids': [],
                'changes': []
            }

        placeholders = ','.join(['?'] * len(valid_child_ids))

        # get old parent to remove relation and ensure representative
        old_parent_ids = set([entity_id])
        if add and exclusive:
            query = f"""
                SELECT DISTINCT c.{id_field}
                FROM {accessible_child} c
                WHERE c.{child_id_field} in ({placeholders})
                AND c.{id_field} IS NOT NULL
            """
            removed_images = self.db.execute_query(query, valid_child_ids, force_include_archived=force_include_archived)
            old_parent_ids.update([row[0] for row in removed_images])

        # get affected images to update
        query = f"""
            SELECT DISTINCT c.imageID
            FROM {accessible_child} c
            WHERE c.{child_id_field} in ({placeholders})
        """
        removed_images = self.db.execute_query(query, valid_child_ids, force_include_archived=force_include_archived)
        affected_images_ids = [row[0] for row in removed_images]

        # Apply edit
        if exclusive:
            if add:
                query = f'UPDATE {accessible_child} SET {id_field} = ? WHERE {child_id_field} IN ({placeholders})'
            else:
                query = f'UPDATE {accessible_child} SET {id_field} = NULL WHERE {id_field} = ? AND {child_id_field} IN ({placeholders})'
            self.db.execute_query(query, (entity_id, *valid_child_ids), force_include_archived=force_include_archived)
        else:
            if add:
                values_clause = ','.join(['(?, ?)'] * len(valid_child_ids))
                params = []
                for sid in valid_child_ids:
                    params.extend([entity_id, sid])
                query = f'INSERT OR IGNORE INTO {accessible_child} ({id_field}, {child_id_field}) VALUES {values_clause}'
                self.db.execute_query(query, tuple(params), force_include_archived=force_include_archived)
            else:
                query = f'DELETE FROM {accessible_child} WHERE {id_field} = ? AND {child_id_field} IN ({placeholders})'
                self.db.execute_query(query, (entity_id, *valid_child_ids), force_include_archived=force_include_archived)

        # ensure representative
        if STRUCTURE[table].get('representative_field',''):
            for parent_id in old_parent_ids:
                self.ensure_representative(table, parent_id)

        # get changes
        changes = []
        parents = self.get_summary(table, list(old_parent_ids))
        # TODO: maybe will be redundant after get_summary will return in the {"id": id, {all fields without id}} format
        parents = [{'id': parent[id_field], **{k: v for k, v in parent.items() if k != id_field}} for parent in parents]
        changes.append({
            'type': 'UPSERT',
            'entity': table,
            'items': parents
        })

        if add:
            changes.append({
                'type': 'RELATION_ADD',
                'relation': relation_name,
                'parentId': entity_id,
                'ids': affected_images_ids
            })

        for old_parent_id in old_parent_ids:
            query = f"""
                SELECT i.imageID
                FROM {accessible_images} i
                LEFT JOIN {accessible_child} c
                ON i.imageID = c.imageID
                AND c.{id_field} = ?
                AND c.{child_id_field} IN ({placeholders})
                WHERE c.{id_field} IS NULL
                AND i.imageID IN ({placeholders})
            """
            removed_images = self.db.execute_query(query, (old_parent_id, *valid_child_ids, *affected_images_ids), force_include_archived=force_include_archived)
            if removed_images:
                changes.append({
                    'type': 'RELATION_REMOVE',
                    'relation': relation_name,
                    'parentId': old_parent_id,
                    'ids': [row[0] for row in removed_images]
                })

        return {
            'affected_images_ids': affected_images_ids,
            'old_parent_ids': list(old_parent_ids),
            'changes': changes
        }

    # -------- Images helpers --------    
    def get_images(self, image_ids: List[str] | str | None = None) -> List[Dict]:
        
        return_list = isinstance(image_ids, list)
        if not image_ids:
            image_ids = []
        elif isinstance(image_ids, str):
            image_ids = [image_ids]

        image_placeholders = ','.join(['?'] * len(image_ids))
        query = f'''
            WITH albums_grouped AS (
                SELECT 
                    ai.imageID,
                    json_group_array(
                        json_object(
                            'albumID', a.albumID,
                            'label', a.label,
                            'representative_image', a.representative_image
                        )
                    ) AS albums_json
                FROM accessible_albums_images ai
                INNER JOIN accessible_albums a
                    ON a.albumID = ai.albumID
                    AND LOWER(a.label) NOT IN ('archive','favorites')
                WHERE ai.imageID IN ({image_placeholders})
                GROUP BY ai.imageID
            ),
            faces_grouped AS (
                SELECT 
                    f.imageID,
                    json_group_array(
                        json_object(
                            'faceID', f.faceID,
                            'group_label', g.label,
                            'imageID', f.imageID,
                            'width', f.width,
                            'height', f.height,
                            'left', f.left,
                            'top', f.top,
                            'groupID', f.groupID
                        )
                    ) AS faces_json
                FROM accessible_faces f
                INNER JOIN accessible_groups g ON f.groupID = g.groupID
                WHERE f.imageID IN ({image_placeholders})
                GROUP BY f.imageID
            )
            SELECT 
                i.imageID,
                i.label,
                i.date_taken,
                i.file_size,
                i.width,
                i.height,
                i.momentID,
                m.label AS moment_label,
                i.is_archived,
                i.is_favorite,
                COALESCE(a.albums_json, '[]') AS albums,
                COALESCE(f.faces_json, '[]') AS faces
            FROM accessible_images i
            LEFT JOIN accessible_moments m ON m.momentID = i.momentID
            LEFT JOIN albums_grouped a ON a.imageID = i.imageID
            LEFT JOIN faces_grouped f ON f.imageID = i.imageID
            WHERE i.imageID IN ({image_placeholders});
        '''

        rows = self.db.execute_query(query, image_ids * 3, include_columns=True)

        result = []
        for image in rows:
            albums = json.loads(image["albums"]) if image["albums"] else []
            faces_data = json.loads(image["faces"]) if image["faces"] else []
            moment_info = {
                "momentID": image.get("momentID"),
                "label": image.get("moment_label")
            } if image.get("momentID") else None

            image_data = {
                "id": image["imageID"],
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
        """Return related group IDs ordered by relevance using co-occurrence in images."""
        if not base_image_ids or not group_ids:
            return []

        group_id_placeholders = ','.join(['?'] * len(group_ids))
        image_placeholders = ','.join(['?'] * len(base_image_ids))
        accessible_groups = STRUCTURE['groups']['accessible_table']
        accessible_faces = STRUCTURE['faces']['accessible_table']

        query = f'''
            SELECT g.*
            FROM {accessible_groups} g
            JOIN {accessible_faces} f ON g.groupID = f.groupID
            WHERE f.imageID IN ({image_placeholders})
            AND g.groupID NOT IN ({group_id_placeholders})
            GROUP BY g.groupID, g.label
            ORDER BY COUNT(DISTINCT f.imageID) DESC, g.label ASC
        '''
        
        query_params = base_image_ids + group_ids

        return self.db.execute_query(query, query_params, include_columns=True)

    def get_filtered_images(self, group_ids: List[str], mode: str = 'and', only: bool = False, limit: int | None = None, offset: int | None = None) -> List[str]:
        
        if not group_ids:
            return []

        accessible_faces = STRUCTURE['faces']['accessible_table']
        accessible_images = STRUCTURE['images']['accessible_table']
        fields_as_child = AppDB.get_fields_as_child('groups_images', 'i').replace(', i.representative_face', '')

        N = len(group_ids)
        M = min(N, 8)
        group_placeholders = ','.join(['?'] * N)
        having_clause = []
        params = []

        priority_case = "CASE sf.groupID " + " ".join(f"WHEN ? THEN {idx+1}" for idx in range(M)) + " ELSE 9999 END"

        query = f"""
            SELECT
                {fields_as_child},
                (
                    SELECT sf.faceID
                    FROM {accessible_faces} sf
                    WHERE sf.imageID = i.imageID AND sf.groupID IN ({group_placeholders})
                    GROUP BY sf.imageID, sf.groupID
                    ORDER BY
                        {priority_case},
                        (sf.width * sf.height) DESC
                    LIMIT 1
                ) as representative_face
            FROM {accessible_faces} f
            INNER JOIN {accessible_images} i ON f.imageID = i.imageID
        """
        params.extend(group_ids)
        params.extend(group_ids[:M])

        if mode == 'and':
            having_clause.append(f"COUNT(DISTINCT CASE WHEN f.groupID IN ({group_placeholders}) THEN f.groupID END) = {N}")
        else:
            query += f"WHERE f.groupID IN ({group_placeholders})"

        params.extend(group_ids)
        if only:
            having_clause.append(f"COUNT(DISTINCT CASE WHEN f.groupID NOT IN ({group_placeholders}) THEN f.groupID END) = 0")
            params.extend(group_ids)

        if having_clause:
            query += f" GROUP BY f.imageID"
            query += f" HAVING {' AND '.join(having_clause)}"

        limit_clause = ''
        if limit is not None:
            limit_clause = f' LIMIT {int(limit)}'
            if offset is not None:
                limit_clause += f' OFFSET {int(offset)}'

        query += limit_clause

        return self.db.execute_query(query, params, include_columns=True)

    # -------- Faces helpers --------
    def add_faces_to_group(self, *, face_ids: List[str] | None = None, target_group_id: str | None = None, new_group_name: str | None = None, source_group_id: str | None = None) -> Dict:

        if face_ids is None:
            if not source_group_id:
                raise ValueError("face_ids or source_group_id must be provided")
            face_ids = [face_id['faceID'] for face_id in self.get_childs('groups', source_group_id, child='faces')]

        if new_group_name:
            if self.is_exists('groups', {'label': new_group_name}):
                raise ValueError(f"Group name '{new_group_name}' already exists")
            target_group_id = self.add('groups', {'label': new_group_name})

        if not target_group_id:
            raise ValueError("target_group_id or new_group_name must be provided")

        source_deleted = False
        if source_group_id:
            accessible_faces = STRUCTURE['faces']['accessible_table']
            face_placeholders = ','.join(['?'] * len(face_ids))
            query = f"""
                SELECT NOT EXISTS(SELECT 1 FROM {accessible_faces} WHERE groupID = ? AND faceID NOT IN ({face_placeholders}))
            """
            results = self.db.execute_query(query, (source_group_id, *face_ids))
            if results[0][0]:
                source_deleted = True
                        
        result = self.edit_childs('groups', target_group_id, face_ids, add=True, child='faces')
        result['source_deleted'] = source_deleted
        result['target_group_id'] = target_group_id
        result['new_group_created'] = bool(new_group_name is not None)

        if source_deleted:           
            result['changes'].append({
                'type': 'REMOVE',
                'entity': 'groups',
                'ids': [source_group_id]
            })

            if self.is_empty('groups', source_group_id):
                self.delete('groups', source_group_id)

        return result

    # -------- Albums helpers --------
    def get_archive_album(self) -> str | None:
        """Get the archive album ID."""
        return self.db.execute_query('SELECT albumID FROM albums WHERE LOWER(label) = "archive"')[0][0]

    def get_favorites_album(self) -> str | None:
        """Get the favorites album ID."""
        return self.db.execute_query('SELECT albumID FROM albums WHERE LOWER(label) = "favorites"')[0][0]

    def edit_album_images(self, album_id: str, image_ids: List[str], add: bool) -> Dict:

        archive_album_id = self.get_archive_album()
        favorites_album_id = self.get_favorites_album()
        force_include_archived = album_id == archive_album_id
        result = self.edit_childs('albums', album_id, image_ids, add=add, force_include_archived=force_include_archived)
        
        if album_id == archive_album_id or album_id == favorites_album_id:
            flag = 'is_archived' if album_id == archive_album_id else 'is_favorite'
            affected_images_ids = result['affected_images_ids']
            result['changes'].append({
                'type': 'UPSERT',
                'entity': 'image',
                'items': [{'id': img_id, flag: add} for img_id in affected_images_ids]
            })
        
        return result

    # -------- Profiles helpers --------
    ######## TODO: check if edit_childs replaces these
    def add_accessible_images(self, profile_id: str, image_ids: List[str]) -> List[str]:
        if not image_ids:
            return []
        to_insert = [
            {'profileID': profile_id, 'imageID': image_id, 'accessible': 1}
            for image_id in image_ids
        ]
        inserted_pairs = self.db.insert('editable_profile_images', to_insert)
        return [pair[1] for pair in inserted_pairs]

    def remove_accessible_images(self, profile_id: str, image_ids: List[str]) -> List[str]:
        if not image_ids:
            return []
        
        deleted_pairs = self.db.delete(
            'editable_profile_images',
            {'profileID': profile_id, 'imageID': image_ids}
        )
        return [pair[1] for pair in deleted_pairs]

    def add_accessible_albums(self, profile_id: str, album_ids: List[str]) -> List[str]:
        if not album_ids:
            return []
        to_insert = [
            {'profileID': profile_id, 'albumID': album_id, 'accessible': 1}
            for album_id in album_ids
        ]
        inserted_pairs = self.db.insert('editable_profile_albums', to_insert)
        return [pair[1] for pair in inserted_pairs]

    def remove_accessible_albums(self, profile_id: str, album_ids: List[str]) -> List[str]:
        if not album_ids:
            return []
        
        deleted_pairs = self.db.delete(
            'editable_profile_albums',
            {'profileID': profile_id, 'albumID': album_ids}
        )
        return [pair[1] for pair in deleted_pairs]
