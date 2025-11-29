from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_current_profile_id, get_event, get_general_models, ChildOperation, Event, Forbidden, DBPolicyError, DatabaseError

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
    request_data = request.json or {}
    try:
        general_models = get_general_models()

        allowed_fields = ['label', 'email', 'hierarchy_rank', 'password', 'can_create_events', 'is_public']
        data = {k: v for k, v in request_data.items() if k in allowed_fields}

        profile_id = general_models.add('profiles', data)
        changes = [{
            'type': 'UPSERT',
            'entity': 'profile',
            'items': general_models.get_entities('profiles', [profile_id]),
        }]
        return jsonify({"success": True, "profile_id": profile_id, "changes": changes})
    
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DBPolicyError as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/profiles/<profile_id>/duplicate", methods=["POST"])
@require_auth
def duplicate_profile(profile_id):
    """Duplicate a general profile."""
    general_models = get_general_models()
    try:
        new_profile_id, incomplete_events = general_models.duplicate_profile(profile_id)
        changes = [{
            'type': 'UPSERT',
            'entity': 'profile',
            'items': general_models.get_entities('profiles', [new_profile_id]),
        }]
        return jsonify({"success": True, "new_profile_id": new_profile_id, "incomplete_events": incomplete_events, "changes": changes})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DBPolicyError as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/profiles/<profile_id>", methods=["PUT"])
@require_auth
def update_profile(profile_id):
    """Update a general profile."""
    data = request.json or {}
    return _update_profile(profile_id, data)

@profile_bp.route("/api/profiles/<profile_id>/events/<event_id>", methods=["POST"])
@require_auth
def add_event_to_profile(profile_id, event_id):
    """Add an event to a profile."""
    general_models = get_general_models()
    event = get_event(event_id)
    try:
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
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/profiles/<profile_id>/events/<event_id>", methods=["DELETE"])
@require_auth
def remove_event_from_profile(profile_id, event_id):
    """Remove an event from a profile."""
    event = get_event(event_id)
    general_models = get_general_models()
    try:
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
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/profiles/<profile_id>", methods=["DELETE"])
@require_auth
def delete_profile(profile_id):
    """Delete a general profile."""
    general_models = get_general_models()
    try:
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
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/profiles/check-name", methods=["POST"])
@require_auth
def check_profile_name():
    """Check if a profile name already exists."""
    general_models = get_general_models()
    data = request.json or {}
    label = data.get('label', '')
    exclude_profile_id = data.get('exclude_profile_id', None)
    restricted_to_event_id = data.get('restricted_to_event_id', None)
    if not label:
        return jsonify({"error": "Label is required"}), 400
    
    fields = {'label': label}
    if restricted_to_event_id:
        fields['restricted_to_event'] = restricted_to_event_id
    conflict_profile_id = general_models.is_exists('profiles', fields, exclude_id=exclude_profile_id)

    return jsonify({"conflict": bool(conflict_profile_id)})

@profile_bp.route("/api/profiles/<profile_id>/password", methods=["GET"])
@require_auth
def get_profile_password(profile_id):
    """Get profile password."""
    general_models = get_general_models()
    try:
        return jsonify({"password": general_models.get_profile_password(profile_id)})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403

@profile_bp.route("/api/profiles/<profile_id>/password", methods=["PUT"])
@require_auth
def update_profile_password(profile_id):
    """Update profile password."""
    general_models = get_general_models()
    data = request.json or {}
    password = data.get('password', '')
    try:
        general_models.edit('profiles', profile_id, {'password': password})
        return jsonify({"success": True})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

# ========================================
# EVENT PROFILE ROUTES
# ========================================

@profile_bp.route("/api/events/<event_id>/profiles", methods=["GET"])
@require_auth
def get_event_profiles(event_id):
    """Get all event profiles."""
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
    request_data = request.json or {}
    try:
        general_models = get_general_models()
        event = get_event(event_id)
        allowed_general_fields = ['label', 'email', 'hierarchy_rank', 'password', 'can_create_events', 'is_public']
        allowed_event_fields = ['can_manage_event', 'can_delete_event', 'can_upload_and_delete_images', 'can_edit', 'all_images', 'all_albums', 'all_groups']
        general_data = {k: v for k, v in request_data.items() if k in allowed_general_fields}
        general_data['restricted_to_event'] = event_id
        event_data = {k: v for k, v in request_data.items() if k in allowed_event_fields}

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
    
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DBPolicyError as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>", methods=["PUT"])
@require_auth
def update_event_profile(event_id, profile_id):
    """Update an event profile."""
    data = request.json or {}
    return _update_profile(profile_id, data, event_id)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>", methods=["DELETE"])
@require_auth
def delete_event_profile(event_id, profile_id):
    """Delete an event profile."""
    general_models = get_general_models()
    try:
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
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

# ========================================
# CURRENT PROFILE ENDPOINTS
# ========================================

@profile_bp.route("/api/profiles/current", methods=["GET"])
@require_auth
def get_current_profile():
    """Get current profile data combining general and event-specific information."""
    event_id = request.args.get('event_id', None)
    
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
    try:
        preferences = general_models.get_my_preferences()
        changes = [{
            'type': 'UPSERT',
            'entity': 'localStorage',
            'items': {
                'preferences': preferences
            }
        }]
        return jsonify({"changes": changes})
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/profiles/current/preferences", methods=["PUT"])
@require_auth
def update_my_preferences():
    """Update a single preference for the current profile."""
    general_models = get_general_models()
    
    data = request.json or {}
    preference_group = data.get('preference_group')
    preference_key = data.get('preference_key')
    preference_value = data.get('preference_value')
    
    if not preference_group or not preference_key or preference_value is None:
        return jsonify({"error": "preference_group, preference_key, and preference_value are required"}), 400
    
    try:
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
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/profiles/current", methods=["PUT"])
@require_auth
def update_current_profile():
    """Update the current profile data."""
    event_id = request.args.get('event_id', None)
    profile_id = get_current_profile_id()
    try:
        general_models = get_general_models()
        data = request.json
        general_models.edit('current_profile', profile_id, data)

        changes = [{
            'type': 'UPSERT',
            'entity': 'localStorage',
            'items': {
                'currentProfile': general_models.get_current_profile(event_id)
            }
        }]
        return jsonify({"success": True, "changes": changes})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/events/<event_id>/profiles/current/groups-to-request-access", methods=["GET"])
@require_auth
def get_groups_to_request_access(event_id):
    """Get groups to request access for the current profile."""
    event = get_event(event_id)
    return jsonify({"groups": event.models.get_groups_to_request_access()})

# ========================================
# CHECK ENDPOINTS
# ========================================

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/images/check", methods=["POST"])
@require_auth
def check_images_from_profile(event_id, profile_id):
    """Check accessible images for a profile."""
    try:
        data = request.json or {}
        image_ids = data.get('image_ids', [])
        event = get_event(event_id)
        specify, actual = event.models.check_accessibility_status(profile_id, 'images', image_ids)

        return jsonify({"specify": specify, "actual": actual})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/albums/check", methods=["POST"])
@require_auth
def check_albums_from_profile(event_id, profile_id):
    """Check accessible albums for a profile."""
    try:
        data = request.json or {}
        album_ids = data.get('album_ids', [])
        event = get_event(event_id)
        specify, actual = event.models.check_accessibility_status(profile_id, 'albums', album_ids)
        return jsonify({"specify": specify, "actual": actual})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/groups/check", methods=["POST"])
@require_auth
def check_groups_from_profile(event_id, profile_id):
    """Check accessible groups for a profile."""
    try:
        data = request.json or {}
        group_ids = data.get('group_ids', [])
        event = get_event(event_id)
        specify, actual = event.models.check_accessibility_status(profile_id, 'groups', group_ids)
        return jsonify({"specify": specify, "actual": actual})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

# ========================================
# ACCESS MANAGEMENT
# ========================================

# Direct child manipulation (add/remove from profile relations)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/images", methods=["PUT"])
@require_auth
def add_images_to_profile(event_id, profile_id):
    """Add multiple images to a profile."""
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    return _edit_event_profile_childs(event_id, profile_id, 'images', image_ids, add=True)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/images", methods=["DELETE"])
@require_auth
def remove_images_from_profile(event_id, profile_id):
    """Remove multiple images from a profile."""
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    return _edit_event_profile_childs(event_id, profile_id, 'images', image_ids, add=False)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/albums", methods=["PUT"])
@require_auth
def add_albums_to_profile(event_id, profile_id):
    """Add multiple albums to a profile."""
    data = request.json or {}
    album_ids = data.get('album_ids', [])
    return _edit_event_profile_childs(event_id, profile_id, 'albums', album_ids, add=True)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/albums", methods=["DELETE"])
@require_auth
def remove_albums_from_profile(event_id, profile_id):
    """Remove multiple albums from a profile."""
    data = request.json or {}
    album_ids = data.get('album_ids', [])
    return _edit_event_profile_childs(event_id, profile_id, 'albums', album_ids, add=False)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/groups", methods=["PUT"])
@require_auth
def add_groups_to_profile(event_id, profile_id):
    """Add multiple groups to a profile."""
    data = request.json or {}
    group_ids = data.get('group_ids', [])
    return _edit_event_profile_childs(event_id, profile_id, 'groups', group_ids, add=True)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/groups", methods=["DELETE"])
@require_auth
def remove_groups_from_profile(event_id, profile_id):
    """Remove multiple groups from a profile."""
    data = request.json or {}
    group_ids = data.get('group_ids', [])
    return _edit_event_profile_childs(event_id, profile_id, 'groups', group_ids, add=False)

# Accessibility management (whitelist/blacklist logic)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/accessible-images", methods=["PUT"])
@require_auth
def set_images_as_accessible(event_id, profile_id):
    """Set multiple images as accessible to a profile."""
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    return _set_profile_accessibility(event_id, profile_id, 'images', image_ids, set_accessible=True)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/accessible-images", methods=["DELETE"])
@require_auth
def set_images_as_inaccessible(event_id, profile_id):
    """Set multiple images as inaccessible to a profile."""
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    return _set_profile_accessibility(event_id, profile_id, 'images', image_ids, set_accessible=False)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/accessible-albums", methods=["PUT"])
@require_auth
def set_albums_as_accessible(event_id, profile_id):
    """Set multiple albums as accessible to a profile."""
    data = request.json or {}
    album_ids = data.get('album_ids', [])
    return _set_profile_accessibility(event_id, profile_id, 'albums', album_ids, set_accessible=True)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/accessible-albums", methods=["DELETE"])
@require_auth
def set_albums_as_inaccessible(event_id, profile_id):
    """Set multiple albums as inaccessible to a profile."""
    data = request.json or {}
    album_ids = data.get('album_ids', [])
    return _set_profile_accessibility(event_id, profile_id, 'albums', album_ids, set_accessible=False)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/accessible-groups", methods=["PUT"])
@require_auth
def set_groups_as_accessible(event_id, profile_id):
    """Set multiple groups as accessible to a profile."""
    data = request.json or {}
    group_ids = data.get('group_ids', [])
    return _set_profile_accessibility(event_id, profile_id, 'groups', group_ids, set_accessible=True)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/accessible-groups", methods=["DELETE"])
@require_auth
def set_groups_as_inaccessible(event_id, profile_id):
    """Set multiple groups as inaccessible to a profile."""
    data = request.json or {}
    group_ids = data.get('group_ids', [])
    return _set_profile_accessibility(event_id, profile_id, 'groups', group_ids, set_accessible=False)

# ========================================
# PUBLIC ACCESS CODE MANAGEMENT
# ========================================

@profile_bp.route("/api/profiles/<profile_id>/public-access-code", methods=["POST"])
@require_auth
def generate_public_access_code(profile_id):
    """Generate a public access code for a profile."""
    general_models = get_general_models()
    try:
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
    
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/profiles/<profile_id>/public-access-code", methods=["GET"])
@require_auth
def get_public_access_code(profile_id):
    """Get the public access code for a profile."""
    general_models = get_general_models()
    try:
        public_code = general_models.get_public_access_code(profile_id)
        return jsonify({"success": True, "public_code": public_code})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/profiles/<profile_id>/public-access-code", methods=["DELETE"])
@require_auth
def remove_public_access_code(profile_id):
    """Remove public access code for a profile."""
    general_models = get_general_models()
    try:
        general_models.revoke_public_access_code(profile_id)
        
        changes = [{
            'type': 'UPSERT',
            'entity': 'profile',
            'items': general_models.get_entities('profiles', [profile_id])
        }]
        
        return jsonify({"success": True, "changes": changes})
    
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

# ========================================
# HELPER FUNCTIONS
# ========================================

def _update_profile(profile_id: str, data: dict, event_id: str | None = None):
    general_models = get_general_models()

    try:
        general_fields = [
            'label',
            'hierarchy_rank',
            'password',
            'email',
            'is_public',
            'restricted_to_event',
            'can_create_events',
        ]
        general_data = {k: v for k, v in data.items() if k in general_fields}
        if general_data:
            general_models.edit('profiles', profile_id, general_data)

        if event_id:
            event_fields = [
                'can_manage_event',
                'can_delete_event',
                'can_upload_and_delete_images',
                'can_edit',
                'all_images',
                'all_albums',
                'all_groups',
            ]
            event_data = {k: v for k, v in data.items() if k in event_fields}
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
    
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

def _edit_event_profile_childs(event_id: str, profile_id: str, child: str, child_ids: list[str], add: bool):
    """Add or remove multiple childs from a profile."""
    general_models = get_general_models()
    event = get_event(event_id)
    if not general_models.get_current_profile()['is_profiles_manager']:
        return jsonify({"error": "Access denied"}), 403
    
    if child not in ['images', 'albums', 'groups']:
        return jsonify({"error": f"Invalid child: {child}"}), 400

    try:
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
    
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

def _set_profile_accessibility(event_id: str, profile_id: str, child: str, child_ids: list[str], set_accessible: bool):
    """Set multiple childs as accessible or inaccessible to a profile."""
    general_models = get_general_models()
    event = get_event(event_id)
    if not (general_models.get_current_profile()['is_profiles_manager'] and general_models.is_accessible('profiles', profile_id)):
        return jsonify({"error": "Access denied"}), 403
    
    if child not in ['images', 'albums', 'groups']:
        return jsonify({"error": f"Invalid child: {child}"}), 400
    
    try:
        affected_ids, added = event.models.edit_accessibility(profile_id, child, child_ids, set_accessible=set_accessible)
        if added:
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
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400
