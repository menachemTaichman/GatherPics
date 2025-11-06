from flask import g
from flask_jwt_extended import jwt_required, get_jwt_identity, verify_jwt_in_request
from functools import wraps

def require_auth(f):
    """Decorator to require authentication and set profile_id in g."""
    @wraps(f)
    @jwt_required()
    def decorated(*args, **kwargs):
        g.profile_id = get_jwt_identity()
        return f(*args, **kwargs)
    return decorated

def optional_auth(f):
    """Decorator for optional authentication - sets profile_id in g if token present."""
    @wraps(f)
    def decorated(*args, **kwargs):
        try:
            verify_jwt_in_request(optional=True)
            identity = get_jwt_identity()
            g.profile_id = identity if identity else None
        except Exception:
            g.profile_id = None
        return f(*args, **kwargs)
    return decorated

