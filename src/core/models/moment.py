class Moment:
    """
    Represents a moment.
    """
    def __init__(self, moment_id: str):
        """Initialize with moment ID."""
        pass

    def load(self) -> None:
        """Loads moment data from JSON into self."""
        pass

    def save(self) -> None:
        """Saves current state to JSON."""
        pass

    def add_image(self, image_id: str) -> None:
        """Adds an image to the moment."""
        pass

    def remove_image(self, image_id: str) -> None:
        """Removes an image from the moment."""
        pass

    def get_images(self) -> list[str]:
        """Returns all image IDs in the moment."""
        return []

    def get_images_in_period(self) -> list[str]:
        """Returns all image IDs that fall within this moment's time period."""
        return []

    def get_info(self) -> dict:
        """Returns moment metadata."""
        return {}


class Moments:
    """
    Manages a collection of Moment objects.
    """
    def __init__(self):
        """Loads all moments from JSON."""
        pass

    def add_moment(self, moment: Moment) -> None:
        """Adds a moment to the collection and saves."""
        pass

    def delete_moment(self, moment_id: str) -> None:
        """Deletes a moment and related data."""
        pass

    def get_moment(self, moment_id: str) -> 'Moment':
        """Returns a Moment object."""
        return Moment(moment_id)

    def list_moments(self) -> list['Moment']:
        """Returns all moments."""
        return []

    @staticmethod
    def get_next_ID() -> str:
        """Returns the next available moment ID."""
        return ""
