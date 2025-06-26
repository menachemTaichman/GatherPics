import numpy as np
from sklearn.cluster import DBSCAN
import pickle
from sklearn.cluster import AgglomerativeClustering

class FaceClusterer:
    def __init__(self, encoding_file="data/encodings.pkl"):
        self.encoding_file = encoding_file
        with open(self.encoding_file, "rb") as f:
            self.data = pickle.load(f)

    def cluster_faces(self, eps=0.5, min_samples=1):
        encodings = [item['encoding'] for item in self.data]
        X = np.array(encodings)
        clustering = DBSCAN(metric='euclidean', eps=eps, min_samples=min_samples).fit(X)
        labels = clustering.labels_

        for item, label in zip(self.data, labels):
            item['label'] = int(label)

        print(f"👥 Grouped {len(set(labels))} groups")

    def save(self):
        with open(self.encoding_file, "wb") as f:
            pickle.dump(self.data, f)

    def cluster_faces_agglomerative(self, threshold=0.64):
        encodings = [item['encoding'] for item in self.data]
        X = np.array(encodings)

        model = AgglomerativeClustering(
            n_clusters=None,
            distance_threshold=threshold,
            metric='euclidean',
            linkage='average'
        )
        labels = model.fit_predict(X)

        for item, label in zip(self.data, labels):
            item['label'] = int(label)

        print(f"👥 Agglomerative clustering: {len(set(labels))} groups")

        return labels

