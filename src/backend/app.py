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
def build_complete_photo_data(event, image_id, include_all_faces=True, group_filter=None):
    """Build complete photo data with all related information."""
    try:
        image = event.images_model.get(image_id)
        if not image:
            return None
        
        # Get face IDs for this image
        face_ids = event.images_model.get_faces(image_id)
        
        # Build faces data
        faces_data = []
        for face_id in face_ids:
            face = event.faces_model.get(face_id)
            if face:
                # Apply group filter if specified
                if group_filter and face.get('groupID') != group_filter:
                    continue
                
                group = None
                if face.get('groupID'):
                    group = event.groups_model.get(face['groupID'])
                
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
                    'group_representative': group.get('face_representative') if group else None
                }
                faces_data.append(face_data)
        
        # Get moment info if available
        moment_info = None
        if image.get('momentID'):
            moment = event.moments_model.get(image['momentID'])
            if moment:
                moment_info = {
                    'id': moment['id'],
                    'title': moment['title'],
                    'description': moment.get('description', ''),
                    'start': moment.get('start'),
                }
        
        # Build complete response
        photo_data = {
            'id': image_id,
            'name': image['name'],
            'date_taken': image.get('date_taken'),
            'file_size': image.get('file_size'),
            'width': image.get('width'),
            'height': image.get('height'),
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
        
        return photo_data
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

@app.route("/api/groups", methods=["GET"])
@require_auth
def get_groups():
    """List all accessible groups for the event."""
    event = get_event_with_profile()
    groups = event.groups_model.list()
    return jsonify(groups)

@app.route("/api/groups/<group_id>", methods=["GET"])
@require_auth
def get_group(group_id):
    """Get a specific group by ID if accessible."""
    event = get_event_with_profile()
    group = event.groups_model.get(group_id)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    return jsonify(group)

@app.route("/api/groups/<group_id>", methods=["PUT"])
@require_auth
def update_group(group_id):
    """Update a group's label or representative if accessible."""
    event = get_event_with_profile()
    
    # Check if group is accessible
    if not event.groups_model.get(group_id):
        return not_found(f"Group {group_id} not found or not accessible")
    
    data = request.json or {}
    
    try:
        event.groups_model.edit(group_id, data)
        
        # Get the group after update
        updated = event.groups_model.get(group_id)
        
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

@app.route("/api/groups/check-name", methods=["POST"])
@require_auth
def check_group_name():
    """Check if a group name already exists and return conflict info."""
    event = get_event_with_profile()
    data = request.json or {}
    label = data.get('label', '')
    exclude_group_id = data.get('exclude_group_id', '')
    
    if not label:
        return jsonify({"error": "Label is required"}), 400
    
    try:
        conflict_info = event.groups_model.check_name_conflict(label, exclude_group_id)
        return jsonify(conflict_info)
    except Exception as e:
        return bad_request(e)

@app.route("/api/groups/<group_id>", methods=["DELETE"])
@require_auth
def delete_group(group_id):
    """Delete a group if accessible."""
    event = get_event_with_profile()
    
    # Check if group is accessible
    if not event.groups_model.get(group_id):
        return not_found(f"Group {group_id} not found or not accessible")
    
    try:
        event.groups_model.delete(group_id)
        response_data = add_change_instruction({"success": True}, 'GROUP_DELETED', {"groupID": group_id})
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)



@app.route("/api/groups/transfer-faces", methods=["POST"])
@require_auth
def transfer_faces():
    """Transfer faces from one group to another or create a new group."""
    event = get_event_with_profile()
    data = request.json or {}
    
    try:
        # Validate required fields
        if 'old_group_id' not in data:
            return bad_request("Missing old_group_id")
        if 'face_ids' not in data:
            return bad_request("Missing face_ids")
        if not data['face_ids']:
            return bad_request("face_ids cannot be empty")
        
        result = event.transfer_faces(
            old_group_id=data['old_group_id'],
            face_ids=data['face_ids'],
            target_group_id=data.get('target_group_id'),
            new_group_name=data.get('new_group_name')
        )
        # Add old_group_id to the response for frontend updates
        result['old_group_id'] = data['old_group_id']
        
        # Add change instruction for frontend with explicit change data
        change_data = {
            'target_group_id': result.get('target_group_id'),
            'old_group_id': data['old_group_id'],
            'old_group_deleted': result.get('old_group_deleted', False),
            'transferred_faces': result.get('transferred_faces', []),
            'photos_to_remove_from_source': result.get('photos_to_remove_from_source', []),
            'photos_to_add_to_target': result.get('photos_to_add_to_target', []),
            'transferred_photos_data': [],  # Will be populated with full photo data
            'updated_source_group': result.get('updated_source_group'),  # Include updated source group with new representative
            'updated_target_group': result.get('updated_target_group'),  # Include updated target group
            'photos_to_add_to_grid': result.get('photos_to_add_to_grid'),  # New field for full transfer
        }
        # Debug: print the face representative of the updated target group being sent to frontend
        if result.get('updated_target_group'):
            print(f"[DEBUG] /api/groups/transfer-faces: updated_target_group face_representative: {result['updated_target_group'].get('face_representative')}")
        
        # Include new group name if a new group was created
        if 'new_group_name' in result:
            change_data['new_group_name'] = result['new_group_name']
        
        # Only include photo data for images that are actually being added to the target group
        moved_photos = set(result.get('photos_to_remove_from_source', []))
        photos_to_add_to_target = set(result.get('photos_to_add_to_target', []))
        for photo_id in moved_photos.union(photos_to_add_to_target):
            photo_data = build_complete_photo_data(event, photo_id)
            if photo_data:
                change_data['transferred_photos_data'].append(photo_data)
        
        # Also include updated photo data for photos that contain transferred faces but weren't moved
        # This is needed for PhotoViewer to update face data without reloading
        transferred_faces = result.get('transferred_faces', [])
        if transferred_faces:
            # Get all images that contain the transferred faces
            face_image_query = '''
                SELECT DISTINCT imageID 
                FROM faces 
                WHERE faceID IN ({})
            '''.format(','.join(['?'] * len(transferred_faces)))
            
            face_image_results = event.db.execute_query(face_image_query, transferred_faces)
            face_image_ids = [row[0] for row in face_image_results]
            
            # Get full photo data for these images
            for photo_id in face_image_ids:
                photo_data = build_complete_photo_data(event, photo_id)
                if photo_data:
                    change_data['transferred_photos_data'].append(photo_data)
        
        response_data = add_change_instruction({"success": True}, 'GROUP_FACES_TRANSFERRED', change_data)
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/groups/<group_id>/photos", methods=["GET"])
@require_auth
def get_group_photos(group_id):
    """List all accessible photos for a group, with optional sorting."""
    event = get_event_with_profile()
    group = event.groups_model.get(group_id)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    
    # Get all images for the group, but filter by accessible images
    all_image_ids = event.groups_model.get_images(group_id)
    accessible_image_ids = [img_id for img_id in all_image_ids if event.images_model.get(img_id)]
    
    return jsonify({"photos": accessible_image_ids})

@app.route("/api/groups/<group_id>/crops", methods=["GET"])
@require_auth
def get_group_crops(group_id):
    """Get crop mapping for a group."""
    event = get_event_with_profile()
    group = event.groups_model.get(group_id)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    
    crop_mapping = event.get_crop_mapping(group_id)
    return jsonify({"crops": crop_mapping})

@app.route("/api/groups/<group_id>/related-groups", methods=["GET"])
@require_auth
def get_related_groups(group_id):
    """Get groups that share images with the given group."""
    event = get_event_with_profile()
    group = event.groups_model.get(group_id)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    
    # Use the new get_related_groups method with just the main group
    related_group_ids = event.get_related_groups([group_id])
    
    # Get the actual group data for related groups
    related_groups = []
    for related_group_id in related_group_ids:
        if related_group_id != group_id:  # Skip main group
            group_data = event.groups_model.get(related_group_id)
            if group_data:
                related_groups.append(group_data)
    
    return jsonify({"related_groups": related_groups})

@app.route("/api/groups/<group_id>/filtered-photos", methods=["GET"])
@require_auth
def get_filtered_photos(group_id):
    """Get filtered photos based on filter criteria."""
    event = get_event_with_profile()
    group = event.groups_model.get(group_id)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    
    # Get query parameters
    mode = request.args.get('mode', 'and')
    only = request.args.get('only', 'false').lower() == 'true'
    related_groups_str = request.args.get('related_groups', '')
    current_photo_ids_str = request.args.get('current_photo_ids', '')
    
    current_photo_ids = set(current_photo_ids_str.split(',')) if current_photo_ids_str else set()

    # Start with the main group
    all_groups = [group_id]
    
    # Add related groups if any are provided
    if related_groups_str:
        related_groups = related_groups_str.split(',')
        # Filter out empty strings and duplicates, including the main group
        all_groups.extend([g for g in related_groups if g and g != group_id])
        
    # Get filtered image IDs using the new logic
    filtered_image_ids = set(event.get_filtered_images(all_groups, mode, only))
    
    # Calculate photos to add and remove
    photo_ids_to_add = list(filtered_image_ids - current_photo_ids)
    photo_ids_to_remove = list(current_photo_ids - filtered_image_ids)

    # Get related groups sorted by co-occurrence
    all_related_groups_ids = event.get_related_groups(all_groups, mode, only)
    
    # Get full group data for the sorted related groups
    all_related_groups_data = []
    for r_group_id in all_related_groups_ids:
        group_data = event.groups_model.get(r_group_id)
        if group_data:
            all_related_groups_data.append(group_data)
            
    # Build complete photo data for photos to be added
    photos_to_add_data = []
    for image_id in photo_ids_to_add:
        photo_data = build_complete_photo_data(event, image_id)
        if photo_data:
            photos_to_add_data.append(photo_data)
    
    return jsonify({
        "photos_to_add": photos_to_add_data,
        "photo_ids_to_remove": photo_ids_to_remove,
        "related_groups": all_related_groups_data,
    })

@app.route("/api/moments", methods=["GET"])
@require_auth
def get_moments():
    """List all accessible moments for the event."""
    event = get_event_with_profile()
    try:
        moments = event.moments_model.list()
        return jsonify({"moments": moments})
    except Exception as e:
        return bad_request(e)

@app.route("/api/moments", methods=["POST"])
@require_auth
def create_moment():
    """Create a new moment."""
    event = get_event_with_profile()
    data = request.json or {}
    try:
        moment = event.moments_model.add(**data)
        response_data = add_change_instruction({"moment": moment}, 'MOMENT_CREATED', moment)
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/moments/<moment_id>", methods=["PUT"])
@require_auth
def update_moment(moment_id):
    """Update a moment if accessible."""
    event = get_event_with_profile()
    
    # Check if moment is accessible
    if not event.moments_model.get(moment_id):
        return not_found(f"Moment {moment_id} not found or not accessible")
    
    data = request.json or {}
    try:
        event.moments_model.edit(moment_id, data)
        updated = event.moments_model.get(moment_id)
        response_data = add_change_instruction({"moment": updated}, 'MOMENT_UPDATED', updated)
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/moments/<moment_id>", methods=["DELETE"])
@require_auth
def delete_moment(moment_id):
    """Delete a moment if accessible."""
    event = get_event_with_profile()
    
    # Check if moment is accessible
    if not event.moments_model.get(moment_id):
        return not_found(f"Moment {moment_id} not found or not accessible")
    
    try:
        event.moments_model.delete(moment_id)
        response_data = add_change_instruction({"success": True}, 'MOMENT_DELETED', {"id": moment_id})
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/moments/<moment_id>/photos", methods=["GET"])
@require_auth
def get_moment_photos(moment_id):
    """List all accessible photos in a moment."""
    event = get_event_with_profile()
    
    # Check if moment is accessible
    if not event.moments_model.get(moment_id):
        return not_found(f"Moment {moment_id} not found or not accessible")
    
    try:
        all_image_ids = event.moments_model.get_images(moment_id)
        accessible_image_ids = [img_id for img_id in all_image_ids if event.images_model.get(img_id)]
        return jsonify({"photos": accessible_image_ids})
    except Exception as e:
        return bad_request(e)

@app.route("/api/moments/<moment_id>/photos-in-period", methods=["GET"])
@require_auth
def get_moment_photos_in_period(moment_id):
    """Get photos in a time period for a moment (stub for now)."""
    event = get_event_with_profile()
    try:
        # TODO: Implement logic to get photos within moment's time range
        return jsonify({"photos": []})
    except Exception as e:
        return bad_request(e)

@app.route("/api/photos/<image_id>/faces", methods=["GET"])
@require_auth
def get_photo_faces(image_id):
    """Get face bounding boxes for a photo."""
    event = get_event_with_profile()
    
    # Get face IDs for this image
    face_ids = event.images_model.get_faces(image_id)
    
    # Build faces data
    faces_data = []
    for face_id in face_ids:
        face = event.faces_model.get(face_id)
        if face:
            # Get group information
            group = None
            if face.get('groupID'):
                group = event.groups_model.get(face['groupID'])
            
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
                'group_representative': group.get('face_representative') if group else None
            }
            faces_data.append(face_data)
    
    return jsonify({"faces": faces_data})

@app.route("/api/photos/<image_id>/info", methods=["GET"])
@require_auth
def get_photo_info(image_id):
    """Get metadata for a photo."""
    event = get_event_with_profile()
    try:
        image = event.images_model.get(image_id)
        if not image:
            return not_found(f"Image {image_id} not found or not accessible")
        return jsonify(image)
    except Exception as e:
        return bad_request(e)

@app.route("/api/photos/<image_id>/complete", methods=["GET"])
@require_auth
def get_photo_complete(image_id):
    """Get complete photo data including metadata, faces, and URLs."""
    event = get_event_with_profile()
    try:
        photo_data = build_complete_photo_data(event, image_id)
        if not photo_data:
            return not_found(f"Image {image_id} not found or not accessible")
        return jsonify(photo_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/groups/<group_id>/photos-complete", methods=["GET"])
@require_auth
def get_group_photos_complete(group_id):
    """Get complete photo data for all photos in a group."""
    event = get_event_with_profile()
    group = event.groups_model.get(group_id)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    
    # Get image IDs for this group
    image_ids = event.groups_model.get_images(group_id)
    
    # Build complete photo data for each image
    photos_data = []
    for image_id in image_ids:
        photo_data = build_complete_photo_data(event, image_id)
        if photo_data:
            photos_data.append(photo_data)
    
    return jsonify({"photos": photos_data})

@app.route("/api/moments/<moment_id>/photos-complete", methods=["GET"])
@require_auth
def get_moment_photos_complete(moment_id):
    """Get complete photo data for all photos in a moment."""
    event = get_event_with_profile()
    try:
        # Get image IDs for this moment
        image_ids = event.moments_model.get_images(moment_id)
        
        # Build complete photo data for each image
        photos_data = []
        for image_id in image_ids:
            photo_data = build_complete_photo_data(event, image_id)
            if photo_data:
                photos_data.append(photo_data)
        
        return jsonify({"photos": photos_data})
    except Exception as e:
        return bad_request(e)

@app.route("/api/download", methods=["POST"])
@require_auth
def download_images():
    """Download images as a ZIP file."""
    event = get_event_with_profile()
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    
    if not image_ids:
        return jsonify({"error": "No image IDs provided"}), 400
    
    try:
        # Create a ZIP file in memory
        memory_file = io.BytesIO()
        with zipfile.ZipFile(memory_file, 'w') as zf:
            for image_id in image_ids:
                # Check if image is accessible
                if not event.images_model.get(image_id):
                    continue
                
                # Add high quality image to ZIP
                high_quality_path = os.path.join(event.high_quality_dir, f"{image_id}.jpg")
                if os.path.exists(high_quality_path):
                    zf.write(high_quality_path, f"{image_id}.jpg")
        
        memory_file.seek(0)
        return send_file(
            memory_file,
            mimetype='application/zip',
            as_attachment=True,
            download_name='images.zip'
        )
    except Exception as e:
        return bad_request(e)

@app.route("/api/images.json", methods=["GET"])
def get_images_json():
    """Return accessible images metadata (for frontend compatibility)."""
    event = get_event_with_profile()
    try:
        images = event.images_model.list()
        return jsonify({"images": images})
    except Exception as e:
        return bad_request(e)

@app.route("/api/profile/permissions", methods=["GET"])
@require_auth
def get_profile_permissions():
    """Get permissions for the current profile."""
    event = get_event_with_profile()
    try:
        profile_id = event.get_profile_id()
        if not profile_id:
            return jsonify({
                'all_images': False,
                'can_edit_groups': False,
                'can_upload_photos': False,
                'can_edit_moments': False,
                'accessible_image_IDs': []
            })
        
        profile = event.profile_model.get(profile_id)
        if not profile:
            return jsonify({
                'all_images': False,
                'can_edit_groups': False,
                'can_upload_photos': False,
                'can_edit_moments': False,
                'accessible_image_IDs': []
            })
        
        return jsonify(profile)
    except Exception as e:
        return bad_request(e)

@app.route('/api/events/<event_id>/display/<image_id>.webp')
@require_auth
def get_display_image_webp(event_id, image_id):
    event = Event(event_id)
    profile_id = g.profile_id
    if image_id not in event.profile_model.get_accessible_images(profile_id):
        return abort(403)
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
    profile_id = g.profile_id
    face = event.faces_model.get(face_id)
    if not face:
        return abort(404)
    image_id = face['imageID']
    if image_id not in event.profile_model.get_accessible_images(profile_id):
        return abort(403)
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
    profile_id = g.profile_id
    if image_id not in event.profile_model.get_accessible_images(profile_id):
        return abort(403)
    file_path = os.path.join(event.thumb_dir, f'{image_id}.webp')
    if not os.path.exists(file_path):
        return abort(404)
    resp = make_response(send_file(file_path, mimetype='image/webp'))
    resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp

@app.route('/api/events/<event_id>/original/<image_id>.webp')
@require_auth
def get_original_image_webp(event_id, image_id):
    event = Event(event_id)
    profile_id = g.profile_id
    if image_id not in event.profile_model.get_accessible_images(profile_id):
        return abort(403)
    file_path = os.path.join(event.original_dir, f'{image_id}.webp')
    if not os.path.exists(file_path):
        return abort(404)
    resp = make_response(send_file(file_path, mimetype='image/webp'))
    resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp

if __name__ == "__main__":
    app.run(debug=True)
