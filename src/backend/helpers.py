from flask import g, request
from pydantic import TypeAdapter, Field, EmailStr, ValidationError, AfterValidator
from typing import List, Any, Optional, Annotated, Dict
from uuid import UUID
import json
from datetime import datetime, date
from src.core.models.general_models import GeneralModels
# Export core classes for use in routes
from src.core.services.event import Event, ChildOperation
from src.core.errors import Forbidden, DatabaseError, DBPolicyError

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

def json_serialize_datetime(obj):
    """Recursively convert datetime and date objects to ISO format strings for JSON serialization."""
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    elif isinstance(obj, dict):
        return {key: json_serialize_datetime(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [json_serialize_datetime(item) for item in obj]
    elif isinstance(obj, tuple):
        return tuple(json_serialize_datetime(item) for item in obj)
    elif isinstance(obj, set):
        return {json_serialize_datetime(item) for item in obj}
    return obj

def json_dumps_safe(obj):
    """Serialize object to JSON string, handling datetime objects."""
    return json.dumps(json_serialize_datetime(obj))

def validate_uuid_string(v: Any) -> str:
    """Validate that a value is a valid UUID string and return it as a string."""
    try:
        obj = UUID(str(v))
        return str(obj)
    except (ValueError, TypeError):
        raise ValidationError.from_exception_data(
            'value_error',
            [
                {
                    'type': 'value_error',
                    'loc': ('path',),
                    'msg': 'Invalid UUID format',
                    'input': v,
                }
            ]
        )

UUIDStr = Annotated[str, AfterValidator(validate_uuid_string)]

# Field validators for all fields in STRUCTURE
FIELD_VALIDATORS = {

    # UUID ID fields
    'profile_id': TypeAdapter(UUIDStr),
    'event_id': TypeAdapter(UUIDStr),
    'image_id': TypeAdapter(UUIDStr),
    'group_id': TypeAdapter(UUIDStr),
    'album_id': TypeAdapter(UUIDStr),
    'moment_id': TypeAdapter(UUIDStr),
    'face_id': TypeAdapter(UUIDStr),
    
    # Integer ID fields
    'upload_id': TypeAdapter(Annotated[int, Field(ge=0)]),
    'token_id': TypeAdapter(Annotated[int, Field(ge=0)]),
    'notification_id': TypeAdapter(Annotated[int, Field(ge=0)]),
    'feedback_id': TypeAdapter(Annotated[int, Field(ge=0)]),
    'access_request_id': TypeAdapter(Annotated[int, Field(ge=0)]),
    'usage_id': TypeAdapter(Annotated[int, Field(ge=0)]),
    'id': TypeAdapter(Annotated[int, Field(ge=0)]),

    # String fields with length constraints
    'label': TypeAdapter(Annotated[str, Field(min_length=1, max_length=200)]),
    'name': TypeAdapter(Annotated[str, Field(min_length=1, max_length=200)]),
    'description': TypeAdapter(Annotated[Optional[str], Field(None, max_length=2000)]),
    'url': TypeAdapter(Annotated[str, Field(max_length=500)]),
    'token': TypeAdapter(str),
    'message': TypeAdapter(Annotated[str, Field(max_length=5000)]),
    'title': TypeAdapter(Annotated[Optional[str], Field(None, max_length=200)]),
    'type': TypeAdapter(Annotated[Optional[int], Field(None, ge=0)]),  # Integer for feedbacks (0 or 1), string for notifications but notifications not created via API
    'status': TypeAdapter(Annotated[Optional[str], Field(None, max_length=50)]),
    'notes': TypeAdapter(Annotated[Optional[str], Field(None, max_length=2000)]),
    'sender_name': TypeAdapter(Annotated[Optional[str], Field(None, max_length=200)]),
    'applicant_name': TypeAdapter(Annotated[Optional[str], Field(None, max_length=200)]),
    'applicant_phone': TypeAdapter(Annotated[Optional[str], Field(None, max_length=50)]),
    'closed_details': TypeAdapter(Optional[str]),
    'details': TypeAdapter(Annotated[Optional[str], Field(None, max_length=2000)]),
    'user_agent': TypeAdapter(Annotated[Optional[str], Field(None, max_length=500)]),
    'ip_address': TypeAdapter(Annotated[Optional[str], Field(None, max_length=50)]),
    'preference_group': TypeAdapter(Annotated[str, Field(max_length=100)]),
    'preference_key': TypeAdapter(Annotated[str, Field(max_length=100)]),
    'preference_value': TypeAdapter(Annotated[str, Field(max_length=2000)]),
    'password': TypeAdapter(Annotated[str, Field(min_length=1, max_length=255)]),
    'new_group_name': TypeAdapter(Annotated[Optional[str], Field(None, max_length=200)]),
    'entity_type': TypeAdapter(Annotated[Optional[str], Field(None, max_length=50)]),
    'quality': TypeAdapter(Annotated[Optional[str], Field(None, max_length=20)]),
    'profile_name': TypeAdapter(Annotated[Optional[str], Field(None, max_length=200)]),
    'closed_details': TypeAdapter(Optional[str]),
    
    # Date/datetime fields
    'date': TypeAdapter(Optional[date]),
    'created_at': TypeAdapter(Optional[datetime]),
    'started_at': TypeAdapter(Optional[datetime]),
    'completed_at': TypeAdapter(Optional[datetime]),
    'issued_at': TypeAdapter(Optional[datetime]),
    'expires_at': TypeAdapter(Optional[datetime]),
    'revoked_at': TypeAdapter(Optional[datetime]),
    'closed_at': TypeAdapter(Optional[datetime]),
    'requested_at': TypeAdapter(Optional[datetime]),
    'date_taken': TypeAdapter(Optional[datetime]),
    'start_date': TypeAdapter(Optional[datetime]),
    'end_date': TypeAdapter(Optional[datetime]),
    
    # Integer fields
    'hierarchy_rank': TypeAdapter(Annotated[int, Field(ge=0)]),
    'image_size_limit_bytes': TypeAdapter(Annotated[int, Field(ge=0)]),
    'images_count_limit': TypeAdapter(Annotated[int, Field(ge=0)]),
    'min_rank_to_create_event': TypeAdapter(Annotated[int, Field(ge=0)]),
    'rekognition_calls_limit': TypeAdapter(Annotated[int, Field(ge=0)]),
    'rekognition_calls_used': TypeAdapter(Annotated[int, Field(ge=0)]),
    
    # Boolean fields
    'is_public': TypeAdapter(bool),
    'is_archived': TypeAdapter(bool),
    'is_favorite': TypeAdapter(bool),
    'is_closed': TypeAdapter(bool),
    'solved': TypeAdapter(bool),
    'revoked': TypeAdapter(bool),
    'read': TypeAdapter(bool),
    'communication_consent': TypeAdapter(bool),
    'approved': TypeAdapter(Optional[bool]),
    'can_create_events': TypeAdapter(bool),
    'can_manage_event': TypeAdapter(bool),
    'can_delete_event': TypeAdapter(bool),
    'can_upload_and_delete_images': TypeAdapter(bool),
    'can_edit': TypeAdapter(bool),
    'all_images': TypeAdapter(bool),
    'all_groups': TypeAdapter(bool),
    'all_albums': TypeAdapter(bool),
    'include_metadata': TypeAdapter(Optional[bool]),
    'filter': TypeAdapter(Optional[bool]),
    
    # UUID fields
    'applicant_profile_id': TypeAdapter(Optional[UUIDStr]),
    'representative_image': TypeAdapter(Optional[UUIDStr]),
    'representative_face': TypeAdapter(Optional[UUIDStr]),
    'restricted_to_event': TypeAdapter(Optional[UUIDStr]),
    'restricted_to_event_id': TypeAdapter(Optional[UUIDStr]),
    'target_group_id': TypeAdapter(Optional[UUIDStr]),
    'closed_by': TypeAdapter(Optional[UUIDStr]),
    'created_by': TypeAdapter(Optional[UUIDStr]),
    
    # Exclude ID fields (for check-name endpoints)
    'exclude_moment_id': TypeAdapter(Optional[UUIDStr]),
    'exclude_album_id': TypeAdapter(Optional[UUIDStr]),
    'exclude_group_id': TypeAdapter(Optional[UUIDStr]),
    'exclude_profile_id': TypeAdapter(Optional[UUIDStr]),
    'exclude_event_id': TypeAdapter(Optional[UUIDStr]),

    # List/dict fields
    'errors': TypeAdapter(Optional[List[Any]]),
    'data': TypeAdapter(Optional[dict]),
    'diagnostics': TypeAdapter(Optional[dict]),
    'image_ids': TypeAdapter(List[UUIDStr]),
    'group_ids': TypeAdapter(List[UUIDStr]),
    'album_ids': TypeAdapter(List[UUIDStr]),
    'moment_ids': TypeAdapter(List[UUIDStr]),
    'face_ids': TypeAdapter(List[UUIDStr]),
    'groups_to_add': TypeAdapter(Optional[List[UUIDStr]]),
    'groups_to_remove': TypeAdapter(Optional[List[UUIDStr]]),
    'groups_approved': TypeAdapter(Optional[List[UUIDStr]]),
    'groups_denied': TypeAdapter(Optional[List[UUIDStr]]),
    'selected_groups': TypeAdapter(List[UUIDStr]),
    'ids': TypeAdapter(Optional[List[UUIDStr]]),

    # Diagnostic fields (for feedbacks)
    'console_logs': TypeAdapter(Optional[Any]),
    'network_logs': TypeAdapter(Optional[Any]),
    'network_errors': TypeAdapter(Optional[Any]),
    'browser_info': TypeAdapter(Optional[Any]),

    # Email fields
    'email': TypeAdapter(Optional[EmailStr]),
    'sender_email': TypeAdapter(Annotated[Optional[EmailStr], Field(None)]),
    'applicant_email': TypeAdapter(Annotated[Optional[EmailStr], Field(None)]),

}

def get_input(key: str, required: bool = False) -> Any:
    """Get input from request JSON body and validate it."""
    validator = FIELD_VALIDATORS.get(key)
    if not validator:
        raise ValueError(f"Security Error: Field '{key}' is not defined in validation rules.")

    data = request.get_json(silent=True) or {}
    val = data.get(key)

    if val is None:
        if required:
            # Create proper Pydantic ValidationError for frontend
            raise ValidationError.from_exception_data(
                'missing',
                [
                    {
                        'type': 'missing',
                        'loc': (key,),
                        'msg': f'Missing required field: {key}',
                        'input': None,
                    }
                ]
            )
        return None

    return validator.validate_python(val)

def get_query_param(key: str, required: bool = False) -> Any:
    """Get query parameter from request and validate it."""
    validator = FIELD_VALIDATORS.get(key)
    if not validator:
        raise ValueError(f"Security Error: Field '{key}' is not defined in validation rules.")

    val = request.args.get(key)

    if val is None:
        if required:
            # Create proper Pydantic ValidationError for frontend
            raise ValidationError.from_exception_data(
                'missing',
                [
                    {
                        'type': 'missing',
                        'loc': (key,),
                        'msg': f'Missing required query parameter: {key}',
                        'input': None,
                    }
                ]
            )
        return None

    return get_input(key, required=required)

def get_multiple_inputs(fields: List[str], required: bool = False) -> Dict[str, Any]:
    result = {}
    
    data = request.get_json(silent=True) or {}
    
    for key in fields:
        if key in data:
            result[key] = get_input(key, required=False)

    if not result and required:
        # Create proper Pydantic ValidationError for frontend
        raise ValidationError.from_exception_data(
            'value_error',
            [
                {
                    'type': 'value_error',
                    'loc': ('body',),
                    'msg': 'No valid field provided',
                    'input': data,
                }
            ]
        )
            
    return result

def validate_path_param(key: str, value: str) -> str:
    """Validate a URL path parameter using FIELD_VALIDATORS."""
    validator = FIELD_VALIDATORS.get(key)
    if not validator:
        raise ValueError(f"Security Error: Field '{key}' is not defined in validation rules.")
    
    try:
        return validator.validate_python(value)
    except ValidationError:
        # Re-raise with path location for better error messages
        raise ValidationError.from_exception_data(
            'value_error',
            [
                {
                    'type': 'value_error',
                    'loc': ('path', key),
                    'msg': f'Invalid {key} format',
                    'input': value,
                }
            ]
        )