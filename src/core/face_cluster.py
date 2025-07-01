import boto3
import json
import os
import uuid

class FaceClusterAWS:
    def __init__(self, config,
                 images_json_path='src/data/images.json',
                 groups_json_path='src/data/groups.json',
                 faces_json_path='src/data/faces.json'):
        self.images = []
        self.groups = []
        self.faces = []
        self.image_name_to_id = {}
        self.group_id_counter = 0
        self.face_id_counter = 0
        self.rekognition = boto3.client('rekognition',
                                        aws_access_key_id=config['aws_access_key_id'],
                                        aws_secret_access_key=config['aws_secret_access_key'],
                                        region_name=config['region'])
        self.collection_id = config.get('collection_id', 'my_face_collection')
        self.images_json_path = images_json_path
        self.groups_json_path = groups_json_path
        self.faces_json_path = faces_json_path
        self._create_collection_if_not_exists()

    def _create_collection_if_not_exists(self):
        existing = self.rekognition.list_collections()['CollectionIds']
        if self.collection_id not in existing:
            print(f"Creating collection {self.collection_id}")
            self.rekognition.create_collection(CollectionId=self.collection_id)

    def index_faces(self, image_bytes, external_image_id):
        try:
            response = self.rekognition.index_faces(
                CollectionId=self.collection_id,
                Image={'Bytes': image_bytes},
                ExternalImageId=external_image_id,
                DetectionAttributes=['DEFAULT']
            )
            return response['FaceRecords']
        except Exception as e:
            print(f"Error indexing face for {external_image_id}: {e}")
            return []

    def search_similar_faces(self, face_id, threshold=90, max_faces=10):
        try:
            response = self.rekognition.search_faces(
                CollectionId=self.collection_id,
                FaceId=face_id,
                FaceMatchThreshold=threshold,
                MaxFaces=max_faces
            )
            return response.get('FaceMatches', [])
        except Exception as e:
            print(f"Error searching similar faces for FaceId {face_id}: {e}")
            return []

    def clear_collection(self):
        response = self.rekognition.list_faces(CollectionId=self.collection_id)
        face_ids = [face['FaceId'] for face in response['Faces']]
        if face_ids:
            self.rekognition.delete_faces(CollectionId=self.collection_id, FaceIds=face_ids)

    def add_image(self, image_name):
        if image_name not in self.image_name_to_id:
            image_id = f"img_{len(self.images)+1:03d}"
            self.image_name_to_id[image_name] = image_id
            self.images.append({
                "imageID": image_id,
                "name": image_name
            })
        return self.image_name_to_id[image_name]

    def add_group(self, label, representative_image_id, representative_face_id, face_ids):
        group = {
            "groupID": self.group_id_counter,
            "name": label,
            "representative_imageID": representative_image_id,
            "representative_faceID": representative_face_id,
            "faceIDs": face_ids
        }
        self.groups.append(group)
        self.group_id_counter += 1
        return group["groupID"]

    def add_face(self, image_id, group_id, crop_filename, width, height, left, top, face_id=None):
        if face_id is None:
            face_id = f"face_{self.face_id_counter:05d}"
            self.face_id_counter += 1
        # If face_id is provided, don't increment counter (it's managed externally)
        
        face_record = {
            "faceID": face_id,
            "imageID": image_id,
            "groupID": group_id,
            "crop_filename": crop_filename,
            "width": width,
            "height": height,
            "left": left,
            "top": top
        }
        self.faces.append(face_record)
        return face_id

    def merge_groups(self, group_id_1, group_id_2):
        """
        Merge two groups into one. The first group will be kept, the second will be removed.
        All faces from the second group will be moved to the first group.
        """
        # Find the groups
        group1 = None
        group2 = None
        group1_index = None
        group2_index = None
        
        for i, group in enumerate(self.groups):
            if group['groupID'] == group_id_1:
                group1 = group
                group1_index = i
            elif group['groupID'] == group_id_2:
                group2 = group
                group2_index = i
        
        if not group1 or not group2:
            print(f"Error: One or both groups not found. Group1: {group_id_1}, Group2: {group_id_2}")
            return False
        
        # Merge face IDs from group2 into group1
        merged_face_ids = list(set(group1['faceIDs'] + group2['faceIDs']))
        group1['faceIDs'] = merged_face_ids
        
        # Update all faces that belonged to group2 to now belong to group1
        for face in self.faces:
            if face['groupID'] == group_id_2:
                face['groupID'] = group_id_1
        
        # Remove group2
        if group2_index is not None:
            removed_group = self.groups.pop(group2_index)
            print(f"Merged group {group_id_2} ({removed_group['name']}) into group {group_id_1} ({group1['name']})")
            print(f"Group {group_id_1} now contains {len(merged_face_ids)} faces")
        
        return True

    def save_json(self):
        os.makedirs(os.path.dirname(self.images_json_path), exist_ok=True)
        with open(self.images_json_path, 'w', encoding='utf-8') as f:
            json.dump({"images": self.images}, f, ensure_ascii=False, indent=2)
        with open(self.groups_json_path, 'w', encoding='utf-8') as f:
            json.dump({"groups": self.groups}, f, ensure_ascii=False, indent=2)
        with open(self.faces_json_path, 'w', encoding='utf-8') as f:
            json.dump({"faces": self.faces}, f, ensure_ascii=False, indent=2)
        print(f"Saved images, groups, and faces info to {self.images_json_path}, {self.groups_json_path}, {self.faces_json_path}")