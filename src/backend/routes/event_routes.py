from flask import Blueprint, jsonify, request

from src.backend.middleware.auth import require_auth, optional_auth
from src.backend.helpers import get_general_models, Forbidden, DatabaseError
from src.core.errors import DBPolicyError

event_bp = Blueprint('events', __name__, url_prefix='/api')

@event_bp.route('/events', methods=['GET'])
@optional_auth
def get_events():
    """List all events (id->event map). Optional auth for profile context."""
    gm = get_general_models()
    try:
        events = gm.get_entities('events')
        return jsonify(events or {})
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
    try:
        event = gm.get_entities('events', [event_id], include_details=True)
        if not event:
            return jsonify({"error": "Event not found"}), 404
        changes = [{
            'type': 'UPSERT',
            'entity': 'event',
            'items': event,
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
        'is_public',
        'images_count_limit',
        'image_size_limit_bytes',
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

@event_bp.route('/events/resolve', methods=['GET'])
def resolve_event():
    """Resolve event by URL slug. Public endpoint used by client resolver."""
    url = request.args.get('url', '').strip()
    if not url:
        return jsonify({"error": "url is required"}), 400
    
    # Check for reserved URLs (like 'dashboard') before checking event URLs
    if url == 'dashboard':
        return jsonify({"error": "Event not found"}), 404
    
    gm = get_general_models(profile_id=None)
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
    gm = get_general_models(profile_id=None)
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


