import copy

class Group:
    """
    Represents a group (cluster) of faces.
    """
    def __init__(self, group_ID: str, load: bool = True):
        self.group_ID = group_ID
        if load:
            self.load()
        else:
            self.label = ''
            self.face_representive = ''
            self.face_IDs = []

    def edit_fields(self, fields: dict):
        """Edit fields of the Group object using a dict of key-value pairs."""
        for key, value in fields.items():
            if hasattr(self, key):
                setattr(self, key, value)

    def load(self) -> None:
        """Loads group data from JSON into self."""
        pass

    def save(self) -> None:
        """Saves current state to JSON."""
        pass

    def add_face(self, face_id: str) -> None:
        """Adds a face to the group."""
        if face_id not in self.face_IDs:
            self.face_IDs.append(face_id)

    def remove_face(self, face_id: str) -> None:
        """Removes a face from the group."""
        if face_id in self.face_IDs:
            self.face_IDs.remove(face_id)

    def get_faces(self) -> list:
        """Returns all face IDs in the group."""
        return self.face_IDs

    def get_info(self) -> dict:
        """Returns group metadata."""
        return {
            'group_ID': self.group_ID,
            'label': self.label,
            'face_representive': self.face_representive,
            'face_IDs': self.face_IDs
        }

class Groups:
    """
    Manages a collection of Group objects.
    """
    def __init__(self):
        """Loads all groups from JSON."""
        pass

    def add_group(self, label: str = '', face_representive: str = '', face_IDs: list = []) -> Group:
        """Creates and adds a new Group object with optional fields, assigns a new group_ID, and saves it."""
        group = Group(group_ID=self.get_next_ID(), load=False)
        group.edit_fields({'label': label, 'face_representive': face_representive, 'face_IDs': face_IDs})
        group.save()
        return group

    def delete_group(self, group_id: str) -> None:
        """Deletes a group and related data."""
        pass

    def merge_groups(self, group_ids: list) -> str:
        """Merges a list of groups into one (returns new group ID)."""
        return ''

    def find_overlaps(self) -> list:
        """Returns lists of group IDs with overlapping faces."""
        return []

    def get_group(self, group_id: str) -> 'Group':
        """Returns a Group object."""
        return Group(group_id)

    def list_groups(self) -> list:
        """Returns all groups."""
        return []

    @staticmethod
    def get_next_ID() -> str:
        """Returns the next available group ID."""
        return ''
