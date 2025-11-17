from flask import Blueprint, jsonify, request

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_general_models, Forbidden, DatabaseError

settings_bp = Blueprint('settings', __name__)

@settings_bp.route("/api/settings", methods=["GET"])
@require_auth
def get_settings():
    """Get system settings. Requires has_settings permission."""
    try:
        general_models = get_general_models()
        current_profile = general_models.get_current_profile()
        
        # Check if user has settings access
        if not current_profile.get('has_settings', False):
            raise Forbidden('You do not have permission to access settings')
        
        settings = general_models.get_settings()
        
        return jsonify({
            "success": True,
            "settings": settings
        })
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@settings_bp.route("/api/settings", methods=["PUT"])
@require_auth
def update_settings():
    """Update system settings. Requires has_settings permission."""
    try:
        general_models = get_general_models()
        current_profile = general_models.get_current_profile()
        
        # Check if user has settings access
        if not current_profile.get('has_settings', False):
            raise Forbidden('You do not have permission to update settings')
        
        data = request.json or {}
        
        # Allowed fields that can be updated
        allowed_fields = [
            'image_size_limit_bytes',
            'images_count_limit',
            'rekognition_calls_limit',
            'min_rank_to_create_event',
        ]
        
        # Filter to only allowed fields
        update_data = {k: v for k, v in data.items() if k in allowed_fields}
        
        if not update_data:
            return jsonify({"error": "No valid fields to update"}), 400
        
        general_models.update_settings(update_data)
        
        # Return updated settings
        settings = general_models.get_settings()
        
        return jsonify({
            "success": True,
            "settings": settings
        })
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

