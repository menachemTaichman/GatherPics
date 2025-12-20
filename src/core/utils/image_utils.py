from PIL import Image as PILImage
import exifread
import os
from io import BytesIO

def crop_image(pil_img: PILImage.Image, box: dict, padding_width_percent: float = 0.0, padding_height_percent: float = 0.0) -> PILImage.Image:
    """Crops a PIL image to the given box and returns the cropped PIL image."""
    """Args:
        pil_img: PILImage.Image - the image to crop
        box: dict - the box to crop the image to: left, top, width, height as a percentage of the image size
        padding_width_percent: float - the width of the padding to add to the box as a percentage of the box width
        padding_height_percent: float - the height of the padding to add to the box as a percentage of the box height
    """
    width, height = pil_img.size
    # Calculate box in pixels
    left = box['left'] * width
    top = box['top'] * height
    box_width = box['width'] * width
    box_height = box['height'] * height
    # Calculate padding in pixels (as percent of box size)
    pad_w = box_width * padding_width_percent
    pad_h = box_height * padding_height_percent
    bbox = (
        max(0, int(left - 0.5 * pad_w)),
        max(0, int(top - 0.5 * pad_h)),
        min(width, int(left + box_width + pad_w)),
        min(height, int(top + box_height + pad_h))
    )
    return pil_img.crop(bbox)


def resize_image(pil_img: PILImage.Image, size: int) -> PILImage.Image:
    """Resizes a PIL image to the given size and returns the resized PIL image
    The image is resized to the given size while maintaining the aspect ratio.
    size is the maximum dimension of the resized image.
    """
    width, height = pil_img.size
    if width > height:
        new_width = size
        new_height = int(height * (size / width))
    else:
        new_height = size
        new_width = int(width * (size / height))
    return pil_img.resize((new_width, new_height))


def validate_image(pil_img: PILImage.Image) -> bool:
    """Validates if the PIL image is valid (not corrupted, correct format, etc.)."""
    try:
        pil_img.verify()
        return True
    except Exception:
        return False

def extract_metadata_from_bytes(image_bytes: bytes) -> dict:
    """Extract metadata including accurate date_taken using exifread from bytes.
    
    Args:
        image_bytes: Image data as bytes
        
    Returns:
        dict: Metadata dictionary with 'date_taken' and 'exif' keys
    """
    metadata = {}
    exif_data = {}
    date_taken = None

    try:
        with BytesIO(image_bytes) as image_stream:
            tags = exifread.process_file(image_stream, stop_tag='UNDEF', details=False)
            for tag, value in tags.items():
                exif_data[tag] = str(value)

            # Prefer DateTimeOriginal if available
            for tag in ['EXIF DateTimeOriginal', 'EXIF DateTimeDigitized', 'Image DateTime']:
                if tag in tags:
                    date_str = str(tags[tag])
                    if ':' in date_str and len(date_str) >= 19:
                        date_taken = date_str.replace(':', '-', 2)
                        break

    except Exception as e:
        metadata['error'] = str(e)

    metadata['exif'] = exif_data
    if date_taken:
        metadata['date_taken'] = date_taken

    return metadata

def extract_all_metadata(image_path: str) -> dict:
    """Extract metadata including accurate date_taken using exifread."""
    metadata = {
        'file_path': image_path,
        'file_name': os.path.basename(image_path),
        'file_size': os.path.getsize(image_path),
    }

    exif_data = {}
    date_taken = None

    try:
        with open(image_path, 'rb') as f:
            tags = exifread.process_file(f, stop_tag='UNDEF', details=False)
            for tag, value in tags.items():
                exif_data[tag] = str(value)

            # Prefer DateTimeOriginal if available
            for tag in ['EXIF DateTimeOriginal', 'EXIF DateTimeDigitized', 'Image DateTime']:
                if tag in tags:
                    date_str = str(tags[tag])
                    if ':' in date_str and len(date_str) >= 19:
                        date_taken = date_str.replace(':', '-', 2)
                        break

    except Exception as e:
        metadata['error'] = str(e)

    metadata['exif'] = exif_data
    if date_taken:
        metadata['date_taken'] = date_taken

    return metadata
