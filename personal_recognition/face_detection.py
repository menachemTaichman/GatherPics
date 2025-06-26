import os
import face_recognition
import pickle
import shutil
import cv2

class FaceDetector:
    def __init__(self, raw_dir="data/raw", processed_dir="data/processed", output_file="data/encodings.pkl"):
        self.raw_dir = raw_dir
        self.processed_dir = processed_dir
        self.output_file = output_file
        self.data = []

        if os.path.exists(self.output_file):
            with open(self.output_file, "rb") as f:
                self.data = pickle.load(f)

    def resize_image_keep_ratio(self, image, max_dim=1000):
        height, width = image.shape[:2]
        scale = max_dim / max(width, height)
        if scale < 1.0:
            new_size = (int(width * scale), int(height * scale))
            resized = cv2.resize(image, new_size)
            return resized, scale
        else:
            return image.copy(), 1.0

    def detect_faces(self):
        existing_files = {item['path'] for item in self.data}
        current_raw = set(os.listdir(self.raw_dir))

        new_files = [f for f in current_raw if f not in existing_files and f.lower().endswith(('.jpg', '.jpeg', '.png'))]
        print(f"🔍 Found {len(new_files)} new files to recognize")

        for i, filename in enumerate(new_files, start=1):
            print(f"🧠 Processing image {i} of {len(new_files)}: {filename}")
            path = os.path.join(self.raw_dir, filename)
            image = face_recognition.load_image_file(path)

            resized_image, scale = self.resize_image_keep_ratio(image, max_dim=1000)

            locations = face_recognition.face_locations(resized_image, model='cnn')
            # המרת מיקומים חזרה לתמונה המקורית
            original_locations = [
                (
                    int(top / scale),
                    int(right / scale),
                    int(bottom / scale),
                    int(left / scale)
                )
                for (top, right, bottom, left) in locations
            ]
            encodings = face_recognition.face_encodings(image, original_locations)

            print(f"   ➕ Found {len(locations)} face(s)")

            for loc, enc in zip(original_locations, encodings):
                self.data.append({
                    'path': filename,
                    'encoding': enc,
                    'location': loc,
                    'label': None
                })

            shutil.move(path, os.path.join(self.processed_dir, filename))

    def cleanup_removed(self):
        existing_files = set(os.listdir(self.processed_dir))
        before = len(self.data)
        self.data = [item for item in self.data if item['path'] in existing_files]
        after = len(self.data)
        print(f"🧹 Removed {before - after} items that no longer exist")

    def save(self):
        with open(self.output_file, "wb") as f:
            pickle.dump(self.data, f)
