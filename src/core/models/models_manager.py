import json
from typing import List, Dict, Union
from ..db import AppDB, STRUCTURE, get_fields_as_sub_table
import uuid

MODELS = {
    'images': {
        'add_data': {
            'label': '',
            'date_taken': '',
            'file_size': 0,
            'width': 0,
            'height': 0,
            'momentID': ''
        },
    },
    'groups': {
        'add_data': {
            'label': '',
            'representative_face': ''
        },
    },
    'faces': {
        'add_data': {
            'imageID': '',
            'width': 0,
            'height': 0,
            'left': 0,
            'top': 0,
            'faceID': '',
            'groupID': ''
        },
    },
    'moments': {
        'add_data': {
            'label': '',
            'description': '',
            'start': '',
            'end': '',
            'representative_image': ''
        },
    },
    'albums': {
        'add_data': {
            'label': '',
            'description': '',
            'representative_image': ''
        },
    },
    'profiles': {
        'add_data': {
            'label': '',
            'password': '',
            'hierarchy_rank': 0,
            'is_profiles_manager': False,
            'can_edit': False,
            'all_images': False,
            'all_albums': False,
            'save_preferences': False
        }
    },
}

class ModelsManager:
    # -------- Generic model helpers (CRUD) --------
    def __init__(self, db: AppDB) -> None:
        self.db = db

    @staticmethod
    def generate_id() -> str:
        """Generate a new UUID for the entity."""
        return str(uuid.uuid4())

    def is_exists(self, table: str, fields: Dict, exclude_id: str = None) -> str | None:
        return self.db.is_exists(table, fields, exclude_id)

    def is_empty(self, table: str, entity_id: str) -> bool:
        sub_query = STRUCTURE[table]['sub_table']
        id_field = STRUCTURE[table]['primary_key']
        query = f'SELECT COUNT(*) FROM {sub_query} WHERE {id_field} = ?'
        results = self.db.execute_query(query, (entity_id,))
        return results[0][0] == 0

    def is_accessible(self, table: str, entity_id: str) -> bool:
        accessible_table = self.db._get_accessible_table_name(table)
        id_field = STRUCTURE[table]['primary_key']
        query = f'SELECT {id_field} FROM {accessible_table} WHERE {id_field} = ?'
        results = self.db.execute_query(query, (entity_id,))
        return results is not None and len(results) > 0

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

    def get_summary(self, table: str, entity_ids: List[str] | str | None = None, *, exclude_empty_entities: bool = False, sort: bool = False) -> List[Dict] | Dict:
        return_list = True
        if isinstance(entity_ids, str):
            entity_ids = [entity_ids]
            return_list = False

        if table not in ['groups', 'moments', 'albums']:
            return []

        accessible_table = self.db._get_accessible_table_name(table)
        sub_table = STRUCTURE[table]['sub_table']
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
            LEFT JOIN {sub_table} s ON t.{id_field} = s.{id_field}
            {where_clause}
            GROUP BY t.{id_field}
            {having_clause}
            {order_by}
        '''
        results = self.db.execute_query(query, entity_ids, include_columns=True)
        if return_list:
            return results
        return results[0]

    def get_sub_entities(self, table: str, entity_id: str, *, sort: bool = False, limit: int | None = None, offset: int | None = None) -> List[Dict]:
        if table not in ['images','groups', 'moments', 'albums']:
            return []

        sub_table = STRUCTURE[table]['sub_table']
        accessible_sub_table = self.db._get_accessible_table_name(sub_table)
        id_field = STRUCTURE[table]['primary_key']
        sort_field = STRUCTURE[sub_table]['sort_by']
        fields_as_sub_table = get_fields_as_sub_table(sub_table, 's')

        order_by = ''
        if sort_field and sort:
            order_by = f'ORDER BY s.{sort_field}'

        limit_clause = ''
        if limit is not None:
            limit_clause = f'LIMIT {int(limit)}'
            if offset is not None:
                limit_clause += f' OFFSET {int(offset)}'
        
        query = f'''
            SELECT {fields_as_sub_table}
            FROM {accessible_sub_table} s
            WHERE {id_field} = ?
            {order_by}
            {limit_clause}
        '''
        results = self.db.execute_query(query, (entity_id,), include_columns=True)
        return results

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
                FROM album_images ai
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
                            'imageID', f.imageID,
                            'width', f.width,
                            'height', f.height,
                            'left', f.left,
                            'top', f.top,
                            'groupID', f.groupID
                        )
                    ) AS faces_json
                FROM accessible_faces f
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
      
    def get_related_groups(self, group_ids: List[str], base_image_ids: List[str]) -> List[str]:
        """Return related group IDs ordered by relevance using co-occurrence in images."""
        if not base_image_ids or not group_ids:
            return []

        group_id_placeholders = ','.join(['?'] * len(group_ids))
        image_placeholders = ','.join(['?'] * len(base_image_ids))
        accessible_groups = self.db._get_accessible_table_name('groups')
        accessible_faces = self.db._get_accessible_table_name('faces')

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

        accessible_faces = self.db._get_accessible_table_name('faces')
        images_table = 'groups_images'
        accessible_images = self.db._get_accessible_table_name(images_table)
        fields_as_sub_table = get_fields_as_sub_table(images_table, 'i')

        N = len(group_ids)
        M = min(N, 8)
        group_placeholders = ','.join(['?'] * N)
        having_clause = []
        params = []

        priority_case = "CASE i.groupID " + " ".join(
            f"WHEN ? THEN {idx+1}" for idx in range(M)
        ) + " ELSE 9999 END"
        params.extend(group_ids[:M])

        query = f"""
            WITH ranked AS (
                SELECT i.*, 
                    ROW_NUMBER() OVER (
                        PARTITION BY i.imageID
                        ORDER BY {priority_case}
                    ) AS rn
                FROM {accessible_faces} f
                INNER JOIN {accessible_images} i ON f.imageID = i.imageID
            )
            SELECT DISTINCT {fields_as_sub_table}
            FROM ranked i
            WHERE i.rn = 1
        """

        if mode == 'and':
            having_clause.append(f"COUNT(DISTINCT CASE WHEN i.groupID IN ({group_placeholders}) THEN i.groupID END) = {N}")
        else:
            query += f"WHERE i.groupID IN ({group_placeholders})"

        params.extend(group_ids)
        if only:
            having_clause.append(f"COUNT(DISTINCT CASE WHEN i.groupID NOT IN ({group_placeholders}) THEN i.groupID END) = 0")
            params.extend(group_ids)

        if having_clause:
            query += f" GROUP BY i.imageID"
            query += f" HAVING {' AND '.join(having_clause)}"

        limit_clause = ''
        if limit is not None:
            limit_clause = f' LIMIT {int(limit)}'
            if offset is not None:
                limit_clause += f' OFFSET {int(offset)}'

        query += limit_clause

        return self.db.execute_query(query, params, include_columns=True)

    # -------- Groups helpers --------
    ######## TODO: use is_empty instead
    def is_group_empty(self, group_id: str) -> bool:
        """Bypass profile access: check if group has zero faces (raw faces table)."""
        query = 'SELECT COUNT(*) FROM faces WHERE groupID=?'
        results = self.db.execute_query(query, (group_id,))
        count = results[0][0] if results else 0
        return count == 0
    
    def get_group_faces_in_images(self, group_id: str, image_ids: List[str] | str | None = None) -> List[str]:
        """Return face IDs that belong to a specific group in a specific images."""
        accessible_table = self.db._get_accessible_table_name('faces')
        where_clause = 'WHERE groupID = ?'
        if not image_ids:
            image_ids = []
        else:
            where_clause += f'AND imageID IN ({','.join(['?'] * len(image_ids))})'
            if isinstance(image_ids, str):
                image_ids = [image_ids]
        query = f'SELECT faceID FROM {accessible_table} {where_clause}'
        results = self.db.execute_query(query, (group_id, *image_ids))
        return [row[0] for row in results]

    def ensure_group_representative(self, group_id: str) -> str:
        accessible_table = self.db._get_accessible_table_name('faces')
        group = self.get_summary('groups', group_id)
        if group and group.get('representative_face'):
            return group.get('representative_face')
        
        biggest_face = self.db.execute_query(f'SELECT faceID FROM {accessible_table} WHERE groupID = ? ORDER BY width * height DESC LIMIT 1', (group_id,))[0][0]
        self.edit('groups', group_id, {'representative_face': biggest_face})
        
        return biggest_face

    def add_faces_to_group(self, group_id: str, face_ids: List[str]) -> dict[str, List[str]]:
        if not face_ids or not group_id:
            return {'updated_groups': [], 'deleted_groups': []}

        accessible_table = self.db._get_accessible_table_name('faces')
        placeholders = ','.join(['?'] * len(face_ids))
        query = f'SELECT DISTINCT groupID FROM {accessible_table} WHERE faceID IN ({placeholders})'
        
        deleted_groups = []
        updated_groups = []
        old_groups = self.db.execute_query(query, face_ids)        
        for old_group in old_groups:
            old_group_id = old_group[0]
            if self.is_empty('groups', old_group_id):
                self.delete('groups', old_group_id)
                deleted_groups.append(old_group_id)
            else:
                self.ensure_group_representative(old_group_id)
                updated_groups.append(old_group_id)

        self.edit('faces', face_ids, {'groupID': group_id})
        self.ensure_group_representative(group_id)
  
        return {'updated_groups': updated_groups, 'deleted_groups': deleted_groups}

    ########## TODO: complete later
    def transfer_faces(
        self,
        source_group_id: str,
        *,
        face_id: str | None = None,
        image_ids: List[str] | None = None,
        target_group_id: str | None = None,
        new_group_name: str | None = None,
    ) -> Dict:
        return {}

        source_group = self.get_summary('groups', source_group_id)
        if not source_group:
            raise ValueError(f"Source group {source_group} not found")
        if not face_id and not image_ids:
            raise ValueError("face_id or image_ids is required")

        faces_ids = [face_id] if face_id else self.get_group_faces_in_images(source_group_id, image_ids)
        
        if faces_ids:
            if not target_group_id:
                if self.is_exists('groups', {'label': new_group_name}):
                    raise ValueError(f"Group name '{new_group_name}' already exists")
                
                target_group_id = self.add('groups', {'label': new_group_name})
            
            target_group = self.get_summary('groups', target_group_id)
            if not target_group:
                raise ValueError(f"Target group {target_group_id} not found")
            
            added_to_target = self.add_faces_to_group(target_group_id, faces_ids)


        target_group_id_was_provided = target_group_id is not None
        if target_group_id:
            target_group = self.get_summary('groups', target_group_id)
            if not target_group:
                raise ValueError(f"Target group {target_group_id} not found")
        else:
            if not new_group_name:
                raise ValueError("new_group_name is required when target_group_id is not provided")
            conflict_check = self.is_exists('groups', {'label': new_group_name})
            if conflict_check:
                raise ValueError(f"Group name '{new_group_name}' already exists")
            # Create new group with empty representative; it will be set by add_faces_to_group
            created_id = self.add('groups', {
                'label': new_group_name,
                'representative_face': ''
            })
            target_group_id = created_id

        target_group = self.get_summary('groups', target_group_id)
        target_representative_before = target_group.get('representative_face') if target_group else ''

        # Determine which images are genuinely new for the target group
        images_to_add_to_target = set(original_affected_images)
        if target_group and 'image_ids' in target_group:
            existing_target_images = set(target_group['image_ids'])
            images_to_add_to_target.difference_update(existing_target_images)

        transferred_faces_ids = self.add_faces_to_group(target_group_id, face_ids)

        # Determine which of the affected images no longer have any faces from the source group
        images_to_remove_from_source = set()
        for image_id in original_affected_images:
            if not self.get_group_faces_in_image(image_id, source_group, True):
                images_to_remove_from_source.add(image_id)

        old_representative = old_group.get('representative_face', '')

        old_group_deleted = False
        if self.is_group_empty(source_group):
            self.delete('groups', source_group)
            old_group_deleted = True

        updated_source_group = None
        if not old_group_deleted:
            updated_source_group = self.get_summary('groups', source_group)

        updated_target_group = self.get_summary('groups', target_group_id)
        target_representative_after = updated_target_group.get('representative_face') if updated_target_group else ''

        result = {
            'target_group_id': target_group_id,
            'old_group_deleted': old_group_deleted,
            'transferred_faces_ids': transferred_faces_ids,
            'images_to_remove_from_source': list(images_to_remove_from_source),
            'images_to_add_to_target': list(images_to_add_to_target),
            'updated_source_group': updated_source_group,
            'updated_target_group': updated_target_group,
            'representatives': {
                'source_before': old_representative,
                'source_after': (updated_source_group or {}).get('representative_face') if not old_group_deleted else '',
                'target_before': target_representative_before,
                'target_after': target_representative_after,
            }
        }

        if not target_group_id_was_provided and new_group_name is not None:
            result['new_group_name'] = new_group_name

        # Get complete data for all images affected by the transfer to update ImageViewer
        transferred_image_ids = set()
        if result.get('transferred_faces_ids'):
            accessible_faces = self.db._get_accessible_table_name('faces')
            placeholders = ','.join(['?'] * len(result['transferred_faces_ids']))
            query = f"SELECT DISTINCT imageID FROM {accessible_faces} WHERE faceID IN ({placeholders})"
            rows = self.db.execute_query(query, (*result['transferred_faces_ids'],), True)
            for row in rows:
                transferred_image_ids.add(row[0])
        
        result['transferred_image_ids'] = list(original_affected_images)

        return result

    # -------- Moments helpers --------
    def add_images_to_moment(self, moment_id: str, image_ids: List[str]) -> List[str]:
        if not image_ids:  # Guard against empty lists
            return []
        accessible_table = self.db._get_accessible_table_name('images')
        image_placeholders = ','.join(['?'] * len(image_ids))   
        query = f'UPDATE {accessible_table} SET momentID=? WHERE imageID IN ({image_placeholders})'
        updated_ids = self.db.execute_query(query, (moment_id, *image_ids), True)

        representative_image = self.get_summary('moments', moment_id).get('representative_image')
        new_representative_image = ''
        if len(image_ids) > 0:
            new_representative_image = image_ids[0]
        # Set the first image ID as representative image if none exists
        if (representative_image == '' or representative_image is None) and new_representative_image:
            self.edit('moments', moment_id, {'representative_image': new_representative_image}, True)

        accessible_table = self.db._get_accessible_table_name('moments')
        old_moments = self.db.execute_query(f'SELECT DISTINCT momentID, representative_image FROM {accessible_table} WHERE momentID != ? AND representative_image IN ({image_placeholders})', (moment_id, *image_ids), True)
        for moment_id, old_representative_image in old_moments:
            if old_representative_image in image_ids:
                remaining_images = self.get_sub_entities('moments', moment_id)
                if len(remaining_images) > 0:
                    new_representative_image = remaining_images[0]
                else:
                    new_representative_image = ''
                self.edit('moments', moment_id, {'representative_image': new_representative_image}, True)
        
        return updated_ids

    def remove_images_from_moment(self, moment_id: str, image_ids: List[str]) -> List[str]:
        if not image_ids:  # Guard against empty lists
            return []
        accessible_table = self.db._get_accessible_table_name('images')
        image_placeholders = ','.join(['?'] * len(image_ids))
        query = f'UPDATE {accessible_table} SET momentID=NULL WHERE imageID IN ({image_placeholders}) AND momentID=?'
        updated_ids = self.db.execute_query(query, (*image_ids, moment_id), True)

        # Check if the current representative image is being removed
        current_representative_image = self.get_summary('moments', moment_id).get('representative_image')
        if current_representative_image and current_representative_image in image_ids:
            # Find a new representative image from remaining images
            remaining_images = self.get_sub_entities('moments', moment_id)
            new_representative_image = ''
            if remaining_images and len(remaining_images) > 0:
                new_representative_image = remaining_images[0]
            self.edit('moments', moment_id, {'representative_image': new_representative_image}, True)
        
        return updated_ids
    
    # -------- Albums helpers --------
    def add_images_to_album(self, album_id: str, image_ids: List[str]) -> Dict[str, Union[List[str], List[str]]]:
        """Add images to an album. Returns added image IDs and images that are now archived."""
        if not image_ids:
            return {'added_ids': [], 'archived_ids': []}
            
        already_in_album = self.get_sub_entities('albums', album_id)
        image_ids = [image_id for image_id in image_ids if image_id not in already_in_album]
        
        if not image_ids:
            return {'added_ids': [], 'archived_ids': []}
        
        rows = [{'albumID': album_id, 'imageID': image_id} for image_id in image_ids]
        # inserted_pairs is a list of (album_id, image_id) tuples
        inserted_pairs = self.db.insert('accessible_albums_images', rows)
        added_ids = [pair[1] for pair in inserted_pairs]
        
        if not added_ids:
            return {'added_ids': [], 'archived_ids': []}
        
        archived_ids = []
        image_placeholders = ','.join(['?'] * len(added_ids))
        query = f'''
            SELECT imageID
            FROM images_with_albums
            WHERE imageID IN ({image_placeholders}) AND is_archived = 1
        '''
        results = self.db.execute_query(query, (*added_ids,), True)
        if results:
            archived_ids.extend([row[0] for row in results])

        return {'added_ids': added_ids, 'archived_ids': archived_ids}

    def remove_images_from_album(self, album_id: str, image_ids: List[str]) -> List[str]:
        """Remove images from an album. Rely on DB triggers for permissions and then update representative image if needed."""
        if not image_ids:
            return []
        
        del_placeholders = ','.join(['?'] * len(image_ids))
        deleted_pairs = self.db.delete(
            'accessible_albums_images',
            {'albumID': album_id, 'imageID': image_ids}
        )
        
        # If representative_image removed, choose a new one (first remaining), or clear it
        current_album = self.get_summary('albums', album_id)
        if current_album:
            rep = current_album.get('representative_image') or ''
            if rep and rep in image_ids:
                remaining = self.get_sub_entities('albums', album_id)
                new_rep = remaining[0] if remaining else ''
                self.edit('albums', album_id, {'representative_image': new_rep}, include_archived=True)

        return [pair[1] for pair in deleted_pairs]

    def get_archive_album(self) -> str | None:
        """Get the archive album ID."""
        return self.db.execute_query('SELECT albumID FROM albums WHERE LOWER(label) = "archive"')[0][0]

    def get_favorites_album(self) -> str | None:
        """Get the favorites album ID."""
        return self.db.execute_query('SELECT albumID FROM albums WHERE LOWER(label) = "favorites"')[0][0]

    # -------- Profiles helpers --------
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
