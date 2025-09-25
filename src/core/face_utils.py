import json
import os
from PIL import Image
import boto3
from io import BytesIO
from collections import defaultdict

class AWSRekognitionHelper:
    def __init__(self, event_id: str):
        config_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'config', 'aws_config.json')
        with open(config_path, 'r') as f:
            config = json.load(f)
        try:
            self.client = boto3.client(
            'rekognition',
            aws_access_key_id=config['aws_access_key_id'],
                aws_secret_access_key=config['aws_secret_access_key'],
                region_name=config['region']
            )
        except Exception as e:
            print(f"Error initializing AWS Rekognition client: {e}")
            raise

        self.collection_id = event_id
        self._ensure_collection_exists()

    def _ensure_collection_exists(self):
        """Ensure the collection exists, create if it doesn't"""
        try:
            collections = self.client.list_collections()
            if self.collection_id not in collections['CollectionIds']:
                self.client.create_collection(CollectionId=self.collection_id)
        except Exception as e:
            print(f"Error ensuring collection exists: {e}")

    def get_face_ids(self) -> list[str]:
        """Get the list of face ids in the collection"""
        try:
            response = self.client.list_faces(CollectionId=self.collection_id)
            return [face['FaceId'] for face in response['Faces']]
        except Exception as e:
            print(f"Error getting face ids: {e}")
            return []

    def index_faces(self, image_bytes, external_image_id = '') -> list[dict]:
        """Index a face into the collection"""
        try:
            response = self.client.index_faces(
                CollectionId=self.collection_id,
                Image={'Bytes': image_bytes},
                ExternalImageId=external_image_id,
                DetectionAttributes=['DEFAULT'],
                MaxFaces=50
            )
            return response['FaceRecords']
        except Exception as e:
            print(f"Error indexing face: {e}")
            return []

    def search_similar_faces(self, face_id, threshold=90, max_faces=1) -> list[dict]:
        """Search for similar faces in the collection"""
        try:
            response = self.client.search_faces(
                CollectionId=self.collection_id,
                FaceId=face_id,
                FaceMatchThreshold=threshold,
                MaxFaces=max_faces
            )
            return response.get('FaceMatches', [])
        except Exception as e:
            print(f"Error searching similar faces: {e}")
            return []

    def delete_faces(self, face_ids):
        """Delete faces from the collection"""
        try:
            self.client.delete_faces(CollectionId=self.collection_id, FaceIds=face_ids)
        except Exception as e:
            print(f"Error deleting faces: {e}")

    def clear_collection(self):
        """Clear all faces from the collection"""
        self.delete_faces(self.get_face_ids())

    def delete_collection(self):
        """Delete the collection"""
        try:
            self.client.delete_collection(CollectionId=self.collection_id)
        except Exception as e:
            print(f"Error deleting collection: {e}")

class FaceUtils:
    def __init__(self, event_id: str):
        self.event_id = event_id
        self.rek_helper = AWSRekognitionHelper(event_id)

    @staticmethod
    def bbox_conv(bbox: dict) -> dict:
        """Converts the AWS Rekognition bounding box to a PIL image bounding box."""
        return {
            'left': bbox['Left'],
            'top': bbox['Top'],
            'width': bbox['Width'],
            'height': bbox['Height']
        }
    
    def detect_faces(self, image: Image.Image, external_image_id = '') -> list[tuple[str, dict]]:
        """Detects faces in the given PIL image and returns a list of tuples of AWSfaceId and face bounding box dicts."""
        buffer = BytesIO()
        image.save(buffer, format='JPEG', quality=90)
        buffer.seek(0)
        image_bytes = buffer.read()
        face_details = self.rek_helper.index_faces(image_bytes, external_image_id)
        faces = [(face['Face']['FaceId'], self.bbox_conv(face['Face']['BoundingBox'])) for face in face_details]
        return faces

    def cluster_faces(
        self,
        face_ids: list[str],
        threshold_similarity: int = 90,
        max_matches_faces: int = 100,
    ) -> list[list[str]]:
        """
        Clusters faces with transitive merging.

        Args:
            face_ids: list of AWS FaceIds
            threshold: similarity threshold for Rekognition search_similar_faces

        Returns:
            List of clusters (each cluster is a list of FaceIds)
        """
        class UnionFind:
            def __init__(self):
                self.parent = {}

            def find(self, x):
                if x not in self.parent:
                    self.parent[x] = x
                if self.parent[x] != x:
                    self.parent[x] = self.find(self.parent[x])
                return self.parent[x]

            def union(self, x, y):
                self.parent[self.find(x)] = self.find(y)

        uf = UnionFind()
        visited = set()

        for face_id in face_ids:
            if face_id in visited:
                continue
            visited.add(face_id)
            matches = self.rek_helper.search_similar_faces(face_id, threshold=threshold_similarity, max_faces=max_matches_faces)
            for match in matches:
                match_id = match['Face']['FaceId']
                uf.union(face_id, match_id)
                visited.add(match_id)

        # Group faces by root parent
        clusters = defaultdict(list)
        for face_id in face_ids:
            clusters[uf.find(face_id)].append(face_id)
        return list(clusters.values())


    def duplicate_faces(self, face_details: list[dict], iou_threshold: float = 0.5) -> list[dict]:
        """returns list of duplicate faces based on IOU threshold."""
        return []


    def calculate_iou(self, box1: dict, box2: dict) -> float:
        """Calculates Intersection over Union (IOU) between two bounding boxes."""
        return 0.0
