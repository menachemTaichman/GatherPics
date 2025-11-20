from flask import Blueprint, jsonify, request

from src.backend.middleware.auth import require_auth, optional_auth
from src.backend.helpers import get_general_models, Forbidden, DatabaseError, get_event as get_event_instance
from src.core.errors import DBPolicyError

event_bp = Blueprint('events', __name__, url_prefix='/api')

@event_bp.route('/events', methods=['GET'])
@optional_auth
def get_events():
    """List all events (id->event map). Optional auth for profile context."""
    gm = get_general_models()
    try:
        events = gm.get_entities('events')
        changes = [{
            'type': 'UPSERT',
            'entity': 'event',
            'items': events,
        }]
        return jsonify({'changes': changes})
    except Forbidden as e:
        return jsonify({}), 200
    except DatabaseError as e:
        return jsonify({}), 200
    except Exception:
        return jsonify({}), 200

@event_bp.route('/events/<event_id>', methods=['GET'])
@require_auth
def get_event(event_id):
    """Get single event details (auth required to include access-controlled fields if any)."""
    gm = get_general_models()
    event_instance = get_event_instance(event_id)
    try:
        event_items = gm.get_entities('events', [event_id], include_details=True)
        if not event_items:
            return jsonify({"error": "Event not found"}), 404

        changes = [{
            'type': 'UPSERT',
            'entity': 'event',
            'items': event_items,
            'event_id': 'general'
        }]
        return jsonify({'changes': changes})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@event_bp.route('/events/<event_id>', methods=['PUT'])
@require_auth
def update_event(event_id):
    """Update basic event settings (name, URL, visibility, limits)."""
    gm = get_general_models()
    data = request.json or {}

    allowed_fields = {
        'name',
        'url',
        'date',
        'is_public',
        'images_count_limit',
        'image_size_limit_bytes',
        'rekognition_calls_limit',
        'representative_image',
    }

    sanitized = {k: data[k] for k in data.keys() if k in allowed_fields}

    try:
        if sanitized:
            gm.edit('events', event_id, sanitized)
            updated = gm.get_entities('events', [event_id], include_details=True)
            changes = [{
                'type': 'UPSERT',
                'entity': 'event',
                'items': updated,
                'event_id': 'general'
            }]

        return jsonify({'success': True, 'changes': changes})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DBPolicyError as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@event_bp.route('/events/<event_id>', methods=['DELETE'])
@require_auth
def delete_event(event_id):
    """Delete an event."""
    gm = get_general_models()
    try:
        gm.delete_event(event_id)
        changes = [{
            'type': 'REMOVE',
            'entity': 'event',
            'ids': [event_id],
            'event_id': 'general'
        },{
            'type': 'UPSERT',
            'entity': 'localStorage',
            'items': {
                'currentProfile': gm.get_current_profile()
            }
        }]
        return jsonify({'success': True, 'deleted_ids': [event_id], 'changes': changes})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DBPolicyError as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@event_bp.route('/events', methods=['POST'])
@require_auth
def create_event():
    """Create a new event."""
    gm = get_general_models()
    data = request.json or {}

    allowed_fields = {
        'name',
        'url',
        'date',
        'is_public',
        'images_count_limit',
        'image_size_limit_bytes',
    }

    sanitized = {k: data.get(k) for k in allowed_fields if k in data}

    name = (sanitized.get('name') or '').strip()
    url = (sanitized.get('url') or '').strip()
    if not name:
        return jsonify({"error": "Event name is required"}), 400
    if not url:
        return jsonify({"error": "Event URL is required"}), 400

    sanitized['name'] = name
    sanitized['url'] = url
    sanitized['date'] = sanitized.get('date') or None
    sanitized['is_public'] = 1 if sanitized.get('is_public') else 0

    images_limit = sanitized.get('images_count_limit')
    if images_limit not in (None, ''):
        try:
            sanitized['images_count_limit'] = int(images_limit)
        except (ValueError, TypeError):
            return jsonify({"error": "images_count_limit must be an integer"}), 400
    else:
        sanitized['images_count_limit'] = None

    size_limit = sanitized.get('image_size_limit_bytes')
    if size_limit not in (None, ''):
        try:
            sanitized['image_size_limit_bytes'] = int(size_limit)
        except (ValueError, TypeError):
            return jsonify({"error": "image_size_limit_bytes must be an integer"}), 400
    else:
        sanitized['image_size_limit_bytes'] = None

    try:
        event_id = gm.create_event(sanitized)
        event = gm.get_entities('events', [event_id], include_details=True)
        changes = [{
            'type': 'UPSERT',
            'entity': 'event',
            'items': event,
            'event_id': 'general'
        },{
            'type': 'UPSERT',
            'entity': 'localStorage',
            'items': {
                'currentProfile': gm.get_current_profile()
            }
        }]
        return jsonify({'success': True, 'event_id': event_id, 'changes': changes}), 201
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DBPolicyError as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@event_bp.route('/events/resolve', methods=['GET'])
def resolve_event():
    """Resolve event by URL slug. Public endpoint used by client resolver."""
    url = request.args.get('url', '').strip()
    if not url:
        return jsonify({"error": "url is required"}), 400
    
    # Check for reserved URLs (like 'dashboard') before checking event URLs
    if url == 'dashboard':
        return jsonify({"error": "Event not found"}), 404
    
    gm = get_general_models()
    try:
        event = gm.get_event_by_url(url)
        if not event:
            return jsonify({"error": "Event not found"}), 404
        return jsonify({ 'event_id': event.get('event_id') or event.get('id'), 'event': event })
    except Exception:
        return jsonify({"error": "Event not found"}), 404

@event_bp.route('/events/<event_id>/url', methods=['GET'])
def get_event_url(event_id):
    """Get event URL by ID (public)."""
    gm = get_general_models()
    try:
        url = gm.get_event_url(event_id)
        if not url:
            return jsonify({"error": "Event not found"}), 404
        return jsonify({ 'event_id': event_id, 'url': url })
    except Exception:
        return jsonify({"error": "Event not found"}), 404

@event_bp.route('/events/check-name', methods=['POST'])
@require_auth
def check_event_name():
    gm = get_general_models()
    data = request.json or {}
    name = (data.get('name') or '').strip()
    exclude_event_id = data.get('exclude_event_id')

    if not name:
        return jsonify({"error": "Name is required"}), 400

    conflict_id = gm.is_exists('events', {'name': name}, exclude_id=exclude_event_id)
    return jsonify({'conflict': bool(conflict_id), 'conflicting_event': conflict_id})

@event_bp.route('/events/check-url', methods=['POST'])
@require_auth
def check_event_url():
    gm = get_general_models()
    data = request.json or {}
    url = (data.get('url') or '').strip()
    exclude_event_id = data.get('exclude_event_id')

    if not url:
        return jsonify({"error": "URL is required"}), 400

    conflict_id = gm.is_exists('events', {'url': url}, exclude_id=exclude_event_id)
    return jsonify({'conflict': bool(conflict_id), 'conflicting_event': conflict_id})

@event_bp.route('/events/uploads-limits', methods=['GET'])
@require_auth
def get_uploads_limits():
    """Get the maximum upload limits for events."""
    gm = get_general_models()
    try:
        limits = gm.get_uploads_limits()
        return jsonify(limits)
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400


