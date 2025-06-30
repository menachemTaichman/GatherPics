import boto3
import json
import os

class FaceClusterAWS:
    def __init__(self, config, collection_id='my_face_collection', output_json_path='src/data/clusters_faces.json'):
        self.clusters = []
        self.faces = []
        self.cluster_id_counter = 0
        self.rekognition = boto3.client('rekognition',
                                        aws_access_key_id=config['aws_access_key_id'],
                                        aws_secret_access_key=config['aws_secret_access_key'],
                                        region_name=config['region'])
        self.collection_id = collection_id
        self.output_json_path = output_json_path
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

    def add_cluster(self, label, representative_crop_path, image_files):
        cluster = {
            "id": self.cluster_id_counter,
            "label": label,
            "representative": representative_crop_path,
            "image_ids": image_files
        }
        self.clusters.append(cluster)
        self.cluster_id_counter += 1
        return cluster["id"]

    def add_face(self, face_id, image_file, cluster_id, bounding_box, crop_path):
        face_record = {
            "face_id": face_id,
            "image_file": image_file,
            "cluster_id": cluster_id,
            "bounding_box": bounding_box,
            "crop_path": crop_path
        }
        self.faces.append(face_record)

    def save_json(self):
        data = {
            "clusters": self.clusters,
            "faces": self.faces
        }
        os.makedirs(os.path.dirname(self.output_json_path), exist_ok=True)
        with open(self.output_json_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"Saved clusters and faces info to {self.output_json_path}")