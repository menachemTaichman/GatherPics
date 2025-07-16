class Group:
    """
    Represents a group (cluster) of faces.
    """
    def __init__(self, group_id: str):
        """Initialize with group ID."""
        pass

    def load(self) -> None:
        """Loads group data from JSON into self."""
        pass

    def save(self) -> None:
        """Saves current state to JSON."""
        pass

    def add_face(self, face_id: str) -> None:
        """Adds a face to the group."""
        pass

    def remove_face(self, face_id: str) -> None:
        """Removes a face from the group."""
        pass

    def get_faces(self) -> list[str]:
        """Returns all face IDs in the group."""
        return []

    def get_info(self) -> dict:
        """Returns group metadata."""
        return {}


class Groups:
    """
    Manages a collection of Group objects.
    """
    def __init__(self):
        """Loads all groups from JSON."""
        pass

    def add_group(self, group: Group) -> None:
        """Adds a group to the collection and saves."""
        pass

    def delete_group(self, group_id: str) -> None:
        """Deletes a group and related data."""
        pass

    def merge_groups(self, group_ids: list[str]) -> str:
        """Merges a list of groups into one (returns new group ID)."""
        return ""

    def find_overlaps(self) -> list[list[str]]:
        """Returns lists of group IDs with overlapping faces."""
        return []

    def get_group(self, group_id: str) -> 'Group':
        """Returns a Group object."""
        return Group(group_id)

    def list_groups(self) -> list['Group']:
        """Returns all groups."""
        return []

    @staticmethod
    def get_next_ID() -> str:
        """Returns the next available group ID."""
        return ""
