from flask import Blueprint, jsonify, request, Response, stream_with_context
import os
import queue
import threading
import re

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event, get_general_models, Forbidden, json_dumps_safe
from src.backend.validators import get_multiple_inputs, validate_path_param

upload_bp = Blueprint('uploads', __name__, url_prefix='/api/events/<event_id>')

def cleanup_files(file_names, to_process_dir):
    """Delete files from to_process directory, ignoring if already deleted."""
    if file_names:
        for filename in file_names:
            try:
                filepath = os.path.join(to_process_dir, filename)
                if os.path.exists(filepath):
                    os.remove(filepath)
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

@upload_bp.route("/images", methods=["POST"])
@require_auth
def upload_images(event_id):
    """Upload and process images."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    general_models = get_general_models()
    
    if 'files' not in request.files:
        return jsonify({"error": "No files provided"}), 400
    
    files = request.files.getlist('files')
    assign_moments = request.form.get('assign_moments', 'false').lower() == 'true'
    
    if not files:
        return jsonify({"error": "No files provided"}), 400
    
    saved_files = []
    processing_succeeded = False
    try:
        # Save files to to_process directory
        for file in files:
            if file and file.filename:
                if not file.filename.lower().endswith(('.jpg', '.jpeg')):
                    continue
                
                filename = sanitize_filename(file.filename)
                filepath = os.path.join(event.to_process_dir, filename)
                
                base, ext = os.path.splitext(filename)
                counter = 1
                while os.path.exists(filepath):
                    filename = f"{base}_{counter}{ext}"
                    filepath = os.path.join(event.to_process_dir, filename)
                    counter += 1
                
                file.save(filepath)
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

@upload_bp.route("/images/upload", methods=["POST"])
@require_auth
def upload_files_only(event_id):
    """Upload files to to_process directory without processing."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    general_models = get_general_models()
    
    if 'files' not in request.files:
        return jsonify({"error": "No files provided"}), 400
    
    files = request.files.getlist('files')
    
    if not files:
        return jsonify({"error": "No files provided"}), 400
    
    saved_files = []
    try:
        if not general_models.get_current_profile(event_id).get('events', {}).get(event_id, {}).get('can_upload_and_delete_images', False):
            raise Forbidden("Permission denied: cannot upload and delete images")
        
        for file in files:
            if file and file.filename:
                if not file.filename.lower().endswith(('.jpg', '.jpeg')):
                    continue
                
                filename = sanitize_filename(file.filename)
                filepath = os.path.join(event.to_process_dir, filename)
                
                base, ext = os.path.splitext(filename)
                counter = 1
                while os.path.exists(filepath):
                    filename = f"{base}_{counter}{ext}"
                    filepath = os.path.join(event.to_process_dir, filename)
                    counter += 1
                
                file.save(filepath)
                saved_files.append(filename)
        
        if not saved_files:
            cleanup_files(saved_files, event.to_process_dir)
            return jsonify({"error": "No valid JPG files provided"}), 400
        
        return jsonify({
            "success": True,
            "files_saved": len(saved_files),
            "filenames": saved_files
        })
    except Exception:
        # Cleanup any files that were saved before the error
        cleanup_files(saved_files, event.to_process_dir)
        raise

@upload_bp.route("/images/process-stream", methods=["GET"])
@require_auth
def process_images_stream(event_id):
    """Process images with SSE progress streaming."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    general_models = get_general_models()
    assign_moments = request.args.get('assign_moments', 'false').lower() == 'true'
    
    file_names_str = request.args.get('file_names', None)
    file_names = file_names_str.split(',') if file_names_str else None
    
    if file_names is None:
        files_to_track = [f for f in os.listdir(event.to_process_dir) 
                         if f.lower().endswith((".jpg", ".jpeg", ".png", ".bmp", ".tiff"))]
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
                cleanup_files(file_names, event.to_process_dir)
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
            if not processing_completed:
                cleanup_files(files_to_track, event.to_process_dir)
        except Exception:
            if not processing_completed:
                cleanup_files(files_to_track, event.to_process_dir)
            raise
        finally:
            if not processing_completed:
                cleanup_files(files_to_track, event.to_process_dir)
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


