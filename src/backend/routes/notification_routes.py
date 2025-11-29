from flask import Blueprint, jsonify, request
from datetime import datetime
from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_general_models, Forbidden, DatabaseError

notification_bp = Blueprint('notifications', __name__, url_prefix='/api/notifications')

@notification_bp.route('/my', methods=['GET'])
@require_auth
def get_my_notifications():
    """List current user's notifications (newest first). Supports limit, offset."""
    general_models = get_general_models()
    try:
        items = general_models.get_entities('my_notifications')
        changes = [{
            'type': 'UPSERT',
            'entity': 'my_notification',
            'items': items
        }]
        return jsonify({'changes': changes})
    except Forbidden as e:
        return jsonify({'error': str(e)}), 403
    except DatabaseError as e:
        return jsonify({'error': str(e)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@notification_bp.route('/my/<int:notification_id>/read', methods=['PATCH'])
@require_auth
def toggle_read(notification_id):
    """Mark a specific notification as read."""
    general_models = get_general_models()
    try:
        read = request.json.get('read', True)
        if read is None:
            return jsonify({'error': 'read is required'}), 400
        if not isinstance(read, bool):
            return jsonify({'error': 'read must be a boolean (true or false)'}), 400
        
        data = {
            'read': read,
        }
        if read:
            data['read_at'] = datetime.now().isoformat()
        else:
            data['read_at'] = None
        general_models.edit('my_notifications', notification_id, data)
        changes = [{
            'type': 'UPDATE',
            'entity': 'my_notification',
            'items': general_models.get_entities('my_notifications', [notification_id])
        }]
        current_profile = general_models.get_current_profile()
        changes.append({
            'type': 'UPDATE',
            'entity': 'localStorage',
            'items': {
                'currentProfile': {
                    'unread_notifications': current_profile['unread_notifications']
                }
            }
        })
        return jsonify({'success': True, 'changes': changes})
    except Forbidden as e:
        return jsonify({'error': str(e)}), 403
    except DatabaseError as e:
        return jsonify({'error': str(e)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@notification_bp.route('/my/mark-all-read', methods=['PATCH'])
@require_auth
def mark_all_read():
    """Mark all current user's notifications as read."""
    general_models = get_general_models()
    try:
        read_at = datetime.now().isoformat()
        marked_ids = general_models.mark_all_my_notifications_read(read_at)
        changes = []
        changes.append({
            'type': 'UPDATE',
            'entity': 'my_notification',
            'items': general_models.get_entities('my_notifications', marked_ids)
        })
        current_profile = general_models.get_current_profile()
        changes.append({
            'type': 'UPDATE',
            'entity': 'localStorage',
            'items': {
                'currentProfile': {
                    'unread_notifications': current_profile['unread_notifications']
                }
            }
        })
        return jsonify({'success': True, 'changes': changes})
    except Forbidden as e:
        return jsonify({'error': str(e)}), 403
    except DatabaseError as e:
        return jsonify({'error': str(e)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@notification_bp.route('/my/<int:notification_id>', methods=['DELETE'])
@require_auth
def delete_my_notification(notification_id):
    """Delete a specific notification belonging to current user."""
    general_models = get_general_models()
    try:
        general_models.delete('my_notifications', notification_id)
        changes = [{
            'type': 'REMOVE',
            'entity': 'my_notification',
            'ids': [notification_id]
        }]
        
        current_profile = general_models.get_current_profile()
        changes.append({
            'type': 'UPDATE',
            'entity': 'localStorage',
            'items': {
                'currentProfile': {
                    'total_notifications': current_profile['total_notifications'],
                    'unread_notifications': current_profile['unread_notifications']
                }
            }
        })
        return jsonify({'success': True, 'changes': changes, 'deleted_ids': [notification_id]})
    except Forbidden as e:
        return jsonify({'error': str(e)}), 403
    except DatabaseError as e:
        return jsonify({'error': str(e)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@notification_bp.route('/my/all', methods=['DELETE'])
@require_auth
def delete_all_my_notifications():
    """Delete all notifications belonging to current user."""
    general_models = get_general_models()
    try:
        deleted_ids = general_models.delete_all('my_notifications')
        changes = [{
            'type': 'REMOVE',
            'entity': 'my_notification',
            'ids': deleted_ids
        }]
        current_profile = general_models.get_current_profile()
        changes.append({
            'type': 'UPDATE',
            'entity': 'localStorage',
            'items': {
                'currentProfile': {
                    'total_notifications': current_profile['total_notifications'],
                    'unread_notifications': current_profile['unread_notifications']
                }
            }
        })
        return jsonify({'success': True, 'changes': changes, 'deleted_ids': deleted_ids})
    except Forbidden as e:
        return jsonify({'error': str(e)}), 403
    except DatabaseError as e:
        return jsonify({'error': str(e)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 400


