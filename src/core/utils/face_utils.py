import os
from PIL import Image
import boto3
from io import BytesIO
from collections import defaultdict

class AWSRekognitionHelper:
    def __init__(self, event_id: str, storage_backend=None):
        # Load environment variables from .env file if it exists (development only)
        # In production (AWS), environment variables are already set
        if os.path.exists('.env'):
            from dotenv import load_dotenv
            load_dotenv()
        
        # Import storage backend if not provided
        if storage_backend is None:
            from src.core.storage import get_storage_backend
            storage_backend = get_storage_backend()
        
        self.storage = storage_backend
        
        try:
            # Use custom mock client in development (moto doesn't support Rekognition collections)
            if os.getenv('ENVIRONMENT') == 'DEVELOPMENT':
                # Import mock client from tests.mocks
                import sys
                from pathlib import Path
                # Add project root to path to enable tests.mocks import
                project_root = Path(__file__).parent.parent.parent.parent
                if str(project_root) not in sys.path:
                    sys.path.insert(0, str(project_root))
                
                from tests.mocks.mock_rekognition import get_mock_rekognition_client  # noqa: E501
                self.client = get_mock_rekognition_client()
            else:
                aws_access_key_id = os.getenv('AWS_ACCESS_KEY_ID')
                aws_secret_access_key = os.getenv('AWS_SECRET_ACCESS_KEY')
                self.client = boto3.client(
                    'rekognition',
                    aws_access_key_id=aws_access_key_id,
                    aws_secret_access_key=aws_secret_access_key,
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

    def index_faces(self, image_bytes: bytes = None, image_s3_object: dict = None, external_image_id: str = '') -> list[dict]:
        """
        Index a face into the collection.
        
        Args:
            image_bytes: Image bytes (for local storage or when image is in memory)
            image_s3_object: S3 object reference dict with 'Bucket' and 'Name' keys (for S3 storage - preferred)
            external_image_id: External image identifier
        
        Returns:
            List of face records
        """
        try:
            if image_s3_object:
                image_param = {'S3Object': image_s3_object}
            elif image_bytes:
                image_param = {'Bytes': image_bytes}
            else:
                raise ValueError("Either image_bytes or image_s3_object must be provided")
            
            response = self.client.index_faces(
                CollectionId=self.collection_id,
                Image=image_param,
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
    
    def __init__(self, event_id: str, storage_backend=None):
        self.event_id = event_id
        self._rek_helper = None
        self.storage_backend = storage_backend

    @property
    def rek_helper(self) -> AWSRekognitionHelper:
        if self._rek_helper is None:
            self._rek_helper = AWSRekognitionHelper(self.event_id, storage_backend=self.storage_backend)
        return self._rek_helper

    def detect_faces(self, image: Image.Image = None, image_path: str = None, external_image_id: str = '') -> list[tuple[str, dict]]:
        """
        Detects faces in an image and returns a list of tuples of AWSfaceId and face bounding box dicts.
        
        Args:
            image: PIL Image object (already in memory) - used when image_path is not provided
            image_path: Path to image file in storage (preferred for S3 storage to avoid data transfer)
            external_image_id: External image identifier
        
        Returns:
            List of tuples: (face_id, bounding_box_dict)
        """
        if image_path and self.storage_backend:
            s3_ref = self.storage_backend.get_s3_reference(image_path)
            if s3_ref and 'S3Object' in s3_ref:
                face_details = self.rek_helper.index_faces(image_s3_object=s3_ref['S3Object'], external_image_id=external_image_id)
                faces = [(face['Face']['FaceId'], self.bbox_conv(face['Face']['BoundingBox'])) for face in face_details]
                return faces
        
        # Fallback: Convert PIL Image to JPEG bytes (for local storage or when image is in memory)
        if image is None:
            raise ValueError("Either image or image_path must be provided")
        
        buffer = BytesIO()
        image.save(buffer, format='JPEG', quality=90)
        buffer.seek(0)
        image_bytes = buffer.read()
        
        face_details = self.rek_helper.index_faces(image_bytes=image_bytes, external_image_id=external_image_id)
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
