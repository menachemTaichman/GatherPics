class Face:
    """
    Represents a single detected face.
    """
    def __init__(self, face_id: str):
        """Initialize with face ID."""
        pass

    def load(self) -> None:
        """Loads face data from JSON into self."""
        pass

    def save(self) -> None:
        """Saves current state to JSON."""
        pass

    def get_info(self) -> dict:
        """Returns face metadata (bounding box, group, etc.)."""
        return {}

    def delete(self) -> None:
        """Removes face and related data/files."""
        pass

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

    def get_next_id(self) -> str:
        """Returns the next available face ID."""
        return "face_00000"

    def add_face(self, face: Face) -> None:
        """Adds a face to the collection and saves."""
        pass

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
