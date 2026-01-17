"""
Celery tasks for background image processing and email sending.
Uses Redis-backed atomic counter/set mechanism to track upload progress.
"""

import traceback

from celery.utils.log import get_task_logger
from datetime import datetime, timedelta, timezone
from src.backend.celery_worker import celery
from src.backend.redis_client import get_redis_client
from src.core.services.event import Event
from src.core.errors import log_error, Forbidden, PolicyError
from src.core.database.db import DB, ReturnFormat
from PIL import UnidentifiedImageError
from src.core.audit_log import AuditAction, log_audit

logger = get_task_logger(__name__)

# Upload URL expiration time in seconds (matches the expires_in value in prepare_upload_urls)
UPLOAD_URL_EXPIRATION_SECONDS = 3600 * 3  # 3 hours

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
                'fetch_face_matches_task',
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
def process_image_task(event_id: str, profile_id: str, upload_id: int, image_id: str):
    """
    Process a single image: resize to HQ, display and thumb, detect faces, crop faces, move from to_process to original.
    Uses Redis Set to track processing state and triggers cluster task when all images are done.
    
    Args:
        event_id: Event ID
        profile_id: Profile ID (for context)
        upload_id: ID of the upload this image belongs to
        image_id: UUID of the image to process
        
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
    
    event = None
    try:
        # Create Event instance
        event = Event(event_id, profile_id=profile_id)
        
        event.models.update_image_status(image_id, 'PROCESSING')
        event._process_single_image(image_id)
        
        event.models.update_image_status(image_id, 'READY')
        return True

    except Exception as e:
        if isinstance(e, (Forbidden, PolicyError)):
            user_msg = str(e)
        elif isinstance(e, (UnidentifiedImageError, OSError)):
            user_msg = "Invalid image format"
        elif isinstance(e, FileNotFoundError):
            user_msg = "File not found in storage"
        else:
            user_msg = "Internal error"
            log_error(f"Error processing image {image_id}: {str(e)}", "ImageProcessingError", traceback.format_exc())
        
        try:
            if event:
                event.models.update_image_status(image_id, 'FAILED')
                event.models.edit_upload(upload_id, {'errors': [f"Image {image_id}: {user_msg}"]})
        except Exception:
            log_error(f"Error updating image status or editing upload for image {image_id}: {str(e)}", "ImageProcessingError", traceback.format_exc())
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

@celery.task(name='fetch_face_matches_task', time_limit=3600, soft_time_limit=1800)
def fetch_face_matches_task(event_id: str, profile_id: str, upload_id: int):
    """
    Fetch face matches from AWS Rekognition and store them in the database.
    call cluster_faces_task after fetching face matches
    
    Args:
        event_id: Event ID
        profile_id: Profile ID (for context)
        upload_id: ID of the upload to fetch matches for
    """
    event = None
    try:
        # Create Event instance
        event = Event(event_id, profile_id=profile_id)
        
        face_ids = event.models.get_ready_face_ids_in_upload(upload_id)
        if not face_ids:
            logger.info(f"No ready faces found for upload {upload_id}")
            # update upload status to COMPLETED (OR FAILED IF there is any image failed)
            upload_status = 'COMPLETED'
            completed_at = datetime.now().isoformat()
            if len(event.models.get_upload_images(upload_id, status='FAILED')) > 0:
                upload_status = 'FAILED'
                completed_at = datetime.now().isoformat()
            event.models.edit_upload(upload_id, {'status': upload_status, 'completed_at': completed_at})
            return True
        
        logger.info(f"Starting face matches fetch for {len(face_ids)} faces")

        event.models.edit_upload(upload_id, {'status': 'CLUSTERING_FACES'})
        
        rekognition_request_id = event.models.edit_rekognition_requests(len(face_ids), request_type='FETCH_FACE_MATCHES')
        # Fetch face matches from AWS
        face_matches = event.face_utils.fetch_face_matches(face_ids=face_ids, reduce_calls=True)
        
        # Store matches in database
        event.store_face_matches(face_matches, rekognition_request_id)
        
        # Adjust rekognition requests count if reduce_calls is enabled
        if len(face_matches.keys()) != len(face_ids):
            event.models.edit_rekognition_requests(len(face_matches.keys()), rekognition_request_id)
        
        logger.info(f"Completed face matches fetch and storage for {len(face_matches.keys())} faces")
        
        event.models.db.execute_query("ANALYZE images; ANALYZE faces; ANALYZE face_matches_raw;")
        
        cluster_faces_task.delay(event_id, profile_id, upload_id)

        # Assign moments by time if requested
        assign_moments = False
        try:
            redis_client = get_redis_client()
            assign_moments_key = f"upload:{upload_id}:assign_moments"
            assign_moments_value = redis_client.get(assign_moments_key)
            assign_moments = assign_moments_value == "true"
        except Exception as e:
            # If Redis is unavailable, log but continue without assigning moments
            log_error(f"Redis unavailable when checking assign_moments flag: {str(e)}", "RedisConnectionError", "")

        if assign_moments:
            try:
                ready_image_ids = event.models.get_upload_images(upload_id, status='READY')
                if ready_image_ids:
                    assigned_moments = event.models.assign_moments_by_time(ready_image_ids)
                    moments_count = len(assigned_moments.keys())
                    logger.info(f"Assigned {sum(len(imgs) for imgs in assigned_moments.values())} images to {moments_count} moments for upload {upload_id}")
            except Exception as e:
                if isinstance(e, (Forbidden, PolicyError)):
                    user_msg = str(e)
                else:
                    user_msg = "Moments assignment failed"
                    error_msg = f"Error assigning moments for upload {upload_id}: {str(e)}"
                    log_error(error_msg, "MomentAssignmentError", traceback.format_exc())
                event.models.edit_upload(upload_id, {'errors': [f"Moments assignment: {user_msg}"]})
        
        return True
        
    except Exception as e:
        if isinstance(e, (Forbidden, PolicyError)):
            user_msg = str(e)
        else:
            user_msg = "Internal error"
            error_msg = f"Error fetching face matches for event {event_id}: {str(e)}"
            log_error(error_msg, "FaceMatchesFetchError", traceback.format_exc())
        
        if event:
            try:
                event.models.edit_upload(upload_id, {'status': 'FAILED', 'errors': [f"Face matches fetch failed: {user_msg}"]})
            except Exception as e:
                error_msg = f"Error updating upload status to FAILED: {str(e)}"
                log_error(error_msg, "FaceMatchesFetchError", traceback.format_exc())
        return None

@celery.task(name='cluster_faces_task', time_limit=3600, soft_time_limit=1800)
def cluster_faces_task(
    event_id: str,
    profile_id: str,
    upload_id: int,
):
    """
    Cluster faces from all images in an upload and create/update groups.
    Optionally assigns images to moments by time if assign_moments flag is set.
    
    Args:
        event_id: Event ID
        profile_id: Profile ID (for context)
        upload_id: ID of the upload to cluster
    """
    event = None
    try:
        # Create Event instance
        event = Event(event_id, profile_id=profile_id)
        
        face_ids = event.models.get_ready_face_ids_in_upload(upload_id)
        event._cluster_faces(face_ids)
        
        upload = event.models.get_entities('uploads', upload_id)
        if upload.get('status') != 'COMPLETED':
            event.models.edit_upload(upload_id, {'status': 'COMPLETED', 'completed_at': datetime.now().isoformat()})
        
        logger.info(f"completed cluster_faces_task for upload {upload_id}")
        
        return True
        
    except Exception as e:
        if isinstance(e, (Forbidden, PolicyError)):
            user_msg = str(e)
        else:
            user_msg = "Internal error"
            error_msg = f"Error clustering faces for upload {upload_id}: {str(e)}"
            log_error(error_msg, "ClusteringError", traceback.format_exc())
        
        if event:
            try:
                if event.models.get_entities('uploads', upload_id).get('status') != 'COMPLETED':
                    completed_at = datetime.now().isoformat()
                    error = [f"Clustering faces failed: {user_msg}"]
                    event.models.edit_upload(upload_id, {'status': 'FAILED', 'completed_at': completed_at, 'errors': error})
            except Exception as e:
                error_msg = f"Error updating upload status to FAILED: {str(e)}"
                log_error(error_msg, "ClusteringError", traceback.format_exc())
        return None

@celery.task(name='expire_pending_uploads_task')
def expire_pending_uploads_task():
    """
    Periodic task to expire pending images efficiently using SQL.
    Marks images with status 'PENDING_UPLOAD' as 'FAILED' if the upload URL has expired.
    
    Upload URLs expire after UPLOAD_URL_EXPIRATION_SECONDS (3 hours).
    This task runs once per day via Celery Beat.
    
    Returns:
        dict with count of expired images
    """
    try:
        # Create a DB instance without event/profile context for system-level queries
        db = DB()
        
        # Calculate expiration threshold: now minus 3 hours (plus 5 minutes buffer for safety)
        expiration_threshold = datetime.now(timezone.utc) - timedelta(seconds=UPLOAD_URL_EXPIRATION_SECONDS + 300)
        
        query = """
            UPDATE images i
            SET status = 'FAILED'
            FROM uploads u
            WHERE i.upload_id = u.upload_id
              AND i.status = 'PENDING_UPLOAD'
              AND u.started_at < %s
            RETURNING i.image_id;
        """
        
        # Execute the query and get the affected rows
        result = db.execute_query(
            query, 
            (expiration_threshold,), 
            return_format=ReturnFormat.LIST_DICTS
        )
        
        expired_count = len(result) if result else 0
        
        if expired_count > 0:
            logger.info(f"Cleanup: Marked {expired_count} expired pending images as FAILED.")
            log_error(f"Cleanup: Marked {expired_count} expired pending images as FAILED.", "UploadExpirationError", "")
        else:
            logger.verbose("Cleanup: No expired pending images found.")
        
        return {'expired_image_count': expired_count}
        
    except Exception as e:
        error_msg = f"Error in expire_pending_uploads_task: {str(e)}"
        log_error(error_msg, "UploadExpirationError", traceback.format_exc())
        return {
            'expired_image_count': 0,
            'error': str(e)
        }

@celery.task(name='delete_images_task')
def delete_images_task(event_id: str, profile_id: str, image_ids: list[str], upload_id: int | None = None):
    """
    Delete images from storage.

    Args:
        event_id: Event ID
        profile_id: Profile ID (for context)
        image_ids: List of image IDs to delete
        upload_id: upload id (optional). if provided, the upload will be also deleted after the images are deleted.
    """
    try:
        # Create Event instance
        event = Event(event_id, profile_id=profile_id)
        query = f"""
            WITH image_ids AS (
                SELECT DISTINCT unnest(%s::uuid[]) AS image_id
            )
            SELECT
                i.image_id,
                i.image_id,
                i.event_id,
                i.label,
                i.status,
                COUNT(f.face_id) as faces_count
            FROM images i
            INNER JOIN image_ids ii ON i.image_id = ii.image_id
            LEFT JOIN faces f ON i.image_id = f.image_id
            GROUP BY i.image_id, i.event_id, i.label, i.status;
        """
        images_details = event.models.db.execute_query(query, (image_ids,), return_format=ReturnFormat.DICT_DICTS)
        image_ids = list(images_details.keys())
        
        query = f"""
            WITH image_ids AS (
                SELECT DISTINCT unnest(%s::uuid[]) AS image_id
            )
            SELECT f.face_id 
            FROM faces f
            INNER JOIN image_ids ii ON f.image_id = ii.image_id;
        """
        face_ids = event.models.db.execute_query(query, (image_ids,), return_format=ReturnFormat.LIST_VALUES)
        delete_aws_rekognition_faces_task.delay(event_id, profile_id, face_ids)

        paths = []
        for image_id, image_info in images_details.items():
            if image_info['status'] != 'READY':
                paths.append(f"{event.to_process_dir}/{image_id}.jpg")
            paths.append(f"{event.original_dir}/{image_id}.jpg")
            paths.append(f"{event.high_quality_dir}/{image_id}.jpg")
            paths.append(f"{event.display_dir}/{image_id}.webp")
            paths.append(f"{event.thumb_dir}/{image_id}.webp")

        for face_id in face_ids:
            paths.append(f"{event.faces_dir}/{face_id}.webp")

        deleted = set(images_details.keys())
        result = event.file_helper.delete_many(paths)
        if result:
            for failure in result:
                if failure['code'] == '404':
                    continue
                else:
                    error_msg = f"Error deleting object {failure['path']}: {failure['message']}"
                    log_error(error_msg, "ObjectDeletionError", traceback.format_exc())
                    image_id = failure['path'].split('/')[-1].split('.')[0]
                    deleted.remove(image_id)
                    images_details.pop(image_id)

        if deleted:
            log_audit(
                action=AuditAction.IMAGE_DELETED,
                actor_profile_id=profile_id,
                details=images_details
            )

            query = f"""
                WITH image_ids AS (
                    SELECT DISTINCT unnest(%s::uuid[]) AS image_id
                )
                DELETE FROM images i
                USING image_ids ii
                WHERE i.image_id = ii.image_id
                RETURNING i.image_id;
            """
            deleted_image_ids = event.models.db.execute_query(query, (list(deleted),), return_format=ReturnFormat.LIST_VALUES)

            event.models.db.execute_query("ANALYZE images; ANALYZE faces; ANALYZE groups;")

        if upload_id:
            event.models.delete('uploads', upload_id)

    except Exception as e:
        error_msg = f"Error deleting objects for event {event_id}: {str(e)}"
        log_error(error_msg, "ObjectDeletionError", traceback.format_exc())

@celery.task(name='delete_aws_rekognition_faces_task')
def delete_aws_rekognition_faces_task(event_id: str, profile_id: str, face_ids: list[str]):
    """
    Delete faces from AWS Rekognition.
    """
    try:
        # Create Event instance
        event = Event(event_id, profile_id=profile_id)
        event.face_utils.rek_helper.delete_faces(face_ids)
    except Exception as e:
        error_msg = f"Error deleting faces for event {event_id}: {str(e)}"
        log_error(error_msg, "FaceDeletionError", traceback.format_exc())

@celery.task(name='delete_events_task')
def delete_events_task(event_id: str, profile_id: str, event_data: dict, restricted_profiles: list[dict]):
    """
    Delete event files from storage and database.
    
    Args:
        event_id: Event ID to delete
        profile_id: Profile ID (for context)
        event_data: Event data
        restricted_profiles: List of restricted profiles
    """
    try:
        # Create Event instance to access file_helper
        event = Event(event_id, profile_id=profile_id)
        
        # List all files in the event
        paths = event.file_helper.list_event_files(event_id)
        
        # Delete all files from storage
        if paths:
            result = event.file_helper.delete_many(paths)
            if result:
                for failure in result:
                    if failure.get('code') == '404':
                        continue
                    else:
                        error_msg = f"Error deleting file {failure.get('path', 'unknown')}: {failure.get('message', 'unknown error')}"
                        log_error(error_msg, "EventFileDeletionError", traceback.format_exc())
        
        # Delete Rekognition collection
        try:
            event.face_utils.rek_helper.delete_collection()
        except Exception as e:
            error_msg = f"Error deleting Rekognition collection for event {event_id}: {str(e)}"
            log_error(error_msg, "RekognitionCollectionDeletionError", traceback.format_exc())
        
        # Delete event from database
        # Set transaction context and delete event in the same transaction
        # This is required because triggers check cur_transaction('temp_event_in_deletion')
        db = DB(profile_id=profile_id)
        query = """
            SELECT set_transaction_context('temp_event_in_deletion', %s);
            DELETE FROM events WHERE event_id = %s
            RETURNING event_id;
            SELECT set_transaction_context('temp_event_in_deletion', 'null');
        """
        db.execute_query(query, (event_id, event_id), return_format=ReturnFormat.LIST_VALUES)
        db.execute_query('ANALYZE;')
        
        log_audit(
            action=AuditAction.EVENT_DELETED,
            actor_profile_id=profile_id,
            details={
                'event_id': event_id,
                'event_name': event_data.get('name', 'Unknown'),
                'images_count': event_data.get('images_count', 0) if event_data else 0,
                'total_size': event_data.get('total_size', 0) if event_data else 0,
                'rekognition_requests_count': event_data.get('rekognition_requests_count', 0) if event_data else 0,
                'restricted_profiles_deleted': len(restricted_profiles)
            }
        )
        
        # Log each restricted profile deletion
        for profile in restricted_profiles:
            log_audit(
                action=AuditAction.PROFILE_DELETED,
                actor_profile_id=profile_id,
                details={
                    'profile_id': profile['profile_id'],
                    'profile_label': profile.get('label', 'Unknown'),
                    'deleted_as_cascade': True,
                    'cascade_from_event_id': event_id,
                    'cascade_from_event_name': event_data.get('name', 'Unknown')
                }
            )

    except Exception as e:
        error_msg = f"Error deleting event {event_id}: {str(e)}"
        log_error(error_msg, "EventDeletionError", traceback.format_exc())

@celery.task(name='send_email_task')
def send_email_task(
    to: str | list[str],
    subject: str,
    body_text: str | None = None,
    body_html: str | None = None,
    from_email: str | None = None,
    reply_to: str | None = None,
    cc: list[str] | None = None,
    bcc: list[str] | None = None
):
    """
    Celery task to send an email asynchronously.
    
    This task handles email sending in the background, allowing API requests
    to return immediately without waiting for email delivery.
    
    Args:
        to: Recipient email address(es)
        subject: Email subject
        body_text: Plain text body (optional if body_html is provided)
        body_html: HTML body (optional if body_text is provided)
        from_email: Sender email (uses EMAIL_FROM env var if not provided)
        reply_to: Reply-to email address
        cc: CC recipients
        bcc: BCC recipients
        
    Returns:
        dict: Response containing status and message_id, or None if sending failed
        
    Note:
        Errors are automatically logged to the database and do not raise exceptions.
    """
    try:
        # Import here to avoid circular imports
        from src.core.services.email import get_email_service, EmailMessage
        
        # Create EmailMessage
        message = EmailMessage(
            to=to,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
            from_email=from_email,
            reply_to=reply_to,
            cc=cc,
            bcc=bcc
        )
        
        # Get email service and send
        service = get_email_service()
        result = service.send_email(message)
        
        if result:
            logger.info(f"Email sent successfully to {message.to if isinstance(message.to, str) else ', '.join(message.to)}: {result.get('message_id')}")
        else:
            logger.warning(f"Email service returned None for email to {message.to if isinstance(message.to, str) else ', '.join(message.to)}")
        
        return result
        
    except Exception as e:
        # Log error to database but don't raise exception
        error_msg = f"Failed to send email in Celery task: {str(e)}"
        log_error(error_msg, "EmailTaskError", traceback.format_exc())
        logger.error(error_msg, exc_info=True)
        return None