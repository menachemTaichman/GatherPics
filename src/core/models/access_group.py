class AccessGroup:
    """
    Represents an access group with limited data access.
    """
    def __init__(self, group_id: str):
        """Initialize with access group ID."""
        pass

    def load(self) -> None:
        """Loads access group data from JSON into self."""
        pass

    def save(self) -> None:
        """Saves current state to JSON."""
        pass

    def can_access_image(self, image_id: str) -> bool:
        """Checks if the group can access the image."""
        return False

    def can_access_face(self, face_id: str) -> bool:
        """Checks if the group can access the face."""
        return False

    def get_accessible_images(self) -> list[str]:
        """Returns accessible image IDs."""
        return []

    def get_accessible_faces(self) -> list[str]:
        """Returns accessible face IDs."""
        return []

    def get_info(self) -> dict:
        """Returns access group metadata."""
        return {}


class AccessGroups:
    """
    Manages a collection of AccessGroup objects.
    """
    def __init__(self):
        """Loads all access groups from JSON."""
        pass

    def add_access_group(self, access_group: AccessGroup) -> None:
        """Adds an access group and saves."""
        pass

    def delete_access_group(self, group_id: str) -> None:
        """Deletes an access group."""
        pass

    def get_access_group(self, group_id: str) -> 'AccessGroup':
        """Returns an AccessGroup object."""
        return AccessGroup(group_id)

    def list_access_groups(self) -> list['AccessGroup']:
        """Returns all access groups."""
        return []
