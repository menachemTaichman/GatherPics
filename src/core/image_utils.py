def compress_image(image_path: str, output_path: str) -> None:
    """Compresses an image and saves to output path."""
    pass


def crop_image(image_path: str, box: tuple) -> 'Image':
    """Crops an image to the given box and returns the cropped Image object."""
    pass


def resize_image(image_path: str, size: tuple) -> 'Image':
    """Resizes an image to the given size and returns the resized Image object."""
    pass


def validate_image(image_path: str) -> bool:
    """Validates if the image at the given path is valid (not corrupted, correct format, etc.)."""
    pass


def get_image_metadata(image_path: str) -> dict:
    """Returns metadata (date, size, resolution, etc.) for the image at the given path."""
    pass
