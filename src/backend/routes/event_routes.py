from flask import Blueprint, jsonify, request

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_general_models, Forbidden, DatabaseError

event_bp = Blueprint('events', __name__, url_prefix='/api')

@event_bp.route('/events', methods=['GET'])
def get_events():
    """List all events (id->event map). Public endpoint (no auth) for resolver and home."""
    gm = get_general_models(profile_id=None)
    try:
        # Return as { id: { ...event } }
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
        event = gm.get_entities('events', event_id)
        if not event:
            return jsonify({"error": "Event not found"}), 404
        return jsonify({ 'event': event, 'event_id': event_id })
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
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


