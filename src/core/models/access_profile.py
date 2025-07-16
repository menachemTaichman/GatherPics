import copy

class AccessProfile:
    """
    Represents an access profile with limited data access.
    """
    def __init__(self, profile_ID: str, load: bool = True):
        self.profile_ID = profile_ID
        if load:
            self.load()
        else:
            self.label = ''
            self.accessible_image_IDs = []
            self.can_edit_groups = False
            self.can_upload_photos = False
            self.can_edit_moments = False

    def edit_fields(self, fields: dict):
        """Edit fields of the AccessProfile object using a dict of key-value pairs."""
        for key, value in fields.items():
            if hasattr(self, key):
                setattr(self, key, value)

    def load(self) -> None:
        """Loads access profile data from JSON into self."""
        pass

    def save(self) -> None:
        """Saves current state to JSON."""
        pass

    def can_access_image(self, image_id: str) -> bool:
        """Checks if the profile can access the image."""
        return image_id in self.accessible_image_IDs

    def can_access_face(self, face_id: str) -> bool:
        """Checks if the profile can access the face."""
        return False

    def can_access_moment(self, moment_id: str) -> bool:
        """Checks if the profile can access the moment."""
        return False

    def get_accessible_images(self) -> list:
        """Returns accessible image IDs."""
        return self.accessible_image_IDs

    def get_accessible_faces(self) -> list:
        """Returns accessible face IDs."""
        return []

    def get_accessible_moments(self) -> list:
        """Returns accessible moment IDs."""
        return []

    def can_edit_groups_method(self) -> bool:
        """Checks if the profile has permission to edit profiles (binary)."""
        return self.can_edit_groups

    def can_upload_photos_method(self) -> bool:
        """Checks if the profile has permission to upload photos (binary)."""
        return self.can_upload_photos

    def can_edit_moments_method(self) -> bool:
        """Checks if the profile has permission to edit moments (binary)."""
        return self.can_edit_moments

    def get_info(self) -> dict:
        """Returns access profile metadata."""
        return {
            'profile_ID': self.profile_ID,
            'label': self.label,
            'accessible_image_IDs': self.accessible_image_IDs,
            'accessible_face_IDs': self.get_accessible_faces(),
            'accessible_moment_IDs': self.get_accessible_moments(),
            'can_edit_groups': self.can_edit_groups,
            'can_upload_photos': self.can_upload_photos,
            'can_edit_moments': self.can_edit_moments
        }

class AccessProfiles:
    """
    Manages a collection of AccessProfile objects.
    """
    def __init__(self):
        """Loads all access profiles from JSON."""
        pass

    def add_access_profile(self, label: str = '', accessible_image_IDs: list = [], accessible_face_IDs: list = [], accessible_moment_IDs: list = [], can_edit_profiles: bool = False, can_upload_photos: bool = False, can_edit_moments: bool = False) -> AccessProfile:
        """Creates and adds a new AccessProfile object with optional fields, assigns a new profile_ID, and saves it."""
        profile_ID = self.get_next_ID()
        access_profile = AccessProfile(profile_ID=profile_ID, load=False)
        access_profile.edit_fields({'label': label, 'accessible_image_IDs': accessible_image_IDs, 'accessible_face_IDs': accessible_face_IDs, 'accessible_moment_IDs': accessible_moment_IDs, 'can_edit_profiles': can_edit_profiles, 'can_upload_photos': can_upload_photos, 'can_edit_moments': can_edit_moments})
        access_profile.save()
        return access_profile

    def delete_access_profile(self, profile_id: str) -> None:
        """Deletes an access profile."""
        pass

    def get_access_profile(self, profile_id: str) -> 'AccessProfile':
        """Returns an AccessProfile object."""
        return AccessProfile(profile_id)

    def list_access_profiles(self) -> list:
        """Returns all access profiles."""
        return []

    @staticmethod
    def get_next_ID() -> str:
        """Returns the next available access profile ID."""
        return ''
