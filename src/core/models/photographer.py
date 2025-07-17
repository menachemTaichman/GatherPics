import json
import os
import uuid
from typing import Optional, List

DATA_FILE = os.path.join(os.path.dirname(__file__), '../../data/photographers.json')

class Photographer:
    def __init__(self, photographer_id: str, load: bool = True):
        self.id = photographer_id
        if not load:
            self.name = ''
            self.events = []
            return
        photographer = _get_photographer_dict(photographer_id)
        if photographer:
            self.name = photographer.get('name', '')
            self.events = photographer.get('events', [])
        else:
            self.name = ''
            self.events = []

    def edit_fields(self, fields: dict):
        for key, value in fields.items():
            if hasattr(self, key):
                setattr(self, key, value)

    def save(self):
        photographers = _load_photographers()
        # Remove old if exists
        photographers = [p for p in photographers if p['id'] != self.id]
        photographers.append(self.get_info())
        _save_photographers(photographers)

    def get_info(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'events': self.events
        }

def _load_photographers() -> List[dict]:
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def _save_photographers(photographers: List[dict]):
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(photographers, f, ensure_ascii=False, indent=2)

def _get_photographer_dict(photographer_id: str) -> Optional[dict]:
    for photographer in _load_photographers():
        if photographer['id'] == photographer_id:
            return photographer
    return None

def add_photographer(name: str, events: List[str]) -> Photographer:
    photographer = Photographer(photographer_id=str(uuid.uuid4()), load=False)
    photographer.edit_fields({'name': name, 'events': events})
    photographer.save()
    return photographer

def delete_photographer(photographer_id: str) -> None:
    photographers = _load_photographers()
    photographers = [p for p in photographers if p['id'] != photographer_id]
    _save_photographers(photographers)

def get_photographer(photographer_id: str) -> Photographer:
    return Photographer(photographer_id)

def list_photographers() -> List[Photographer]:
    return [Photographer(p['id']) for p in _load_photographers()] 