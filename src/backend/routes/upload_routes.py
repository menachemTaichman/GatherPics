from flask import Blueprint, jsonify, request

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event
from src.core.errors import Forbidden, DatabaseError

upload_bp = Blueprint('uploads', __name__, url_prefix='/api/events/<event_id>')

@upload_bp.route("/uploads", methods=["GET"])
@require_auth
def get_uploads(event_id):
    """List all accessible uploads for the specific event."""
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
    event = get_event(event_id)
    if not event.models.is_accessible('uploads', upload_id):
        return jsonify({"error": f"Upload {upload_id} not found or not accessible"}), 404

    upload = event.models.get_entities('uploads', [upload_id])
    images = event.models.get_childs('uploads', upload_id, 'images')
    groups = event.models.get_childs('uploads', upload_id, 'groups')
    moments = event.models.get_childs('uploads', upload_id, 'moments')
    
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
        'entities': groups
    })
    changes.append({
        'type': 'RELATION_SET',
        'relation': 'upload.moments',
        'parentId': str(upload_id),
        'entities': moments
    })
    
    return jsonify({'changes': changes})

@upload_bp.route("/uploads/<int:upload_id>", methods=["PATCH"])
@require_auth
def update_upload(event_id, upload_id):
    """Update an upload's notes."""
    event = get_event(event_id)
    if not event.models.is_accessible('uploads', upload_id):
        return jsonify({"error": f"Upload {upload_id} not found or not accessible"}), 404
        
    data = request.json or {}
    try:
        allowed_fields = {'notes'}
        sanitized = {k: v for k, v in data.items() if k in allowed_fields}
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
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@upload_bp.route("/uploads/<int:upload_id>", methods=["DELETE"])
@require_auth
def delete_upload(event_id, upload_id):
    """Delete an upload."""
    event = get_event(event_id)
    if not event.models.is_accessible('uploads', upload_id):
        return jsonify({"error": f"Upload {upload_id} not found or not accessible"}), 404
    
    try:
        event.models.delete('uploads', upload_id)
        
        response = {"success": True, "deleted_ids": [upload_id]}
        response['changes'] = [{
            'type': 'REMOVE',
            'entity': 'upload',
            'ids': [upload_id]
        }]
        return jsonify(response)
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@upload_bp.route("/uploads/<int:upload_id>/groups/<group_id>/faces/in_upload", methods=["GET"])
@require_auth
def get_upload_group_faces_in_upload(event_id, upload_id, group_id):
    """Get faces in a group that are from this upload."""
    event = get_event(event_id)
    
    if not event.models.is_accessible('uploads', upload_id):
        return jsonify({"error": f"Upload {upload_id} not found or not accessible"}), 404
    
    if not event.models.is_accessible('groups', group_id):
        return jsonify({"error": f"Group {group_id} not found or not accessible"}), 404
    
    try:
        faces_data = event.models.get_uploads_groups_faces(upload_id, group_id, within=True)
        face_ids = list(faces_data.keys())
        
        changes = [{
            'type': 'UPSERT',
            'entity': 'face',
            'items': faces_data
        }]
        
        return jsonify({
            'face_ids': face_ids,
            'changes': changes
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@upload_bp.route("/uploads/<int:upload_id>/groups/<group_id>/faces/not_in_upload", methods=["GET"])
@require_auth
def get_upload_group_faces_not_in_upload(event_id, upload_id, group_id):
    """Get faces in a group that are NOT from this upload."""
    event = get_event(event_id)
    
    if not event.models.is_accessible('uploads', upload_id):
        return jsonify({"error": f"Upload {upload_id} not found or not accessible"}), 404
    
    if not event.models.is_accessible('groups', group_id):
        return jsonify({"error": f"Group {group_id} not found or not accessible"}), 404
    
    try:
        faces_data = event.models.get_uploads_groups_faces(upload_id, group_id, within=False)
        face_ids = list(faces_data.keys())
        
        changes = [{
            'type': 'UPSERT',
            'entity': 'face',
            'items': faces_data
        }]
        
        return jsonify({
            'face_ids': face_ids,
            'changes': changes
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@upload_bp.route("/uploads/<int:upload_id>/moments/<moment_id>/images", methods=["GET"])
@require_auth
def get_upload_moment_images(event_id, upload_id, moment_id):
    """Get images in a moment for an upload (only images from this upload)."""
    event = get_event(event_id)
    
    if not event.models.is_accessible('uploads', upload_id):
        return jsonify({"error": f"Upload {upload_id} not found or not accessible"}), 404
    
    if not event.models.is_accessible('moments', moment_id):
        return jsonify({"error": f"Moment {moment_id} not found or not accessible"}), 404
    
    try:
        images_data = event.models.get_uploads_moments_images(upload_id, moment_id)
        
        changes = [{
            'type': 'UPSERT',
            'entity': 'image',
            'items': images_data
        }]
        
        return jsonify({
            'image_ids': list(images_data.keys()),
            'changes': changes
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400

