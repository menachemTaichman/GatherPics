from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event, get_general_models, ChildOperation
from src.core.errors import Forbidden, DatabaseError

profile_bp = Blueprint('profiles', __name__)

# genral profile endpoints
@profile_bp.route("/api/profiles", methods=["GET"])
@require_auth
def get_profiles():
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
    general_models = get_general_models()
    profile = general_models.get_entities('profiles', [profile_id])
    changes = [{
        'type': 'UPSERT',
        'entity': 'profile',
        'items': profile
    }]
    return jsonify({"changes": changes})

@profile_bp.route("/api/profiles/<profile_id>/password", methods=["GET"])
@require_auth
def get_profile_password(profile_id):
    general_models = get_general_models()
    try:
        return jsonify({"password": general_models.get_profile_password(profile_id)})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403

@profile_bp.route("/api/profiles/<profile_id>/password", methods=["PUT"])
@require_auth
def update_profile_password(profile_id):
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

# Current profile endpoints
@profile_bp.route("/api/profiles/current", methods=["GET"])
@require_auth
def get_current_profile():
    """Get current profile data combining general and event-specific information."""
    event_id = request.args.get('event_id', None)
    
    general_models = get_general_models()
    profile_id = get_jwt_identity()
    
    if event_id:
        event = get_event(event_id)
        profile_event = event.models.get_current_profile()
        profile_event.pop('profile_id')
        profile_event.pop('label')
    else:
        profile_event = {}

    general_models = get_general_models(profile_id)
    profile_general = general_models.profile_context
    profile_general['total_notifications'] = general_models.count_my_total_notifications()
    profile_general['unread_notifications'] = general_models.count_my_unread_notifications()
    profile = {**profile_event, **profile_general}

    return jsonify({"profile": profile})

@profile_bp.route("/api/profiles/current/preferences", methods=["GET"])
@require_auth
def get_current_profile_preferences():
    """Get preferences for the current profile."""
    general_models = get_general_models()
    profile_id = get_jwt_identity()
    
    try:
        preferences = general_models.get_profile_preferences(profile_id)
        return jsonify({"preferences": preferences})
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/profiles/current/preferences", methods=["PUT"])
@require_auth
def update_current_profile_preferences():
    """Update a single preference for the current profile."""
    general_models = get_general_models()
    profile_id = get_jwt_identity()
    
    data = request.json or {}
    preference_group = data.get('preference_group')
    preference_key = data.get('preference_key')
    preference_value = data.get('preference_value')
    
    if not preference_group or not preference_key or preference_value is None:
        return jsonify({"error": "preference_group, preference_key, and preference_value are required"}), 400
    
    try:
        general_models.update_profile_preferences(profile_id, preference_group, preference_key, preference_value)
        return jsonify({"success": True})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

# Event profile endpoints
@profile_bp.route("/api/events/<event_id>/profiles", methods=["GET"])
@require_auth
def get_event_profiles(event_id):
    event = get_event(event_id)
    profiles = event.models.get_entities('profiles')
    changes = [{
        'type': 'UPSERT',
        'entity': 'profile',
        'items': profiles
    }]
    return jsonify({"changes": changes})

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>", methods=["GET"])
@require_auth
def get_event_profile(event_id, profile_id):
    event = get_event(event_id)
    changes = [{
        'type': 'UPSERT',
        'entity': 'profile',
        'items': event.models.get_entities('profiles', [profile_id])
    },
    {
        'type': 'RELATION_SET',
        'relation': 'profile.images',
        'parentId': profile_id,
        'entities': event.models.get_childs('profiles', profile_id, 'images')
    },
    {
        'type': 'RELATION_SET',
        'relation': 'profile.albums',
        'parentId': profile_id,
        'entities': event.models.get_childs('profiles', profile_id, 'albums')
    },
    {
        'type': 'RELATION_SET',
        'relation': 'profile.groups',
        'parentId': profile_id,
        'entities': event.models.get_childs('profiles', profile_id, 'groups')
    }
    ]
    return jsonify({"changes": changes})

@profile_bp.route("/api/events/<event_id>/profiles/current/archived-access", methods=["GET"])
@require_auth
def get_archived_access(event_id):
    """Get archived access for the current profile."""
    event = get_event(event_id)
    return jsonify({"archived_access": bool(event.models.get_archive_album())})

@profile_bp.route("/api/events/<event_id>/profiles/current/favorites-access", methods=["GET"])
@require_auth
def get_favorites_access(event_id):
    """Get favorites access for the current profile."""
    event = get_event(event_id)
    return jsonify({"favorites_access": bool(event.models.get_favorites_album())})

# Check endpoints
@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/images/check", methods=["POST"])
@require_auth
def check_images_from_profile(event_id, profile_id):
    """Check accessible images for a profile."""
    event = get_event(event_id)
    if not (event.models.get_current_profile()['is_profiles_manager'] and event.models.is_accessible('profiles', profile_id)):
        return jsonify({"error": "Access denied"}), 403
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    have_all = bool(event.models.get_current_profile()['all_images'])
    len_accessible = len(event.models.get_childs('profiles', profile_id, 'images', image_ids, return_ids=True, within=not have_all))
    return jsonify({"len_accessible": len_accessible, "len_inaccessible": len(image_ids) - len_accessible})

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/albums/check", methods=["POST"])
@require_auth
def check_albums_from_profile(event_id, profile_id):
    """Check accessible albums for a profile."""
    event = get_event(event_id)
    if not (event.models.get_current_profile()['is_profiles_manager'] and event.models.is_accessible('profiles', profile_id)):
        return jsonify({"error": "Access denied"}), 403
    data = request.json or {}
    album_ids = data.get('album_ids', [])
    have_all = bool(event.models.get_current_profile()['all_albums'])
    len_accessible = len(event.models.get_childs('profiles', profile_id, 'albums', album_ids, return_ids=True, within=not have_all))
    return jsonify({"len_accessible": len_accessible, "len_inaccessible": len(album_ids) - len_accessible})

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/groups/check", methods=["POST"])
@require_auth
def check_groups_from_profile(event_id, profile_id):
    """Check accessible groups for a profile."""
    event = get_event(event_id)
    if not (event.models.get_current_profile()['is_profiles_manager'] and event.models.is_accessible('profiles', profile_id)):
        return jsonify({"error": "Access denied"}), 403
    data = request.json or {}
    group_ids = data.get('group_ids', [])
    have_all = bool(event.models.get_current_profile()['all_groups'])
    len_accessible = len(event.models.get_childs('profiles', profile_id, 'groups', group_ids, return_ids=True, within=not have_all))
    return jsonify({"len_accessible": len_accessible, "len_inaccessible": len(group_ids) - len_accessible})

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

# Profile CRUD
def _create_profile(data: dict, event_id: str | None = None):
    general_models = get_general_models()
    label = data.get('label', '')
    if not label:
        raise ValueError("Label is required")
    fields = {'label': label}
    if event_id:
        fields['restricted_to_event'] = event_id
    if general_models.is_exists('profiles', fields):
        raise ValueError("Profile with this label already exists")

    hierarchy_rank = data.get('hierarchy_rank', 0)
    password = data.get('password', '')

    can_create_events = data.get('can_create_events', False)
    can_delete_event = data.get('can_delete_event', False)
    can_upload_and_delete_images = data.get('can_upload_and_delete_images', 0)
    can_edit = data.get('can_edit', 0)
    all_images = data.get('all_images', 0)
    all_albums = data.get('all_albums', 0)
    all_groups = data.get('all_groups', 0)
    is_public = data.get('is_public', 0)

    try:
        profile_id = general_models.create_profile(label, password, hierarchy_rank, can_create_events=can_create_events, event_id=event_id, can_delete=can_delete_event)
    except Forbidden as e:
        raise e

    if event_id:
        event = get_event(event_id)
        sanitized = {
            'can_upload_and_delete_images': can_upload_and_delete_images,
            'can_edit': can_edit,
            'all_images': all_images,
            'all_albums': all_albums,
            'all_groups': all_groups,
            'is_public': is_public
        }
        event.models.edit('profiles', profile_id, sanitized)

    return profile_id

@profile_bp.route("/api/profiles", methods=["POST"])
@require_auth
def create_profile():
    data = request.json or {}
    try:
        profile_id = _create_profile(data)
        general_models = get_general_models()
        changes = [{
            'type': 'UPSERT',
            'entity': 'profile',
            'items': general_models.get_entities('profiles', [profile_id])
        }]
        return jsonify({"success": True, "profile_id": profile_id, "changes": changes})
    
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/events/<event_id>/profiles", methods=["POST"])
@require_auth
def create_event_profile(event_id):
    event = get_event(event_id)
    general_models = get_general_models()
    if not event.models.get_current_profile()['is_profiles_manager']:
        return jsonify({"error": "Access denied"}), 403

    data = request.json or {}
    try:
        profile_id = _create_profile(data, event_id)
        changes = [{
            'type': 'UPSERT',
            'entity': 'profile',
            'items': general_models.get_entities('profiles', [profile_id])
        },
        {
            'type': 'UPSERT',
            'entity': 'profile',
            'items': event.models.get_entities('profiles', [profile_id])
        }]
        return jsonify({"success": True, "profile_id": profile_id, "changes": changes})
    
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

def _update_profile(profile_id: str, data: dict, event_id: str | None = None):
    general_models = get_general_models()

    if 'label' in data.keys():
        general_models.update_profile_label(profile_id, data['label'])
    
    if 'hierarchy_rank' in data.keys():
        general_models.update_profile_hierarchy_rank(profile_id, data['hierarchy_rank'])

    if 'password' in data.keys():
        general_models.update_profile_password(profile_id, data['password'])

    if event_id:
        event_fields = [
            'can_delete_event',
            'can_upload_and_delete_images',
            'can_edit',
            'all_images',
            'all_albums',
            'all_groups',
            'is_public'
        ]
        event_data = {k: v for k, v in data.items() if k in event_fields}
        event = get_event(event_id)
        event.models.edit('profiles', profile_id, event_data)

@profile_bp.route("/api/profiles/<profile_id>", methods=["PUT"])
@require_auth
def update_profile(profile_id):
    data = request.json or {}
    try:
        _update_profile(profile_id, data)
        general_models = get_general_models()
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

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>", methods=["PUT"])
@require_auth
def update_event_profile(event_id, profile_id):
    event = get_event(event_id)
    general_models = get_general_models()
    if not event.models.get_current_profile()['is_profiles_manager']:
        return jsonify({"error": "Access denied"}), 403

    data = request.json or {}
    try:
        _update_profile(profile_id, data, event_id)
        changes = [{
            'type': 'UPSERT',
            'entity': 'profile',
            'items': event.models.get_entities('profiles', [profile_id])
        },
        {
            'type': 'UPSERT',
            'entity': 'profile',
            'items': general_models.get_entities('profiles', [profile_id])
        }]
        return jsonify({"success": True, "profile_id": profile_id, "changes": changes})
    
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/profiles/<profile_id>", methods=["DELETE"])
@require_auth
def delete_profile(profile_id):
    """Delete a profile."""
    general_models = get_general_models()
    try:
        general_models.delete_profile(profile_id)
        changes = [{
            'type': 'REMOVE',
            'entity': 'profile',
            'ids': [profile_id]
        }]
        return jsonify({"success": True, "deleted_ids": [profile_id], "changes": changes})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>", methods=["DELETE"])
@require_auth
def delete_event_profile(event_id, profile_id):
    """Delete a profile."""
    general_models = get_general_models()
    try:
        general_models.delete_profile(profile_id, event_id)
        changes = [{
            'type': 'REMOVE',
            'entity': 'profile',
            'ids': [profile_id]
        }]
        return jsonify({"success": True, "deleted_ids": [profile_id], "changes": changes})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

# Access management
def _edit_event_profile_childs(event, profile_id, child: str, child_ids, add: bool):
    """Add or remove multiple childs from a profile."""
    if not event.models.get_current_profile()['is_profiles_manager']:
        return jsonify({"error": "Access denied"}), 403
    
    if child not in ['images', 'albums', 'groups']:
        return jsonify({"error": f"Invalid child: {child}"}), 400

    try:
        operation = ChildOperation.ADD if add else ChildOperation.REMOVE
        affected_ids, _ = event.models.edit_childs('profiles', profile_id, child, child_ids, operation=operation)
        if add:
            changes = [{
                'type': 'RELATION_ADD',
                'relation': f'profile.{child}',
                'parentId': profile_id,
                'entities': event.models.get_childs('profiles', profile_id, child, child_ids)
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

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/images", methods=["PUT"])
@require_auth
def add_images_to_profile(event_id, profile_id):
    """Add multiple images to a profile."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    return _edit_event_profile_childs(event, profile_id, 'images', image_ids, add=True)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/images", methods=["DELETE"])
@require_auth
def remove_images_from_profile(event_id, profile_id):
    """Remove multiple images from a profile."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    return _edit_event_profile_childs(event, profile_id, 'images', image_ids, add=False)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/albums", methods=["PUT"])
@require_auth
def add_albums_to_profile(event_id, profile_id):
    """Add multiple albums to a profile."""
    event = get_event(event_id)
    data = request.json or {}
    album_ids = data.get('album_ids', [])
    return _edit_event_profile_childs(event, profile_id, 'albums', album_ids, add=True)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/albums", methods=["DELETE"])
@require_auth
def remove_albums_from_profile(event_id, profile_id):
    """Remove multiple albums from a profile."""
    event = get_event(event_id)
    data = request.json or {}
    album_ids = data.get('album_ids', [])
    return _edit_event_profile_childs(event, profile_id, 'albums', album_ids, add=False)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/groups", methods=["PUT"])
@require_auth
def add_groups_to_profile(event_id, profile_id):
    """Add multiple groups to a profile."""
    event = get_event(event_id)
    data = request.json or {}
    group_ids = data.get('group_ids', [])
    return _edit_event_profile_childs(event, profile_id, 'groups', group_ids, add=True)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/groups", methods=["DELETE"])
@require_auth
def remove_groups_from_profile(event_id, profile_id):
    """Remove multiple groups from a profile."""
    event = get_event(event_id)
    data = request.json or {}
    group_ids = data.get('group_ids', [])
    return _edit_event_profile_childs(event, profile_id, 'groups', group_ids, add=False)

def _set_profile_accessibility(event, profile_id, child: str, child_ids, set_accessible: bool):
    """Set multiple childs as accessible or inaccessible to a profile."""
    if not (event.models.get_current_profile()['is_profiles_manager'] and event.models.is_accessible('profiles', profile_id)):
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
                'entities': event.models.get_childs('profiles', profile_id, child, child_ids)
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

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/accessible-images", methods=["PUT"])
@require_auth
def set_images_as_accessible(event_id, profile_id):
    """Set multiple images as accessible to a profile."""
    event = get_event(event_id)

    data = request.json or {}
    image_ids = data.get('image_ids', [])
    return _set_profile_accessibility(event, profile_id, 'images', image_ids, set_accessible=True)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/accessible-images", methods=["DELETE"])
@require_auth
def set_images_as_inaccessible(event_id, profile_id):
    """Set multiple images as inaccessible to a profile."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    return _set_profile_accessibility(event, profile_id, 'images', image_ids, set_accessible=False)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/accessible-albums", methods=["PUT"])
@require_auth
def set_albums_as_accessible(event_id, profile_id):
    """Set multiple albums as accessible to a profile."""
    event = get_event(event_id)
    data = request.json or {}
    album_ids = data.get('album_ids', [])
    return _set_profile_accessibility(event, profile_id, 'albums', album_ids, set_accessible=True)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/accessible-albums", methods=["DELETE"])
@require_auth
def set_albums_as_inaccessible(event_id, profile_id):
    """Set multiple albums as inaccessible to a profile."""
    event = get_event(event_id)
    data = request.json or {}
    album_ids = data.get('album_ids', [])
    return _set_profile_accessibility(event, profile_id, 'albums', album_ids, set_accessible=False)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/accessible-groups", methods=["PUT"])
@require_auth
def set_groups_as_accessible(event_id, profile_id):
    """Set multiple groups as accessible to a profile."""
    event = get_event(event_id)
    data = request.json or {}
    group_ids = data.get('group_ids', [])
    return _set_profile_accessibility(event, profile_id, 'groups', group_ids, set_accessible=True)

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/accessible-groups", methods=["DELETE"])
@require_auth
def set_groups_as_inaccessible(event_id, profile_id):
    """Set multiple groups as inaccessible to a profile."""
    event = get_event(event_id)
    data = request.json or {}
    group_ids = data.get('group_ids', [])
    return _set_profile_accessibility(event, profile_id, 'groups', group_ids, set_accessible=False)

# Public access code management
@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/public-access-code", methods=["POST"])
@require_auth
def generate_public_access_code(event_id, profile_id):
    """Generate a public access code for a profile."""
    event = get_event(event_id)
    if not event.models.get_current_profile()['is_profiles_manager']:
        return jsonify({"error": "Access denied"}), 403
    
    try:
        # Check if profile is public
        profile = event.models.get_entities('profiles', [profile_id])
        if not profile or not profile[profile_id].get('is_public'):
            return jsonify({"error": "Profile must be public to generate access code"}), 400
        
        public_code = event.models.generate_public_access_code(profile_id)
        
        changes = [{
            'type': 'UPSERT',
            'entity': 'profile',
            'items': event.models.get_entities('profiles', [profile_id])
        }]
        
        return jsonify({"success": True, "public_code": public_code, "changes": changes})
    
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@profile_bp.route("/api/events/<event_id>/profiles/<profile_id>/public-access-code", methods=["DELETE"])
@require_auth
def remove_public_access_code(event_id, profile_id):
    """Remove public access code for a profile."""
    event = get_event(event_id)
    if not event.models.get_current_profile()['is_profiles_manager']:
        return jsonify({"error": "Access denied"}), 403
    
    try:
        event.models.revoke_public_access_code(profile_id)
        
        changes = [{
            'type': 'UPSERT',
            'entity': 'profile',
            'items': event.models.get_entities('profiles', [profile_id])
        }]
        
        return jsonify({"success": True, "changes": changes})
    
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

