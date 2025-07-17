import uuid
from abc import ABC, abstractmethod
from typing import Optional, List, Dict
from .db import AppDB
from .event import Event

class BaseModel(ABC):
    def __init__(self, event: Event, table_name: str, id_field: str):
        self.event = event
        self.db_path = event.DB_PATH
        self.db = AppDB(self.db_path)
        self.table_name = table_name
        self.id_field = id_field

    def generate_id(self) -> str:
        """Generate a new UUID for the entity."""
        return str(uuid.uuid4())

    @abstractmethod
    def get_add_data(self, *args, **kwargs) -> Dict:
        """Return a dict of data to insert for add()."""
        pass

    def add(self, *args, **kwargs) -> Dict:
        data = self.get_add_data(*args, **kwargs)
        # Ensure ID is generated if not provided
        if self.id_field not in data:
            data[self.id_field] = self.generate_id()
        self.db.insert(self.table_name, data)
        return data

    def add_many(self, data_list: List[Dict]) -> List[Dict]:
        for data in data_list:
            if self.id_field not in data:
                data[self.id_field] = self.generate_id()
        self.db.insert_many(self.table_name, data_list)
        return data_list

    def delete(self, entity_id: str) -> None:
        self.db.delete(self.table_name, {self.id_field: entity_id})

    def edit(self, entity_id: str, fields: Dict) -> None:
        self.db.update(self.table_name, {self.id_field: entity_id}, fields)

    def get(self, entity_id: str) -> Optional[Dict]:
        entity = self.db.get_one(self.table_name, {self.id_field: entity_id})
        return entity if entity else None

    def list(self) -> List[Dict]:
        return self.db.get_all(self.table_name) 