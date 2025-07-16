from PIL import Image as PILImage
import os
import copy

class Image:
    """
    Represents a single image and its metadata.
    """
    def __init__(self, image_ID: str, load: bool = True):
        self.image_ID = image_ID
        if load:
            self.load()
        else:
            self.name = ''
            self.date_taken = ''
            self.file_size = 0
            self.width = 0
            self.height = 0

    def edit_fields(self, fields: dict):
        """Edit fields of the Image object using a dict of key-value pairs."""
        for key, value in fields.items():
            if hasattr(self, key):
                setattr(self, key, value)

    def load(self) -> None:
        """Loads image data from JSON into self (uses self.image_ID)."""
        pass

    def save(self) -> None:
        """Saves current state to JSON."""
        pass

    def get_info(self) -> dict:
        """Returns metadata (date, size, resolution, etc.)."""
        return {
            'image_ID': self.image_ID,
            'name': self.name,
            'date_taken': self.date_taken,
            'file_size': self.file_size,
            'width': self.width,
            'height': self.height,
        }


    def is_broken(self) -> bool:
        """Checks if the image file is missing or corrupted."""
        return False

    def get_pil_image(self, version: str = 'original'):
        """Loads and returns a PIL.Image object for this image from local storage.
        version: 'original', 'display', or 'thumb' (default: 'original')
        """
        dir_map = ['original', 'display', 'thumb']
        if version not in dir_map:
            raise ValueError(f"Unknown version: {version}. Must be one of {dir_map}")
        image_path = os.path.join('src', 'data', version, f'{self.image_ID}.jpg')
        return PILImage.open(image_path)


class Images:
    """
    Manages a collection of Image objects.
    """
    def __init__(self):
        """Loads all images from JSON."""
        pass

    @staticmethod
    def get_next_id() -> str:
        """Returns the next available image ID."""
        return "img_00000"

    def add_image(self, name: str = '', date_taken: str = '', file_size: int = 0, width: int = 0, height: int = 0) -> Image:
        """Creates and adds a new Image object with optional fields, assigns a new image_ID, and saves it."""
        image = Image(image_ID=self.get_next_id(), load=False)
        image.edit_fields({'name': name, 'date_taken': date_taken, 'file_size': file_size, 'width': width, 'height': height})
        image.save()
        return image

    def delete_image(self, image_id: str) -> None:
        """Deletes an image and related data."""
        pass

    def find_broken_images(self) -> list[str]:
        """Returns a list of broken image IDs."""
        return []

    def get_image(self, image_id: str) -> 'Image':
        """Returns an Image object."""
        return Image(image_id)

    def list_images(self) -> list['Image']:
        """Returns all images."""
        return []
