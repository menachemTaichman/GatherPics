class Moment:
    """
    Represents a moment (event/album).
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
        pass

    def get_info(self) -> dict:
        """Returns moment metadata."""
        pass


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

    def get_moment(self, moment_id: str) -> Moment:
        """Returns a Moment object."""
        pass

    def list_moments(self) -> list[Moment]:
        """Returns all moments."""
        pass
