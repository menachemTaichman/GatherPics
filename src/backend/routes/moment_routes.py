from flask import Blueprint, jsonify

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event, ChildOperation
from src.backend.validators import get_input, get_multiple_inputs, validate_path_param

moment_bp = Blueprint('moments', __name__, url_prefix='/api/events/<event_id>')

@moment_bp.route("/moments", methods=["GET"])
@require_auth
def get_moments(event_id):
    """List all accessible moment summaries for the specific event."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    moments = event.models.get_entities('moments')
    changes = [{
        'type': 'UPSERT',
        'entity': 'moment',
        'items': moments
    }]
    return jsonify({'changes': changes})

@moment_bp.route("/moments/<moment_id>", methods=["GET"])
@require_auth
def get_moment(event_id, moment_id):
    """Get a specific moment's details as changes."""
    event_id = validate_path_param('event_id', event_id)
    moment_id = validate_path_param('moment_id', moment_id)
    event = get_event(event_id)
    if not event.models.is_accessible('moments', moment_id):
        return jsonify({"error": f"Moment {moment_id} not found or not accessible"}), 404

    moment = event.models.get_entities('moments', [moment_id])
    images = event.models.get_childs('moments', moment_id, 'images')
    changes = [{
        'type': 'UPSERT',
        'entity': 'moment',
        'items': moment
    },
    {
        'type': 'RELATION_SET',
        'relation': 'moment.images',
        'parentId': moment_id,
        'entities': images
    }]
    
    return jsonify({ 'changes': changes })

@moment_bp.route("/moments/check-name", methods=["POST"])
@require_auth
def check_moment_name(event_id):
    """Check if a moment name already exists."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    label = get_input('label', required=True)
    exclude_moment_id = get_input('exclude_moment_id', required=False)
    conflict_moment_id = event.models.is_exists('moments', {'label': label}, exclude_id=exclude_moment_id)
    return jsonify({"conflict": bool(conflict_moment_id)})

@moment_bp.route("/moments", methods=["POST"])
@require_auth
def create_moment(event_id):
    """Create a new moment."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    
    sanitized = get_multiple_inputs(['description', 'start_date', 'end_date', 'representative_image'])
    sanitized['label'] = get_input('label', required=True)
    if sanitized:
        moment_id = event.models.add('moments', sanitized)
        created_moment = event.models.get_entities('moments', [moment_id])
        changes = [{
            'type': 'UPSERT',
            'entity': 'moment',
            'items': created_moment
        }]
        response = {"success": True, "moment_id": moment_id, "changes": changes}
    else:
        response = {"success": False}
    return jsonify(response)

@moment_bp.route("/moments/<moment_id>", methods=["PUT"])
@require_auth
def update_moment(event_id, moment_id):
    """Update a moment's metadata."""
    event_id = validate_path_param('event_id', event_id)
    moment_id = validate_path_param('moment_id', moment_id)
    event = get_event(event_id)
    if not event.models.is_accessible('moments', moment_id):
        return jsonify({"error": f"Moment {moment_id} not found or not accessible"}), 404
        
    sanitized = get_multiple_inputs(['label', 'description', 'start_date', 'end_date', 'representative_image'])
    if sanitized:
        event.models.edit('moments', moment_id, sanitized)
        updated_moment = event.models.get_entities('moments', [moment_id])
        changes = [{
            'type': 'UPDATE',
            'entity': 'moment',
            'items': updated_moment
        }]
        response = {"success": True, "changes": changes}
    else:
        response = {"success": False}
    return jsonify(response)

@moment_bp.route("/moments/<moment_id>", methods=["DELETE"])
@require_auth
def delete_moment(event_id, moment_id):
    """Delete a moment."""
    event_id = validate_path_param('event_id', event_id)
    moment_id = validate_path_param('moment_id', moment_id)
    event = get_event(event_id)
    if not event.models.is_accessible('moments', moment_id):
        return jsonify({"error": f"Moment {moment_id} not found or not accessible"}), 404
    
    event.models.delete('moments', moment_id)
    
    response = {"success": True, "deleted_ids": [moment_id]}
    response['changes'] = [{
        'type': 'REMOVE',
        'entity': 'moment',
        'ids': [moment_id]
    }]
    return jsonify(response)

@moment_bp.route("/moments/images", methods=["GET"])
@require_auth
def get_images_to_moments(event_id):
    """Get all images with data for selecting in moment editor."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    images = event.models.get_images_to_moments()
    changes = [{
        'type': 'UPSERT',
        'entity': 'image',
        'items': images
    }]
    return jsonify({'changes': changes})

def _edit_moment_images(event_id: str, moment_id: str | None, image_ids: list[str], add: bool):
    """Helper: Add or remove images from a moment, return response with changes."""
    event = get_event(event_id)
    if not moment_id:
        result = event.models.remove_images_from_moments(image_ids)
    else:
        operation = ChildOperation.ADD if add else ChildOperation.REMOVE
        result = event.models.edit_moment_images(moment_id, image_ids, operation)
    
    print(result)
    updated_image_ids = result['updated_image_ids']
    detached_moments = result['detached_moments']
    updated_moments_uploads = result['updated_moments_uploads']
    removed_moments_uploads = result['removed_moments_uploads']

    changes = []
    
    if updated_image_ids:
        images_data = event.models.get_entities('images', updated_image_ids)
        
        for detached_moment_id, detached_image_ids in detached_moments.items():
            changes.append({
                'type': 'RELATION_REMOVE',
                'relation': 'moment.images',
                'parentId': detached_moment_id,
                'ids': detached_image_ids
            })
        
        changes.append({
            'type': 'UPSERT',
            'entity': 'moment',
            'items': event.models.get_entities('moments', list(detached_moments.keys()) + [moment_id])
        })
        changes.append({
            'type': 'UPSERT',
            'entity': 'image',
            'items': images_data
        })
        if add:
            changes.append({
                'type': 'RELATION_ADD',
                'relation': 'moment.images',
                'parentId': moment_id,
                'entities': images_data
            })
        else:
            changes.append({
                'type': 'RELATION_REMOVE',
                'relation': 'moment.images',
                'parentId': moment_id,
                'ids': updated_image_ids
            })
        
        # Update upload.moments relations
        for upload_id, moments in updated_moments_uploads.items():
            _, relation_data = event.models.get_childs('uploads', upload_id, 'moments', moments)
            changes.append({
                'type': 'RELATION_UPSERT',
                'relation': 'upload.moments',
                'parentId': upload_id,
                'relationData': relation_data
            })
        
        for upload_id, moments in removed_moments_uploads.items():
            changes.append({
                'type': 'RELATION_REMOVE',
                'relation': 'upload.moments',
                'parentId': upload_id,
                'ids': moments
            })

        response = {
            "success": True,
            f'len_{"added" if add else "removed"}': len(updated_image_ids),
            "changes": changes
        }
        return jsonify(response)

@moment_bp.route("/moments/<moment_id>/images", methods=["POST"])
@require_auth
def add_images_to_moment(event_id, moment_id):
    """Add images to a moment."""
    event_id = validate_path_param('event_id', event_id)
    moment_id = validate_path_param('moment_id', moment_id)
    image_ids = get_input('image_ids', required=True)
    response = _edit_moment_images(event_id, moment_id, image_ids, add=True)
    return response

@moment_bp.route("/moments/images", methods=["DELETE"])
@require_auth
def remove_images_from_moments(event_id):
    """Remove images from their moments."""
    event_id = validate_path_param('event_id', event_id)
    image_ids = get_input('image_ids', required=True)
    response = _edit_moment_images(event_id, None, image_ids, add=False)
    return response
