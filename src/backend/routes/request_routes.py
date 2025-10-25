from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event, get_general_models, ChildOperation
from src.core.errors import Forbidden, DatabaseError

request_bp = Blueprint('requests', __name__, url_prefix='/api/events/<event_id>')

@request_bp.route("/requests", methods=["GET"])
@require_auth
def get_requests(event_id):
    """List all accessible requests for the specific event."""
    event = get_event(event_id)
    requests = event.models.get_entities('access_requests')
    changes = [{
        'type': 'UPSERT',
        'entity': 'access_request',
        'items': requests
    }]
    return jsonify({'changes': changes})

@request_bp.route("/requests/open-count", methods=["GET"])
@require_auth
def get_open_requests_count(event_id):
    """Get count of pending requests."""
    event = get_event(event_id)
    count = event.models.get_open_requests_count()
    return jsonify({'count': count})

@request_bp.route("/requests/<int:request_id>", methods=["GET"])
@require_auth
def get_request(event_id, request_id):
    """Get a specific request's details as changes."""
    event = get_event(event_id)
    if not event.models.is_accessible('access_requests', request_id):
        return jsonify({"error": f"Request {request_id} not found or not accessible"}), 404

    request_data = event.models.get_entities('access_requests', [request_id])
    groups, relation_data = event.models.get_childs('access_requests', request_id, 'groups')
    changes = [{
        'type': 'UPSERT',
        'entity': 'access_request',
        'items': request_data
    },{
        'type': 'RELATION_ADD',
        'relation': 'access_request.groups',
        'parentId': request_id,
        'entities': groups,
        'relationData': relation_data
    }]
    
    return jsonify({'changes': changes})

@request_bp.route("/requests", methods=["POST"])
@require_auth
def create_access_request(event_id):
    """Create a new access request."""
    event = get_event(event_id)
    data = request.json or {}
    
    try:
        request_data = {
            'profile_id': get_jwt_identity(),
            'applicant_name': data['applicant_name'],
            'applicant_email': data.get('applicant_email'),
            'applicant_phone': data.get('applicant_phone'),
            'details': data.get('details'),
        }
        
        request_id = event.models.add('access_requests', request_data)
        
        # Add groups to the request
        if data['group_ids'] and isinstance(data['group_ids'], list):
            event.models.edit_childs('access_requests', request_id, 'groups', data['group_ids'], operation=ChildOperation.ADD)
        
        # Return the created request
        created_request = event.models.get_entities('access_requests', [request_id])
        changes = [{
            'type': 'UPSERT',
            'entity': 'access_request',
            'items': created_request
        }]
        
        return jsonify({'success': True, 'changes': changes})
        
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@request_bp.route("/requests/<int:request_id>", methods=["PATCH"])
@require_auth
def update_request(event_id, request_id):
    """Update an access request's details."""
    event = get_event(event_id)
    if not event.models.is_accessible('access_requests', request_id):
        return jsonify({"error": f"Request {request_id} not found or not accessible"}), 404
        
    data = request.json or {}
    try:
        allowed_fields = {'applicant_name', 'applicant_email', 'applicant_phone', 'details'}
        sanitized = {k: v for k, v in data.items() if k in allowed_fields}
        
        if sanitized:
            event.models.edit('access_requests', request_id, sanitized)
            updated_request = event.models.get_entities('access_requests', [request_id])
            changes = [{
                'type': 'UPDATE',
                'entity': 'access_request',
                'items': updated_request
            }]
            response = {"success": True, "changes": changes}
        else:
            response = {"success": False}
        return jsonify(response)
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@request_bp.route("/requests/<int:request_id>", methods=["DELETE"])
@require_auth
def delete_request(event_id, request_id):
    """Delete an access request."""
    event = get_event(event_id)
    if not event.models.is_accessible('access_requests', request_id):
        return jsonify({"error": f"Request {request_id} not found or not accessible"}), 404
    
    try:
        event.models.delete('access_requests', request_id)
        
        response = {"success": True, "deleted_ids": [request_id]}
        response['changes'] = [{
            'type': 'REMOVE',
            'entity': 'access_request',
            'ids': [request_id]
        }]
        return jsonify(response)
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@request_bp.route("/requests/<int:request_id>/approve", methods=["POST"])
@require_auth
def approve_request(event_id, request_id):
    """Approve an access request (partial or full)."""
    event = get_event(event_id)
    if not event.models.is_accessible('access_requests', request_id):
        return jsonify({"error": f"Request {request_id} not found or not accessible"}), 404
    
    data = request.json or {}
    try:
        group_ids = data.get('group_ids')  # None means approve all
        close = data.get('close', False)
        closed_details = data.get('closed_details')
        profile_name = data.get('profile_name')
        
        general_models = get_general_models()
        general_models.toggle_access_request(event_id, request_id, True, group_ids, close, closed_details, profile_name)
        
        # Return updated request
        updated_request = event.models.get_entities('access_requests', [request_id])
        groups, relation_data = event.models.get_childs('access_requests', request_id, 'groups')
        changes = [{
            'type': 'UPDATE',
            'entity': 'access_request',
            'items': updated_request
        },{
            'type': 'RELATION_ADD',
            'relation': 'access_request.groups',
            'parentId': request_id,
            'entities': groups,
            'relationData': relation_data
        }]
        
        return jsonify({'success': True, 'changes': changes})
        
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@request_bp.route("/requests/<int:request_id>/deny", methods=["POST"])
@require_auth
def deny_request(event_id, request_id):
    """Deny an access request (partial or full)."""
    event = get_event(event_id)
    if not event.models.is_accessible('access_requests', request_id):
        return jsonify({"error": f"Request {request_id} not found or not accessible"}), 404
    
    data = request.json or {}
    try:
        group_ids = data.get('group_ids')  # None means deny all
        close = data.get('close', False)
        closed_details = data.get('closed_details')
        general_models = get_general_models()
        general_models.toggle_access_request(event_id, request_id, False, group_ids, close, closed_details)
        updated_request = event.models.get_entities('access_requests', [request_id])
        groups, relation_data = event.models.get_childs('access_requests', request_id, 'groups')
        changes = [{
            'type': 'UPDATE',
            'entity': 'access_request',
            'items': updated_request
        },{
            'type': 'RELATION_ADD',
            'relation': 'access_request.groups',
            'parentId': request_id,
            'entities': groups,
            'relationData': relation_data
        }]
        return jsonify({'success': True, 'changes': changes})
        
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400
