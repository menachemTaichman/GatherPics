from typing import List, Dict, Optional, Union
from ..db import AppDB
import uuid

MODELS = {
    'images': {
        'id_field': 'imageID',
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
        'id_field': 'groupID',
        'add_data': {
            'label': '',
            'representative_face': ''
        },
    },
    'faces': {
        'id_field': 'faceID',
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
        'id_field': 'momentID',
        'add_data': {
            'label': '',
            'description': '',
            'start': '',
            'end': '',
            'representative_image': ''
        },
    },
    'albums': {
        'id_field': 'albumID',
        'add_data': {
            'label': '',
            'description': '',
            'representative_image': ''
        },
    },
    'profiles': {
        'id_field': 'profileID',
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

    def id_field(self, table: str) -> str:
        return MODELS[table]['id_field']

    def add_data(self, table: str) -> Dict:
        return MODELS[table]['add_data']

    def generate_id(self) -> str:
        """Generate a new UUID for the entity."""
        return str(uuid.uuid4())

    def add(self, table: str, data: Union[Dict, List[Dict]]):
        """Insert one or many records. If a single dict is provided, return the new ID.
        If a list is provided, return the inserted records list.
        """
        is_single_item = isinstance(data, dict)
        data_list = [data] if is_single_item else data
        
        for row in data_list:
            if self.id_field(table) not in row:
                row[self.id_field(table)] = self.generate_id()
        
        inserted_ids = self.db.insert(table, data_list)
        
        if is_single_item:
            return inserted_ids[0] if inserted_ids else None
        return inserted_ids

    def delete(self, table: str, entity_id: str):
        return self.db.delete(table, {self.id_field(table): entity_id})

    def edit(self, table: str, entity_id: str, fields: Dict, include_archived: bool = False) -> List[str]:
        return self.db.update(table, {self.id_field(table): entity_id}, fields)

    def get_one(self, table: str, entity_id: str, include_archived: bool = False) -> Dict | None:
        entity = self.db.get_one(table, {self.id_field(table): entity_id}, include_archived=include_archived)
        if not entity:
            return None
        if table == 'groups':
            entity['image_ids'] = self.get_group_images(entity_id, include_archived)
        elif table == 'moments':
            entity['image_ids'] = self.get_moment_images(entity_id, include_archived)
        elif table == 'albums':
            entity['image_ids'] = self.get_album_images(entity_id, include_archived)
        return entity

    def get_all(self, table: str, include_archived: bool = False, sort: bool = False, exclude_empty_entities: bool = False) -> List[Dict]:
        order_by = None
        if sort:
            if table == 'groups':
                order_by = 'label ASC'
            elif table == 'moments':
                order_by = 'start ASC'
            elif table == 'albums':
                order_by = "CASE WHEN label IN ('Favorites', 'Archive') THEN 0 ELSE 1 END, label ASC"

        results = self.db.get_all(table, include_archived, order_by=order_by, exclude_empty_entities=exclude_empty_entities)
        if table in ('groups', 'moments', 'albums'):
            for row in results:
                entity_id = row.get(self.id_field(table))
                if not entity_id:
                    row['image_ids'] = []
                    continue

                if table == 'groups':
                    row['image_ids'] = self.get_group_images(entity_id, include_archived)
                elif table == 'moments':
                    row['image_ids'] = self.get_moment_images(entity_id, include_archived)
                elif table == 'albums':
                    # Always include archived for 'archive' album, otherwise use param
                    is_archive_album = (row.get('label') or '').lower() == 'archive'
                    row['image_ids'] = self.get_album_images(entity_id, is_archive_album or include_archived)
        return results

    # -------- Cross-model helpers --------

    def is_exists(self, table: str, fields: Dict, exclude_id: str = None) -> str | None:
        return self.db.is_exists(table, fields, exclude_id)

    # -------- Images helpers --------
    def get_image_faces(self, image_id: str, include_archived: bool = False) -> List[str]:
        accessible_table = self.db._get_accessible_table_name('faces')
        results = self.db.execute_query(f'SELECT faceID FROM {accessible_table} WHERE imageID=?', (image_id,), include_archived)
        return [row[0] for row in results]
    
    def get_filtered_images(self, groups_ids: List[str], mode: str = 'and', only: bool = False, include_archived: bool = False) -> List[str]:
        if not groups_ids:
            return []

        group_placeholders = ','.join(['?'] * len(groups_ids))
        accessible_faces = self.db._get_accessible_table_name('faces')

        if mode == 'and':
            base_query = f'''
                SELECT imageID
                FROM {accessible_faces}
                WHERE groupID IN ({group_placeholders})
                GROUP BY imageID
                HAVING COUNT(DISTINCT groupID) = ?
            '''
            image_ids = [row[0] for row in self.db.execute_query(base_query, groups_ids + [len(groups_ids)], include_archived)]
        else:
            base_query = f'''
                SELECT DISTINCT imageID
                FROM {accessible_faces}
                WHERE groupID IN ({group_placeholders})
            '''
            image_ids = [row[0] for row in self.db.execute_query(base_query, groups_ids, include_archived)]

        if only and image_ids:
            image_placeholders = ','.join(['?'] * len(image_ids))
            images_with_other_groups_query = f'''
                SELECT DISTINCT imageID
                FROM {accessible_faces}
                WHERE imageID IN ({image_placeholders})
                AND groupID NOT IN ({group_placeholders})
            '''
            images_to_exclude = {row[0] for row in self.db.execute_query(
                images_with_other_groups_query, image_ids + groups_ids, include_archived
            )}
            image_ids = [img_id for img_id in image_ids if img_id not in images_to_exclude]

        return image_ids

    def get_related_groups(self, group_ids: List[str], mode: str = 'and', only: bool = False, include_archived: bool = False) -> List[str]:
        """Return related group IDs ordered by relevance using co-occurrence in images."""
        if not group_ids:
            return []

        group_id_placeholders = ','.join(['?'] * len(group_ids))

        if mode == 'or':
            accessible_groups = self.db._get_accessible_table_name('groups')
            accessible_faces = self.db._get_accessible_table_name('faces')
            query = f'''
                SELECT
                    g.groupID,
                    g.label,
                    COUNT(DISTINCT CASE WHEN f.imageID IN (SELECT DISTINCT imageID FROM {accessible_faces} WHERE groupID IN ({group_id_placeholders})) THEN f.imageID END) as common_images_count
                FROM {accessible_groups} g
                LEFT JOIN {accessible_faces} f ON g.groupID = f.groupID
                WHERE g.groupID NOT IN ({group_id_placeholders})
                GROUP BY g.groupID, g.label
                ORDER BY common_images_count DESC, g.label ASC
            '''
            query_params = group_ids + group_ids
            related_group_rows = self.db.execute_query(query, query_params, include_archived)
        else:
            base_image_ids = self.get_filtered_images(group_ids, 'and', False, include_archived)
            if not base_image_ids:
                related_group_rows = []
            else:
                image_placeholders = ','.join(['?'] * len(base_image_ids))
                accessible_groups = self.db._get_accessible_table_name('groups')
                accessible_faces = self.db._get_accessible_table_name('faces')
                query = f'''
                    SELECT
                        g.groupID,
                        g.label,
                        COUNT(DISTINCT f.imageID) AS common_images_count
                    FROM {accessible_groups} g
                    JOIN {accessible_faces} f ON g.groupID = f.groupID
                    WHERE f.imageID IN ({image_placeholders})
                    AND g.groupID NOT IN ({group_id_placeholders})
                    GROUP BY g.groupID, g.label
                    ORDER BY common_images_count DESC, g.label ASC
                '''
                query_params = base_image_ids + group_ids
                related_group_rows = self.db.execute_query(query, query_params, include_archived)

        ordered_group_ids = list(group_ids)
        for row in related_group_rows:
            ordered_group_ids.append(row[0])
        return ordered_group_ids

    # -------- Groups helpers --------
    def is_group_empty(self, group_id: str) -> bool:
        """Bypass profile access: check if group has zero faces (raw faces table)."""
        query = 'SELECT COUNT(*) FROM faces WHERE groupID=?'
        results = self.db.execute_query(query, (group_id,), include_archived=True)
        count = results[0][0] if results else 0
        return count == 0
        
    def get_group_faces(self, group_id: str, include_archived: bool = False) -> List[str]:
        accessible_table = self.db._get_accessible_table_name('faces')
        results = self.db.execute_query(f'SELECT faceID FROM {accessible_table} WHERE groupID=?', (group_id,), include_archived)
        return [row[0] for row in results]

    def get_group_images(self, group_id: str, include_archived: bool = False) -> List[str]:
        accessible_faces = self.db._get_accessible_table_name('faces')
        accessible_images = self.db._get_accessible_table_name('images')
        query = f'''
            SELECT DISTINCT i.imageID 
            FROM {accessible_images} i
            JOIN {accessible_faces} f ON i.imageID = f.imageID
            WHERE f.groupID = ?
        '''
        results = self.db.execute_query(query, (group_id,), include_archived)
        return [row[0] for row in results]

    def get_group_unique_face_per_image(self, group_id: str, include_archived: bool = False) -> Dict[str, str]:
        """For each image in the group, returns the first face that belongs to this group.
        Returns mapping image_id -> face_id."""
        accessible_table = self.db._get_accessible_table_name('faces')
        query = f'''
            SELECT DISTINCT f.imageID, f.faceID
            FROM {accessible_table} f
            WHERE f.groupID = ?
            GROUP BY f.imageID
        '''
        results = self.db.execute_query(query, (group_id,), include_archived)
        return {row[0]: row[1] for row in results}

    def get_group_faces_by_image(self, image_id: str, group_id: str, include_archived: bool = False) -> List[str]:
        """Return face IDs that belong to a specific group in a specific image."""
        accessible_table = self.db._get_accessible_table_name('faces')
        query = f'SELECT faceID FROM {accessible_table} WHERE imageID=? AND groupID=?'
        results = self.db.execute_query(query, (image_id, group_id), include_archived)
        return [row[0] for row in results]

    def add_faces_to_group(self, group_id: str, face_ids: List[str]) -> List[str]:
        if not face_ids or not group_id:
            return []

        # Move faces to the target group
        accessible_faces = self.db._get_accessible_table_name('faces')
        placeholders = ','.join(['?'] * len(face_ids))
        query = f"UPDATE {accessible_faces} SET groupID=? WHERE faceID IN ({placeholders})"
        updated_ids = self.db.execute_query(query, (group_id, *face_ids), include_archived=True)

        # Ensure target representative exists
        representative_face = self.get_one('groups', group_id, include_archived=True).get('representative_face')
        if not representative_face:
            target_group_faces = self.get_group_faces(group_id, include_archived=True)
            new_representative_face = self.get_biggest_face(target_group_faces, include_archived=True)
            if new_representative_face:
                self.edit('groups', group_id, {'representative_face': new_representative_face})

        # Update old groups representatives when needed
        # Find previous groups of the moved faces and their representatives
        accessible_groups = self.db._get_accessible_table_name('groups')
        query = f"""
        SELECT {accessible_faces}.groupID, {accessible_groups}.representative_face
        FROM {accessible_faces} INNER JOIN {accessible_groups}
        ON {accessible_faces}.groupID = {accessible_groups}.groupID AND {accessible_groups}.groupID != ?
        WHERE faceID IN ({placeholders})
        GROUP BY {accessible_groups}.groupID
        """
        old_groups_rows = self.db.execute_query(query, (group_id, *face_ids), include_archived=True)
        for old_group_id, old_representative_face in old_groups_rows:
            if old_representative_face in face_ids:
                new_representative_face = self.get_biggest_face(self.get_group_faces(old_group_id, include_archived=True), include_archived=True)
                if not new_representative_face:
                    new_representative_face = ''
                self.edit('groups', old_group_id, {'representative_face': new_representative_face}, include_archived=True)
        
        return updated_ids

    # -------- Faces helpers --------
    def get_image_faces_details(self, image_id: str, include_archived: bool = False, sort: bool = False) -> List[Dict]:
        """Return a list of face details for a given image, optionally sorted by group label."""
        accessible_faces = self.db._get_accessible_table_name('faces')
        accessible_groups = self.db._get_accessible_table_name('groups')

        query = f'''
            SELECT f.faceID, f.imageID, f.width, f.height, f.left, f.top, f.groupID,
                   g.label as group_label, g.representative_face as group_representative
            FROM {accessible_faces} f
            LEFT JOIN {accessible_groups} g ON f.groupID = g.groupID
            WHERE f.imageID = ?
        '''
        if sort:
            query += ' ORDER BY g.label ASC'

        results = self.db.execute_query(query, (image_id,), include_archived)
        
        # Manually construct dictionaries to match desired keys
        faces_data = []
        for row in results:
            face_data = {
                'face_id': row[0],
                'face_coords': {
                    'Left': row[4],
                    'Top': row[5],
                    'Width': row[2],
                    'Height': row[3]
                },
                'group_id': row[6],
                'group_label': row[7] if row[7] else 'Unknown',
                'group_representative': row[8]
            }
            faces_data.append(face_data)
            
        return faces_data

    def get_biggest_face(self, face_ids: List[str], include_archived: bool = False) -> str:
        if not face_ids:
            return ''
        accessible_table = self.db._get_accessible_table_name('faces')
        placeholders = ','.join(['?'] * len(face_ids))
        results = self.db.execute_query(f'SELECT faceID FROM {accessible_table} WHERE faceID IN ({placeholders}) ORDER BY width * height DESC LIMIT 1', (*face_ids,), include_archived)        
        return results[0][0]    

    def transfer_faces(
        self,
        old_group_id: str,
        face_ids: List[str],
        *,
        target_group_id: Optional[str] = None,
        new_group_name: Optional[str] = None,
        include_archived: bool = False,
    ) -> Dict:
        """Transfer faces to an existing/new group and update representatives as needed."""
        if not face_ids:
            return {'target_group_id': None, 'old_group_deleted': False}

        old_group = self.get_one('groups', old_group_id)
        if not old_group:
            raise ValueError(f"Source group {old_group_id} not found")

        accessible_table = self.db._get_accessible_table_name('faces')
        placeholders = ','.join(['?'] * len(face_ids))
        
        # Get all unique images affected by this transfer BEFORE making changes
        query = f'''
            SELECT DISTINCT imageID
            FROM {accessible_table}
            WHERE faceID IN ({placeholders}) AND groupID = ?
        '''
        original_affected_images = {row[0] for row in self.db.execute_query(query, (*face_ids, old_group_id), include_archived)}

        if not original_affected_images:
            return {
                'target_group_id': target_group_id,
                'old_group_deleted': False,
                'transferred_faces_ids': [],
                'images_to_remove_from_source': [],
                'images_to_add_to_target': [],
                'updated_source_group': old_group,
                'updated_target_group': self.get_one('groups', target_group_id) if target_group_id else None,
            }

        target_group_id_was_provided = target_group_id is not None
        if target_group_id:
            target_group = self.get_one('groups', target_group_id)
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

        target_group = self.get_one('groups', target_group_id, include_archived=True)
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
            if not self.get_group_faces_by_image(image_id, old_group_id, include_archived):
                images_to_remove_from_source.add(image_id)

        old_representative = old_group.get('representative_face', '')
        representative_transferred = old_representative in face_ids

        old_group_deleted = False
        if self.is_group_empty(old_group_id):
            self.delete('groups', old_group_id)
            old_group_deleted = True

        updated_source_group = None
        if not old_group_deleted:
            updated_source_group = self.get_one('groups', old_group_id, include_archived=True)

        updated_target_group = self.get_one('groups', target_group_id, include_archived=True)
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
            rows = self.db.execute_query(query, (*result['transferred_faces_ids'],), include_archived=True)
            for row in rows:
                transferred_image_ids.add(row[0])
        
        result['transferred_image_ids'] = list(original_affected_images)

        return result

    # -------- Moments helpers --------
    def get_moment_images(self, moment_id: str, include_archived: bool = False) -> List[str]:
        accessible_table = self.db._get_accessible_table_name('images')
        results = self.db.execute_query(f'SELECT imageID FROM {accessible_table} WHERE momentID=?', (moment_id,), include_archived)
        return [row[0] for row in results]

    def add_images_to_moment(self, moment_id: str, image_ids: List[str]) -> List[str]:
        if not image_ids:  # Guard against empty lists
            return []
        accessible_table = self.db._get_accessible_table_name('images')
        image_placeholders = ','.join(['?'] * len(image_ids))   
        query = f'UPDATE {accessible_table} SET momentID=? WHERE imageID IN ({image_placeholders})'
        updated_ids = self.db.execute_query(query, (moment_id, *image_ids), True)

        representative_image = self.get_one('moments', moment_id, True)['representative_image']
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
                remaining_images = self.get_moment_images(moment_id)
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
        current_representative_image = self.get_one('moments', moment_id, True)['representative_image']
        if current_representative_image and current_representative_image in image_ids:
            # Find a new representative image from remaining images
            remaining_images = self.get_moment_images(moment_id, True)
            new_representative_image = ''
            if remaining_images and len(remaining_images) > 0:
                new_representative_image = remaining_images[0]
            self.edit('moments', moment_id, {'representative_image': new_representative_image}, True)
        
        return updated_ids

    def get_image_albums(self, image_id: str, include_archived: bool = False, exclude_defaults: bool = True, sort: bool = False) -> List[Dict]:
        """Return list of albums the image belongs to, excluding default albums if requested.
        Each item: { 'albumID': str, 'label': str, 'representative_image': str }
        """
        accessible_albums = self.db._get_accessible_table_name('albums')
        accessible_album_images = self.db._get_accessible_table_name('album_images')

        query = f'''
            SELECT a.albumID, a.label, a.representative_image
            FROM {accessible_albums} a
            JOIN {accessible_album_images} ai ON a.albumID = ai.albumID
            WHERE ai.imageID = ?
        '''
        if sort:
            query += " ORDER BY CASE WHEN a.label IN ('Favorites', 'Archive') THEN 0 ELSE 1 END, a.label ASC"

        rows = self.db.execute_query(query, (image_id,), include_archived)

        results: List[Dict] = []
        for album_id, label, rep in rows:
            if exclude_defaults and (label or '').lower() in ('favorites', 'archive'):
                continue
            results.append({
                'albumID': album_id,
                'label': label or '',
                'representative_image': rep or ''
            })
        return results
    
    # -------- Albums helpers --------
    def get_album_images(self, album_id: str, include_archived: bool = False) -> List[str]:
        accessible_album_images = self.db._get_accessible_table_name('album_images')
        accessible_images = self.db._get_accessible_table_name('images')
        
        album = self.db.get_one('albums', {'albumID': album_id}, include_archived=True)
        # Always include archived images for the "archive" album, regardless of the parameter
        if album and 'label' in album and album['label'].lower() == 'archive':
            include_archived = True
            
        query = f'''
            SELECT ai.imageID
            FROM {accessible_album_images} ai
            JOIN {accessible_images} i ON ai.imageID = i.imageID
            WHERE ai.albumID = ?
        '''
        results = self.db.execute_query(query, (album_id,), include_archived)
        return [row[0] for row in results]

    def get_album_by_label(self, label: str) -> Dict | None:
        """Get album dict by its label (bypass access control to resolve ID, then verify accessibility)."""
        album = self.db.get_one('albums', {'label': label}, bypass_access_control=True, include_archived=True)
        if not album:
            return None
        # Verify accessibility using accessible view
        accessible = self.db.get_one('albums', {'albumID': album['albumID']}, include_archived=True)
        return accessible

    def add_images_to_album(self, album_id: str, image_ids: List[str]) -> Dict[str, Union[List[str], List[str]]]:
        """Add images to an album. Returns added image IDs and images that are now archived."""
        if not image_ids:
            return {'added_ids': [], 'archived_ids': []}
            
        already_in_album = self.get_album_images(album_id, include_archived=True)
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
        current_album = self.get_one('albums', album_id, include_archived=True)
        if current_album:
            rep = current_album.get('representative_image') or ''
            if rep and rep in image_ids:
                remaining = self.get_album_images(album_id, include_archived=True)
                new_rep = remaining[0] if remaining else ''
                self.edit('albums', album_id, {'representative_image': new_rep}, include_archived=True)

        return [pair[1] for pair in deleted_pairs]

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
