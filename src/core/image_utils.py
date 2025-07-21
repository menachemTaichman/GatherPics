from PIL import Image as PILImage
from PIL.ExifTags import TAGS

def crop_image(pil_img: PILImage.Image, box: dict, padding_width: int = 0, padding_height: int = 0) -> PILImage.Image:
    """Crops a PIL image to the given box and returns the cropped PIL image."""
    """Args:
        pil_img: PILImage.Image - the image to crop
        box: dict - the box to crop the image to, must be in the format of the AWS Rekognition API
        padding_width: int - the width of the padding to add to the box
        padding_height: int - the height of the padding to add to the box
    """
    width, height = pil_img.size
    bbox = (
            max(0, int(box['Left'] * width - padding_width)),
            max(0, int(box['Top'] * height - padding_height)),
            min(width, int((box['Left'] + box['Width']) * width + padding_width * 2)),
            min(height, int((box['Top'] + box['Height']) * height + padding_height * 2))
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


def get_image_metadata(pil_img: PILImage.Image) -> dict:
    """Returns metadata (mode, size, format) for the given PIL image."""
    try:
        width, height = pil_img.size
        mode = pil_img.mode
        fmt = pil_img.format
        return {"width": width, "height": height, "mode": mode, "format": fmt}
    except Exception:
        return {}


def extract_all_metadata(pil_img: PILImage.Image) -> dict:
    """Extracts all metadata from a PIL image, including EXIF and date_taken (if found)."""
    metadata = get_image_metadata(pil_img)
    exif_data = {}
    date_taken = None
    try:
        exif = pil_img.getexif()
        if exif:
            for tag_id, value in exif.items():
                tag = TAGS.get(tag_id, tag_id)
                exif_data[tag] = value
            # Try to extract date_taken from common EXIF tags
            for tag in ['DateTimeOriginal', 'DateTime', 'DateTimeDigitized']:
                if tag in exif_data:
                    date_str = exif_data[tag]
                    if date_str and isinstance(date_str, str):
                        # EXIF dates: "YYYY:MM:DD HH:MM:SS" -> "YYYY-MM-DD HH:MM:SS"
                        if ':' in date_str and len(date_str) >= 19:
                            date_taken = date_str.replace(':', '-', 2)
                            break
    except Exception:
        pass
    metadata['exif'] = exif_data
    if date_taken:
        metadata['date_taken'] = date_taken
    return metadata


def save_image(
    pil_img: PILImage.Image,
    path: str,
    exif: bytes = b'',
    format: str = 'JPEG',
    quality: int = 80,
    optimize: bool = True,
    extra_metadata: dict = {},
) -> None:
    """
    Save a PIL image to disk with options for EXIF, format, quality, optimization, and extra metadata.
    Args:
        pil_img: PIL image to save
        path: Output file path
        exif: EXIF bytes to embed (optional, default b'')
        format: Output format (e.g., 'JPEG', 'WEBP')
        quality: Quality (default 80)
        optimize: Use optimization (default True)
        extra_metadata: Dict of additional metadata to embed (not all formats support this, default empty dict)
    """
    save_kwargs = {'format': format, 'quality': quality, 'optimize': optimize}
    if exif and format.upper() == 'JPEG':
        save_kwargs['exif'] = exif
    if extra_metadata and format.upper() == 'WEBP':
        for k, v in extra_metadata.items():
            save_kwargs[k] = v
    pil_img.save(path, **save_kwargs)
