from typing import List, Dict
from PIL import Image as PILImage
from .base_model import BaseModel
from .event import Event

class Images(BaseModel):
    def __init__(self, event: Event):
        super().__init__(event, table_name='images', id_field='imageID')

    def get_add_data(self, name: str = '', date_taken: str = '', file_size: int = 0, width: int = 0, height: int = 0) -> Dict:
        return {
            'name': name,
            'date_taken': date_taken,
            'file_size': file_size,
            'width': width,
            'height': height,
        }

    def find_broken_images(self) -> List[str]:
        # Implement logic if needed
        return []

    def get_pil_image(self, image_id: str, version: str = 'original') -> 'PILImage.Image':
        import os
        from PIL import Image as PILImage
        image_path = os.path.join('src', 'data', version, f'{image_id}.jpg')
        return PILImage.open(image_path)
