from flask import Blueprint, jsonify

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event
from src.backend.validators import get_input, get_multiple_inputs, validate_path_param

image_bp = Blueprint('images', __name__, url_prefix='/api/events/<event_id>')

@image_bp.route("/images", methods=["GET"])
@require_auth
def get_images(event_id):
    """List all accessible images summaries for the specific event."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    images = event.models.get_entities('images')
    changes = [{
        'type': 'UPSERT',
        'entity': 'image',
        'items': images
    }]
    return jsonify({'changes': changes})

@image_bp.route("/images/<image_id>", methods=["GET"])
@require_auth
def get_image(event_id, image_id):
    """Get a specific image's details as changes."""
    event_id = validate_path_param('event_id', event_id)
    image_id = validate_path_param('image_id', image_id)
    event = get_event(event_id)
    if not event.models.is_accessible('images', image_id):
        return jsonify({"error": f"Image {image_id} not found or not accessible"}), 404

    image = event.models.get_entities('images', [image_id], include_details=True)
    albums = event.models.get_childs('images', image_id, 'albums')
    faces = event.models.get_childs('images', image_id, 'faces')
    groups = event.models.get_childs('images', image_id, 'groups')
    changes = [{
        'type': 'UPSERT',
        'entity': 'image',
        'items': image
    }]
    changes.append({
        'type': 'RELATION_SET',
        'relation': 'image.albums',
        'parentId': image_id,
        'entities': albums
    })
    changes.append({
        'type': 'RELATION_SET',
        'relation': 'image.faces',
        'parentId': image_id,
        'entities': faces
    })
    changes.append({
        'type': 'RELATION_SET',
        'relation': 'image.groups',
        'parentId': image_id,
        'entities': groups
    })
    moments = image.get(image_id, {}).get('moment_id')
    if moments:
        moments = event.models.get_entities('moments', [moments])
        changes.append({
            'type': 'RELATION_SET',
            'relation': 'image.moments',
            'parentId': image_id,
            'entities': moments
        })
    return jsonify({ 'changes': changes })

@image_bp.route("/images/<image_id>", methods=["PATCH"])
@require_auth
def update_image(event_id, image_id):
    """Update an image's description."""
    event_id = validate_path_param('event_id', event_id)
    image_id = validate_path_param('image_id', image_id)
    event = get_event(event_id)
    sanitized = get_multiple_inputs(['description'])
    if sanitized:
        event.models.edit('images', image_id, sanitized)
        updated_image = event.models.get_entities('images', [image_id], include_details=True)
        changes = [{
            'type': 'UPDATE',
            'entity': 'image',
            'items': updated_image
        }]
        response = {"success": True, "changes": changes}
    else:
        response = {"success": False}
    return jsonify(response)

@image_bp.route("/images", methods=["DELETE"])
@require_auth
def delete_image(event_id):
    """Delete an image."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    image_ids = get_input('image_ids', required=True)
    deleted_groups, parents = event.delete_images(image_ids)
    changes = [{
        'type': 'REMOVE',
        'entity': 'image',
        'ids': image_ids
    }]
    if deleted_groups:
        changes.append({
            'type': 'REMOVE',
            'entity': 'group',
            'ids': deleted_groups
        })
    for entity, entity_ids in parents.items():
        changes.append({
            'type': 'UPDATE',
            'entity': entity,
            'items': event.models.get_entities(entity, entity_ids)
        })
    return jsonify({"success": True, "changes": changes})
