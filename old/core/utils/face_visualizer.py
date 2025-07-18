import os
from PIL import Image, ImageDraw
import matplotlib.pyplot as plt

class FaceVisualizer:
    @staticmethod
    def draw_faces_on_image(image_path, face_details):
        with Image.open(image_path) as img:
            img_w, img_h = img.size
            draw = ImageDraw.Draw(img)

            for face in face_details:
                box = face['BoundingBox']
                left = int(box['Left'] * img_w)
                top = int(box['Top'] * img_h)
                width = int(box['Width'] * img_w)
                height = int(box['Height'] * img_h)
                draw.rectangle([left, top, left + width, top + height], outline='red', width=3)

            img.show()

    @staticmethod
    def plot_face_clusters(clusters, image_dir):
        """
        clusters = {
            cluster_id1: [
                {'image_file': 'file1.jpg', 'box': {...}},
                {'image_file': 'file2.jpg', 'box': {...}},
            ],
            cluster_id2: [...],
            ...
        }
        """
        for cluster_id, faces in clusters.items():
            plt.figure(figsize=(15, 4))
            plt.suptitle(f'Cluster {cluster_id} - {len(faces)} faces')
            for i, face in enumerate(faces, 1):
                img_path = os.path.join(image_dir, face['image_file'])
                with Image.open(img_path) as img:
                    box = face['bounding_box']
                    img_w, img_h = img.size
                    left = int(box['Left'] * img_w)
                    top = int(box['Top'] * img_h)
                    width = int(box['Width'] * img_w)
                    height = int(box['Height'] * img_h)
                    face_crop = img.crop((left, top, left + width, top + height))
                    plt.subplot(1, len(faces), i)
                    plt.imshow(face_crop)
                    plt.title(face['image_file'])
                    plt.axis('off')
            plt.show()
