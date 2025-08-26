import uuid
from abc import ABC, abstractmethod
from typing import List, Dict
from ..db import AppDB

class BaseModel(ABC):
    def __init__(self, db: AppDB, table_name: str, id_field: str):
        self.db = db
        self.table_name = table_name
        self.id_field = id_field

    def generate_id(self) -> str:
        """Generate a new UUID for the entity."""
        return str(uuid.uuid4())

    @abstractmethod
    def get_add_data(self, *args, **kwargs) -> Dict:
        """Return a dict of data to insert for add()."""
        pass

    def add(self, *args, **kwargs) -> Dict | None:
        data = self.get_add_data(*args, **kwargs)
        # Ensure ID is generated if not provided
        if self.id_field not in data:
            data[self.id_field] = self.generate_id()
        result = self.db.secure_insert(self.table_name, [data])
        if result:
            return self.get(data[self.id_field])
        
        return None

    def add_many(self, data_list: List[Dict]) -> List[Dict] | None:
        for data in data_list:
            if self.id_field not in data:
                data[self.id_field] = self.generate_id()
        result = self.db.secure_insert(self.table_name, data_list)
        if result:
            return [self.get(data[self.id_field]) for data in data_list]
        
        return None

    def delete(self, entity_id: str) -> bool:
        return self.db.secure_delete(self.table_name, {self.id_field: entity_id})

    def edit(self, entity_id: str, fields: Dict) -> Dict | None:
        result = self.db.secure_update(self.table_name, {self.id_field: entity_id}, fields)
        if result:
            return self.get(entity_id)
        
        return None

    def get(self, entity_id: str) -> Dict | None:
        entity = self.db.get_one(self.table_name, {self.id_field: entity_id})
        return entity if entity else None

    def list(self) -> List[Dict]:
        return self.db.get_all(self.table_name) 