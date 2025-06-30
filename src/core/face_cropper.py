import cv2
import os
import json

class FaceCropper:
    def __init__(self, images_dir, crops_dir):
        self.images_dir = images_dir
        self.crops_dir = crops_dir
        os.makedirs(crops_dir, exist_ok=True)

    def crop_face_from_image(self, image_path, face_coords):
        try:
            img = cv2.imread(image_path)
            if img is None:
                return None

            height, width = img.shape[:2]
            left = int(face_coords['Left'] * width)
            top = int(face_coords['Top'] * height)
            face_width = int(face_coords['Width'] * width)
            face_height = int(face_coords['Height'] * height)

            padding = 0.3
            pad_x = int(face_width * padding)
            pad_y = int(face_height * padding)

            x1 = max(0, left - pad_x)
            y1 = max(0, top - pad_y)
            x2 = min(width, left + face_width + pad_x)
            y2 = min(height, top + face_height + pad_y)

            face_crop = img[y1:y2, x1:x2]
            return face_crop

        except Exception as e:
            print(f"Error cropping face from {image_path}: {e}")
            return None

    def save_face_crop(self, face_crop, filename):
        if face_crop is None:
            return None
        try:
            crop_path = os.path.join(self.crops_dir, filename)
            cv2.imwrite(crop_path, face_crop)
            return filename
        except Exception as e:
            print(f"Error saving face crop {filename}: {e}")
            return None

    def create_crop_for_face(self, image_path, face_coords, face_id):
        face_crop = self.crop_face_from_image(image_path, face_coords)
        if face_crop is None:
            return None
        crop_filename = f"{face_id}.jpg"
        saved_name = self.save_face_crop(face_crop, crop_filename)
        return os.path.join(self.crops_dir, saved_name) if saved_name else None

    def cleanup_unused_crops(self, used_crops):
        try:
            existing_crops = set(os.listdir(self.crops_dir))
            used_crops_set = set(used_crops)
            unused_crops = existing_crops - used_crops_set
            for crop_file in unused_crops:
                crop_path = os.path.join(self.crops_dir, crop_file)
                if os.path.isfile(crop_path):
                    os.remove(crop_path)
                    print(f"Removed unused crop: {crop_file}")
        except Exception as e:
            print(f"Error cleaning up unused crops: {e}")

    def load_faces_output(self):
        faces_output_file = os.path.join(os.path.dirname(self.images_dir), 'faces_output.json')
        try:
            with open(faces_output_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}