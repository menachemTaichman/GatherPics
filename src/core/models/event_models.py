from typing import List, Dict, Any
from src.core.database.db import DB, ReturnFormat
from src.core.models.base_models import BaseModels, ChildOperation
from src.core.errors import DBPolicyError, Forbidden
from datetime import datetime

class EventModels(BaseModels):

    def __init__(self, event_id: str, profile_id: str | None = None, public_code: str | None = None):
        self.db = DB(event_id=event_id, profile_id=profile_id, public_code=public_code)

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

    def ensure_representative(self, table: str, entity_id: str) -> str | None:
        """Ensure representative of a table.
        Args:
            table: table name
            entity_id: entity id
        Returns:
            representative id if found or set, None if not found
        """
        representative = self.db.STRUCTURE()[table].get('representative','')
        if not representative:
            return None

        representative_field = representative['field']
        representative_table = representative['table']

        id_field = self.db.get_id_field(table)
        relation, child, child_id_field, view_fields, relation_table_fields = self.db.get_relation(table, representative_table)

        query = f"""SELECT r.{child_id_field}
        FROM {relation} r
        INNER JOIN {table} t
        ON t.{id_field} = r.{id_field}
        WHERE r.{id_field} = %s
        AND t.{representative_field} = r.{child_id_field}
        """
        representative_id = self.db.execute_query(query, (entity_id, ), return_format=ReturnFormat.VALUE)
        if representative_id:
            return representative_id
        
        ctx_child = f'{child}_ctx'
        ctx_relation = f'{relation}_ctx'
        join_clause = ''
        parent = 'c'
        if relation != child:
            join_clause = f'INNER JOIN {ctx_relation} r ON c.{child_id_field} = r.{child_id_field}'
            parent = 'r'

        # Determine size fields based on child table type
        if child == 'faces':
            size_expr = 'c.face_width * c.face_height'
        else:
            # For images and other entities, use standard width/height
            size_expr = 'c.width * c.height'

        query = f"""SELECT c.{child_id_field}
        FROM {ctx_child} c
        {join_clause}
        WHERE {parent}.{id_field} = %s
        ORDER BY {size_expr} DESC
        LIMIT 1
        """
        biggest = self.db.execute_query(query, (entity_id,), return_format=ReturnFormat.VALUE)
        
        try:
            self.edit(table, entity_id, {representative_field: biggest})
        except DBPolicyError as e:
            return None
        
        return biggest

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

        valid_child_ids, detached_parents = super().edit_childs(parent, entity_id, child, child_ids, operation=operation, data=data)
        if self.db.STRUCTURE()[parent].get('representative',''):
            for parent_id in set(detached_parents.keys()).union([entity_id]):
                self.ensure_representative(parent, parent_id)

        return valid_child_ids, detached_parents

    # -------- events helpers --------
    def add_rekognition_calls(self, count: int):
        """Add rekognition calls to the event.
        Args:
            count: number of rekognition calls to add
        """
        if not self.db.event_profile_context['can_upload_and_delete_images']:
            raise Forbidden("Permission denied: cannot upload and delete images")
        
        event_data = self.get_entities('events', self.db.event_id, include_details=True)
        calls_limit = event_data['rekognition_calls_limit']
        calls_used = event_data['rekognition_calls_used']
        if calls_used + count > calls_limit:
            raise DBPolicyError("Policy error: cannot add more rekognition calls than the limit")

        query = f"""
            UPDATE events
            SET rekognition_calls_used = rekognition_calls_used + %s
            WHERE event_id = %s
        """
        self.db.execute_query(query, (count, self.db.event_id))
        
        # Track rekognition usage
        event_label = event_data.get('name', '')
        profile_id = self.db.profile_context.get('profile_id')
        profile_label = self.get_entities('current_profile', profile_id).get('label', '')
        self.add('rekognition_usaged', {
            'event_id': self.db.event_id,
            'event_label': event_label,
            'profile_id': profile_id,
            'profile_label': profile_label,
            'calls_count': count,
        })

    # -------- Moments helpers --------
    def get_images_to_moments(self) -> dict[str, Dict[str, Any]]:
        """Return images to moments.
        Returns:
            dict of all images with image ids as keys and images data (date_taken, moment_id, is_archived) as values
        """
        query = f"""
            SELECT i.image_id, i.date_taken, i.moment_id, i.is_archived
            FROM images_ext i
        """
        return self.db.execute_query(query, return_format=ReturnFormat.DICT_DICTS)

    def assign_moments_by_time(self, image_ids: list[str]) -> dict[str, list[str]]:
        """Assign images to moments based on their date_taken falling within moment time ranges.
        Args:
            image_ids: list of image ids to assign
        Returns:
            dict of moment ids as keys and list of assigned image ids as values
        """
        if not image_ids:
            return {}

        ctx_moments = 'moments_ctx'
        ctx_images = 'images_ctx'

        placeholders = ','.join('%s' for _ in image_ids)
        query = f"""
            WITH matched AS (
                SELECT i.image_id, m.moment_id
                FROM {ctx_images} AS i
                JOIN {ctx_moments} AS m
                ON i.date_taken BETWEEN m.start_date AND m.end_date
                WHERE i.image_id IN ({placeholders})
            )
            UPDATE {ctx_images}
            SET moment_id = (
                SELECT m.moment_id
                FROM matched AS m
                WHERE m.image_id = {ctx_images}.image_id
                LIMIT 1
            )
            WHERE image_id IN ({placeholders})
            AND moment_id IS NULL
        """

        params = image_ids + image_ids
        self.db.execute_query(query, params)

        result_query = f"""
            SELECT image_id, moment_id
            FROM {ctx_images}
            WHERE image_id IN ({placeholders})
            AND moment_id IS NOT NULL
        """
        rows = self.db.execute_query(result_query, image_ids, return_format=ReturnFormat.LIST_DICTS)

        assigned = {}
        for row in rows:
            assigned.setdefault(row['moment_id'], []).append(row['image_id'])

        for moment_id in assigned.keys():
            self.ensure_representative('moments', moment_id)

        return assigned

    def remove_images_from_moments(self, image_ids: list[str]) -> Dict:
        """Remove images from moments.
        Returns:
            dict:
                detached_moments: dict of detached moments with moment ids as keys and list of detached image ids as values
                updated_moments_uploads: dict of uploads with upload ids as keys and list of affected moment ids as values
        """

        affected_uploads_to_moments = {}
        query = f"""
            SELECT DISTINCT ai.upload_id, ai.moment_id
            FROM images_ctx ai
            WHERE ai.image_id IN ({','.join(['%s'] * len(image_ids))})
            AND ai.moment_id IS NOT NULL
        """
        result = self.db.execute_query(query, image_ids, return_format=ReturnFormat.LIST_TUPLES)
        for upload_id, moment_id in result:
            affected_uploads_to_moments.setdefault(upload_id, []).append(moment_id)

        valid_image_ids = list(self.get_entities('images', image_ids).keys())
        detached_moments = self.get_parents('images', valid_image_ids, 'moments')
        ctx_images = 'images_ctx'
        query = f"UPDATE {ctx_images} SET moment_id = NULL WHERE image_id IN ({','.join(['%s'] * len(valid_image_ids))})"
        self.db.execute_query(query, valid_image_ids)
        
        updated_uploads_to_moments = {}
        removed_uploads_to_moments = {}
        for upload_id, moments in affected_uploads_to_moments.items():
            updated_moments = self.get_childs('uploads', upload_id, 'moments', moments, return_ids=True)
            if updated_moments:
                updated_uploads_to_moments.setdefault(upload_id, []).extend(updated_moments)
            removed_moments = self.get_childs('uploads', upload_id, 'moments', moments, within=False, return_ids=True)
            if removed_moments:
                removed_uploads_to_moments.setdefault(upload_id, []).extend(removed_moments)


        return {
            'updated_image_ids': valid_image_ids,
            'detached_moments': detached_moments,
            'updated_moments_uploads': updated_uploads_to_moments,
            'removed_moments_uploads': removed_uploads_to_moments,
        }

    def edit_moment_images(self, moment_id: str, image_ids: List[str], operation: ChildOperation) -> Dict:
        """Add or remove images from a moment.
        Args:
            moment_id: target moment id
            image_ids: list of image ids
            operation: ADD or REMOVE
        Returns:
            dict:
                updated_image_ids: list of image ids that were affected
                detached_moments: dict of detached moments with moment ids as keys and list of detached image ids as values
                updated_moments_uploads: dict of uploads with upload ids as keys and list of affected moment ids as values
        """

        affected_uploads_to_moments = {}
        query = f"""
            SELECT DISTINCT ai.upload_id, ai.moment_id
            FROM images_ctx ai
            WHERE ai.image_id IN ({','.join(['%s'] * len(image_ids))})
            AND ai.moment_id IS NOT NULL
            AND ai.moment_id <> %s
        """
        result = self.db.execute_query(query, image_ids + [moment_id], return_format=ReturnFormat.LIST_TUPLES)
        for upload_id, affected_moment_id in result:
            affected_uploads_to_moments.setdefault(upload_id, []).append(affected_moment_id)

        updated_image_ids, detached_moments = self.edit_childs('moments', moment_id, child='images', child_ids=image_ids, operation=operation)
        
        updated_uploads_to_moments = {}
        removed_uploads_to_moments = {}
        uploads_to_images = self.get_parents('images', updated_image_ids, 'uploads')
        for upload_id in uploads_to_images.keys():
            updated_uploads_to_moments.setdefault(upload_id, []).append(moment_id)

        for upload_id, moments in affected_uploads_to_moments.items():
            updated_moments = self.get_childs('uploads', upload_id, 'moments', moments, return_ids=True)
            if updated_moments:
                updated_uploads_to_moments.setdefault(upload_id, []).extend(updated_moments)
            removed_moments = self.get_childs('uploads', upload_id, 'moments', moments, within=False, return_ids=True)
            if removed_moments:
                removed_uploads_to_moments.setdefault(upload_id, []).extend(removed_moments)

        return {
            'updated_image_ids': updated_image_ids,
            'detached_moments': detached_moments,
            'updated_moments_uploads': updated_uploads_to_moments,
            'removed_moments_uploads': removed_uploads_to_moments,
        }

    # -------- Images helpers --------
    def get_images_count(self) -> int:
        """Get the number of images in the event."""
        return self.db.execute_query('SELECT COUNT(*) FROM images WHERE event_id = %s', (self.db.event_id,), return_format=ReturnFormat.VALUE)

    # -------- Groups helpers --------
    def get_faces_group_in_image(self, group_id: str, image_ids: str | list[str]) -> list[str] | None:
        """Return the faces in image(s) from a group.
        Args:
            group_id: group id
            image_ids: single image id or list of image ids
        Returns:
            list of face ids if found, None if not found
        """
        ctx_faces = 'faces_ctx'        
        # Handle multiple images
        if not image_ids:
            return []
        
        if isinstance(image_ids, str):
            image_ids = [image_ids]

        image_placeholders = ','.join(['%s'] * len(image_ids))
        query = f"""
            SELECT f.face_id FROM {ctx_faces} f 
            WHERE f.image_id IN ({image_placeholders}) 
            AND f.group_id = %s
        """
        return self.db.execute_query(query, image_ids + [group_id], return_format=ReturnFormat.LIST_VALUES)

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

        group_id_placeholders = ','.join(['%s'] * len(group_ids))
        image_placeholders = ','.join(['%s'] * len(base_image_ids))
        ctx_groups = 'groups_ext'
        ctx_faces = 'faces_ctx'

        query = f'''
            SELECT g.group_id, g.label, g.images_count, g.active_images_count
            FROM {ctx_groups} g
            JOIN {ctx_faces} f ON g.group_id = f.group_id
            WHERE f.image_id IN ({image_placeholders})
            AND g.group_id NOT IN ({group_id_placeholders})
            GROUP BY g.group_id, g.label, g.images_count, g.active_images_count
            HAVING COUNT(f.face_id) > 0
            ORDER BY COUNT(DISTINCT f.image_id) DESC, g.label ASC
        '''
        query_params = base_image_ids + group_ids

        return self.db.execute_query(query, query_params, return_format=ReturnFormat.LIST_AND_DICT_DICTS)

    def add_faces_to_group(self, face_ids: List[str], target_group_id: str) -> Dict:
        """Add faces to a group.
        Args:
            face_ids: list of face ids
            target_group_id: target group id
        Returns:
            dict:
                detached_groups_images: dict of detached groups with group ids as keys and list of detached images ids as values
                detached_groups_faces: dict of detached groups with group ids as keys and list of detached face ids as values
                images_added: dict of images ids added with image ids as keys and dict of faces entities added to the imageas values
                faces_added: list of face ids added to target group
                deleted_group_ids: list of group ids that were deleted (based on accessibility)
        """
        affected_uploads_to_groups = {}
        query = f"""
            SELECT DISTINCT i.upload_id, f.group_id
            FROM uploads_faces_ctx ufc
            INNER JOIN faces f ON ufc.face_id = f.face_id
            INNER JOIN images i ON f.image_id = i.image_id
            WHERE ufc.face_id IN ({','.join(['%s'] * len(face_ids))})
            AND f.group_id <> %s
        """
        result = self.db.execute_query(query, face_ids + [target_group_id], return_format=ReturnFormat.LIST_TUPLES)
        for upload_id, group_id in result:
            affected_uploads_to_groups.setdefault(upload_id, []).append(group_id)

        faces_added, detached_groups_faces = self.edit_childs('groups', target_group_id, child='faces', child_ids=face_ids, operation=ChildOperation.ADD)

        # Track which groups were deleted based on accessibility
        deleted_group_ids = []
        unassociated_group_id = self.get_entities('events', self.db.event_id, include_details=True)['unassociated_group_id']
        for group_id, detached_faces in detached_groups_faces.items():
            if self.is_empty('groups', group_id, child='faces') and group_id != unassociated_group_id:
                self.delete('groups', group_id)
                deleted_group_ids.append(group_id)

        detached_groups_images = {}
        for group_id, detached_faces in detached_groups_faces.items():
            detached_images = []
            for detached_face in detached_faces:
                images = self.get_parents('faces', detached_face, 'images')
                detached_images.extend(self.get_childs('groups', group_id, 'images', images, within=False, return_ids=True))
            
            detached_groups_images[group_id] = list(set(detached_images))
                 
        images_added = list(set([self.get_entities('faces', face_id)['image_id'] for face_id in faces_added]))
        
        updated_uploads_to_groups = {}
        removed_uploads_to_groups = {}
        uploads_to_faces = self.get_parents('faces', faces_added, 'uploads')
        for upload_id in uploads_to_faces.keys():
            updated_uploads_to_groups.setdefault(upload_id, []).append(target_group_id)

        for upload_id, groups in affected_uploads_to_groups.items():
            updated_groups = self.get_childs('uploads', upload_id, 'groups', groups, return_ids=True)
            if updated_groups:
                updated_uploads_to_groups.setdefault(upload_id, []).extend(updated_groups)
            removed_groups = self.get_childs('uploads', upload_id, 'groups', groups, within=False, return_ids=True)
            if removed_groups:
                removed_uploads_to_groups.setdefault(upload_id, []).extend(removed_groups)

        result = {
            'detached_groups_images': detached_groups_images,
            'detached_groups_faces': detached_groups_faces,
            'images_added': images_added,
            'faces_added': faces_added,
            'deleted_group_ids': deleted_group_ids,
            'updated_groups_uploads': updated_uploads_to_groups,
            'removed_groups_uploads': removed_uploads_to_groups,
        }

        return result

    # -------- Profiles helpers --------
    def edit_accessibility(self, profile_id: str, entity: str, ids: List[str], set_accessible: bool = True) -> tuple[List[str], bool]:
        """Edit entities accessibility for a profile.
        Args:
            profile_id: profile id
            entity: 'images', 'albums', 'groups'
            ids: list of ids
            set_accessible: if True, set entities accessible to profile, if False, set entities inaccessible to profile
        Returns:
            list of affected ids, if added or removed
        """
        if entity not in ['images', 'albums', 'groups']:
            raise ValueError(f"Invalid entity: {entity}")
        _, profile = self.get_childs('events', self.db.event_id, 'profiles', [profile_id])
        if not profile:
            return []
        
        profile = profile[profile_id]

        add = set_accessible
        if bool(profile[f'all_{entity}']):
            add = not add

        operation = ChildOperation.ADD if add else ChildOperation.REMOVE
        valid_ids, _ = self.edit_childs('events_profiles_ctx', profile_id, child=entity, child_ids=ids, operation=operation)
        return valid_ids, add

    def toggle_access_request(self, access_request_id: str, approved_group_ids: list[str] | None = None, denied_group_ids: list[str] | None = None, closed_details: str | None = None):
        """
        Approve or deny an access request for groups.
        Args:
            access_request_id: access request id
            approved_group_ids: list of group ids to approve
            denied_group_ids: list of group ids to deny
            closed_details: details of the closed request to add to the closed details list
        """
        access_request = self.get_entities('access_requests', access_request_id)
        if not access_request:
            raise Forbidden(f"Access request not found for id {access_request_id}")
        
        edited = False
        for response, group_ids in {True: approved_group_ids, False: denied_group_ids}.items():
            if not group_ids:
                continue
            data = {'approved': response, 'closed_at': datetime.now()}
            self.edit_childs('access_requests', access_request_id, child='groups', child_ids=group_ids, operation=ChildOperation.UPDATE, data=data)
            edited = True

        if edited and (closed_details and closed_details != ''):
            query = f"""
                UPDATE access_requests SET
                closed_details = %s
                WHERE access_request_id = %s
            """
            closed_details = self.db.serialize_value(list, access_request['closed_details'] + [closed_details])
            self.db.execute_query(query, (closed_details, access_request_id))

    def check_accessibility(self, profile_id: str, entity: str, ids: list[str]) -> tuple[list[str], list[str]]:
        """Check accessibility of entities for a profile.
        Args:
            profile_id: profile id
            entity: 'images', 'albums', 'groups'
            ids: list of ids
        Returns:
            list of accessible ids, list of inaccessible ids
        """

        if entity not in ['images', 'albums', 'groups']:
            raise ValueError(f"Invalid entity: {entity}")

        if not self.is_accessible('events_profiles_ctx', profile_id):
            raise Forbidden("The profile is not accessible")

        id_field = self.db.get_id_field(entity)
        ctx_table = f'{entity}_ctx'
        query = f"""
            SELECT
                s.{id_field},
                s.is_accessible
                FROM {entity}_def s
                INNER JOIN {ctx_table} at ON s.{id_field} = at.{id_field}
                WHERE s.{id_field} IN ({','.join(['%s'] * len(ids))})
                AND s.profile_id = %s
        """
        result = self.db.execute_query(query, ids + [profile_id], return_format=ReturnFormat.LIST_TUPLES)
        if len(result) != len(ids):
            raise Forbidden("Some of the entities are not accessible")

        specify_accessible_ids = [id for id, is_accessible in result if is_accessible == True]
        specify_inaccessible_ids = [id for id, is_accessible in result if is_accessible == False]

        query = f"""
            SELECT
                a.{id_field},
                a.is_accessible
                FROM {entity}_eff a
                WHERE a.{id_field} IN ({','.join(['%s'] * len(ids))})
                AND a.event_id = cur_event_profile_uuid('event_id')
                AND a.profile_id = %s
        """
        result = self.db.execute_query(query, ids + [profile_id], return_format=ReturnFormat.LIST_TUPLES)

        actual_accessible_ids = [id for id, is_accessible in result if is_accessible == True]
        actual_inaccessible_ids = [id for id, is_accessible in result if is_accessible == False]

        return specify_accessible_ids, specify_inaccessible_ids, actual_accessible_ids, actual_inaccessible_ids

    def check_accessibility_status(self, profile_id: str, entity: str, ids: list[str]) -> tuple[int, int]:
        """Check accessibility status of entities for a profile.
        Args:
            profile_id: profile id
            entity: 'images', 'albums', 'groups'
            ids: list of ids
        Returns:
            specify status and actual status
            1 if all entities are accessible
            -1 if all entities are inaccessible
            0 if some entities are accessible and some are inaccessible
        """
        specify_accessible_ids, specify_inaccessible_ids, actual_accessible_ids, actual_inaccessible_ids = self.check_accessibility(profile_id, entity, ids)
        specify = 0
        if len(specify_accessible_ids) == len(ids):
            specify = 1
        elif len(specify_inaccessible_ids) == len(ids):
            specify = -1
        else:
            specify = 0
        actual = 0
        if len(actual_accessible_ids) == len(ids):
            actual = 1
        elif len(actual_inaccessible_ids) == len(ids):
            actual = -1
        else:
            actual = 0
        return specify, actual

    # -------- Access requests helpers --------
    def get_groups_to_request_access(self) -> list[str]:
        """Get groups to request access.
        Returns:
            list of group ids
        """
        query = f"""
            SELECT
                cgta.group_id,
                g.label,
                g.representative_face
            FROM groups_to_access_requests_ctx cgta
            INNER JOIN groups g ON cgta.group_id = g.group_id
        """
        return self.db.execute_query(query, return_format=ReturnFormat.LIST_DICTS)

    def is_group_to_request_access(self, group_id: str) -> bool:
        """Check if a group is to request access.
        Args:
            group_id: group id
        Returns:
            True if group is to request access, False if not
        """
        query = f"""
            SELECT * FROM groups_to_access_requests_ctx WHERE group_id = %s
        """
        return bool(self.db.execute_query(query, (group_id,), return_format=ReturnFormat.VALUE))

    def create_access_request(self, data: dict, group_ids: list[str]) -> str:
        """Create an access request.
        Args:
            data: dictionary with the access request data
            group_ids: list of group ids
        Returns:
            access request id
        """
        if not group_ids:
            raise ValueError("group_ids parameter is required")
        
        request_id = self.add('my_access_requests', data)

        # Set transaction context and insert groups in a single query
        values_clause = ','.join([f'(%s, %s)' for _ in range(len(group_ids))])
        values = ()
        for group_id in group_ids:
            values += (request_id, group_id)
        
        query = f"""
            SELECT set_transaction_context('temp_access_request_id', '{request_id}');
            INSERT INTO my_access_requests_groups_ctx
            (access_request_id, group_id)
            VALUES {values_clause};
        """
        self.db.execute_query(query, values)
        
        return request_id
