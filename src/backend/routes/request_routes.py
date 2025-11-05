from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event, get_general_models, ChildOperation, Forbidden, DatabaseError

request_bp = Blueprint('requests', __name__, url_prefix='/api/events/<event_id>')

# ==================== MANAGER ROUTES (all access_requests) ====================

@request_bp.route("/requests", methods=["GET"])
@require_auth
def get_requests(event_id):
    """List all accessible requests for managers."""
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
    event = get_event(event_id)

    request_data = event.models.get_entities('my_access_requests', [request_id])
    groups, relation_data = event.models.get_childs('my_access_requests', request_id, 'groups')
    changes = [{
        'type': 'UPSERT',
        'entity': 'my_access_request',
        'items': request_data
    },{
        'type': 'RELATION_SET',
        'relation': 'my_access_request.groups',
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
    general_models = get_general_models()
    data = request.json or {}
    
    try:

        request_data = {
            'profile_id': get_jwt_identity(),
            'applicant_name': data['applicant_name'],
            'applicant_email': data.get('applicant_email'),
            'applicant_phone': data.get('applicant_phone'),
            'details': data.get('details'),
            'applicant_profile_id': data.get('applicant_profile_id'),
            'communication_consent': data.get('communication_consent'),
        }
        request_id = general_models.create_access_request(event_id, request_data, data.get('group_ids'))
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
        
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@request_bp.route("/my-requests/<int:request_id>", methods=["PATCH"])
@require_auth
def update_my_request(event_id, request_id):
    """Update current user's own request."""
    event = get_event(event_id)
    general_models = get_general_models()
        
    data = request.json or {}
    try:
        allowed_fields = {'applicant_name', 'applicant_email', 'applicant_phone', 'details', 'communication_consent'}
        sanitized = {k: v for k, v in data.items() if k in allowed_fields}
        
        if sanitized:
            event.models.edit('my_access_requests', request_id, sanitized)

        edited = False
        # Handle groups to add
        if 'groups_to_add' in data and isinstance(data['groups_to_add'], list) and len(data['groups_to_add']) > 0:
            event.models.edit_childs('my_access_requests', request_id, 'groups', data['groups_to_add'], operation=ChildOperation.ADD)
            edited = True

        # Handle groups to remove
        if 'groups_to_remove' in data and isinstance(data['groups_to_remove'], list) and len(data['groups_to_remove']) > 0:
            event.models.edit_childs('my_access_requests', request_id, 'groups', data['groups_to_remove'], operation=ChildOperation.REMOVE)
            edited = True
            
        if edited:
            general_models.ensure_access_request_notifications(event, request_id)
            
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
        },
        {
            'type': 'UPSERT',
            'entity': 'localStorage',
            'items': {
                'currentProfile': event.models.get_current_profile()
            }
        }]
        return jsonify(response)
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@request_bp.route("/my-requests/<int:request_id>", methods=["DELETE"])
@require_auth
def delete_my_request(event_id, request_id):
    """Delete current user's own request."""
    event = get_event(event_id)
    
    try:
        event.models.delete('access_requests', request_id)
        
        response = {"success": True, "deleted_ids": [request_id]}
        response['changes'] = [{
            'type': 'REMOVE',
            'entity': 'my_access_request',
            'ids': [request_id]
        }]
        return jsonify(response)
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@request_bp.route("/requests/<int:request_id>/toggle", methods=["POST"])
@require_auth
def toggle_request(event_id, request_id):
    """Toggle access request (approve/deny groups)."""
    event = get_event(event_id)
    if not event.models.is_accessible('access_requests', request_id):
        return jsonify({"error": f"Request {request_id} not found or not accessible"}), 404
    
    data = request.json or {}
    try:
        approved_group_ids = data.get('groupsApproved') or []
        denied_group_ids = data.get('groupsDenied') or []
        closed_details = data.get('closedDetails')
        profile_name = data.get('profileName')
        
        general_models = get_general_models()
        applicant_profile_id = general_models.toggle_access_request(
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
                'currentProfile': event.models.get_current_profile()
            }
        })
        
        if applicant_profile_id and applicant_profile_id != updated_request[request_id]['profile_id']:
            changes.append({
                'type': 'UPSERT',
                'entity': 'profile',
                'items': event.models.get_entities('profiles', [applicant_profile_id])
            })
            label = general_models.get_entities('profiles', applicant_profile_id).get('label')
            password = general_models.get_profile_password(applicant_profile_id)
            return jsonify({'success': True, 'changes': changes, 'new_profile': {'label': label, 'password': password}})
        
        return jsonify({'success': True, 'changes': changes})
        
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400
