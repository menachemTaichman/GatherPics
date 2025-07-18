import boto3
from PIL import Image
from io import BytesIO

class FaceDetectorAWS:
    def __init__(self, config, max_width=3000, max_height=4000):
        self.rekognition = boto3.client('rekognition',
                                        aws_access_key_id=config['aws_access_key_id'],
                                        aws_secret_access_key=config['aws_secret_access_key'],
                                        region_name=config['region'])
        self.max_width = max_width
        self.max_height = max_height

    def _resize_image(self, img: Image.Image) -> BytesIO:
        orig_w, orig_h = img.size
        scale_w = self.max_width / orig_w if orig_w > self.max_width else 1.0
        scale_h = self.max_height / orig_h if orig_h > self.max_height else 1.0
        scale = min(scale_w, scale_h)

        if scale < 1.0:
            new_size = (int(orig_w * scale), int(orig_h * scale))
            img = img.resize(new_size, Image.Resampling.LANCZOS)

        buffer = BytesIO()
        img.save(buffer, format='JPEG', quality=90)
        buffer.seek(0)
        return buffer

    def detect_faces(self, image_path):
        with Image.open(image_path) as img:
            resized_img_buffer = self._resize_image(img)

        image_bytes = resized_img_buffer.read()

        response = self.rekognition.detect_faces(
            Image={'Bytes': image_bytes},
            Attributes=['DEFAULT']
        )
        return response['FaceDetails'], image_bytes