from typing import List, Dict, Optional
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

    def add(self, table: str, data_list: List[Dict]) -> List[Dict] | None:
        for data in data_list:
            if self.id_field(table) not in data:
                data[self.id_field(table)] = self.generate_id()
        return self.db.insert(table, data_list)

    def delete(self, table: str, entity_id: str):
        self.db.delete(table, {self.id_field(table): entity_id})

    def edit(self, table: str, entity_id: str, fields: Dict) -> Dict | None:
        self.db.update(table, {self.id_field(table): entity_id}, fields)
        return self.get_one(table, entity_id)

    def get_one(self, table: str, entity_id: str) -> Dict | None:
        entity = self.db.get_one(table, {self.id_field(table): entity_id})
        if table == 'groups':
            entity['image_ids'] = self.get_group_images(entity_id)
        elif table == 'moments':
            entity['image_ids'] = self.get_moment_images(entity_id)
        return entity if entity else None

    def get_all(self, table: str) -> List[Dict]:
        results = self.db.get_all(table)
        if table == 'groups':
            for result in results:
                result['image_ids'] = self.get_group_images(result['groupID'])
            return results
        elif table == 'moments':
            for result in results:
                result['image_ids'] = self.get_moment_images(result['momentID'])
            return results
        return results

    # -------- Cross-model helpers --------

    def is_exists(self, table: str, fields: Dict, exclude_id: str = None) -> str | None:
        return self.db.is_exists(table, fields, exclude_id)

    # -------- Images helpers --------
    def get_image_faces(self, image_id: str) -> List[str]:
        accessible_table = self.db._get_accessible_table_name('faces')
        results = self.db.execute_query(f'SELECT faceID FROM {accessible_table} WHERE imageID=?', (image_id,))
        return [row[0] for row in results]
    
    def get_filtered_images(self, groups_ids: List[str], mode: str = 'and', only: bool = False) -> List[str]:
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
            image_ids = [row[0] for row in self.db.execute_query(base_query, groups_ids + [len(groups_ids)])]
        else:
            base_query = f'''
                SELECT DISTINCT imageID
                FROM {accessible_faces}
                WHERE groupID IN ({group_placeholders})
            '''
            image_ids = [row[0] for row in self.db.execute_query(base_query, groups_ids)]

        if only and image_ids:
            image_placeholders = ','.join(['?'] * len(image_ids))
            images_with_other_groups_query = f'''
                SELECT DISTINCT imageID
                FROM {accessible_faces}
                WHERE imageID IN ({image_placeholders})
                AND groupID NOT IN ({group_placeholders})
            '''
            images_to_exclude = {row[0] for row in self.db.execute_query(
                images_with_other_groups_query, image_ids + groups_ids
            )}
            image_ids = [img_id for img_id in image_ids if img_id not in images_to_exclude]

        return image_ids

    def get_related_groups(self, group_ids: List[str], mode: str = 'and', only: bool = False) -> List[str]:
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
            related_group_rows = self.db.execute_query(query, query_params)
        else:
            base_image_ids = self.get_filtered_images(group_ids, 'and', False)
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
                related_group_rows = self.db.execute_query(query, query_params)

        ordered_group_ids = list(group_ids)
        for row in related_group_rows:
            ordered_group_ids.append(row[0])
        return ordered_group_ids

    # -------- Groups helpers --------
    def is_group_empty(self, group_id: str) -> bool:
        """Bypass profile access: check if group has zero faces (raw faces table)."""
        query = 'SELECT COUNT(*) FROM faces WHERE groupID=?'
        results = self.db.execute_query(query, (group_id,))
        count = results[0][0] if results else 0
        return count == 0
        
    def get_group_faces(self, group_id: str) -> List[str]:
        accessible_table = self.db._get_accessible_table_name('faces')
        results = self.db.execute_query(f'SELECT faceID FROM {accessible_table} WHERE groupID=?', (group_id,))
        return [row[0] for row in results]

    def get_group_images(self, group_id: str) -> List[str]:
        accessible_faces = self.db._get_accessible_table_name('faces')
        query = f'''
            SELECT DISTINCT f.imageID 
            FROM {accessible_faces} f 
            WHERE f.groupID = ?
        '''
        results = self.db.execute_query(query, (group_id,))
        return [row[0] for row in results]

    def get_group_unique_face_per_image(self, group_id: str) -> Dict[str, str]:
        """For each image in the group, returns the first face that belongs to this group.
        Returns mapping image_id -> face_id."""
        accessible_table = self.db._get_accessible_table_name('faces')
        query = f'''
            SELECT DISTINCT f.imageID, f.faceID
            FROM {accessible_table} f
            WHERE f.groupID = ?
            GROUP BY f.imageID
        '''
        results = self.db.execute_query(query, (group_id,))
        return {row[0]: row[1] for row in results}

    def get_group_faces_by_image(self, image_id: str, group_id: str) -> List[str]:
        """Return face IDs that belong to a specific group in a specific image."""
        accessible_table = self.db._get_accessible_table_name('faces')
        query = f'SELECT faceID FROM {accessible_table} WHERE imageID=? AND groupID=?'
        results = self.db.execute_query(query, (image_id, group_id))
        return [row[0] for row in results]

    def add_faces_to_group(self, group_id: str, face_ids: List[str]) -> None:
        if not face_ids or not group_id:
            return

        # Move faces to the target group
        accessible_faces = self.db._get_accessible_table_name('faces')
        placeholders = ','.join(['?'] * len(face_ids))
        query = f"UPDATE {accessible_faces} SET groupID=? WHERE faceID IN ({placeholders})"
        self.db.execute_query(query, (group_id, *face_ids))

        # Ensure target representative exists
        representative_face = self.get_one('groups', group_id).get('representative_face')
        if not representative_face:
            target_group_faces = self.get_group_faces(group_id)
            new_representative_face = self.get_biggest_face(target_group_faces)
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
        old_groups_rows = self.db.execute_query(query, (group_id, *face_ids))
        for old_group_id, old_representative_face in old_groups_rows:
            if old_representative_face in face_ids:
                new_representative_face = self.get_biggest_face(self.get_group_faces(old_group_id))
                if not new_representative_face:
                    new_representative_face = ''
                self.edit('groups', old_group_id, {'representative_face': new_representative_face})

    # -------- Faces helpers --------
    def get_biggest_face(self, face_ids: List[str]) -> str:
        if not face_ids:
            return ''
        accessible_table = self.db._get_accessible_table_name('faces')
        placeholders = ','.join(['?'] * len(face_ids))
        results = self.db.execute_query(f'SELECT faceID FROM {accessible_table} WHERE faceID IN ({placeholders}) ORDER BY width * height DESC LIMIT 1', (*face_ids,))        
        return results[0][0]    

    def transfer_faces(
        self,
        old_group_id: str,
        face_ids: List[str],
        *,
        target_group_id: Optional[str] = None,
        new_group_name: Optional[str] = None,
    ) -> Dict:
        """Transfer faces to an existing/new group and update representatives as needed."""
        if not face_ids:
            return {'target_group_id': None, 'old_group_deleted': False}

        old_group = self.get_one('groups', old_group_id)
        if not old_group:
            raise ValueError(f"Source group {old_group_id} not found")

        accessible_table = self.db._get_accessible_table_name('faces')
        placeholders = ','.join(['?'] * len(face_ids))
        query = f'''
            SELECT DISTINCT imageID
            FROM {accessible_table}
            WHERE faceID IN ({placeholders}) AND groupID = ?
        '''
        images_to_add_to_target = set()
        results = self.db.execute_query(query, (*face_ids, old_group_id))
        for row in results:
            images_to_add_to_target.add(row[0])

        if not images_to_add_to_target:
            return {
                'target_group_id': target_group_id,
                'old_group_deleted': False,
                'transferred_faces': face_ids,
                'images_to_remove_from_source': [],
                'images_to_add_to_target': [],
                'updated_source_group': None,
                'updated_target_group': None,
                'representatives': {
                    'source_before': old_group.get('representative_face', ''),
                    'source_after': '',
                    'target_before': '',
                    'target_after': '',
                }
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
            created = self.add('groups', [{
                'label': new_group_name,
                'representative_face': ''
            }])
            target_group_id = created[0]['groupID'] if created else None

        target_group = self.get_one('groups', target_group_id)
        target_representative_before = target_group.get('representative_face') if target_group else ''
        if target_group and 'image_ids' in target_group:
            existing_target_images = set(target_group['image_ids'])
            images_to_add_to_target = images_to_add_to_target - existing_target_images

        self.add_faces_to_group(target_group_id, face_ids)

        images_to_remove_from_source = set()
        for image_id in images_to_add_to_target:
            if not self.get_group_faces_by_image(image_id, old_group_id):
                images_to_remove_from_source.add(image_id)

        old_representative = old_group.get('representative_face', '')
        representative_transferred = old_representative in face_ids

        old_group_deleted = False
        if self.is_group_empty(old_group_id):
            self.delete('groups', old_group_id)
            old_group_deleted = True

        updated_source_group = None
        if not old_group_deleted:
            updated_source_group = self.get_one('groups', old_group_id)

        updated_target_group = self.get_one('groups', target_group_id)
        target_representative_after = updated_target_group.get('representative_face') if updated_target_group else ''

        result = {
            'target_group_id': target_group_id,
            'old_group_deleted': old_group_deleted,
            'transferred_faces': face_ids,
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

        return result

    # -------- Moments helpers --------
    def get_moment_images(self, moment_id: str) -> List[str]:
        accessible_table = self.db._get_accessible_table_name('images')
        results = self.db.execute_query(f'SELECT imageID FROM {accessible_table} WHERE momentID=?', (moment_id,))
        return [row[0] for row in results]

    def add_images_to_moment(self, moment_id: str, image_ids: List[str]) -> None:
        if not image_ids:  # Guard against empty lists
            return
        accessible_table = self.db._get_accessible_table_name('images')
        image_placeholders = ','.join(['?'] * len(image_ids))   
        query = f'UPDATE {accessible_table} SET momentID=? WHERE imageID IN ({image_placeholders})'
        self.db.execute_query(query, (moment_id, *image_ids))

        representative_image = self.get_one('moments', moment_id)['representative_image']
        new_representative_image = ''
        if len(image_ids) > 0:
            new_representative_image = image_ids[0]
        # Set the first image ID as representative image if none exists
        if (representative_image == '' or representative_image is None) and new_representative_image:
            self.edit('moments', moment_id, {'representative_image': new_representative_image})

        accessible_table = self.db._get_accessible_table_name('moments')
        old_moments = self.db.execute_query(f'SELECT DISTINCT momentID, representative_image FROM {accessible_table} WHERE momentID != ? AND representative_image IN ({image_placeholders})', (moment_id, *image_ids))
        for moment_id, old_representative_image in old_moments:
            if old_representative_image in image_ids:
                remaining_images = self.get_moment_images(moment_id)
                if len(remaining_images) > 0:
                    new_representative_image = remaining_images[0]
                else:
                    new_representative_image = ''
                self.edit('moments', moment_id, {'representative_image': new_representative_image})

    def remove_images_from_moment(self, moment_id: str, image_ids: List[str]) -> None:
        if not image_ids:  # Guard against empty lists
            return
        accessible_table = self.db._get_accessible_table_name('images')
        image_placeholders = ','.join(['?'] * len(image_ids))
        query = f'UPDATE {accessible_table} SET momentID=NULL WHERE imageID IN ({image_placeholders}) AND momentID=?'
        self.db.execute_query(query, (*image_ids, moment_id))

        # Check if the current representative image is being removed
        current_representative_image = self.get_one('moments', moment_id)['representative_image']
        if current_representative_image and current_representative_image in image_ids:
            # Find a new representative image from remaining images
            remaining_images = self.get_moment_images(moment_id)
            new_representative_image = ''
            if remaining_images and len(remaining_images) > 0:
                new_representative_image = remaining_images[0]
            self.edit('moments', moment_id, {'representative_image': new_representative_image})
    
    # -------- Profiles helpers --------
    def add_accessible_images(self, profile_id: str, image_ids: List[str]):
        if not image_ids:
            return
        to_insert = [
            {'profileID': profile_id, 'imageID': image_id, 'accessible': 1}
            for image_id in image_ids
        ]
        self.db.insert('editable_profile_images', to_insert)

    def remove_accessible_images(self, profile_id: str, image_ids: List[str]):
        if not image_ids:
            return
        for image_id in image_ids:
            self.db.delete('editable_profile_images', {'profileID': profile_id, 'imageID': image_id})

    def add_accessible_albums(self, profile_id: str, album_ids: List[str]):
        if not album_ids:
            return
        to_insert = [
            {'profileID': profile_id, 'albumID': album_id, 'accessible': 1}
            for album_id in album_ids
        ]
        self.db.insert('editable_profile_albums', to_insert)

    def remove_accessible_albums(self, profile_id: str, album_ids: List[str]):
        if not album_ids:
            return
        for album_id in album_ids:
            self.db.delete('editable_profile_albums', {'profileID': profile_id, 'albumID': album_id})
