from flask import Blueprint, jsonify, request
import traceback

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event, get_general_models, Forbidden
from src.backend.validators import get_input, get_multiple_inputs, validate_path_param
from src.backend.tasks import process_image_task, try_trigger_cluster
from src.backend.redis_client import get_redis_client
from src.core.errors import log_error
from src.core.storage import get_file_helper

upload_bp = Blueprint('uploads', __name__, url_prefix='/api/events/<event_id>')

@upload_bp.route("/upload", methods=["POST"])
@require_auth
def get_upload_urls(event_id):
    """
    Generate presigned URLs for direct S3 uploads.
    Creates upload record and image records, generates presigned URLs.
    
    Request body:
    {
        "files_data": [
            {"filename": "image1.jpg", "size": 1234567},
            ...
        ]
    }
    
    Returns:
    {
        "success": true,
        "upload_id": 123,
        "upload_urls": [
            {
                "image_id": "uuid",
                "filename": "image1.jpg",
                "upload_url": "https://...",
                "upload_fields": {...},
                "filepath": "event_id/to_process/image1.jpg"
            },
            ...
        ]
    }
    """
    try:
        event_id = validate_path_param('event_id', event_id)
        event = get_event(event_id)
        general_models = get_general_models()
        
        if not general_models.get_current_profile(event_id).get('events', {}).get(event_id, {}).get('can_upload_and_delete_images', False):
            raise Forbidden("Permission denied: cannot upload and delete images")
        
        files_data = get_input('files_data', required=True)

        result = event.prepare_upload_urls(files_data)
        
        return jsonify({
            "success": True,
            "upload_id": result["upload_id"],
            "upload_urls": result["upload_urls"]
        })
        
    except Exception as e:
        error_msg = str(e)
        traceback_str = traceback.format_exc()
        log_error(error_msg, type(e).__name__, traceback_str)
        return jsonify({"error": error_msg}), 500

# Dev only - direct file upload route for local storage
@upload_bp.route("/upload/direct", methods=["POST"])
@require_auth
def direct_upload(event_id):
    """
    Dev only - Direct file upload endpoint for local storage.
    Accepts file uploads and saves them to to_process directory.
    
    Request: multipart/form-data with 'file' field and 'image_id', 'filename' fields
    Returns: success status
    """
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    general_models = get_general_models()
    
    if not general_models.get_current_profile(event_id).get('events', {}).get(event_id, {}).get('can_upload_and_delete_images', False):
        raise Forbidden("Permission denied: cannot upload and delete images")
    
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400
    
    image_id = get_input('image_id', required=True)
    filename = get_input('filename', required=True)
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
    
    # Save file to to_process directory
    filepath = f"{event.to_process_dir}/{filename}"
    file_helper = get_file_helper()
    
    # Read file content and write to storage
    file_content = file.read()
    file_helper.write(filepath, file_content, content_type='image/jpeg')
    
    return jsonify({
        "success": True,
        "message": "File uploaded successfully",
        "image_id": image_id,
        "filename": filename
    })

@upload_bp.route("/upload/image_ready", methods=["POST"])
@require_auth
def image_ready(event_id):
    """
    Hook called by frontend when a single image has been uploaded to S3.
    Adds image_id to Redis Set and triggers process_image_task.
    
    Request body:
    {
        "upload_id": 123,
        "image_id": "uuid",
        "filename": "image.jpg"
    }
    
    Returns:
    {
        "success": true,
        "message": "Image processing queued"
    }
    """
    try:
        event_id = validate_path_param('event_id', event_id)
        event = get_event(event_id)
        general_models = get_general_models()
        profile_id = general_models.db.profile_context.get('profile_id')
        
        if not general_models.get_current_profile(event_id).get('events', {}).get(event_id, {}).get('can_upload_and_delete_images', False):
            raise Forbidden("Permission denied: cannot upload and delete images")
        
        # Get request data
        upload_id = get_input('upload_id', required=True)
        image_id = get_input('image_id', required=True)
        filename = get_input('filename', required=True)
        
        # Validate upload_id is accessible
        if not event.models.is_accessible('uploads', upload_id):
            return jsonify({"error": f"Upload {upload_id} not found or not accessible"}), 404
        
        # Get Redis client
        try:
            redis_client = get_redis_client()
        except Exception as e:
            error_msg = f"Redis unavailable: {str(e)}"
            log_error(error_msg, "RedisConnectionError", traceback.format_exc())
            return jsonify({"error": "Redis service unavailable"}), 503
        
        # Add image_id to Redis Set (tracks pending images)
        pending_set_key = f"upload:{upload_id}:pending"
        redis_client.sadd(pending_set_key, image_id)
        
        # Update image status to QUEUED
        event.models.update_image_status(image_id, 'QUEUED')
        
        # Update upload status to PROCESSING_IMAGES if not already
        upload = event.models.get_entities('uploads', [upload_id])
        if upload and upload.get(str(upload_id), {}).get('status') != 'PROCESSING_IMAGES':
            event.models.edit('uploads', upload_id, {'status': 'PROCESSING_IMAGES'})
        
        # Trigger processing task
        process_image_task.delay(event_id, profile_id, upload_id, image_id, filename)
        
        return jsonify({
            "success": True,
            "message": "Image processing queued",
            "upload_id": upload_id,
            "image_id": image_id
        })
        
    except Exception as e:
        error_msg = str(e)
        traceback_str = traceback.format_exc()
        log_error(error_msg, type(e).__name__, traceback_str)
        return jsonify({"error": error_msg}), 500

@upload_bp.route("/upload/finished", methods=["POST"])
@require_auth
def upload_finished(event_id):
    """
    Hook called by frontend when ALL images have been uploaded to S3.
    Sets upload_finished flag in Redis and checks if cluster task should be triggered.
    
    Request body:
    {
        "upload_id": 123
    }
    
    Returns:
    {
        "success": true,
        "message": "Upload finished, processing will complete when all images are processed"
    }
    """
    try:
        event_id = validate_path_param('event_id', event_id)
        event = get_event(event_id)
        general_models = get_general_models()
        profile_id = general_models.db.profile_context.get('profile_id')
        
        if not general_models.get_current_profile(event_id).get('events', {}).get(event_id, {}).get('can_upload_and_delete_images', False):
            raise Forbidden("Permission denied: cannot upload and delete images")
        
        # Get request data
        upload_id = get_input('upload_id', required=True)
        
        # Validate upload_id is accessible
        if not event.models.is_accessible('uploads', upload_id):
            return jsonify({"error": f"Upload {upload_id} not found or not accessible"}), 404
        
        # Get Redis client
        try:
            redis_client = get_redis_client()
        except Exception as e:
            error_msg = f"Redis unavailable: {str(e)}"
            log_error(error_msg, "RedisConnectionError", traceback.format_exc())
            return jsonify({"error": "Redis service unavailable"}), 503
        
        # Set upload_finished flag to True
        upload_finished_key = f"upload:{upload_id}:upload_finished"
        redis_client.set(upload_finished_key, "true")
        
        # Check if we should trigger cluster task (all images already processed)
        cluster_triggered = try_trigger_cluster(upload_id, event_id, profile_id)
        
        return jsonify({
            "success": True,
            "message": "Upload finished" + (" - clustering triggered" if cluster_triggered else " - clustering will trigger when all images are processed"),
            "upload_id": upload_id,
            "cluster_triggered": cluster_triggered
        })
        
    except Exception as e:
        error_msg = str(e)
        traceback_str = traceback.format_exc()
        log_error(error_msg, type(e).__name__, traceback_str)
        return jsonify({"error": error_msg}), 500

@upload_bp.route("/uploads/<int:upload_id>/progress", methods=["GET"])
@require_auth
def get_upload_progress(event_id, upload_id):
    """
    Get progress of an upload including all images with their statuses.
    Uses transaction context to include pending images.
    """
    event_id = validate_path_param('event_id', event_id)
    upload_id = validate_path_param('upload_id', upload_id)
    event = get_event(event_id)
    
    upload_status = event.models.get_entities('uploads', upload_id).get('status')
    images = event.models.get_upload_images(upload_id)
    return jsonify({
        "success": True,   
        "upload_status": upload_status,
        "images": images,
    })

@upload_bp.route("/uploads", methods=["GET"])
@require_auth
def get_uploads(event_id):
    """List all accessible uploads for the specific event."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    uploads = event.models.get_entities('uploads')
    changes = [{
        'type': 'UPSERT',
        'entity': 'upload',
        'items': uploads
    }]
    return jsonify({'changes': changes})

@upload_bp.route("/uploads/<int:upload_id>", methods=["GET"])
@require_auth
def get_upload(event_id, upload_id):
    """Get a specific upload's details as changes."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    if not event.models.is_accessible('uploads', upload_id):
        return jsonify({"error": f"Upload {upload_id} not found or not accessible"}), 404

    upload = event.models.get_entities('uploads', [upload_id])
    images = event.models.get_childs('uploads', upload_id, 'images')
    groups, groups_relation_data = event.models.get_childs('uploads', upload_id, 'groups')
    moments, moments_relation_data = event.models.get_childs('uploads', upload_id, 'moments')
    
    changes = [{
        'type': 'UPSERT',
        'entity': 'upload',
        'items': upload
    }]
    changes.append({
        'type': 'RELATION_SET',
        'relation': 'upload.images',
        'parentId': str(upload_id),
        'entities': images
    })
    changes.append({
        'type': 'RELATION_SET',
        'relation': 'upload.groups',
        'parentId': str(upload_id),
        'entities': groups,
        'relationData': groups_relation_data
    })
    changes.append({
        'type': 'RELATION_SET',
        'relation': 'upload.moments',
        'parentId': str(upload_id),
        'entities': moments,
        'relationData': moments_relation_data
    })
    
    return jsonify({'changes': changes})

@upload_bp.route("/uploads/<int:upload_id>", methods=["PATCH"])
@require_auth
def update_upload(event_id, upload_id):
    """Update an upload's notes."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    if not event.models.is_accessible('uploads', upload_id):
        return jsonify({"error": f"Upload {upload_id} not found or not accessible"}), 404
        
    sanitized = get_multiple_inputs(['notes'])
    if sanitized:
        event.models.edit('uploads', upload_id, sanitized)
        updated_upload = event.models.get_entities('uploads', [upload_id])
        changes = [{
            'type': 'UPDATE',
            'entity': 'upload',
            'items': updated_upload
        }]
        response = {"success": True, "changes": changes}
    else:
        response = {"success": False}
    return jsonify(response)

@upload_bp.route("/uploads/<int:upload_id>", methods=["DELETE"])
@require_auth
def delete_upload(event_id, upload_id):
    """Delete an upload."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    if not event.models.is_accessible('uploads', upload_id):
        return jsonify({"error": f"Upload {upload_id} not found or not accessible"}), 404
    
    event.models.delete('uploads', upload_id)
    
    response = {"success": True, "deleted_ids": [upload_id]}
    response['changes'] = [{
        'type': 'REMOVE',
        'entity': 'upload',
        'ids': [upload_id]
    }]
    return jsonify(response)
