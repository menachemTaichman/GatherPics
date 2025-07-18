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
    Remove duplicate face detections within the same image using IoU threshold.
    
    Args:
        face_details (list): List of face detection details
        iou_threshold (float): IoU threshold for considering faces as duplicates
        
    Returns:
        list: Filtered list of face details with duplicates removed
    """
    if not face_details:
        return []
    
    filtered_faces = []
    
    for i, face1 in enumerate(face_details):
        is_duplicate = False
        
        for j, face2 in enumerate(filtered_faces):
            iou = calculate_iou(face1['BoundingBox'], face2['BoundingBox'])
            if iou > iou_threshold:
                is_duplicate = True
                break
        
        if not is_duplicate:
            filtered_faces.append(face1)
    
    return filtered_faces 