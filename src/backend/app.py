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
def _parse_pagination() -> tuple[int | None, int | None]:
    """Parse limit and offset from request arguments for pagination."""
    limit = request.args.get('limit', type=int)
    offset = request.args.get('offset', type=int)
    return limit, offset

def _parse_bool(val: str | None, default: bool) -> bool:
    """Parse a boolean value from a string, with a default."""
    if val is None:
        return default
    return str(val).lower() in ('1', 'true', 'yes', 'y', 'on')

# TODO: Remove this
def add_change_instruction():
    """Deprecated: Old change format no longer used. Keep for reference.
    Use the generic schema below across all endpoints:
    - UPSERT: { type: 'UPSERT', entity: 'image'|'group'|'moment'|'album', items: [ ... ] }
    - REMOVE: { type: 'REMOVE', entity: 'image'|'group'|'moment'|'album', ids: [ ... ] }
    - RELATION_ADD: { type: 'RELATION_ADD', relation: 'group.images'|'moment.images'|'album.images', parentId, ids, position? }
    - RELATION_REMOVE: { type: 'RELATION_REMOVE', relation: 'group.images'|'moment.images'|'album.images', parentId, ids }
    - RELATION_MOVE: { type: 'RELATION_MOVE', relation: 'group.images'|'moment.images', fromParentId, toParentId, ids, position? }
    - RELATION_SET: { type: 'RELATION_SET', relation: 'group.images'|'moment.images'|'album.images', parentId, ids }
    """

def get_event(event_id, profile_id=None, include_archived=None):
    """Get event instance with profile context."""
    if profile_id is None:
        profile_id = getattr(g, 'profile_id', FIXED_PROFILE_ID)
    
    if include_archived is None:
        claims = get_jwt()
        if 'include_archived' in claims:
            include_archived = claims['include_archived']
    
    return Event(event_id, profile_id=profile_id, include_archived=include_archived)

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

@app.route("/set-include-archived", methods=["POST"])
def set_include_archived():
    """Set the include_archived flag in a JWT token."""
    data = request.json or {}
    include_archived = data.get('include_archived', False)
    
    additional_claims = {"include_archived": include_archived}
    access_token = create_access_token(identity=FIXED_PROFILE_ID, additional_claims=additional_claims)
    
    resp = jsonify({
        "access_token": access_token,
        "include_archived": include_archived
    })
    set_access_cookies(resp, access_token)
    return resp

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
    changes = event.models_manager.get_enteties_changes('groups')
    return jsonify({ 'changes': changes })

########## TODO: simplify
@app.route("/api/events/<event_id>/groups/<group_id>", methods=["GET"])
@require_auth
def get_group(event_id, group_id):
    """Get a specific group's details as changes, including its paginated images and faces mapping."""
    event = get_event(event_id)

    group_changes = event.models_manager.get_enteties_changes('groups', group_id)
    if not group_changes:
        return not_found(f"Group {group_id} not found or not accessible")

    limit, offset = _parse_pagination()

    filter_groups_str = request.args.get('filter_groups')
    filter_group_ids = filter_groups_str.split(',') if filter_groups_str else []
    filter_mode = request.args.get('filter_mode', 'and')
    only_selected = _parse_bool(request.args.get('only_selected'), False)

    group_ids = [group_id] + filter_group_ids

    filtered_changes = event.models_manager.get_filtered_images(
        group_ids,
        mode=filter_mode,
        only=only_selected,
        limit=limit,
        offset=offset
    )
    return jsonify({ 'changes': filtered_changes })

@app.route("/api/events/<event_id>/groups/related", methods=["GET"])
@require_auth
def get_related_groups(event_id):
    """Get related groups based on a set of selected groups and base images."""
    event = get_event(event_id)

    image_ids_str = request.args.get('image_ids', '')
    selected_groups_str = request.args.get('selected_groups', '')

    image_ids = image_ids_str.split(',') if image_ids_str else []
    selected_groups = [gid for gid in (selected_groups_str.split(',') if selected_groups_str else []) if gid]

    group_ids = selected_groups

    related_groups = event.models_manager.get_related_groups(
        group_ids=group_ids,
        base_image_ids=image_ids
    )
    return jsonify({"related_groups": related_groups})

@app.route("/api/events/<event_id>/groups/<group_id>/faces", methods=["GET"])
@require_auth
def get_group_faces(event_id, group_id):
    """Get the faces of a group."""
    event = get_event(event_id)
    faces = event.models_manager.get_childs_entities('groups', group_id, child='faces')
    return jsonify({"faces": faces})

@app.route("/api/events/<event_id>/groups/<group_id>", methods=["PUT"])
@require_auth
def update_group(event_id, group_id):
    """Update a group."""
    event = get_event(event_id)
    if not event.models_manager.get_enteties_changes('groups', group_id):
        return not_found(f"Group {group_id} not found or not accessible")
        
    data = request.json or {}
    try:        
        allowed_fields = {'label', 'representative_face'}
        sanitized = {k: v for k, v in data.items() if k in allowed_fields}
        if sanitized:
            event.models_manager.edit('groups', group_id, sanitized)
        
        updated_group = event.models_manager.get_enteties_changes('groups', group_id)
        
        response_data = {"success": True, "group": updated_group}
        response_data.setdefault('changes', []).append({
            'type': 'UPSERT',
            'entity': 'group',
            'items': [updated_group]
        })
        return jsonify(response_data)
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

    try:
        conflict_group_id = event.models_manager.is_exists('groups', {'label': label}, exclude_id=exclude_group_id)
        if conflict_group_id:
            conflicting_group = event.models_manager.get_enteties_changes('groups', conflict_group_id)
            return jsonify({"conflict": True, "conflicting_group": conflicting_group})
        else:
            return jsonify({"conflict": False})
    except Exception as e:
        return bad_request(e)

# TODO: update models_manager
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
        response = {"success": True}
        response.update(result)
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
    exclude_empty = _parse_bool(request.args.get('exclude_empty_entities'), False)
    moments = event.models_manager.get_enteties_changes('moments', exclude_empty_entities=exclude_empty)
    return jsonify({'changes': moments})

@app.route("/api/events/<event_id>/moments/<moment_id>", methods=["GET"])
@require_auth
def get_moment(event_id, moment_id):
    """Get a specific moment's details as changes."""
    event = get_event(event_id)
    moment_changes = event.models_manager.get_enteties_changes('moments', moment_id)
    if not moment_changes:
        return not_found(f"Moment {moment_id} not found or not accessible")

    images_changes = event.models_manager.get_childs_changes('moments', moment_id, 'images')
    all_changes = []
    all_changes.extend(moment_changes)
    all_changes.extend(images_changes)
    return jsonify({ 'changes': all_changes })

@app.route("/api/events/<event_id>/moments", methods=["POST"])
@require_auth
def create_moment(event_id):
    """Create a new moment."""
    event = get_event(event_id)
    data = request.json or {}
    
    try:
        moment_id = event.models_manager.add('moments', data)
        created_moment = event.models_manager.get_enteties_changes('moments', moment_id)
        
        response_data = {"success": True, "moment_id": moment_id, "moment": created_moment}
        response_data.setdefault('changes', []).append({
            'type': 'UPSERT',
            'entity': 'moment',
            'items': [created_moment]
        })
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments/<moment_id>", methods=["PUT"])
@require_auth
def update_moment(event_id, moment_id):
    """Update a moment's metadata."""
    event = get_event(event_id)
    if not event.models_manager.get_enteties_changes('moments', moment_id):
        return not_found(f"Moment {moment_id} not found or not accessible")
        
    data = request.json or {}
    try:
        allowed_fields = {'label', 'description', 'start', 'end', 'representative_image'}
        sanitized = {k: v for k, v in data.items() if k in allowed_fields}
        if sanitized:
            event.models_manager.edit('moments', moment_id, sanitized)
        
        updated_moment = event.models_manager.get_enteties_changes('moments', moment_id)
        
        response_data = {"success": True, "moment": updated_moment}
        response_data.setdefault('changes', []).append({
            'type': 'UPSERT',
            'entity': 'moment',
            'items': [updated_moment]
        })
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)

# TODO: refactor to new store
@app.route("/api/events/<event_id>/moments/<moment_id>/images", methods=["POST"])
@require_auth
def add_images_to_moment(event_id, moment_id):
    """Add images to a moment."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    
    try:
        result = event.models_manager.edit_childs('moments', moment_id, image_ids, add=True)
        response = {"success": True}
        if result.get('changes'):
            response['changes'] = result['changes']
        response['len_edited'] = result.get('len_edited', 0)

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
        result = event.models_manager.edit_childs('moments', moment_id, image_ids, add=False)
        response = {"success": True}
        if result.get('changes'):
            response['changes'] = result['changes']
        response['len_edited'] = result.get('len_edited', 0)

        return jsonify(response)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments/<moment_id>", methods=["DELETE"])
@require_auth
def delete_moment(event_id, moment_id):
    """Delete a moment."""
    event = get_event(event_id)
    if not event.models_manager.get_enteties_changes('moments', moment_id):
        return not_found(f"Moment {moment_id} not found or not accessible")
    
    try:
        deleted_ids = event.models_manager.delete('moments', moment_id)
        
        response_data = {"success": True, "deleted_ids": deleted_ids}
        response_data.setdefault('changes', []).append({
            'type': 'REMOVE',
            'entity': 'moment',
            'ids': [moment_id]
        })
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)

# ==============================================================================
# IV. ALBUMS ENDPOINTS
# ==============================================================================

@app.route("/api/events/<event_id>/albums", methods=["GET"])
@require_auth
def get_albums(event_id):
    """List all accessible album summaries for the specific event."""
    event = get_event(event_id)
    albums = event.models_manager.get_enteties_changes('albums')
    return jsonify({"albums": albums})

@app.route("/api/events/<event_id>/albums/<album_id>", methods=["GET"])
@require_auth
def get_album(event_id, album_id):
    """Get a specific album's details as changes."""
    event = get_event(event_id)
    album_changes = event.models_manager.get_enteties_changes('albums', album_id)
    if not album_changes:
        return not_found(f"Album {album_id} not found or not accessible")

    images_changes = event.models_manager.get_childs_changes('albums', album_id, 'images')
    all_changes = []
    all_changes.extend(album_changes)
    all_changes.extend(images_changes)
    return jsonify({ 'changes': all_changes })

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

@app.route("/api/events/<event_id>/albums/<album_id>", methods=["PUT"])
@require_auth
def update_album(event_id, album_id):
    """Update an album's details."""
    event = get_event(event_id)
    album = event.models_manager.get_enteties_changes('albums', album_id)
    if not album:
        return not_found(f"Album {album_id} not found or not accessible")

    data = request.json or {}
    if (album.get('label') in ('archive', 'favorites')) and 'label' in data:
        data.pop('label', None)

    try:
        allowed = {'label', 'description', 'representative_image'}
        sanitized = {k: v for k, v in data.items() if k in allowed}
        if sanitized:
            event.models_manager.edit('albums', album_id, sanitized)

        updated = event.models_manager.get_enteties_changes('albums', album_id)
        response_data = {"success": True, "album": updated}
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)

# TODO: refactor to new store
@app.route("/api/events/<event_id>/albums/<album_id>/images", methods=["POST"])
@require_auth
def add_images_to_album(event_id, album_id):
    """Add images to an album."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    
    try:
        result = event.models_manager.edit_album_images(album_id, image_ids, add=True)
        response = {"success": True}
        if result.get('changes'):
            response['changes'] = result['changes']
        response['len_edited'] = result.get('len_edited', 0)
        return jsonify(response)
    except Exception as e:
        return bad_request(e)

# TODO: refactor to new store
@app.route("/api/events/<event_id>/albums/<album_id>/images", methods=["DELETE"])
@require_auth
def remove_images_from_album(event_id, album_id):
    """Remove images from an album."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    try:
        result = event.models_manager.edit_album_images(album_id, image_ids, add=False)
        response = {"success": True}
        if result.get('changes'):
            response['changes'] = result['changes']
        response['len_edited'] = result.get('len_edited', 0)
        return jsonify(response)
    except Exception as e:
        return bad_request(e)

# ==============================================================================
# V. IMAGES & FACES ENDPOINTS
# ==============================================================================

@app.route("/api/events/<event_id>/images", methods=["POST"])
@require_auth
def get_images_details(event_id):
    """Get complete details for a list of images."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    if not image_ids:
        return jsonify({"changes": []})

    try:
        images_data = event.models_manager.get_images(image_ids)
        return jsonify({"changes": images_data})
    except Exception as e:
        return bad_request(e)

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
        with zipfile.ZipFile(memory_file, 'w') as zf:
            for image_id in image_ids:
                if not event.models_manager.is_accessible('images', image_id):
                    continue
                
                src_dir = event.high_quality_dir if quality != 'original' else event.original_dir
                file_path = os.path.join(src_dir, f"{image_id}.jpg")
                if os.path.exists(file_path):
                    zf.write(file_path, f"{image_id}.jpg")
        
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

# Note: All old GET endpoints that returned bulky data have been removed or refactored.
# The new pattern is to fetch summaries, then paginated details.

if __name__ == "__main__":
    app.run(debug=True)
