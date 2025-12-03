from flask import Blueprint, jsonify

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_general_models, Forbidden, get_multiple_inputs

settings_bp = Blueprint('settings', __name__)

@settings_bp.route("/api/settings", methods=["GET"])
@require_auth
def get_settings():
    """Get system settings. Requires has_settings permission."""
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

@settings_bp.route("/api/settings", methods=["PUT"])
@require_auth
def update_settings():
    """Update system settings. Requires has_settings permission."""
    general_models = get_general_models()
    current_profile = general_models.get_current_profile()
    
    # Check if user has settings access
    if not current_profile.get('has_settings', False):
        raise Forbidden('You do not have permission to update settings')
    
    # Get allowed fields that can be updated
    update_data = get_multiple_inputs([
        'image_size_limit_bytes',
        'images_count_limit',
        'rekognition_calls_limit',
        'min_rank_to_create_event',
    ], required=True)
    
    general_models.update_settings(update_data)
    
    # Return updated settings
    settings = general_models.get_settings()
    
    return jsonify({
        "success": True,
        "settings": settings
    })

