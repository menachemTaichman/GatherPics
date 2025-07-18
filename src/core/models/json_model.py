import json
import os
import uuid
from typing import Optional, List, Type, TypeVar
from abc import ABC, abstractmethod

T = TypeVar('T', bound='JsonModel')

class JsonModel(ABC):
    DATA_FILE: str = ''  # Should be set in subclass
    ID_FIELD: str = 'id'   # Default id field name

    def __init__(self, obj_id: str, load: bool = True):
        self.id = obj_id
        if load:
            data = self._get_dict(obj_id)
            if data:
                self._load_fields(data)
            else:
                self._init_fields()
        else:
            self._init_fields()

    @classmethod
    def _load_all(cls) -> List[dict]:
        if not os.path.exists(cls.DATA_FILE):
            return []
        with open(cls.DATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)

    @classmethod
    def _save_all(cls, items: List[dict]):
        with open(cls.DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(items, f, ensure_ascii=False, indent=2)

    @classmethod
    def _get_dict(cls, obj_id: str) -> Optional[dict]:
        for item in cls._load_all():
            if item.get(cls.ID_FIELD) == obj_id:
                return item
        return None

    @classmethod
    def list_all(cls: Type[T]) -> List[T]:
        return [cls(item[cls.ID_FIELD]) for item in cls._load_all()]

    @classmethod
    def delete(cls, obj_id: str) -> None:
        items = cls._load_all()
        items = [item for item in items if item.get(cls.ID_FIELD) != obj_id]
        cls._save_all(items)

    @classmethod
    def add(cls: Type[T], **fields) -> T:
        obj = cls(str(uuid.uuid4()), load=False)
        obj.edit_fields(fields)
        obj.save()
        return obj

    def edit_fields(self, fields: dict):
        for key, value in fields.items():
            if hasattr(self, key):
                setattr(self, key, value)

    def save(self):
        items = self._load_all()
        items = [item for item in items if item.get(self.ID_FIELD) != self.id]
        items.append(self.get_info())
        self._save_all(items)

    @abstractmethod
    def _init_fields(self):
        pass

    @abstractmethod
    def _load_fields(self, data: dict):
        pass

    @abstractmethod
    def get_info(self) -> dict:
        pass 