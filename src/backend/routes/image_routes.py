from flask import Blueprint, jsonify, request, Response, stream_with_context
from werkzeug.utils import secure_filename
import os
import queue
import threading
import json

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event, get_event_details, get_general_models
from src.core.errors import Forbidden, DatabaseError

image_bp = Blueprint('images', __name__, url_prefix='/api/events/<event_id>')

@image_bp.route("/upload/limits", methods=["GET"])
@require_auth
def get_upload_limits(event_id):
    """Get upload limits and current usage."""
    event = get_event(event_id)
    event_details = get_event_details(event_id)
    
    images_count_limit = event_details['images_count_limit']
    current_count = event.models.get_images_count()
    image_size_limit_bytes = event_details['image_size_limit_bytes']
    
    available_count = max(0, images_count_limit - current_count) if images_count_limit > 0 else -1
    
    return jsonify({
        "image_size_limit_bytes": image_size_limit_bytes,
        "images_count_limit": images_count_limit,
        "current_images_count": current_count,
        "available_images_count": available_count
    })

@image_bp.route("/images", methods=["GET"])
@require_auth
def get_images(event_id):
    """List all accessible images summaries for the specific event."""
    event = get_event(event_id)
    images = event.models.get_entities('images')
    changes = [{
        'type': 'UPSERT',
        'entity': 'image',
        'items': images
    }]
    return jsonify({'changes': changes})

@image_bp.route("/images/<image_id>", methods=["GET"])
@require_auth
def get_image(event_id, image_id):
    """Get a specific image's details as changes."""
    event = get_event(event_id)
    if not event.models.is_accessible('images', image_id):
        return jsonify({"error": f"Image {image_id} not found or not accessible"}), 404

    image = event.models.get_entities('images', [image_id])
    albums = event.models.get_childs('images', image_id, 'albums')
    faces = event.models.get_childs('images', image_id, 'faces')
    groups = event.models.get_childs('images', image_id, 'groups')
    changes = [{
        'type': 'UPSERT',
        'entity': 'image',
        'items': image
    }]
    changes.append({
        'type': 'RELATION_SET',
        'relation': 'image.albums',
        'parentId': image_id,
        'entities': albums
    })
    changes.append({
        'type': 'RELATION_SET',
        'relation': 'image.faces',
        'parentId': image_id,
        'entities': faces
    })
    changes.append({
        'type': 'RELATION_SET',
        'relation': 'image.groups',
        'parentId': image_id,
        'entities': groups
    })
    moments = image.get(image_id, {}).get('moment_id')
    if moments:
        moments = event.models.get_entities('moments', [moments])
        changes.append({
            'type': 'RELATION_SET',
            'relation': 'image.moments',
            'parentId': image_id,
            'entities': moments
        })
    return jsonify({ 'changes': changes })

@image_bp.route("/images", methods=["DELETE"])
@require_auth
def delete_image(event_id):
    """Delete an image."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    if not image_ids:
        return jsonify({"error": "No image IDs provided"}), 400
    try:
        deleted_groups, parents = event.delete_images(image_ids)
        changes = [{
            'type': 'REMOVE',
            'entity': 'image',
            'ids': image_ids
        }]
        if deleted_groups:
            changes.append({
                'type': 'REMOVE',
                'entity': 'group',
                'ids': deleted_groups
            })
        for entity, entity_ids in parents.items():
            changes.append({
                'type': 'UPDATE',
                'entity': entity,
                'items': event.models.get_entities(entity, entity_ids)
            })
        return jsonify({"success": True, "changes": changes})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@image_bp.route("/images", methods=["POST"])
@require_auth
def upload_images(event_id):
    """Upload and process images."""
    
    event = get_event(event_id)
    general_models = get_general_models()
    
    if 'files' not in request.files:
        return jsonify({"error": "No files provided"}), 400
    
    files = request.files.getlist('files')
    assign_moments = request.form.get('assign_moments', 'false').lower() == 'true'
    
    if not files:
        return jsonify({"error": "No files provided"}), 400
    
    def cleanup_files(file_names, to_process_dir):
        """Delete files from to_process directory, ignoring if already deleted."""
        for filename in file_names:
            try:
                filepath = os.path.join(to_process_dir, filename)
                if os.path.exists(filepath):
                    os.remove(filepath)
            except Exception:
                pass
    
    saved_files = []
    try:
        # Save files to to_process directory
        for file in files:
            if file and file.filename:
                if not file.filename.lower().endswith(('.jpg', '.jpeg')):
                    continue
                
                filename = secure_filename(file.filename)
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
            return jsonify({"error": "No valid JPG files provided"}), 400
        
        # Process images
        result = general_models.process_new_images(event_id, file_names=saved_files, assign_moments=assign_moments)
        
        # Build changes for frontend
        changes = []
        
        processed_image_ids = result.get('processed_image_ids', [])
        if processed_image_ids:
            images = event.models.get_entities('images', processed_image_ids)
            
            all_parent_groups = set()
            for image_id in processed_image_ids:
                parent_groups = event.models.get_parents('images', image_id, 'groups')
                all_parent_groups.update(parent_groups)
            
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
        
    except ValueError as e:
        cleanup_files(saved_files, event.to_process_dir)
        return jsonify({"error": str(e)}), 400
    except Forbidden as e:
        cleanup_files(saved_files, event.to_process_dir)
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        cleanup_files(saved_files, event.to_process_dir)
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        cleanup_files(saved_files, event.to_process_dir)
        return jsonify({"error": str(e)}), 400

@image_bp.route("/images/upload", methods=["POST"])
@require_auth
def upload_files_only(event_id):
    """Upload files to to_process directory without processing."""
    event = get_event(event_id)

    if not event.models.get_current_profile().get('can_upload_and_delete_images', False):
        raise Forbidden("You are not allowed to upload and delete images")
    
    if 'files' not in request.files:
        return jsonify({"error": "No files provided"}), 400
    
    files = request.files.getlist('files')
    
    if not files:
        return jsonify({"error": "No files provided"}), 400
    
    try:
        saved_files = []
        for file in files:
            if file and file.filename:
                if not file.filename.lower().endswith(('.jpg', '.jpeg')):
                    continue
                
                filename = secure_filename(file.filename)
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
            return jsonify({"error": "No valid JPG files provided"}), 400
        
        return jsonify({
            "success": True,
            "files_saved": len(saved_files),
            "filenames": saved_files
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@image_bp.route("/images/process-stream", methods=["GET"])
@require_auth
def process_images_stream(event_id):
    """Process images with SSE progress streaming."""
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
                            
                            all_parent_groups = set()
                            for image_id in processed_image_ids:
                                parent_groups = event.models.get_parents('images', image_id, 'groups')
                                all_parent_groups.update(parent_groups)
                            
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
                        yield f"data: {json.dumps(final_response)}\n\n"
                        processing_completed = True
                        break
                        
                    elif progress.get('_step') == '_error_':
                        error_response = {
                            'step': 'error',
                            'message': progress.get('message', 'Unknown error')
                        }
                        yield f"data: {json.dumps(error_response)}\n\n"
                        break
                        
                    else:
                        yield f"data: {json.dumps(progress)}\n\n"
                        
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

