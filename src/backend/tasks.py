"""
Celery tasks for background image processing.
Uses Celery Chord for orchestration: Group of process_image_task -> cluster_faces_task
"""

import traceback
from celery import group, chord
from src.backend.celery_worker import celery
from src.core.services.event import Event
from src.core.errors import log_error


@celery.task(name='process_image_task')
def process_image_task(event_id: str, profile_id: str, image_id: str, filename: str):
    """
    Process a single image: resize, detect faces, crop faces, copy original.
    
    Args:
        event_id: Event ID
        profile_id: Profile ID (for context)
        image_id: UUID of the image to process
        filename: Original filename in to_process directory
        
    Returns:
        dict with image_id and face_ids, or None on failure
    """
    try:
        # Create Event instance
        event = Event(event_id, profile_id=profile_id)
        
        # Update status to PROCESSING
        event.models.update_image_status(image_id, 'PROCESSING')
        
        # Process the image
        result = event._process_single_image(image_id, filename)
        
        if result:
            # Update status to READY
            event.models.update_image_status(image_id, 'READY')
            return {'image_id': image_id, 'face_ids': result.get('face_ids', [])}
        else:
            # Update status to FAILED
            event.models.update_image_status(image_id, 'FAILED')
            return None
            
    except Exception as e:
        error_msg = f"Error processing image {image_id}: {str(e)}"
        log_error(error_msg, "ImageProcessingError", traceback.format_exc())
        
        # Update status to FAILED
        try:
            event = Event(event_id, profile_id=profile_id)
            event.models.update_image_status(image_id, 'FAILED')
        except:
            pass
        
        return None

@celery.task(name='cluster_faces_task')
def cluster_faces_task(event_id: str, profile_id: str, upload_id: int):
    """
    Cluster faces from all images in an upload and create/update groups.
    
    Args:
        event_id: Event ID
        profile_id: Profile ID (for context)
        upload_id: ID of the upload to cluster
    """
    try:
        # Create Event instance
        event = Event(event_id, profile_id=profile_id)
        
        # Get all face IDs from images in this upload
        face_ids = event.models.get_upload_face_ids(upload_id)
        
        if not face_ids:
            # No faces to cluster
            event.models.update_upload_status(upload_id, 'completed', faces_count=0, clusters_count=0)
            return {'upload_id': upload_id, 'groups_created': 0}
        
        # Cluster faces
        groups_created = event._cluster_and_group_faces(face_ids)
        
        # Update upload status
        faces_count = len(face_ids)
        event.models.update_upload_status(
            upload_id, 
            'completed', 
            faces_count=faces_count, 
            clusters_count=groups_created
        )
        
        return {'upload_id': upload_id, 'groups_created': groups_created, 'faces_count': faces_count}
        
    except Exception as e:
        error_msg = f"Error clustering faces for upload {upload_id}: {str(e)}"
        log_error(error_msg, "ClusteringError", traceback.format_exc())
        
        # Update upload status to failed
        try:
            event = Event(event_id, profile_id=profile_id)
            event.models.update_upload_status(upload_id, 'failed')
        except:
            pass
        
        return None

