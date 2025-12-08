from flask import Blueprint, jsonify

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event, ChildOperation
from src.backend.validators import get_input, get_multiple_inputs, validate_path_param

album_bp = Blueprint('albums', __name__, url_prefix='/api/events/<event_id>')

@album_bp.route("/albums", methods=["GET"])
@require_auth
def get_albums(event_id):
    """List all accessible album summaries for the specific event."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    albums = event.models.get_entities('albums')
    changes = [{
        'type': 'UPSERT',
        'entity': 'album',
        'items': albums
    }]
    return jsonify({'changes': changes})

@album_bp.route("/albums/<album_id>", methods=["GET"])
@require_auth
def get_album(event_id, album_id):
    """Get a specific album's details as changes."""
    event_id = validate_path_param('event_id', event_id)
    album_id = validate_path_param('album_id', album_id)
    event = get_event(event_id)
    if not event.models.is_accessible('albums', album_id):
        return jsonify({"error": f"Album {album_id} not found or not accessible"}), 404

    album = event.models.get_entities('albums', [album_id])
    images = event.models.get_childs('albums', album_id, 'images')
    changes = [{
        'type': 'UPSERT',
        'entity': 'album',
        'items': album
    }]
    changes.append({
        'type': 'RELATION_SET',
        'relation': 'album.images',
        'parentId': album_id,
        'entities': images
    })
    return jsonify({ 'changes': changes })

@album_bp.route("/albums/check-name", methods=["POST"])
@require_auth
def check_album_name(event_id):
    """Check if an album name already exists."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    label = get_input('label', required=True)
    exclude_album_id = get_input('exclude_album_id', required=False)
    conflict_album_id = event.models.is_exists('albums', {'label': label}, exclude_id=exclude_album_id)
    return jsonify({"conflict": bool(conflict_album_id), "conflicting_album": conflict_album_id})

@album_bp.route("/albums", methods=["POST"])
@require_auth
def create_album(event_id):
    """Create a new album."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    
    sanitized = get_multiple_inputs(['description', 'representative_image'])
    sanitized['label'] = get_input('label', required=True)
    if sanitized:
        album_id = event.models.add('albums', sanitized)
        created_album = event.models.get_entities('albums', [album_id])
        changes = [{
            'type': 'UPSERT',
            'entity': 'album',
            'items': created_album
        }]
        response = {"success": True, "album_id": album_id, "changes": changes}
    else:
        response = {"success": False}
    return jsonify(response)

@album_bp.route("/albums/<album_id>", methods=["PUT"])
@require_auth
def update_album(event_id, album_id):
    """Update an album's details."""
    event_id = validate_path_param('event_id', event_id)
    album_id = validate_path_param('album_id', album_id)
    event = get_event(event_id)
    album = event.models.get_entities('albums', album_id)
    if not album:
        return jsonify({"error": f"Album {album_id} not found or not accessible"}), 404

    sanitized = get_multiple_inputs(['label', 'description', 'representative_image'])
    if sanitized:
        event.models.edit('albums', album_id, sanitized)

        updated = event.models.get_entities('albums', [album_id])
        changes = [{
            'type': 'UPDATE',
            'entity': 'album',
            'items': updated
        }]
        response = {"success": True, "changes": changes}
    else:
        response = {"success": False}
    return jsonify(response)

@album_bp.route("/albums/<album_id>", methods=["DELETE"])
@require_auth
def delete_album(event_id, album_id):
    """Delete an album."""
    event_id = validate_path_param('event_id', event_id)
    album_id = validate_path_param('album_id', album_id)
    event = get_event(event_id)
    if not event.models.is_accessible('albums', album_id):
        return jsonify({"error": f"Album {album_id} not found or not accessible"}), 404
    
    album = event.models.get_entities('albums', album_id)
    if album and album.get('label', '').lower() in ('archive', 'favorites'):
        return jsonify({"error": "Cannot delete default albums"}), 400
    
    event.models.delete('albums', album_id)
    
    response = {"success": True, "deleted_ids": [album_id]}
    response['changes'] = [{
        'type': 'REMOVE',
        'entity': 'album',
        'ids': [album_id]
    }]
    return jsonify(response)

def _edit_album_images(event_id: str, album_id: str, image_ids: list[str], add: bool):
    """Helper: Add or remove images from an album, return response with changes."""
    event = get_event(event_id)
    operation = ChildOperation.ADD if add else ChildOperation.REMOVE
    updated_image_ids, _ = event.models.edit_childs('albums', album_id, child='images', child_ids=image_ids, operation=operation)
    changes = []
    if updated_image_ids:
        album = event.models.get_entities('albums', [album_id])
        changes.append({
            'type': 'UPDATE',
            'entity': 'album',
            'items': album
        })
        if add:
            changes.append({
                'type': 'RELATION_ADD',
                'relation': 'album.images',
                'parentId': album_id,
                'entities': event.models.get_entities('images', updated_image_ids)
            })
        else:
            changes.append({
                'type': 'RELATION_REMOVE',
                'relation': 'album.images',
                'parentId': album_id,
                'ids': updated_image_ids
            })

        event_data = event.models.get_entities('events', event_id, include_details=True)
        is_default_album = album_id in [
            event_data['favorites_album_id'],
            event_data['archive_album_id']
        ]
        if is_default_album:
            changes.append({
                'type': 'UPDATE',
                'entity': 'image',
                'items': event.models.get_entities('images', updated_image_ids)
            })
            if album_id == event_data['archive_album_id']:
                all_parents = event.models.get_parents('images', updated_image_ids)
                for entity, parent_to_images in all_parents.items():
                    # special case beacuse it's for view only within event 
                    if entity == 'events_profiles_ctx':
                        continue
                    parent_ids = list(parent_to_images.keys())
                    changes.append({
                        'type': 'UPDATE',
                        'entity': entity,
                        'items': event.models.get_entities(entity, parent_ids)
                    })
        else:
            for image_id in updated_image_ids:
                if add:
                    changes.append({
                        'type': 'RELATION_ADD',
                        'relation': 'image.albums',
                        'parentId': image_id,
                        'entities': album
                    })
                else:
                    changes.append({
                        'type': 'RELATION_REMOVE',
                        'relation': 'image.albums',
                        'parentId': image_id,
                        'ids': [album_id]
                    })

    return {
        "success": True,
        f'len_{"added" if add else "removed"}': len(updated_image_ids),
        "changes": changes
    }

@album_bp.route("/albums/<album_id>/images", methods=["POST"])
@require_auth
def add_images_to_album(event_id, album_id):
    """Add images to an album."""
    event_id = validate_path_param('event_id', event_id)
    album_id = validate_path_param('album_id', album_id)
    image_ids = get_input('image_ids', required=True)
    response = _edit_album_images(event_id, album_id, image_ids, add=True)
    return jsonify(response)

@album_bp.route("/albums/<album_id>/images", methods=["DELETE"])
@require_auth
def remove_images_from_album(event_id, album_id):
    """Remove images from an album."""
    event_id = validate_path_param('event_id', event_id)
    album_id = validate_path_param('album_id', album_id)
    image_ids = get_input('image_ids', required=True)
    response = _edit_album_images(event_id, album_id, image_ids, add=False)
    return jsonify(response)

@album_bp.route("/albums/favorites/images", methods=["PUT"])
@require_auth
def toggle_favorites_images(event_id):
    """Add or remove multiple images from favorites album."""
    event_id = validate_path_param('event_id', event_id)
    image_ids = get_input('image_ids', required=True)
    is_favorite = get_input('is_favorite', required=True)
    
    event = get_event(event_id)
    event_data = event.models.get_entities('events', event_id, include_details=True)
    favorites_album_id = event_data['favorites_album_id']
    response = _edit_album_images(event_id, favorites_album_id, image_ids, add=is_favorite)
    return jsonify(response)

@album_bp.route("/albums/archive/images", methods=["PUT"])
@require_auth
def toggle_archive_images(event_id):
    """Add or remove multiple images from archive album."""
    event_id = validate_path_param('event_id', event_id)
    image_ids = get_input('image_ids', required=True)
    is_archived = get_input('is_archived', required=True)
    
    event = get_event(event_id)
    event_data = event.models.get_entities('events', event_id, include_details=True)
    archive_album_id = event_data['archive_album_id']
    response = _edit_album_images(event_id, archive_album_id, image_ids, add=is_archived)
    return jsonify(response)

