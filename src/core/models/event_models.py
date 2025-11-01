from typing import List, Dict, Any
from src.core.database.base_db import ReturnFormat
from src.core.models.base_models import BaseModels, ChildOperation
from src.core.database.event_db import EventDB
from src.core.errors import DBPolicyError
from src.core.config import DATA_ROOT
import os
import secrets
from datetime import datetime

class EventModels(BaseModels):

    def __init__(self, event_id: str, profile_id: str | None = None, public_code: str | None = None):
        db_path = os.path.join(DATA_ROOT, event_id, f'{event_id}.db')
        self.db = EventDB(db_path, profile_id, public_code)

    def get_current_profile(self) -> dict[str, Any]:
        """Get the current profile."""
        return self.db.execute_query('SELECT * FROM current_profile', return_format=ReturnFormat.DICT)

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
            raise ValueError(f"Representative not found")

        representative_field = representative['field']
        representative_table = representative['table']

        id_field = self.db.get_id_field(table)
        relation, child, child_id_field, view_fields, relation_table_fields = self.db.get_relation(table, representative_table)

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
        
        accessible_child = self.db.STRUCTURE()[child]['accessible_table']
        accessible_relation = self.db.STRUCTURE()[relation]['accessible_table']
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
        
        try:
            self.edit(table, entity_id, {representative_field: biggest})
        except DBPolicyError as e:
            return None
        
        return biggest

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

        valid_child_ids, detached_parents = super().edit_childs(parent, entity_id, child, child_ids, operation=operation, data=data)
        if self.db.STRUCTURE()[parent].get('representative',''):
            for parent_id in set(detached_parents.keys()).union([entity_id]):
                self.ensure_representative(parent, parent_id)

        return valid_child_ids, detached_parents

    # -------- Moments helpers --------
    def get_images_to_moments(self) -> dict[str, Dict[str, Any]]:
        """Return images to moments.
        Returns:
            dict of all images with image ids as keys and images data (date_taken, moment_id, is_archived) as values
        """
        accessible_images = self.db.STRUCTURE()['images']['accessible_table']
        query = f"""
            SELECT i.image_id, i.date_taken, i.moment_id, i.is_archived
            FROM {accessible_images} i
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

        accessible_moments = self.db.STRUCTURE()['moments']['accessible_table']
        accessible_images = self.db.STRUCTURE()['images']['accessible_table']

        placeholders = ','.join('?' for _ in image_ids)
        query = f"""
            WITH matched AS (
                SELECT i.image_id, m.moment_id
                FROM {accessible_images} AS i
                JOIN {accessible_moments} AS m
                ON i.date_taken BETWEEN m.start AND m.end
                WHERE i.image_id IN ({placeholders})
            )
            UPDATE {accessible_images}
            SET moment_id = (
                SELECT m.moment_id
                FROM matched AS m
                WHERE m.image_id = {accessible_images}.image_id
                LIMIT 1
            )
            WHERE image_id IN ({placeholders})
        """

        params = image_ids + image_ids
        self.db.execute_query(query, params)

        result_query = f"""
            SELECT image_id, moment_id
            FROM {accessible_images}
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
                removed_moments_uploads: dict of uploads with upload ids as keys and list of removed moment ids as values
        """
        valid_image_ids = list(self.get_entities('images', image_ids).keys())
        detached_moments = self.get_parents('images', valid_image_ids, 'moments')
        accessible_images = self.db.STRUCTURE()['images']['accessible_table']
        query = f'UPDATE {accessible_images} SET moment_id = NULL WHERE image_id IN ({','.join(['?'] * len(valid_image_ids))})'
        self.db.execute_query(query, valid_image_ids)
        
        # Track affected uploads
        updated_moments_uploads = {}
        removed_moments_uploads = {}
        for moment_id in detached_moments.keys():
            moment_uploads = self.get_parents('moments', moment_id, 'uploads')
            for upload_id in moment_uploads:
                _, upload_moment = self.get_childs('uploads', upload_id, 'moments', [moment_id])
                if not upload_moment:
                    removed_moments_uploads.setdefault(upload_id, []).append(moment_id)
                else:
                    updated_moments_uploads.setdefault(upload_id, []).append(moment_id)
        
        return {
            'detached_moments': detached_moments,
            'updated_moments_uploads': updated_moments_uploads,
            'removed_moments_uploads': removed_moments_uploads,
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
                removed_moments_uploads: dict of uploads with upload ids as keys and list of removed moment ids as values
        """
        affected_moments_uploads = {}
        for image_id in image_ids:
            upload_ids = self.get_parents('images', image_id, 'uploads')
            for upload_id in upload_ids:
                image_moment_ids = self.get_parents('images', image_id, 'moments')
                if image_moment_ids:
                    affected_moments_uploads.setdefault(upload_id, set()).add(image_moment_ids[0])

        updated_image_ids, detached_moments = self.edit_childs('moments', moment_id, child='images', child_ids=image_ids, operation=operation)
        
        # Track affected uploads
        updated_moments_uploads = {}
        removed_moments_uploads = {}
        
        for affected_moment_id in set(affected_moments_uploads.keys()):
            new_moment_uploads = set(self.get_parents('moments', affected_moment_id, 'uploads'))
            detached_uploads = affected_moments_uploads[affected_moment_id] - new_moment_uploads
            for upload_id in detached_uploads:
                removed_moments_uploads.setdefault(upload_id, []).append(affected_moment_id)
            for upload_id in new_moment_uploads:
                updated_moments_uploads.setdefault(upload_id, []).append(affected_moment_id)
        
        return {
            'updated_image_ids': updated_image_ids,
            'detached_moments': detached_moments,
            'updated_moments_uploads': updated_moments_uploads,
            'removed_moments_uploads': removed_moments_uploads,
        }

    # -------- Images helpers --------
    def get_images_count(self) -> int:
        """Get the number of images in the event."""
        return self.db.execute_query('SELECT COUNT(*) FROM images', return_format=ReturnFormat.VALUE)

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
    def get_last_group_num(self) -> int:
        """Get the last group number."""
        query = f"""
            SELECT MAX(CAST(SUBSTR(label, 8) AS INTEGER)) AS last_group_num
            FROM groups
            WHERE label LIKE 'Person %'
            AND SUBSTR(label, 8) GLOB '[0-9]*'
        """

        return self.db.execute_query(query, return_format=ReturnFormat.VALUE)

    def get_unassociated_group(self) -> str | None:
        """Get the unassociated group id."""
        return self.db.execute_query('SELECT group_id FROM accessible_groups WHERE LOWER(label) = "unassociated"', return_format=ReturnFormat.VALUE)

    def get_faces_group_in_image(self, group_id: str, image_ids: str | list[str]) -> list[str] | None:
        """Return the faces in image(s) from a group.
        Args:
            group_id: group id
            image_ids: single image id or list of image ids
        Returns:
            list of face ids if found, None if not found
        """
        accessible_faces = self.db.STRUCTURE()['faces']['accessible_table']        
        # Handle multiple images
        if not image_ids:
            return []
        
        if isinstance(image_ids, str):
            image_ids = [image_ids]

        image_placeholders = ','.join(['?'] * len(image_ids))
        query = f"""
            SELECT f.face_id FROM {accessible_faces} f 
            WHERE f.image_id IN ({image_placeholders}) 
            AND f.group_id = ?
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

        group_id_placeholders = ','.join(['?'] * len(group_ids))
        image_placeholders = ','.join(['?'] * len(base_image_ids))
        accessible_groups = self.db.STRUCTURE()['groups']['accessible_table']
        accessible_faces = self.db.STRUCTURE()['faces']['accessible_table']

        query = f'''
            SELECT g.group_id, g.label, g.images_count, g.active_images_count
            FROM {accessible_groups} g
            JOIN {accessible_faces} f ON g.group_id = f.group_id
            WHERE f.image_id IN ({image_placeholders})
            AND g.group_id NOT IN ({group_id_placeholders})
            GROUP BY g.group_id, g.label
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
        faces_added, detached_groups_faces = self.edit_childs('groups', target_group_id, child='faces', child_ids=face_ids, operation=ChildOperation.ADD)

        # Track which groups were deleted based on accessibility
        deleted_group_ids = []
        for group_id, detached_faces in detached_groups_faces.items():
            if self.is_empty('groups', group_id, child='faces') and group_id != self.get_unassociated_group():
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
        
        updated_groups_uploads = {}
        removed_groups_uploads = {}
        for group_id in set(detached_groups_faces.keys()) | {target_group_id}:
            group_uploads = self.get_parents('groups', group_id, 'uploads')
            for upload_id in group_uploads:
                _, upload_group = self.get_childs('uploads', upload_id, 'groups', [group_id])
                if not upload_group:
                    removed_groups_uploads.setdefault(upload_id, []).append(group_id)
                else:
                    updated_groups_uploads.setdefault(upload_id, []).append(group_id)

        result = {
            'detached_groups_images': detached_groups_images,
            'detached_groups_faces': detached_groups_faces,
            'images_added': images_added,
            'faces_added': faces_added,
            'deleted_group_ids': deleted_group_ids,
            'updated_groups_uploads': updated_groups_uploads,
            'removed_groups_uploads': removed_groups_uploads,
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
    def sync_profile_to_event_db(self, profile_id: str, upsert: bool = True, label: str | None = None, hierarchy_rank: int = 0) -> None:
        """Sync profile to event db."""
        if upsert:
            query = f"""
                INSERT INTO profiles (profile_id, label, hierarchy_rank) VALUES (?, ?, ?)
                ON CONFLICT (profile_id) DO UPDATE SET label = ?, hierarchy_rank = ?
            """
            self.db.execute_query(query, (profile_id, label, hierarchy_rank, label, hierarchy_rank))
        else:
            query = f"""
                DELETE FROM profiles WHERE profile_id = ?
            """
            self.db.execute_query(query, (profile_id,))
            self.delete('profiles', profile_id)

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
        profile = self.get_entities('profiles', profile_id)
        if not profile:
            return []

        add = set_accessible
        if bool(profile[f'all_{entity}']):
            add = not add

        operation = ChildOperation.ADD if add else ChildOperation.REMOVE
        valid_ids, _ = self.edit_childs('profiles', profile_id, child=entity, child_ids=ids, operation=operation)
        return valid_ids, add

    def get_access_request_managers(self, access_request_id: str, exclude_ids: list[str] = None) -> list[str]:
        """
        Get the managers of an access request.
        Args:
            access_request_id: access request id
            exclude_ids: list of profile ids to exclude
        Returns:
            list of manager profile ids
        """
        query = f"""
            SELECT p.profile_id
            FROM profiles p
            WHERE EXISTS (
                SELECT 1
                FROM access_requests_groups aar
                LEFT JOIN profile_groups pg
                ON pg.profile_id = p.profile_id
                AND pg.group_id = aar.group_id
                WHERE aar.access_request_id = ?
                AND (
                    (p.all_groups = 1 AND pg.group_id IS NULL)
                    OR (p.all_groups = 0 AND pg.group_id IS NOT NULL)
                )
            )
        """
        params = [access_request_id]
        if exclude_ids:
            query += f"""
                AND p.profile_id NOT IN ({','.join(['?'] * len(exclude_ids))})
            """
            params.extend(exclude_ids)
        return self.db.execute_query(query, params, return_format=ReturnFormat.LIST_VALUES)

    def toggle_access_request(
        self,
        access_request_id: str,
        approved_group_ids: list[str] | None = None,
        denied_group_ids: list[str] | None = None,
        closed_details: str | None = None,
        applicant_profile_id: str | None = None
    ) -> str | None:
        """
        Approve or deny an access request for groups.
        Args:
            access_request_id: access request id
            approved_group_ids: list of group ids to approve
            denied_group_ids: list of group ids to deny
            closed_details: details of the closed request to add to the closed details list
            applicant_profile_id: applicant profile id, if None, use the existing applicant profile id
        Returns:
            applicant profile id if the request was not completely rejected, None otherwise
        """
        if applicant_profile_id:
            self.edit('access_requests', access_request_id, {'applicant_profile_id': applicant_profile_id})
        access_request = self.get_entities('access_requests', access_request_id)
        if not access_request:
            raise ValueError(f"Access request not found for id {access_request_id}")
        applicant_profile_id = access_request['applicant_profile_id']
        if approved_group_ids and not applicant_profile_id:
            raise ValueError(f"Applicant profile id not found for access request {access_request_id}")            
        
        request_groups = self.get_childs('access_requests', access_request_id, 'groups', return_ids=True)
        accessible_groups = [group_id for group_id, group in self.get_entities('groups', request_groups).items() if group['is_accessible']]

        edited = False
        for response, group_ids in {1: approved_group_ids, 0: denied_group_ids}.items():
            group_ids = list(set(group_ids) & set(accessible_groups) & set(request_groups))
            if not group_ids:
                continue
            data = {'approved': response, 'closed_at': datetime.now()}
            self.edit_childs('access_requests', access_request_id, child='groups', child_ids=group_ids, operation=ChildOperation.UPDATE, data=data)
            edited = True

        if edited and (closed_details and closed_details != ''):
            query = f"""
                UPDATE access_requests SET
                closed_details = ?
                WHERE access_request_id = ?
            """
            closed_details = self.db.serialize_value(list, access_request['closed_details'] + [closed_details])
            self.db.execute_query(query, (closed_details, access_request_id))

        return applicant_profile_id

    # -------- Public Access Code helpers --------
    def generate_public_access_code(self, profile_id: str) -> str:
        """Generate a 12-character public access code for a profile."""
        
        # Generate a 12-character code
        code = secrets.token_urlsafe(9)[:12]  # Remove padding chars, take first 12
        
        # Ensure uniqueness
        while self.db.execute_query('SELECT 1 FROM profiles WHERE public_access_code = ?', (code,), return_format=ReturnFormat.VALUE):
            code = secrets.token_urlsafe(9)[:12]
        
        # Update profile with the code
        self.edit('profiles', profile_id, {'public_access_code': code})
        return self.get_entities('profiles', profile_id)['public_access_code']

    def revoke_public_access_code(self, profile_id: str):
        """Revoke public access code for a profile."""
        self.edit('profiles', profile_id, {'public_access_code': None})
    