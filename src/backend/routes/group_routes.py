from flask import Blueprint, jsonify

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event
from src.backend.validators import get_input, get_multiple_inputs, get_query_param, validate_path_param

group_bp = Blueprint('groups', __name__, url_prefix='/api/events/<event_id>')

@group_bp.route("/groups", methods=["GET"])
@require_auth
def get_groups(event_id):
    """List all accessible group summaries for the specific event."""
    event_id = validate_path_param('event_id', event_id)
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
    event_id = validate_path_param('event_id', event_id)
    group_id = validate_path_param('group_id', group_id)
    event = get_event(event_id)

    if not event.models.is_accessible('groups', group_id):
        return jsonify({"error": f"Group {group_id} not found or not accessible"}), 404
    
    filter_enabled = get_query_param('filter', required=False) or False
    
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
        image_ids = list(images.keys())
        images_groups_and_faces = event.models.get_images_groups_and_faces(image_ids)
        for image_id, image in images.items():
            image['groups'] = images_groups_and_faces.get(image_id, {}).get('groups', [])
            image['faces'] = images_groups_and_faces.get(image_id, {}).get('faces', [])
    
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

@group_bp.route("/groups/related", methods=["POST"])
@require_auth
def get_related_groups(event_id):
    """Get related groups based on a set of selected groups and base images.
    
    Request body:
    - image_ids: List of image IDs (optional)
    - selected_groups: List of group IDs (required)
    """
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)

    image_ids = get_input('image_ids', required=False) or []
    selected_groups = get_input('selected_groups', required=True)

    group_ids = selected_groups

    group_ids, groups = event.models.get_related_groups(
        group_ids=group_ids,
        base_image_ids=image_ids
    )
    main_group_id = selected_groups[0]
    changes = [{
        'type': 'UPDATE',
        'entity': 'group',
        'items': {main_group_id: {'id': main_group_id, 'filtered_related_groups': group_ids}},
        'broadcast': False  # Contextual data, don't broadcast
    },
        {'type': 'INSERT',
        'entity': 'group',
        'items': groups
    }]
    
    return jsonify({"changes": changes, "related_group_ids": group_ids})

@group_bp.route("/groups/check-name", methods=["POST"])
@require_auth
def check_group_name(event_id):
    """Check if a group name already exists."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    label = get_input('label', required=True)
    exclude_group_id = get_input('exclude_group_id', required=False)
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
    event_id = validate_path_param('event_id', event_id)
    group_id = validate_path_param('group_id', group_id)
    event = get_event(event_id)
    changes = []
    sanitized = get_multiple_inputs(['label', 'representative_face'])
    if sanitized:
        event.models.edit('groups', group_id, sanitized)
        changes.append({
            'type': 'UPDATE',
            'entity': 'group',
            'items': event.models.get_entities('groups', [group_id])
        })

    return jsonify({"success": True, "changes": changes})

@group_bp.route("/groups/<group_id>/faces", methods=["POST"])
@require_auth
def get_faces_group_in_image(event_id, group_id):
    """Get the faces in images from a group."""
    event_id = validate_path_param('event_id', event_id)
    group_id = validate_path_param('group_id', group_id)
    event = get_event(event_id)
    image_ids = get_input('image_ids', required=True)
    
    faces = event.models.get_faces_group_in_image(group_id, image_ids)
    return jsonify({"faces": faces})

@group_bp.route("/groups/transfer-faces", methods=["POST"])
@require_auth
def transfer_faces(event_id):
    """Transfer faces between groups."""
    event_id = validate_path_param('event_id', event_id)
    event = get_event(event_id)
    target_group_id = get_input('target_group_id', required=False)
    new_group_name = get_input('new_group_name', required=False)
    face_ids = get_input('face_ids', required=True)
    
    if not target_group_id and not new_group_name:
        return jsonify({"error": "Missing required parameters"}), 400

    if target_group_id and new_group_name:
        return jsonify({"error": "Only one of target_group_id or new_group_name must be provided"}), 400
    
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
    updated_groups_uploads = result['updated_groups_uploads']
    removed_groups_uploads = result['removed_groups_uploads']

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

    # Update upload.moments relations
    for upload_id, groups in updated_groups_uploads.items():
        _, relation_data = event.models.get_childs('uploads', upload_id, 'groups', groups)
        changes.append({
            'type': 'RELATION_UPSERT',
            'relation': 'upload.groups',
            'parentId': upload_id,
            'relationData': relation_data
        })
    
    for upload_id, groups in removed_groups_uploads.items():
        changes.append({
            'type': 'RELATION_REMOVE',
            'relation': 'upload.groups',
            'parentId': upload_id,
            'ids': groups
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

