import copy

class Moment:
    """
    Represents a moment.
    """
    def __init__(self, moment_ID: str, load: bool = True):
        self.moment_ID = moment_ID
        if load:
            self.load()
        else:
            self.label = ''
            self.description = ''
            self.start = ''
            self.end = ''
            self.image_IDs = []

    def edit_fields(self, fields: dict):
        """Edit fields of the Moment object using a dict of key-value pairs."""
        for key, value in fields.items():
            if hasattr(self, key):
                setattr(self, key, value)

    def load(self) -> None:
        """Loads moment data from JSON into self."""
        pass

    def save(self) -> None:
        """Saves current state to JSON."""
        pass

    def add_image(self, image_id: str) -> None:
        """Adds an image to the moment."""
        if image_id not in self.image_IDs:
            self.image_IDs.append(image_id)

    def remove_image(self, image_id: str) -> None:
        """Removes an image from the moment."""
        if image_id in self.image_IDs:
            self.image_IDs.remove(image_id)


    def get_images_in_period(self) -> list:
        """Returns all image IDs that fall within this moment's time period."""
        return []

    def get_info(self) -> dict:
        """Returns moment metadata."""
        return {
            'moment_ID': self.moment_ID,
            'label': self.label,
            'description': self.description,
            'start': self.start,
            'end': self.end,
            'image_IDs': self.image_IDs
        }

class Moments:
    """
    Manages a collection of Moment objects.
    """
    def __init__(self):
        """Loads all moments from JSON."""
        pass

    def add_moment(self, label: str = '', description: str = '', start: str = '', end: str = '', image_IDs: list = []) -> Moment:
        """Creates and adds a new Moment object with optional fields, assigns a new moment_ID, and saves it."""
        moment = Moment(moment_ID=self.get_next_ID(), load=False)
        moment.edit_fields({'label': label, 'description': description, 'start': start, 'end': end, 'image_IDs': image_IDs})
        moment.save()
        return moment

    def delete_moment(self, moment_id: str) -> None:
        """Deletes a moment and related data."""
        pass

    def get_moment(self, moment_id: str) -> 'Moment':
        """Returns a Moment object."""
        return Moment(moment_id)

    def list_moments(self) -> list:
        """Returns all moments."""
        return []

    @staticmethod
    def get_next_ID() -> str:
        """Returns the next available moment ID."""
        return ''
