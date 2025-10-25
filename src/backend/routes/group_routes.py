from flask import Blueprint, jsonify, request

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event, _parse_bool
from src.core.errors import Forbidden, DatabaseError, DBPolicyError

group_bp = Blueprint('groups', __name__, url_prefix='/api/events/<event_id>')

@group_bp.route("/groups", methods=["GET"])
@require_auth
def get_groups(event_id):
    """List all accessible group summaries for the specific event."""
    event = get_event(event_id)
    groups = event.models.get_entities('groups')
    changes = [{
        'type': 'UPSERT',
        'entity': 'group',
        'items': groups
    }]
    return jsonify({ 'changes': changes })

@group_bp.route("/groups/<group_id>", methods=["GET"])
@require_auth
def get_group(event_id, group_id):
    """Get a specific group's details as changes, including its images and faces."""
    event = get_event(event_id)

    if not event.models.is_accessible('groups', group_id):
        return jsonify({"error": f"Group {group_id} not found or not accessible"}), 404
    
    filter_enabled = _parse_bool(request.args.get('filter', 'false'), False)
    
    changes = []
    result = {'changes': changes}
    
    # Get group
    group = event.models.get_entities('groups', [group_id])
    result['changes'].append({
        'type': 'UPSERT',
        'entity': 'group',
        'items': group
    })
    
    # Get images and faces for this group using get_childs
    images = event.models.get_childs('groups', group_id, 'images')
    faces = event.models.get_childs('groups', group_id, 'faces')

    if filter_enabled:
        for image_id, image in images.items():
            image['groups'] = event.models.get_childs('images', image_id, 'groups', return_ids=True)
            image['faces'] = event.models.get_childs('images', image_id, 'faces', return_ids=True)
    
    result['changes'].append({
        'type': 'RELATION_SET',
        'relation': 'group.images',
        'parentId': group_id,
        'entities': images
    })
    result['changes'].append({
        'type': 'RELATION_SET',
        'relation': 'group.faces',
        'parentId': group_id,
        'entities': faces
    })
    
    
    return jsonify(result)

@group_bp.route("/groups/related", methods=["GET"])
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
    changes = [{
        'type': 'INSERT',
        'entity': 'group',
        'items': groups
    }]
    return jsonify({"changes": changes, "related_group_ids": group_ids})

@group_bp.route("/groups/check-name", methods=["POST"])
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
        conflicting_group = event.models.get_entities('groups', [conflict_group_id])
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

@group_bp.route("/groups/<group_id>", methods=["PUT"])
@require_auth
def update_group(event_id, group_id):
    """Update a group."""
    event = get_event(event_id)
    if not event.models.is_accessible('groups', group_id):
        return jsonify({"error": f"Group {group_id} not found or not accessible"}), 404
        
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
                'items': event.models.get_entities('groups', [group_id])
            })

        return jsonify({"success": True, "changes": changes})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DBPolicyError as e:
        return jsonify({"error": str(e)}), 400
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@group_bp.route("/groups/<group_id>/faces", methods=["GET"])
@require_auth
def get_faces_group_in_image(event_id, group_id):
    """Get the faces in image(s) from a group."""
    event = get_event(event_id)
    image_id = request.args.get('image_id')
    image_ids_str = request.args.get('image_ids')
    
    if not image_id and not image_ids_str:
        return jsonify({"error": "image_id or image_ids parameter is required"}), 400
    
    # Handle single or multiple images
    if image_id:
        faces = event.models.get_faces_group_in_image(group_id, image_id)
    else:
        image_ids = image_ids_str.split(',') if image_ids_str else []
        faces = event.models.get_faces_group_in_image(group_id, image_ids)
    
    return jsonify({"faces": faces})

@group_bp.route("/groups/transfer-faces", methods=["POST"])
@require_auth
def transfer_faces(event_id):
    """Transfer faces between groups."""
    event = get_event(event_id)
    data = request.json or {}
    target_group_id = data.get('target_group_id')
    new_group_name = data.get('new_group_name', None)
    face_ids = data.get('face_ids', None)
    
    if not face_ids or not isinstance(face_ids, list):
        return jsonify({"error": "face_ids parameter is required"}), 400
    
    if not target_group_id and not new_group_name:
        return jsonify({"error": "Missing required parameters"}), 400

    if target_group_id and new_group_name:
        return jsonify({"error": "Only one of target_group_id or new_group_name must be provided"}), 400
    
    try:
        if not event.models.get_entities('faces', face_ids):
            return jsonify({"error": "Faces not found"}), 404

        if new_group_name:
            if event.models.is_exists('groups', {'label': new_group_name}):
                return jsonify({"error": f"Group name '{new_group_name}' already exists"}), 400
            target_group_id = event.models.add('groups', {'label': new_group_name})
        
        if not target_group_id:
            return jsonify({"error": "target_group_id or new_group_name must be provided"}), 400
        
        result = event.models.add_faces_to_group(
            face_ids=face_ids,
            target_group_id=target_group_id,
        )

        detached_groups_images = result['detached_groups_images']
        detached_groups_faces = result['detached_groups_faces']
        faces_added = result['faces_added']
        images_added = result['images_added']
        deleted_group_ids = result['deleted_group_ids']


        changes = []
        
        # Remove images from detached groups
        for group_id, image_ids in detached_groups_images.items():
            changes.append({
                'type': 'RELATION_REMOVE',
                'relation': 'group.images',
                'parentId': group_id,
                'ids': image_ids
            })
        
        # Remove faces from detached groups
        for group_id, face_ids in detached_groups_faces.items():
            changes.append({
                'type': 'RELATION_REMOVE',
                'relation': 'group.faces',
                'parentId': group_id,
                'ids': face_ids
            })

        # Add images to target group
        images_added_entities = event.models.get_childs('groups', target_group_id, 'images', images_added)
        for image_id, image in images_added_entities.items():
            image['groups'] = event.models.get_childs('images', image_id, 'groups', return_ids=True)
            image['faces'] = event.models.get_childs('images', image_id, 'faces', return_ids=True)
        changes.append({
            'type': 'RELATION_ADD',
            'relation': 'group.images',
            'parentId': target_group_id,
            'entities': images_added_entities
        })
        
        # Add faces to target group
        faces_added_entities = event.models.get_entities('faces', faces_added)
        changes.append({
            'type': 'RELATION_ADD',
            'relation': 'group.faces',
            'parentId': target_group_id,
            'entities': faces_added_entities
        })
        
        # Update all affected groups
        changes.append({
            'type': 'UPDATE',
            'entity': 'group',
            'items': event.models.get_entities('groups', list(detached_groups_images.keys()) + [target_group_id])
        })
        changes.append({
            'type': 'UPDATE',
            'entity': 'face',
            'items': faces_added_entities
        })
        
        # Remove deleted groups from store
        if deleted_group_ids:
            changes.append({
                'type': 'REMOVE',
                'entity': 'group',
                'ids': deleted_group_ids
            })
            
        response = {
            "success": True,
            'deleted_group_ids': deleted_group_ids,
            'new_group_created': bool(new_group_name),
            'target_group_id': target_group_id,
            'len_added': len(faces_added),
            'images_added': images_added,
            'changes': changes
        }
        return jsonify(response)
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

