import os
import pickle
import face_recognition
import matplotlib.pyplot as plt

class FaceViewer:
    def __init__(self, encoding_file="data/encodings.pkl", image_dir="data/processed"):
        self.encoding_file = encoding_file
        self.image_dir = image_dir

        with open(self.encoding_file, "rb") as f:
            self.data = pickle.load(f)

        self.grouped = self._group_by_label()

    def _group_by_label(self):
        grouped = {}
        for item in self.data:
            label = item['label']
            grouped.setdefault(label, []).append(item)
        return grouped

    def show_groups(self, max_groups=5, max_per_group=5):
        shown = 0
        for label, items in sorted(self.grouped.items())[:max_groups]:
            print(f"\n👤 Group {label} – showing {min(len(items), max_per_group)} face(s)")
            plt.figure(figsize=(15, 3))

            for i, item in enumerate(items[:max_per_group]):
                img_path = os.path.join(self.image_dir, item['path'])
                if not os.path.exists(img_path):
                    continue

                image = face_recognition.load_image_file(img_path)
                top, right, bottom, left = item['location']
                face_crop = image[top:bottom, left:right]

                ax = plt.subplot(1, max_per_group, i+1)
                ax.imshow(face_crop)
                ax.axis("off")
                ax.set_title(item['path'], fontsize=8)

            plt.suptitle(f"Group {label}", fontsize=16)
            plt.tight_layout()
            plt.show()
            shown += 1

            if shown >= max_groups:
                break
