from PIL import Image as PILImage


def crop_image(pil_img: PILImage.Image, box: tuple) -> PILImage.Image:
    """Crops a PIL image to the given box and returns the cropped PIL image."""
    return pil_img.crop(box)


def resize_image(pil_img: PILImage.Image, size: tuple) -> PILImage.Image:
    """Resizes a PIL image to the given size and returns the resized PIL image."""
    return pil_img.resize(size)


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
