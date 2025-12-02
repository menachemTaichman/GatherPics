from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_general_models, Forbidden, DatabaseError

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
    
    data = request.json or {}
    allowed_fields = {'type', 'notes', 'is_closed', 'solved', 'closed_at', 'closed_by', 'closed_details'}
    sanitized = {k: v for k, v in data.items() if k in allowed_fields}
    
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
    
    data = request.json or {}
    allowed_fields = {'title', 'type', 'message', 'communication_consent'}
    sanitized = {k: v for k, v in data.items() if k in allowed_fields}
    
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
    data = request.json or {}
    
    feedback_data = {
        'profile_id': get_jwt_identity(),
        'message': data['message'],
        'title': data.get('title'),
        'type': data.get('type', 0),
        'communication_consent': data.get('communication_consent', False),
    }
    
    if data.get('sender_name'):
        feedback_data['sender_name'] = data['sender_name']
    if data.get('sender_email'):
        feedback_data['sender_email'] = data['sender_email']
    
    # Include metadata if sender agrees
    if data.get('include_metadata'):
        feedback_data['user_agent'] = request.headers.get('User-Agent')
        feedback_data['ip_address'] = request.remote_addr
        
        # Include diagnostics (console logs, network info, etc.)
        diagnostics = {}
        if data.get('console_logs'):
            diagnostics['console_logs'] = data['console_logs']
        if data.get('network_logs'):
            diagnostics['network_logs'] = data['network_logs']
        if data.get('network_errors'):
            diagnostics['network_errors'] = data['network_errors']
        if data.get('browser_info'):
            diagnostics['browser_info'] = data['browser_info']
        
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

