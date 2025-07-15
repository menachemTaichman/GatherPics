import re
import os
from PIL import Image
import piexif
import json
import shutil

def sanitize_external_image_id(filename):
    return re.sub(r'[^a-zA-Z0-9_.\-:]', '_', filename)

def calculate_iou(box1, box2):
    """Calculate Intersection over Union between two bounding boxes"""
    x1_1, y1_1 = box1['Left'], box1['Top']
    x2_1, y2_1 = box1['Left'] + box1['Width'], box1['Top'] + box1['Height']
    x1_2, y1_2 = box2['Left'], box2['Top']
    x2_2, y2_2 = box2['Left'] + box2['Width'], box2['Top'] + box2['Height']
    x1_i = max(x1_1, x1_2)
    y1_i = max(y1_1, y1_2)
    x2_i = min(x2_1, x2_2)
    y2_i = min(y2_1, y2_2)
    if x2_i <= x1_i or y2_i <= y1_i:
        return 0.0
    intersection = (x2_i - x1_i) * (y2_i - y1_i)
    area1 = (x2_1 - x1_1) * (y2_1 - y1_1)
    area2 = (x2_2 - x1_2) * (y2_2 - y1_2)
    union = area1 + area2 - intersection
    return intersection / union if union > 0 else 0.0

def remove_duplicate_faces(face_details, iou_threshold=0.5):
    """Remove duplicate face detections within the same image"""
    if len(face_details) <= 1:
        return face_details
    filtered_faces = []
    for i, face1 in enumerate(face_details):
        is_duplicate = False
        for j, face2 in enumerate(filtered_faces):
            iou = calculate_iou(face1['BoundingBox'], face2['BoundingBox'])
            if iou > iou_threshold:
                area1 = face1['BoundingBox']['Width'] * face1['BoundingBox']['Height']
                area2 = face2['BoundingBox']['Width'] * face2['BoundingBox']['Height']
                if area1 > area2:
                    filtered_faces[j] = face1
                is_duplicate = True
                break
        if not is_duplicate:
            filtered_faces.append(face1)
    return filtered_faces

def get_image_metadata(image_path):
    """Extract date taken, file size, and resolution from an image."""
    date_taken = None
    width = None
    height = None
    file_size = None
    try:
        file_size = os.path.getsize(image_path)
        with Image.open(image_path) as img:
            width, height = img.size
            exif_data = img.info.get('exif')
            if exif_data:
                exif_dict = piexif.load(exif_data)
                date_bytes = exif_dict['Exif'].get(piexif.ExifIFD.DateTimeOriginal)
                if date_bytes:
                    date_taken = date_bytes.decode('utf-8')
    except Exception as e:
        print(f"Error reading metadata for {image_path}: {e}")
    return date_taken, file_size, width, height 

def merge_groups_logic(clusterer):
    print("Post-processing: Checking for groups that should be merged...")
    face_to_groups = {}
    for face in clusterer.faces:
        face_id = face['faceID']
        group_id = face['groupID']
        if face_id not in face_to_groups:
            face_to_groups[face_id] = []
        face_to_groups[face_id].append(group_id)
    groups_to_merge = []
    for face_id, group_ids in face_to_groups.items():
        if len(group_ids) > 1:
            group_ids.sort()
            groups_to_merge.append((group_ids[0], group_ids[1:]))
    for target_group, groups_to_merge_into_target in groups_to_merge:
        for group_to_merge in groups_to_merge_into_target:
            if clusterer.merge_groups(target_group, group_to_merge):
                print(f"Successfully merged group {group_to_merge} into {target_group}")
            else:
                print(f"Failed to merge group {group_to_merge} into {target_group}")
    if groups_to_merge:
        print(f"Post-processing complete: Merged {len(groups_to_merge)} sets of groups")
    else:
        print("Post-processing complete: No groups needed merging") 

def find_missing_images(images_json_path, original_dir):
    with open(images_json_path, 'r', encoding='utf-8') as f:
        images_data = json.load(f)
    missing = []
    for img in images_data['images']:
        original_path = os.path.join(original_dir, img['name'])
        if not os.path.exists(original_path):
            missing.append(img)
    return missing

def delete_image_and_related(image_id, images_json_path, faces_json_path, groups_json_path, crop_dir, display_dir, thumb_dir, original_dir):
    # Remove from images.json
    with open(images_json_path, 'r', encoding='utf-8') as f:
        images_data = json.load(f)
    images_data['images'] = [img for img in images_data['images'] if img['imageID'] != image_id]
    with open(images_json_path, 'w', encoding='utf-8') as f:
        json.dump(images_data, f, ensure_ascii=False, indent=2)
    # Remove from faces.json and collect faceIDs
    with open(faces_json_path, 'r', encoding='utf-8') as f:
        faces_data = json.load(f)
    faces_to_delete = [face for face in faces_data['faces'] if face['imageID'] == image_id]
    face_ids = [face['faceID'] for face in faces_to_delete]
    faces_data['faces'] = [face for face in faces_data['faces'] if face['imageID'] != image_id]
    with open(faces_json_path, 'w', encoding='utf-8') as f:
        json.dump(faces_data, f, ensure_ascii=False, indent=2)
    # Remove from groups.json
    with open(groups_json_path, 'r', encoding='utf-8') as f:
        groups_data = json.load(f)
    for group in groups_data['groups']:
        group['faceIDs'] = [fid for fid in group['faceIDs'] if fid not in face_ids]
        if group.get('representative_imageID') == image_id:
            group['representative_imageID'] = None
        if group.get('representative_faceID') in face_ids:
            group['representative_faceID'] = None
    with open(groups_json_path, 'w', encoding='utf-8') as f:
        json.dump(groups_data, f, ensure_ascii=False, indent=2)
    # Delete crop, display, thumb files
    for fid in face_ids:
        crop_path = os.path.join(crop_dir, f'{fid}.jpg')
        if os.path.exists(crop_path):
            os.remove(crop_path)
    # Delete display, thumb, and original files
    for d in [display_dir, thumb_dir, original_dir]:
        img_path = os.path.join(d, f'{image_id.replace("img_", "img_").zfill(6)}.jpg')
        if os.path.exists(img_path):
            os.remove(img_path)
    # Remove references to any files that no longer exist in any folder or JSON
    # (This is handled by cleanup_missing_images)

def cleanup_missing_images():
    images_json_path = os.path.join('src', 'data', 'images.json')
    faces_json_path = os.path.join('src', 'data', 'faces.json')
    groups_json_path = os.path.join('src', 'data', 'groups.json')
    original_dir = os.path.join('src', 'data', 'original')
    crop_dir = os.path.join('src', 'data', 'crops')
    display_dir = os.path.join('src', 'data', 'display')
    thumb_dir = os.path.join('src', 'data', 'thumb')
    missing = find_missing_images(images_json_path, original_dir)
    for img in missing:
        # print(f"Deleting missing image and related data: {img['imageID']} ({img['name']})")
        delete_image_and_related(img['imageID'], images_json_path, faces_json_path, groups_json_path, crop_dir, display_dir, thumb_dir, original_dir) 

def get_next_face_id(faces_json_path):
    """Return the next unique faceID as a string (e.g., 'face_00042')."""
    if os.path.exists(faces_json_path):
        with open(faces_json_path, 'r', encoding='utf-8') as f:
            faces_data = json.load(f)
        existing_face_ids = [int(face['faceID'][5:]) for face in faces_data.get('faces', []) if face['faceID'].startswith('face_') and face['faceID'][5:].isdigit()]
        next_face_index = max(existing_face_ids) + 1 if existing_face_ids else 0
    else:
        next_face_index = 0
    return f"face_{next_face_index:05d}"

def get_next_group_id(groups_json_path):
    """Return the next unique groupID as an integer."""
    if os.path.exists(groups_json_path):
        with open(groups_json_path, 'r', encoding='utf-8') as f:
            groups_data = json.load(f)
        existing_group_ids = [int(group['groupID']) for group in groups_data.get('groups', []) if isinstance(group['groupID'], int)]
        next_group_index = max(existing_group_ids) + 1 if existing_group_ids else 0
    else:
        next_group_index = 0
    return next_group_index

def detect_faces_in_image(detector, image_path, remove_duplicates=True, iou_threshold=0.5):
    """
    Detect faces in an image using the provided detector.
    Optionally remove duplicate faces using IoU threshold.
    Returns (face_details, image_bytes).
    """
    face_details, image_bytes = detector.detect_faces(image_path)
    if remove_duplicates:
        face_details = remove_duplicate_faces(face_details, iou_threshold=iou_threshold)
    return face_details, image_bytes 