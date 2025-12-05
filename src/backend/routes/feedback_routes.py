from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_general_models
from src.backend.validators import get_input, get_multiple_inputs
from src.core.services.email import send_email
from datetime import datetime

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
    
    # Get feedback before update to check if it's being closed
    old_feedback = general_models.get_entities('feedbacks', [feedback_id])
    was_closed = old_feedback and old_feedback.get(feedback_id, {}).get('is_closed')
    
    sanitized = get_multiple_inputs(['type', 'notes', 'is_closed', 'solved', 'closed_at', 'closed_by', 'closed_details'])
    
    if sanitized:
        general_models.edit('feedbacks', feedback_id, sanitized)

    updated_feedback = general_models.get_entities('feedbacks', [feedback_id])
    
    # Send email if feedback was just closed and has consent
    if sanitized and sanitized.get('is_closed') and not was_closed:
        feedback_data = updated_feedback.get(feedback_id, {})
        sender_email = feedback_data.get('sender_email')
        communication_consent = feedback_data.get('communication_consent')
        solved = feedback_data.get('solved', False)
        closed_details = feedback_data.get('closed_details')
        
        if sender_email and communication_consent:
            lines = []
            lines.append(f'Feedback {"Resolved" if solved else "Closed"}')
            lines.append('')
            lines.append('Thank you for your feedback!')
            lines.append('')
            if feedback_data.get('title'):
                lines.append(f'Title: {feedback_data["title"]}')
            if feedback_data.get('sender_name'):
                lines.append(f'From: {feedback_data["sender_name"]}')
            if feedback_data.get('created_at'):
                created_at = feedback_data['created_at']
                if isinstance(created_at, str):
                    try:
                        dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                        lines.append(f'Submitted: {dt.strftime("%Y-%m-%d %H:%M:%S")}')
                    except:
                        lines.append(f'Submitted: {created_at}')
                else:
                    lines.append(f'Submitted: {created_at}')
            if feedback_data.get('type') is not None:
                lines.append(f'Type: {"Bug Report" if feedback_data["type"] == 0 else "Suggestion"}')
            if feedback_data.get('message'):
                lines.append('')
                lines.append('Original Message:')
                lines.append(feedback_data['message'])
            if closed_details:
                lines.append('')
                lines.append(f'Response from Team: {closed_details}')
            lines.append('')
            lines.append(f'Status: {"✅ Resolved" if solved else "Closed"}')
            
            subject = f'Your feedback has been {"resolved" if solved else "closed"}'
            body_text = '\n'.join(lines)
            body_html = f'''
                <html>
                <body>
                    <h2>Feedback {"Resolved" if solved else "Closed"}</h2>
                    <p>Your feedback has been {"resolved" if solved else "closed"}.</p>
                    <p><strong>Thank you for your feedback!</strong></p>
                    {f'<p><strong>Title:</strong> {feedback_data.get("title", "")}</p>' if feedback_data.get('title') else ''}
                    {f'<p><strong>From:</strong> {feedback_data.get("sender_name", "")}</p>' if feedback_data.get('sender_name') else ''}
                    {f'<p><strong>Type:</strong> {"Bug Report" if feedback_data.get("type") == 0 else "Suggestion"}</p>' if feedback_data.get('type') is not None else ''}
                    {f'<p><strong>Original Message:</strong></p><p>{feedback_data.get("message", "").replace(chr(10), "<br>")}</p>' if feedback_data.get('message') else ''}
                    {f'<p><strong>Response from Team:</strong> {closed_details.replace(chr(10), "<br>")}</p>' if closed_details else ''}
                    <p><strong>Status:</strong> {"✅ Resolved" if solved else "Closed"}</p>
                </body>
                </html>
            '''
            
            send_email(
                to=sender_email,
                subject=subject,
                body_text=body_text,
                body_html=body_html
            )
    
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

