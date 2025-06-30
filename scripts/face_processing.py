import json
import os
import re
import shutil
from src.core.face_detector import FaceDetectorAWS
from src.core.face_cluster import FaceClusterAWS
from src.core.face_cropper import FaceCropper
from src.utils.face_visualizer import FaceVisualizer

def sanitize_external_image_id(filename):
    return re.sub(r'[^a-zA-Z0-9_.\-:]', '_', filename)

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
    visualizer = FaceVisualizer()

    clusterer.clear_collection()
    face_id_map = {}
    crop_path_map = {}
    print("Indexing faces into collection...")

    for filename in image_files:
        image_path = os.path.join(image_dir, filename)
        face_details, image_bytes = detector.detect_faces(image_path)
        clean_id = sanitize_external_image_id(filename)
        face_records = clusterer.index_faces(image_bytes, external_image_id=clean_id)

        for face_detail, face_record in zip(face_details, face_records):
            face_id = face_record['Face']['FaceId']
            bounding_box = face_detail['BoundingBox']
            face_id_map[face_id] = {'image_file': filename, 'box': bounding_box}
            crop_path = cropper.create_crop_for_face(image_path, bounding_box, face_id)
            crop_path_map[face_id] = crop_path

    print(f"Indexed {len(face_id_map)} faces.")

    clusters = []
    visited = set()

    for face_id in face_id_map:
        if face_id in visited:
            continue
        matches = clusterer.search_similar_faces(face_id)
        group = {face_id}
        for match in matches:
            fid = match['Face']['FaceId']
            if fid != face_id:
                group.add(fid)
        visited.update(group)
        clusters.append(group)

    print(f"Found {len(clusters)} clusters.")

    clusters_mapped = {}
    for idx, cluster in enumerate(clusters):
        image_files_in_cluster = []
        representative_crop = None
        for fid in cluster:
            info = face_id_map.get(fid)
            if not info:
                continue
            if not representative_crop:
                representative_crop = crop_path_map.get(fid)
            image_files_in_cluster.append(info['image_file'])

        label = f"Person_{idx}"
        clusters_mapped[idx] = []
        cluster_id = clusterer.add_cluster(label, representative_crop, list(set(image_files_in_cluster)))

        for fid in cluster:
            info = face_id_map.get(fid)
            if not info:
                continue
            clusterer.add_face(fid, info['image_file'], cluster_id, info['box'], crop_path_map.get(fid))
            clusters_mapped[idx].append({
                'image_file': info['image_file'],
                'bounding_box': info['box']
            })

    clusterer.save_json()
    # visualizer.plot_face_clusters(clusters_mapped, image_dir)

if __name__ == '__main__':
    main()
