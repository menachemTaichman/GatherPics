from flask import Blueprint, jsonify, request

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_current_profile_id, get_event, get_general_models, ChildOperation
from src.backend.validators import get_input, get_multiple_inputs, get_query_param, validate_path_param

profile_bp = Blueprint('profiles', __name__)

# ========================================
# GENERAL PROFILE ROUTES
# ========================================

@profile_bp.route("/api/profiles", methods=["GET"])
@require_auth
def get_profiles():
    """Get all general profiles."""
    general_models = get_general_models()
    profiles = general_models.get_entities('profiles')
    changes = [{
        'type': 'UPSERT',
        'entity': 'profile',
        'items': profiles
    }]
    return jsonify({"changes": changes})

@profile_bp.route("/api/profiles/<profile_id>", methods=["GET"])
@require_auth
def get_profile(profile_id):
    """Get a single general profile."""
    profile_id = validate_path_param('profile_id', profile_id)
    general_models = get_general_models()
    profile = general_models.get_entities('profiles', [profile_id])
    events = general_models.get_childs('profiles', profile_id, 'events', return_ids=True)
    profile[profile_id]['events'] = events
    changes = [{
        'type': 'UPSERT',
        'entity': 'profile',
        'items': profile
    }]
    return jsonify({"changes": changes})

@profile_bp.route("/api/profiles", methods=["POST"])
@require_auth
def create_profile():
    """Create a new general profile."""
    general_models = get_general_models()

    data = get_multiple_inputs(['label', 'email', 'hierarchy_rank', 'password', 'can_create_events', 'is_public'])

    profile_id = general_models.add('profiles', data)
    changes = [{
        'type': 'UPSERT',
        'entity': 'profile',
        'items': general_models.get_entities('profiles', [profile_id]),
    }]
    return jsonify({"success": True, "profile_id": profile_id, "changes": changes})

@profile_bp.route("/api/profiles/<profile_id>/duplicate", methods=["POST"])
@require_auth
def duplicate_profile(profile_id):
    """Duplicate a general profile."""
    profile_id = validate_path_param('profile_id', profile_id)
    general_models = get_general_models()
    new_profile_id, label, password, incomplete_events = general_models.duplicate_profile(profile_id)
    changes = [{
        'type': 'UPSERT',
        'entity': 'profile',
        'items': general_models.get_entities('profiles', [new_profile_id]),
    }]
    return jsonify({"success": True, "new_profile_id": new_profile_id, "label": label, "password": password, "incomplete_events": incomplete_events, "changes": changes})

@profile_bp.route("/api/profiles/<profile_id>", methods=["PUT"])
@require_auth
def update_profile(profile_id):
    """Update a general profile."""
    profile_id = validate_path_param('profile_id', profile_id)
    return _update_profile(profile_id)

@profile_bp.route("/api/profiles/<profile_id>/events/<event_id>", methods=["POST"])
@require_auth
def add_event_to_profile(profile_id, event_id):
    """Add an event to a profile."""
    profile_id = validate_path_param('profile_id', profile_id)
    event_id = validate_path_param('event_id', event_id)
    general_models = get_general_models()
    event = get_event(event_id)
    # Add event
    event.models.edit_childs('events', event_id, 'profiles', [profile_id], operation=ChildOperation.ADD)
    
    # Get updated profile with events
    updated_profile = general_models.get_entities('profiles', [profile_id])
    updated_events = general_models.get_childs('profiles', profile_id, 'events', return_ids=True)
    updated_profile[profile_id]['events'] = updated_events
    
    changes = [{
        'type': 'UPSERT',
        'entity': 'profile',
        'items': updated_profile,
        'event_id': 'general',
    }]
    
    return jsonify({"success": True, "changes": changes})

@profile_bp.route("/api/profiles/<profile_id>/events/<event_id>", methods=["DELETE"])
@require_auth
def remove_event_from_profile(profile_id, event_id):
    """Remove an event from a profile."""
    profile_id = validate_path_param('profile_id', profile_id)
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    general_models = get_general_models()
    # Remove event
    event.models.edit_childs('events', event_id, 'profiles', [profile_id], operation=ChildOperation.REMOVE)
    
    # Get updated profile with events
    updated_profile = general_models.get_entities('profiles', [profile_id])
    updated_events = general_models.get_childs('profiles', profile_id, 'events', return_ids=True)
    updated_profile[profile_id]['events'] = updated_events
    
    changes = [{
        'type': 'UPSERT',
        'entity': 'profile',
        'items': updated_profile,
        'event_id': 'general',
    }]
    
    return jsonify({"success": True, "changes": changes})

@profile_bp.route("/api/profiles/<profile_id>", methods=["DELETE"])
@require_auth
def delete_profile(profile_id):
    """Delete a general profile."""
    profile_id = validate_path_param('profile_id', profile_id)
    general_models = get_general_models()
    event_ids = general_models.get_childs('profiles', profile_id, 'events', return_ids=True)
    general_models.delete_profile(profile_id)
    changes = [{
        'type': 'REMOVE',
        'entity': 'profile',
        'ids': [profile_id]
    }]
    for event_id in event_ids:
        changes.append({
            'type': 'REMOVE',
            'entity': 'event_profile',
            'ids': [profile_id],
            'event_id': event_id
        })
    return jsonify({"success": True, "deleted_ids": [profile_id], "changes": changes})

@profile_bp.route("/api/profiles/check-name", methods=["POST"])
@require_auth
def check_profile_name():
    """Check if a profile name already exists."""
    general_models = get_general_models()
    label = get_input('label', required=True)
    exclude_profile_id = get_input('exclude_profile_id', required=False)
    restricted_to_event_id = get_input('restricted_to_event_id', required=False)
    fields = {'label': label}
    if restricted_to_event_id:
        fields['restricted_to_event'] = restricted_to_event_id
    conflict_profile_id = general_models.is_exists('profiles', fields, exclude_id=exclude_profile_id)

    return jsonify({"conflict": bool(conflict_profile_id)})

@profile_bp.route("/api/profiles/<profile_id>/password", methods=["GET"])
@require_auth
def get_profile_password(profile_id):
    """Get profile password."""
    profile_id = validate_path_param('profile_id', profile_id)
    general_models = get_general_models()
    return jsonify({"password": general_models.get_profile_password(profile_id)})

@profile_bp.route("/api/profiles/<profile_id>/password", methods=["PUT"])
@require_auth
def update_profile_password(profile_id):
    """Update profile password."""
    profile_id = validate_path_param('profile_id', profile_id)
    general_models = get_general_models()
    password = get_input('password', required=True)
    general_models.edit('profiles', profile_id, {'password': password})
    return jsonify({"success": True})

# ========================================
# EVENT PROFILE ROUTES
# ========================================

@profile_bp.route("/api/events/<event_id>/profiles", methods=["GET"])
@require_auth
def get_event_profiles(event_id):
    """Get all event profiles."""
    event_id = validate_path_param('event_id', event_id)
    general_models = get_general_models()
    profiles, event_profiles = general_models.get_childs('events', event_id, 'profiles')
    changes = [{
        'type': 'UPSERT',
        'entity': 'profile',
        'items': profiles,
        'event_id': 'general',
    },{
        'type': 'UPSERT',
        'entity': 'event_profile',
        'items': event_profiles
    }]
    return jsonify({"changes": changes})

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>", methods=["GET"])
@require_auth
def get_event_profile(event_id, profile_id):
    """Get a single event profile with relations."""
    event_id = validate_path_param('event_id', event_id)
    profile_id = validate_path_param('profile_id', profile_id)
    event = get_event(event_id)
    general_models = get_general_models()
    profiles, event_profiles = general_models.get_childs('events', event_id, 'profiles', [profile_id])
    changes = [{
        'type': 'UPSERT',
        'entity': 'profile',
        'items': profiles,
        'event_id': 'general',
    },{
        'type': 'UPSERT',
        'entity': 'event_profile',
        'items': event_profiles
    },{
        'type': 'RELATION_SET',
        'relation': 'profile.images',
        'parentId': profile_id,
        'entities': event.models.get_childs('events_profiles_ctx', profile_id, 'images')
    },{
        'type': 'RELATION_SET',
        'relation': 'profile.albums',
        'parentId': profile_id,
        'entities': event.models.get_childs('events_profiles_ctx', profile_id, 'albums')
    },{
        'type': 'RELATION_SET',
        'relation': 'profile.groups',
        'parentId': profile_id,
        'entities': event.models.get_childs('events_profiles_ctx', profile_id, 'groups')
    }]
    return jsonify({"changes": changes})

@profile_bp.route("/api/events/<event_id>/profiles", methods=["POST"])
@require_auth
def create_event_profile(event_id):
    """Create a new event profile."""
    event_id = validate_path_param('event_id', event_id)
    general_models = get_general_models()
    event = get_event(event_id)
    general_data = get_multiple_inputs(['label', 'email', 'hierarchy_rank', 'password', 'can_create_events', 'is_public'])
    general_data['restricted_to_event'] = event_id
    event_data = get_multiple_inputs(['can_manage_event', 'can_delete_event', 'can_upload_and_delete_images', 'can_edit', 'all_images', 'all_albums', 'all_groups'])

    profile_id = general_models.add('profiles', general_data)
    event.models.edit_childs('events', event_id, 'profiles', [profile_id], operation=ChildOperation.ADD, data=event_data)
    profiles, event_profiles = event.models.get_childs('events', event_id, 'profiles', [profile_id])
    changes = [{
        'type': 'UPSERT',
        'entity': 'profile',
        'items': profiles,
        'event_id': 'general',
    },{
        'type': 'UPSERT',
        'entity': 'event_profile',
        'items': event_profiles
    }]
    return jsonify({"success": True, "profile_id": profile_id, "changes": changes})

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>", methods=["PUT"])
@require_auth
def update_event_profile(event_id, profile_id):
    """Update an event profile."""
    event_id = validate_path_param('event_id', event_id)
    profile_id = validate_path_param('profile_id', profile_id)
    return _update_profile(profile_id, event_id)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>", methods=["DELETE"])
@require_auth
def delete_event_profile(event_id, profile_id):
    """Delete an event profile."""
    event_id = validate_path_param('event_id', event_id)
    profile_id = validate_path_param('profile_id', profile_id)
    general_models = get_general_models()
    complete_delete = general_models.delete_profile(profile_id, event_id)
    changes = [{
        'type': 'REMOVE',
        'entity': 'event_profile',
        'ids': [profile_id]
    }]
    if complete_delete:
        changes.append({
            'type': 'REMOVE',
            'entity': 'profile',
            'ids': [profile_id],
            'event_id': 'general'
        })
    return jsonify({"success": True, "deleted_ids": [profile_id], "changes": changes})

# ========================================
# CURRENT PROFILE ENDPOINTS
# ========================================

@profile_bp.route("/api/profiles/current", methods=["GET"])
@require_auth
def get_current_profile():
    """Get current profile data combining general and event-specific information."""
    
    event_id = get_query_param('event_id', required=False)

    print(event_id)
    import src.backend.helpers as helpers
    print(helpers.get_current_profile_id())
    general_models = get_general_models()
    profile = general_models.get_current_profile(event_id)

    changes = [{
        'type': 'UPSERT',
        'entity': 'localStorage',
        'items': {
            'currentProfile': profile
        }
    }]

    return jsonify({"changes": changes})

@profile_bp.route("/api/profiles/current/preferences", methods=["GET"])
@require_auth
def get_my_preferences():
    """Get preferences for the current profile."""
    general_models = get_general_models()
    preferences = general_models.get_my_preferences()
    changes = [{
        'type': 'UPSERT',
        'entity': 'localStorage',
        'items': {
            'preferences': preferences
        }
    }]
    return jsonify({"changes": changes})

@profile_bp.route("/api/profiles/current/preferences", methods=["PUT"])
@require_auth
def update_my_preferences():
    """Update a single preference for the current profile."""
    general_models = get_general_models()
    
    preference_group = get_input('preference_group', required=True)
    preference_key = get_input('preference_key', required=True)
    preference_value = get_input('preference_value', required=True)
    
    general_models.update_my_preferences(preference_group, preference_key, preference_value)
    preferences = general_models.get_my_preferences()
    changes = [{
        'type': 'UPSERT',
        'entity': 'localStorage',
        'items': {
            'preferences': preferences
        }
    }]
    return jsonify({"success": True, "changes": changes})

@profile_bp.route("/api/profiles/current", methods=["PUT"])
@require_auth
def update_current_profile():
    """Update the current profile data."""
    event_id = request.args.get('event_id', None)
    profile_id = get_current_profile_id()
    general_models = get_general_models()
    data = get_multiple_inputs(['label', 'email'])
    if data:
        general_models.edit('current_profile', profile_id, data)

    changes = [{
        'type': 'UPSERT',
        'entity': 'localStorage',
        'items': {
            'currentProfile': general_models.get_current_profile(event_id)
        }
    }]
    return jsonify({"success": True, "changes": changes})

@profile_bp.route("/api/events/<event_id>/profiles/current/groups-to-request-access", methods=["GET"])
@require_auth
def get_groups_to_request_access(event_id):
    """Get groups to request access for the current profile."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    return jsonify({"groups": event.models.get_groups_to_request_access()})


# ========================================
# ACCESS MANAGEMENT
# ========================================

# Direct child manipulation (add/remove from profile relations)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/images", methods=["PUT"])
@require_auth
def add_images_to_profile(event_id, profile_id):
    """Add multiple images to a profile."""
    event_id = validate_path_param('event_id', event_id)
    profile_id = validate_path_param('profile_id', profile_id)
    image_ids = get_input('image_ids', required=True)
    return _edit_event_profile_childs(event_id, profile_id, 'images', image_ids, add=True)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/images", methods=["DELETE"])
@require_auth
def remove_images_from_profile(event_id, profile_id):
    """Remove multiple images from a profile."""
    event_id = validate_path_param('event_id', event_id)
    profile_id = validate_path_param('profile_id', profile_id)
    image_ids = get_input('image_ids', required=True)
    return _edit_event_profile_childs(event_id, profile_id, 'images', image_ids, add=False)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/albums", methods=["PUT"])
@require_auth
def add_albums_to_profile(event_id, profile_id):
    """Add multiple albums to a profile."""
    event_id = validate_path_param('event_id', event_id)
    profile_id = validate_path_param('profile_id', profile_id)
    album_ids = get_input('album_ids', required=True)
    return _edit_event_profile_childs(event_id, profile_id, 'albums', album_ids, add=True)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/albums", methods=["DELETE"])
@require_auth
def remove_albums_from_profile(event_id, profile_id):
    """Remove multiple albums from a profile."""
    event_id = validate_path_param('event_id', event_id)
    profile_id = validate_path_param('profile_id', profile_id)
    album_ids = get_input('album_ids', required=True)
    return _edit_event_profile_childs(event_id, profile_id, 'albums', album_ids, add=False)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/groups", methods=["PUT"])
@require_auth
def add_groups_to_profile(event_id, profile_id):
    """Add multiple groups to a profile."""
    event_id = validate_path_param('event_id', event_id)
    profile_id = validate_path_param('profile_id', profile_id)
    group_ids = get_input('group_ids', required=True)
    return _edit_event_profile_childs(event_id, profile_id, 'groups', group_ids, add=True)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/groups", methods=["DELETE"])
@require_auth
def remove_groups_from_profile(event_id, profile_id):
    """Remove multiple groups from a profile."""
    event_id = validate_path_param('event_id', event_id)
    profile_id = validate_path_param('profile_id', profile_id)
    group_ids = get_input('group_ids', required=True)
    return _edit_event_profile_childs(event_id, profile_id, 'groups', group_ids, add=False)

# Accessibility management (whitelist/blacklist logic)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/accessible", methods=["POST", "PUT", "DELETE"])
@require_auth
def manage_profile_accessibility(event_id, profile_id):
    """Manage profile accessibility for entities (images, albums, or groups).
    
    POST: Check accessibility status
    PUT: Set entities as accessible
    DELETE: Set entities as inaccessible
    
    Request body:
    - entity_type: 'images', 'albums', or 'groups'
    - ids: List of entity IDs
    """
    event_id = validate_path_param('event_id', event_id)
    profile_id = validate_path_param('profile_id', profile_id)
    entity_type = get_input('entity_type', required=True)
    entity_ids = get_input('ids', required=True)
    
    if entity_type not in ['images', 'albums', 'groups']:
        return jsonify({"error": "entity_type must be one of: images, albums, groups"}), 400
    
    # POST = check accessibility status

    event = get_event(event_id)
    if request.method == 'POST':
        specify, actual = event.models.check_accessibility_status(profile_id, entity_type, entity_ids)
        return jsonify({"specify": specify, "actual": actual})
    
    # PUT = set accessible, DELETE = set inaccessible
    set_accessible = (request.method == 'PUT')

    affected_ids, added = event.models.edit_accessibility(profile_id, entity_type, entity_ids, set_accessible=set_accessible)
    if added:
        changes = [{
            'type': 'RELATION_ADD',
            'relation': f'profile.{entity_type}',
            'parentId': profile_id,
            'entities': event.models.get_childs('events_profiles_ctx', profile_id, entity_type, entity_ids)
        }]
    else:
        changes = [{
            'type': 'RELATION_REMOVE',
            'relation': f'profile.{entity_type}',
            'parentId': profile_id,
            'ids': affected_ids
        }]

    return jsonify({"success": True, "changes": changes})


# ========================================
# PUBLIC ACCESS CODE MANAGEMENT
# ========================================

@profile_bp.route("/api/profiles/<profile_id>/public-access-code", methods=["POST"])
@require_auth
def generate_public_access_code(profile_id):
    """Generate a public access code for a profile."""
    profile_id = validate_path_param('profile_id', profile_id)
    general_models = get_general_models()
    # Check if profile is public
    general_models.generate_public_access_code(profile_id)
    public_code = general_models.get_public_access_code(profile_id)
    profile = general_models.get_entities('profiles', [profile_id])
    changes = [{
        'type': 'UPSERT',
        'entity': 'profile',
        'items': profile
    }]
    return jsonify({"success": True, "public_code": public_code, "changes": changes})

@profile_bp.route("/api/profiles/<profile_id>/public-access-code", methods=["GET"])
@require_auth
def get_public_access_code(profile_id):
    """Get the public access code for a profile."""
    profile_id = validate_path_param('profile_id', profile_id)
    general_models = get_general_models()
    public_code = general_models.get_public_access_code(profile_id)
    return jsonify({"success": True, "public_code": public_code})

@profile_bp.route("/api/profiles/<profile_id>/public-access-code", methods=["DELETE"])
@require_auth
def remove_public_access_code(profile_id):
    """Remove public access code for a profile."""
    profile_id = validate_path_param('profile_id', profile_id)
    general_models = get_general_models()
    general_models.revoke_public_access_code(profile_id)
    
    changes = [{
        'type': 'UPSERT',
        'entity': 'profile',
        'items': general_models.get_entities('profiles', [profile_id])
    }]
    
    return jsonify({"success": True, "changes": changes})

# ========================================
# HELPER FUNCTIONS
# ========================================

def _update_profile(profile_id: str, event_id: str | None = None):
    general_models = get_general_models()

    general_data = get_multiple_inputs([
        'label',
        'hierarchy_rank',
        'password',
        'email',
        'is_public',
        'restricted_to_event',
        'can_create_events',
    ])
    if general_data:
        general_models.edit('profiles', profile_id, general_data)

    if event_id:
        event_data = get_multiple_inputs([
            'can_manage_event',
            'can_delete_event',
            'can_upload_and_delete_images',
            'can_edit',
            'all_images',
            'all_albums',
            'all_groups',
        ])
        event = get_event(event_id)
        event.models.edit_childs('events', event_id, 'profiles', [profile_id], operation=ChildOperation.UPDATE, data=event_data)
        profiles, event_profiles = general_models.get_childs('events', event_id, 'profiles', [profile_id])
        changes = [{
            'type': 'UPSERT',
            'entity': 'profile',
            'items': profiles,
            'event_id': 'general',
        },{
            'type': 'UPSERT',
            'entity': 'event_profile',
            'items': event_profiles,
            'event_id': event_id
        }]
    
    else:
        changes = [{
            'type': 'UPSERT',
            'entity': 'profile',
            'items': general_models.get_entities('profiles', [profile_id]),
            'event_id': 'general',
        }]

    return jsonify({"success": True, "changes": changes})

def _edit_event_profile_childs(event_id: str, profile_id: str, child: str, child_ids: list[str], add: bool):
    """Add or remove multiple childs from a profile."""
    general_models = get_general_models()
    event = get_event(event_id)
    if not general_models.get_current_profile()['is_profiles_manager']:
        return jsonify({"error": "Access denied"}), 403
    
    if child not in ['images', 'albums', 'groups']:
        return jsonify({"error": f"Invalid child: {child}"}), 400

    operation = ChildOperation.ADD if add else ChildOperation.REMOVE
    affected_ids, _ = event.models.edit_childs('events_profiles_ctx', profile_id, child, child_ids, operation=operation)
    if add:
        changes = [{
            'type': 'RELATION_ADD',
            'relation': f'profile.{child}',
            'parentId': profile_id,
            'entities': event.models.get_childs('events_profiles_ctx', profile_id, child, child_ids)
        }]
    else:
        changes = [{
            'type': 'RELATION_REMOVE',
            'relation': f'profile.{child}',
            'parentId': profile_id,
            'ids': affected_ids
        }]

    return jsonify({"success": True, "changes": changes})
