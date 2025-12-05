from flask import Blueprint, jsonify
from flask_jwt_extended import get_jwt_identity

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event, get_general_models, ChildOperation
from src.backend.validators import get_input, get_multiple_inputs, validate_path_param

request_bp = Blueprint('requests', __name__, url_prefix='/api/events/<event_id>')

# ==================== MANAGER ROUTES (all access_requests) ====================

@request_bp.route("/requests", methods=["GET"])
@require_auth
def get_requests(event_id):
    """List all accessible requests for managers."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    requests = event.models.get_entities('access_requests')
    changes = [{
        'type': 'UPSERT',
        'entity': 'access_request',
        'items': requests
    }]
    return jsonify({'changes': changes})

@request_bp.route("/requests/<int:request_id>", methods=["GET"])
@require_auth
def get_request(event_id, request_id):
    """Get a specific access request for managers."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    if not event.models.is_accessible('access_requests', request_id):
        return jsonify({"error": f"Request {request_id} not found or not accessible"}), 404

    request_data = event.models.get_entities('access_requests', [request_id])
    
    # TODO: simplify when moving to postgres
    if request_data and request_data.get(request_id).get('applicant_profile_id'):
        general_models = get_general_models()
        email = general_models.get_entities('profiles', request_data[request_id]['applicant_profile_id']).get('email')
        if email:
            request_data[request_id]['applicant_email'] = email
        
    groups, relation_data = event.models.get_childs('access_requests', request_id, 'groups')
    changes = [{
        'type': 'UPSERT',
        'entity': 'access_request',
        'items': request_data
    },{
        'type': 'RELATION_SET',
        'relation': 'access_request.groups',
        'parentId': request_id,
        'entities': groups,
        'relationData': relation_data
    }]
    
    return jsonify({'changes': changes})

# ==================== USER ROUTES (my_access_requests) ====================

@request_bp.route("/my-requests", methods=["GET"])
@require_auth
def get_my_requests(event_id):
    """List current user's own requests."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    requests = event.models.get_entities('my_access_requests')
    changes = [{
        'type': 'UPSERT',
        'entity': 'my_access_request',
        'items': requests
    }]
    return jsonify({'changes': changes})

@request_bp.route("/my-requests/<int:request_id>", methods=["GET"])
@require_auth
def get_my_request(event_id, request_id):
    """Get a specific request belonging to current user."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)

    request_data = event.models.get_entities('my_access_requests', [request_id])
    groups = event.models.get_my_access_request_groups(request_id)
    request_data[request_id]['groups'] = groups
    changes = [{
        'type': 'UPSERT',
        'entity': 'my_access_request',
        'items': request_data
    }]
    
    return jsonify({'changes': changes})

@request_bp.route("/requests", methods=["POST"])
@require_auth
def create_access_request(event_id):
    """Create a new access request."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    
    request_data = {
        'profile_id': get_jwt_identity(),
        'applicant_name': get_input('applicant_name', required=True),
        'applicant_email': get_input('applicant_email', required=False),
        'applicant_phone': get_input('applicant_phone', required=False),
        'details': get_input('details', required=False),
        'applicant_profile_id': get_input('applicant_profile_id', required=False),
        'communication_consent': get_input('communication_consent', required=False) or False,
    }
    group_ids = get_input('group_ids', required=True)
    
    # request_id = event.models.add('my_access_requests', request_data)
    # event.models.edit_childs('my_access_requests', request_id, 'groups', group_ids, operation=ChildOperation.ADD)

    request_id = event.models.create_access_request(request_data, group_ids)
    created_request = event.models.get_entities('my_access_requests', [request_id])
    changes = []
    if created_request:
        changes.append({
            'type': 'UPSERT',
            'entity': 'my_access_request',
            'items': created_request
        })
    
    # Include the new request id explicitly so clients can reference it immediately
    return jsonify({'success': True, 'access_request_id': request_id, 'changes': changes})

@request_bp.route("/my-requests/<int:request_id>", methods=["PATCH"])
@require_auth
def update_my_request(event_id, request_id):
    """Update current user's own request."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    
    sanitized = get_multiple_inputs(['applicant_name', 'applicant_email', 'applicant_phone', 'details', 'communication_consent'])
    
    if sanitized:
        event.models.edit('my_access_requests', request_id, sanitized)

    # Handle groups to add
    groups_to_add = get_input('groups_to_add', required=False)
    if groups_to_add and isinstance(groups_to_add, list) and len(groups_to_add) > 0:
        event.models.edit_childs('my_access_requests', request_id, 'groups', groups_to_add, operation=ChildOperation.ADD)

    # Handle groups to remove
    groups_to_remove = get_input('groups_to_remove', required=False)
    if groups_to_remove and isinstance(groups_to_remove, list) and len(groups_to_remove) > 0:
        event.models.edit_childs('my_access_requests', request_id, 'groups', groups_to_remove, operation=ChildOperation.REMOVE)
        
    updated_request = event.models.get_entities('my_access_requests', [request_id])
    groups, relation_data = event.models.get_childs('my_access_requests', request_id, 'groups')

    changes = [{
        'type': 'UPDATE',
        'entity': 'my_access_request',
        'items': updated_request
    }, {
        'type': 'RELATION_SET',
        'relation': 'my_access_request.groups',
        'parentId': request_id,
        'entities': groups,
        'relationData': relation_data
    }]
    
    response = {"success": True, "changes": changes}
    return jsonify(response)

@request_bp.route("/requests/<int:request_id>", methods=["DELETE"])
@require_auth
def delete_request(event_id, request_id):
    """Delete an access request."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    general_models = get_general_models()
    if not event.models.is_accessible('access_requests', request_id):
        return jsonify({"error": f"Request {request_id} not found or not accessible"}), 404
    
    event.models.delete('access_requests', request_id)
    
    response = {"success": True, "deleted_ids": [request_id]}
    response['changes'] = [{
        'type': 'REMOVE',
        'entity': 'access_request',
        'ids': [request_id]
    },
    {
        'type': 'UPSERT',
        'entity': 'localStorage',
        'items': {
            'currentProfile': general_models.get_current_profile(event_id)
        }
    }
    ]
    return jsonify(response)

@request_bp.route("/requests/all", methods=["DELETE"])
@require_auth
def delete_all_requests(event_id):
    """Delete all access requests for this event."""
    event_id = validate_path_param('event_id', event_id)
    general_models = get_general_models()
    event = get_event(event_id)
    deleted_ids = event.models.delete_all('access_requests')
    changes = [{
        'type': 'REMOVE',
        'entity': 'access_request',
        'ids': deleted_ids
    }, {
        'type': 'UPSERT',
        'entity': 'localStorage',
        'items': {
            'currentProfile': general_models.get_current_profile(event_id)
        }
    }]
    return jsonify({'success': True, 'changes': changes, 'deleted_ids': deleted_ids})

@request_bp.route("/my-requests/<int:request_id>", methods=["DELETE"])
@require_auth
def delete_my_request(event_id, request_id):
    """Delete current user's own request."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    
    event.models.delete('my_access_requests', request_id)
    
    response = {"success": True, "deleted_ids": [request_id]}
    response['changes'] = [{
        'type': 'REMOVE',
        'entity': 'my_access_request',
        'ids': [request_id]
    }]
    return jsonify(response)

@request_bp.route("/requests/<int:request_id>/toggle", methods=["POST"])
@require_auth
def toggle_request(event_id, request_id):
    """Toggle access request (approve/deny groups)."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    if not event.models.is_accessible('access_requests', request_id):
        return jsonify({"error": f"Request {request_id} not found or not accessible"}), 404
    
    approved_group_ids = get_input('groups_approved', required=False) or []
    denied_group_ids = get_input('groups_denied', required=False) or []
    closed_details = get_input('closed_details', required=False)
    profile_name = get_input('profile_name', required=False)
    
    general_models = get_general_models()
    applicant_profile_id, label, password = general_models.toggle_access_request(
        event_id, 
        request_id,
        approved_group_ids=approved_group_ids,
        denied_group_ids=denied_group_ids,
        closed_details=closed_details,
        profile_name=profile_name
    )
    
    # Return updated request
    updated_request = event.models.get_entities('access_requests', [request_id])
    groups, relation_data = event.models.get_childs('access_requests', request_id, 'groups')
    changes = [{
        'type': 'UPDATE',
        'entity': 'access_request',
        'items': updated_request
    },{
        'type': 'RELATION_SET',
        'relation': 'access_request.groups',
        'parentId': request_id,
        'entities': groups,
        'relationData': relation_data
    }]
    changes.append({
        'type': 'UPSERT',
        'entity': 'localStorage',
        'items': {
            'currentProfile': general_models.get_current_profile(event_id)
        }
    })
    
    if applicant_profile_id and applicant_profile_id != updated_request[request_id]['profile_id']:
        changes.append({
            'type': 'UPSERT',
            'entity': 'profile',
            'items': event.models.get_entities('profiles', [applicant_profile_id])
        })
        return jsonify({'success': True, 'changes': changes, 'new_profile': {'label': label, 'password': password}})
    
    return jsonify({'success': True, 'changes': changes, 'new_profile': {'label': label, 'password': password}})
