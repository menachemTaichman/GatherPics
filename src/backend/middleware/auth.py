from flask import g
from flask_jwt_extended import jwt_required, get_jwt_identity
from functools import wraps

def require_auth(f):
    """Decorator to require authentication and set profile_id in g."""
    @wraps(f)
    @jwt_required()
    def decorated(*args, **kwargs):
        g.profile_id = get_jwt_identity()
        return f(*args, **kwargs)
    return decorated

