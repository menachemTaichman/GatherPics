import json
import os
import uuid
from typing import Optional, List

DATA_FILE = os.path.join(os.path.dirname(__file__), '../../data/events_managers.json')

class EventsManager:
    def __init__(self, manager_id: str, load: bool = True):
        self.id = manager_id
        if not load:
            self.name = ''
            self.events = []
            return
        manager = _get_manager_dict(manager_id)
        if manager:
            self.name = manager.get('name', '')
            self.events = manager.get('events', [])
        else:
            self.name = ''
            self.events = []

    def edit_fields(self, fields: dict):
        for key, value in fields.items():
            if hasattr(self, key):
                setattr(self, key, value)

    def save(self):
        managers = _load_managers()
        # Remove old if exists
        managers = [m for m in managers if m['id'] != self.id]
        managers.append(self.get_info())
        _save_managers(managers)

    def get_info(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'events': self.events
        }

def _load_managers() -> List[dict]:
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def _save_managers(managers: List[dict]):
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(managers, f, ensure_ascii=False, indent=2)

def _get_manager_dict(manager_id: str) -> Optional[dict]:
    for manager in _load_managers():
        if manager['id'] == manager_id:
            return manager
    return None

def add_manager(name: str, events: List[str]) -> EventsManager:
    manager = EventsManager(manager_id=str(uuid.uuid4()), load=False)
    manager.edit_fields({'name': name, 'events': events})
    manager.save()
    return manager

def delete_manager(manager_id: str) -> None:
    managers = _load_managers()
    managers = [m for m in managers if m['id'] != manager_id]
    _save_managers(managers)

def get_manager(manager_id: str) -> EventsManager:
    return EventsManager(manager_id)

def list_managers() -> List[EventsManager]:
    return [EventsManager(m['id']) for m in _load_managers()] 