from flask import g
from src.core.models.general_models import GeneralModels
from src.core.services.event import Event

def _parse_bool(val: str | None, default: bool) -> bool:
    """Parse a boolean value from a string, with a default."""
    if val is None:
        return default
    return str(val).lower() in ('1', 'true', 'yes', 'y', 'on')

def get_general_models(profile_id=None):
    """Get general models instance with profile context."""
    if profile_id is None:
        profile_id = getattr(g, 'profile_id', None)
    
    return GeneralModels(profile_id=profile_id)

def get_event(event_id, profile_id=None):
    """Get event instance with profile context."""
    if profile_id is None:
        profile_id = getattr(g, 'profile_id', None)
    
    return Event(event_id, profile_id=profile_id)

def get_event_details(event_id, profile_id=None):
    """Get event details with profile context."""
    general_models = get_general_models(profile_id)
    event = general_models.get_entities('events', event_id)
    return event

