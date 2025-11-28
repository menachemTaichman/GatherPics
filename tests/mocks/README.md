# Mock Services

This directory contains mock implementations of external services for development and testing.

## Mock Rekognition Client

The `mock_rekognition.py` module provides a persistent mock implementation of AWS Rekognition that:

- **Persists data between runs**: Collections and faces are saved to `rekognition_data.json`
- **Smart Clustering**: Uses a virtual population of people to simulate realistic face clustering
- **Realistic face detection**: Simulates face detection with distribution similar to real-world usage
- **Thread-safe**: All operations are protected with locks

### Usage

The mock client is automatically used when `ENVIRONMENT=DEVELOPMENT` is set. No additional configuration needed.

### Data Storage

Mock Rekognition data is stored in `tests/mocks/rekognition_data.json`. This file:
- Persists between application runs
- Contains all collections, faces, and the virtual population of people
- Can be manually edited or deleted to reset state
- Should be added to `.gitignore` if you don't want to commit test data

### Features

- **Distribution Manager**:
  - Manages a persistent population of virtual people
  - Assigns people to images based on probability distributions
  - **Duplicate Person Logic**: 99.9% of the time, unique people are selected for an image. 0.1% of the time, the same person appears twice in one image.

- **Face Count Distribution**: 
  - 30% of images have 1 face
  - 25% have 2 faces
  - 20% have 3 faces
  - 15% have 4 faces
  - 10% have 5+ faces

- **Similarity Matching**:
  - Based on the assigned `PersonId` (internal field)
  - Same Person: 85-99% similarity
  - Different Person: 0-40% similarity

- **Bounding Boxes**: Realistic positioning and sizing based on face count

### API Compatibility

The mock client implements the same interface as boto3's Rekognition client for:
- `list_collections()`
- `create_collection(CollectionId)`
- `list_faces(CollectionId)`
- `index_faces(CollectionId, Image, ...)`
- `search_faces(CollectionId, FaceId, ...)`
- `delete_faces(CollectionId, FaceIds)`
- `delete_collection(CollectionId)`
