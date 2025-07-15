from PIL import Image
import os

class ImageCompressor:
    def __init__(self, original_dir, display_dir, thumb_dir):
        self.original_dir = original_dir
        self.display_dir = display_dir
        self.thumb_dir = thumb_dir
        os.makedirs(original_dir, exist_ok=True)
        os.makedirs(display_dir, exist_ok=True)
        os.makedirs(thumb_dir, exist_ok=True)

    def save_versions(self, image_path, generic_filename):
        """
        Given an input image_path and a generic filename (e.g., img_00001.jpg),
        save three versions (original, display, thumb) in their respective folders.
        Returns a dict with relative paths for each version.
        """
        # Save original (copy)
        original_out = os.path.join(self.original_dir, generic_filename)
        with Image.open(image_path) as img:
            img.convert('RGB').save(original_out, format='JPEG', quality=95)

        # Save display version (width ≈ 1600px)
        display_out = os.path.join(self.display_dir, generic_filename)
        with Image.open(image_path) as img:
            img = self._resize_to_width(img, 1600)
            img.convert('RGB').save(display_out, format='JPEG', quality=90)

        # Save thumbnail version (width ≈ 400px)
        thumb_out = os.path.join(self.thumb_dir, generic_filename)
        with Image.open(image_path) as img:
            img = self._resize_to_width(img, 400)
            img.convert('RGB').save(thumb_out, format='JPEG', quality=85)

        return {
            'original_path': generic_filename,
            'display_path': generic_filename,
            'thumb_path': generic_filename
        }

    def _resize_to_width(self, img, target_width):
        w, h = img.size
        if w <= target_width:
            return img.copy()
        aspect = h / w
        new_h = int(target_width * aspect)
        return img.resize((target_width, new_h), Image.Resampling.LANCZOS) 