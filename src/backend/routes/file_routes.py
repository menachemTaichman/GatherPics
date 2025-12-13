from flask import Blueprint, abort, make_response, jsonify
import os

from src.backend.middleware.auth import require_auth, optional_auth
from src.backend.helpers import get_event, get_general_models
from src.backend.validators import get_input, validate_path_param
from src.core.storage import get_file_helper

file_bp = Blueprint('files', __name__, url_prefix='/api/events/<event_id>')

def _add_cache_headers(resp):
    """Add cache headers to response, handling redirects, streaming, and regular responses."""
    if hasattr(resp, 'status_code') and resp.status_code in (301, 302, 303, 307, 308):
        # Redirect response (S3 presigned URL)
        resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        return resp
    elif hasattr(resp, 'direct_passthrough') and resp.direct_passthrough:
        # Streaming response (S3 proxy)
        resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        return resp
    else:
        # Regular response (local file)
        resp = make_response(resp)
        resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        return resp

@file_bp.route('/file/<file_type>/<file_id>.webp')
@require_auth
def get_file_webp(event_id, file_type, file_id):
    """Serve various types of image files (display, face, thumb, etc.)."""
    event_id = validate_path_param('event_id', event_id)
    # file_id can be image_id or face_id depending on file_type, validate as UUID string
    file_id = validate_path_param('image_id' if file_type in ['display', 'thumb', 'high_quality', 'original'] else 'face_id', file_id)
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
    
    file_helper = get_file_helper()
    
    # High quality and original files are stored as .jpg, not .webp
    if file_type in ['high_quality', 'original']:
        file_path = f"{dir_map[file_type]}/{file_id}.jpg"
        mimetype = 'image/jpeg'
    else:
        file_path = f"{dir_map[file_type]}/{file_id}.webp"
        mimetype = 'image/webp'
    
    if not file_helper.exists(file_path):
        abort(404)
    
    resp = file_helper.serve_file(file_path, mimetype=mimetype)
    return _add_cache_headers(resp)

@file_bp.route('/display/<image_id>.webp')
@require_auth
def get_display_image_webp(event_id, image_id):
    event_id = validate_path_param('event_id', event_id)
    image_id = validate_path_param('image_id', image_id)
    return get_file_webp(event_id, 'display', image_id)

@file_bp.route('/faces/<face_id>.webp')
@require_auth
def get_face_crop_webp(event_id, face_id):
    event_id = validate_path_param('event_id', event_id)
    face_id = validate_path_param('face_id', face_id)
    return get_file_webp(event_id, 'face', face_id)

@file_bp.route('/thumb/<image_id>.webp')
@require_auth
def get_thumbnail_image_webp(event_id, image_id):
    event_id = validate_path_param('event_id', event_id)
    image_id = validate_path_param('image_id', image_id)
    return get_file_webp(event_id, 'thumb', image_id)

@file_bp.route('/high_quality/<image_id>.jpg')
@require_auth
def get_high_quality_image_jpg(event_id, image_id):
    """Serve high quality JPG images (for streaming in ZIP downloads)."""
    event_id = validate_path_param('event_id', event_id)
    image_id = validate_path_param('image_id', image_id)
    event = get_event(event_id)
    
    if not event.models.is_accessible('images', image_id):
        abort(403)
    
    file_helper = get_file_helper()
    file_path = f"{event.high_quality_dir}/{image_id}.jpg"
    
    if not file_helper.exists(file_path):
        abort(404)
    
    # For ZIP streaming, use as_attachment=False to proxy/stream the file
    resp = file_helper.serve_file(file_path, mimetype='image/jpeg', as_attachment=False)
    return _add_cache_headers(resp)

@file_bp.route('/original/<image_id>.jpg')
@require_auth
def get_original_image_jpg(event_id, image_id):
    """Serve original JPG images (for streaming in ZIP downloads)."""
    event_id = validate_path_param('event_id', event_id)
    image_id = validate_path_param('image_id', image_id)
    event = get_event(event_id)
    
    if not event.models.is_accessible('images', image_id):
        abort(403)
    
    file_helper = get_file_helper()
    file_path = f"{event.original_dir}/{image_id}.jpg"
    
    if not file_helper.exists(file_path):
        abort(404)
    
    # For ZIP streaming, use as_attachment=False to proxy/stream the file
    resp = file_helper.serve_file(file_path, mimetype='image/jpeg', as_attachment=False)
    return _add_cache_headers(resp)

@file_bp.route('/representative/display', methods=['GET', 'HEAD'])
@require_auth
def get_event_display_representative_webp(event_id):
    event_id = validate_path_param('event_id', event_id)
    general_models = get_general_models()
    event = general_models.get_entities('events', event_id)
    event_instance = get_event(event_id)
    if not event:
        abort(404)
    representative_image = event['representative_image']
    if not representative_image:
        return '', 204
    
    file_helper = get_file_helper()
    file_path = f"{event_instance.display_dir}/{representative_image}.webp"
    if not file_helper.exists(file_path):
        abort(404)
    
    resp = file_helper.serve_file(file_path, mimetype='image/webp')
    return _add_cache_headers(resp)

@file_bp.route('/representative/thumb', methods=['GET', 'HEAD'])
@optional_auth
def get_event_thumb_representative_webp(event_id):
    event_id = validate_path_param('event_id', event_id)
    general_models = get_general_models()
    event = general_models.get_entities('events', event_id)
    event_instance = get_event(event_id)
    if not event:
        abort(404)
    representative_image = event['representative_image']
    if not representative_image:
        return '', 204

    file_helper = get_file_helper()
    file_path = f"{event_instance.thumb_dir}/{representative_image}.webp"
    if not file_helper.exists(file_path):
        abort(404)
    
    resp = file_helper.serve_file(file_path, mimetype='image/webp')
    return _add_cache_headers(resp)

@file_bp.route('/<entity>/<parent_id>/representative', methods=['GET', 'HEAD'])
@require_auth
def get_representative_webp(event_id, entity, parent_id):
    event_id = validate_path_param('event_id', event_id)
    parent_id = validate_path_param('parent_id', parent_id)
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
    
    file_helper = get_file_helper()
    file_path = f"{dir_map[entity]}/{file_id}.webp"
    if not file_helper.exists(file_path):
        abort(404)
    
    resp = file_helper.serve_file(file_path, mimetype='image/webp')
    return _add_cache_headers(resp)

@file_bp.route("/download", methods=["POST"])
@require_auth
def download_images(event_id):
    """Return presigned URLs for downloading images (client-side ZIP creation)."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    image_ids = get_input('image_ids', required=True)
    quality = get_input('quality', required=False) or 'high'
    quality = quality.lower()
    
    images = event.models.get_entities('images', image_ids)
    accessible_image_ids = set(images.keys())
    failed_images = [image_id for image_id in image_ids if image_id not in accessible_image_ids]
    
    file_helper = get_file_helper()
    files = []
    
    for image_id, image_data in images.items():
        label = image_data.get('label') or image_id
        
        src_dir = event.high_quality_dir if quality != 'original' else event.original_dir
        file_path = f"{src_dir}/{image_id}.jpg"
        
        if not os.path.splitext(label)[1]:
            label = f"{label}.jpg"
        
        # Generate presigned URL for download
        presigned_url = file_helper.get_url(file_path, expires_in=3600)
        if presigned_url:
            files.append({
                'url': presigned_url,
                'filename': label
            })
        else:
            failed_images.append(image_id)
    
    return jsonify({
        'files': files,
        'failed_images': failed_images
    })

