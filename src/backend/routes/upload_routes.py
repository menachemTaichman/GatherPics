from flask import Blueprint, jsonify, request, Response, stream_with_context
import os
import queue
import threading
import re
from datetime import datetime
from celery import group, chord

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event, get_general_models, Forbidden, json_dumps_safe
from src.backend.validators import get_input, get_multiple_inputs, validate_path_param
from src.core.storage import get_file_helper
from src.core.database.db import ReturnFormat
from src.backend.tasks import process_image_task, cluster_faces_task

upload_bp = Blueprint('uploads', __name__, url_prefix='/api/events/<event_id>')

def cleanup_files(file_names, to_process_dir):
    """Delete files from to_process directory, ignoring if already deleted."""
    if file_names:
        file_helper = get_file_helper()
        for filename in file_names:
            try:
                filepath = f"{to_process_dir}/{filename}"
                file_helper.delete(filepath)
            except Exception:
                pass

def sanitize_filename(filename):
    """
    Sanitize filename while preserving spaces.
    Removes dangerous characters but keeps spaces for better readability.
    
    Args:
        filename: Original filename
        
    Returns:
        Sanitized filename safe for filesystem use
    """
    if not filename:
        return ''
    
    # Remove any path components (directory separators)
    filename = os.path.basename(filename)
    
    # Remove null bytes and control characters
    filename = filename.replace('\x00', '')
    filename = ''.join(char for char in filename if ord(char) >= 32 or char in ['\t', '\n', '\r'])
    
    # Remove dangerous characters: / \ : * ? " < > |
    # Keep spaces and other safe characters
    filename = re.sub(r'[<>:"/\\|?*]', '', filename)
    
    # Remove leading/trailing spaces and dots (Windows doesn't like these)
    filename = filename.strip(' .')
    
    # Limit length (most filesystems have limits)
    if len(filename) > 255:
        name, ext = os.path.splitext(filename)
        filename = name[:255 - len(ext)] + ext
    
    # If empty after sanitization, use a default name
    if not filename:
        filename = 'image'
    
    return filename

# TODO: remove
"""
@upload_bp.route("/images", methods=["POST"])
@require_auth
def upload_images(event_id):
    import traceback
    from src.core.errors import log_error
    
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    general_models = get_general_models()
    
    # Wrap request.files access in try-except to catch parsing errors
    try:
        if 'files' not in request.files:
            return jsonify({"error": "No files provided"}), 400
        
        files = request.files.getlist('files')
        assign_moments = request.form.get('assign_moments', 'false').lower() == 'true'
    except Exception as e:
        # Catch errors during request parsing (e.g., timeout, disconnect)
        error_msg = f"Error reading uploaded files: {str(e)}"
        traceback_str = traceback.format_exc()
        log_error(error_msg, "RequestParsingError", traceback_str)
        return jsonify({"error": "Failed to read uploaded files. The upload may have timed out or been interrupted."}), 500
    
    if not files:
        return jsonify({"error": "No files provided"}), 400
    
    saved_files = []
    processing_succeeded = False
    file_helper = get_file_helper()
    try:
        # Save files to to_process directory
        for file in files:
            if file and file.filename:
                if not file.filename.lower().endswith(('.jpg', '.jpeg')):
                    continue
                
                filename = sanitize_filename(file.filename)
                filepath = f"{event.to_process_dir}/{filename}"
                
                base, ext = os.path.splitext(filename)
                counter = 1
                while file_helper.exists(filepath):
                    filename = f"{base}_{counter}{ext}"
                    filepath = f"{event.to_process_dir}/{filename}"
                    counter += 1
                
                file_bytes = file.read()
                file_helper.write(filepath, file_bytes, content_type='image/jpeg')
                saved_files.append(filename)
        
        if not saved_files:
            cleanup_files(saved_files, event.to_process_dir)
            return jsonify({"error": "No valid JPG files provided"}), 400
        
        # Process images
        result = general_models.process_new_images(event_id, file_names=saved_files, assign_moments=assign_moments)
        processing_succeeded = True
        
        # Build changes for frontend
        changes = []
        
        processed_image_ids = result.get('processed_image_ids', [])
        if processed_image_ids:
            images = event.models.get_entities('images', processed_image_ids)
            
            group_to_images = event.models.get_parents('images', processed_image_ids, 'groups')
            all_parent_groups = set(group_to_images.keys())
            
            changes.append({
                'type': 'UPSERT',
                'entity': 'image',
                'items': images,
            })
            
            for group_id in all_parent_groups:
                group_images = event.models.get_childs('groups', group_id, 'images', processed_image_ids)
                if group_images:
                    changes.append({
                        'type': 'RELATION_ADD',
                        'relation': 'group.images',
                        'parentId': group_id,
                        'entities': group_images,
                    })
            
            if all_parent_groups:
                changes.append({
                    'type': 'UPSERT',
                    'entity': 'group',
                    'items': event.models.get_entities('groups', list(all_parent_groups)),
                })
            
            assigned_moments = result.get('assigned_moments', {})
            if assigned_moments:
                for moment_id, image_ids in assigned_moments.items():
                    changes.append({
                        'type': 'RELATION_ADD',
                        'relation': 'moment.images',
                        'parentId': moment_id,
                        'entities': event.models.get_childs('moments', moment_id, 'images', image_ids)
                    })
                
                changes.append({
                    'type': 'UPDATE',
                    'entity': 'moment',
                    'items': event.models.get_entities('moments', list(assigned_moments.keys()))
                })
        
        if result.get('upload_id'):
            upload_entity = event.models.get_entities('uploads', [result['upload_id']])
            changes.append({
                'type': 'UPSERT',
                'entity': 'upload',
                'items': upload_entity
            })
        
        return jsonify({
            "success": True,
            "upload_id": result.get('upload_id'),
            "images_processed": result['images_processed'],
            "faces_detected": result['faces_detected'],
            "groups_created": result['groups_created'],
            "errors": result.get('errors', []),
            "changes": changes
        })
    finally:
        # Cleanup files only if processing failed
        # If processing succeeded, files are already moved/processed by process_new_images
        if not processing_succeeded and saved_files:
            cleanup_files(saved_files, event.to_process_dir)
"""

@upload_bp.route("/images/upload-urls", methods=["POST"])
@require_auth
def get_upload_urls(event_id):
    """
    Generate presigned URLs for direct S3 uploads.
    
    Request body:
    {
        "files": [
            {"filename": "image1.jpg", "size": 1234567},
            ...
        ]
    }
    
    Returns:
    {
        "success": true,
        "upload_urls": [
            {
                "filename": "image1.jpg",
                "upload_url": "https://...",
                "filepath": "event_id/to_process/image1.jpg"
            },
            ...
        ]
    }
    """
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    general_models = get_general_models()
    
    if not general_models.get_current_profile(event_id).get('events', {}).get(event_id, {}).get('can_upload_and_delete_images', False):
        raise Forbidden("Permission denied: cannot upload and delete images")
    
    MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB
    MAX_FILE_COUNT = 30
    
    files_data = get_input('files', required=True)
    if not isinstance(files_data, list) or not files_data:
        return jsonify({"error": "No files provided"}), 400
    
    # Check file count limit
    if len(files_data) > MAX_FILE_COUNT:
        return jsonify({"error": f"Too many files. Maximum {MAX_FILE_COUNT} files allowed."}), 400
    
    file_helper = get_file_helper()
    
    # Create upload session
    upload_id = event.models.add('uploads', {
        'started_at': datetime.now().isoformat(),
        'status': 'pending',
        'images_count': len(files_data),
        'faces_count': 0,
        'clusters_count': 0,
        'moments_count': 0,
        'errors': [],
    })
    
    upload_urls = []
    image_records = []
    
    for file_info in files_data:
        if not isinstance(file_info, dict) or 'filename' not in file_info:
            continue
        
        original_filename = file_info['filename']
        file_size = file_info.get('size', 0)
        
        # Validate file extension (JPG only)
        if not original_filename.lower().endswith(('.jpg', '.jpeg')):
            continue
        
        # Validate file size
        if file_size > MAX_FILE_SIZE:
            return jsonify({"error": f"File '{original_filename}' exceeds maximum size of 20 MB"}), 400
        
        filename = sanitize_filename(original_filename)
        filepath = f"{event.to_process_dir}/{filename}"
        
        # Handle filename conflicts
        base, ext = os.path.splitext(filename)
        counter = 1
        while file_helper.exists(filepath):
            filename = f"{base}_{counter}{ext}"
            filepath = f"{event.to_process_dir}/{filename}"
            counter += 1
        
        # Create image record with PENDING_UPLOAD status
        image_name, image_ext = os.path.splitext(filename)
        label = event.models.get_unique_label('images', image_name, image_ext, brackets=True, event_id=event_id)
        image_id = event.models.add('images', {
            'label': label,
            'upload_id': upload_id,
            'status': 'PENDING_UPLOAD',
        })
        
        # Generate presigned upload URL with conditions (only for S3)
        upload_info = file_helper.get_upload_url(
            filepath, 
            content_type='image/jpeg', 
            max_size=file_size if file_size > 0 else MAX_FILE_SIZE,
            expires_in=3600
        )
        
        if upload_info:
            # S3 storage - return presigned POST URL with fields
            upload_urls.append({
                "image_id": image_id,
                "filename": filename,
                "upload_url": upload_info['url'],
                "upload_fields": upload_info['fields'],
                "filepath": filepath
            })
        else:
            # Local storage - return filepath for direct upload
            # For local storage, client will still upload to server
            upload_urls.append({
                "image_id": image_id,
                "filename": filename,
                "upload_url": None,  # Will use regular upload endpoint
                "upload_fields": None,
                "filepath": filepath
            })
        
        image_records.append({
            'image_id': image_id,
            'filename': filename
        })
    
    if not upload_urls:
        return jsonify({"error": "No valid JPG files provided"}), 400
    
    return jsonify({
        "success": True,
        "upload_id": upload_id,
        "upload_urls": upload_urls
    })

@upload_bp.route("/images/upload", methods=["POST"])
@require_auth
def upload_files_only(event_id):
    """
    Trigger processing for uploaded images.
    
    Accepts upload_id or image_ids. Updates image status to QUEUED and triggers Celery tasks.
    
    Request body:
    {
        "upload_id": 123,  # Optional: process all PENDING_UPLOAD images in this upload
        "image_ids": ["uuid1", "uuid2"]  # Optional: specific image IDs to process
    }
    """
    import traceback
    from src.core.errors import log_error
    
    try:
        event_id = validate_path_param('event_id', event_id)
        event = get_event(event_id)
        general_models = get_general_models()
        profile_id = general_models.db.profile_context.get('profile_id')
        
        if not general_models.get_current_profile(event_id).get('events', {}).get(event_id, {}).get('can_upload_and_delete_images', False):
            raise Forbidden("Permission denied: cannot upload and delete images")
        
        # Get upload_id or image_ids from request
        upload_id = get_input('upload_id', required=False)
        image_ids = get_input('image_ids', required=False)
        image_filenames = get_input('image_filenames', required=False)  # Optional mapping: {image_id: filename}
        
        if not upload_id and not image_ids:
            return jsonify({"error": "Either upload_id or image_ids must be provided"}), 400
                
        # Get images to process with their filenames
        image_tasks = []
        
        if upload_id:
            # Get all PENDING_UPLOAD images for this upload with their info
            query = """
                SELECT set_transaction_context('include_pending_images', 'true');
                SELECT image_id, label, upload_id
                FROM images_ctx
                WHERE upload_id = %s AND status = 'PENDING_UPLOAD'
            """
            images_result = event.models.db.execute_query(query, (upload_id,), return_format=ReturnFormat.DICT_DICTS)
            if not images_result:
                return jsonify({"error": f"No pending images found for upload {upload_id}"}), 404
            # Convert to dict keyed by image_id
            images = {row['image_id']: row for row in images_result}
        else:
            # Get specific images
            if not isinstance(image_ids, list) or not image_ids:
                return jsonify({"error": "image_ids must be a non-empty list"}), 400
            
            images = event.models.get_entities('images', image_ids)
            if not images:
                return jsonify({"error": "No images found"}), 404
            
            # Filter to only PENDING_UPLOAD images
            images = {img_id: img for img_id, img in images.items() if img.get('status') == 'PENDING_UPLOAD'}
            if not images:
                return jsonify({"error": "No pending images found"}), 404
        
        # Extract upload_id from first image if not provided
        if not upload_id:
            first_image = list(images.values())[0]
            upload_id = first_image.get('upload_id')
            if not upload_id:
                return jsonify({"error": "Images must have an upload_id"}), 400
        
        # Map image_ids to filenames
        image_id_list = []
        for image_id, image_data in images.items():
            # Use provided mapping if available, otherwise reconstruct from label
            if image_filenames and isinstance(image_filenames, dict) and image_id in image_filenames:
                filename = image_filenames[image_id]
            else:
                # Reconstruct filename from label: [name.ext] -> name.ext
                label = image_data.get('label', '')
                if label.startswith('[') and label.endswith(']'):
                    filename = label[1:-1]  # Remove brackets
                else:
                    # Fallback: use label as-is, add .jpg if no extension
                    filename = label
                    if '.' not in filename:
                        filename += '.jpg'
            
            image_id_list.append(image_id)
            image_tasks.append((image_id, filename))
        
        # Update all images to QUEUED status
        for image_id in image_id_list:
            event.models.update_image_status(image_id, 'QUEUED')
        
        # Update upload status to processing
        event.models.update_upload_status(upload_id, 'processing')
        
        # Create Celery Chord: group of process_image_task -> cluster_faces_task
        task_group = group([
            process_image_task.s(
                event_id,
                profile_id,
                upload_id,
                image_id,
                filename
            )
            for image_id, filename in image_tasks
        ])
        
        # Create chord: group -> cluster_faces_task (runs after all images are processed)
        chord_result = chord(task_group)(
            cluster_faces_task.s(event_id, profile_id, upload_id)
        )
        
        return jsonify({
            "success": True,
            "upload_id": upload_id,
            "images_queued": len(image_id_list),
            "task_id": str(chord_result.id) if chord_result else None
        })
        
    except Exception as e:
        error_msg = str(e)
        traceback_str = traceback.format_exc()
        log_error(error_msg, type(e).__name__, traceback_str)
        raise

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
    
    if not event.models.is_accessible('uploads', upload_id):
        return jsonify({"error": f"Upload {upload_id} not found or not accessible"}), 404
    
    # Set transaction context to include pending images
    event.models.db.execute_query("SELECT set_transaction_context('include_pending_images', 'true')")
    
    # Get upload info
    upload = event.models.get_entities('uploads', [upload_id])
    if not upload:
        return jsonify({"error": f"Upload {upload_id} not found"}), 404
    
    # Get all images for this upload (including pending)
    images = event.models.get_childs('uploads', upload_id, 'images')
    
    # Count images by status
    status_counts = {}
    for image_id, image_data in images.items():
        status = image_data.get('status', 'PENDING_UPLOAD')
        status_counts[status] = status_counts.get(status, 0) + 1
    
    # Get upload completion info
    completion_info = event.models.check_upload_completion(upload_id)
    
    return jsonify({
        "success": True,
        "upload_id": upload_id,
        "upload": upload.get(str(upload_id), {}),
        "images": images,
        "status_counts": status_counts,
        "completion": completion_info
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


