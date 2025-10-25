from flask import Blueprint, jsonify, request

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event, _parse_bool, ChildOperation
from src.core.errors import Forbidden, DatabaseError, DBPolicyError

album_bp = Blueprint('albums', __name__, url_prefix='/api/events/<event_id>')

@album_bp.route("/albums", methods=["GET"])
@require_auth
def get_albums(event_id):
    """List all accessible album summaries for the specific event."""
    exclude_defaults = _parse_bool(request.args.get('exclude_defaults'), False)
    event = get_event(event_id)
    table = 'albums_actual' if exclude_defaults else 'albums'
    albums = event.models.get_entities(table)
    changes = [{
        'type': 'INSERT',
        'entity': 'album',
        'items': albums
    }]
    return jsonify({'changes': changes})

@album_bp.route("/albums/<album_id>", methods=["GET"])
@require_auth
def get_album(event_id, album_id):
    """Get a specific album's details as changes."""
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
    event = get_event(event_id)
    data = request.json or {}
    label = data.get('label', '')
    exclude_album_id = data.get('exclude_album_id', '')
    if not label:
        return jsonify({"error": "Label is required"}), 400
    conflict_album_id = event.models.is_exists('albums', {'label': label}, exclude_id=exclude_album_id)
    return jsonify({"conflict": bool(conflict_album_id), "conflicting_album": conflict_album_id})

@album_bp.route("/albums", methods=["POST"])
@require_auth
def create_album(event_id):
    """Create a new album."""
    event = get_event(event_id)
    data = request.json or {}
    
    try:
        allowed_fields = {'label', 'description', 'representative_image'}
        sanitized = {k: v for k, v in data.items() if k in allowed_fields}
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
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@album_bp.route("/albums/<album_id>", methods=["PUT"])
@require_auth
def update_album(event_id, album_id):
    """Update an album's details."""
    event = get_event(event_id)
    album = event.models.get_entities('albums', album_id)
    if not album:
        return jsonify({"error": f"Album {album_id} not found or not accessible"}), 404

    data = request.json or {}
    if (album.get('label', '').lower() in ('archive', 'favorites')) and 'label' in data:
        data.pop('label', None)

    try:
        allowed = {'label', 'description', 'representative_image'}
        sanitized = {k: v for k, v in data.items() if k in allowed}
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
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DBPolicyError as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@album_bp.route("/albums/<album_id>", methods=["DELETE"])
@require_auth
def delete_album(event_id, album_id):
    """Delete an album."""
    event = get_event(event_id)
    if not event.models.is_accessible('albums', album_id):
        return jsonify({"error": f"Album {album_id} not found or not accessible"}), 404
    
    album = event.models.get_entities('albums', album_id)
    if album and album.get('label', '').lower() in ('archive', 'favorites'):
        return jsonify({"error": "Cannot delete default albums"}), 400
    
    try:
        event.models.delete('albums', album_id)
        
        response = {"success": True, "deleted_ids": [album_id]}
        response['changes'] = [{
            'type': 'REMOVE',
            'entity': 'album',
            'ids': [album_id]
        }]
        return jsonify(response)
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DBPolicyError as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

def _edit_album_images(event, album_id, image_ids, add: bool):
    """Helper: Add or remove images from an album, return response with changes."""
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

        is_default_album = album_id in [
            event.models.get_favorites_album(),
            event.models.get_archive_album()
        ]
        if is_default_album:
            changes.append({
                'type': 'UPDATE',
                'entity': 'image',
                'items': event.models.get_entities('images', updated_image_ids)
            })
            if album_id == event.models.get_archive_album():
                for image_id in updated_image_ids:
                    parents = event.models.get_parents('images', image_id)
                    for entity, parent_ids in parents.items():
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
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    try:
        response = _edit_album_images(event, album_id, image_ids, add=True)
        return jsonify(response)
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@album_bp.route("/albums/<album_id>/images", methods=["DELETE"])
@require_auth
def remove_images_from_album(event_id, album_id):
    """Remove images from an album."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    try:
        response = _edit_album_images(event, album_id, image_ids, add=False)
        return jsonify(response)
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@album_bp.route("/albums/favorites/images", methods=["PUT"])
@require_auth
def toggle_favorites_images(event_id):
    """Add or remove multiple images from favorites album."""
    event = get_event(event_id)
    
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    is_favorite = data.get('is_favorite', False)
    
    if not image_ids:
        return jsonify({"error": "No image IDs provided"}), 400
    
    try:
        favorites_album_id = event.models.get_favorites_album()
        response = _edit_album_images(event, favorites_album_id, image_ids, add=is_favorite)
        return jsonify(response)
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@album_bp.route("/albums/archive/images", methods=["PUT"])
@require_auth
def toggle_archive_images(event_id):
    """Add or remove multiple images from archive album."""
    event = get_event(event_id)
    
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    is_archived = data.get('is_archived', False)
    
    if not image_ids:
        return jsonify({"error": "No image IDs provided"}), 400
    
    try:
        archive_album_id = event.models.get_archive_album()
        response = _edit_album_images(event, archive_album_id, image_ids, add=is_archived)
        return jsonify(response)
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

