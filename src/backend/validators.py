from flask import request
from pydantic import TypeAdapter, Field, EmailStr, ValidationError, AfterValidator
from typing import List, Any, Optional, Annotated, Dict, Union
from uuid import UUID
from datetime import datetime, date

def validate_uuid_string(v: Any) -> str:
    """Validate that a value is a valid UUID string and return it as a string."""
    try:
        obj = UUID(str(v))
        return str(obj)
    except (ValueError, TypeError) as e:
        raise ValueError('Invalid UUID format') from e

UUIDStr = Annotated[str, AfterValidator(validate_uuid_string)]

def validate_files_data(v: Any) -> List[Dict[str, Any]]:
    """Validate that files_data is a list of dicts with filename (str) and size (int > 0)."""
    if not isinstance(v, list):
        raise ValueError('files_data must be a list')
    
    if not v:
        raise ValueError('files_data cannot be empty')
    
    validated_list = []
    for i, item in enumerate(v):
        if not isinstance(item, dict):
            raise ValueError(f'files_data[{i}] must be a dictionary')
        
        if 'filename' not in item:
            raise ValueError(f'files_data[{i}] must have a "filename" field')
        
        if 'size' not in item:
            raise ValueError(f'files_data[{i}] must have a "size" field')
        
        filename = item['filename']
        if not isinstance(filename, str):
            raise ValueError(f'files_data[{i}].filename must be a string')
        
        # Validate filename safety - reject dangerous patterns
        if '\x00' in filename:
            raise ValueError(f'files_data[{i}].filename contains null bytes')
        
        # Reject path traversal attempts
        if '..' in filename or filename.startswith('/') or filename.startswith('\\'):
            raise ValueError(f'files_data[{i}].filename contains path traversal characters')
        
        # Validate file extension (JPG/JPEG only, case-insensitive)
        if not filename.lower().endswith(('.jpg', '.jpeg')):
            raise ValueError(f'files_data[{i}].filename must end with .jpg or .jpeg')
        
        size = item['size']
        if not isinstance(size, int) or size <= 0:
            raise ValueError(f'files_data[{i}].size must be an integer greater than 0')
        
        validated_list.append({
            'filename': filename,
            'size': size
        })
    
    return validated_list

FilesData = Annotated[List[Dict[str, Any]], AfterValidator(validate_files_data)]

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
    'preference_value': TypeAdapter(Annotated[Union[
        Annotated[str, Field(max_length=2000)],
        Annotated[List[Annotated[str, Field(max_length=2000)]], Field()],
        int,
        float,
        bool
    ], Field()]),
    'password': TypeAdapter(Annotated[str, Field(min_length=1, max_length=255)]),
    'current_password': TypeAdapter(Annotated[str, Field(min_length=1, max_length=255)]),
    'new_password': TypeAdapter(Annotated[str, Field(min_length=1, max_length=255)]),
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
    'assign_moments': TypeAdapter(Optional[bool]),
    
    # UUID fields
    'applicant_profile_id': TypeAdapter(Optional[UUIDStr]),
    'representative_image': TypeAdapter(Optional[UUIDStr]),
    'representative_face': TypeAdapter(Optional[UUIDStr]),
    'restricted_to_event': TypeAdapter(Optional[UUIDStr]),
    'restricted_to_event_id': TypeAdapter(Optional[UUIDStr]),
    'target_group_id': TypeAdapter(Optional[UUIDStr]),
    'closed_by': TypeAdapter(Optional[UUIDStr]),
    'created_by': TypeAdapter(Optional[UUIDStr]),
    'parent_id': TypeAdapter(Optional[UUIDStr]),
    
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
    'file_names': TypeAdapter(Optional[List[Annotated[str, Field(max_length=500)]]]),
    'filenames': TypeAdapter(List[Annotated[str, Field(max_length=500)]]),
    'files_data': TypeAdapter(FilesData),

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

def _validate_field(key: str, value: Any, required: bool = False, location: tuple = (), field_type: str = 'field') -> Any:
    """Central helper for field validation."""
    validator = FIELD_VALIDATORS.get(key)
    if not validator:
        raise ValueError(f"Security Error: Field '{key}' is not defined in validation rules.")

    if value is None or (value == '' and not required):
        if required:
            loc = location if location else (key,)
            msg = f'Missing required {field_type}: {key}'
            raise ValidationError.from_exception_data(
                'missing',
                [{'type': 'missing', 'loc': loc, 'msg': msg, 'input': None, 'ctx': {'error': msg}}]
            )
        return None

    try:
        return validator.validate_python(value)
    except ValidationError as e:
        # Add field name to location if not present
        error_list = e.errors()
        if error_list:
            # Update each error's location to include the field name if it's missing
            updated_errors = []
            for err in error_list:
                error_loc = err.get('loc', ())
                # If location is empty or doesn't start with the field name, prepend it
                if not error_loc or error_loc[0] != key:
                    new_loc = (key,) + error_loc if error_loc else (key,)
                else:
                    new_loc = error_loc
                
                # Ensure ctx has 'error' key for from_exception_data
                ctx = err.get('ctx', {})
                if 'error' not in ctx:
                    # Use the message as the error if ctx exists but doesn't have 'error'
                    # Otherwise create a minimal ctx
                    if ctx:
                        ctx = {**ctx, 'error': err.get('msg', 'Validation error')}
                    else:
                        ctx = {'error': err.get('msg', 'Validation error')}
                
                updated_errors.append({
                    **err,
                    'loc': new_loc,
                    'ctx': ctx
                })
            
            # Create new ValidationError with updated locations
            # from_exception_data requires 'error' key in ctx
            raise ValidationError.from_exception_data(
                error_list[0].get('type', 'value_error'),
                updated_errors
            )
        raise

def get_input(key: str, required: bool = False) -> Any:
    """Get input from request JSON body and validate it."""
    data = request.get_json(silent=True) or {}
    val = data.get(key)
    return _validate_field(key, val, required)

def get_query_param(key: str, required: bool = False) -> Any:
    """Get query parameter from request and validate it."""
    val = request.args.get(key)
    return _validate_field(key, val, required, field_type='query parameter')

def get_multiple_inputs(fields: List[str], required: bool = False) -> Dict[str, Any]:
    """Get multiple inputs from request JSON body and validate them."""
    result = {}
    data = request.get_json(silent=True) or {}
    
    for key in fields:
        if key in data:
            result[key] = _validate_field(key, data.get(key), required=False)
    
    if not result and required:
        msg = 'No valid field provided'
        raise ValidationError.from_exception_data(
            'value_error',
            [{'type': 'value_error', 'loc': ('body',), 'msg': msg, 'input': data, 'ctx': {'error': msg}}]
        )
    
    return result

def validate_path_param(key: str, value: str) -> str:
    """Validate a URL path parameter using FIELD_VALIDATORS."""
    return _validate_field(key, value, required=True, location=('path', key), field_type='path parameter')

