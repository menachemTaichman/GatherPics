from flask import g
from src.core.models.general_models import GeneralModels
# Export core classes for use in routes
from src.core.services.event import Event, ChildOperation
from src.core.errors import Forbidden, DatabaseError, DBPolicyError

# Export helper functions for use in routes
def _parse_bool(val: str | None, default: bool) -> bool:
    """Parse a boolean value from a string, with a default."""
    if val is None:
        return default
    return str(val).lower() in ('1', 'true', 'yes', 'y', 'on')

def get_current_profile_id() -> str | None:
    """Get the current profile ID."""
    return getattr(g, 'profile_id', None)

def get_current_event_id() -> str | None:
    """Get the current event ID."""
    return getattr(g, 'event_id', None)

def get_general_models() -> GeneralModels:
    """Get general models instance with profile context."""
    return GeneralModels(profile_id=getattr(g, 'profile_id', None))

def get_event(event_id: str, public_code: str | None = None) -> Event:
    """Get event instance with profile context."""
    profile_id = None
    if not public_code:
        profile_id = getattr(g, 'profile_id', None)
    
    return Event(event_id, profile_id=profile_id, public_code=public_code)
