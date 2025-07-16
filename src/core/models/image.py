class Image:
    """
    Represents a single image and its metadata.
    """
    def __init__(self, image_id: str):
        """Initialize with image ID."""
        pass

    def load(self) -> None:
        """Loads image data from JSON into self (uses self.image_id)."""
        pass

    def save(self) -> None:
        """Saves current state to JSON."""
        pass

    def get_info(self) -> dict:
        """Returns metadata (date, size, resolution, etc.)."""
        return {}

    def delete(self) -> None:
        """Removes image and related data/files."""
        pass

    def is_broken(self) -> bool:
        """Checks if the image file is missing or corrupted."""
        return False


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

    def add_image(self, image: Image) -> None:
        """Adds an image to the collection and saves."""
        pass

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
