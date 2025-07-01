import json
import os
import re
import shutil
from src.core.face_detector import FaceDetectorAWS
from src.core.face_cluster import FaceClusterAWS
from src.core.face_cropper import FaceCropper

def sanitize_external_image_id(filename):
    return re.sub(r'[^a-zA-Z0-9_.\-:]', '_', filename)

def calculate_iou(box1, box2):
    """Calculate Intersection over Union between two bounding boxes"""
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
    """Remove duplicate face detections within the same image"""
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

def main():
    with open('config/aws_config.json') as f:
        config = json.load(f)

    image_dir = 'src/data/images'
    crop_dir = 'src/data/crops'
    image_files = [f for f in os.listdir(image_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    
    shutil.rmtree(crop_dir, ignore_errors=True)
    os.makedirs(crop_dir, exist_ok=True)
    
    detector = FaceDetectorAWS(config)
    clusterer = FaceClusterAWS(config)
    cropper = FaceCropper(image_dir, crop_dir)

    clusterer.clear_collection()
    print("Indexing faces into collection...")

    # Step 1: Detect faces and index them, create crops, and build face info
    face_info_list = []
    for filename in image_files:
        image_path = os.path.join(image_dir, filename)
        face_details, image_bytes = detector.detect_faces(image_path)
        
        # Remove duplicate face detections within the same image
        face_details = remove_duplicate_faces(face_details, iou_threshold=0.5)
        
        clean_id = sanitize_external_image_id(filename)
        face_records = clusterer.index_faces(image_bytes, external_image_id=clean_id)

        for face_detail, face_record in zip(face_details, face_records):
            bounding_box = face_detail['BoundingBox']
            # Generate a new faceID for our system
            image_id = clusterer.add_image(filename)
            # Generate face ID first (this increments the counter)
            face_id = f"face_{clusterer.face_id_counter:05d}"
            clusterer.face_id_counter += 1
            # Create crop with this face ID
            crop_filename = cropper.create_crop_for_face(image_path, bounding_box, face_id)
            face_info_list.append({
                'rek_face_id': face_record['Face']['FaceId'],
                'image_id': image_id,
                'filename': filename,
                'bounding_box': bounding_box,
                'crop_filename': crop_filename,
                'width': bounding_box['Width'],
                'height': bounding_box['Height'],
                'left': bounding_box['Left'],
                'top': bounding_box['Top'],
                'face_id': face_id  # Store the face ID we generated
            })

    print(f"Indexed {len(face_info_list)} faces.")

    # Step 2: Cluster faces using Rekognition with improved logic
    clusters = []
    visited = set()
    rek_face_id_to_face_info = {f['rek_face_id']: f for f in face_info_list}

    for face_info in face_info_list:
        rek_face_id = face_info['rek_face_id']
        if rek_face_id in visited:
            continue
            
        # Search for similar faces with a slightly lower threshold for better clustering
        matches = clusterer.search_similar_faces(rek_face_id, threshold=85, max_faces=20)
        group = {rek_face_id}
        
        for match in matches:
            fid = match['Face']['FaceId']
            if fid != rek_face_id and fid in rek_face_id_to_face_info:
                group.add(fid)
        
        # Mark all faces in this group as visited
        visited.update(group)
        clusters.append(group)

    print(f"Found {len(clusters)} clusters.")

    # Step 3: Create groups, faces, and images in the new structure
    for idx, cluster in enumerate(clusters):
        label = f"Person_{idx}"
        group_face_ids = []
        representative_face_id = None
        representative_image_id = None
        for i, rek_face_id in enumerate(cluster):
            face_info = rek_face_id_to_face_info.get(rek_face_id)
            if not face_info:
                continue
            # Add face to clusterer (returns our system's faceID)
            face_id = clusterer.add_face(
                image_id=face_info['image_id'],
                group_id=idx,
                crop_filename=face_info['crop_filename'],
                width=face_info['width'],
                height=face_info['height'],
                left=face_info['left'],
                top=face_info['top'],
                face_id=face_info['face_id']  # Use the pre-generated face ID
            )
            group_face_ids.append(face_id)
            if i == 0:
                representative_face_id = face_id
                representative_image_id = face_info['image_id']
        clusterer.add_group(
            label=label,
            representative_image_id=representative_image_id,
            representative_face_id=representative_face_id,
            face_ids=group_face_ids
        )

    # Step 4: Post-process to merge groups with duplicate faces
    print("Post-processing: Checking for groups that should be merged...")
    face_to_groups = {}
    
    # Build mapping of face_id to group_ids
    for face in clusterer.faces:
        face_id = face['faceID']
        group_id = face['groupID']
        if face_id not in face_to_groups:
            face_to_groups[face_id] = []
        face_to_groups[face_id].append(group_id)
    
    # Find faces that appear in multiple groups
    groups_to_merge = []
    for face_id, group_ids in face_to_groups.items():
        if len(group_ids) > 1:
            # Sort group IDs to ensure consistent merging (always merge into the smaller group ID)
            group_ids.sort()
            groups_to_merge.append((group_ids[0], group_ids[1:]))
    
    # Merge groups
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

    clusterer.save_json()
    print("✅ Saved new images, groups, and faces JSON files.")

if __name__ == '__main__':
    main()
