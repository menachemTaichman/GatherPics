from flask import Flask, jsonify, request, g, send_file, abort, make_response
from flask_cors import CORS
from functools import wraps
import traceback
import os
import io
import zipfile
import copy

from src.core.models.event import Event

app = Flask(__name__)
CORS(app, origins="*", supports_credentials=True)

# --- Placeholder values for now ---
FIXED_EVENT_ID = "75cb6635-879d-4386-b023-366444dc0fb2"
FIXED_PROFILE_ID = "89cb4967-0eba-48af-99cc-5e87407fb639"

# --- Utility Functions ---
def _parse_include_archived(default: bool = False) -> bool:
    val = request.args.get('include_archived')
    if val is None:
        return default
    return str(val).lower() in ('1', 'true', 'yes', 'y', 'on')

def build_complete_image_data(event, image_id, include_all_faces=True, group_filter=None, include_archived: bool = False):
    """Build complete image data with all related information."""
    try:
        image = event.models_manager.get_one('images', image_id, include_archived)
        if not image:
            return None
        
        # Get face IDs for this image
        face_ids = event.models_manager.get_image_faces(image_id, include_archived)
        
        # Build faces data
        faces_data = []
        for face_id in face_ids:
            face = event.models_manager.get_one('faces', face_id, include_archived)
            if face:
                # Apply group filter if specified
                if group_filter and face.get('groupID') != group_filter:
                    continue
                
                group = None
                if face.get('groupID'):
                    group = event.models_manager.get_one('groups', face['groupID'], include_archived)
                
                face_data = {
                    'face_id': face_id,
                    'face_coords': {
                        'Left': face['left'],
                        'Top': face['top'], 
                        'Width': face['width'],
                        'Height': face['height']
                    },
                    'group_id': face.get('groupID'),
                    'group_label': group['label'] if group else 'Unknown',
                    'group_representative': group.get('representative_face') if group else None
                }
                faces_data.append(face_data)
        
        # Get moment info if available
        moment_info = None
        if image.get('momentID'):
            moment = event.models_manager.get_one('moments', image['momentID'], include_archived)
            if moment:
                moment_info = {
                    'id': moment.get('momentID', moment.get('id', 'Unknown')),
                    'title': moment.get('label', 'Unknown'),  # Always use 'label' from database
                    'description': moment.get('description', ''),
                    'start': moment.get('start'),
                    'end': moment.get('end'),
                }
        
        # Build complete response
        # List albums for this image (labels)
        image_albums = event.models_manager.get_image_albums(image_id, include_archived)

        image_data = {
            'id': image_id,
            'label': image['label'],
            'date_taken': image.get('date_taken'),
            'file_size': image.get('file_size'),
            'width': image.get('width'),
            'height': image.get('height'),
            'is_archived': image.get('is_archived', 0) == 1 if isinstance(image.get('is_archived', 0), (int, bool)) else bool(image.get('is_archived')),
            'is_favorites': image.get('is_favorites', 0) == 1 if isinstance(image.get('is_favorites', 0), (int, bool)) else bool(image.get('is_favorites')),
            'albums': image_albums,
            'faces_count': len(faces_data),
            'faces': faces_data,
            'moment': moment_info,
            'urls': {
                'display': f'/api/events/{FIXED_EVENT_ID}/display/{image_id}.webp',
                'thumbnail': f'/api/events/{FIXED_EVENT_ID}/thumb/{image_id}.webp',
                'high_quality': f'/api/events/{FIXED_EVENT_ID}/high_quality/{image_id}.webp',
                'original': f'/api/events/{FIXED_EVENT_ID}/original/{image_id}.webp',
            }
        }
        
        return image_data
    except Exception as e:
        return None

def add_change_instruction(response_data, change_type, change_data=None):
    """Add change instruction to API response for frontend data updates."""
    if 'changes' not in response_data:
        response_data['changes'] = []
    
    # Create a simple change instruction without circular references
    change_instruction = {
        'type': change_type,
        'data': change_data if change_data is not None else {}
    }
    
    response_data['changes'].append(change_instruction)
    
    return response_data

def get_event_with_profile(profile_id=None):
    """Get event instance with profile context."""
    if profile_id is None:
        profile_id = FIXED_PROFILE_ID
    return Event(FIXED_EVENT_ID, profile_id=profile_id)

# --- Auth Decorator (no-op for now) ---
def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        # In future: check request headers/cookies for auth, validate profile_id, etc.
        g.profile_id = FIXED_PROFILE_ID
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

# --- API Endpoints ---

# Event-scoped endpoints (recommended pattern)
@app.route("/api/events/<event_id>/groups", methods=["GET"])
@require_auth
def get_groups(event_id):
    """List all accessible groups for the specific event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    # Get enriched groups with image information
    include_archived = _parse_include_archived(False)
    enriched_groups = event.models_manager.get_all('groups', include_archived)
    return jsonify({"groups": enriched_groups})

# -------------------- Albums Endpoints --------------------
@app.route("/api/events/<event_id>/albums", methods=["GET"])
@require_auth
def get_albums(event_id):
    """List all accessible albums for the specific event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")

    try:
        include_archived = _parse_include_archived(False)
        albums = event.models_manager.get_all('albums', include_archived)

        # Sort with archive first, favorites second, then by label
        def album_sort_key(a):
            label = (a.get('label') or '').lower()
            if label == 'archive':
                return (0, '')
            if label == 'favorites':
                return (1, '')
            return (2, label)

        albums_sorted = sorted(albums, key=album_sort_key)
        return jsonify({"albums": albums_sorted})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/albums/<album_id>", methods=["GET"])
@require_auth
def get_album(event_id, album_id):
    """Get a specific album by ID if accessible in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")

    include_archived = _parse_include_archived(False)
    album = event.models_manager.get_one('albums', album_id, include_archived)
    if not album:
        return not_found(f"Album {album_id} not found or not accessible")
    return jsonify(album)

@app.route("/api/events/<event_id>/albums/<album_id>", methods=["PUT"])
@require_auth
def update_album(event_id, album_id):
    """Update an album's label/description/representative (defaults cannot change label)."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")

    # Check if album exists and is accessible
    include_archived = _parse_include_archived(False)
    album = event.models_manager.get_one('albums', album_id, include_archived)
    if not album:
        return not_found(f"Album {album_id} not found or not accessible")

    data = request.json or {}

    # Prevent renaming default albums
    if (album.get('label') in ('archive', 'favorites')) and 'label' in data:
        data.pop('label', None)

    try:
        # Keep only allowed columns
        allowed = {'label', 'description', 'representative_image'}
        sanitized = {k: v for k, v in data.items() if k in allowed}
        if sanitized:
            event.models_manager.edit('albums', album_id, sanitized)

        updated = event.models_manager.get_one('albums', album_id, include_archived)
        response_data = {"success": True, "album": updated}
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/albums/<album_id>/images", methods=["GET"])
@require_auth
def get_album_images(event_id, album_id):
    """Get all images in a specific album within the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")

    try:
        include_archived = _parse_include_archived(False)
        album = event.models_manager.get_one('albums', album_id, include_archived)
        if not album:
            return not_found(f"Album {album_id} not found or not accessible")

        image_ids = event.models_manager.get_album_images(album_id, include_archived)
        images_data = []
        for image_id in image_ids:
            image = event.models_manager.get_one('images', image_id, include_archived)
            if image:
                images_data.append({
                    'id': image_id,
                    'label': image.get('label', ''),
                    'date_taken': image.get('date_taken'),
                    'width': image.get('width'),
                    'height': image.get('height'),
                    'urls': {
                        'display': f'/api/events/{event_id}/display/{image_id}.webp',
                        'thumbnail': f'/api/events/{event_id}/thumb/{image_id}.webp',
                    }
                })
        return jsonify({"images": images_data})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/albums/<album_id>/images", methods=["POST"])
@require_auth
def add_images_to_album(event_id, album_id):
    """Add images to album (idempotent). Body: { image_ids: [] }"""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")

    data = request.json or {}
    image_ids = data.get('image_ids', [])
    try:
        added = event.models_manager.add_images_to_album(album_id, image_ids)
        # If favorites album, include a change flag if needed in future
        return jsonify({"success": True, "added": added})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/albums/<album_id>/images", methods=["DELETE"])
@require_auth
def remove_images_from_album(event_id, album_id):
    """Remove images from album. Body: { image_ids: [] }"""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")

    data = request.json or {}
    image_ids = data.get('image_ids', [])
    try:
        removed = event.models_manager.remove_images_from_album(album_id, image_ids)
        return jsonify({"success": True, "removed": removed})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/groups/<group_id>", methods=["GET"])
@require_auth
def get_group(event_id, group_id):
    """Get a specific group by ID if accessible in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    # Get enriched group with image information
    include_archived = _parse_include_archived(False)
    group = event.models_manager.get_one('groups', group_id, include_archived)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    return jsonify(group)

@app.route("/api/events/<event_id>/groups/<group_id>", methods=["PUT"])
@require_auth
def update_group(event_id, group_id):
    """Update a group's label or representative if accessible in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    # Check if group is accessible
    if not event.models_manager.get_one('groups', group_id):
        return not_found(f"Group {group_id} not found or not accessible")
    
    data = request.json or {}
    
    try:
        event.models_manager.edit('groups', group_id, data)
        
        # Get the group after update
        include_archived = _parse_include_archived(False)
        updated = event.models_manager.get_one('groups', group_id, include_archived)
        
        if updated is None:
            return not_found(f"Group {group_id} not found")
        
        # Add change instruction for frontend
        response_data = {"success": True}
        response_data = add_change_instruction(response_data, 'GROUP_UPDATED', updated)
        return jsonify(response_data)
    except ValueError as e:
        # Handle unique constraint violation
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/groups/check-name", methods=["POST"])
@require_auth
def check_group_name(event_id):
    """Check if a group name already exists in the event and return conflict info."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    data = request.json or {}
    label = data.get('label', '')
    exclude_group_id = data.get('exclude_group_id', '')
    
    if not label:
        return jsonify({"error": "Label is required"}), 400

    try:
        # Check for conflicts
        conflict_group_id = event.models_manager.is_exists('groups', {'label': label}, exclude_id=exclude_group_id)
        
        if conflict_group_id:
            # Get the full conflicting group object
            conflicting_group = event.models_manager.get_one('groups', conflict_group_id)
            return jsonify({
                "conflict": True,
                "conflicting_group": conflicting_group
            })
        else:
            return jsonify({"conflict": False})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/groups/<group_id>", methods=["DELETE"])
@require_auth
def delete_group(event_id, group_id):
    """Delete a group if accessible in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        # Check if group exists and is accessible
        include_archived = _parse_include_archived(False)
        group = event.models_manager.get_one('groups', group_id, include_archived)
        if not group:
            return not_found(f"Group {group_id} not found or not accessible")
        
        # Delete the group
        event.models_manager.delete('groups', group_id)
        
        # Add change instruction for frontend
        response_data = {"success": True}
        response_data = add_change_instruction(response_data, 'GROUP_DELETED', {"group_id": group_id})
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/groups/transfer-faces", methods=["POST"])
@require_auth
def transfer_faces(event_id):
    """Transfer faces between groups within the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    data = request.json or {}
    source_group_id = data.get('source_group_id')
    target_group_id = data.get('target_group_id')
    face_ids = data.get('face_ids', [])
    new_group_name = data.get('new_group_name', '')
    
    if not source_group_id or not face_ids:
        return jsonify({"error": "source_group_id and face_ids are required"}), 400
    
    # If target_group_id is not provided, new_group_name is required
    if not target_group_id and not new_group_name:
        return jsonify({"error": "Either target_group_id or new_group_name is required"}), 400
    
    try:
        # Validate source group exists and is accessible
        source_group = event.models_manager.get_one('groups', source_group_id)
        if not source_group:
            return not_found("Source group not found or not accessible")
        
        # Use ModelsManager to transfer faces between groups
        result = event.models_manager.transfer_faces(source_group_id, face_ids, target_group_id=target_group_id, new_group_name=new_group_name)
        
        # Get updated groups for change instructions
        updated_source = None
        updated_target = None
        
        if not result.get('old_group_deleted'):
            updated_source = event.models_manager.get_one('groups', source_group_id)
        
        if result.get('target_group_id'):
            updated_target = event.models_manager.get_one('groups', result['target_group_id'])
        
        # Add change instructions for frontend
        response_data = {"success": True, "transferred_count": len(face_ids)}
        response_data.update(result)  # Include all result data from the transfer
        
        if updated_source:
            response_data = add_change_instruction(response_data, 'GROUP_UPDATED', updated_source)
        if updated_target:
            response_data = add_change_instruction(response_data, 'GROUP_UPDATED', updated_target)
        
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/groups/<group_id>/images", methods=["GET"])
@require_auth
def get_group_images(event_id, group_id):
    """Get all images containing faces from a specific group in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    include_archived = _parse_include_archived(False)
    group = event.models_manager.get_one('groups', group_id, include_archived)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    
    try:
        # Get image IDs for this group
        image_ids = event.models_manager.get_group_images(group_id, include_archived)
        
        # Get basic image info for each
        images_data = []
        for image_id in image_ids:
            image = event.models_manager.get_one('images', image_id, include_archived)
            if image:
                images_data.append({
                    'id': image_id,
                    'label': image.get('label', ''),
                    'date_taken': image.get('date_taken'),
                    'width': image.get('width'),
                    'height': image.get('height'),
                    'urls': {
                        'display': f'/api/events/{event_id}/display/{image_id}.webp',
                        'thumbnail': f'/api/events/{event_id}/thumb/{image_id}.webp',
                    }
                })
        
        return jsonify({"images": images_data})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/groups/<group_id>/crops", methods=["GET"])
@require_auth
def get_group_crops(event_id, group_id):
    """Get all face crops from a specific group in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    include_archived = _parse_include_archived(False)
    group = event.models_manager.get_one('groups', group_id, include_archived)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    
    try:
        # Get crop mapping from image_id to face_id
        crop_mapping = event.models_manager.get_group_unique_face_per_image(group_id)
        
        return jsonify({"crop_mapping": crop_mapping})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/groups/<group_id>/related-groups", methods=["GET"])
@require_auth
def get_related_groups(event_id, group_id):
    """Get groups that share images with the specified group in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    include_archived = _parse_include_archived(False)
    group = event.models_manager.get_one('groups', group_id, include_archived)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    
    try:
        # Get related groups
        related_groups = event.models_manager.get_related_groups([group_id])
        
        # Get basic info for each related group
        groups_data = []
        for related_group_id in related_groups:
            related_group = event.models_manager.get_one('groups', related_group_id)
            if related_group:
                groups_data.append({
                    'id': related_group_id,
                    'label': related_group['label'],
                    'face_count': related_group.get('face_count', 0)
                })
        
        return jsonify({"related_groups": groups_data})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/groups/<group_id>/filtered-images", methods=["GET"])
@require_auth
def get_group_filtered_images(event_id, group_id):
    """Get images filtered by group with advanced filtering options."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    include_archived = _parse_include_archived(False)
    group = event.models_manager.get_one('groups', group_id, include_archived)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    
    try:
        # Get query parameters that match frontend expectations
        mode = request.args.get('mode', 'and')
        only = request.args.get('only', 'false').lower() == 'true'
        related_groups = request.args.get('related_groups', '').split(',') if request.args.get('related_groups') else []
        
        # Filter out empty strings
        related_groups = [g for g in related_groups if g]
        
        # Get filtered image IDs using the get_filtered_images method
        if related_groups or only:
            # Use advanced filtering with multiple groups OR when only mode is enabled
            groups_to_filter = [group_id] + related_groups if related_groups else [group_id]
            image_ids = event.models_manager.get_filtered_images(
                groups_to_filter, mode, only, include_archived
            )
        else:
            # Simple case: just get images for this group (when not using only mode)
            image_ids = event.models_manager.get_group_images(group_id, include_archived)
        
        # Build complete image data for each image
        images_data = []
        for image_id in image_ids:
            image_data = build_complete_image_data(event, image_id, include_archived=include_archived)
            if image_data:
                # Update URLs to use event-scoped endpoints
                image_data['urls'] = {
                    'display': f'/api/events/{event_id}/display/{image_id}.webp',
                    'thumbnail': f'/api/events/{event_id}/thumb/{image_id}.webp',
                    'high_quality': f'/api/events/{event_id}/high_quality/{image_id}.webp',
                    'original': f'/api/events/{event_id}/original/{image_id}.webp',
                }
                images_data.append(image_data)
        
        return jsonify({"images": images_data})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments", methods=["GET"])
@require_auth
def get_moments(event_id):
    """List all accessible moments for the specific event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        # Get enriched moments with image information
        enriched_moments = event.models_manager.get_all('moments')
        return jsonify({"moments": enriched_moments})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments/<moment_id>", methods=["GET"])
@require_auth
def get_moment(event_id, moment_id):
    """Get a specific moment by ID if accessible in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        include_archived = _parse_include_archived(False)
        moment = event.models_manager.get_one('moments', moment_id, include_archived)
        if not moment:
            return not_found(f"Moment {moment_id} not found or not accessible")
        return jsonify(moment)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments", methods=["POST"])
@require_auth
def create_moment(event_id):
    """Create a new moment in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    data = request.json or {}
    
    try:
        # Create the moment
        moment_id = event.models_manager.add('moments', data)
        
        # Get the created moment
        include_archived = _parse_include_archived(False)
        created_moment = event.models_manager.get_one('moments', moment_id, include_archived)
        
        # Add change instruction for frontend and include the created moment
        response_data = {"success": True, "moment_id": moment_id, "moment": created_moment}
        response_data = add_change_instruction(response_data, 'MOMENT_CREATED', created_moment)
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments/<moment_id>", methods=["PUT"])
@require_auth
def update_moment(event_id, moment_id):
    """Update a moment if accessible in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        # Check if moment exists and is accessible
        if not event.models_manager.get_one('moments', moment_id):
            return not_found(f"Moment {moment_id} not found or not accessible")
        
        data = request.json or {}
        
        # Update the moment
        event.models_manager.add_images_to_moment(moment_id, data.get('images_to_add', []))
        event.models_manager.remove_images_from_moment(moment_id, data.get('images_to_remove', []))
        # Safely remove optional and computed keys if present
        data.pop('images_to_add', None)
        data.pop('images_to_remove', None)
        data.pop('image_ids', None)
        data.pop('momentID', None)
        # Keep only columns that exist on the moments table
        allowed_fields = {'label', 'description', 'start', 'end', 'representative_image'}
        sanitized = {k: v for k, v in (data or {}).items() if k in allowed_fields}
        if sanitized:
            event.models_manager.edit('moments', moment_id, sanitized)
        
        # Get the updated moment
        include_archived = _parse_include_archived(False)
        updated_moment = event.models_manager.get_one('moments', moment_id, include_archived)
        
        # Add change instruction for frontend and include the updated moment
        response_data = {"success": True, "moment": updated_moment}
        response_data = add_change_instruction(response_data, 'MOMENT_UPDATED', updated_moment)
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments/<moment_id>", methods=["DELETE"])
@require_auth
def delete_moment(event_id, moment_id):
    """Delete a moment if accessible in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        # Check if moment exists and is accessible
        if not event.models_manager.get_one('moments', moment_id):
            return not_found(f"Moment {moment_id} not found or not accessible")
        
        # Delete the moment
        event.models_manager.delete('moments', moment_id)
        
        # Add change instruction for frontend
        response_data = {"success": True}
        response_data = add_change_instruction(response_data, 'MOMENT_DELETED', {"moment_id": moment_id})
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments/<moment_id>/images", methods=["GET"])
@require_auth
def get_moment_images(event_id, moment_id):
    """Get all images in a specific moment within the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        # Check if moment exists and is accessible
        include_archived = _parse_include_archived(False)
        if not event.models_manager.get_one('moments', moment_id, include_archived):
            return not_found(f"Moment {moment_id} not found or not accessible")
        
        # Get image IDs for this moment
        image_ids = event.models_manager.get_moment_images(moment_id, include_archived)
        
        # Get basic image info for each
        images_data = []
        for image_id in image_ids:
            image = event.models_manager.get_one('images', image_id, include_archived)
            if image:
                images_data.append({
                    'id': image_id,
                    'label': image.get('label', ''),
                    'date_taken': image.get('date_taken'),
                    'width': image.get('width'),
                    'height': image.get('height'),
                    'urls': {
                        'display': f'/api/events/{event_id}/display/{image_id}.webp',
                        'thumbnail': f'/api/events/{event_id}/thumb/{image_id}.webp',
                    }
                })
        
        return jsonify({"images": images_data})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/images/<image_id>/faces", methods=["GET"])
@require_auth
def get_image_faces(event_id, image_id):
    """Get all faces detected in a specific image within the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        # Check if image exists and is accessible
        include_archived = _parse_include_archived(False)
        if not event.models_manager.get_one('images', image_id, include_archived):
            return not_found(f"Image {image_id} not found or not accessible")
        
        # Get face IDs for this image
        face_ids = event.models_manager.get_image_faces(image_id, include_archived)
        
        # Build faces data
        faces_data = []
        for face_id in face_ids:
            face = event.models_manager.get_one('faces', face_id)
            if face:
                group = None
                if face.get('groupID'):
                    group = event.models_manager.get_one('groups', face['groupID'])
                
                face_data = {
                    'face_id': face_id,
                    'face_coords': {
                        'Left': face['left'],
                        'Top': face['top'],
                        'Width': face['width'],
                        'Height': face['height']
                    },
                    'group_id': face.get('groupID'),
                    'group_label': group['label'] if group else 'Unknown',
                    'url': f'/api/events/{event_id}/faces/{face_id}.webp'
                }
                faces_data.append(face_data)
        
        return jsonify({"faces": faces_data})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/images/<image_id>/info", methods=["GET"])
@require_auth
def get_image_info(event_id, image_id):
    """Get basic image information within the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        include_archived = _parse_include_archived(False)
        image = event.models_manager.get_one('images', image_id, include_archived)
        if not image:
            return not_found(f"Image {image_id} not found or not accessible")
        
        # Return basic image info
        image_info = {
            'id': image_id,
            'label': image.get('label', ''),
            'date_taken': image.get('date_taken'),
            'file_size': image.get('file_size'),
            'width': image.get('width'),
            'height': image.get('height'),
            'urls': {
                'display': f'/api/events/{event_id}/display/{image_id}.webp',
                'thumbnail': f'/api/events/{event_id}/thumb/{image_id}.webp',
            }
        }
        
        return jsonify(image_info)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/images/<image_id>/complete", methods=["GET"])
@require_auth
def get_image_complete(event_id, image_id):
    """Get complete image data including metadata, faces, and URLs within the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        include_archived = _parse_include_archived(False)
        image_data = build_complete_image_data(event, image_id, include_archived=include_archived)
        if not image_data:
            return not_found(f"Image {image_id} not found or not accessible")
        
        # Update URLs to use event-scoped endpoints
        image_data['urls'] = {
            'display': f'/api/events/{event_id}/display/{image_id}.webp',
            'thumbnail': f'/api/events/{event_id}/thumb/{image_id}.webp',
            'high_quality': f'/api/events/{event_id}/high_quality/{image_id}.webp',
            'original': f'/api/events/{event_id}/original/{image_id}.webp',
        }
        
        return jsonify(image_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/groups/<group_id>/images-complete", methods=["GET"])
@require_auth
def get_group_images_complete(event_id, group_id):
    """Get complete image data for all images in a group within the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    include_archived = _parse_include_archived(False)
    group = event.models_manager.get_one('groups', group_id, include_archived)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    
    # Get image IDs for this group
    image_ids = event.models_manager.get_group_images(group_id, include_archived)
    
    # Build complete image data for each image
    images_data = []
    for image_id in image_ids:
        image_data = build_complete_image_data(event, image_id, include_archived=include_archived)
        if image_data:
            # Update URLs to use event-scoped endpoints
            image_data['urls'] = {
                'display': f'/api/events/{event_id}/display/{image_id}.webp',
                'thumbnail': f'/api/events/{event_id}/thumb/{image_id}.webp',
                'high_quality': f'/api/events/{event_id}/high_quality/{image_id}.webp',
                'original': f'/api/events/{event_id}/original/{image_id}.webp',
            }
            images_data.append(image_data)
    
    return jsonify({"images": images_data})

@app.route("/api/events/<event_id>/moments/<moment_id>/images-complete", methods=["GET"])
@require_auth
def get_moment_images_complete(event_id, moment_id):
    """Get complete image data for all images in a moment within the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        include_archived = _parse_include_archived(False)
        # Check if moment exists and is accessible
        if not event.models_manager.get_one('moments', moment_id, include_archived):
            return not_found(f"Moment {moment_id} not found or not accessible")
        
        # Get image IDs for this moment
        image_ids = event.models_manager.get_moment_images(moment_id, include_archived)
        
        # Build complete image data for each image
        images_data = []
        for image_id in image_ids:
            image_data = build_complete_image_data(event, image_id, include_archived=include_archived)
            if image_data:
                # Update URLs to use event-scoped endpoints
                image_data['urls'] = {
                    'display': f'/api/events/{event_id}/display/{image_id}.webp',
                    'thumbnail': f'/api/events/{event_id}/thumb/{image_id}.webp',
                    'high_quality': f'/api/events/{event_id}/high_quality/{image_id}.webp',
                    'original': f'/api/events/{event_id}/original/{image_id}.webp',
                }
                images_data.append(image_data)
        
        return jsonify({"images": images_data})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/download", methods=["POST"])
@require_auth
def download_images(event_id):
    """Download images as a ZIP file from the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    quality = (data.get('quality') or 'high').lower()
    include_archived = bool(data.get('include_archived', False))
    
    if not image_ids:
        return jsonify({"error": "No image IDs provided"}), 400
    
    try:
        # Create a ZIP file in memory
        memory_file = io.BytesIO()
        with zipfile.ZipFile(memory_file, 'w') as zf:
            for image_id in image_ids:
                # Check if image is accessible
                if not event.models_manager.get_one('images', image_id, include_archived):
                    continue
                
                # Choose source based on requested quality
                if quality == 'original':
                    src_dir = event.original_dir
                else:
                    src_dir = event.high_quality_dir

                # Default to JPG for downloads (project uses WebP for URLs only)
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

@app.route("/api/events/<event_id>/images.json", methods=["GET"])
@require_auth
def get_images_json(event_id):
    """Return accessible images metadata for the event (for frontend compatibility)."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        include_archived = _parse_include_archived(False)
        images = event.models_manager.get_all('images', include_archived)
        
        images_data = []
        for image in images:
            image_data = build_complete_image_data(event, image['imageID'], include_archived=include_archived)
            if image_data:
                # Update URLs to use event-scoped endpoints
                image_data['urls'] = {
                    'display': f'/api/events/{event_id}/display/{image["imageID"]}.webp',
                    'thumbnail': f'/api/events/{event_id}/thumb/{image["imageID"]}.webp',
                    'high_quality': f'/api/events/{event_id}/high_quality/{image["imageID"]}.webp',
                    'original': f'/api/events/{event_id}/original/{image["imageID"]}.webp',
                }
                images_data.append(image_data)
                
        return jsonify({"images": images_data})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/profile/permissions", methods=["GET"])
@require_auth
def get_profile_permissions(event_id):
    """Get permissions for the current profile in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        profile_id = event.get_profile_id()
        if not profile_id:
            return jsonify({
                'all_images': False,
                'can_edit_groups': False,
                'can_upload_images': False,
                'can_edit_moments': False,
                'accessible_image_IDs': []
            })
        
        profile = event.models_manager.get_one('profiles', profile_id)
        if not profile:
            return jsonify({
                'all_images': False,
                'can_edit_groups': False,
                'can_upload_images': False,
                'can_edit_moments': False,
                'accessible_image_IDs': []
            })
        
        return jsonify(profile)
    except Exception as e:
        return bad_request(e)

# Events endpoint
@app.route("/api/events", methods=["GET"])
def get_events():
    """Get all available events."""
    try:
        from src.core.models.event import list_events
        events = list_events()
        # Return only public event information (no sensitive data)
        public_events = []
        for event in events:
            public_events.append({
                'id': event.id,
                'name': event.name,
                'url': event.url,
                'date': event.date
            })
        return jsonify(public_events)
    except Exception as e:
        return bad_request(e)

# Legacy endpoints (for backward compatibility - should be deprecated)
@app.route("/api/groups", methods=["GET"])
@require_auth
def get_groups_legacy():
    """Legacy endpoint - redirects to event-scoped version."""
    return get_groups(FIXED_EVENT_ID)

@app.route("/api/images/<image_id>/complete", methods=["GET"])
@require_auth
def get_image_complete_legacy(image_id):
    """Legacy endpoint - redirects to event-scoped version."""
    return get_image_complete(FIXED_EVENT_ID, image_id)

@app.route("/api/images.json", methods=["GET"])
def get_images_json_legacy():
    """Legacy endpoint - redirects to event-scoped version."""
    return get_images_json(FIXED_EVENT_ID)

@app.route('/api/events/<event_id>/display/<image_id>.webp')
@require_auth
def get_display_image_webp(event_id, image_id):
    event = Event(event_id)
    if not event.models_manager.get_one('images', image_id, include_archived=True):
        return abort(404)
    file_path = os.path.join(event.display_dir, f'{image_id}.webp')
    if not os.path.exists(file_path):
        return abort(404)
    resp = make_response(send_file(file_path, mimetype='image/webp'))
    resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp

@app.route('/api/events/<event_id>/faces/<face_id>.webp')
@require_auth
def get_face_crop_webp(event_id, face_id):
    event = Event(event_id)
    face = event.models_manager.get_one('faces', face_id, include_archived=True)
    if not face:
        return abort(404)
    file_path = os.path.join(event.faces_dir, f'{face_id}.webp')
    if not os.path.exists(file_path):
        return abort(404)
    resp = make_response(send_file(file_path, mimetype='image/webp'))
    resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp

@app.route('/api/events/<event_id>/thumb/<image_id>.webp')
@require_auth
def get_thumbnail_image_webp(event_id, image_id):
    event = Event(event_id)
    if not event.models_manager.get_one('images', image_id, include_archived=True):
        return abort(403)
    file_path = os.path.join(event.thumb_dir, f'{image_id}.webp')
    if not os.path.exists(file_path):
        return abort(404)
    resp = make_response(send_file(file_path, mimetype='image/webp'))
    resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp

@app.route('/api/events/<event_id>/high_quality/<image_id>.webp')
@require_auth
def get_high_quality_image_webp(event_id, image_id):
    event = Event(event_id)
    if not event.models_manager.get_one('images', image_id, include_archived=True):
        return abort(403)
    file_path = os.path.join(event.high_quality_dir, f'{image_id}.webp')
    if not os.path.exists(file_path):
        return abort(404)
    resp = make_response(send_file(file_path, mimetype='image/webp'))
    resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp

@app.route('/api/events/<event_id>/original/<image_id>.webp')
@require_auth
def get_original_image_webp(event_id, image_id):
    event = Event(event_id)
    if not event.models_manager.get_one('images', image_id, include_archived=True):
        return abort(403)
    file_path = os.path.join(event.original_dir, f'{image_id}.webp')
    if not os.path.exists(file_path):
        return abort(404)
    resp = make_response(send_file(file_path, mimetype='image/webp'))
    resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp

@app.route("/api/events/<event_id>/groups/<group_id>/representative", methods=["GET"])
@require_auth
def get_group_representative(event_id, group_id):
    """Get the representative face for a group within the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    include_archived = _parse_include_archived(False)
    group = event.models_manager.get_one('groups', group_id, include_archived)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    
    representative_face_id = group.get('representative_face')
    if not representative_face_id:
        return jsonify({"representative_face": None})
    
    # Get the face data
    face = event.models_manager.get_one('faces', representative_face_id, include_archived)
    if not face:
        return jsonify({"representative_face": None})
    
    # Return face data with image context
    face_data = {
        'face_id': representative_face_id,
        'image_id': face['imageID'],
        'face_coords': {
            'Left': face['left'],
            'Top': face['top'],
            'Width': face['width'],
            'Height': face['height']
        },
        'url': f'/api/events/{event_id}/faces/{representative_face_id}.webp'
    }
    
    return jsonify({"representative_face": face_data})

@app.route("/api/events/<event_id>/moments/<moment_id>/representative", methods=["GET"])
@require_auth
def get_moment_representative(event_id, moment_id):
    """Get the representative image for a moment within the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    include_archived = _parse_include_archived(False)
    moment = event.models_manager.get_one('moments', moment_id, include_archived)
    if not moment:
        return not_found(f"Moment {moment_id} not found or not accessible")
    
    representative_image_id = moment.get('representative_image')
    if not representative_image_id:
        return jsonify({"representative_image": None})
    
    # Get the image data
    image = event.models_manager.get_one('images', representative_image_id)
    if not image:
        return jsonify({"representative_image": None})
    
    # Return image data
    image_data = {
        'id': representative_image_id,
        'label': image.get('label', ''),
        'date_taken': image.get('date_taken'),
        'width': image.get('width'),
        'height': image.get('height'),
        'urls': {
            'display': f'/api/events/{event_id}/display/{representative_image_id}.webp',
            'thumbnail': f'/api/events/{event_id}/thumb/{representative_image_id}.webp',
            'high_quality': f'/api/events/{event_id}/high_quality/{representative_image_id}.webp',
            'original': f'/api/events/{event_id}/original/{representative_image_id}.webp',
        }
    }
    
    return jsonify({"representative_image": image_data})

if __name__ == "__main__":
    app.run(debug=True)
