"""
Celery tasks for background image processing.
Uses Redis-backed atomic counter/set mechanism to track upload progress.
"""

import traceback
from src.backend.celery_worker import celery
from src.backend.redis_client import get_redis_client
from src.core.services.event import Event
from src.core.errors import log_error


def try_trigger_cluster(upload_id: int, event_id: str, profile_id: str) -> bool:
    """
    Check if all images are processed and upload is finished, then trigger cluster_faces_task.
    Uses Redis SETNX for atomic locking to prevent race conditions.
    
    Args:
        upload_id: ID of the upload to check
        event_id: Event ID
        profile_id: Profile ID (for context)
        
    Returns:
        bool: True if cluster task was triggered, False otherwise
    """
    try:
        redis_client = get_redis_client()
        
        # Redis keys
        pending_set_key = f"upload:{upload_id}:pending"
        upload_finished_key = f"upload:{upload_id}:upload_finished"
        cluster_lock_key = f"upload:{upload_id}:cluster_lock"
        
        # Check if upload is finished
        upload_finished = redis_client.get(upload_finished_key)
        if not upload_finished or upload_finished != "true":
            return False
        
        # Check if Redis Set is empty (all images processed)
        pending_count = redis_client.scard(pending_set_key)
        if pending_count > 0:
            return False
        
        # Attempt to acquire lock using SETNX (SET if Not eXists)
        # Lock expires after 60 seconds to prevent deadlocks
        lock_acquired = redis_client.set(cluster_lock_key, "locked", nx=True, ex=60)
        if not lock_acquired:
            # Another worker is already triggering cluster task
            return False
        
        try:
            # Trigger cluster_faces_task using send_task to avoid circular import
            celery.send_task(
                'cluster_faces_task',
                args=[event_id, profile_id, upload_id]
            )
            return True
        except Exception as e:
            # If task triggering fails, release the lock
            redis_client.delete(cluster_lock_key)
            error_msg = f"Error triggering cluster task for upload {upload_id}: {str(e)}"
            log_error(error_msg, "ClusterTriggerError", traceback.format_exc())
            return False
            
    except Exception as e:
        error_msg = f"Error in try_trigger_cluster for upload {upload_id}: {str(e)}"
        log_error(error_msg, "ClusterTriggerError", traceback.format_exc())
        return False


@celery.task(name='process_image_task')
def process_image_task(event_id: str, profile_id: str, upload_id: int, image_id: str, filename: str):
    """
    Process a single image: resize to HQ, display and thumb, detect faces, crop faces, move from to_process to original.
    Uses Redis Set to track processing state and triggers cluster task when all images are done.
    
    Args:
        event_id: Event ID
        profile_id: Profile ID (for context)
        upload_id: ID of the upload this image belongs to
        image_id: UUID of the image to process
        filename: Original filename in to_process directory
        
    Returns:
        dict with image_id and face_ids, or None on failure
    """
    redis_client = None
    try:
        # Get Redis client for tracking
        redis_client = get_redis_client()
    except Exception as e:
        # If Redis is unavailable, log but continue processing
        log_error(f"Redis unavailable, continuing without tracking: {str(e)}", "RedisConnectionError", "")
    
    try:
        # Create Event instance
        event = Event(event_id, profile_id=profile_id)
        
        event.models.update_image_status(image_id, 'PROCESSING')
        result = event._process_single_image(image_id, filename)
        
        if result:
            event.models.update_image_status(image_id, 'READY')
            return {'image_id': image_id, 'face_ids': result.get('face_ids', [])}
        else:
            event.models.update_image_status(image_id, 'FAILED')
            return None
            
    except Exception as e:
        error_msg = f"Error processing image {image_id}: {str(e)}"
        log_error(error_msg, "ImageProcessingError", traceback.format_exc())
        
        try:
            event.models.update_image_status(image_id, 'FAILED')
        except:
            pass
        
        return None
        
    finally:
        # CRITICAL: Always remove image_id from Redis Set, even if processing failed
        # This ensures the cluster task can be triggered when all images are done
        if redis_client:
            try:
                pending_set_key = f"upload:{upload_id}:pending"
                redis_client.srem(pending_set_key, image_id)
                try_trigger_cluster(upload_id, event_id, profile_id)
            except Exception as e:
                # Log but don't fail the task if Redis cleanup fails
                log_error(
                    f"Error removing image {image_id} from Redis set: {str(e)}",
                    "RedisCleanupError",
                    traceback.format_exc()
                )

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
        face_ids = event.models.get_ready_face_ids_in_upload(upload_id)
        
        # Cluster faces
        groups_created = event._cluster_faces(face_ids)
        
        # Update upload status
        faces_count = len(face_ids)
        event.models.edit('uploads', upload_id, {
            'status': 'COMPLETED',
            'faces_count': faces_count,
            'clusters_count': groups_created
        })
        
        return {'upload_id': upload_id, 'groups_created': groups_created, 'faces_count': faces_count}
        
    except Exception as e:
        error_msg = f"Error clustering faces for upload {upload_id}: {str(e)}"
        log_error(error_msg, "ClusteringError", traceback.format_exc())
        
        # Update upload status to FAILED
        try:
            event.models.edit('uploads', upload_id, {'status': 'FAILED', 'errors': [str(e)]})
        except Exception as e:
            log_error(f"Error updating upload status to FAILED: {str(e)}", "ClusteringError", traceback.format_exc())
        
        return None
