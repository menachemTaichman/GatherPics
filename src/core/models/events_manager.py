import os
from .json_model import JsonModel
from .event import Event

class EventsManager(JsonModel):
    DATA_FILE = os.path.join(os.path.dirname(__file__), '../../data/events_managers.json')
    ID_FIELD = 'id'

    def _init_fields(self):
        self.name = ''
        self.password = ''
        self.events = []
        self.images_count_limit = 0

    def _load_fields(self, data: dict):
        self.name = data.get('name', '')
        self.password = data.get('password', '')
        self.events = data.get('events', [])
        self.images_count_limit = data.get('images_count_limit', 0)

    def get_info(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'password': self.password,
            'events': self.events,
            'images_count_limit': self.images_count_limit
        }

    def get_events(self):
        """
        Return a list of Event objects belonging to this manager.
        """
        return [event for event in Event.list_all() if getattr(event, 'events_manager', None) == self.id]

# Convenience functions for compatibility
add_manager = EventsManager.add
delete_manager = EventsManager.delete
get_manager = lambda manager_id: EventsManager(manager_id)
list_managers = EventsManager.list_all 