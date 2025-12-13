from flask import Blueprint, jsonify, request, Response, stream_with_context
import os
import queue
import threading
import re

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event, get_general_models, Forbidden, json_dumps_safe
from src.backend.validators import get_input, get_multiple_inputs, validate_path_param
from src.core.storage import get_file_helper

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
    upload_urls = []
    
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
                "filename": filename,
                "upload_url": upload_info['url'],
                "upload_fields": upload_info['fields'],
                "filepath": filepath
            })
        else:
            # Local storage - return filepath for direct upload
            # For local storage, client will still upload to server
            upload_urls.append({
                "filename": filename,
                "upload_url": None,  # Will use regular upload endpoint
                "upload_fields": None,
                "filepath": filepath
            })
    
    if not upload_urls:
        return jsonify({"error": "No valid JPG files provided"}), 400
    
    return jsonify({
        "success": True,
        "upload_urls": upload_urls
    })

@upload_bp.route("/images/upload", methods=["POST"])
@require_auth
def upload_files_only(event_id):
    """
    Verify uploaded files exist in storage (for S3 presigned uploads) or upload files directly (for local storage).
    
    For S3: Accepts filenames that were uploaded via presigned URLs and verifies they exist.
    For local: Accepts files via multipart/form-data and uploads them.
    
    Request body (S3):
    {
        "filenames": ["image1.jpg", "image2.jpg"]
    }
    
    Request body (local):
    multipart/form-data with 'files' field
    """
    import traceback
    from src.core.errors import log_error
    
    saved_files = []
    MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB
    MAX_FILE_COUNT = 30
    
    try:
        event_id = validate_path_param('event_id', event_id)
        event = get_event(event_id)
        general_models = get_general_models()
        
        file_helper = get_file_helper()
        if not general_models.get_current_profile(event_id).get('events', {}).get(event_id, {}).get('can_upload_and_delete_images', False):
            raise Forbidden("Permission denied: cannot upload and delete images")
        
        # Check if using S3 (presigned URLs) or local storage
        if not file_helper.is_local:
            # S3 storage - verify files exist that were uploaded via presigned URLs
            filenames = get_input('filenames', required=True)
            if not isinstance(filenames, list) or not filenames:
                return jsonify({"error": "No filenames provided"}), 400
            
            # Check file count limit
            if len(filenames) > MAX_FILE_COUNT:
                return jsonify({"error": f"Too many files. Maximum {MAX_FILE_COUNT} files allowed."}), 400
            
            # Verify each file exists
            for filename in filenames:
                if not isinstance(filename, str):
                    continue
                
                # Validate file extension (JPG only)
                if not filename.lower().endswith(('.jpg', '.jpeg')):
                    continue
                
                filepath = f"{event.to_process_dir}/{filename}"
                
                # Verify file exists in S3
                if file_helper.exists(filepath):
                    saved_files.append(filename)
                else:
                    # File doesn't exist - might not have been uploaded yet
                    return jsonify({"error": f"File '{filename}' not found. Please upload it first using the presigned URL."}), 400
            
            if not saved_files:
                return jsonify({"error": "No valid JPG files provided"}), 400
            
            return jsonify({
                "success": True,
                "files_saved": len(saved_files),
                "filenames": saved_files
            })
        else:
            # Local storage - upload files directly (backward compatibility)
            try:
                if 'files' not in request.files:
                    return jsonify({"error": "No files provided"}), 400
                
                files = request.files.getlist('files')
            except Exception as e:
                error_msg = f"Error reading uploaded files: {str(e)}"
                traceback_str = traceback.format_exc()
                log_error(error_msg, "RequestParsingError", traceback_str)
                return jsonify({"error": "Failed to read uploaded files. The upload may have timed out or been interrupted."}), 500
            
            if not files:
                return jsonify({"error": "No files provided"}), 400
            
            # Check file count limit
            if len(files) > MAX_FILE_COUNT:
                return jsonify({"error": f"Too many files. Maximum {MAX_FILE_COUNT} files allowed."}), 400
            
            for file in files:
                if file and file.filename:
                    # Validate file extension (JPG only)
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
                    
                    # Stream file upload with size validation
                    try:
                        file_helper.write_stream(filepath, file, content_type='image/jpeg', size_limit=MAX_FILE_SIZE)
                        saved_files.append(filename)
                    except ValueError as e:
                        cleanup_files(saved_files, event.to_process_dir)
                        return jsonify({"error": f"File '{filename}' exceeds maximum size of 20 MB"}), 400
                    except Exception as e:
                        if saved_files:
                            cleanup_files(saved_files, event.to_process_dir)
                        raise
            
            if not saved_files:
                cleanup_files(saved_files, event.to_process_dir)
                return jsonify({"error": "No valid JPG files provided"}), 400
            
            return jsonify({
                "success": True,
                "files_saved": len(saved_files),
                "filenames": saved_files
            })
    except Exception as e:
        if saved_files and 'event' in locals():
            cleanup_files(saved_files, event.to_process_dir)
        error_msg = str(e)
        traceback_str = traceback.format_exc()
        log_error(error_msg, type(e).__name__, traceback_str)
        raise

@upload_bp.route("/images/process-stream", methods=["POST"])
@require_auth
def process_images_stream(event_id):
    """Process images with SSE progress streaming."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    general_models = get_general_models()
    
    assign_moments = get_input('assign_moments', required=False) or False
    file_names = get_input('file_names', required=False)
    
    # TODO: This os.listdir approach won't work in production with S3 storage.
    # Need to implement S3 list_objects_v2 equivalent or require file_names to be provided.
    # For now, only works in local development. In production, file_names must be provided.
    if file_names is None:
        # TODO: Replace with S3-compatible file listing when using S3 storage
        # For S3: use boto3 list_objects_v2 with prefix=event.to_process_dir
        # This is a temporary solution that only works with local storage
        try:
            files_to_track = [f for f in os.listdir(event.to_process_dir) 
                             if f.lower().endswith((".jpg", ".jpeg", ".png", ".bmp", ".tiff"))]
        except (OSError, FileNotFoundError):
            # If to_process_dir doesn't exist or can't list (e.g., S3), require file_names
            files_to_track = []
    else:
        files_to_track = file_names
    
    progress_queue = queue.Queue()
    
    def progress_callback(progress_data):
        """Callback to push progress updates to queue."""
        progress_queue.put(progress_data)
    
    def generate():
        """SSE generator function."""
        result_container = {}
        error_container = {}
        
        def process_task():
            """Task to run in background thread."""
            try:
                result = general_models.process_new_images(
                    event_id,
                    file_names=file_names,
                    assign_moments=assign_moments,
                    progress_callback=progress_callback
                )
                result_container['data'] = result
                progress_queue.put({'_step': '_done_', 'result': result})
            except Exception as e:
                error_container['error'] = str(e)
                # Don't cleanup files here - let event.py error handler do it
                # It will only cleanup unprocessed files
                progress_queue.put({'_step': '_error_', 'message': str(e)})
        
        thread = threading.Thread(target=process_task, daemon=True)
        thread.start()
        
        processing_completed = False
        try:
            while True:
                try:
                    progress = progress_queue.get(timeout=30)
                    
                    if progress.get('_step') == '_done_':
                        result = progress['result']
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
                        
                        final_response = {
                            'step': 'complete',
                            'result': result,
                            'changes': changes
                        }
                        yield f"data: {json_dumps_safe(final_response)}\n\n"
                        processing_completed = True
                        break
                        
                    elif progress.get('_step') == '_error_':
                        error_response = {
                            'step': 'error',
                            'message': progress.get('message', 'Unknown error')
                        }
                        yield f"data: {json_dumps_safe(error_response)}\n\n"
                        break
                        
                    else:
                        yield f"data: {json_dumps_safe(progress)}\n\n"
                        
                except queue.Empty:
                    yield ": keepalive\n\n"
                    
        except GeneratorExit:
            # User disconnected - let processing continue in background
            # Don't cleanup files, processing will continue
            pass
        except Exception:
            # Only cleanup on actual errors, not on disconnect
            # The background thread will handle cleanup if needed
            raise
        finally:
            # Don't cleanup on disconnect - processing continues in background
            # The thread is daemon=True so it will continue even if connection closes
            thread.join(timeout=1)
    
    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
        }
    )

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


