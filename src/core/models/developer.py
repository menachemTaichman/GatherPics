import os
from .json_model import JsonModel

class Developer(JsonModel):
    DATA_FILE = os.path.join(os.path.dirname(__file__), '../../data/developer.json')
    ID_FIELD = 'id'

    def _init_fields(self):
        self.name = ''
        self.password = ''
        self.default_images_count_limit = 6000

    def _load_fields(self, data: dict):
        self.name = data.get('name', '')
        self.password = data.get('password', '')
        self.default_images_count_limit = data.get('default_images_count_limit', 6000)

    def get_info(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'password': self.password,
            'default_images_count_limit': self.default_images_count_limit
        }

# Convenience functions for compatibility
get_developer = lambda developer_id: Developer(developer_id)
list_developers = Developer.list_all 