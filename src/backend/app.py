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
                    'id': moment.get('momentID', moment.get('id', 'Unknown')),
                    'title': moment.get('label', 'Unknown'),  # Always use 'label' from database
                    'description': moment.get('description', ''),
                    'start': moment.get('start'),
                    'end': moment.get('end'),
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

# Event-scoped endpoints (recommended pattern)
@app.route("/api/events/<event_id>/groups", methods=["GET"])
@require_auth
def get_groups(event_id):
    """List all accessible groups for the specific event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    groups = event.groups_model.list()
    return jsonify({"groups": groups})

@app.route("/api/events/<event_id>/groups/<group_id>", methods=["GET"])
@require_auth
def get_group(event_id, group_id):
    """Get a specific group by ID if accessible in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    group = event.groups_model.get(group_id)
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
        conflicts = event.groups_model.check_name_conflicts(label, exclude_group_id)
        
        if conflicts:
            return jsonify({
                "has_conflicts": True,
                "conflicts": conflicts,
                "suggestions": event.groups_model.generate_name_suggestions(label, conflicts)
            })
        else:
            return jsonify({"has_conflicts": False, "conflicts": []})
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
        group = event.groups_model.get(group_id)
        if not group:
            return not_found(f"Group {group_id} not found or not accessible")
        
        # Delete the group
        event.groups_model.delete(group_id)
        
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
    
    if not all([source_group_id, target_group_id, face_ids]):
        return jsonify({"error": "source_group_id, target_group_id, and face_ids are required"}), 400
    
    try:
        # Validate groups exist and are accessible
        source_group = event.groups_model.get(source_group_id)
        target_group = event.groups_model.get(target_group_id)
        
        if not source_group or not target_group:
            return not_found("One or both groups not found or not accessible")
        
        # Transfer faces
        transferred_count = event.groups_model.transfer_faces(source_group_id, target_group_id, face_ids)
        
        # Get updated groups
        updated_source = event.groups_model.get(source_group_id)
        updated_target = event.groups_model.get(target_group_id)
        
        # Add change instructions for frontend
        response_data = {"success": True, "transferred_count": transferred_count}
        response_data = add_change_instruction(response_data, 'GROUP_UPDATED', updated_source)
        response_data = add_change_instruction(response_data, 'GROUP_UPDATED', updated_target)
        
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/groups/<group_id>/photos", methods=["GET"])
@require_auth
def get_group_photos(event_id, group_id):
    """Get all photos containing faces from a specific group in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    group = event.groups_model.get(group_id)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    
    try:
        # Get image IDs for this group
        image_ids = event.groups_model.get_images(group_id)
        
        # Get basic image info for each
        images_data = []
        for image_id in image_ids:
            image = event.images_model.get(image_id)
            if image:
                images_data.append({
                    'id': image_id,
                    'name': image['name'],
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
    
    group = event.groups_model.get(group_id)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    
    try:
        # Get face IDs for this group
        face_ids = event.groups_model.get_faces(group_id)
        
        # Get face data for each
        faces_data = []
        for face_id in face_ids:
            face = event.faces_model.get(face_id)
            if face:
                faces_data.append({
                    'face_id': face_id,
                    'image_id': face['imageID'],
                    'face_coords': {
                        'Left': face['left'],
                        'Top': face['top'],
                        'Width': face['width'],
                        'Height': face['height']
                    },
                    'url': f'/api/events/{event_id}/faces/{face_id}.webp'
                })
        
        return jsonify({"faces": faces_data})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/groups/<group_id>/related-groups", methods=["GET"])
@require_auth
def get_related_groups(event_id, group_id):
    """Get groups that share photos with the specified group in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    group = event.groups_model.get(group_id)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    
    try:
        # Get related groups
        related_groups = event.groups_model.get_related_groups(group_id)
        
        # Get basic info for each related group
        groups_data = []
        for related_group_id in related_groups:
            related_group = event.groups_model.get(related_group_id)
            if related_group:
                groups_data.append({
                    'id': related_group_id,
                    'label': related_group['label'],
                    'face_count': related_group.get('face_count', 0)
                })
        
        return jsonify({"related_groups": groups_data})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/groups/<group_id>/filtered-photos", methods=["GET"])
@require_auth
def get_group_filtered_photos(event_id, group_id):
    """Get photos filtered by group with pagination and search in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    group = event.groups_model.get(group_id)
    if not group:
        return not_found(f"Group {group_id} not found or not accessible")
    
    try:
        # Get query parameters
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 20))
        search = request.args.get('search', '').strip()
        sort_by = request.args.get('sort_by', 'date_taken')
        sort_order = request.args.get('sort_order', 'desc')
        
        # Validate parameters
        if page < 1 or per_page < 1 or per_page > 100:
            return jsonify({"error": "Invalid pagination parameters"}), 400
        
        # Get filtered photos
        result = event.groups_model.get_filtered_photos(
            group_id, page, per_page, search, sort_by, sort_order
        )
        
        # Build response with pagination info
        response_data = {
            "photos": result['photos'],
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": result['total'],
                "pages": (result['total'] + per_page - 1) // per_page
            }
        }
        
        return jsonify(response_data)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
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
        moments = event.moments_model.list()
        return jsonify({"moments": moments})
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
        moment = event.moments_model.get(moment_id)
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
        moment_id = event.moments_model.create(data)
        
        # Get the created moment
        created_moment = event.moments_model.get(moment_id)
        
        # Add change instruction for frontend
        response_data = {"success": True, "moment_id": moment_id}
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
        if not event.moments_model.get(moment_id):
            return not_found(f"Moment {moment_id} not found or not accessible")
        
        data = request.json or {}
        
        # Update the moment
        event.moments_model.edit(moment_id, data)
        
        # Get the updated moment
        updated_moment = event.moments_model.get(moment_id)
        
        # Add change instruction for frontend
        response_data = {"success": True}
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
        if not event.moments_model.get(moment_id):
            return not_found(f"Moment {moment_id} not found or not accessible")
        
        # Delete the moment
        event.moments_model.delete(moment_id)
        
        # Add change instruction for frontend
        response_data = {"success": True}
        response_data = add_change_instruction(response_data, 'MOMENT_DELETED', {"moment_id": moment_id})
        return jsonify(response_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments/<moment_id>/photos", methods=["GET"])
@require_auth
def get_moment_photos(event_id, moment_id):
    """Get all photos in a specific moment within the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        # Check if moment exists and is accessible
        if not event.moments_model.get(moment_id):
            return not_found(f"Moment {moment_id} not found or not accessible")
        
        # Get image IDs for this moment
        image_ids = event.moments_model.get_images(moment_id)
        
        # Get basic image info for each
        images_data = []
        for image_id in image_ids:
            image = event.images_model.get(image_id)
            if image:
                images_data.append({
                    'id': image_id,
                    'name': image['name'],
                    'date_taken': image.get('date_taken'),
                    'width': image.get('width'),
                    'height': image.get('height'),
                    'urls': {
                        'display': f'/api/events/{event_id}/display/{image_id}.webp',
                        'thumbnail': f'/api/events/{event_id}/thumb/{image_id}.webp',
                    }
                })
        
        return jsonify({"photos": images_data})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments/<moment_id>/photos-in-period", methods=["GET"])
@require_auth
def get_moment_photos_in_period(event_id, moment_id):
    """Get photos within a moment's time period in the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        # Check if moment exists and is accessible
        moment = event.moments_model.get(moment_id)
        if not moment:
            return not_found(f"Moment {moment_id} not found or not accessible")
        
        # Get photos in the moment's time period
        start_date = moment.get('start')
        end_date = moment.get('end')
        
        if not start_date or not end_date:
            return jsonify({"error": "Moment must have start and end dates"}), 400
        
        # Get photos in period
        photos_in_period = event.get_photos_in_period(start_date, end_date)
        
        return jsonify({"photos": photos_in_period})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/photos/<image_id>/faces", methods=["GET"])
@require_auth
def get_photo_faces(event_id, image_id):
    """Get all faces detected in a specific photo within the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        # Check if image exists and is accessible
        if not event.images_model.get(image_id):
            return not_found(f"Image {image_id} not found or not accessible")
        
        # Get face IDs for this image
        face_ids = event.images_model.get_faces(image_id)
        
        # Build faces data
        faces_data = []
        for face_id in face_ids:
            face = event.faces_model.get(face_id)
            if face:
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
                    'url': f'/api/events/{event_id}/faces/{face_id}.webp'
                }
                faces_data.append(face_data)
        
        return jsonify({"faces": faces_data})
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/photos/<image_id>/info", methods=["GET"])
@require_auth
def get_photo_info(event_id, image_id):
    """Get basic photo information within the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        image = event.images_model.get(image_id)
        if not image:
            return not_found(f"Image {image_id} not found or not accessible")
        
        # Return basic image info
        photo_info = {
            'id': image_id,
            'name': image['name'],
            'date_taken': image.get('date_taken'),
            'file_size': image.get('file_size'),
            'width': image.get('width'),
            'height': image.get('height'),
            'urls': {
                'display': f'/api/events/{event_id}/display/{image_id}.webp',
                'thumbnail': f'/api/events/{event_id}/thumb/{image_id}.webp',
            }
        }
        
        return jsonify(photo_info)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/photos/<image_id>/complete", methods=["GET"])
@require_auth
def get_photo_complete(event_id, image_id):
    """Get complete photo data including metadata, faces, and URLs within the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        photo_data = build_complete_photo_data(event, image_id)
        if not photo_data:
            return not_found(f"Image {image_id} not found or not accessible")
        
        # Update URLs to use event-scoped endpoints
        photo_data['urls'] = {
            'display': f'/api/events/{event_id}/display/{image_id}.webp',
            'thumbnail': f'/api/events/{event_id}/thumb/{image_id}.webp',
            'high_quality': f'/api/events/{event_id}/high_quality/{image_id}.webp',
            'original': f'/api/events/{event_id}/original/{image_id}.webp',
        }
        
        return jsonify(photo_data)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/groups/<group_id>/photos-complete", methods=["GET"])
@require_auth
def get_group_photos_complete(event_id, group_id):
    """Get complete photo data for all photos in a group within the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
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
            # Update URLs to use event-scoped endpoints
            photo_data['urls'] = {
                'display': f'/api/events/{event_id}/display/{image_id}.webp',
                'thumbnail': f'/api/events/{event_id}/thumb/{image_id}.webp',
                'high_quality': f'/api/events/{event_id}/high_quality/{image_id}.webp',
                'original': f'/api/events/{event_id}/original/{image_id}.webp',
            }
            photos_data.append(photo_data)
    
    return jsonify({"photos": photos_data})

@app.route("/api/events/<event_id>/moments/<moment_id>/photos-complete", methods=["GET"])
@require_auth
def get_moment_photos_complete(event_id, moment_id):
    """Get complete photo data for all photos in a moment within the event."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        # Check if moment exists and is accessible
        if not event.moments_model.get(moment_id):
            return not_found(f"Moment {moment_id} not found or not accessible")
        
        # Get image IDs for this moment
        image_ids = event.moments_model.get_images(moment_id)
        
        # Build complete photo data for each image
        photos_data = []
        for image_id in image_ids:
            photo_data = build_complete_photo_data(event, image_id)
            if photo_data:
                # Update URLs to use event-scoped endpoints
                photo_data['urls'] = {
                    'display': f'/api/events/{event_id}/display/{image_id}.webp',
                    'thumbnail': f'/api/events/{event_id}/thumb/{image_id}.webp',
                    'high_quality': f'/api/events/{event_id}/high_quality/{image_id}.webp',
                    'original': f'/api/events/{event_id}/original/{image_id}.webp',
                }
                photos_data.append(photo_data)
        
        return jsonify({"photos": photos_data})
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

@app.route("/api/events/<event_id>/images.json", methods=["GET"])
@require_auth
def get_images_json(event_id):
    """Return accessible images metadata for the event (for frontend compatibility)."""
    event = get_event_with_profile()
    if str(event.id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    
    try:
        images = event.images_model.list()
        
        photos_data = []
        for image in images:
            photo_data = build_complete_photo_data(event, image['imageID'])
            if photo_data:
                # Update URLs to use event-scoped endpoints
                photo_data['urls'] = {
                    'display': f'/api/events/{event_id}/display/{image["imageID"]}.webp',
                    'thumbnail': f'/api/events/{event_id}/thumb/{image["imageID"]}.webp',
                    'high_quality': f'/api/events/{event_id}/high_quality/{image["imageID"]}.webp',
                    'original': f'/api/events/{event_id}/original/{image["imageID"]}.webp',
                }
                photos_data.append(photo_data)
                
        return jsonify({"images": photos_data})
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

# Legacy endpoints (for backward compatibility - should be deprecated)
@app.route("/api/groups", methods=["GET"])
@require_auth
def get_groups_legacy():
    """Legacy endpoint - redirects to event-scoped version."""
    return get_groups(FIXED_EVENT_ID)

@app.route("/api/photos/<image_id>/complete", methods=["GET"])
@require_auth
def get_photo_complete_legacy(image_id):
    """Legacy endpoint - redirects to event-scoped version."""
    return get_photo_complete(FIXED_EVENT_ID, image_id)

@app.route("/api/images.json", methods=["GET"])
def get_images_json_legacy():
    """Legacy endpoint - redirects to event-scoped version."""
    return get_images_json(FIXED_EVENT_ID)

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

@app.route('/api/events/<event_id>/high_quality/<image_id>.webp')
@require_auth
def get_high_quality_image_webp(event_id, image_id):
    event = Event(event_id)
    profile_id = g.profile_id
    if image_id not in event.profile_model.get_accessible_images(profile_id):
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
