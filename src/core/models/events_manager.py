import os
from .json_model import JsonModel
from .event import Event

class EventsManager(JsonModel):
    DATA_FILE = os.path.join(os.path.dirname(__file__), '../../data/events_managers.json')
    ID_FIELD = 'id'

    def _init_fields(self):
        self.name = ''

    def _load_fields(self, data: dict):
        self.name = data.get('name', '')

    def get_info(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'events': self.get_events()
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