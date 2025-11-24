import os
from PIL import Image
import boto3
from io import BytesIO
from collections import defaultdict

class AWSRekognitionHelper:
    def __init__(self, event_id: str):
        # Load environment variables from .env file if it exists (development only)
        # In production (AWS), environment variables are already set
        if os.path.exists('.env'):
            from dotenv import load_dotenv
            load_dotenv()
        
        try:
            self.client = boto3.client(
            'rekognition',
            aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
                aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
                region_name=os.getenv('AWS_REGION')
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
    @staticmethod
    def bbox_conv(bbox: dict) -> dict:
        """Converts the AWS Rekognition bounding box to a PIL image bounding box."""
        return {
            'left': bbox['Left'],
            'top': bbox['Top'],
            'width': bbox['Width'],
            'height': bbox['Height']
        }
    
    def __init__(self, event_id: str):
        self.event_id = event_id
        self._rek_helper = None

    @property
    def rek_helper(self) -> AWSRekognitionHelper:
        if self._rek_helper is None:
            self._rek_helper = AWSRekognitionHelper(self.event_id)
        return self._rek_helper

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
        reduce_calls: bool = False
    ) -> list[tuple[list[str], list[str]]]:
        """
        Clusters faces with transitive merging.

        Args:
            face_ids: list of AWS FaceIds (new faces to cluster)
            threshold_similarity: similarity threshold for Rekognition search_similar_faces
            max_matches_faces: maximum number of matches to retrieve per face
            reduce_calls: reduce the number of calls to Rekognition search_similar_faces

            if reduce_calls is True, the complete transitivity may be compromised.

        Returns:
            List of clusters found, each cluster is a tuple: (new_faces_list, similar_faces_list)
            - new_faces_list: faces from the input face_ids that are in this cluster
            - similar_faces_list: existing faces (not in face_ids) that are similar to this cluster
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
        all_faces = set(face_ids)
        visited = set()
        for face_id in face_ids:
            if face_id in visited:
                continue            
            matches = self.rek_helper.search_similar_faces(face_id, threshold=threshold_similarity, max_faces=max_matches_faces)
            for match in matches:
                match_id = match['Face']['FaceId']
                uf.union(face_id, match_id)
                all_faces.add(match_id)
                if reduce_calls and match_id in face_ids:
                    visited.add(match_id)

        # Group faces by root parent
        clusters = defaultdict(list)
        for face_id in all_faces:
            clusters[uf.find(face_id)].append(face_id)
        
        # For each cluster, separate new faces from similar faces
        result = []
        for root, all_faces in clusters.items():
            new_faces = [face_id for face_id in all_faces if face_id in face_ids]
            similar_faces = [face_id for face_id in all_faces if face_id not in face_ids]
            result.append((new_faces, similar_faces))
        
        return result


    def duplicate_faces(self, face_details: list[dict], iou_threshold: float = 0.5) -> list[dict]:
        """returns list of duplicate faces based on IOU threshold."""
        return []


    def calculate_iou(self, box1: dict, box2: dict) -> float:
        """Calculates Intersection over Union (IOU) between two bounding boxes."""
        return 0.0
