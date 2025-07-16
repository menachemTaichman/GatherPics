import copy

class Face:
    """
    Represents a single detected face.
    """
    def __init__(self, face_ID: str, load: bool = True, AWS_face_ID: str = ''):
        self.face_ID = face_ID
        if load:
            self.load()
        else:
            self.image_ID = ''
            self.bbox = {}
            self.AWS_face_ID = AWS_face_ID

    def edit_fields(self, fields: dict):
        """Edit fields of the Face object using a dict of key-value pairs."""
        for key, value in fields.items():
            if hasattr(self, key):
                setattr(self, key, value)

    def load(self) -> None:
        """Loads face data from JSON into self."""
        pass

    def save(self) -> None:
        """Saves current state to JSON."""
        pass

    def get_info(self) -> dict:
        """Returns face metadata (bounding box, group, etc.)."""
        return {
            'face_ID': self.face_ID,
            'image_ID': self.image_ID,
            'bbox': copy.deepcopy(self.bbox),
            'AWS_face_ID': self.AWS_face_ID,
        }

    def is_broken(self) -> bool:
        """Checks if the face crop file is missing or corrupted."""
        return False


class Faces:
    """
    Manages a collection of Face objects.
    """
    def __init__(self):
        """Loads all faces from JSON."""
        pass
    
    @staticmethod
    def get_next_id() -> str:
        """Returns the next available face ID."""
        return "face_00000"

    def add_face(self, image_ID: str = '', bbox: dict = {}, AWS_face_ID: str = '') -> Face:
        """Creates and adds a new Face object with optional fields, assigns a new face_ID, and saves it."""
        face = Face(face_ID=self.get_next_id(), load=False)
        face.edit_fields({'image_ID': image_ID, 'bbox': bbox, 'AWS_face_ID': AWS_face_ID})
        face.save()
        return face

    def delete_face(self, face_id: str) -> None:
        """Deletes a face and related data."""
        pass

    def find_broken_faces(self) -> list[str]:
        """Returns a list of broken face IDs."""
        return []

    def get_face(self, face_id: str) -> 'Face':
        """Returns a Face object."""
        return Face(face_id)

    def list_faces(self) -> list['Face']:
        """Returns all faces."""
        return []
