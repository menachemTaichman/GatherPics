import json
import os
import shutil
import sys

# Add the current directory to Python path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.core.face_detector import FaceDetectorAWS
from src.core.face_cluster import FaceClusterAWS
from src.core.face_cropper import FaceCropper
from src.utils.face_utils import sanitize_external_image_id, remove_duplicate_faces

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

    clusterer.save_json()
    print("✅ Saved new images, groups, and faces JSON files.")

    # Step 4: Post-clustering merge - merge groups that share faces
    print("🔍 Detecting and merging groups with shared faces...")
    merge_groups_with_shared_faces(clusterer)
    
    # Save the final merged data
    clusterer.save_json()
    print("✅ Final merged data saved.")

def merge_groups_with_shared_faces(clusterer):
    """
    Detect groups that share faces and merge them using the existing merge logic.
    This handles cases where the same face was assigned to multiple groups during clustering.
    """
    faces = clusterer.faces
    groups = clusterer.groups
    
    # Create a mapping of faceID to groupID
    face_to_group = {}
    for face in faces:
        face_id = face['faceID']
        group_id = face['groupID']
        if face_id in face_to_group:
            # This face appears in multiple groups - we need to merge them
            existing_group = face_to_group[face_id]
            if existing_group != group_id:
                print(f"Found shared face {face_id} in groups {existing_group} and {group_id}")
                # Merge the groups (keep the smaller group ID)
                target_group = min(existing_group, group_id)
                source_group = max(existing_group, group_id)
                
                print(f"Merging group {source_group} into {target_group}")
                success = clusterer.merge_groups(target_group, source_group)
                if success:
                    print(f"✅ Successfully merged groups {source_group} → {target_group}")
                else:
                    print(f"❌ Failed to merge groups {source_group} → {target_group}")
        else:
            face_to_group[face_id] = group_id
    
    print(f"Post-merge: {len(clusterer.groups)} groups remaining")

if __name__ == '__main__':
    main()
