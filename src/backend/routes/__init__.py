from src.backend.routes.auth_routes import auth_bp
from src.backend.routes.image_routes import image_bp
from src.backend.routes.group_routes import group_bp
from src.backend.routes.moment_routes import moment_bp
from src.backend.routes.album_routes import album_bp
from src.backend.routes.profile_routes import profile_bp
from src.backend.routes.upload_routes import upload_bp
from src.backend.routes.file_routes import file_bp
from src.backend.routes.request_routes import request_bp
from src.backend.routes.notification_routes import notification_bp
from src.backend.routes.event_routes import event_bp
from src.backend.routes.feedback_routes import feedback_bp

__all__ = [
    'auth_bp',
    'image_bp',
    'group_bp',
    'moment_bp',
    'album_bp',
    'profile_bp',
    'upload_bp',
    'file_bp',
    'request_bp',
    'notification_bp',
    'event_bp',
    'feedback_bp',
]

