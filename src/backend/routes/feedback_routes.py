from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_general_models
from src.backend.validators import get_input, get_multiple_inputs

feedback_bp = Blueprint('feedbacks', __name__, url_prefix='/api')

# ==================== DEVELOPER ROUTES (all feedbacks) ====================

@feedback_bp.route("/feedbacks", methods=["GET"])
@require_auth
def get_feedbacks():
    """List all feedbacks for developer."""
    general_models = get_general_models()
    feedbacks = general_models.get_entities('feedbacks')
    changes = [{
        'type': 'UPSERT',
        'entity': 'feedback',
        'items': feedbacks
    }]
    return jsonify({'changes': changes})

@feedback_bp.route("/feedbacks/<int:feedback_id>", methods=["GET"])
@require_auth
def get_feedback(feedback_id):
    """Get a specific feedback for developer."""
    general_models = get_general_models()
    if not general_models.is_accessible('feedbacks', feedback_id):
        return jsonify({"error": f"Feedback {feedback_id} not found or not accessible"}), 404

    feedback_data = general_models.get_entities('feedbacks', [feedback_id], include_details=True)
    
    changes = [{
        'type': 'UPSERT',
        'entity': 'feedback',
        'items': feedback_data
    }]
    
    return jsonify({'changes': changes})

@feedback_bp.route("/feedbacks/<int:feedback_id>", methods=["PATCH"])
@require_auth
def update_feedback(feedback_id):
    """Update a feedback - developer only."""
    general_models = get_general_models()
    
    sanitized = get_multiple_inputs(['type', 'notes', 'is_closed', 'solved', 'closed_at', 'closed_by', 'closed_details'])
    
    if sanitized:
        general_models.edit('feedbacks', feedback_id, sanitized)

    updated_feedback = general_models.get_entities('feedbacks', [feedback_id])
    
    changes = [{
        'type': 'UPDATE',
        'entity': 'feedback',
        'items': updated_feedback
    }, {
        'type': 'UPSERT',
        'entity': 'localStorage',
        'items': {
            'currentProfile': general_models.get_current_profile()
        }
    }]
    
    return jsonify({"success": True, "changes": changes})

@feedback_bp.route("/feedbacks/<int:feedback_id>", methods=["DELETE"])
@require_auth
def delete_feedback(feedback_id):
    """Delete a feedback - developer only."""
    general_models = get_general_models()
    if not general_models.is_accessible('feedbacks', feedback_id):
        return jsonify({"error": f"Feedback {feedback_id} not found or not accessible"}), 404
    
    general_models.delete('feedbacks', feedback_id)
    
    response = {"success": True, "deleted_ids": [feedback_id]}
    response['changes'] = [{
        'type': 'REMOVE',
        'entity': 'feedback',
        'ids': [feedback_id]
    }, {
        'type': 'UPSERT',
        'entity': 'localStorage',
        'items': {
            'currentProfile': general_models.get_current_profile()
        }
    }]
    return jsonify(response)

@feedback_bp.route("/feedbacks/all", methods=["DELETE"])
@require_auth
def delete_all_feedbacks():
    """Delete all feedbacks - developer only."""
    general_models = get_general_models()
    deleted_ids = general_models.delete_all('feedbacks')
    changes = [{
        'type': 'REMOVE',
        'entity': 'feedback',
        'ids': deleted_ids
    }, {
        'type': 'UPSERT',
        'entity': 'localStorage',
        'items': {
            'currentProfile': general_models.get_current_profile()
        }
    }]
    return jsonify({'success': True, 'changes': changes, 'deleted_ids': deleted_ids})

# ==================== USER ROUTES (my_feedbacks) ====================

@feedback_bp.route("/my-feedbacks", methods=["GET"])
@require_auth
def get_my_feedbacks():
    """List current user's own feedbacks (not available for public profiles)."""
    general_models = get_general_models()
    feedbacks = general_models.get_entities('my_feedbacks')
    changes = [{
        'type': 'UPSERT',
        'entity': 'my_feedback',
        'items': feedbacks
    }]
    return jsonify({'changes': changes})

@feedback_bp.route("/my-feedbacks/<int:feedback_id>", methods=["GET"])
@require_auth
def get_my_feedback(feedback_id):
    """Get a specific feedback belonging to current user."""
    general_models = get_general_models()
    feedback_data = general_models.get_entities('my_feedbacks', [feedback_id])
    changes = [{
        'type': 'UPSERT',
        'entity': 'my_feedback',
        'items': feedback_data
    }]
    return jsonify({'changes': changes})

@feedback_bp.route("/my-feedbacks/<int:feedback_id>", methods=["PATCH"])
@require_auth
def update_my_feedback(feedback_id):
    """Update current user's own feedback."""
    general_models = get_general_models()
    
    sanitized = get_multiple_inputs(['title', 'type', 'message', 'communication_consent'])
    
    if sanitized:
        general_models.edit('my_feedbacks', feedback_id, sanitized)

    updated_feedback = general_models.get_entities('my_feedbacks', [feedback_id])
    
    changes = [{
        'type': 'UPDATE',
        'entity': 'my_feedback',
        'items': updated_feedback
    }]
    
    return jsonify({"success": True, "changes": changes})

@feedback_bp.route("/my-feedbacks/<int:feedback_id>", methods=["DELETE"])
@require_auth
def delete_my_feedback(feedback_id):
    """Delete current user's own feedback."""
    general_models = get_general_models()
    
    general_models.delete('my_feedbacks', feedback_id)
    
    response = {"success": True, "deleted_ids": [feedback_id]}
    response['changes'] = [{
        'type': 'REMOVE',
        'entity': 'my_feedback',
        'ids': [feedback_id]
    }]
    return jsonify(response)

@feedback_bp.route("/feedbacks", methods=["POST"])
@require_auth
def create_feedback():
    """Create a new feedback."""
    general_models = get_general_models()
    
    feedback_data = {
        'profile_id': get_jwt_identity(),
        'message': get_input('message', required=True),
        'title': get_input('title', required=False),
        'type': get_input('type', required=False) or 0,
        'communication_consent': get_input('communication_consent', required=False) or False,
    }
    
    sender_name = get_input('sender_name', required=False)
    if sender_name:
        feedback_data['sender_name'] = sender_name
    
    sender_email = get_input('sender_email', required=False)
    if sender_email:
        feedback_data['sender_email'] = sender_email
    
    # Include metadata if sender agrees
    if get_input('include_metadata', required=False):
        feedback_data['user_agent'] = request.headers.get('User-Agent')
        feedback_data['ip_address'] = request.remote_addr
        
        # Include diagnostics (console logs, network info, etc.)
        diagnostics = {}
        console_logs = get_input('console_logs', required=False)
        if console_logs:
            diagnostics['console_logs'] = console_logs
        network_logs = get_input('network_logs', required=False)
        if network_logs:
            diagnostics['network_logs'] = network_logs
        network_errors = get_input('network_errors', required=False)
        if network_errors:
            diagnostics['network_errors'] = network_errors
        browser_info = get_input('browser_info', required=False)
        if browser_info:
            diagnostics['browser_info'] = browser_info
        
        if diagnostics:
            feedback_data['diagnostics'] = diagnostics
    
    feedback_id = general_models.add('my_feedbacks', feedback_data)
    created_feedback = general_models.get_entities('my_feedbacks', [feedback_id])
    changes = []
    if created_feedback:
        changes.append({
            'type': 'UPSERT',
            'entity': 'my_feedback',
            'items': created_feedback
        })
    
    # Include the new feedback id explicitly so clients can reference it immediately
    return jsonify({'success': True, 'feedback_id': feedback_id, 'changes': changes})

