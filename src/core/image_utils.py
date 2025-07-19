from PIL import Image as PILImage


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
    size is the minimum dimension of the resized image.
    """
    width, height = pil_img.size
    if width < height:
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
