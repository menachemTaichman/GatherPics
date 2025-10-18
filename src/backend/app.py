from flask import Flask, jsonify, request, g, send_file, abort, make_response, Response, stream_with_context
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager,
    jwt_required,
    create_access_token,
    create_refresh_token,
    get_jwt_identity,
    get_jwt,
    set_access_cookies,
    set_refresh_cookies,
    unset_jwt_cookies,
)
from functools import wraps
from datetime import timedelta, datetime, timezone
import traceback
import os
import io
import zipfile
import secrets
import json
import queue
import threading
from werkzeug.utils import secure_filename

from src.core.event import Event
from src.core.general_models import GeneralModels
from src.core.errors import Forbidden, DatabaseError

app = Flask(__name__)
CORS(app, origins="*", supports_credentials=True)

# JWT Configuration
app.config['JWT_SECRET_KEY'] = 'your-secret-key-change-in-production'  # Change this in production
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(minutes=15)
app.config['JWT_REFRESH_TOKEN_EXPIRES'] = timedelta(days=30)
app.config['JWT_TOKEN_LOCATION'] = ['headers', 'cookies']
app.config['JWT_COOKIE_SAMESITE'] = 'Lax'
app.config['JWT_COOKIE_SECURE'] = False  # True in production over HTTPS
app.config['JWT_COOKIE_CSRF_PROTECT'] = False  # Simplify for now
jwt = JWTManager(app)

# --- Utility Functions ---
def _parse_bool(val: str | None, default: bool) -> bool:
    """Parse a boolean value from a string, with a default."""
    if val is None:
        return default
    return str(val).lower() in ('1', 'true', 'yes', 'y', 'on')

def get_general_models(profile_id=None):
    """Get general models instance with profile context."""
    if profile_id is None:
        profile_id = getattr(g, 'profile_id', None)
    
    return GeneralModels(profile_id=profile_id)

def get_event(event_id, profile_id=None):
    """Get event instance with profile context."""
    if profile_id is None:
        profile_id = getattr(g, 'profile_id', None)
    
    return Event(event_id, profile_id=profile_id)

def get_event_details(event_id, profile_id=None):
    """Get event details with profile context."""
    general_models = get_general_models(profile_id)
    event = general_models.get_entities('events', event_id)
    return event

# --- Auth Decorator ---
def require_auth(f):
    @wraps(f)
    @jwt_required()
    def decorated(*args, **kwargs):
        g.profile_id = get_jwt_identity()
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

@app.errorhandler(403)
def forbidden(error):
    return jsonify({"error": "Forbidden", "message": str(error)}), 403

# ==============================================================================
# I. PUBLIC & AUTH ENDPOINTS
# ==============================================================================

@app.route("/api/events", methods=["GET"])
def get_events():
    """Get all available events."""
    try:
        general_models = get_general_models()
        events = general_models.get_entities('events')
        return jsonify(events)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/resolve", methods=["GET"])
def resolve_event_url():
    """Resolve an event URL to its ID and basic info."""
    event_url = request.args.get('url')
    if not event_url:
        return jsonify({"error": "URL parameter is required"}), 400
    
    try:
        general_models = get_general_models()
        event = general_models.get_event_by_url(event_url)
        
        if event:
            return jsonify({'event': event})
        else:
            return jsonify({"error": f"Event not found: {event_url}"}), 404
    except Exception as e:
        return bad_request(e)

@app.route("/api/auth/login", methods=["POST"])
def login():
    """Authenticate user and issue access + refresh tokens."""
    data = request.json or {}
    label = data.get('label', '').strip()
    password = data.get('password', '')
    
    if not label:
        return jsonify({"error": "Profile label is required"}), 400
    
    try:
        general_models = GeneralModels()
        
        # Authenticate profile
        profile_id = general_models.authenticate_profile(label, password)
        
        if not profile_id:
            return jsonify({"error": "Invalid credentials"}), 401
        
        # Get profile details
        profile = general_models.get_entities('profiles', profile_id)
        
        # Create tokens
        access_token = create_access_token(identity=profile_id)
        refresh_token_jwt = create_refresh_token(identity=profile_id)
        
        # Generate secure random token for database
        refresh_token_db = secrets.token_urlsafe(32)
        
        # Store refresh token in database
        expires_at = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        
        # Get request metadata
        user_agent = request.headers.get('User-Agent', '')
        ip_address = request.remote_addr
        
        general_models.create_refresh_token(
            profile_id=profile_id,
            token=refresh_token_db,
            expires_at=expires_at,
            user_agent=user_agent,
            ip_address=ip_address
        )
        
        # Create response
        response = make_response(jsonify({
            "access_token": access_token,
            "profile": profile
        }))
        
        # Set access token as cookie for image requests
        set_access_cookies(response, access_token)
        
        # Set refresh token as httpOnly cookie
        response.set_cookie(
            'refresh_token',
            refresh_token_db,
            httponly=True,
            secure=False,  # True in production
            samesite='Lax',
            max_age=30 * 24 * 60 * 60  # 30 days in seconds
        )
        
        return response
        
    except Exception as e:
        print(f"Login error: {e}")
        traceback.print_exc()
        return jsonify({"error": "Authentication failed"}), 500

@app.route("/api/auth/refresh", methods=["POST"])
def refresh():
    """Exchange refresh token for new access token."""
    refresh_token = request.cookies.get('refresh_token')
    
    if not refresh_token:
        return jsonify({"error": "Refresh token not found"}), 401
    
    try:
        general_models = GeneralModels()
        
        # Validate refresh token
        profile_id = general_models.validate_refresh_token(refresh_token)
        
        if not profile_id:
            return jsonify({"error": "Invalid or expired refresh token"}), 401
        
        # Create new access token
        access_token = create_access_token(identity=profile_id)
        
        # Create response and set access token cookie
        response = make_response(jsonify({
            "access_token": access_token
        }))
        
        set_access_cookies(response, access_token)
        
        return response
        
    except Exception as e:
        print(f"Refresh error: {e}")
        traceback.print_exc()
        return jsonify({"error": "Token refresh failed"}), 500

@app.route("/api/auth/logout", methods=["POST"])
def logout():
    """Logout user and revoke refresh token."""
    refresh_token = request.cookies.get('refresh_token')
    
    if refresh_token:
        try:
            general_models = GeneralModels()
            general_models.revoke_refresh_token(refresh_token)
        except Exception as e:
            print(f"Logout error: {e}")
    
    response = make_response(jsonify({"message": "Logout successful"}))
    
    # Clear JWT cookies (access token)
    unset_jwt_cookies(response)
    
    # Clear refresh token cookie
    response.set_cookie(
        'refresh_token',
        '',
        httponly=True,
        secure=False,
        samesite='Lax',
        max_age=0
    )
    
    return response

# ==============================================================================
# II. GENERAL EVENT ENDPOINTS
# ==============================================================================

@app.route("/api/events/<event_id>/upload/limits", methods=["GET"])
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

# ==============================================================================
# V. IMAGES ENDPOINTS
# ==============================================================================

# get images
@app.route("/api/events/<event_id>/images", methods=["GET"])
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

@app.route("/api/events/<event_id>/images/<image_id>", methods=["GET"])
@require_auth
def get_image(event_id, image_id):
    """Get a specific image's details as changes."""
    event = get_event(event_id)
    if not event.models.is_accessible('images', image_id):
        return not_found(f"Image {image_id} not found or not accessible")

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

# edit images
@app.route("/api/events/<event_id>/images", methods=["DELETE"])
@require_auth
def delete_image(event_id):
    """Delete an image."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    if not image_ids:
        return bad_request("No image IDs provided")
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
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/images", methods=["POST"])
@require_auth
def upload_images(event_id):
    """Upload and process images."""
    
    event = get_event(event_id)
    general_models = get_general_models()
    
    # Check if files were uploaded
    if 'files' not in request.files:
        return jsonify({"error": "No files provided"}), 400
    
    files = request.files.getlist('files')
    assign_moments = request.form.get('assign_moments', 'false').lower() == 'true'
    
    if not files:
        return jsonify({"error": "No files provided"}), 400
    
    try:
        # Save files to to_process directory
        saved_files = []
        for file in files:
            if file and file.filename:
                # Check file extension
                if not file.filename.lower().endswith(('.jpg', '.jpeg')):
                    continue
                
                filename = secure_filename(file.filename)
                filepath = os.path.join(event.to_process_dir, filename)
                
                # Handle duplicate filenames
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
        result = general_models.process_new_images(event_id, assign_moments=assign_moments)
        
        # Build changes for frontend
        changes = []
        
        # Get all processed images
        processed_image_ids = result.get('processed_image_ids', [])
        if processed_image_ids:
            images = event.models.get_entities('images', processed_image_ids)
            
            # Get all parent groups for the images
            all_parent_groups = set()
            for image_id in processed_image_ids:
                parent_groups = event.models.get_parents('images', image_id, 'groups')
                all_parent_groups.update(parent_groups)
            
            changes.append({
                'type': 'UPSERT',
                'entity': 'image',
                'items': images,
            })
            
            # Add relation changes for each group
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
            
            # Handle moment assignments
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
        
        return jsonify({
            "success": True,
            "images_processed": result['images_processed'],
            "faces_detected": result['faces_detected'],
            "groups_created": result['groups_created'],
            "errors": result.get('errors', []),
            "changes": changes
        })
        
    except ValueError as e:
        # Validation errors (limits exceeded, etc.)
        return jsonify({"error": str(e)}), 400
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/images/upload", methods=["POST"])
@require_auth
def upload_files_only(event_id):
    """Upload files to to_process directory without processing."""
    event = get_event(event_id)
    
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
        return bad_request(e)

@app.route("/api/events/<event_id>/images/process-stream", methods=["GET"])
@require_auth
def process_images_stream(event_id):
    """Process images with SSE progress streaming."""
    event = get_event(event_id)
    general_models = get_general_models()
    assign_moments = request.args.get('assign_moments', 'false').lower() == 'true'
    
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
                    assign_moments=assign_moments,
                    progress_callback=progress_callback
                )
                result_container['data'] = result
                progress_queue.put({'_step': '_done_', 'result': result})
            except Exception as e:
                error_container['error'] = str(e)
                progress_queue.put({'_step': '_error_', 'message': str(e)})
        
        # Start processing in background thread
        thread = threading.Thread(target=process_task, daemon=True)
        thread.start()
        
        # Stream progress updates
        try:
            while True:
                try:
                    progress = progress_queue.get(timeout=30)
                    
                    if progress.get('_step') == '_done_':
                        # Build changes for frontend
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
                        
                        final_response = {
                            'step': 'complete',
                            'result': result,
                            'changes': changes
                        }
                        yield f"data: {json.dumps(final_response)}\n\n"
                        break
                        
                    elif progress.get('_step') == '_error_':
                        error_response = {
                            'step': 'error',
                            'message': progress.get('message', 'Unknown error')
                        }
                        yield f"data: {json.dumps(error_response)}\n\n"
                        break
                        
                    else:
                        # Send progress update
                        yield f"data: {json.dumps(progress)}\n\n"
                        
                except queue.Empty:
                    # Send keepalive comment
                    yield ": keepalive\n\n"
                    
        except GeneratorExit:
            pass
        finally:
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

# ==============================================================================
# III. GROUPS (PERSONS) ENDPOINTS
# ==============================================================================

# get groups
@app.route("/api/events/<event_id>/groups", methods=["GET"])
@require_auth
def get_groups(event_id):
    """List all accessible group summaries for the specific event."""
    event = get_event(event_id)
    groups = event.models.get_groups()
    changes = [{
        'type': 'UPSERT',
        'entity': 'group',
        'items': groups
    }]
    return jsonify({ 'changes': changes })

@app.route("/api/events/<event_id>/groups/<group_id>", methods=["GET"])
@require_auth
def get_group(event_id, group_id):
    """Get a specific group's details as changes, including its paginated images and faces mapping."""
    event = get_event(event_id)

    if not event.models.is_accessible('groups', group_id):
        return not_found(f"Group {group_id} not found or not accessible")

    filter_groups_str = request.args.get('filter_groups')
    filter_group_ids = filter_groups_str.split(',') if filter_groups_str else []
    filter_mode = request.args.get('filter_mode', 'and')
    only_mode = _parse_bool(request.args.get('only_selected'), False)

    filter = filter_group_ids or only_mode
    changes = []
    result = {'changes': changes, 'filter': filter}    
    group = event.models.get_groups([group_id], faces_mapping=not filter)
    result['changes'].append({
        'type': 'UPSERT',
        'entity': 'group',
        'items': group
    })
    group_ids = [group_id] + filter_group_ids
    image_ids, faces_mapping, images = event.models.get_filtered_images(
        group_ids,
        mode=filter_mode,
        only=only_mode,
    )
    if filter:
        result['filtered_ids'] = image_ids
        result['faces_mapping'] = faces_mapping
        result['changes'].append({
            'type': 'INSERT',
            'entity': 'image',
            'items': images
        })
    else:
        result['changes'].append({
            'type': 'RELATION_SET',
            'relation': 'group.images',
            'parentId': group_id,
            'entities': images
        })

    return jsonify(result)

@app.route("/api/events/<event_id>/groups/related", methods=["GET"])
@require_auth
def get_related_groups(event_id):
    """Get related groups based on a set of selected groups and base images."""
    event = get_event(event_id)

    image_ids_str = request.args.get('image_ids', '')
    selected_groups_str = request.args.get('selected_groups', '')

    image_ids = image_ids_str.split(',') if image_ids_str else []
    selected_groups = selected_groups_str.split(',') if selected_groups_str else []

    group_ids = selected_groups

    group_ids, groups = event.models.get_related_groups(
        group_ids=group_ids,
        base_image_ids=image_ids
    )
    return jsonify({"related_groups": groups, "related_group_ids": group_ids})

# edit groups
@app.route("/api/events/<event_id>/groups/check-name", methods=["POST"])
@require_auth
def check_group_name(event_id):
    """Check if a group name already exists."""
    event = get_event(event_id)
    data = request.json or {}
    label = data.get('label', '')
    exclude_group_id = data.get('exclude_group_id', '')
    if not label:
        return jsonify({"error": "Label is required"}), 400
    conflict_group_id = event.models.is_exists('groups', {'label': label}, exclude_id=exclude_group_id)
    if conflict_group_id:
        conflicting_group = event.models.get_groups([conflict_group_id])
        response = {"conflict": True, "conflicting_group": conflict_group_id}
        if conflicting_group:
            changes = [{
                'type': 'INSERT',
                'entity': 'group',
                'items': conflicting_group
            }]
            response['changes'] = changes
        
        return jsonify(response)

    else:
        return jsonify({"conflict": False})

@app.route("/api/events/<event_id>/groups/<group_id>", methods=["PUT"])
@require_auth
def update_group(event_id, group_id):
    """Update a group."""
    event = get_event(event_id)
    if not event.models.is_accessible('groups', group_id):
        return not_found(f"Group {group_id} not found or not accessible")
        
    data = request.json or {}
    try:        
        changes = []
        allowed_fields = {'label', 'representative_face'}
        sanitized = {k: v for k, v in data.items() if k in allowed_fields}
        if sanitized:
            event.models.edit('groups', group_id, sanitized)
            changes.append({
                'type': 'UPDATE',
                'entity': 'group',
                'items': event.models.get_groups([group_id])
            })

        return jsonify({"success": True, "changes": changes})
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

# transfer faces between groups
@app.route("/api/events/<event_id>/groups/<group_id>/faces", methods=["GET"])
@require_auth
def get_faces_group_in_image(event_id, group_id):
    """Get the faces in an image from a group."""
    event = get_event(event_id)
    image_id = request.args.get('image_id')
    if not image_id:
        return jsonify({"error": "Image ID is required"}), 400
    faces = event.models.get_faces_group_in_image(group_id, image_id)
    return jsonify({"faces": faces})

@app.route("/api/events/<event_id>/groups/transfer-faces", methods=["POST"])
@require_auth
def transfer_faces(event_id):
    """Transfer faces between groups."""
    event = get_event(event_id)
    data = request.json or {}
    source_group_id = data.get('source_group_id')
    target_group_id = data.get('target_group_id')
    new_group_name = data.get('new_group_name', None)
    face_ids = data.get('face_ids', None)
    
    if not target_group_id and not new_group_name:
        return jsonify({"error": "Missing required parameters"}), 400
    
    try:
        result = event.models.add_faces_to_group(
            face_ids=face_ids,
            target_group_id=target_group_id,
            new_group_name=new_group_name,
            source_group_id=source_group_id
        )

        detached_groups = result['detached_groups']
        len_faces_added = result['length_faces_added']
        images_added = result['images_added']
        source_deleted = result['source_deleted']
        new_group_created = result['new_group_created']
        target_group_id = result['target_group_id']

        images_added_ids = list(images_added.keys())

        changes = []
        for group_id, images_ids in detached_groups.items():
            changes.append({
                'type': 'RELATION_REMOVE',
                'relation': 'group.images',
                'parentId': group_id,
                'ids': images_ids
            })

        images_added_entities = event.models.get_childs('groups', target_group_id, 'images', images_added_ids)
        changes.append({
            'type': 'RELATION_ADD',
            'relation': 'group.images',
            'parentId': target_group_id,
            'entities': images_added_entities
        })
        changes.append({
            'type': 'UPDATE',
            'entity': 'group',
            'items': event.models.get_groups(list(detached_groups.keys()) + [target_group_id], faces_mapping=True)
        })
        for image_id, faces in images_added.items():
            changes.append({
                'type': 'RELATION_ADD',
                'relation': 'image.faces',
                'parentId': image_id,
                'entities': faces
            })
            changes.append({
                'type': 'RELATION_ADD',
                'relation': 'image.groups',
                'parentId': image_id,
                'entities': event.models.get_entities('groups', [target_group_id])
            })
        if source_deleted:
            changes.append({
                'type': 'REMOVE',
                'entity': 'group',
                'ids': [source_group_id]
            })
        response = {
            "success": True,
            'source_deleted': source_deleted,
            'new_group_created': new_group_created,
            'target_group_id': target_group_id,
            'len_added': len_faces_added,
            'images_added': images_added_ids,
            'changes': changes
        }
        return jsonify(response)
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

# ==============================================================================
# IV. MOMENTS (TIMELINE) ENDPOINTS
# ==============================================================================

# get moments
@app.route("/api/events/<event_id>/moments", methods=["GET"])
@require_auth
def get_moments(event_id):
    """List all accessible moment summaries for the specific event."""
    event = get_event(event_id)
    moments = event.models.get_entities('moments')
    changes = [{
        'type': 'UPSERT',
        'entity': 'moment',
        'items': moments
    }]
    return jsonify({'changes': changes})

@app.route("/api/events/<event_id>/moments/<moment_id>", methods=["GET"])
@require_auth
def get_moment(event_id, moment_id):
    """Get a specific moment's details as changes."""
    event = get_event(event_id)
    if not event.models.is_accessible('moments', moment_id):
        return not_found(f"Moment {moment_id} not found or not accessible")

    moment = event.models.get_entities('moments', [moment_id])
    images = event.models.get_childs('moments', moment_id, 'images')
    changes = [{
        'type': 'UPSERT',
        'entity': 'moment',
        'items': moment
    },
    {
        'type': 'RELATION_SET',
        'relation': 'moment.images',
        'parentId': moment_id,
        'entities': images
    }]
    
    return jsonify({ 'changes': changes })

# edit moments
@app.route("/api/events/<event_id>/moments/check-name", methods=["POST"])
@require_auth
def check_moment_name(event_id):
    """Check if a moment name already exists."""
    event = get_event(event_id)
    data = request.json or {}
    label = data.get('label', '')
    exclude_moment_id = data.get('exclude_moment_id', '')
    if not label:
        return jsonify({"error": "Label is required"}), 400
    conflict_moment_id = event.models.is_exists('moments', {'label': label}, exclude_id=exclude_moment_id)
    return jsonify({"conflict": bool(conflict_moment_id)})

@app.route("/api/events/<event_id>/moments", methods=["POST"])
@require_auth
def create_moment(event_id):
    """Create a new moment."""
    event = get_event(event_id)
    data = request.json or {}
    
    try:
        allowed_fields = {'label', 'description', 'start', 'end', 'representative_image'}
        sanitized = {k: v for k, v in data.items() if k in allowed_fields}
        if sanitized:
            moment_id = event.models.add('moments', sanitized)
            created_moment = event.models.get_entities('moments', [moment_id])
            changes = [{
                'type': 'UPSERT',
                'entity': 'moment',
                'items': created_moment
            }]
            response = {"success": True, "moment_id": moment_id, "changes": changes}
        else:
            response = {"success": False}
        return jsonify(response)
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments/<moment_id>", methods=["PUT"])
@require_auth
def update_moment(event_id, moment_id):
    """Update a moment's metadata."""
    event = get_event(event_id)
    if not event.models.is_accessible('moments', moment_id):
        return not_found(f"Moment {moment_id} not found or not accessible")
        
    data = request.json or {}
    try:
        allowed_fields = {'label', 'description', 'start', 'end', 'representative_image'}
        sanitized = {k: v for k, v in data.items() if k in allowed_fields}
        if sanitized:
            event.models.edit('moments', moment_id, sanitized)
            updated_moment = event.models.get_entities('moments', [moment_id])
            changes = [{
                'type': 'UPDATE',
                'entity': 'moment',
                'items': updated_moment
            }]
            response = {"success": True, "changes": changes}
        else:
            response = {"success": False}
        return jsonify(response)
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments/<moment_id>", methods=["DELETE"])
@require_auth
def delete_moment(event_id, moment_id):
    """Delete a moment."""
    event = get_event(event_id)
    if not event.models.is_accessible('moments', moment_id):
        return not_found(f"Moment {moment_id} not found or not accessible")
    
    try:
        event.models.delete('moments', moment_id)
        
        response = {"success": True, "deleted_ids": [moment_id]}
        response['changes'] = [{
            'type': 'REMOVE',
            'entity': 'moment',
            'ids': [moment_id]
        }]
        return jsonify(response)
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

# edit moment images
@app.route("/api/events/<event_id>/moments/images", methods=["GET"])
@require_auth
def get_images_to_moments(event_id):
    """Get all images with data for selecting in moment editor."""
    event = get_event(event_id)
    images = event.models.get_images_to_moments()
    changes = [{
        'type': 'UPSERT',
        'entity': 'image',
        'items': images
    }]
    return jsonify({'changes': changes})

def _edit_moment_images(event, moment_id, image_ids, add: bool):
    """Helper: Add or remove images from a moment, return response with changes."""
    updated_image_ids, detached_moments = event.models.edit_childs('moments', moment_id, child='images', child_ids=image_ids, add=add)
    changes = []
    if updated_image_ids:
        for detached_moment_id, detached_image_ids in detached_moments.items():
            changes.append({
                'type': 'RELATION_REMOVE',
                'relation': 'moment.images',
                'parentId': detached_moment_id,
                'ids': detached_image_ids
            })
        changes.append({
            'type': 'UPSERT',
            'entity': 'moment',
            'items': event.models.get_entities('moments', list(detached_moments.keys()) + [moment_id])
        })
        changes.append({
            'type': 'UPSERT',
            'entity': 'image',
            'items': event.models.get_entities('images', updated_image_ids)
        })
        if add:
            changes.append({
                'type': 'RELATION_ADD',
                'relation': 'moment.images',
                'parentId': moment_id,
                'entities': event.models.get_entities('images', updated_image_ids)
            })
        else:
            changes.append({
                'type': 'RELATION_REMOVE',
                'relation': 'moment.images',
                'parentId': moment_id,
                'ids': updated_image_ids
            })

    return {
        "success": True,
        f'len_{"added" if add else "removed"}': len(updated_image_ids),
        "changes": changes
    }

@app.route("/api/events/<event_id>/moments/<moment_id>/images", methods=["POST"])
@require_auth
def add_images_to_moment(event_id, moment_id):
    """Add images to a moment."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    
    try:
        print(moment_id)
        print(image_ids)
        response = _edit_moment_images(event, moment_id, image_ids, add=True)

        return jsonify(response)
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments/<moment_id>/images", methods=["DELETE"])
@require_auth
def remove_images_from_moment(event_id, moment_id):
    """Remove images from a moment."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    try:
        response = _edit_moment_images(event, moment_id, image_ids, add=False)
        return jsonify(response)
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/moments/moments/images", methods=["DELETE"])
@require_auth
def remove_images_from_moments(event_id):
    """Remove images from a moment."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    try:
        detached_moments = event.models.remove_images_from_moments(image_ids)
        changes = []
        for moment_id, image_ids in detached_moments.items():
            changes.append({
                'type': 'RELATION_REMOVE',
                'relation': 'moment.images',
                'parentId': moment_id,
                'ids': image_ids
            })
            changes.append({
                'type': 'UPSERT',
                'entity': 'moment',
                'items': event.models.get_entities('moments', list(detached_moments.keys()))
            })
            changes.append({
                'type': 'UPSERT',
                'entity': 'image',
                'items': event.models.get_entities('images', image_ids)
            })
            return jsonify({"success": True, "changes": changes})
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

# ==============================================================================
# V. ALBUMS ENDPOINTS
# ==============================================================================

# get albums
@app.route("/api/events/<event_id>/albums", methods=["GET"])
@require_auth
def get_albums(event_id):
    """List all accessible album summaries for the specific event."""
    exclude_defaults = _parse_bool(request.args.get('exclude_defaults'), False)
    event = get_event(event_id)
    table = 'albums_actual' if exclude_defaults else 'albums'
    albums = event.models.get_entities(table)
    changes = [{
        'type': 'INSERT',
        'entity': 'album',
        'items': albums
    }]
    return jsonify({'changes': changes})

@app.route("/api/events/<event_id>/albums/<album_id>", methods=["GET"])
@require_auth
def get_album(event_id, album_id):
    """Get a specific album's details as changes."""
    event = get_event(event_id)
    if not event.models.is_accessible('albums', album_id):
        return not_found(f"Album {album_id} not found or not accessible")

    album = event.models.get_entities('albums', [album_id])
    images = event.models.get_childs('albums', album_id, 'images')
    changes = [{
        'type': 'UPSERT',
        'entity': 'album',
        'items': album
    }]
    changes.append({
        'type': 'RELATION_SET',
        'relation': 'album.images',
        'parentId': album_id,
        'entities': images
    })
    return jsonify({ 'changes': changes })

# edit albums
@app.route("/api/events/<event_id>/albums/check-name", methods=["POST"])
@require_auth
def check_album_name(event_id):
    """Check if an album name already exists."""
    event = get_event(event_id)
    data = request.json or {}
    label = data.get('label', '')
    exclude_album_id = data.get('exclude_album_id', '')
    if not label:
        return jsonify({"error": "Label is required"}), 400
    conflict_album_id = event.models.is_exists('albums', {'label': label}, exclude_id=exclude_album_id)
    return jsonify({"conflict": bool(conflict_album_id), "conflicting_album": conflict_album_id})

@app.route("/api/events/<event_id>/albums", methods=["POST"])
@require_auth
def create_album(event_id):
    """Create a new album."""
    event = get_event(event_id)
    data = request.json or {}
    
    try:
        allowed_fields = {'label', 'description', 'representative_image'}
        sanitized = {k: v for k, v in data.items() if k in allowed_fields}
        if sanitized:
            album_id = event.models.add('albums', sanitized)
            created_album = event.models.get_entities('albums', [album_id])
            changes = [{
                'type': 'UPSERT',
                'entity': 'album',
                'items': created_album
            }]
            response = {"success": True, "album_id": album_id, "changes": changes}
        else:
            response = {"success": False}
        return jsonify(response)
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/albums/<album_id>", methods=["PUT"])
@require_auth
def update_album(event_id, album_id):
    """Update an album's details."""
    event = get_event(event_id)
    album = event.models.get_entities('albums', album_id)
    if not album:
        return not_found(f"Album {album_id} not found or not accessible")

    data = request.json or {}
    if (album.get('label', '').lower() in ('archive', 'favorites')) and 'label' in data:
        data.pop('label', None)

    try:
        allowed = {'label', 'description', 'representative_image'}
        sanitized = {k: v for k, v in data.items() if k in allowed}
        if sanitized:
            event.models.edit('albums', album_id, sanitized)

            updated = event.models.get_entities('albums', [album_id])
            changes = [{
                'type': 'UPDATE',
                'entity': 'album',
                'items': updated
            }]
            response = {"success": True, "changes": changes}
        else:
            response = {"success": False}
        return jsonify(response)
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/albums/<album_id>", methods=["DELETE"])
@require_auth
def delete_album(event_id, album_id):
    """Delete an album."""
    event = get_event(event_id)
    if not event.models.is_accessible('albums', album_id):
        return not_found(f"Album {album_id} not found or not accessible")
    
    # Prevent deletion of default albums (favorites, archive)
    album = event.models.get_entities('albums', album_id)
    if album and album.get('label', '').lower() in ('archive', 'favorites'):
        return jsonify({"error": "Cannot delete default albums"}), 400
    
    try:
        event.models.delete('albums', album_id)
        
        response = {"success": True, "deleted_ids": [album_id]}
        response['changes'] = [{
            'type': 'REMOVE',
            'entity': 'album',
            'ids': [album_id]
        }]
        return jsonify(response)
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

# edit album images
def _edit_album_images(event, album_id, image_ids, add: bool):
    """Helper: Add or remove images from an album, return response with changes."""
    updated_image_ids, _ = event.models.edit_childs(
        'albums', album_id, child='images', child_ids=image_ids, add=add
    )
    changes = []
    if updated_image_ids:
        album = event.models.get_entities('albums', [album_id])
        changes.append({
            'type': 'UPDATE',
            'entity': 'album',
            'items': album
        })
        if add:
            changes.append({
                'type': 'RELATION_ADD',
                'relation': 'album.images',
                'parentId': album_id,
                'entities': event.models.get_entities('images', updated_image_ids)
            })
        else:
            changes.append({
                'type': 'RELATION_REMOVE',
                'relation': 'album.images',
                'parentId': album_id,
                'ids': updated_image_ids
            })

        is_default_album = album_id in [
            event.models.get_favorites_album(),
            event.models.get_archive_album()
        ]
        if is_default_album:
            changes.append({
                'type': 'UPDATE',
                'entity': 'image',
                'items': event.models.get_entities('images', updated_image_ids)
            })
            if album_id == event.models.get_archive_album():
                for image_id in updated_image_ids:
                    parents = event.models.get_parents('images', image_id)
                    for entity, parent_ids in parents.items():
                        changes.append({
                            'type': 'UPDATE',
                            'entity': entity,
                            'items': event.models.get_entities(entity, parent_ids)
                        })
        else:
            for image_id in updated_image_ids:
                if add:
                    changes.append({
                        'type': 'RELATION_ADD',
                        'relation': 'image.albums',
                        'parentId': image_id,
                        'entities': album
                    })
                else:
                    changes.append({
                        'type': 'RELATION_REMOVE',
                        'relation': 'image.albums',
                        'parentId': image_id,
                        'ids': [album_id]
                    })

    return {
        "success": True,
        f'len_{"added" if add else "removed"}': len(updated_image_ids),
        "changes": changes
    }

@app.route("/api/events/<event_id>/albums/<album_id>/images", methods=["POST"])
@require_auth
def add_images_to_album(event_id, album_id):
    """Add images to an album."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    try:
        response = _edit_album_images(event, album_id, image_ids, add=True)
        return jsonify(response)
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/albums/<album_id>/images", methods=["DELETE"])
@require_auth
def remove_images_from_album(event_id, album_id):
    """Remove images from an album."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    try:
        response = _edit_album_images(event, album_id, image_ids, add=False)
        return jsonify(response)
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/albums/favorites/images", methods=["PUT"])
@require_auth
def toggle_favorites_images(event_id):
    """Add or remove multiple images from favorites album."""
    event = get_event(event_id)
    
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    # TODO: is_favorite means it is already there? is should be and than to replace add=is_favorite with add=not is_favorite?
    is_favorite = data.get('is_favorite', False)
    
    if not image_ids:
        return bad_request("No image IDs provided")
    
    try:
        favorites_album_id = event.models.get_favorites_album()
        response = _edit_album_images(event, favorites_album_id, image_ids, add=is_favorite)
        return jsonify(response)
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/albums/archive/images", methods=["PUT"])
@require_auth
def toggle_archive_images(event_id):
    """Add or remove multiple images from archive album."""
    event = get_event(event_id)
    
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    is_archived = data.get('is_archived', False)
    
    if not image_ids:
        return bad_request("No image IDs provided")
    
    try:
        archive_album_id = event.models.get_archive_album()
        response = _edit_album_images(event, archive_album_id, image_ids, add=is_archived)
        return jsonify(response)
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

# ==============================================================================
# VI. PROFILES ENDPOINTS
# ==============================================================================

# get profiles
@app.route("/api/profiles/current", methods=["GET"])
@require_auth
def get_current_profile():
    general_models = get_general_models()
    profile = general_models.get_entities('profiles', [get_jwt_identity()])
    return jsonify({"profile": profile})

@app.route("/api/profiles/current/preferences", methods=["GET"])
@require_auth
def get_current_profile_preferences():
    """Get preferences for the current profile."""
    general_models = get_general_models()
    profile_id = get_jwt_identity()
    
    try:
        preferences = general_models.get_profile_preferences(profile_id)
        return jsonify({"preferences": preferences})
    except Exception as e:
        return bad_request(e)

@app.route("/api/profiles/current/preferences", methods=["PUT"])
@require_auth
def update_current_profile_preferences():
    """Update a single preference for the current profile."""
    general_models = get_general_models()
    profile_id = get_jwt_identity()
    
    data = request.json or {}
    preference_group = data.get('preference_group')
    preference_key = data.get('preference_key')
    preference_value = data.get('preference_value')
    
    if not preference_group or not preference_key or preference_value is None:
        return jsonify({"error": "preference_group, preference_key, and preference_value are required"}), 400
    
    try:
        general_models.update_profile_preferences(profile_id, preference_group, preference_key, preference_value)
        return jsonify({"success": True})
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/profiles", methods=["GET"])
@require_auth
def get_event_profiles(event_id):
    event = get_event(event_id)
    general_models = get_general_models()
    profiles = event.models.get_entities('profiles')
    changes = [{
        'type': 'UPSERT',
        'entity': 'profile',
        'items': profiles
    }]
    profiles = general_models.get_entities('profiles', list(profiles.keys()))
    changes.append({
        'type': 'UPSERT',
        'entity': 'profile',
        'items': profiles
    })
    return jsonify({"changes": changes})

@app.route("/api/events/<event_id>/profiles/<profile_id>", methods=["GET"])
@require_auth
def get_event_profile(event_id, profile_id):
    event = get_event(event_id)
    changes = [{
        'type': 'UPSERT',
        'entity': 'profile',
        'items': event.models.get_entities('profiles', [profile_id])
    },
    {
        'type': 'RELATION_ADD',
        'relation': 'profile.images',
        'parentId': profile_id,
        'entities': event.models.get_childs('profiles', profile_id, 'images')
    },
    {
        'type': 'RELATION_ADD',
        'relation': 'profile.albums',
        'parentId': profile_id,
        'entities': event.models.get_childs('profiles', profile_id, 'albums')
    }
    ]
    return jsonify({"changes": changes})

@app.route("/api/events/<event_id>/profiles/current/archived-access", methods=["GET"])
@require_auth
def get_archived_access(event_id):
    """Get archived access for the current profile."""
    event = get_event(event_id)
    return jsonify({"archived_access": bool(event.models.get_archive_album())})

@app.route("/api/events/<event_id>/profiles/current/favorites-access", methods=["GET"])
@require_auth
def get_favorites_access(event_id):
    """Get favorites access for the current profile."""
    event = get_event(event_id)
    return jsonify({"favorites_access": bool(event.models.get_favorites_album())})

@app.route("/api/profiles/<profile_id>/password", methods=["GET"])
@require_auth
def get_profile_password(profile_id):
    general_models = get_general_models()
    try:
        return jsonify({"password": general_models.get_profile_password(profile_id)})
    except Forbidden as e:
        return forbidden(e)

@app.route("/api/profiles/<profile_id>/password", methods=["PUT"])
@require_auth
def update_profile_password(profile_id):
    general_models = get_general_models()
    data = request.json or {}
    password = data.get('password', '')
    try:
        general_models.edit('profiles', profile_id, {'password': password})
        return jsonify({"success": True})
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/profiles/<profile_id>/images/check", methods=["POST"])
@require_auth
def check_images_from_profile(event_id, profile_id):
    """Check accessible images for a profile."""
    event = get_event(event_id)
    if not (event.models.is_profile_manager() and event.models.is_accessible('profiles', profile_id)):
        return forbidden(f"Access denied")
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    profile = event.models.get_entities('profiles', profile_id)
    have_all = bool(profile['all_images'])
    len_accessible = len(event.models.get_childs('profiles', profile_id, 'images', image_ids, return_ids=True, within=not have_all))
    return jsonify({"len_accessible": len_accessible, "len_inaccessible": len(image_ids) - len_accessible})

@app.route("/api/events/<event_id>/profiles/<profile_id>/albums/check", methods=["POST"])
@require_auth
def check_albums_from_profile(event_id, profile_id):
    """Check accessible albums for a profile."""
    event = get_event(event_id)
    if not (event.models.is_profile_manager() and event.models.is_accessible('profiles', profile_id)):
        return forbidden(f"Access denied")
    data = request.json or {}
    album_ids = data.get('album_ids', [])
    profile = event.models.get_entities('profiles', profile_id)
    have_all = bool(profile['all_albums'])
    len_accessible = len(event.models.get_childs('profiles', profile_id, 'albums', album_ids, return_ids=True, within=not have_all))
    return jsonify({"len_accessible": len_accessible, "len_inaccessible": len(album_ids) - len_accessible})

# edit profiles
@app.route("/api/events/profiles/check-name", methods=["POST"])
@require_auth
def check_profile_name():
    """Check if a profile name already exists."""
    general_models = get_general_models()
    data = request.json or {}
    label = data.get('label', '')
    exclude_profile_id = data.get('exclude_profile_id', None)
    if not label:
        return jsonify({"error": "Label is required"}), 400
    
    conflict_profile_id = general_models.is_exists('profiles', {'label': label}, exclude_id=exclude_profile_id)

    return jsonify({"conflict": bool(conflict_profile_id)})

def _create_profile(data: dict, event_id: str | None = None):
    general_models = get_general_models()
    label = data.get('label', '')
    if not label:
        raise ValueError("Label is required")
    fields = {'label': label}
    if event_id:
        fields['restricted_to_event'] = event_id
    if general_models.is_exists('profiles', fields):
        raise ValueError("Profile with this label already exists")

    hierarchy_rank = data.get('hierarchy_rank', 0)
    password = data.get('password', '')

    can_delete_event = data.get('can_delete_event', False)
    can_upload_and_delete_images = data.get('can_upload_and_delete_images', 0)
    can_edit = data.get('can_edit', 0)
    all_images = data.get('all_images', 0)
    all_albums = data.get('all_albums', 0)
    save_preferences = data.get('save_preferences', 0)
    
    try:
        profile_id = general_models.create_profile(label, password, hierarchy_rank, event_id, can_delete_event)
    except Forbidden as e:
        raise forbidden(e)

    if event_id:
        event = get_event(event_id)
        sanitized = {
            'can_upload_and_delete_images': can_upload_and_delete_images,
            'can_edit': can_edit,
            'all_images': all_images,
            'all_albums': all_albums,
            'save_preferences': save_preferences
        }
        event.models.edit('profiles', profile_id, sanitized)

    return profile_id

@app.route("/api/profiles", methods=["POST"])
@require_auth
def create_profile():
    data = request.json or {}
    try:
        profile_id = _create_profile(data)
        general_models = get_general_models()
        changes = [{
            'type': 'UPSERT',
            'entity': 'profile',
            'items': general_models.get_entities('profiles', [profile_id])
        }]
        return jsonify({"success": True, "profile_id": profile_id, "changes": changes})
    
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/profiles", methods=["POST"])
@require_auth
def create_event_profile(event_id):
    event = get_event(event_id)
    general_models = get_general_models()
    if not event.models.is_profile_manager():
        return forbidden(f"Access denied")

    data = request.json or {}
    try:
        profile_id = _create_profile(data, event_id)
        changes = [{
            'type': 'UPSERT',
            'entity': 'profile',
            'items': general_models.get_entities('profiles', [profile_id])
        },
        {
            'type': 'UPSERT',
            'entity': 'profile',
            'items': event.models.get_entities('profiles', [profile_id])
        }]
        return jsonify({"success": True, "profile_id": profile_id, "changes": changes})
    
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

def _update_profile(profile_id: str, data: dict, event_id: str | None = None):
    general_models = get_general_models()

    if 'label' in data.keys():
        label = data['label']
        if not label:
            raise ValueError("Label is required")

        if general_models.is_exists('profiles', {'label': label}, exclude_id = profile_id):
            raise ValueError("Profile with this label already exists")

    try:
        if 'hierarchy_rank' in data.keys():
            general_models.update_profile_hierarchy_rank(profile_id, data['hierarchy_rank'])

        general_models.update_profile(profile_id, password=data.get('password', None), label=data.get('label', None))
        
        if event_id:
            event_fields = [
                'can_delete_event',
                'can_upload_and_delete_images',
                'can_edit',
                'all_images',
                'all_albums',
                'save_preferences'
            ]
            event_data = {k: v for k, v in data.items() if k in event_fields}
            event = get_event(event_id)
            event.models.edit('profiles', profile_id, event_data)
    
    except Forbidden as e:
        raise forbidden(e)

@app.route("/api/profiles/<profile_id>", methods=["PUT"])
@require_auth
def update_profile(profile_id):
    data = request.json or {}
    try:
        profile_id = _update_profile(profile_id, data)
        general_models = get_general_models()
        changes = [{
            'type': 'UPSERT',
            'entity': 'profile',
            'items': general_models.get_entities('profiles', [profile_id])
        }]
        return jsonify({"success": True, "changes": changes})
    
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/profiles/<profile_id>", methods=["PUT"])
@require_auth
def update_event_profile(event_id, profile_id):
    event = get_event(event_id)
    general_models = get_general_models()
    if not event.models.is_profile_manager():
        return forbidden(f"Access denied")

    data = request.json or {}
    try:
        _update_profile(profile_id, data, event_id)
        changes = [{
            'type': 'UPSERT',
            'entity': 'profile',
            'items': event.models.get_entities('profiles', [profile_id])
        },
        {
            'type': 'UPSERT',
            'entity': 'profile',
            'items': general_models.get_entities('profiles', [profile_id])
        }]
        return jsonify({"success": True, "profile_id": profile_id, "changes": changes})
    
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/profiles/<profile_id>", methods=["DELETE"])
@require_auth
def delete_profile(profile_id):
    """Delete a profile."""
    general_models = get_general_models()
    try:
        general_models.delete_profile(profile_id)
        changes = [{
            'type': 'REMOVE',
            'entity': 'profile',
            'ids': [profile_id]
        }]
        return jsonify({"success": True, "deleted_ids": [profile_id], "changes": changes})
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/profiles/<profile_id>", methods=["DELETE"])
@require_auth
def delete_event_profile(event_id, profile_id):
    """Delete a profile."""
    general_models = get_general_models()
    try:
        general_models.delete_profile(profile_id, event_id)
        changes = [{
            'type': 'REMOVE',
            'entity': 'profile',
            'ids': [profile_id]
        }]
        return jsonify({"success": True, "deleted_ids": [profile_id], "changes": changes})
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

# set profile access
def _edit_event_profile_childs(event, profile_id, child: str, child_ids, add: bool):
    """Add or remove multiple childs from a profile."""
    if not (event.models.is_profile_manager() and event.models.is_accessible('profiles', profile_id)):
        return forbidden(f"Access denied")
    
    if child not in ['images', 'albums']:
        return bad_request(f"Invalid child: {child}")

    try:
        affected_ids, _ = event.models.edit_childs('profiles', profile_id, child, child_ids, add=add)
        if add:
            changes = [{
                'type': 'RELATION_ADD',
                'relation': f'profile.{child}',
                'parentId': profile_id,
                'entities': event.models.get_childs('profiles', profile_id, child, child_ids)
            }]
        else:
            changes = [{
                'type': 'RELATION_REMOVE',
                'relation': f'profile.{child}',
                'parentId': profile_id,
                'ids': affected_ids
            }]

        return jsonify({"success": True, "changes": changes})
    
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/profiles/<profile_id>/images", methods=["PUT"])
@require_auth
def add_images_to_profile(event_id, profile_id):
    """Add multiple images to a profile."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    return _edit_event_profile_childs(event, profile_id, 'images', image_ids, add=True)

@app.route("/api/events/<event_id>/profiles/<profile_id>/images", methods=["DELETE"])
@require_auth
def remove_images_from_profile(event_id, profile_id):
    """Remove multiple images from a profile."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    return _edit_event_profile_childs(event, profile_id, 'images', image_ids, add=False)

@app.route("/api/events/<event_id>/profiles/<profile_id>/albums", methods=["PUT"])
@require_auth
def add_albums_to_profile(event_id, profile_id):
    """Add multiple albums to a profile."""
    event = get_event(event_id)
    data = request.json or {}
    album_ids = data.get('album_ids', [])
    return _edit_event_profile_childs(event, profile_id, 'albums', album_ids, add=True)

@app.route("/api/events/<event_id>/profiles/<profile_id>/albums", methods=["DELETE"])
@require_auth
def remove_albums_from_profile(event_id, profile_id):
    """Remove multiple albums from a profile."""
    event = get_event(event_id)
    data = request.json or {}
    album_ids = data.get('album_ids', [])
    return _edit_event_profile_childs(event, profile_id, 'albums', album_ids, add=False)

def _set_profile_accessibility(event, profile_id, child: str, child_ids, set_accessible: bool):
    """Set multiple childs as accessible or inaccessible to a profile."""
    if not (event.models.is_profile_manager() and event.models.is_accessible('profiles', profile_id)):
        return forbidden(f"Access denied")
    
    if child not in ['images', 'albums']:
        return bad_request(f"Invalid child: {child}")
    
    try:
        affected_ids, added = event.models.edit_accessibility(profile_id, child, child_ids, set_accessible=set_accessible)
        if added:
            changes = [{
                'type': 'RELATION_ADD',
                'relation': f'profile.{child}',
                'parentId': profile_id,
                'entities': event.models.get_childs('profiles', profile_id, child, child_ids)
            }]
        else:
            changes = [{
                'type': 'RELATION_REMOVE',
                'relation': f'profile.{child}',
                'parentId': profile_id,
                'ids': affected_ids
            }]

        return jsonify({"success": True, "changes": changes})
    except Forbidden as e:
        return forbidden(e)
    except DatabaseError as e:
        return internal_error(e)
    except Exception as e:
        return bad_request(e)

@app.route("/api/events/<event_id>/profiles/<profile_id>/accessible-images", methods=["PUT"])
@require_auth
def set_images_as_accessible(event_id, profile_id):
    """Set multiple images as accessible to a profile."""
    event = get_event(event_id)

    data = request.json or {}
    image_ids = data.get('image_ids', [])
    return _set_profile_accessibility(event, profile_id, 'images', image_ids, set_accessible=True)

@app.route("/api/events/<event_id>/profiles/<profile_id>/accessible-images", methods=["DELETE"])
@require_auth
def set_images_as_inaccessible(event_id, profile_id):
    """Set multiple images as inaccessible to a profile."""
    event = get_event(event_id)
    data = request.json or {}
    image_ids = data.get('image_ids', [])
    return _set_profile_accessibility(event, profile_id, 'images', image_ids, set_accessible=False)

@app.route("/api/events/<event_id>/profiles/<profile_id>/accessible-albums", methods=["PUT"])
@require_auth
def set_albums_as_accessible(event_id, profile_id):
    """Set multiple albums as accessible to a profile."""
    event = get_event(event_id)
    data = request.json or {}
    album_ids = data.get('album_ids', [])
    return _set_profile_accessibility(event, profile_id, 'albums', album_ids, set_accessible=True)

@app.route("/api/events/<event_id>/profiles/<profile_id>/accessible-albums", methods=["DELETE"])
@require_auth
def set_albums_as_inaccessible(event_id, profile_id):
    """Set multiple albums as inaccessible to a profile."""
    event = get_event(event_id)
    data = request.json or {}
    album_ids = data.get('album_ids', [])
    return _set_profile_accessibility(event, profile_id, 'albums', album_ids, set_accessible=False)

# ==============================================================================
# VII. FILE SERVING & DOWNLOADS
# ==============================================================================

@app.route('/api/events/<event_id>/file/<file_type>/<file_id>.webp')
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
    print(file_path)
    if not os.path.exists(file_path):
        abort(404)
    print(file_path)
    resp = make_response(send_file(file_path, mimetype='image/webp'))
    resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp

@app.route('/api/events/<event_id>/display/<image_id>.webp')
@require_auth
def get_display_image_webp(event_id, image_id):
    return get_file_webp(event_id, 'display', image_id)

@app.route('/api/events/<event_id>/faces/<face_id>.webp')
@require_auth
def get_face_crop_webp(event_id, face_id):
    return get_file_webp(event_id, 'face', face_id)

@app.route('/api/events/<event_id>/thumb/<image_id>.webp')
@require_auth
def get_thumbnail_image_webp(event_id, image_id):
    return get_file_webp(event_id, 'thumb', image_id)

@app.route('/api/events/<event_id>/high_quality/<image_id>.webp')
@require_auth
def get_high_quality_image_webp(event_id, image_id):
    return get_file_webp(event_id, 'high_quality', image_id)

@app.route('/api/events/<event_id>/original/<image_id>.webp')
@require_auth
def get_original_image_webp(event_id, image_id):
    return get_file_webp(event_id, 'original', image_id)

@app.route('/api/events/<event_id>/<entity>/<parent_id>/representative', methods=['GET', 'HEAD'])
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

@app.route("/api/events/<event_id>/download", methods=["POST"])
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
        memory_file = io.BytesIO()
        failed_images = []
        with zipfile.ZipFile(memory_file, 'w') as zf:
            for image_id in image_ids:
                if not event.models.is_accessible('images', image_id):
                    failed_images.append(image_id)
                    continue
                
                src_dir = event.high_quality_dir if quality != 'original' else event.original_dir
                file_path = os.path.join(src_dir, f"{image_id}.jpg")
                if os.path.exists(file_path):
                    zf.write(file_path, f"{image_id}.jpg")
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
        return bad_request(e)

# ==============================================================================
# VII. DEPRECATED & MISC ENDPOINTS
# ==============================================================================

# ==============================================================================
# VIII. PRODUCTION BUILD SERVING (for testing production mode)
# ==============================================================================

# Serve production build assets (CSS, JS, etc.)
@app.route('/assets/<path:filename>')
def serve_assets(filename):
    """Serve static assets from dist/assets/ folder"""
    dist_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'dist')
    return send_file(os.path.join(dist_dir, 'assets', filename))

# Catch-all route for production build (must be LAST!)
# This serves the production React app for any route not matched by API endpoints
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_production(path):
    """Serve the production build - catch-all for client-side routing"""
    # Skip if it's an API route (already handled above)
    if path.startswith('api/'):
        abort(404)
    
    dist_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'dist')
    
    # Try to serve the requested file
    file_path = os.path.join(dist_dir, path)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return send_file(file_path)
    
    # For client-side routing (any event URL), serve index.html
    return send_file(os.path.join(dist_dir, 'index.html'))

if __name__ == "__main__":
    app.run(debug=True)
