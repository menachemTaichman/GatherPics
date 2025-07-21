from flask import Flask, jsonify, request, g, send_file, abort, make_response
from flask_cors import CORS
from functools import wraps
import traceback
import os
import io
import zipfile

from src.core.models.event import Event
# from src.core.models.profile import Profiles  # If needed for permissions

app = Flask(__name__)
CORS(app)

# --- Placeholder values for now ---
FIXED_EVENT_ID = "75cb6635-879d-4386-b023-366444dc0fb2"
FIXED_PROFILE_ID = "89cb4967-0eba-48af-99cc-5e87407fb639"

# --- Utility Functions ---
def build_complete_photo_data(event, image_id, include_all_faces=True, group_filter=None):
    """Build complete photo data including metadata, faces, and URLs."""
    try:
        # Get basic image info
        image = event.images_model.get(image_id)
        if not image:
            return None
        
        # Get face data
        face_ids = event.images_model.get_faces(image_id)
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
                    'group_representative': group.get('face_representive') if group else None
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
                    'end': moment.get('end')
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
    """List all  groups for the event."""
    event = Event(FIXED_EVENT_ID)
    groups = event.groups_model.list()
    return jsonify(groups)

@app.route("/api/groups/<group_id>", methods=["PUT"])
@require_auth
def update_group(group_id):
    """Update a group's label or representative."""
    event = Event(FIXED_EVENT_ID)
    data = request.json or {}
    try:
        event.groups_model.edit(group_id, data)
        updated = event.groups_model.get(group_id)
        return jsonify(updated)
    except Exception as e:
        return bad_request(e)

@app.route("/api/groups/<group_id>", methods=["DELETE"])
@require_auth
def delete_group(group_id):
    """Delete a group."""
    event = Event(FIXED_EVENT_ID)
    try:
        event.groups_model.delete(group_id)
        return jsonify({"success": True})
    except Exception as e:
        return bad_request(e)

@app.route("/api/groups/merge", methods=["POST"])
@require_auth
def merge_groups():
    """Merge multiple groups into a target group."""
    event = Event(FIXED_EVENT_ID)
    data = request.json or {}
    try:
        event.groups_model.merge_groups(data['source_group_ids'], data['target_group_id'])
        return jsonify({"success": True})
    except Exception as e:
        return bad_request(e)

@app.route("/api/groups/<group_id>/photos", methods=["GET"])
@require_auth
def get_group_photos(group_id):
    """List all photos for a group, with optional sorting."""
    event = Event(FIXED_EVENT_ID)
    group = event.groups_model.get(group_id)
    if not group:
        return not_found(f"Group {group_id} not found")
    image_ids = event.groups_model.get_images(group_id)
    return jsonify({"photos": image_ids})

@app.route("/api/groups/<group_id>/crops", methods=["GET"])
@require_auth
def get_group_crops(group_id):
    """Get list of face crop filenames for a group."""
    event = Event(FIXED_EVENT_ID)
    group = event.groups_model.get(group_id)
    if not group:
        return not_found(f"Group {group_id} not found")
    face_ids = event.groups_model.get_faces(group_id)
    
    return jsonify({"face_ids": face_ids})

@app.route("/api/moments", methods=["GET"])
@require_auth
def get_moments():
    """List all moments for the event."""
    event = Event(FIXED_EVENT_ID)
    try:
        moments = event.moments_model.list()
        return jsonify({"moments": moments})
    except Exception as e:
        return bad_request(e)

@app.route("/api/moments", methods=["POST"])
@require_auth
def create_moment():
    """Create a new moment."""
    event = Event(FIXED_EVENT_ID)
    data = request.json or {}
    try:
        moment = event.moments_model.add(data['label'], data['description'], data['start'], data['end'], data['image_IDs'])
        return jsonify({"moment": moment})
    except Exception as e:
        return bad_request(e)

@app.route("/api/moments/<moment_id>", methods=["PUT"])
@require_auth
def update_moment(moment_id):
    """Update a moment."""
    event = Event(FIXED_EVENT_ID)
    data = request.json or {}
    try:
        event.moments_model.edit(moment_id, data)
        updated = event.moments_model.get(moment_id)
        return jsonify({"moment": updated})
    except Exception as e:
        return bad_request(e)

@app.route("/api/moments/<moment_id>", methods=["DELETE"])
@require_auth
def delete_moment(moment_id):
    """Delete a moment."""
    event = Event(FIXED_EVENT_ID)
    try:
        event.moments_model.delete(moment_id)
        return jsonify({"success": True})
    except Exception as e:
        return bad_request(e)

@app.route("/api/moments/<moment_id>/photos", methods=["GET"])
@require_auth
def get_moment_photos(moment_id):
    """List all photos in a moment."""
    event = Event(FIXED_EVENT_ID)
    try:
        image_ids = event.moments_model.get_images(moment_id)
        return jsonify({"photos": image_ids})
    except Exception as e:
        return bad_request(e)

@app.route("/api/moments/<moment_id>/photos-in-period", methods=["GET"])
@require_auth
def get_moment_photos_in_period(moment_id):
    """Get photos in a time period for a moment (stub for now)."""
    event = Event(FIXED_EVENT_ID)
    try:
        # TODO: Implement logic to get photos within moment's time range
        # For now, return empty list
        return jsonify({"photos": []})
    except Exception as e:
        return bad_request(e)

@app.route("/api/photos/<image_id>/faces", methods=["GET"])
@require_auth
def get_photo_faces(image_id):
    """Get face bounding boxes for a photo."""
    event = Event(FIXED_EVENT_ID)
    
    # Get face IDs for this image
    face_ids = event.images_model.get_faces(image_id)
    
    # Get complete face data with group information
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
                'group_representative': group.get('face_representive') if group else None
            }
            faces_data.append(face_data)
    
    return jsonify({"faces": faces_data})

@app.route("/api/photos/<image_id>/info", methods=["GET"])
@require_auth
def get_photo_info(image_id):
    """Get metadata for a photo."""
    event = Event(FIXED_EVENT_ID)
    try:
        image = event.images_model.get(image_id)
        if not image:
            return not_found(f"Image {image_id} not found")
        return jsonify(image)
    except Exception as e:
        return bad_request(e)

@app.route("/api/photos/<image_id>/complete", methods=["GET"])
@require_auth
def get_photo_complete(image_id):
    """Get complete photo data including metadata, faces, and URLs."""
    event = Event(FIXED_EVENT_ID)
    try:
        photo_data = build_complete_photo_data(event, image_id)
        if not photo_data:
            return not_found(f"Image {image_id} not found")
        return jsonify(photo_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/groups/<group_id>/photos-complete", methods=["GET"])
@require_auth
def get_group_photos_complete(group_id):
    """Get complete photo data for all photos in a group."""
    event = Event(FIXED_EVENT_ID)
    group = event.groups_model.get(group_id)
    if not group:
        return not_found(f"Group {group_id} not found")
    
    # Get image IDs for this group
    image_ids = event.groups_model.get_images(group_id)
    
    # Get complete photo data for each image (filtered to this group)
    photos_data = []
    for image_id in image_ids:
        photo_data = build_complete_photo_data(event, image_id, group_filter=group_id)
        if photo_data:
            photos_data.append(photo_data)
    
    return jsonify({"photos": photos_data})

@app.route("/api/moments/<moment_id>/photos-complete", methods=["GET"])
@require_auth
def get_moment_photos_complete(moment_id):
    """Get complete photo data for all photos in a moment."""
    event = Event(FIXED_EVENT_ID)
    try:
        # Get image IDs for this moment
        image_ids = event.moments_model.get_images(moment_id)
        
        # Get complete photo data for each image
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
    """Download a zip of images specified in the request body (list of image IDs, and event_id)."""
    data = request.json or {}
    event_id = data.get('event_id')
    image_ids = data.get('images', [])
    if not event_id or not isinstance(image_ids, list):
        return bad_request("Missing event_id or images list")
    event = Event(event_id)
    profile_id = g.profile_id
    allowed_files = []
    for image_id in image_ids:
        # Check access
        if hasattr(event, 'profile_model') and image_id not in event.profile_model.get_accessible_images(profile_id):
            continue
        file_path = os.path.join(event.high_quality_dir, f'{image_id}.jpg')
        if os.path.exists(file_path):
            allowed_files.append((image_id, file_path))
    if not allowed_files:
        return abort(403)
    # Create zip in memory
    mem_zip = io.BytesIO()
    with zipfile.ZipFile(mem_zip, mode='w', compression=zipfile.ZIP_DEFLATED) as zf:
        for image_id, file_path in allowed_files:
            arcname = f'{image_id}.jpg'
            zf.write(file_path, arcname=arcname)
    mem_zip.seek(0)
    return send_file(mem_zip, mimetype='application/zip', as_attachment=True, download_name='photos.zip')

@app.route("/api/images.json", methods=["GET"])
def get_images_json():
    """Return images metadata (for frontend compatibility)."""
    event = Event(FIXED_EVENT_ID)
    try:
        images = event.images_model.list()
        return jsonify({"images": images})
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
