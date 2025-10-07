from flask import Flask, jsonify, request, g, send_file, abort, make_response
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager,
    jwt_required,
    create_access_token,
    get_jwt_identity,
    get_jwt,
    set_access_cookies,
    unset_jwt_cookies,
)
from functools import wraps
import traceback
import os
import io
import zipfile

from src.core.models.event import Event

app = Flask(__name__)
CORS(app, origins="*", supports_credentials=True)

# JWT Configuration
app.config['JWT_SECRET_KEY'] = 'your-secret-key-change-in-production'  # Change this in production
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = False  # Tokens don't expire for now
app.config['JWT_TOKEN_LOCATION'] = ['headers', 'cookies']
app.config['JWT_COOKIE_SAMESITE'] = 'Lax'
app.config['JWT_COOKIE_SECURE'] = False  # True in production over HTTPS
app.config['JWT_COOKIE_CSRF_PROTECT'] = False  # Simplify for now
jwt = JWTManager(app)

# --- Placeholder values for now ---
FIXED_PROFILE_ID = "89cb4967-0eba-48af-99cc-5e87407fb639"

# --- Utility Functions ---
def _parse_bool(val: str | None, default: bool) -> bool:
    """Parse a boolean value from a string, with a default."""
    if val is None:
        return default
    return str(val).lower() in ('1', 'true', 'yes', 'y', 'on')

def get_event(event_id, profile_id=None):
    """Get event instance with profile context."""
    if profile_id is None:
        profile_id = getattr(g, 'profile_id', FIXED_PROFILE_ID)
    
    return Event(event_id, profile_id=profile_id)

# --- Auth Decorator ---
def require_auth(f):
    @wraps(f)
    @jwt_required()
    def decorated(*args, **kwargs):
        g.profile_id = get_jwt_identity()
        return f(*args, **kwargs)
    return decorated

# --- Error Handlers ---
@app.errorhandler(400)
def bad_request(error):
    return jsonify({"error": "Bad Request", "message": str(error)}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not Found", "message": str(error)}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal Server Error", "message": str(error), "trace": traceback.format_exc()}), 500

# ==============================================================================
# I. PUBLIC & AUTH ENDPOINTS
# ==============================================================================

@app.route("/api/events", methods=["GET"])
def get_events():
    """Get all available events."""
    try:
        from src.core.models.event import list_events
        events = list_events()
        public_events = [{
            'id': event.id,
            'name': event.name,
            'url': event.url,
            'date': event.date
        } for event in events]
        return jsonify(public_events)
    except Exception as e:
        return bad_request(e)

@app.route("/login", methods=["POST"])
def login():
    """Placeholder login endpoint that returns a JWT token."""
    # For now, always authenticate with the fixed profile ID
    # In production, this would validate credentials
    access_token = create_access_token(identity=FIXED_PROFILE_ID)
    
    response = make_response(jsonify({
        "access_token": access_token,
        "profile_id": FIXED_PROFILE_ID
    }))
    
    # Set the JWT cookie
    set_access_cookies(response, access_token)
    
    return response

@app.route("/logout", methods=["POST"])
def logout():
    resp = jsonify({"msg": "logout successful"})
    unset_jwt_cookies(resp)
    return resp

# ==============================================================================
# II. GROUPS (PERSONS) ENDPOINTS
# ==============================================================================

@app.route("/api/events/<event_id>/groups", methods=["GET"])
@require_auth
def get_groups(event_id):
    """List all accessible group summaries for the specific event."""
    event = get_event(event_id)
    groups = event.models_manager.get_groups()
    changes = [{
        'type': 'UPSERT',
        'entity': 'group',
        'items': groups
    }]
    return jsonify({ 'changes': changes })

@app.route("/api/events/<event_id>/groups/<group_id>", methods=["GET"])
@require_auth
def get_group(event_id, group_id):
    """Get a specific group's details as changes, including its paginated images and faces mapping."""
    event = get_event(event_id)

    if not event.models_manager.is_accessible('groups', group_id):
        return not_found(f"Group {group_id} not found or not accessible")

    filter_groups_str = request.args.get('filter_groups')
    filter_group_ids = filter_groups_str.split(',') if filter_groups_str else []
    filter_mode = request.args.get('filter_mode', 'and')
    only_mode = _parse_bool(request.args.get('only_selected'), False)

    filter = filter_group_ids or only_mode
    changes = []
    result = {'changes': changes, 'filter': filter}    
    group = event.models_manager.get_groups([group_id], faces_mapping=not filter)
    result['changes'].append({
        'type': 'UPSERT',
        'entity': 'group',
        'items': group
    })
    group_ids = [group_id] + filter_group_ids
    image_ids, faces_mapping, images = event.models_manager.get_filtered_images(
        group_ids,
        mode=filter_mode,
        only=only_mode,
    )
    if filter:
        result['filtered_ids'] = image_ids
        result['faces_mapping'] = faces_mapping
        result['changes'].append({
            'type': 'INSERT',
            'entity': 'image',
            'items': images
        })
    else:
        result['changes'].append({
            'type': 'RELATION_SET',
            'relation': 'group.images',
            'parentId': group_id,
            'entities': images
        })

    return jsonify(result)

@app.route("/api/events/<event_id>/groups/related", methods=["GET"])
@require_auth
def get_related_groups(event_id):
    """Get related groups based on a set of selected groups and base images."""
    event = get_event(event_id)

    image_ids_str = request.args.get('image_ids', '')
    selected_groups_str = request.args.get('selected_groups', '')

    image_ids = image_ids_str.split(',') if image_ids_str else []
    selected_groups = selected_groups_str.split(',') if selected_groups_str else []

    group_ids = selected_groups

    group_ids, groups = event.models_manager.get_related_groups(
        group_ids=group_ids,
        base_image_ids=image_ids
    )
    return jsonify({"related_groups": groups, "related_group_ids": group_ids})

@app.route("/api/events/<event_id>/groups/<group_id>", methods=["PUT"])
@require_auth
def update_group(event_id, group_id):
    """Update a group."""
    event = get_event(event_id)
    if not event.models_manager.is_accessible('groups', group_id):
        return not_found(f"Group {group_id} not found or not accessible")
        
    data = request.json or {}
    try:        
        changes = []
        allowed_fields = {'label', 'representative_face'}
        sanitized = {k: v for k, v in data.items() if k in allowed_fields}
        if sanitized:
            event.models_manager.edit('groups', group_id, sanitized)
            changes.append({
                'type': 'UPDATE',
                'entity': 'group',
                'items': event.models_manager.get_groups([group_id])
            })

        return jsonify({"success": True, "changes": changes})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/groups/check-name", methods=["POST"])
@require_auth
def check_group_name(event_id):
    """Check if a group name already exists."""
    event = get_event(event_id)
    data = request.json or {}
    label = data.get('label', '')
    exclude_group_id = data.get('exclude_group_id', '')
    if not label:
        return jsonify({"error": "Label is required"}), 400
    conflict_group_id = event.models_manager.is_exists('groups', {'label': label}, exclude_id=exclude_group_id)
    if conflict_group_id:
        conflicting_group = event.models_manager.get_groups([conflict_group_id])
        response = {"conflict": True, "conflicting_group": conflict_group_id}
        if conflicting_group:
            changes = [{
                'type': 'INSERT',
                'entity': 'group',
                'items': conflicting_group
            }]
            response['changes'] = changes
        
        return jsonify(response)

    else:
        return jsonify({"conflict": False})

@app.route("/api/events/<event_id>/groups/<group_id>/faces", methods=["GET"])
@require_auth
def get_faces_group_in_image(event_id, group_id):
    """Get the faces in an image from a group."""
    event = get_event(event_id)
    image_id = request.args.get('image_id')
    if not image_id:
        return jsonify({"error": "Image ID is required"}), 400
    faces = event.models_manager.get_faces_group_in_image(group_id, image_id)
    return jsonify({"faces": faces})

@app.route("/api/events/<event_id>/groups/transfer-faces", methods=["POST"])
@require_auth
def transfer_faces(event_id):
    """Transfer faces between groups."""
    event = get_event(event_id)
    data = request.json or {}
    source_group_id = data.get('source_group_id')
    target_group_id = data.get('target_group_id')
    new_group_name = data.get('new_group_name', None)
    face_ids = data.get('face_ids', None)
    
    if not target_group_id and not new_group_name:
        return jsonify({"error": "Missing required parameters"}), 400
    
    try:
        result = event.models_manager.add_faces_to_group(
            face_ids=face_ids,
            target_group_id=target_group_id,
            new_group_name=new_group_name,
            source_group_id=source_group_id
        )

        detached_groups = result['detached_groups']
        len_faces_added = result['length_faces_added']
        images_added = result['images_added']
        source_deleted = result['source_deleted']
        new_group_created = result['new_group_created']
        target_group_id = result['target_group_id']

        changes = []
        for group_id, images_ids in detached_groups.items():
            changes.append({
                'type': 'RELATION_REMOVE',
                'relation': 'group.images',
                'parentId': group_id,
                'ids': images_ids
            })

        images_added_id, images_added_entities = event.models_manager.get_childs_entities('groups', target_group_id, 'images', list(images_added.keys()))
        changes.append({
            'type': 'RELATION_ADD',
            'relation': 'group.images',
            'parentId': target_group_id,
            'entities': images_added_entities
        })
        changes.append({
            'type': 'UPDATE',
            'entity': 'group',
            'items': event.models_manager.get_groups(list(detached_groups.keys()) + [target_group_id], faces_mapping=True)
        })
        for image_id, faces in images_added.items():
            changes.append({
                'type': 'RELATION_ADD',
                'relation': 'image.faces',
                'parentId': image_id,
                'entities': faces
            })
            changes.append({
                'type': 'RELATION_ADD',
                'relation': 'image.groups',
                'parentId': image_id,
                'entities': event.models_manager.get_entities('groups', [target_group_id])
            })
        if source_deleted:
            changes.append({
                'type': 'REMOVE',
                'entity': 'group',
                'ids': [source_group_id]
            })
        response = {
            "success": True,
            'source_deleted': source_deleted,
            'new_group_created': new_group_created,
            'target_group_id': target_group_id,
            'len_added': len_faces_added,
            'changes': changes
        }
        return jsonify(response)
    except Exception as e:
        return bad_request(e)

# ==============================================================================
# III. MOMENTS (TIMELINE) ENDPOINTS
# ==============================================================================

@app.route("/api/events/<event_id>/moments", methods=["GET"])
@require_auth
def get_moments(event_id):
    """List all accessible moment summaries for the specific event."""
    event = get_event(event_id)
    moments = event.models_manager.get_entities('moments')
    changes = [{
        'type': 'UPSERT',
        'entity': 'moment',
        'items': moments
    }]
    return jsonify({'changes': changes})

@app.route("/api/events/<event_id>/moments/<moment_id>", methods=["GET"])
@require_auth
def get_moment(event_id, moment_id):
    """Get a specific moment's details as changes."""
    event = get_event(event_id)
    if not event.models_manager.is_accessible('moments', moment_id):
        return not_found(f"Moment {moment_id} not found or not accessible")

    moment = event.models_manager.get_entities('moments', [moment_id])
    image_ids, images = event.models_manager.get_childs_entities('moments', moment_id, 'images')
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

@app.route("/api/events/<event_id>/moments/check-name", methods=["POST"])
@require_auth
def check_moment_name(event_id):
    """Check if a moment name already exists."""
    event = get_event(event_id)
    data = request.json or {}
    label = data.get('label', '')
    exclude_moment_id = data.get('exclude_moment_id', '')
    if not label:
        return jsonify({"error": "Label is required"}), 400
    conflict_moment_id = event.models_manager.is_exists('moments', {'label': label}, exclude_id=exclude_moment_id)
    return jsonify({"conflict": bool(conflict_moment_id)})

@app.route("/api/events/<event_id>/moments", methods=["POST"])
@require_auth
def create_moment(event_id):
    """Create a new moment."""
    event = get_event(event_id)
    data = request.json or {}
    
    try:
        allowed_fields = {'label', 'description', 'start', 'end', 'representative_image'}
        sanitized = {k: v for k, v in data.items() if k in allowed_fields}
        if sanitized:
            moment_id = event.models_manager.add('moments', sanitized)
            created_moment = event.models_manager.get_entities('moments', [moment_id])
            changes = [{
                'type': 'UPSERT',
                'entity': 'moment',
                'items': created_moment
            }]
            response = {"success": True, "moment_id": moment_id, "changes": changes}
        else:
            response = {"success": False}
        return jsonify(response)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments/<moment_id>", methods=["PUT"])
@require_auth
def update_moment(event_id, moment_id):
    """Update a moment's metadata."""
    event = get_event(event_id)
    if not event.models_manager.is_accessible('moments', moment_id):
        return not_found(f"Moment {moment_id} not found or not accessible")
        
    data = request.json or {}
    try:
        allowed_fields = {'label', 'description', 'start', 'end', 'representative_image'}
        sanitized = {k: v for k, v in data.items() if k in allowed_fields}
        if sanitized:
            event.models_manager.edit('moments', moment_id, sanitized)
            updated_moment = event.models_manager.get_entities('moments', [moment_id])
            changes = [{
                'type': 'UPDATE',
                'entity': 'moment',
                'items': updated_moment
            }]
            response = {"success": True, "changes": changes}
        else:
            response = {"success": False}
        return jsonify(response)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments/images", methods=["GET"])
@require_auth
def get_images_to_moments(event_id):
    """Get all images with data for selecting in moment editor."""
    event = get_event(event_id)
    images = event.models_manager.get_images_to_moments()
    changes = [{
        'type': 'UPSERT',
        'entity': 'image',
        'items': images
    }]
    return jsonify({'changes': changes})

def _edit_moment_images(event, moment_id, image_ids, add: bool):
    """Helper: Add or remove images from a moment, return response with changes."""
    updated_image_ids, detached_moments = event.models_manager.edit_childs('moments', moment_id, child='images', child_ids=image_ids, add=add)
    changes = []
    if updated_image_ids:
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
            'items': event.models_manager.get_entities('moments', list(detached_moments.keys()) + [moment_id])
        })
        changes.append({
            'type': 'UPSERT',
            'entity': 'image',
            'items': event.models_manager.get_entities('images', updated_image_ids)
        })
        if add:
            changes.append({
                'type': 'RELATION_ADD',
                'relation': 'moment.images',
                'parentId': moment_id,
                'entities': event.models_manager.get_entities('images', updated_image_ids)
            })
        else:
            changes.append({
                'type': 'RELATION_REMOVE',
                'relation': 'moment.images',
                'parentId': moment_id,
                'ids': updated_image_ids
            })

    return {
        "success": True,
        f'len_{"added" if add else "removed"}': len(updated_image_ids),
        "changes": changes
    }

@app.route("/api/events/<event_id>/moments/<moment_id>/images", methods=["POST"])
@require_auth
def add_images_to_moment(event_id, moment_id):
    """Add images to a moment."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    
    try:
        print(moment_id)
        print(image_ids)
        response = _edit_moment_images(event, moment_id, image_ids, add=True)

        return jsonify(response)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments/<moment_id>/images", methods=["DELETE"])
@require_auth
def remove_images_from_moment(event_id, moment_id):
    """Remove images from a moment."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    try:
        response = _edit_moment_images(event, moment_id, image_ids, add=False)
        return jsonify(response)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments/moments/images", methods=["DELETE"])
@require_auth
def remove_images_from_moments(event_id):
    """Remove images from a moment."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    detached_moments = event.models_manager.remove_images_from_moments(image_ids)
    changes = []
    for moment_id, image_ids in detached_moments.items():
        changes.append({
            'type': 'RELATION_REMOVE',
            'relation': 'moment.images',
            'parentId': moment_id,
            'ids': image_ids
        })
        changes.append({
            'type': 'UPSERT',
            'entity': 'moment',
            'items': event.models_manager.get_entities('moments', list(detached_moments.keys()))
        })
        changes.append({
            'type': 'UPSERT',
            'entity': 'image',
            'items': event.models_manager.get_entities('images', image_ids)
        })
    return jsonify({"success": True, "changes": changes})

@app.route("/api/events/<event_id>/moments/<moment_id>", methods=["DELETE"])
@require_auth
def delete_moment(event_id, moment_id):
    """Delete a moment."""
    event = get_event(event_id)
    if not event.models_manager.is_accessible('moments', moment_id):
        return not_found(f"Moment {moment_id} not found or not accessible")
    
    try:
        event.models_manager.delete('moments', moment_id)
        
        response = {"success": True, "deleted_ids": [moment_id]}
        response['changes'] = [{
            'type': 'REMOVE',
            'entity': 'moment',
            'ids': [moment_id]
        }]
        return jsonify(response)
    except Exception as e:
        return bad_request(e)

# ==============================================================================
# IV. ALBUMS ENDPOINTS
# ==============================================================================

@app.route("/api/events/<event_id>/albums", methods=["GET"])
@require_auth
def get_albums(event_id):
    """List all accessible album summaries for the specific event."""
    exclude_defaults = _parse_bool(request.args.get('exclude_defaults'), False)
    event = get_event(event_id)
    table = 'albums_actual' if exclude_defaults else 'albums'
    albums = event.models_manager.get_entities(table)
    changes = [{
        'type': 'INSERT',
        'entity': 'album',
        'items': albums
    }]
    return jsonify({'changes': changes})

@app.route("/api/events/<event_id>/albums/<album_id>", methods=["GET"])
@require_auth
def get_album(event_id, album_id):
    """Get a specific album's details as changes."""
    event = get_event(event_id)
    if not event.models_manager.is_accessible('albums', album_id):
        return not_found(f"Album {album_id} not found or not accessible")

    album = event.models_manager.get_entities('albums', album_id)
    image_ids, images = event.models_manager.get_childs_entities('albums', [album_id], 'images')
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

@app.route("/api/events/<event_id>/albums/defaults/favorites", methods=["GET"])
@require_auth
def get_favorites_album(event_id):
    """Get the favorites album."""
    event = get_event(event_id)
    favorites_album_id = event.models_manager.get_favorites_album()
    return get_album(event_id, favorites_album_id)

@app.route("/api/events/<event_id>/albums/defaults/archive", methods=["GET"])
@require_auth
def get_archive_album(event_id):
    """Get the archive album."""
    event = get_event(event_id)
    archive_album_id = event.models_manager.get_archive_album()
    return get_album(event_id, archive_album_id)

@app.route("/api/events/<event_id>/albums/check-name", methods=["POST"])
@require_auth
def check_album_name(event_id):
    """Check if an album name already exists."""
    event = get_event(event_id)
    data = request.json or {}
    label = data.get('label', '')
    if not label:
        return jsonify({"error": "Label is required"}), 400
    conflict_album_id = event.models_manager.is_exists('albums', {'label': label})
    return jsonify({"conflict": bool(conflict_album_id)})

@app.route("/api/events/<event_id>/albums", methods=["POST"])
@require_auth
def create_album(event_id):
    """Create a new album."""
    event = get_event(event_id)
    data = request.json or {}
    
    try:
        allowed_fields = {'label', 'description', 'representative_image'}
        sanitized = {k: v for k, v in data.items() if k in allowed_fields}
        if sanitized:
            album_id = event.models_manager.add('albums', sanitized)
            created_album = event.models_manager.get_entities('albums', [album_id])
            changes = [{
                'type': 'UPSERT',
                'entity': 'album',
                'items': created_album
            }]
            response = {"success": True, "album_id": album_id, "changes": changes}
        else:
            response = {"success": False}
        return jsonify(response)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/albums/<album_id>", methods=["PUT"])
@require_auth
def update_album(event_id, album_id):
    """Update an album's details."""
    event = get_event(event_id)
    album = event.models_manager.get_entities('albums', album_id)
    if not album:
        return not_found(f"Album {album_id} not found or not accessible")

    data = request.json or {}
    if (album.get('label', '').lower() in ('archive', 'favorites')) and 'label' in data:
        data.pop('label', None)

    try:
        allowed = {'label', 'description', 'representative_image'}
        sanitized = {k: v for k, v in data.items() if k in allowed}
        if sanitized:
            event.models_manager.edit('albums', album_id, sanitized)

            updated = event.models_manager.get_entities('albums', [album_id])
            changes = [{
                'type': 'UPDATE',
                'entity': 'album',
                'items': updated
            }]
            response = {"success": True, "changes": changes}
        else:
            response = {"success": False}
        return jsonify(response)
    except Exception as e:
        return bad_request(e)

def _edit_album_images(event, album_id, image_ids, add: bool):
    """Helper: Add or remove images from an album, return response with changes."""
    updated_image_ids, _ = event.models_manager.edit_childs(
        'albums', album_id, child='images', child_ids=image_ids, add=add
    )
    changes = []
    if updated_image_ids:
        album = event.models_manager.get_entities('albums', [album_id])
        if add:
            changes.append({
                'type': 'RELATION_ADD',
                'relation': 'album.images',
                'parentId': album_id,
                'entities': event.models_manager.get_entities('images', updated_image_ids)
            })
        else:
            changes.append({
                'type': 'RELATION_REMOVE',
                'relation': 'album.images',
                'parentId': album_id,
                'ids': updated_image_ids
            })

        is_default_album = album_id in [
            event.models_manager.get_favorites_album(),
            event.models_manager.get_archive_album()
        ]
        if is_default_album:
            changes.append({
                'type': 'UPDATE',
                'entity': 'image',
                'items': event.models_manager.get_entities('images', updated_image_ids)
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

@app.route("/api/events/<event_id>/albums/<album_id>/images", methods=["POST"])
@require_auth
def add_images_to_album(event_id, album_id):
    """Add images to an album."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    try:
        response = _edit_album_images(event, album_id, image_ids, add=True)
        return jsonify(response)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/albums/<album_id>/images", methods=["DELETE"])
@require_auth
def remove_images_from_album(event_id, album_id):
    """Remove images from an album."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    try:
        response = _edit_album_images(event, album_id, image_ids, add=False)
        return jsonify(response)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/albums/favorites/images", methods=["PUT"])
@require_auth
def toggle_favorites_images(event_id):
    """Add or remove multiple images from favorites album."""
    event = get_event(event_id)
    
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    # TODO: is_favorite means it is already there? is should be and than to replace add=is_favorite with add=not is_favorite?
    is_favorite = data.get('is_favorite', False)
    
    if not image_ids:
        return bad_request("No image IDs provided")
    
    try:
        favorites_album_id = event.models_manager.get_favorites_album()
        response = _edit_album_images(event, favorites_album_id, image_ids, add=is_favorite)
        return jsonify(response)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/albums/archive/images", methods=["PUT"])
@require_auth
def toggle_archive_images(event_id):
    """Add or remove multiple images from archive album."""
    event = get_event(event_id)
    
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    is_archived = data.get('is_archived', False)
    
    if not image_ids:
        return bad_request("No image IDs provided")
    
    try:
        archive_album_id = event.models_manager.get_archive_album()
        response = _edit_album_images(event, archive_album_id, image_ids, add=is_archived)
        return jsonify(response)
    except Exception as e:
        return bad_request(e)

# ==============================================================================
# V. IMAGES ENDPOINTS
# ==============================================================================

@app.route("/api/events/<event_id>/images", methods=["GET"])
@require_auth
def get_images(event_id):
    """List all accessible images summaries for the specific event."""
    event = get_event(event_id)
    images = event.models_manager.get_entities('images')
    changes = [{
        'type': 'UPSERT',
        'entity': 'image',
        'items': images
    }]
    return jsonify({'changes': changes})

@app.route("/api/events/<event_id>/images/<image_id>", methods=["GET"])
@require_auth
def get_image(event_id, image_id):
    """Get a specific image's details as changes."""
    event = get_event(event_id)
    if not event.models_manager.is_accessible('images', image_id):
        return not_found(f"Image {image_id} not found or not accessible")

    image = event.models_manager.get_entities('images', [image_id])
    album_ids, albums = event.models_manager.get_childs_entities('images', image_id, 'albums')
    face_ids, faces = event.models_manager.get_childs_entities('images', image_id, 'faces')
    group_ids, groups = event.models_manager.get_childs_entities('images', image_id, 'groups')
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
        moments = event.models_manager.get_entities('moments', [moments])
        changes.append({
            'type': 'RELATION_SET',
            'relation': 'image.moments',
            'parentId': image_id,
            'entities': moments
        })
    return jsonify({ 'changes': changes })

# ==============================================================================
# VI. FILE SERVING & DOWNLOADS
# ==============================================================================

@app.route('/api/events/<event_id>/file/<file_type>/<file_id>.webp')
@require_auth
def get_file_webp(event_id, file_type, file_id):
    """Serve various types of image files (display, face, thumb, etc.)."""
    event = get_event(event_id)
    
    dir_map = {
        'display': event.display_dir,
        'face': event.faces_dir,
        'thumb': event.thumb_dir,
        'high_quality': event.high_quality_dir,
        'original': event.original_dir
    }
    
    table_map = {
        'display': 'images',
        'face': 'faces',
        'thumb': 'images',
        'high_quality': 'images',
        'original': 'images'
    }

    if file_type not in dir_map:
        abort(404)
    
    table_to_check = table_map[file_type]
    if not event.models_manager.is_accessible(table_to_check, file_id):
        abort(403)
    
    file_path = os.path.join(dir_map[file_type], f'{file_id}.webp')
    if not os.path.exists(file_path):
        abort(404)
    
    resp = make_response(send_file(file_path, mimetype='image/webp'))
    resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp

@app.route('/api/events/<event_id>/display/<image_id>.webp')
@require_auth
def get_display_image_webp(event_id, image_id):
    return get_file_webp(event_id, 'display', image_id)

@app.route('/api/events/<event_id>/faces/<face_id>.webp')
@require_auth
def get_face_crop_webp(event_id, face_id):
    return get_file_webp(event_id, 'face', face_id)

@app.route('/api/events/<event_id>/thumb/<image_id>.webp')
@require_auth
def get_thumbnail_image_webp(event_id, image_id):
    return get_file_webp(event_id, 'thumb', image_id)

@app.route('/api/events/<event_id>/high_quality/<image_id>.webp')
@require_auth
def get_high_quality_image_webp(event_id, image_id):
    return get_file_webp(event_id, 'high_quality', image_id)

@app.route('/api/events/<event_id>/original/<image_id>.webp')
@require_auth
def get_original_image_webp(event_id, image_id):
    return get_file_webp(event_id, 'original', image_id)

@app.route('/api/events/<event_id>/<entity>/<parent_id>/representative', methods=['GET', 'HEAD'])
@require_auth
def get_representative_webp(event_id, entity, parent_id):
    
    event = get_event(event_id)

    dir_map = {
        'faces': event.faces_dir,
        'groups': event.faces_dir,
        'images': event.display_dir,
        'albums': event.display_dir,
        'moments': event.display_dir,
    }

    if not event.models_manager.is_accessible(entity, parent_id):
        abort(403)
    _, file_id = event.models_manager.get_representative(entity, parent_id)
    
    if not file_id:
        return '', 204
    
    file_path = os.path.join(dir_map[entity], f'{file_id}.webp')
    if not os.path.exists(file_path):
        abort(404)
    
    resp = make_response(send_file(file_path, mimetype='image/webp'))
    resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp

@app.route("/api/events/<event_id>/download", methods=["POST"])
@require_auth
def download_images(event_id):
    """Download images as a ZIP file."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    quality = (data.get('quality') or 'high').lower()
    
    if not image_ids:
        return jsonify({"error": "No image ids provided"}), 400
    
    try:
        memory_file = io.BytesIO()
        failed_images = []
        with zipfile.ZipFile(memory_file, 'w') as zf:
            for image_id in image_ids:
                if not event.models_manager.is_accessible('images', image_id):
                    failed_images.append(image_id)
                    continue
                
                src_dir = event.high_quality_dir if quality != 'original' else event.original_dir
                file_path = os.path.join(src_dir, f"{image_id}.jpg")
                if os.path.exists(file_path):
                    zf.write(file_path, f"{image_id}.jpg")
                else:
                    failed_images.append(image_id)
        
        memory_file.seek(0)
        return send_file(
            memory_file,
            mimetype='application/zip',
            as_attachment=True,
            download_name='images.zip'
        )
    except Exception as e:
        return bad_request(e)

# ==============================================================================
# VII. DEPRECATED & MISC ENDPOINTS
# ==============================================================================

if __name__ == "__main__":
    app.run(debug=True)
