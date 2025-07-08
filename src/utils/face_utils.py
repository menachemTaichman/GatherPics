"""
Face processing utilities for detecting and handling duplicate faces.
This module centralizes face processing logic to avoid duplication across scripts.
"""

import re

def sanitize_external_image_id(filename):
    """Sanitize filename for use as external image ID in AWS Rekognition"""
    return re.sub(r'[^a-zA-Z0-9_.\-:]', '_', filename)

def calculate_iou(box1, box2):
    """
    Calculate Intersection over Union between two bounding boxes.
    
    Args:
        box1, box2: Dictionaries with 'Left', 'Top', 'Width', 'Height' keys
        
    Returns:
        float: IoU value between 0 and 1
    """
    # Convert from relative coordinates to absolute
    x1_1, y1_1 = box1['Left'], box1['Top']
    x2_1, y2_1 = box1['Left'] + box1['Width'], box1['Top'] + box1['Height']
    
    x1_2, y1_2 = box2['Left'], box2['Top']
    x2_2, y2_2 = box2['Left'] + box2['Width'], box2['Top'] + box2['Height']
    
    # Calculate intersection
    x1_i = max(x1_1, x1_2)
    y1_i = max(y1_1, y1_2)
    x2_i = min(x2_1, x2_2)
    y2_i = min(y2_1, y2_2)
    
    if x2_i <= x1_i or y2_i <= y1_i:
        return 0.0
    
    intersection = (x2_i - x1_i) * (y2_i - y1_i)
    
    # Calculate union
    area1 = (x2_1 - x1_1) * (y2_1 - y1_1)
    area2 = (x2_2 - x1_2) * (y2_2 - y1_2)
    union = area1 + area2 - intersection
    
    return intersection / union if union > 0 else 0.0

def remove_duplicate_faces(face_details, iou_threshold=0.5):
    """
    Remove duplicate face detections within the same image.
    
    Args:
        face_details (list): List of face detection dictionaries
        iou_threshold (float): IoU threshold above which faces are considered duplicates
        
    Returns:
        list: Filtered list of face detections with duplicates removed
    """
    if len(face_details) <= 1:
        return face_details
    
    filtered_faces = []
    for i, face1 in enumerate(face_details):
        is_duplicate = False
        for j, face2 in enumerate(filtered_faces):
            iou = calculate_iou(face1['BoundingBox'], face2['BoundingBox'])
            if iou > iou_threshold:
                # Keep the face with larger area (more confident detection)
                area1 = face1['BoundingBox']['Width'] * face1['BoundingBox']['Height']
                area2 = face2['BoundingBox']['Width'] * face2['BoundingBox']['Height']
                if area1 > area2:
                    # Replace the existing face with this one
                    filtered_faces[j] = face1
                is_duplicate = True
                break
        
        if not is_duplicate:
            filtered_faces.append(face1)
    
    return filtered_faces

def build_face_to_groups_mapping(faces):
    """
    Build a mapping from face_id to list of group_ids.
    
    Args:
        faces (list): List of face dictionaries
        
    Returns:
        dict: Mapping from face_id to list of group_ids
    """
    face_to_groups = {}
    for face in faces:
        face_id = face['faceID']
        group_id = face['groupID']
        if face_id not in face_to_groups:
            face_to_groups[face_id] = []
        face_to_groups[face_id].append(group_id)
    
    return face_to_groups

def find_duplicate_faces_in_groups(faces):
    """
    Find faces that appear in multiple groups.
    
    Args:
        faces (list): List of face dictionaries
        
    Returns:
        dict: Mapping from face_id to list of group_ids for faces in multiple groups
    """
    face_to_groups = build_face_to_groups_mapping(faces)
    return {face_id: groups for face_id, groups in face_to_groups.items() if len(groups) > 1}

def prepare_groups_for_merging(duplicates, merge_strategy='smallest_id'):
    """
    Prepare groups for merging based on duplicate faces.
    
    Args:
        duplicates (dict): Mapping from face_id to list of group_ids
        merge_strategy (str): Strategy for choosing which group to keep
        
    Returns:
        list: List of tuples (target_group_id, groups_to_merge) for each merge operation
    """
    if not duplicates:
        return []
    
    # Group duplicates by their group sets
    group_sets = {}
    for face_id, group_ids in duplicates.items():
        group_set = tuple(sorted(group_ids))
        if group_set not in group_sets:
            group_sets[group_set] = []
        group_sets[group_set].append(face_id)
    
    merges_to_perform = []
    
    for group_set, face_ids in group_sets.items():
        if len(group_set) <= 1:
            continue
        
        # Determine which group to keep based on strategy
        if merge_strategy == 'smallest_id':
            target_group = min(group_set)
            groups_to_merge = [g for g in group_set if g != target_group]
        else:  # Default to smallest_id
            target_group = min(group_set)
            groups_to_merge = [g for g in group_set if g != target_group]
        
        merges_to_perform.append((target_group, groups_to_merge))
    
    return merges_to_perform 