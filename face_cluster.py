import boto3

class FaceClusterAWS:
    def __init__(self, config, collection_id='my_face_collection'):
        self.rekognition = boto3.client('rekognition',
                                        aws_access_key_id=config['aws_access_key_id'],
                                        aws_secret_access_key=config['aws_secret_access_key'],
                                        region_name=config['region'])
        self.collection_id = collection_id
        self._create_collection_if_not_exists()

    def _create_collection_if_not_exists(self):
        existing = self.rekognition.list_collections()['CollectionIds']
        if self.collection_id not in existing:
            print(f"Creating collection {self.collection_id}")
            self.rekognition.create_collection(CollectionId=self.collection_id)

    def index_faces(self, image_bytes, external_image_id):
        try:
            response = self.rekognition.index_faces(
                CollectionId=self.collection_id,
                Image={'Bytes': image_bytes},
                ExternalImageId=external_image_id,
                DetectionAttributes=['DEFAULT']
            )
            return response['FaceRecords']
        except Exception as e:
            print(f"Error indexing face for {external_image_id}: {e}")
            return []

    def search_similar_faces(self, face_id, threshold=90, max_faces=10):
        try:
            response = self.rekognition.search_faces(
                CollectionId=self.collection_id,
                FaceId=face_id,
                FaceMatchThreshold=threshold,
                MaxFaces=max_faces
            )
            return response.get('FaceMatches', [])
        except Exception as e:
            print(f"Error searching similar faces for FaceId {face_id}: {e}")
            return []

    def clear_collection(self):
        response = self.rekognition.list_faces(CollectionId=self.collection_id)
        face_ids = [face['FaceId'] for face in response['Faces']]
        if face_ids:
            self.rekognition.delete_faces(CollectionId=self.collection_id, FaceIds=face_ids)
