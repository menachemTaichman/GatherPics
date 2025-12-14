"""
Upgrade upload and image tables for queue-based processing.
Upload status values: PROCESSING_IMAGES, CLUSTERING_FACES, COMPLETED, FAILED
Image status values: PENDING_UPLOAD, QUEUED, PROCESSING, READY, FAILED
Alter errors column in uploads table to TEXT[] and add default value.
"""

from yoyo import step

__depends__ = {'0006_add_default_preferences_to_developer'}

steps = [
    step(
        """
        -- add requested_images_count column to uploads table
        ALTER TABLE uploads
        ADD COLUMN requested_images_count INTEGER NOT NULL DEFAULT 0;
        """,
        """
        ALTER TABLE uploads
        DROP COLUMN IF EXISTS requested_images_count;
        """
    ),
    step(
        """
        -- update status column in uploads table
        UPDATE uploads SET status = 'PROCESSING_IMAGES' WHERE status IS NULL OR status NOT IN (
            'completed',
            'failed'
        );
        UPDATE uploads SET status = 'COMPLETED' WHERE status = 'completed';
        UPDATE uploads SET status = 'FAILED' WHERE status = 'failed';

        ALTER TABLE uploads
        ADD CONSTRAINT uploads_status_check
        CHECK (status IN (
            'PROCESSING_IMAGES',
            'CLUSTERING_FACES',
            'COMPLETED',
            'FAILED'
        )) NOT VALID;

        ALTER TABLE uploads
        VALIDATE CONSTRAINT uploads_status_check;

        ALTER TABLE uploads
        ALTER COLUMN status SET DEFAULT 'PROCESSING_IMAGES',
        ALTER COLUMN status SET NOT NULL;
        """,
        """
        ALTER TABLE uploads
        ALTER COLUMN status DROP NOT NULL,
        ALTER COLUMN status DROP DEFAULT;

        ALTER TABLE uploads
        DROP CONSTRAINT IF EXISTS uploads_status_check;

        UPDATE uploads SET status = 'processing' WHERE status = 'PROCESSING_IMAGES';        
        UPDATE uploads SET status = 'completed' WHERE status = 'COMPLETED';
        UPDATE uploads SET status = 'failed' WHERE status = 'FAILED';
        """
    ),
    step(
        """        
        -- Add status column to images table with default PENDING_UPLOAD
        ALTER TABLE images 
        ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING_UPLOAD';

        ALTER TABLE images
        ADD CONSTRAINT images_status_check
        CHECK (status IN (
            'PENDING_UPLOAD',
            'QUEUED',
            'PROCESSING',
            'READY',
            'FAILED'
        ));
        
        -- legacy images are considered READY
        UPDATE images SET status = 'READY';
        
        CREATE INDEX idx_images_status ON images(status);
        CREATE INDEX idx_images_upload_id_status ON images(upload_id, status) WHERE upload_id IS NOT NULL;
        """,
        """
        DROP INDEX IF EXISTS idx_images_upload_id_status;
        DROP INDEX IF EXISTS idx_images_status;
        
        ALTER TABLE images DROP COLUMN IF EXISTS status;
        """
    ),
    step(
        """
        -- Update images_ctx view to filter by status=READY (unless transaction context allows pending)
        DROP VIEW IF EXISTS images_ctx CASCADE;
        CREATE OR REPLACE VIEW images_ctx AS
        SELECT
            i.*
        FROM images i
        INNER JOIN images_eff ie ON i.image_id = ie.image_id
        WHERE
            i.event_id = cur_event_profile_uuid('event_id')
            AND ie.profile_id = cur_profile_uuid('profile_id')
            AND ie.is_accessible
            AND (
                i.status = 'READY'
                OR cur_transaction('include_pending_images') = 'true'
            );
        
        -- Update trigger function for images_ctx INSERT to include status
        DROP FUNCTION IF EXISTS trg_insert_images_ctx() CASCADE;
        CREATE OR REPLACE FUNCTION trg_insert_images_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            new_image_id UUID;
        BEGIN
            IF cur_event_profile_uuid('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF cur_event_profile_bool('can_upload_and_delete_images') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to upload images';
            END IF;

            INSERT INTO images (
                image_id,
                event_id,
                date_taken,
                label,
                file_size,
                high_quality_file_size,
                display_file_size,
                thumb_file_size,
                width,
                height,
                description,
                moment_id,
                upload_id,
                status
            )
            VALUES (
                COALESCE(NEW.image_id, gen_random_uuid()),
                cur_event_profile_uuid('event_id'),
                NEW.date_taken,
                NEW.label,
                COALESCE(NEW.file_size, 0),
                COALESCE(NEW.high_quality_file_size, 0),
                COALESCE(NEW.display_file_size, 0),
                COALESCE(NEW.thumb_file_size, 0),
                COALESCE(NEW.width, 0),
                COALESCE(NEW.height, 0),
                NEW.description,
                NEW.moment_id,
                NEW.upload_id,
                COALESCE(NEW.status, 'PENDING_UPLOAD')
            )
            RETURNING image_id INTO new_image_id;
            
            NEW.image_id := new_image_id;

            IF cur_event_profile_bool('all_images') IS DISTINCT FROM TRUE THEN
                INSERT INTO profiles_images (profile_id, image_id)
                VALUES (cur_profile_uuid('profile_id'), NEW.image_id)
                ON CONFLICT DO NOTHING;
            END IF;
            
            IF new_image_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        
        -- Update trigger function for images_ctx UPDATE to include status
        DROP FUNCTION IF EXISTS trg_update_images_ctx() CASCADE;
        CREATE OR REPLACE FUNCTION trg_update_images_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            updated_image_id UUID;
        BEGIN
            IF cur_event_profile_bool('can_edit') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            UPDATE images SET
                description = NEW.description,
                moment_id = NEW.moment_id,
                high_quality_file_size = NEW.high_quality_file_size,
                display_file_size = NEW.display_file_size,
                thumb_file_size = NEW.thumb_file_size,
                status = COALESCE(NEW.status, OLD.status)
            WHERE image_id = OLD.image_id
            RETURNING image_id INTO updated_image_id;
            
            IF updated_image_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        -- Revert trigger functions to original (from 0004_triggers.py - without status)
        DROP FUNCTION IF EXISTS trg_update_images_ctx() CASCADE;
        CREATE OR REPLACE FUNCTION trg_update_images_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            updated_image_id UUID;
        BEGIN
            IF cur_event_profile_bool('can_edit') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            UPDATE images SET
                description = NEW.description,
                moment_id = NEW.moment_id,
                high_quality_file_size = NEW.high_quality_file_size,
                display_file_size = NEW.display_file_size,
                thumb_file_size = NEW.thumb_file_size
            WHERE image_id = OLD.image_id
            RETURNING image_id INTO updated_image_id;
            
            IF updated_image_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        
        DROP FUNCTION IF EXISTS trg_insert_images_ctx() CASCADE;
        CREATE OR REPLACE FUNCTION trg_insert_images_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            new_image_id UUID;
        BEGIN
            IF cur_event_profile_uuid('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF cur_event_profile_bool('can_upload_and_delete_images') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to upload images';
            END IF;

            INSERT INTO images (
                image_id,
                event_id,
                date_taken,
                label,
                file_size,
                high_quality_file_size,
                display_file_size,
                thumb_file_size,
                width,
                height,
                description,
                moment_id,
                upload_id
            )
            VALUES (
                COALESCE(NEW.image_id, gen_random_uuid()),
                cur_event_profile_uuid('event_id'),
                NEW.date_taken,
                NEW.label,
                COALESCE(NEW.file_size, 0),
                COALESCE(NEW.high_quality_file_size, 0),
                COALESCE(NEW.display_file_size, 0),
                COALESCE(NEW.thumb_file_size, 0),
                COALESCE(NEW.width, 0),
                COALESCE(NEW.height, 0),
                NEW.description,
                NEW.moment_id,
                NEW.upload_id
            )
            RETURNING image_id INTO new_image_id;
            
            NEW.image_id := new_image_id;

            IF cur_event_profile_bool('all_images') IS DISTINCT FROM TRUE THEN
                INSERT INTO profiles_images (profile_id, image_id)
                VALUES (cur_profile_uuid('profile_id'), NEW.image_id)
                ON CONFLICT DO NOTHING;
            END IF;
            
            IF new_image_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        
        -- Revert images_ctx to original (without status filter)
        DROP VIEW IF EXISTS images_ctx CASCADE;
        CREATE OR REPLACE VIEW images_ctx AS
        SELECT
            i.*
        FROM images i
        INNER JOIN images_eff ie ON i.image_id = ie.image_id
        WHERE
            i.event_id = cur_event_profile_uuid('event_id')
            AND ie.profile_id = cur_profile_uuid('profile_id')
            AND ie.is_accessible;
        """
    ),
]

