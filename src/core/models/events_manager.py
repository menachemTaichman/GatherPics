import os
from .json_model import JsonModel

class EventsManager(JsonModel):
    DATA_FILE = os.path.join(os.path.dirname(__file__), '../../data/events_managers.json')
    ID_FIELD = 'id'

    def _init_fields(self):
        self.name = ''
        self.events = []

    def _load_fields(self, data: dict):
        self.name = data.get('name', '')
        self.events = data.get('events', [])

    def get_info(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'events': self.events
        }

# Convenience functions for compatibility
add_manager = EventsManager.add
delete_manager = EventsManager.delete
get_manager = lambda manager_id: EventsManager(manager_id)
list_managers = EventsManager.list_all 