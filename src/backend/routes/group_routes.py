from flask import Blueprint, jsonify, request

from src.backend.middleware.auth import require_auth
from src.backend.helpers import get_event, _parse_bool
from src.core.errors import Forbidden, DatabaseError

group_bp = Blueprint('groups', __name__, url_prefix='/api/events/<event_id>')

@group_bp.route("/groups", methods=["GET"])
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

@group_bp.route("/groups/<group_id>", methods=["GET"])
@require_auth
def get_group(event_id, group_id):
    """Get a specific group's details as changes, including its paginated images and faces mapping."""
    event = get_event(event_id)

    if not event.models.is_accessible('groups', group_id):
        return jsonify({"error": f"Group {group_id} not found or not accessible"}), 404

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

@group_bp.route("/groups/<group_id>/with-faces", methods=["GET"])
@require_auth
def get_group_with_faces(event_id, group_id):
    """Get a specific group with its faces and images for upload detail view."""
    event = get_event(event_id)

    if not event.models.is_accessible('groups', group_id):
        return jsonify({"error": f"Group {group_id} not found or not accessible"}), 404

    group = event.models.get_groups([group_id])
    faces = event.models.get_childs('groups', group_id, 'faces')
    images = event.models.get_childs('groups', group_id, 'images')
    
    changes = [
        {
            'type': 'UPSERT',
            'entity': 'group',
            'items': group
        },
        {
            'type': 'RELATION_SET',
            'relation': 'group.faces',
            'parentId': group_id,
            'entities': faces
        },
        {
            'type': 'RELATION_SET',
            'relation': 'group.images',
            'parentId': group_id,
            'entities': images
        }
    ]
    
    return jsonify({'changes': changes})

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
    return jsonify({"related_groups": groups, "related_group_ids": group_ids})

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
                'items': event.models.get_groups([group_id])
            })

        return jsonify({"success": True, "changes": changes})
    except Forbidden as e:
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@group_bp.route("/groups/<group_id>/faces", methods=["GET"])
@require_auth
def get_faces_group_in_image(event_id, group_id):
    """Get the faces in an image from a group."""
    event = get_event(event_id)
    image_id = request.args.get('image_id')
    if not image_id:
        return jsonify({"error": "Image ID is required"}), 400
    faces = event.models.get_faces_group_in_image(group_id, image_id)
    return jsonify({"faces": faces})

@group_bp.route("/groups/transfer-faces", methods=["POST"])
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
        return jsonify({"error": str(e)}), 403
    except DatabaseError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 400

