from typing import List, Dict, Any
from .base_db import ReturnFormat
from .base_models import BaseModels
from .event_db import EventDB
from .errors import DBConstant
import os

DATA_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../data'))

class EventModels(BaseModels):

    def __init__(self, event_id: str, profile_id: str):
        db_path = os.path.join(DATA_ROOT, event_id, f'{event_id}.db')
        self.db = EventDB(db_path, profile_id)

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
        relation, child, child_id_field, view_fields = self.db.get_relation(table, representative_table)

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
        except DBConstant as e:
            return None
        
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

        valid_child_ids, detached_parents = super().edit_childs(parent, entity_id, child, child_ids, add=add)
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
        return assigned

    def remove_images_from_moments(self, image_ids: list[str]) -> dict[str, list[str]]:
        """Remove images from a moment."""
        valid_image_ids = list(self.get_entities('images', image_ids).keys())
        detached_moments = self.get_parents('images', valid_image_ids, 'moments')
        accessible_images = self.db.STRUCTURE()['images']['accessible_table']
        query = f'UPDATE {accessible_images} SET moment_id = NULL WHERE image_id IN ({','.join(['?'] * len(valid_image_ids))})'
        self.db.execute_query(query, valid_image_ids)
        return detached_moments

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

    def get_faces_mapping(self, group_id: str) -> dict[str, str]:
        """Return faces mapping for between images and faces in a group.
        Args:
            group_id: group id
        Returns:
            dict of faces mapping with image ids as keys and face id as value
        """
        accessible_groups_images = self.db.STRUCTURE()['groups_images']['accessible_table']
        accessible_faces = self.db.STRUCTURE()['faces']['accessible_table']
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
        accessible_faces = self.db.STRUCTURE()['faces']['accessible_table']
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
        accessible_groups = self.db.STRUCTURE()['groups']['accessible_table']
        accessible_faces = self.db.STRUCTURE()['faces']['accessible_table']

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

        accessible_faces = self.db.STRUCTURE()['faces']['accessible_table']
        accessible_images = self.db.STRUCTURE()['images']['accessible_table']

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
            if source_group_id != self.get_unassociated_group():
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

    # -------- Uploads helpers --------
    def get_uploads_groups_faces(self, upload_id: str, group_id: str, within: bool = True) -> dict[str, Any]:
        """Get faces in a group that are from this upload (within=True) or not from this upload (within=False)."""
        where_clause = 'ai.upload_id = ?' if within else 'ai.upload_id <> ? OR ai.upload_id IS NULL'
        query = f"""
            SELECT
                af.face_id,
                af.image_id,
                af.group_id
            FROM accessible_faces af
            INNER JOIN accessible_images ai ON af.image_id = ai.image_id
            WHERE af.group_id = ? AND ({where_clause})
        """
        return self.db.execute_query(query, (group_id, upload_id), return_format=ReturnFormat.DICT_DICTS)

    def get_uploads_moments_images(self, upload_id: str, moment_id: str) -> dict[str, Any]:
        """Get uploads moments images (only images from this upload)."""
        query = f"""
            SELECT
                ai.image_id,
                ai.date_taken
            FROM accessible_uploads_moments aum
            INNER JOIN accessible_images ai ON aum.moment_id = ai.moment_id
            WHERE aum.upload_id = ? AND aum.moment_id = ? AND ai.upload_id = ?
        """
        return self.db.execute_query(query, (upload_id, moment_id, upload_id), return_format=ReturnFormat.DICT_DICTS)

    # -------- Profiles helpers --------
    def sync_profile_to_event_db(self, profile_id: str, upsert: bool = True, hierarchy_rank: int = 0) -> None:
        """Sync profile to event db."""
        if upsert:
            query = f"""
                INSERT INTO profiles (profile_id, hierarchy_rank) VALUES (?, ?)
                ON CONFLICT (profile_id) DO UPDATE SET hierarchy_rank = ?
            """
            self.db.execute_query(query, (profile_id, hierarchy_rank, hierarchy_rank))
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

        if bool(profile[f'all_{entity}']):
            set_accessible = not set_accessible

        valid_ids, _ = self.edit_childs('profiles', profile_id, child=entity, child_ids=ids, add=set_accessible)
        return valid_ids, set_accessible
