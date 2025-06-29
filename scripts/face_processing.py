import json
import os
import re
from src.core.face_detector import FaceDetectorAWS
from src.core.face_cluster import FaceClusterAWS
from src.utils.face_visualizer import FaceVisualizer

def sanitize_external_image_id(filename):
    return re.sub(r'[^a-zA-Z0-9_.\-:]', '_', filename)

def main():

    with open('config/aws_config.json') as f:
        config = json.load(f)

    image_dir = 'src/data/images'
    image_files = [f for f in os.listdir(image_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]

    detector = FaceDetectorAWS(config)
    clusterer = FaceClusterAWS(config)
    clusterer.clear_collection()
    visualizer = FaceVisualizer()

    # שלב 1: אינדוקס כל הפנים עם מזהים ייחודיים
    face_id_map = {}  # Map: FaceId -> {'image_file': ..., 'box': ...}
    print("Indexing faces into collection...")

    for filename in image_files:
        image_path = os.path.join(image_dir, filename)
        face_details, image_bytes = detector.detect_faces(image_path)
        # לאינדקס חייבים את התמונות המוקטנות כמו לזיהוי - משתמשים ב image_bytes
        clean_id = sanitize_external_image_id(filename)
        face_records = clusterer.index_faces(image_bytes, external_image_id=clean_id)
        for fr in face_records:
            face_id = fr['Face']['FaceId']
            bounding_box = fr['Face']['BoundingBox']
            face_id_map[face_id] = {'image_file': filename, 'box': bounding_box}

    print(f"Indexed {len(face_id_map)} faces.")

    # שלב 2: חיפוש דומים לבניית קבוצות
    clusters = []
    visited = set()

    for face_id in face_id_map.keys():
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

    # ממפה cluster_id -> רשימת פרטים
    clusters_mapped = {}
    for idx, cluster in enumerate(clusters):
        image_files_in_cluster = []
        representative_image = None
        for fid in cluster:
            info = face_id_map.get(fid)
            if not info:
                continue
            if not representative_image:
                representative_image = info['image_file']
            image_files_in_cluster.append(info['image_file'])
        label = f"Person_{idx}"
        clusters_mapped[idx] = []
        cluster_id = clusterer.add_cluster(label, representative_image, list(set(image_files_in_cluster)))
        for fid in cluster:
            info = face_id_map.get(fid)
            if not info:
                continue
            clusterer.add_face(fid, info['image_file'], cluster_id, info['box'])
            clusters_mapped[idx].append({
                'image_file': info['image_file'],
                'bounding_box': info['box']
            })
    clusterer.save_json()

    # שלב 3: הצגה
    visualizer.plot_face_clusters(clusters_mapped, image_dir)

if __name__ == '__main__':
    main()
