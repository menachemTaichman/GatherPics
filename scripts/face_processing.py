import json
import os
import shutil
import sys

# Add the current directory to Python path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.core.face_detector import FaceDetectorAWS
from src.core.face_cluster import FaceClusterAWS
from src.core.face_cropper import FaceCropper
from src.core.image_compressor import ImageCompressor
from PIL import Image
import piexif
import glob
from src.core.face_utils_old import (
    sanitize_external_image_id,
    calculate_iou,
    remove_duplicate_faces,
    get_image_metadata,
    merge_groups_logic,
    find_missing_images,
    delete_image_and_related,
    cleanup_missing_images,
    get_next_face_id,
    detect_faces_in_image,
    get_next_group_id
)

def main():
    print("Checking for missing images and cleaning up...")
    num_missing = 0
    images_json_path = os.path.join('src', 'data', 'images.json')
    original_dir = os.path.join('src', 'data', 'original')
    missing = find_missing_images(images_json_path, original_dir)
    num_missing = len(missing)
    if num_missing > 0:
        print(f"Found {num_missing} images in images.json that no longer exist in original. Deleting...")
    else:
        print("No missing images found.")
    cleanup_missing_images()

    with open('config/aws_config.json') as f:
        config = json.load(f)

    to_process_dir = 'src/data/to_process'
    os.makedirs(to_process_dir, exist_ok=True)
    original_dir = 'src/data/original'
    crop_dir = 'src/data/crops'
    display_dir = 'src/data/display'
    thumb_dir = 'src/data/thumb'
    
    # Only process images from to_process_dir
    image_files = [f for f in os.listdir(to_process_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    print(f"Found {len(image_files)} new photos to process.")

    print("Clearing and recreating crops, display, and thumb folders...")
    shutil.rmtree(crop_dir, ignore_errors=True)
    os.makedirs(crop_dir, exist_ok=True)
    os.makedirs(display_dir, exist_ok=True)
    os.makedirs(thumb_dir, exist_ok=True)

    detector = FaceDetectorAWS(config)
    clusterer = FaceClusterAWS(config)
    cropper = FaceCropper(display_dir, crop_dir)  # Use display images for cropping
    compressor = ImageCompressor(original_dir, display_dir, thumb_dir)

    clusterer.clear_collection()
    print("Indexing faces into collection...")

    # Scan faces.json for the highest used faceID
    faces_json_path = os.path.join('src', 'data', 'faces.json')
    if os.path.exists(faces_json_path):
        with open(faces_json_path, 'r', encoding='utf-8') as f:
            faces_data = json.load(f)
        existing_face_ids = [int(face['faceID'][5:]) for face in faces_data.get('faces', []) if face['faceID'].startswith('face_') and face['faceID'][5:].isdigit()]
        next_face_index = max(existing_face_ids) + 1 if existing_face_ids else 0
    else:
        next_face_index = 0
    print(f"Next available face index: {next_face_index}")

    # For group creation, use get_next_group_id
    groups_json_path = os.path.join('src', 'data', 'groups.json')
    group_id_counter = get_next_group_id(groups_json_path)
    print(f"Next available group index: {group_id_counter}")

    # Step 1: Preprocess images and build metadata
    print("Compressing and moving new images...")
    image_metadata = []
    generic_filenames = []
    for idx, filename in enumerate(image_files):
        try:
            image_path = os.path.join(to_process_dir, filename)
            generic_filename = f"img_{next_face_index+idx:05d}.jpg"
            generic_filenames.append(generic_filename)
            # Move image to original_dir after processing
            dest_path = os.path.join(original_dir, generic_filename)
            shutil.move(image_path, dest_path)
            print(f"Moved {filename} to {dest_path}")
            paths = compressor.save_versions(dest_path, generic_filename)
            date_taken, file_size, width, height = get_image_metadata(dest_path)
            image_metadata.append({
                "imageID": f"img_{next_face_index+idx:03d}",
                "name": filename,  # original filename
                "original_path": f"original/{generic_filename}",
                "display_path": f"display/{generic_filename}",
                "thumb_path": f"thumb/{generic_filename}",
                "date_taken": date_taken,
                "file_size": file_size,
                "width": width,
                "height": height
            })
            print(f"Processed and moved {filename} to original as {generic_filename}")
        except Exception as e:
            print(f"Error processing {filename}: {e}")

    print("Finding faces in new images...")
    # Step 2: Detect faces and index them, create crops, and build face info
    face_info_list = []
    faces_json_path = os.path.join('src', 'data', 'faces.json')
    face_id_counter = None
    for idx, filename in enumerate(image_files):
        try:
            generic_filename = generic_filenames[idx]
            display_image_path = os.path.join(display_dir, generic_filename)
            face_details, image_bytes = detect_faces_in_image(detector, display_image_path)
            clean_id = sanitize_external_image_id(filename)
            face_records = clusterer.index_faces(image_bytes, external_image_id=clean_id)
            for face_detail, face_record in zip(face_details, face_records):
                bounding_box = face_detail['BoundingBox']
                image_id = clusterer.add_image(filename)
                face_id = get_next_face_id(faces_json_path)
                crop_filename = cropper.create_crop_for_face(display_image_path, bounding_box, face_id)
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
                    'face_id': face_id
                })
            print(f"Detected and indexed faces for {filename}")
        except Exception as e:
            print(f"Error detecting faces for {filename}: {e}")

    print(f"Indexed {len(face_info_list)} faces.")

    print("Clustering faces...")
    # Step 3: Cluster faces using Rekognition with improved logic
    clusters = []
    visited = set()
    rek_face_id_to_face_info = {f['rek_face_id']: f for f in face_info_list}

    for face_info in face_info_list:
        rek_face_id = face_info['rek_face_id']
        if rek_face_id in visited:
            continue
        matches = clusterer.search_similar_faces(rek_face_id, threshold=85, max_faces=20)
        group = {rek_face_id}
        for match in matches:
            fid = match['Face']['FaceId']
            if fid != rek_face_id and fid in rek_face_id_to_face_info:
                group.add(fid)
        visited.update(group)
        clusters.append(group)

    print(f"Found {len(clusters)} clusters.")

    print("Creating groups and adding faces...")
    # Step 4: Create groups, faces, and images in the new structure
    for idx, cluster in enumerate(clusters):
        label = f"Person_{group_id_counter}"
        group_face_ids = []
        representative_face_id = None
        representative_image_id = None
        for i, rek_face_id in enumerate(cluster):
            face_info = rek_face_id_to_face_info.get(rek_face_id)
            if not face_info:
                continue
            face_id = clusterer.add_face(
                image_id=face_info['image_id'],
                group_id=group_id_counter,
                crop_filename=face_info['crop_filename'],
                width=face_info['width'],
                height=face_info['height'],
                left=face_info['left'],
                top=face_info['top'],
                face_id=face_info['face_id']
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
        group_id_counter += 1

    print("Merging groups with duplicate faces...")
    # Step 5: Post-process to merge groups with duplicate faces
    merge_groups_logic(clusterer)

    print("Saving updated images.json and group/face data...")
    # Save updated images.json with new fields
    images_json_path = os.path.join('src', 'data', 'images.json')
    os.makedirs(os.path.dirname(images_json_path), exist_ok=True)
    # Load existing images.json after cleanup
    if os.path.exists(images_json_path):
        with open(images_json_path, 'r', encoding='utf-8') as f:
            existing_data = json.load(f)
        existing_images = existing_data.get('images', [])
    else:
        existing_images = []
    # Build a dict to avoid duplicates by imageID
    images_by_id = {img['imageID']: img for img in existing_images}
    for img in image_metadata:
        images_by_id[img['imageID']] = img
    all_images = list(images_by_id.values())
    with open(images_json_path, 'w', encoding='utf-8') as f:
        json.dump({"images": all_images}, f, ensure_ascii=False, indent=2)
    print(f"✅ Saved images.json to {images_json_path}")

    clusterer.save_json()
    print("✅ Saved new images, groups, and faces JSON files.")

if __name__ == '__main__':
    main()
