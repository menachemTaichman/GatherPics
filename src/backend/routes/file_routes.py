from flask import Blueprint, send_file, abort, make_response, jsonify, request
import os
import io
import zipfile

from src.backend.middleware.auth import require_auth, optional_auth
from src.backend.helpers import get_event, get_general_models, Event

file_bp = Blueprint('files', __name__, url_prefix='/api/events/<event_id>')

@file_bp.route('/file/<file_type>/<file_id>.webp')
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
    if not event.models.is_accessible(table_to_check, file_id):
        abort(403)
    
    file_path = os.path.join(dir_map[file_type], f'{file_id}.webp')
    if not os.path.exists(file_path):
        abort(404)
    
    resp = make_response(send_file(file_path, mimetype='image/webp'))
    resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp

@file_bp.route('/display/<image_id>.webp')
@require_auth
def get_display_image_webp(event_id, image_id):
    return get_file_webp(event_id, 'display', image_id)

@file_bp.route('/faces/<face_id>.webp')
@require_auth
def get_face_crop_webp(event_id, face_id):
    return get_file_webp(event_id, 'face', face_id)

@file_bp.route('/thumb/<image_id>.webp')
@require_auth
def get_thumbnail_image_webp(event_id, image_id):
    return get_file_webp(event_id, 'thumb', image_id)

@file_bp.route('/high_quality/<image_id>.webp')
@require_auth
def get_high_quality_image_webp(event_id, image_id):
    return get_file_webp(event_id, 'high_quality', image_id)

@file_bp.route('/original/<image_id>.webp')
@require_auth
def get_original_image_webp(event_id, image_id):
    return get_file_webp(event_id, 'original', image_id)

@file_bp.route('/representative/display', methods=['GET', 'HEAD'])
@require_auth
def get_event_display_representative_webp(event_id):
    general_models = get_general_models()
    event = general_models.get_entities('events', event_id)
    event_instance = Event(event_id)
    if not event:
        abort(404)
    representative_image = event['representative_image']
    if not representative_image:
        return '', 204
    file_path = os.path.join(event_instance.display_dir, f'{representative_image}.webp')
    if not os.path.exists(file_path):
        abort(404)
    
    resp = make_response(send_file(file_path, mimetype='image/webp'))
    resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp

@file_bp.route('/representative/thumb', methods=['GET', 'HEAD'])
@optional_auth
def get_event_thumb_representative_webp(event_id):
    general_models = get_general_models()
    event = general_models.get_entities('events', event_id)
    event_instance = Event(event_id)
    if not event:
        abort(404)
    representative_image = event['representative_image']
    if not representative_image:
        return '', 204

    file_path = os.path.join(event_instance.thumb_dir, f'{representative_image}.webp')
    if not os.path.exists(file_path):
        abort(404)
    
    resp = make_response(send_file(file_path, mimetype='image/webp'))
    resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp

@file_bp.route('/<entity>/<parent_id>/representative', methods=['GET', 'HEAD'])
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

    if not event.models.is_accessible(entity, parent_id):
        if entity != 'groups' or not event.models.is_group_to_request_access(parent_id):
            abort(403)
    _, file_id = event.models.get_representative(entity, parent_id)
    
    if not file_id:
        return '', 204
    
    file_path = os.path.join(dir_map[entity], f'{file_id}.webp')
    if not os.path.exists(file_path):
        abort(404)
    
    resp = make_response(send_file(file_path, mimetype='image/webp'))
    resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp

@file_bp.route("/download", methods=["POST"])
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
        images = event.models.get_entities('images', image_ids)
        memory_file = io.BytesIO()
        failed_images = []
        accessible_image_ids = set(images.keys())
        failed_images.extend(image_id for image_id in image_ids if image_id not in accessible_image_ids)
        
        with zipfile.ZipFile(memory_file, 'w') as zf:
            for image_id, image_data in images.items():
                label = image_data.get('label') or image_id
                
                src_dir = event.high_quality_dir if quality != 'original' else event.original_dir
                file_path = os.path.join(src_dir, f"{image_id}.jpg")
                if os.path.exists(file_path):
                    if not os.path.splitext(label)[1]:
                        label = f"{label}.jpg"
                    zf.write(file_path, label)
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
        return jsonify({"error": str(e)}), 400

