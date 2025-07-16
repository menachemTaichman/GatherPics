import json
import os
from PIL import Image
import boto3
from io import BytesIO
from typing import Optional, List, Tuple

class AWSRekognitionHelper:
    def __init__(self):
        config_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'config', 'aws_config.json')
        with open(config_path, 'r') as f:
            config = json.load(f)
        self.client = boto3.client(
            'rekognition',
            aws_access_key_id=config['aws_access_key_id'],
            aws_secret_access_key=config['aws_secret_access_key'],
            region_name=config['region']
        )
        self.collection_id = "my_face_collection"
        self._ensure_collection_exists()

    def _ensure_collection_exists(self):
        """Ensure the collection exists, create if it doesn't"""
        try:
            collections = self.client.list_collections()
            if self.collection_id not in collections['CollectionIds']:
                self.client.create_collection(CollectionId=self.collection_id)
        except Exception as e:
            print(f"Error ensuring collection exists: {e}")

    def detect_faces(self, image_bytes):
        response = self.client.detect_faces(
            Image={'Bytes': image_bytes},
            Attributes=['DEFAULT']
        )
        return response['FaceDetails']

    def index_face(self, image_bytes, external_image_id):
        """Index a face into the collection"""
        try:
            response = self.client.index_faces(
                CollectionId=self.collection_id,
                Image={'Bytes': image_bytes},
                ExternalImageId=external_image_id,
                DetectionAttributes=['DEFAULT']
            )
            return response['FaceRecords']
        except Exception as e:
            print(f"Error indexing face: {e}")
            return []

    def search_similar_faces(self, face_id, threshold=85, max_faces=20):
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

    def clear_collection(self):
        """Clear all faces from the collection"""
        try:
            response = self.client.list_faces(CollectionId=self.collection_id)
            face_ids = [face['FaceId'] for face in response['Faces']]
            if face_ids:
                self.client.delete_faces(CollectionId=self.collection_id, FaceIds=face_ids)
        except Exception as e:
            print(f"Error clearing collection: {e}")

# Singleton instance for reuse
rek_helper = AWSRekognitionHelper()

def detect_faces(image: Image.Image) -> list[dict]:
    """Detects faces in the given PIL image and returns a list of face bounding box dicts."""
    buffer = BytesIO()
    image.save(buffer, format='JPEG', quality=90)
    buffer.seek(0)
    image_bytes = buffer.read()
    face_details = rek_helper.detect_faces(image_bytes)
    bboxes = [face['BoundingBox'] for face in face_details]
    return bboxes

def cluster_faces(images: List[Image.Image]) -> List[Tuple[str, List[int]]]:
    """
    Cluster faces from a list of PIL images using AWS Rekognition.
    
    Args:
        images: List of PIL Image objects
        
    Returns:
        List of tuples (representative_face_id, face_indexes) where:
        - representative_face_id is the AWS FaceId of the representative face
        - face_indexes is a list of indexes into the input images list
    """
    # Clear collection and index all faces
    rek_helper.clear_collection()
    
    # Index all faces and collect their AWS FaceIds
    face_records = []
    for i, image in enumerate(images):
        buffer = BytesIO()
        image.save(buffer, format='JPEG', quality=90)
        buffer.seek(0)
        image_bytes = buffer.read()
        
        records = rek_helper.index_face(image_bytes, f"face_{i}")
        face_records.extend([(record['Face']['FaceId'], i) for record in records])
    
    # Build clusters using similarity search
    clusters = []
    visited = set()
    
    for face_id, image_idx in face_records:
        if face_id in visited:
            continue
            
        # Find similar faces
        matches = rek_helper.search_similar_faces(face_id, threshold=85)
        cluster_face_ids = {face_id}
        cluster_indexes = [image_idx]
        
        # Add similar faces to cluster
        for match in matches:
            similar_face_id = match['Face']['FaceId']
            if similar_face_id != face_id:
                # Find the image index for this face_id
                for f_id, idx in face_records:
                    if f_id == similar_face_id and idx not in cluster_indexes:
                        cluster_face_ids.add(f_id)
                        cluster_indexes.append(idx)
                        break
        
        visited.update(cluster_face_ids)
        clusters.append((face_id, cluster_indexes))
    
    return clusters

def find_closest_group(image: Image.Image, existing_groups: List[str]) -> Optional[str]:
    """
    Find the closest existing group for a single face image.
    
    Args:
        image: PIL Image object
        existing_groups: List of AWS FaceIds representing existing groups
        
    Returns:
        AWS FaceId of the closest group if similarity > threshold, else None
    """
    # Index the face temporarily
    buffer = BytesIO()
    image.save(buffer, format='JPEG', quality=90)
    buffer.seek(0)
    image_bytes = buffer.read()
    
    records = rek_helper.index_face(image_bytes, "temp_face")
    if not records:
        return None
    
    temp_face_id = records[0]['Face']['FaceId']
    
    # Search for similar faces in existing groups
    matches = rek_helper.search_similar_faces(temp_face_id, threshold=85)
    
    # Find the closest match among existing groups
    best_match = None
    best_similarity = 0
    
    for match in matches:
        match_face_id = match['Face']['FaceId']
        similarity = match['Similarity']
        
        if match_face_id in existing_groups and similarity > best_similarity:
            best_match = match_face_id
            best_similarity = similarity
    
    # Clean up temporary face
    try:
        rek_helper.client.delete_faces(CollectionId=rek_helper.collection_id, FaceIds=[temp_face_id])
    except:
        pass
    
    return best_match


def remove_duplicate_faces(face_details: list[dict], iou_threshold: float = 0.5) -> list[dict]:
    """Removes duplicate faces based on IOU threshold and returns a filtered list of face dicts."""
    return []


def calculate_iou(box1: dict, box2: dict) -> float:
    """Calculates Intersection over Union (IOU) between two bounding boxes."""
    return 0.0
