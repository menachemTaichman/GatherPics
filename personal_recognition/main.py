from face_detection import FaceDetector
from face_clustering import FaceClusterer
from face_viewer import FaceViewer

def main():
    detector = FaceDetector()
    detector.cleanup_removed()
    detector.detect_faces()
    detector.save()

    clusterer = FaceClusterer()
    #clusterer.cluster_faces()
    clusterer.cluster_faces_agglomerative()
    clusterer.save()

    viewer = FaceViewer()
    viewer.show_groups(max_groups=99, max_per_group=10)


if __name__ == "__main__":
    main()
    print('Finish')