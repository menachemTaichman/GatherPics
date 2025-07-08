# Face Recognition Group Merging System

This document describes the refactored and enhanced group merging system for the face recognition application.

## Overview

The merging system has been refactored to eliminate duplicate code and provide a comprehensive solution for merging face groups. The system supports both manual and automatic merging with multiple strategies.

## Architecture

### Core Components

1. **`src/core/face_cluster.py`** - Enhanced FaceClusterAWS class with comprehensive merging utilities
2. **`src/utils/face_utils.py`** - Centralized face processing utilities
3. **`scripts/merge_groups.py`** - Command-line interface for merging operations
4. **`src/backend/app.py`** - REST API endpoints for merging
5. **`src/frontend/components/MergeGroupsModal.jsx`** - Frontend UI for merging

## Features

### 1. Manual Group Merging
- Select multiple groups to merge
- Choose target group to keep
- Merge multiple groups at once
- Frontend UI with visual group selection

### 2. Automatic Duplicate Detection & Merging
- Detect faces that appear in multiple groups
- Automatic merging with configurable strategies
- Support for different merge strategies:
  - `smallest_id`: Keep group with smallest ID
  - `largest_count`: Keep group with most faces

### 3. Command-Line Tools
- List all groups with face counts
- Find duplicate faces across groups
- Manual group merging
- Auto-merge duplicate groups

### 4. REST API Endpoints
- `POST /api/groups/merge` - Manual group merging
- `POST /api/groups/auto-merge` - Automatic duplicate merging
- `GET /api/groups/duplicates` - Get duplicate face information

## Usage

### Command Line

```bash
# List all groups
python scripts/merge_groups.py list

# Find duplicate faces
python scripts/merge_groups.py duplicates

# Manual merge two groups
python scripts/merge_groups.py merge <group1> <group2>

# Auto-merge duplicate groups
python scripts/merge_groups.py auto-merge [strategy]
```

### Frontend

1. Navigate to the Face Gallery
2. Click "Merge Groups" button
3. Choose between Manual or Auto-merge modes
4. For manual mode: Select groups and choose target
5. For auto mode: Choose merge strategy and review duplicates
6. Execute the merge

### API

#### Manual Merge
```bash
curl -X POST http://localhost:5000/api/groups/merge \
  -H "Content-Type: application/json" \
  -d '{
    "targetGroupId": 1,
    "groupIdsToMerge": [2, 3, 4]
  }'
```

#### Auto-Merge
```bash
curl -X POST http://localhost:5000/api/groups/auto-merge \
  -H "Content-Type: application/json" \
  -d '{
    "mergeStrategy": "smallest_id"
  }'
```

#### Get Duplicates
```bash
curl http://localhost:5000/api/groups/duplicates
```

## Core Classes and Methods

### FaceClusterAWS Class

#### New Methods Added:

- `find_duplicate_faces()` - Find faces in multiple groups
- `auto_merge_duplicate_groups(strategy)` - Auto-merge with strategy
- `merge_multiple_groups(target_id, group_ids)` - Merge multiple groups
- `get_group_info(group_id)` - Get detailed group information
- `list_groups_summary()` - Get summary of all groups
- `load_data()` - Load data from JSON files

#### Enhanced Methods:

- `merge_groups(group_id_1, group_id_2)` - Core merging logic (unchanged)

### Face Utils Module

#### Functions:

- `sanitize_external_image_id(filename)` - Sanitize filenames
- `calculate_iou(box1, box2)` - Calculate Intersection over Union
- `remove_duplicate_faces(face_details, threshold)` - Remove duplicate detections
- `build_face_to_groups_mapping(faces)` - Build face-to-groups mapping
- `find_duplicate_faces_in_groups(faces)` - Find duplicates across groups
- `prepare_groups_for_merging(duplicates, strategy)` - Prepare merge operations

## Refactoring Benefits

### 1. Eliminated Duplicate Code
- **Before**: Duplicate face detection logic in `face_processing.py`
- **After**: Centralized in `src/utils/face_utils.py`

- **Before**: Duplicate group merging logic scattered across files
- **After**: Centralized in `FaceClusterAWS` class

- **Before**: Duplicate face-to-groups mapping logic
- **After**: Reusable utility functions

### 2. Enhanced Functionality
- **Before**: Only manual merging via command line
- **After**: Manual + automatic merging with frontend UI

- **Before**: Single merge strategy
- **After**: Multiple merge strategies (smallest_id, largest_count)

- **Before**: No API endpoints
- **After**: Complete REST API for merging operations

### 3. Better Maintainability
- **Before**: Logic scattered across multiple files
- **After**: Centralized, well-documented utilities

- **Before**: Hard-coded merge logic
- **After**: Configurable merge strategies

- **Before**: No frontend support
- **After**: Modern React UI with real-time feedback

## File Structure

```
src/
├── core/
│   └── face_cluster.py          # Enhanced with merging utilities
├── utils/
│   └── face_utils.py            # Centralized face processing utilities
├── backend/
│   └── app.py                   # New merge API endpoints
└── frontend/
    └── components/
        ├── MergeGroupsModal.jsx # New merge UI component
        └── Gallery.jsx          # Updated with merge button

scripts/
├── face_processing.py           # Refactored to use utilities
└── merge_groups.py              # Enhanced CLI tool
```

## Migration Guide

### For Existing Code

1. **Replace direct face detection calls**:
   ```python
   # Old
   from scripts.face_processing import remove_duplicate_faces
   
   # New
   from src.utils.face_utils import remove_duplicate_faces
   ```

2. **Use new FaceClusterAWS methods**:
   ```python
   # Old
   clusterer.merge_groups(group1, group2)
   
   # New
   clusterer.auto_merge_duplicate_groups(strategy='smallest_id')
   clusterer.merge_multiple_groups(target_id, [group1, group2, group3])
   ```

3. **Load data properly**:
   ```python
   # Old
   with open('groups.json') as f:
       groups = json.load(f)
   
   # New
   clusterer.load_data()
   ```

### For New Features

1. **Add merge functionality to frontend**:
   ```jsx
   import MergeGroupsModal from './MergeGroupsModal';
   
   <MergeGroupsModal
     groups={groups}
     onClose={() => setShowModal(false)}
     onMergeComplete={handleRefresh}
   />
   ```

2. **Use API endpoints**:
   ```javascript
   // Manual merge
   await axios.post('/api/groups/merge', {
     targetGroupId: 1,
     groupIdsToMerge: [2, 3]
   });
   
   // Auto-merge
   await axios.post('/api/groups/auto-merge', {
     mergeStrategy: 'smallest_id'
   });
   ```

## Testing

### Command Line Testing
```bash
# Test listing groups
python scripts/merge_groups.py list

# Test duplicate detection
python scripts/merge_groups.py duplicates

# Test auto-merge
python scripts/merge_groups.py auto-merge smallest_id
```

### API Testing
```bash
# Test manual merge
curl -X POST http://localhost:5000/api/groups/merge \
  -H "Content-Type: application/json" \
  -d '{"targetGroupId": 1, "groupIdsToMerge": [2]}'

# Test auto-merge
curl -X POST http://localhost:5000/api/groups/auto-merge \
  -H "Content-Type: application/json" \
  -d '{"mergeStrategy": "smallest_id"}'
```

## Future Enhancements

1. **Advanced Merge Strategies**:
   - Keep group with best quality faces
   - Keep group with most recent photos
   - Keep group with most diverse photos

2. **Batch Operations**:
   - Merge multiple groups in sequence
   - Undo merge operations
   - Merge history tracking

3. **UI Improvements**:
   - Drag-and-drop group selection
   - Visual merge preview
   - Progress indicators for large merges

4. **Validation**:
   - Pre-merge validation checks
   - Merge impact analysis
   - Conflict resolution UI

## Troubleshooting

### Common Issues

1. **Import Errors**: Ensure `src/utils/` is in Python path
2. **API Errors**: Check that backend server is running
3. **Frontend Errors**: Verify API_BASE environment variable
4. **Merge Failures**: Check group IDs exist and are valid

### Debug Mode

Enable debug logging by setting environment variables:
```bash
export DEBUG_MERGE=true
export DEBUG_FACE_UTILS=true
```

## Contributing

When adding new merge functionality:

1. Add methods to `FaceClusterAWS` class
2. Create utility functions in `face_utils.py`
3. Add API endpoints in `app.py`
4. Update frontend components
5. Add command-line options to `merge_groups.py`
6. Update this documentation 