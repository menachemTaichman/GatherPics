"""
Mock AWS Rekognition Client for Development and Testing.

This module provides a persistent mock implementation of AWS Rekognition
that simulates face detection, indexing, and search operations.
Data is persisted between runs using JSON storage.

Features:
- Persistent storage of collections and faces
- Realistic face detection simulation
- Face similarity matching based on external_image_id patterns
- Thread-safe operations
- Automatic data persistence
"""

import os
import json
import uuid
import random
import hashlib
from typing import Dict, List, Any, Optional
from pathlib import Path
from threading import Lock
from datetime import datetime

from .distribution import DistributionManager


class MockRekognitionClient:
    """
    Mock AWS Rekognition client that implements collection-based face operations.
    
    This client simulates AWS Rekognition behavior for development and testing.
    Data is persisted to a JSON file to maintain state between runs.
    
    Usage:
        client = MockRekognitionClient()
        client.create_collection(CollectionId='my-collection')
        response = client.index_faces(CollectionId='my-collection', Image={'Bytes': image_bytes})
    """
    
    # Class-level storage and lock for thread safety
    _collections: Dict[str, Dict[str, Any]] = {}
    _population: List[str] = []  # List of person IDs (the virtual population)
    _lock = Lock()
    _storage_path: Optional[Path] = None
    _initialized = False
    
    def __init__(self, storage_path: Optional[str] = None):
        """
        Initialize the mock Rekognition client.
        
        Args:
            storage_path: Optional path to JSON storage file. 
                         Defaults to tests/mocks/rekognition_data.json
        """
        if not MockRekognitionClient._initialized:
            with self._lock:
                if not MockRekognitionClient._initialized:
                    self._initialize_storage(storage_path)
                    self._load_data()
                    MockRekognitionClient._initialized = True
    
    def _initialize_storage(self, storage_path: Optional[str] = None):
        """Initialize the storage path and ensure directory exists."""
        if storage_path:
            self._storage_path = Path(storage_path)
        else:
            # Default to tests/mocks/rekognition_data.json
            base_dir = Path(__file__).parent
            self._storage_path = base_dir / 'rekognition_data.json'
        
        # Ensure directory exists
        self._storage_path.parent.mkdir(parents=True, exist_ok=True)
        MockRekognitionClient._storage_path = self._storage_path
    
    def _load_data(self):
        """Load collections, faces, and population from JSON storage."""
        if self._storage_path and self._storage_path.exists():
            try:
                with open(self._storage_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    MockRekognitionClient._collections = data.get('collections', {})
                    MockRekognitionClient._population = data.get('population', [])
                    
                    # Convert face data back to proper format
                    for collection_id, collection_data in self._collections.items():
                        if 'faces' not in collection_data:
                            collection_data['faces'] = {}
            except (json.JSONDecodeError, IOError) as e:
                print(f"Warning: Could not load mock Rekognition data: {e}")
                MockRekognitionClient._collections = {}
                MockRekognitionClient._population = []
        else:
            MockRekognitionClient._collections = {}
            MockRekognitionClient._population = []
            
        # Initialize population if empty
        if not MockRekognitionClient._population:
            dist = DistributionManager()
            MockRekognitionClient._population = dist.get_population()
    
    def _save_data(self):
        """Save collections, faces, and population to JSON storage."""
        if not self._storage_path:
            return
        
        try:
            with open(self._storage_path, 'w', encoding='utf-8') as f:
                json.dump({
                    'collections': self._collections,
                    'population': self._population,
                    'last_updated': datetime.now().isoformat()
                }, f, indent=2, ensure_ascii=False)
        except IOError as e:
            print(f"Warning: Could not save mock Rekognition data: {e}")
    
    def _generate_face_id(self, image_bytes: bytes, external_image_id: str = '', index: int = 0) -> str:
        """
        Generate a deterministic face ID based on image content and external ID.
        
        This ensures the same image produces the same face ID, enabling
        realistic face matching behavior.
        """
        # Create a hash from image content and external ID
        content = f"{external_image_id}_{index}_{len(image_bytes)}"
        # Use first 1000 bytes for hashing (for performance)
        content += hashlib.md5(image_bytes[:1000]).hexdigest()
        # Generate deterministic UUID from hash
        namespace = uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')
        return str(uuid.uuid5(namespace, content))
    
    def _generate_bounding_box(self, face_index: int, total_faces: int) -> Dict[str, float]:
        """
        Generate a realistic bounding box for a face.
        
        Simulates faces positioned across the image with some overlap.
        """
        if total_faces == 1:
            # Single face: center of image
            return {
                'Width': 0.25,
                'Height': 0.35,
                'Left': 0.375,
                'Top': 0.3
            }
        else:
            # Multiple faces: distribute across image
            # Use grid-like distribution
            cols = min(3, total_faces)
            row = face_index // cols
            col = face_index % cols
            
            # Calculate position
            cell_width = 0.9 / cols
            cell_height = 0.9 / ((total_faces + cols - 1) // cols)
            
            left = 0.05 + (col * cell_width) + random.uniform(0, cell_width * 0.3)
            top = 0.05 + (row * cell_height) + random.uniform(0, cell_height * 0.3)
            
            # Face size varies slightly
            width = random.uniform(0.15, 0.25)
            height = random.uniform(0.20, 0.30)
            
            # Ensure within bounds
            left = max(0.0, min(0.8, left))
            top = max(0.0, min(0.7, top))
            width = min(0.3, width)
            height = min(0.35, height)
            
            return {
                'Width': width,
                'Height': height,
                'Left': left,
                'Top': top
            }
    
    def _calculate_similarity(self, face_id1: str, face_id2: str, external_id1: str = '', external_id2: str = '') -> float:
        """
        Calculate similarity between two faces.
        
        Uses external_image_id patterns to determine similarity:
        - Same external_id prefix = high similarity (same person)
        - Different external_ids = lower similarity
        - No external_ids = use face_id patterns
        """
        # If both have external IDs with same prefix, high similarity
        if external_id1 and external_id2:
            # Extract person identifier from external_id (assume format like "person_123_image_1")
            prefix1 = external_id1.split('_')[0] if '_' in external_id1 else external_id1
            prefix2 = external_id2.split('_')[0] if '_' in external_id2 else external_id2
            
            if prefix1 == prefix2:
                # Same person: 85-99% similarity
                return random.uniform(85.0, 99.0)
            else:
                # Different person: 30-70% similarity
                return random.uniform(30.0, 70.0)
        
        # Use face_id hash for deterministic similarity
        hash1 = int(face_id1.replace('-', '')[:8], 16) % 100
        hash2 = int(face_id2.replace('-', '')[:8], 16) % 100
        
        # Similar hashes = similar faces
        diff = abs(hash1 - hash2)
        if diff < 5:
            return random.uniform(90.0, 99.0)
        elif diff < 15:
            return random.uniform(70.0, 89.0)
        elif diff < 30:
            return random.uniform(50.0, 69.0)
        else:
            return random.uniform(20.0, 49.0)
    
    def list_collections(self) -> Dict[str, List[str]]:
        """
        List all collections.
        
        Returns:
            Dict with 'CollectionIds' key containing list of collection IDs
        """
        with self._lock:
            return {'CollectionIds': list(self._collections.keys())}
    
    def create_collection(self, CollectionId: str) -> Dict[str, Any]:
        """
        Create a new collection.
        
        Args:
            CollectionId: Unique identifier for the collection
            
        Returns:
            Dict with 'StatusCode' and 'CollectionArn'
        """
        with self._lock:
            if CollectionId not in self._collections:
                self._collections[CollectionId] = {
                    'faces': {},
                    'created_at': datetime.now().isoformat()
                }
                self._save_data()
            
            return {
                'StatusCode': 200,
                'CollectionArn': f'arn:aws:rekognition:us-east-1:123456789012:collection/{CollectionId}'
            }
    
    def list_faces(self, CollectionId: str) -> Dict[str, List[Dict[str, Any]]]:
        """
        List all faces in a collection.
        
        Args:
            CollectionId: The collection ID
            
        Returns:
            Dict with 'Faces' key containing list of face records
        """
        with self._lock:
            if CollectionId not in self._collections:
                return {'Faces': []}
            
            faces = list(self._collections[CollectionId]['faces'].values())
            return {'Faces': faces}
    
    def index_faces(
        self,
        CollectionId: str,
        Image: Dict[str, bytes],
        ExternalImageId: str = '',
        DetectionAttributes: List[str] = None,
        MaxFaces: int = 50
    ) -> Dict[str, Any]:
        """
        Index faces in an image.
        
        Simulates face detection with realistic distribution of face counts
        and bounding boxes.
        
        Args:
            CollectionId: The collection ID
            Image: Dict with 'Bytes' key containing image bytes
            ExternalImageId: Optional external identifier for the image
            DetectionAttributes: Optional list of attributes to detect
            MaxFaces: Maximum number of faces to detect
            
        Returns:
            Dict with 'FaceRecords' containing detected faces
        """
        with self._lock:
            # Ensure collection exists
            if CollectionId not in self._collections:
                self.create_collection(CollectionId)
            
            image_bytes = Image.get('Bytes', b'')
            if not image_bytes:
                return {'FaceRecords': [], 'OrientationCorrection': 'ROTATE_0'}
            
            # Setup distribution manager
            dist_manager = DistributionManager()
            dist_manager.set_population(MockRekognitionClient._population)
            
            # Determine number of faces using distribution
            num_faces = dist_manager.determine_face_count()
            num_faces = min(num_faces, MaxFaces) if MaxFaces > 0 else num_faces
            
            # Select people for this image
            people_ids = dist_manager.select_people_for_image(num_faces)
            
            # Update population (if it expanded)
            MockRekognitionClient._population = dist_manager.get_population()
            
            # Generate face records
            face_records = []
            image_id = str(uuid.uuid4())
            
            for i in range(num_faces):
                person_id = people_ids[i]
                face_id = self._generate_face_id(image_bytes, ExternalImageId, i)
                bbox = self._generate_bounding_box(i, num_faces)
                
                face_record = {
                    'Face': {
                        'FaceId': face_id,
                        'BoundingBox': bbox,
                        'Confidence': random.uniform(95.0, 99.9),
                        'ImageId': image_id,
                        'ExternalImageId': ExternalImageId if ExternalImageId else None,
                        'PersonId': person_id  # Internal field for clustering
                    },
                    'FaceDetail': {
                        'BoundingBox': bbox,
                        'Confidence': random.uniform(95.0, 99.9)
                    }
                }
                
                # Store face in collection
                self._collections[CollectionId]['faces'][face_id] = face_record['Face']
                face_records.append(face_record)
            
            self._save_data()
            
            return {
                'FaceRecords': face_records,
                'OrientationCorrection': 'ROTATE_0'
            }
    
    def search_faces(
        self,
        CollectionId: str,
        FaceId: str,
        FaceMatchThreshold: int = 90,
        MaxFaces: int = 1
    ) -> Dict[str, List[Dict[str, Any]]]:
        """
        Search for similar faces in a collection.
        
        Implements realistic similarity matching based on assigned PersonId
        from the distribution manager.
        
        Args:
            CollectionId: The collection ID
            FaceId: The face ID to search for
            FaceMatchThreshold: Minimum similarity threshold (0-100)
            MaxFaces: Maximum number of matches to return
            
        Returns:
            Dict with 'FaceMatches' containing similar faces
        """
        with self._lock:
            if CollectionId not in self._collections:
                return {'FaceMatches': []}
            
            # Get the source face
            faces = self._collections[CollectionId]['faces']
            if FaceId not in faces:
                return {'FaceMatches': []}
            
            source_face = faces[FaceId]
            source_person_id = source_face.get('PersonId')
            
            # Find similar faces
            matches = []
            for face_id, face in faces.items():
                if face_id == FaceId:
                    continue  # Skip self
                
                target_person_id = face.get('PersonId')
                
                similarity = 0.0
                if source_person_id and target_person_id and source_person_id == target_person_id:
                    # Same person: High similarity (85-99%)
                    similarity = random.uniform(85.0, 99.0)
                else:
                    # Different person: Low similarity (0-40%)
                    similarity = random.uniform(0.0, 40.0)
                
                if similarity >= FaceMatchThreshold:
                    matches.append({
                        'Face': face,
                        'Similarity': round(similarity, 2)
                    })
            
            # Sort by similarity (descending) and limit
            matches.sort(key=lambda x: x['Similarity'], reverse=True)
            matches = matches[:MaxFaces]
            
            return {'FaceMatches': matches}
    
    def delete_faces(self, CollectionId: str, FaceIds: List[str]) -> Dict[str, Any]:
        """
        Delete faces from a collection.
        
        Args:
            CollectionId: The collection ID
            FaceIds: List of face IDs to delete
            
        Returns:
            Dict with 'DeletedFaces' containing deleted face IDs
        """
        with self._lock:
            if CollectionId not in self._collections:
                return {'DeletedFaces': []}
            
            deleted = []
            for face_id in FaceIds:
                if face_id in self._collections[CollectionId]['faces']:
                    del self._collections[CollectionId]['faces'][face_id]
                    deleted.append(face_id)
            
            if deleted:
                self._save_data()
            
            return {'DeletedFaces': deleted}
    
    def delete_collection(self, CollectionId: str) -> Dict[str, int]:
        """
        Delete a collection and all its faces.
        
        Args:
            CollectionId: The collection ID to delete
            
        Returns:
            Dict with 'StatusCode'
        """
        with self._lock:
            if CollectionId in self._collections:
                del self._collections[CollectionId]
                self._save_data()
            
            return {'StatusCode': 200}
    
    def clear_all_data(self):
        """
        Clear all collections and faces (useful for testing).
        Does not delete the storage file, just clears in-memory data.
        """
        with self._lock:
            self._collections = {}
            self._save_data()


def get_mock_rekognition_client(storage_path: Optional[str] = None) -> MockRekognitionClient:
    """
    Factory function to get a MockRekognitionClient instance.
    
    Args:
        storage_path: Optional path to JSON storage file
        
    Returns:
        MockRekognitionClient instance
    """
    return MockRekognitionClient(storage_path=storage_path)

