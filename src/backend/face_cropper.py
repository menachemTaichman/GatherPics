import cv2
import os
import json

class FaceCropper:
    def __init__(self, images_dir, crops_dir):
        self.images_dir = images_dir
        self.crops_dir = crops_dir
        
        # Create crops directory if it doesn't exist
        os.makedirs(crops_dir, exist_ok=True)
    
    def crop_face_from_image(self, image_path, face_coords):
        """Crop a face from an image using the provided coordinates"""
        try:
            # Load image
            img = cv2.imread(image_path)
            if img is None:
                return None
            
            height, width = img.shape[:2]
            
            # Convert relative coordinates to absolute
            left = int(face_coords['Left'] * width)
            top = int(face_coords['Top'] * height)
            face_width = int(face_coords['Width'] * width)
            face_height = int(face_coords['Height'] * height)
            
            # Add some padding around the face (30% padding)
            padding = 0.3
            pad_x = int(face_width * padding)
            pad_y = int(face_height * padding)
            
            # Calculate crop coordinates with padding
            x1 = max(0, left - pad_x)
            y1 = max(0, top - pad_y)
            x2 = min(width, left + face_width + pad_x)
            y2 = min(height, top + face_height + pad_y)
            
            # Crop the face
            face_crop = img[y1:y2, x1:x2]
            
            return face_crop
            
        except Exception as e:
            print(f"Error cropping face from {image_path}: {e}")
            return None
    
    def save_face_crop(self, face_crop, filename):
        """Save a face crop to the crops directory"""
        if face_crop is None:
            return None
        
        try:
            crop_path = os.path.join(self.crops_dir, filename)
            cv2.imwrite(crop_path, face_crop)
            return filename
        except Exception as e:
            print(f"Error saving face crop {filename}: {e}")
            return None
    
    def create_representative_crop(self, image_path, face_coords):
        """Create a representative face crop for an image using provided coordinates"""
        try:
            if face_coords is None:
                print(f"No face coordinates provided for {image_path}")
                return None
            
            # Crop the face
            face_crop = self.crop_face_from_image(image_path, face_coords)
            if face_crop is None:
                return None
            
            # Generate filename
            base_name = os.path.splitext(os.path.basename(image_path))[0]
            crop_filename = f"{base_name}_crop.jpg"
            
            # Save the crop
            return self.save_face_crop(face_crop, crop_filename)
            
        except Exception as e:
            print(f"Error creating representative crop for {image_path}: {e}")
            return None
    
    def cleanup_unused_crops(self, used_crops):
        """Remove crop files that are no longer being used"""
        try:
            existing_crops = set(os.listdir(self.crops_dir))
            used_crops_set = set(used_crops)
            
            # Find unused crops
            unused_crops = existing_crops - used_crops_set
            
            # Remove unused crops
            for crop_file in unused_crops:
                crop_path = os.path.join(self.crops_dir, crop_file)
                if os.path.isfile(crop_path):
                    os.remove(crop_path)
                    print(f"Removed unused crop: {crop_file}")
                    
        except Exception as e:
            print(f"Error cleaning up unused crops: {e}")
    
    def load_faces_output(self):
        """Load faces output data"""
        faces_output_file = os.path.join(os.path.dirname(self.images_dir), 'faces_output.json')
        try:
            with open(faces_output_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            return {}
        except json.JSONDecodeError:
            return {} 