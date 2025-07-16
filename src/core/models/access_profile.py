class AccessProfile:
    """
    Represents an access profile with limited data access.
    """
    def __init__(self, profile_id: str):
        """Initialize with access profile ID."""
        pass

    def load(self) -> None:
        """Loads access profile data from JSON into self."""
        pass

    def save(self) -> None:
        """Saves current state to JSON."""
        pass

    def can_access_image(self, image_id: str) -> bool:
        """Checks if the profile can access the image."""
        return False

    def can_access_face(self, face_id: str) -> bool:
        """Checks if the profile can access the face."""
        return False

    def can_access_moment(self, moment_id: str) -> bool:
        """Checks if the profile can access the moment."""
        return False

    def get_accessible_images(self) -> list[str]:
        """Returns accessible image IDs."""
        return []

    def get_accessible_faces(self) -> list[str]:
        """Returns accessible face IDs."""
        return []

    def get_accessible_moments(self) -> list[str]:
        """Returns accessible moment IDs."""
        return []

    def can_edit_profiles(self) -> bool:
        """Checks if the profile has permission to edit profiles (binary)."""
        return False

    def can_upload_photos(self) -> bool:
        """Checks if the profile has permission to upload photos (binary)."""
        return False

    def can_edit_moments(self) -> bool:
        """Checks if the profile has permission to edit moments (binary)."""
        return False

    def get_info(self) -> dict:
        """Returns access profile metadata."""
        return {}


class AccessProfiles:
    """
    Manages a collection of AccessProfile objects.
    """
    def __init__(self):
        """Loads all access profiles from JSON."""
        pass

    def add_access_profile(self, access_profile: AccessProfile) -> None:
        """Adds an access profile and saves."""
        pass

    def delete_access_profile(self, profile_id: str) -> None:
        """Deletes an access profile."""
        pass

    def get_access_profile(self, profile_id: str) -> 'AccessProfile':
        """Returns an AccessProfile object."""
        return AccessProfile(profile_id)

    def list_access_profiles(self) -> list['AccessProfile']:
        """Returns all access profiles."""
        return []

    @staticmethod
    def get_next_ID() -> str:
        """Returns the next available access profile ID."""
        return ""
