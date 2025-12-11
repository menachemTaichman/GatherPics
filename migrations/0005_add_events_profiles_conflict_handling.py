"""
Add ON CONFLICT handling to events_profiles insert in trg_events_ctx_insert function.
"""

from yoyo import step

__depends__ = {'0004_triggers'}

steps = [
    step(
        """
        -- Update trg_events_ctx_insert to handle conflicts in events_profiles insert
        DROP TRIGGER IF EXISTS trg_events_ctx_insert ON events_ctx;
        DROP FUNCTION IF EXISTS trg_events_ctx_insert() CASCADE;
        CREATE OR REPLACE FUNCTION trg_events_ctx_insert()
        RETURNS TRIGGER AS $$
        DECLARE
            new_event_id UUID;
        BEGIN
            IF NOT cur_profile_bool('can_create_events') THEN
                RAISE EXCEPTION 'Permission denied: cannot create event';
            END IF;

            INSERT INTO events (
                event_id,
                name,
                date,
                url,
                is_public,
                images_count_limit,
                image_size_limit_bytes,
                representative_image,
                created_at,
                created_by,
                rekognition_calls_limit
            )
            VALUES (
                COALESCE(NEW.event_id, gen_random_uuid()),
                NEW.name,
                NEW.date,
                NEW.url,
                COALESCE(NEW.is_public, FALSE),
                COALESCE(NEW.images_count_limit, 0),
                COALESCE(NEW.image_size_limit_bytes, 0),
                NEW.representative_image,
                COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
                cur_profile_uuid('profile_id'),
                (SELECT rekognition_calls_limit FROM settings WHERE id = 1 LIMIT 1)
            )
            RETURNING event_id INTO new_event_id;

            NEW.event_id := new_event_id;

            INSERT INTO events_profiles (
                profile_id,
                event_id,
                can_manage_event,
                can_delete_event,
                can_upload_and_delete_images,
                can_edit,
                all_images,
                all_groups,
                all_albums
            )
            VALUES (cur_profile_uuid('profile_id'), NEW.event_id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE)
            ON CONFLICT (event_id, profile_id) DO NOTHING;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Recreate the trigger
        CREATE TRIGGER trg_events_ctx_insert
            INSTEAD OF INSERT ON events_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_events_ctx_insert();
        """,
        """
        -- Revert trg_events_ctx_insert to original version without ON CONFLICT
        DROP TRIGGER IF EXISTS trg_events_ctx_insert ON events_ctx;
        DROP FUNCTION IF EXISTS trg_events_ctx_insert() CASCADE;
        CREATE OR REPLACE FUNCTION trg_events_ctx_insert()
        RETURNS TRIGGER AS $$
        DECLARE
            new_event_id UUID;
        BEGIN
            IF NOT cur_profile_bool('can_create_events') THEN
                RAISE EXCEPTION 'Permission denied: cannot create event';
            END IF;

            INSERT INTO events (
                event_id,
                name,
                date,
                url,
                is_public,
                images_count_limit,
                image_size_limit_bytes,
                representative_image,
                created_at,
                created_by,
                rekognition_calls_limit
            )
            VALUES (
                COALESCE(NEW.event_id, gen_random_uuid()),
                NEW.name,
                NEW.date,
                NEW.url,
                COALESCE(NEW.is_public, FALSE),
                COALESCE(NEW.images_count_limit, 0),
                COALESCE(NEW.image_size_limit_bytes, 0),
                NEW.representative_image,
                COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
                cur_profile_uuid('profile_id'),
                (SELECT rekognition_calls_limit FROM settings WHERE id = 1 LIMIT 1)
            )
            RETURNING event_id INTO new_event_id;

            NEW.event_id := new_event_id;

            INSERT INTO events_profiles (
                profile_id,
                event_id,
                can_manage_event,
                can_delete_event,
                can_upload_and_delete_images,
                can_edit,
                all_images,
                all_groups,
                all_albums
            )
            VALUES (cur_profile_uuid('profile_id'), NEW.event_id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE);
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Recreate the trigger
        CREATE TRIGGER trg_events_ctx_insert
            INSTEAD OF INSERT ON events_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_events_ctx_insert();
        """
    ),
]

