import os
import traceback
from PIL import Image
import boto3
from botocore.config import Config
from io import BytesIO
import concurrent.futures
import threading
import logging
from src.core.errors import log_error

logger = logging.getLogger(__name__)

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
            # Use custom mock client in development or when MOCK_REKOGNITION is set
            # (moto doesn't support Rekognition collections)
            use_mock = (
                os.getenv('ENVIRONMENT') == 'DEVELOPMENT' or 
                os.getenv('MOCK_REKOGNITION', '').lower() in ('true', '1', 'yes')
            )
            if use_mock:
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
                
                my_config = Config(
                    max_pool_connections=50,
                    retries={
                        'max_attempts': 10,
                        'mode': 'adaptive'
                    }
                )
                
                self.client = boto3.client(
                    'rekognition',
                    aws_access_key_id=aws_access_key_id,
                    aws_secret_access_key=aws_secret_access_key,
                    region_name=os.getenv('AWS_REGION'),
                    config=my_config
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

    def detect_faces(self, image: Image.Image = None, external_image_id: str = '') -> list[tuple[str, dict]]:
        """
        Detects faces in an image and returns a list of tuples of AWSfaceId and face bounding box dicts.
        
        Args:
            image: PIL Image object (already in memory)
            external_image_id: External image identifier
        
        Returns:
            List of tuples: (face_id, bounding_box_dict)
        """
        # R2 storage is not directly accessible by Rekognition; always send image bytes.
        if image is None:
            raise ValueError("Either image or image_path must be provided")
        
        buffer = BytesIO()
        image.save(buffer, format='JPEG', quality=90)
        buffer.seek(0)
        image_bytes = buffer.read()
        
        face_details = self.rek_helper.index_faces(image_bytes=image_bytes, external_image_id=external_image_id)
        faces = [(face['Face']['FaceId'], self.bbox_conv(face['Face']['BoundingBox'])) for face in face_details]
        return faces

    def fetch_face_matches(
        self,
        face_ids: list[str],
        similarity_threshold: int = 90,
        max_matches_faces: int = 100,
        max_workers: int = 50,
        reduce_calls: bool = False,
        transitivity_threshold: float = 98.0
    ) -> dict[str, list[dict]]:
        """
        Fetch face matches from AWS Rekognition for multiple faces in parallel.
        This method only fetches data from AWS and returns the raw results.
        
        Args:
            face_ids: list of AWS FaceIds to search for matches
            similarity_threshold: similarity threshold for Rekognition search_similar_faces
            max_matches_faces: maximum number of matches to retrieve per face
            max_workers: maximum number of parallel threads for processing
            reduce_calls: reduce the number of calls to Rekognition search_similar_faces
            transitivity_threshold: when reduce_calls=True, matches with similarity above this 
                                 threshold will be skipped from separate processing
                                 (assuming that the similarity above this threshold is transitive)
        
        Returns:
            Dictionary mapping face_id to list of match dictionaries (raw AWS responses)
        """
        # Shared variables for managing skips when reduce_calls=True
        total_faces = len(face_ids)
        processed_faces = set()
        processed_lock = threading.Lock()
        results = {}
        results_lock = threading.Lock()

        def process_single_face(face_id):
            if reduce_calls:
                with processed_lock:
                    if face_id in processed_faces:
                        return face_id, None

            try:
                matches = self.rek_helper.search_similar_faces(
                    face_id,
                    threshold=similarity_threshold,
                    max_faces=max_matches_faces
                )
            except Exception as e:
                log_error(f"Failed to search face {face_id}: {e}", "FaceSearchError", traceback.format_exc())
                return face_id, []

            # Update the processed set with results
            if matches:
                with processed_lock:
                    # Mark ourselves as processed
                    processed_faces.add(face_id)
                    
                    for match in matches:
                        similarity = match.get('Similarity', 0)
                        match_id = match['Face']['FaceId']
                        
                        # Transitivity trick: skip only very high confidence matches
                        # when reduce_calls is enabled
                        if reduce_calls and similarity > transitivity_threshold:
                            processed_faces.add(match_id)

            return face_id, matches

        # Process faces in parallel
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_face = {executor.submit(process_single_face, fid): fid for fid in face_ids}
            
            for i, future in enumerate(concurrent.futures.as_completed(future_to_face)):
                face_id, matches = future.result()

                if i % 1000 == 0 or i == total_faces:
                    percentage = (i / total_faces) * 100
                    logger.info(f"Progress: Processed {i}/{total_faces} faces ({percentage:.1f}%)")
                
                # Skip if we skipped this face (matches is None)
                if matches is None:
                    continue
                
                # Store results thread-safely
                with results_lock:
                    results[face_id] = matches

        return results