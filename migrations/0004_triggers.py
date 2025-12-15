"""
PostgreSQL triggers migration.
Creates trigger functions and triggers for view operations and data integrity.
"""

from yoyo import step

__depends__ = {'0003_views'}

steps = [
    # Step 1: Create trigger functions for INSTEAD OF triggers on views
    step(
        """
        -- Function for settings_ctx UPDATE
        CREATE OR REPLACE FUNCTION trg_settings_ctx_update()
        RETURNS TRIGGER AS $$
        BEGIN
            UPDATE settings SET
                image_size_limit_bytes = NEW.image_size_limit_bytes,
                images_count_limit = NEW.images_count_limit,
                min_rank_to_create_event = NEW.min_rank_to_create_event,
                rekognition_calls_limit = NEW.rekognition_calls_limit
            WHERE id = 1;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for rekognition_usaged_ctx INSERT
        CREATE OR REPLACE FUNCTION trg_rekognition_usaged_ctx_insert()
        RETURNS TRIGGER AS $$
        DECLARE
            new_usage_id INTEGER;
        BEGIN
            INSERT INTO rekognition_usaged (
                event_id,
                event_label,
                profile_id,
                profile_label,
                calls_count,
                created_at
            )
            VALUES (
                NEW.event_id,
                NEW.event_label,
                NEW.profile_id,
                NEW.profile_label,
                NEW.calls_count,
                COALESCE(NEW.created_at, CURRENT_TIMESTAMP)
            )
            RETURNING usage_id INTO new_usage_id;
            
            NEW.usage_id := new_usage_id;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for events_ctx INSERT
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

        -- Function for events_ctx UPDATE
        CREATE OR REPLACE FUNCTION trg_events_ctx_update()
        RETURNS TRIGGER AS $$
        DECLARE
            can_manage BOOLEAN;
        BEGIN
            SELECT can_manage_event INTO can_manage
            FROM events_profiles
            WHERE profile_id = cur_profile_uuid('profile_id') AND event_id = OLD.event_id;
            
            IF can_manage IS NOT TRUE THEN
                RAISE EXCEPTION 'Permission denied: cannot manage event';
            END IF;
            
            IF NEW.rekognition_calls_limit <> OLD.rekognition_calls_limit AND cur_profile_bool('is_developer') THEN
                RAISE EXCEPTION 'Permission denied: cannot update rekognition calls limit';
            END IF;
            
            IF NEW.rekognition_calls_used <> OLD.rekognition_calls_used THEN
                RAISE EXCEPTION 'Policy error: cannot update rekognition calls used';
            END IF;
            
            UPDATE events SET
                name = NEW.name,
                date = NEW.date,
                url = NEW.url,
                is_public = NEW.is_public,
                images_count_limit = NEW.images_count_limit,
                image_size_limit_bytes = NEW.image_size_limit_bytes,
                representative_image = NEW.representative_image,
                rekognition_calls_limit = NEW.rekognition_calls_limit
            WHERE event_id = OLD.event_id;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for events_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_events_ctx_delete()
        RETURNS TRIGGER AS $$
        DECLARE
            can_delete BOOLEAN;
        BEGIN
            SELECT can_delete_event INTO can_delete
            FROM events_profiles
            WHERE event_id = OLD.event_id AND profile_id = cur_profile_uuid('profile_id');
            
            IF can_delete IS NOT TRUE THEN
                RAISE EXCEPTION 'Permission denied: cannot delete event';
            END IF;
            
            DELETE FROM events WHERE event_id = OLD.event_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for current_profile UPDATE
        CREATE OR REPLACE FUNCTION trg_current_profile_update()
        RETURNS TRIGGER AS $$
        DECLARE
            updated_profile_id UUID;
        BEGIN
            IF cur_profile_bool('is_public') THEN
                RAISE EXCEPTION 'Permission denied: cannot update current profile to a public profile';
            END IF;

            UPDATE profiles SET
                label = NEW.label,
                email = NEW.email,
                password = NEW.password
            WHERE profile_id = cur_profile_uuid('profile_id')
            RETURNING profile_id INTO updated_profile_id;
            
            IF updated_profile_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_current_profile_update() CASCADE;
        DROP FUNCTION IF EXISTS trg_events_ctx_delete() CASCADE;
        DROP FUNCTION IF EXISTS trg_events_ctx_update() CASCADE;
        DROP FUNCTION IF EXISTS trg_events_ctx_insert() CASCADE;
        DROP FUNCTION IF EXISTS trg_rekognition_usaged_ctx_insert() CASCADE;
        DROP FUNCTION IF EXISTS trg_settings_ctx_update() CASCADE;
        """
    ),
    # Step 2: Attach INSTEAD OF triggers to views (first batch)
    step(
        """
        DROP TRIGGER IF EXISTS trg_settings_ctx_update ON settings_ctx;
        CREATE TRIGGER trg_settings_ctx_update
            INSTEAD OF UPDATE ON settings_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_settings_ctx_update();

        DROP TRIGGER IF EXISTS trg_rekognition_usaged_ctx_insert ON rekognition_usaged_ctx;
        CREATE TRIGGER trg_rekognition_usaged_ctx_insert
            INSTEAD OF INSERT ON rekognition_usaged_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_rekognition_usaged_ctx_insert();

        DROP TRIGGER IF EXISTS trg_events_ctx_insert ON events_ctx;
        CREATE TRIGGER trg_events_ctx_insert
            INSTEAD OF INSERT ON events_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_events_ctx_insert();

        DROP TRIGGER IF EXISTS trg_events_ctx_update ON events_ctx;
        CREATE TRIGGER trg_events_ctx_update
            INSTEAD OF UPDATE ON events_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_events_ctx_update();

        DROP TRIGGER IF EXISTS trg_events_ctx_delete ON events_ctx;
        CREATE TRIGGER trg_events_ctx_delete
            INSTEAD OF DELETE ON events_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_events_ctx_delete();

        DROP TRIGGER IF EXISTS trg_current_profile_update ON current_profile;
        CREATE TRIGGER trg_current_profile_update
            INSTEAD OF UPDATE ON current_profile
            FOR EACH ROW EXECUTE FUNCTION trg_current_profile_update();
        """,
        """
        DROP TRIGGER IF EXISTS trg_current_profile_update ON current_profile;
        DROP TRIGGER IF EXISTS trg_events_ctx_delete ON events_ctx;
        DROP TRIGGER IF EXISTS trg_events_ctx_update ON events_ctx;
        DROP TRIGGER IF EXISTS trg_events_ctx_insert ON events_ctx;
        DROP TRIGGER IF EXISTS trg_rekognition_usaged_ctx_insert ON rekognition_usaged_ctx;
        DROP TRIGGER IF EXISTS trg_settings_ctx_update ON settings_ctx;
        """
    ),
    # Step 3: More trigger functions for views
    step(
        """
        -- Function for profiles_ctx INSERT
        CREATE OR REPLACE FUNCTION trg_profiles_ctx_insert()
        RETURNS TRIGGER AS $$
        DECLARE
            min_rank INTEGER;
            new_profile_id UUID;
        BEGIN
            min_rank := (SELECT min_rank_to_create_event FROM settings WHERE id = 1 LIMIT 1);
            
            IF cur_profile_int('hierarchy_rank') = 0 THEN
                RAISE EXCEPTION 'Permission denied: not a profiles manager';
            END IF;
            
            IF NEW.hierarchy_rank >= cur_profile_int('hierarchy_rank') THEN
                RAISE EXCEPTION 'Permission denied: cannot create profile with higher or equal rank';
            END IF;
            
            IF NEW.can_create_events AND cur_profile_int('hierarchy_rank') <= min_rank THEN
                RAISE EXCEPTION 'Permission denied: the profile dose not have permission to manage create events permissions';
            END IF;
            
            IF NEW.restricted_to_event IS NOT NULL AND NEW.restricted_to_event NOT IN (SELECT event_id FROM current_profile_events) THEN
                RAISE EXCEPTION 'Permission denied: the event is not accessible';
            END IF;

            INSERT INTO profiles (profile_id, label, email, password, hierarchy_rank, can_create_events, restricted_to_event, is_public)
            VALUES (
                COALESCE(NEW.profile_id, gen_random_uuid()),
                NEW.label,
                NEW.email,
                NEW.password,
                COALESCE(NEW.hierarchy_rank, 0),
                COALESCE(NEW.can_create_events, FALSE),
                NEW.restricted_to_event,
                COALESCE(NEW.is_public, FALSE)
            )
            RETURNING profile_id INTO new_profile_id;
            
            NEW.profile_id := new_profile_id;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for profiles_ctx UPDATE
        CREATE OR REPLACE FUNCTION trg_profiles_ctx_update()
        RETURNS TRIGGER AS $$
        DECLARE
            min_rank INTEGER;
            updated_profile_id UUID;
        BEGIN
            IF NOT OLD.is_editable THEN
                RAISE EXCEPTION 'Permission denied: the profile is not editable';
            END IF;
            
            min_rank := (SELECT min_rank_to_create_event FROM settings WHERE id = 1 LIMIT 1);
            
            IF NEW.hierarchy_rank >= cur_profile_int('hierarchy_rank') THEN
                RAISE EXCEPTION 'Permission denied: cannot update profile to a higher or equal rank than the current profile';
            END IF;
            
            IF NEW.can_create_events AND NOT OLD.can_create_events AND cur_profile_int('hierarchy_rank') <= min_rank THEN
                RAISE EXCEPTION 'Permission denied: the profile dose not have permission to manage create events permissions';
            END IF;
            
            IF NEW.restricted_to_event IS NOT NULL AND NEW.restricted_to_event NOT IN (SELECT event_id FROM current_profile_events) THEN
                RAISE EXCEPTION 'Permission denied: the event is not accessible';
            END IF;

            IF NEW.email <> OLD.email AND NOT OLD.is_public THEN
                RAISE EXCEPTION 'Permission denied: cannot update email for non-public profiles';
            END IF;

            IF NEW.password <> OLD.password AND NOT OLD.is_public THEN
                RAISE EXCEPTION 'Permission denied: cannot update password for non-public profiles';
            END IF;

            UPDATE profiles SET
                label = NEW.label,
                email = NEW.email,
                password = NEW.password,
                hierarchy_rank = NEW.hierarchy_rank,
                can_create_events = NEW.can_create_events,
                restricted_to_event = NEW.restricted_to_event,
                is_public = NEW.is_public,
                public_access_code = NEW.public_access_code
            WHERE profile_id = OLD.profile_id
            RETURNING profile_id INTO updated_profile_id;
            
            IF updated_profile_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for profiles_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_profiles_ctx_delete()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_profile_id UUID;
        BEGIN
            IF NOT OLD.is_editable THEN
                RAISE EXCEPTION 'Permission denied: the profile is not editable';
            END IF;
            
            IF EXISTS (SELECT 1 FROM events_profiles ep WHERE ep.profile_id = OLD.profile_id) THEN
                RAISE EXCEPTION 'Policy error: the profile is associated with an event. Please remove the profile from all events first.';
            END IF;

            DELETE FROM profiles WHERE profile_id = OLD.profile_id
            RETURNING profile_id INTO deleted_profile_id;
            
            IF deleted_profile_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for my_preferences UPDATE
        CREATE OR REPLACE FUNCTION trg_my_preferences_update()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_profile_uuid('profile_id') IS DISTINCT FROM OLD.profile_id THEN
                RAISE EXCEPTION 'Permission denied: cannot update preferences for another profile';
            END IF;

            UPDATE profiles_preferences SET
                preference_value = NEW.preference_value
            WHERE profile_id = OLD.profile_id AND preference_group = OLD.preference_group AND preference_key = OLD.preference_key;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for my_notifications_ctx UPDATE
        CREATE OR REPLACE FUNCTION trg_my_notifications_ctx_update()
        RETURNS TRIGGER AS $$
        DECLARE
            updated_notification_id INTEGER;
        BEGIN

            UPDATE notifications SET
                read = COALESCE(NEW.read, read),
                read_at = COALESCE(NEW.read_at, CURRENT_TIMESTAMP)
            WHERE notification_id = OLD.notification_id
            RETURNING notification_id INTO updated_notification_id;
            
            IF updated_notification_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for my_notifications_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_my_notifications_ctx_delete()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_notification_id INTEGER;
        BEGIN

            DELETE FROM notifications WHERE notification_id = OLD.notification_id
            RETURNING notification_id INTO deleted_notification_id;
            
            IF deleted_notification_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_my_notifications_ctx_delete() CASCADE;
        DROP FUNCTION IF EXISTS trg_my_notifications_ctx_update() CASCADE;
        DROP FUNCTION IF EXISTS trg_my_preferences_update() CASCADE;
        DROP FUNCTION IF EXISTS trg_profiles_ctx_delete() CASCADE;
        DROP FUNCTION IF EXISTS trg_profiles_ctx_update() CASCADE;
        DROP FUNCTION IF EXISTS trg_profiles_ctx_insert() CASCADE;
        """
    ),
    # Step 4: Attach more triggers to views
    step(
        """
        DROP TRIGGER IF EXISTS trg_profiles_ctx_insert ON profiles_ctx;
        CREATE TRIGGER trg_profiles_ctx_insert
            INSTEAD OF INSERT ON profiles_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_profiles_ctx_insert();

        DROP TRIGGER IF EXISTS trg_profiles_ctx_update ON profiles_ctx;
        CREATE TRIGGER trg_profiles_ctx_update
            INSTEAD OF UPDATE ON profiles_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_profiles_ctx_update();

        DROP TRIGGER IF EXISTS trg_profiles_ctx_delete ON profiles_ctx;
        CREATE TRIGGER trg_profiles_ctx_delete
            INSTEAD OF DELETE ON profiles_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_profiles_ctx_delete();

        DROP TRIGGER IF EXISTS trg_my_preferences_update ON my_preferences;
        CREATE TRIGGER trg_my_preferences_update
            INSTEAD OF UPDATE ON my_preferences
            FOR EACH ROW EXECUTE FUNCTION trg_my_preferences_update();

        DROP TRIGGER IF EXISTS trg_my_notifications_ctx_update ON my_notifications_ctx;
        CREATE TRIGGER trg_my_notifications_ctx_update
            INSTEAD OF UPDATE ON my_notifications_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_my_notifications_ctx_update();

        DROP TRIGGER IF EXISTS trg_my_notifications_ctx_delete ON my_notifications_ctx;
        CREATE TRIGGER trg_my_notifications_ctx_delete
            INSTEAD OF DELETE ON my_notifications_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_my_notifications_ctx_delete();
        """,
        """
        DROP TRIGGER IF EXISTS trg_my_notifications_ctx_delete ON my_notifications_ctx;
        DROP TRIGGER IF EXISTS trg_my_notifications_ctx_update ON my_notifications_ctx;
        DROP TRIGGER IF EXISTS trg_my_preferences_update ON my_preferences;
        DROP TRIGGER IF EXISTS trg_profiles_ctx_delete ON profiles_ctx;
        DROP TRIGGER IF EXISTS trg_profiles_ctx_update ON profiles_ctx;
        DROP TRIGGER IF EXISTS trg_profiles_ctx_insert ON profiles_ctx;
        """
    ),
    # Step 5: Feedback trigger functions
    step(
        """
        -- Function for my_feedbacks_ctx INSERT
        CREATE OR REPLACE FUNCTION trg_my_feedbacks_ctx_insert()
        RETURNS TRIGGER AS $$
        DECLARE
            new_feedback_id INTEGER;
            diagnostics_json JSONB;
            error_ids_array INTEGER[];
        BEGIN
            IF NEW.profile_id IS DISTINCT FROM cur_profile_uuid('profile_id') THEN
                RAISE EXCEPTION 'Permission denied: cannot create feedback for another profile';
            END IF;
            
            IF cur_profile_bool('is_public') THEN
                RAISE EXCEPTION 'Permission denied: public profiles cannot create feedback';
            END IF;

            -- Extract error_ids from diagnostics before insert
            error_ids_array := ARRAY[]::INTEGER[];
            BEGIN
                IF NEW.diagnostics IS NOT NULL THEN
                    -- Parse diagnostics (stored as TEXT/JSON)
                    diagnostics_json := NEW.diagnostics::jsonb;
                    
                    -- Check network_errors array for error_id in responseBody
                    IF diagnostics_json ? 'network_errors' AND jsonb_typeof(diagnostics_json->'network_errors') = 'array' THEN
                        -- Extract all distinct error_id values into array
                        SELECT ARRAY_AGG(DISTINCT (error_obj->'responseBody'->>'error_id')::INTEGER)
                        INTO error_ids_array
                        FROM jsonb_array_elements(diagnostics_json->'network_errors') AS error_obj
                        WHERE error_obj->'responseBody' ? 'error_id'
                        AND (error_obj->'responseBody'->>'error_id')::INTEGER IS NOT NULL;
                    END IF;
                END IF;
            EXCEPTION
                WHEN OTHERS THEN
                    -- Ignore errors in diagnostics parsing - don't fail feedback creation
                    NULL;
            END;

            INSERT INTO feedbacks (
                profile_id,
                sender_name,
                sender_email,
                communication_consent,
                title,
                type,
                message,
                created_at,
                user_agent,
                ip_address,
                diagnostics,
                error_ids
            )
            VALUES (
                NEW.profile_id,
                NEW.sender_name,
                NEW.sender_email,
                COALESCE(CASE WHEN NEW.sender_email IS NOT NULL THEN TRUE ELSE NEW.communication_consent END, FALSE),
                NEW.title,
                COALESCE(NEW.type, 0),
                NEW.message,
                COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
                NEW.user_agent,
                NEW.ip_address,
                NEW.diagnostics,
                CASE WHEN array_length(error_ids_array, 1) > 0 THEN error_ids_array ELSE NULL END
            )
            RETURNING feedback_id INTO new_feedback_id;
        
            NEW.feedback_id := new_feedback_id;
        
            INSERT INTO notifications (
                profile_id,
                message,
                created_at,
                read,
                type,
                data
            )
            SELECT
                developer_id,
                'New feedback received',
                CURRENT_TIMESTAMP,
                FALSE,
                'feedback',
                json_build_object('feedback_id', new_feedback_id)
            FROM settings
            WHERE settings.id = 1;
            
            IF new_feedback_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for my_feedbacks_ctx UPDATE
        CREATE OR REPLACE FUNCTION trg_my_feedbacks_ctx_update()
        RETURNS TRIGGER AS $$
        DECLARE
            updated_feedback_id INTEGER;
        BEGIN
            
            IF OLD.is_closed = TRUE THEN
                RAISE EXCEPTION 'Permission denied: cannot update closed feedback';
            END IF;

            UPDATE feedbacks SET
                title = NEW.title,
                type = NEW.type,
                message = NEW.message,
                communication_consent = COALESCE(CASE WHEN NEW.sender_email IS NOT NULL THEN TRUE ELSE NEW.communication_consent END, FALSE)
            WHERE feedback_id = OLD.feedback_id
            RETURNING feedback_id INTO updated_feedback_id;
            
            IF updated_feedback_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for my_feedbacks_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_my_feedbacks_ctx_delete()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_feedback_id INTEGER;
        BEGIN
            
            IF OLD.is_closed = TRUE THEN
                RAISE EXCEPTION 'Permission denied: cannot delete closed feedback';
            END IF;

            DELETE FROM feedbacks WHERE feedback_id = OLD.feedback_id
            RETURNING feedback_id INTO deleted_feedback_id;
            
            IF deleted_feedback_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for feedbacks_ctx UPDATE
        CREATE OR REPLACE FUNCTION trg_feedbacks_ctx_update()
        RETURNS TRIGGER AS $$
        DECLARE
            updated_feedback_id INTEGER;
        BEGIN

            UPDATE feedbacks SET
                type = NEW.type,
                notes = NEW.notes,
                is_closed = NEW.is_closed,
                solved = NEW.solved,
                closed_at = COALESCE(NEW.closed_at, CURRENT_TIMESTAMP),
                closed_by = cur_profile_uuid('profile_id'),
                closed_details = NEW.closed_details
            WHERE feedback_id = OLD.feedback_id
            RETURNING feedback_id INTO updated_feedback_id;

            IF NEW.is_closed THEN
                INSERT INTO notifications (
                    profile_id,
                    message,
                    created_at,
                    read,
                    type,
                    data
                )
                SELECT
                    p.profile_id,
                    'Your feedback has been updated',
                    CURRENT_TIMESTAMP,
                    FALSE,
                    'my_feedback',
                    json_build_object('feedback_id', OLD.feedback_id)
                FROM feedbacks
                INNER JOIN profiles p ON feedbacks.profile_id = p.profile_id
                WHERE feedback_id = OLD.feedback_id
                AND p.is_public = FALSE;
            END IF;
            
            IF updated_feedback_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for feedbacks_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_feedbacks_ctx_delete()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_feedback_id INTEGER;
        BEGIN

            DELETE FROM feedbacks WHERE feedback_id = OLD.feedback_id
            RETURNING feedback_id INTO deleted_feedback_id;
            
            IF deleted_feedback_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_feedbacks_ctx_delete() CASCADE;
        DROP FUNCTION IF EXISTS trg_feedbacks_ctx_update() CASCADE;
        DROP FUNCTION IF EXISTS trg_my_feedbacks_ctx_delete() CASCADE;
        DROP FUNCTION IF EXISTS trg_my_feedbacks_ctx_update() CASCADE;
        DROP FUNCTION IF EXISTS trg_my_feedbacks_ctx_insert() CASCADE;
        """
    ),
    # Step 6: Attach feedback triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_my_feedbacks_ctx_insert ON my_feedbacks_ctx;
        CREATE TRIGGER trg_my_feedbacks_ctx_insert
            INSTEAD OF INSERT ON my_feedbacks_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_my_feedbacks_ctx_insert();

        DROP TRIGGER IF EXISTS trg_my_feedbacks_ctx_update ON my_feedbacks_ctx;
        CREATE TRIGGER trg_my_feedbacks_ctx_update
            INSTEAD OF UPDATE ON my_feedbacks_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_my_feedbacks_ctx_update();

        DROP TRIGGER IF EXISTS trg_my_feedbacks_ctx_delete ON my_feedbacks_ctx;
        CREATE TRIGGER trg_my_feedbacks_ctx_delete
            INSTEAD OF DELETE ON my_feedbacks_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_my_feedbacks_ctx_delete();

        DROP TRIGGER IF EXISTS trg_feedbacks_ctx_update ON feedbacks_ctx;
        CREATE TRIGGER trg_feedbacks_ctx_update
            INSTEAD OF UPDATE ON feedbacks_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_feedbacks_ctx_update();

        DROP TRIGGER IF EXISTS trg_feedbacks_ctx_delete ON feedbacks_ctx;
        CREATE TRIGGER trg_feedbacks_ctx_delete
            INSTEAD OF DELETE ON feedbacks_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_feedbacks_ctx_delete();
        """,
        """
        DROP TRIGGER IF EXISTS trg_feedbacks_ctx_delete ON feedbacks_ctx;
        DROP TRIGGER IF EXISTS trg_feedbacks_ctx_update ON feedbacks_ctx;
        DROP TRIGGER IF EXISTS trg_my_feedbacks_ctx_delete ON my_feedbacks_ctx;
        DROP TRIGGER IF EXISTS trg_my_feedbacks_ctx_update ON my_feedbacks_ctx;
        DROP TRIGGER IF EXISTS trg_my_feedbacks_ctx_insert ON my_feedbacks_ctx;
        """
    ),
    # Step 7: events_profiles trigger functions
    step(
        """
        -- Function for events_profiles_ctx INSERT
        CREATE OR REPLACE FUNCTION trg_insert_events_profiles_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            inserted_profile_id UUID;
            inserted_event_id UUID;
        BEGIN
            IF NEW.profile_id NOT IN (
                SELECT profile_id FROM profiles_ctx WHERE is_editable
            ) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;
            
            IF NEW.all_images AND cur_event_profile_bool('all_images') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: cannot create profile with all_images if current profile does not have all_images';
            END IF;
            
            IF NEW.all_groups AND cur_event_profile_bool('all_groups') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: cannot create profile with all_groups if current profile does not have all_groups';
            END IF;
            
            IF NEW.all_albums AND cur_event_profile_bool('all_albums') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: cannot create profile with all_albums if current profile does not have all_albums';
            END IF;

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
            VALUES (
                NEW.profile_id,
                cur_event_profile_uuid('event_id'),
                COALESCE(NEW.can_manage_event, FALSE),
                COALESCE(NEW.can_delete_event, FALSE),
                COALESCE(NEW.can_upload_and_delete_images, FALSE),
                COALESCE(NEW.can_edit, FALSE),
                COALESCE(NEW.all_images, FALSE),
                COALESCE(NEW.all_groups, FALSE),
                COALESCE(NEW.all_albums, FALSE)
            )
            RETURNING profile_id, event_id INTO inserted_profile_id, inserted_event_id;

            IF NEW.all_images THEN
                INSERT INTO profiles_images (profile_id, image_id)
                SELECT NEW.profile_id, pi.image_id
                FROM profiles_images pi
                WHERE pi.profile_id = cur_profile_uuid('profile_id')
                ON CONFLICT DO NOTHING;
            END IF;

            IF NEW.all_groups THEN
                INSERT INTO profiles_groups (profile_id, group_id)
                SELECT NEW.profile_id, pg.group_id
                FROM profiles_groups pg
                WHERE pg.profile_id = cur_profile_uuid('profile_id')
                ON CONFLICT DO NOTHING;
            END IF;
            
            IF NEW.all_albums THEN
                INSERT INTO profiles_albums (profile_id, album_id)
                SELECT NEW.profile_id, pa.album_id
                FROM profiles_albums pa
                WHERE pa.profile_id = cur_profile_uuid('profile_id')
                ON CONFLICT DO NOTHING;
            END IF;
            
            IF inserted_profile_id IS NOT NULL AND inserted_event_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for events_profiles_ctx UPDATE
        CREATE OR REPLACE FUNCTION trg_update_events_profiles_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            updated_profile_id UUID;
            updated_event_id UUID;
        BEGIN
            IF NEW.all_images AND NOT OLD.all_images AND cur_event_profile_bool('all_images') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: cannot set profile all_images if current profile does not have all_images';
            END IF;
            
            IF NEW.all_groups AND NOT OLD.all_groups AND cur_event_profile_bool('all_groups') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: cannot set profile all_groups if current profile does not have all_groups';
            END IF;
            
            IF NEW.all_albums AND NOT OLD.all_albums AND cur_event_profile_bool('all_albums') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: cannot set profile all_albums if current profile does not have all_albums';
            END IF;

            UPDATE events_profiles
            SET
                can_manage_event = NEW.can_manage_event,
                can_delete_event = NEW.can_delete_event,
                can_upload_and_delete_images = NEW.can_upload_and_delete_images,
                can_edit = NEW.can_edit,
                all_images = NEW.all_images,
                all_groups = NEW.all_groups,
                all_albums = NEW.all_albums
            WHERE event_id = cur_event_profile_uuid('event_id')
            AND profile_id = OLD.profile_id
            RETURNING profile_id, event_id INTO updated_profile_id, updated_event_id;

            IF OLD.all_images AND NOT NEW.all_images THEN
                DELETE FROM profiles_images 
                WHERE profile_id = OLD.profile_id;
            END IF;

            IF NOT OLD.all_images AND NEW.all_images THEN
                INSERT INTO profiles_images (profile_id, image_id)
                SELECT OLD.profile_id, pi.image_id
                FROM profiles_images pi
                WHERE pi.profile_id = cur_profile_uuid('profile_id')
                ON CONFLICT DO NOTHING;
            END IF;

            IF OLD.all_groups AND NOT NEW.all_groups THEN
                DELETE FROM profiles_groups 
                WHERE profile_id = OLD.profile_id;
            END IF;

            IF NOT OLD.all_groups AND NEW.all_groups THEN
                INSERT INTO profiles_groups (profile_id, group_id)
                SELECT OLD.profile_id, pg.group_id
                FROM profiles_groups pg
                WHERE pg.profile_id = cur_profile_uuid('profile_id')
                ON CONFLICT DO NOTHING;
            END IF;

            IF OLD.all_albums AND NOT NEW.all_albums THEN
                DELETE FROM profiles_albums 
                WHERE profile_id = OLD.profile_id;
            END IF;

            IF NOT OLD.all_albums AND NEW.all_albums THEN
                INSERT INTO profiles_albums (profile_id, album_id)
                SELECT OLD.profile_id, pa.album_id
                FROM profiles_albums pa
                WHERE pa.profile_id = cur_profile_uuid('profile_id')
                ON CONFLICT DO NOTHING;
            END IF;
            
            IF updated_profile_id IS NOT NULL AND updated_event_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for events_profiles_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_delete_events_profiles_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_profile_id UUID;
            deleted_event_id UUID;
        BEGIN
            DELETE FROM events_profiles 
            WHERE event_id = cur_event_profile_uuid('event_id') AND profile_id = OLD.profile_id
            RETURNING profile_id, event_id INTO deleted_profile_id, deleted_event_id;
            
            IF deleted_profile_id IS NOT NULL AND deleted_event_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_delete_events_profiles_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_events_profiles_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_events_profiles_ctx() CASCADE;
        """
    ),
    # Step 8: Attach events_profiles triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_insert_events_profiles_ctx ON events_profiles_ctx;
        CREATE TRIGGER trg_insert_events_profiles_ctx
            INSTEAD OF INSERT ON events_profiles_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_insert_events_profiles_ctx();

        DROP TRIGGER IF EXISTS trg_update_events_profiles_ctx ON events_profiles_ctx;
        CREATE TRIGGER trg_update_events_profiles_ctx
            INSTEAD OF UPDATE ON events_profiles_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_update_events_profiles_ctx();

        DROP TRIGGER IF EXISTS trg_delete_events_profiles_ctx ON events_profiles_ctx;
        CREATE TRIGGER trg_delete_events_profiles_ctx
            INSTEAD OF DELETE ON events_profiles_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_delete_events_profiles_ctx();
        """,
        """
        DROP TRIGGER IF EXISTS trg_delete_events_profiles_ctx ON events_profiles_ctx;
        DROP TRIGGER IF EXISTS trg_update_events_profiles_ctx ON events_profiles_ctx;
        DROP TRIGGER IF EXISTS trg_insert_events_profiles_ctx ON events_profiles_ctx;
        """
    ),
    # Step 9: More view trigger functions (profiles_images, profiles_groups, profiles_albums)
    step(
        """
        -- Function for profiles_images_ctx INSERT
        CREATE OR REPLACE FUNCTION trg_insert_profiles_images_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            inserted_profile_id UUID;
            inserted_image_id UUID;
        BEGIN
            IF NEW.profile_id NOT IN (SELECT profile_id FROM events_profiles_ctx) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;
            
            IF NEW.image_id NOT IN (SELECT image_id FROM images_ctx) THEN
                RAISE EXCEPTION 'Permission denied: the image is not accessible';
            END IF;

            INSERT INTO profiles_images (profile_id, image_id)
            VALUES (NEW.profile_id, NEW.image_id)
            ON CONFLICT DO NOTHING
            RETURNING profile_id, image_id INTO inserted_profile_id, inserted_image_id;
            
            IF inserted_profile_id IS NOT NULL AND inserted_image_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for profiles_images_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_delete_profiles_images_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_profile_id UUID;
            deleted_image_id UUID;
        BEGIN
            DELETE FROM profiles_images
            WHERE profile_id = OLD.profile_id
            AND image_id = OLD.image_id
            RETURNING profile_id, image_id INTO deleted_profile_id, deleted_image_id;
            
            IF deleted_profile_id IS NOT NULL AND deleted_image_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for profiles_groups_ctx INSERT
        CREATE OR REPLACE FUNCTION trg_insert_profiles_groups_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            inserted_profile_id UUID;
            inserted_group_id UUID;
        BEGIN
            
            IF NEW.profile_id NOT IN (SELECT profile_id FROM events_profiles_ctx) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;
            
            IF NEW.group_id NOT IN (SELECT group_id FROM groups_ctx) THEN
                RAISE EXCEPTION 'Permission denied: the group is not accessible';
            END IF;

            INSERT INTO profiles_groups (profile_id, group_id)
            VALUES (NEW.profile_id, NEW.group_id)
            ON CONFLICT DO NOTHING
            RETURNING profile_id, group_id INTO inserted_profile_id, inserted_group_id;
            
            IF inserted_profile_id IS NOT NULL AND inserted_group_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for profiles_groups_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_delete_profiles_groups_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_profile_id UUID;
            deleted_group_id UUID;
        BEGIN
            DELETE FROM profiles_groups
            WHERE profile_id = OLD.profile_id
            AND group_id = OLD.group_id
            RETURNING profile_id, group_id INTO deleted_profile_id, deleted_group_id;
            
            IF deleted_profile_id IS NOT NULL AND deleted_group_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for profiles_albums_ctx INSERT
        CREATE OR REPLACE FUNCTION trg_insert_profiles_albums_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            inserted_profile_id UUID;
            inserted_album_id UUID;
        BEGIN
            
            IF NEW.profile_id NOT IN (SELECT profile_id FROM events_profiles_ctx) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;
            
            IF NEW.album_id NOT IN (SELECT album_id FROM albums_ctx) THEN
                RAISE EXCEPTION 'Permission denied: the album is not accessible';
            END IF;

            INSERT INTO profiles_albums (profile_id, album_id)
            VALUES (NEW.profile_id, NEW.album_id)
            ON CONFLICT DO NOTHING
            RETURNING profile_id, album_id INTO inserted_profile_id, inserted_album_id;
            
            IF inserted_profile_id IS NOT NULL AND inserted_album_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for profiles_albums_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_delete_profiles_albums_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_profile_id UUID;
            deleted_album_id UUID;
        BEGIN
            DELETE FROM profiles_albums
            WHERE profile_id = OLD.profile_id
            AND album_id = OLD.album_id
            RETURNING profile_id, album_id INTO deleted_profile_id, deleted_album_id;
            
            IF deleted_profile_id IS NOT NULL AND deleted_album_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_delete_profiles_albums_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_profiles_albums_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_profiles_groups_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_profiles_groups_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_profiles_images_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_profiles_images_ctx() CASCADE;
        """
    ),
    # Step 10: Attach profiles_images/groups/albums triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_insert_profiles_images_ctx ON profiles_images_ctx;
        CREATE TRIGGER trg_insert_profiles_images_ctx
            INSTEAD OF INSERT ON profiles_images_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_insert_profiles_images_ctx();

        DROP TRIGGER IF EXISTS trg_delete_profiles_images_ctx ON profiles_images_ctx;
        CREATE TRIGGER trg_delete_profiles_images_ctx
            INSTEAD OF DELETE ON profiles_images_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_delete_profiles_images_ctx();

        DROP TRIGGER IF EXISTS trg_insert_profiles_groups_ctx ON profiles_groups_ctx;
        CREATE TRIGGER trg_insert_profiles_groups_ctx
            INSTEAD OF INSERT ON profiles_groups_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_insert_profiles_groups_ctx();

        DROP TRIGGER IF EXISTS trg_delete_profiles_groups_ctx ON profiles_groups_ctx;
        CREATE TRIGGER trg_delete_profiles_groups_ctx
            INSTEAD OF DELETE ON profiles_groups_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_delete_profiles_groups_ctx();

        DROP TRIGGER IF EXISTS trg_insert_profiles_albums_ctx ON profiles_albums_ctx;
        CREATE TRIGGER trg_insert_profiles_albums_ctx
            INSTEAD OF INSERT ON profiles_albums_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_insert_profiles_albums_ctx();

        DROP TRIGGER IF EXISTS trg_delete_profiles_albums_ctx ON profiles_albums_ctx;
        CREATE TRIGGER trg_delete_profiles_albums_ctx
            INSTEAD OF DELETE ON profiles_albums_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_delete_profiles_albums_ctx();
        """,
        """
        DROP TRIGGER IF EXISTS trg_delete_profiles_albums_ctx ON profiles_albums_ctx;
        DROP TRIGGER IF EXISTS trg_insert_profiles_albums_ctx ON profiles_albums_ctx;
        DROP TRIGGER IF EXISTS trg_delete_profiles_groups_ctx ON profiles_groups_ctx;
        DROP TRIGGER IF EXISTS trg_insert_profiles_groups_ctx ON profiles_groups_ctx;
        DROP TRIGGER IF EXISTS trg_delete_profiles_images_ctx ON profiles_images_ctx;
        DROP TRIGGER IF EXISTS trg_insert_profiles_images_ctx ON profiles_images_ctx;
        """
    ),
    # Step 11: Faces, images, groups, moments, albums trigger functions
    step(
        """
        -- Function for faces_ctx INSERT
        CREATE OR REPLACE FUNCTION trg_insert_faces_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            new_face_id UUID;
        BEGIN
            IF cur_event_profile_uuid('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF cur_event_profile_bool('can_upload_and_delete_images') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to upload images';
            END IF;
            
            IF NEW.image_id NOT IN (SELECT image_id FROM images_ctx) THEN
                RAISE EXCEPTION 'Permission denied: the image is not accessible';
            END IF;
            
            IF NEW.group_id NOT IN (SELECT group_id FROM groups_ctx) THEN
                RAISE EXCEPTION 'Permission denied: the group is not accessible';
            END IF;

            INSERT INTO faces (
                face_id,
                image_id,
                group_id,
                file_size,
                face_width,
                face_height,
                face_left,
                face_top
            )
            VALUES (
                COALESCE(NEW.face_id, gen_random_uuid()),
                NEW.image_id,
                NEW.group_id,
                COALESCE(NEW.file_size, 0),
                COALESCE(NEW.face_width, 0),
                COALESCE(NEW.face_height, 0),
                COALESCE(NEW.face_left, 0),
                COALESCE(NEW.face_top, 0)
            )
            RETURNING face_id INTO new_face_id;
            
            NEW.face_id := new_face_id;
            
            IF new_face_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for faces_ctx UPDATE
        CREATE OR REPLACE FUNCTION trg_update_faces_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            updated_face_id UUID;
        BEGIN
            IF cur_event_profile_bool('can_edit') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;
            
            IF NEW.group_id NOT IN (SELECT group_id FROM groups_ctx) THEN
                RAISE EXCEPTION 'Permission denied: the target group is not accessible';
            END IF;

            UPDATE faces SET group_id = NEW.group_id WHERE face_id = OLD.face_id
            RETURNING face_id INTO updated_face_id;
            
            IF updated_face_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for faces_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_delete_faces_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_face_id UUID;
        BEGIN
            IF cur_event_profile_bool('can_upload_and_delete_images') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            DELETE FROM faces WHERE face_id = OLD.face_id
            RETURNING face_id INTO deleted_face_id;
            
            IF deleted_face_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for images_ctx INSERT
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

        -- Function for images_ctx UPDATE
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
                width = NEW.width,
                height = NEW.height,
                high_quality_file_size = NEW.high_quality_file_size,
                display_file_size = NEW.display_file_size,
                thumb_file_size = NEW.thumb_file_size,
                status = NEW.status
            WHERE image_id = OLD.image_id
            RETURNING image_id INTO updated_image_id;
            
            IF updated_image_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for images_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_delete_images_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_image_id UUID;
        BEGIN
            IF cur_event_profile_bool('can_upload_and_delete_images') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to delete images';
            END IF;

            DELETE FROM images WHERE image_id = OLD.image_id
            RETURNING image_id INTO deleted_image_id;
            
            IF deleted_image_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_delete_images_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_images_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_images_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_faces_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_faces_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_faces_ctx() CASCADE;
        """
    ),
    # Step 12: Attach faces and images triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_insert_faces_ctx ON faces_ctx;
        CREATE TRIGGER trg_insert_faces_ctx
            INSTEAD OF INSERT ON faces_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_insert_faces_ctx();

        DROP TRIGGER IF EXISTS trg_update_faces_ctx ON faces_ctx;
        CREATE TRIGGER trg_update_faces_ctx
            INSTEAD OF UPDATE ON faces_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_update_faces_ctx();

        DROP TRIGGER IF EXISTS trg_delete_faces_ctx ON faces_ctx;
        CREATE TRIGGER trg_delete_faces_ctx
            INSTEAD OF DELETE ON faces_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_delete_faces_ctx();

        DROP TRIGGER IF EXISTS trg_insert_images_ctx ON images_ctx;
        CREATE TRIGGER trg_insert_images_ctx
            INSTEAD OF INSERT ON images_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_insert_images_ctx();

        DROP TRIGGER IF EXISTS trg_update_images_ctx ON images_ctx;
        CREATE TRIGGER trg_update_images_ctx
            INSTEAD OF UPDATE ON images_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_update_images_ctx();

        DROP TRIGGER IF EXISTS trg_delete_images_ctx ON images_ctx;
        CREATE TRIGGER trg_delete_images_ctx
            INSTEAD OF DELETE ON images_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_delete_images_ctx();
        """,
        """
        DROP TRIGGER IF EXISTS trg_delete_images_ctx ON images_ctx;
        DROP TRIGGER IF EXISTS trg_update_images_ctx ON images_ctx;
        DROP TRIGGER IF EXISTS trg_insert_images_ctx ON images_ctx;
        DROP TRIGGER IF EXISTS trg_delete_faces_ctx ON faces_ctx;
        DROP TRIGGER IF EXISTS trg_update_faces_ctx ON faces_ctx;
        DROP TRIGGER IF EXISTS trg_insert_faces_ctx ON faces_ctx;
        """
    ),
    # Step 13: Groups, moments, albums trigger functions
    step(
        """
        -- Function for groups_ctx INSERT
        CREATE OR REPLACE FUNCTION trg_insert_groups_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            new_group_id UUID;
        BEGIN
            IF cur_event_profile_uuid('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF cur_event_profile_bool('can_edit') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            INSERT INTO groups (
                group_id,
                event_id,
                label,
                representative_face
            )
            VALUES (
                COALESCE(NEW.group_id, gen_random_uuid()),
                cur_event_profile_uuid('event_id'),
                NEW.label,
                NEW.representative_face
            )
            RETURNING group_id INTO new_group_id;
            
            NEW.group_id := new_group_id;
            
            IF new_group_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for groups_ctx UPDATE
        CREATE OR REPLACE FUNCTION trg_update_groups_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            updated_group_id UUID;
        BEGIN
            IF cur_event_profile_bool('can_edit') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            UPDATE groups SET label = NEW.label, representative_face = NEW.representative_face
            WHERE group_id = OLD.group_id
            RETURNING group_id INTO updated_group_id;
            
            IF updated_group_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for groups_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_delete_groups_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_group_id UUID;
        BEGIN
            IF cur_event_profile_bool('can_edit') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            DELETE FROM groups WHERE group_id = OLD.group_id
            RETURNING group_id INTO deleted_group_id;
            
            IF deleted_group_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for moments_ctx INSERT
        CREATE OR REPLACE FUNCTION trg_insert_moments_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            new_moment_id UUID;
        BEGIN
            IF cur_event_profile_uuid('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF cur_event_profile_bool('can_edit') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            INSERT INTO moments (
                moment_id,
                event_id,
                label,
                description,
                start_date,
                end_date,
                representative_image
            )
            VALUES (
                COALESCE(NEW.moment_id, gen_random_uuid()),
                cur_event_profile_uuid('event_id'),
                NEW.label,
                NEW.description,
                NEW.start_date,
                NEW.end_date,
                NEW.representative_image
            )
            RETURNING moment_id INTO new_moment_id;
            
            NEW.moment_id := new_moment_id;
            
            IF new_moment_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for moments_ctx UPDATE
        CREATE OR REPLACE FUNCTION trg_update_moments_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            updated_moment_id UUID;
        BEGIN
            IF cur_event_profile_bool('can_edit') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            UPDATE moments SET
                label = NEW.label,
                description = NEW.description,
                start_date = NEW.start_date,
                end_date = NEW.end_date,
                representative_image = NEW.representative_image
            WHERE moment_id = OLD.moment_id
            RETURNING moment_id INTO updated_moment_id;
            
            IF updated_moment_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for moments_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_delete_moments_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_moment_id UUID;
        BEGIN
            IF cur_event_profile_bool('can_edit') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            DELETE FROM moments WHERE moment_id = OLD.moment_id
            RETURNING moment_id INTO deleted_moment_id;
            
            IF deleted_moment_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for albums_ctx INSERT
        CREATE OR REPLACE FUNCTION trg_insert_albums_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            new_album_id UUID;
        BEGIN
            IF cur_event_profile_uuid('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF cur_event_profile_bool('can_edit') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;
            
            INSERT INTO albums (
                album_id,
                event_id,
                label,
                description,
                representative_image
            )
            VALUES (
                COALESCE(NEW.album_id, gen_random_uuid()),
                cur_event_profile_uuid('event_id'),
                NEW.label,
                NEW.description,
                NEW.representative_image
            )
            RETURNING album_id INTO new_album_id;
            
            NEW.album_id := new_album_id;
            
            IF new_album_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for albums_ctx UPDATE
        CREATE OR REPLACE FUNCTION trg_update_albums_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            updated_album_id UUID;
        BEGIN
            IF cur_event_profile_bool('can_edit') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            UPDATE albums SET
                label = NEW.label,
                description = NEW.description,
                representative_image = NEW.representative_image
            WHERE album_id = OLD.album_id
            RETURNING album_id INTO updated_album_id;
            
            IF updated_album_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for albums_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_delete_albums_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_album_id UUID;
        BEGIN
            IF cur_event_profile_bool('can_edit') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            DELETE FROM albums WHERE album_id = OLD.album_id
            RETURNING album_id INTO deleted_album_id;
            
            IF deleted_album_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for albums_images_ctx INSERT
        CREATE OR REPLACE FUNCTION trg_insert_albums_images_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            inserted_album_id UUID;
            inserted_image_id UUID;
        BEGIN
            IF cur_event_profile_uuid('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF cur_event_profile_bool('can_edit') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            IF NEW.image_id NOT IN (SELECT image_id FROM images_ctx) THEN
                RAISE EXCEPTION 'Permission denied: the image is not accessible';
            END IF;

            IF NEW.album_id NOT IN (SELECT album_id FROM albums_ctx) THEN
                RAISE EXCEPTION 'Permission denied: the album is not accessible';
            END IF;

            INSERT INTO albums_images (album_id, image_id)
            VALUES (NEW.album_id, NEW.image_id)
            ON CONFLICT DO NOTHING
            RETURNING album_id, image_id INTO inserted_album_id, inserted_image_id;
            
            IF inserted_album_id IS NOT NULL AND inserted_image_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for albums_images_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_delete_albums_images_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_album_id UUID;
            deleted_image_id UUID;
        BEGIN
            IF cur_event_profile_bool('can_edit') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            DELETE FROM albums_images
            WHERE album_id = OLD.album_id AND image_id = OLD.image_id
            RETURNING album_id, image_id INTO deleted_album_id, deleted_image_id;
            
            IF deleted_album_id IS NOT NULL AND deleted_image_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_delete_albums_images_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_albums_images_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_albums_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_albums_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_albums_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_moments_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_moments_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_moments_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_groups_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_groups_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_groups_ctx() CASCADE;
        """
    ),
    # Step 14: Attach groups, moments, albums triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_insert_groups_ctx ON groups_ctx;
        CREATE TRIGGER trg_insert_groups_ctx
            INSTEAD OF INSERT ON groups_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_insert_groups_ctx();

        DROP TRIGGER IF EXISTS trg_update_groups_ctx ON groups_ctx;
        CREATE TRIGGER trg_update_groups_ctx
            INSTEAD OF UPDATE ON groups_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_update_groups_ctx();

        DROP TRIGGER IF EXISTS trg_delete_groups_ctx ON groups_ctx;
        CREATE TRIGGER trg_delete_groups_ctx
            INSTEAD OF DELETE ON groups_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_delete_groups_ctx();

        DROP TRIGGER IF EXISTS trg_insert_moments_ctx ON moments_ctx;
        CREATE TRIGGER trg_insert_moments_ctx
            INSTEAD OF INSERT ON moments_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_insert_moments_ctx();

        DROP TRIGGER IF EXISTS trg_update_moments_ctx ON moments_ctx;
        CREATE TRIGGER trg_update_moments_ctx
            INSTEAD OF UPDATE ON moments_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_update_moments_ctx();

        DROP TRIGGER IF EXISTS trg_delete_moments_ctx ON moments_ctx;
        CREATE TRIGGER trg_delete_moments_ctx
            INSTEAD OF DELETE ON moments_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_delete_moments_ctx();

        DROP TRIGGER IF EXISTS trg_insert_albums_ctx ON albums_ctx;
        CREATE TRIGGER trg_insert_albums_ctx
            INSTEAD OF INSERT ON albums_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_insert_albums_ctx();

        DROP TRIGGER IF EXISTS trg_update_albums_ctx ON albums_ctx;
        CREATE TRIGGER trg_update_albums_ctx
            INSTEAD OF UPDATE ON albums_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_update_albums_ctx();

        DROP TRIGGER IF EXISTS trg_delete_albums_ctx ON albums_ctx;
        CREATE TRIGGER trg_delete_albums_ctx
            INSTEAD OF DELETE ON albums_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_delete_albums_ctx();

        DROP TRIGGER IF EXISTS trg_insert_albums_images_ctx ON albums_images_ctx;
        CREATE TRIGGER trg_insert_albums_images_ctx
            INSTEAD OF INSERT ON albums_images_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_insert_albums_images_ctx();

        DROP TRIGGER IF EXISTS trg_delete_albums_images_ctx ON albums_images_ctx;
        CREATE TRIGGER trg_delete_albums_images_ctx
            INSTEAD OF DELETE ON albums_images_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_delete_albums_images_ctx();
        """,
        """
        DROP TRIGGER IF EXISTS trg_delete_albums_images_ctx ON albums_images_ctx;
        DROP TRIGGER IF EXISTS trg_insert_albums_images_ctx ON albums_images_ctx;
        DROP TRIGGER IF EXISTS trg_delete_albums_ctx ON albums_ctx;
        DROP TRIGGER IF EXISTS trg_update_albums_ctx ON albums_ctx;
        DROP TRIGGER IF EXISTS trg_insert_albums_ctx ON albums_ctx;
        DROP TRIGGER IF EXISTS trg_delete_moments_ctx ON moments_ctx;
        DROP TRIGGER IF EXISTS trg_update_moments_ctx ON moments_ctx;
        DROP TRIGGER IF EXISTS trg_insert_moments_ctx ON moments_ctx;
        DROP TRIGGER IF EXISTS trg_delete_groups_ctx ON groups_ctx;
        DROP TRIGGER IF EXISTS trg_update_groups_ctx ON groups_ctx;
        DROP TRIGGER IF EXISTS trg_insert_groups_ctx ON groups_ctx;
        """
    ),
    # Step 15: Uploads and access_requests trigger functions
    step(
        """
        -- Function for uploads_ctx INSERT
        CREATE OR REPLACE FUNCTION trg_insert_uploads_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            new_upload_id INTEGER;
        BEGIN
            IF cur_event_profile_uuid('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF cur_event_profile_bool('can_upload_and_delete_images') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: cannot upload and delete images';
            END IF;

            INSERT INTO uploads (
                event_id,
                profile_id,
                started_at,
                completed_at,
                status,
                images_count,
                faces_count,
                clusters_count,
                moments_count,
                errors,
                notes
            )
            VALUES (
                cur_event_profile_uuid('event_id'),
                cur_profile_uuid('profile_id'),
                COALESCE(NEW.started_at, CURRENT_TIMESTAMP),
                NEW.completed_at,
                COALESCE(NEW.status, 'PROCESSING_IMAGES'),
                COALESCE(NEW.images_count, 0),
                COALESCE(NEW.faces_count, 0),
                COALESCE(NEW.clusters_count, 0),
                COALESCE(NEW.moments_count, 0),
                NEW.errors,
                NEW.notes
            )
            RETURNING upload_id INTO new_upload_id;
            
            NEW.upload_id := new_upload_id;
            
            IF new_upload_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for uploads_ctx UPDATE
        CREATE OR REPLACE FUNCTION trg_update_uploads_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            updated_upload_id INTEGER;
        BEGIN
            IF OLD.profile_id IS DISTINCT FROM cur_profile_uuid('profile_id') THEN
                RAISE EXCEPTION 'Permission denied: the upload is not editable';
            END IF;
            
            IF cur_event_profile_bool('can_upload_and_delete_images') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: cannot upload and delete images';
            END IF;

            UPDATE uploads SET
                completed_at = NEW.completed_at,
                status = NEW.status,
                images_count = NEW.images_count,
                faces_count = NEW.faces_count,
                clusters_count = NEW.clusters_count,
                moments_count = NEW.moments_count,
                errors = NEW.errors,
                notes = NEW.notes
            WHERE upload_id = OLD.upload_id
            RETURNING upload_id INTO updated_upload_id;
            
            IF updated_upload_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for uploads_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_delete_uploads_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_upload_id INTEGER;
        BEGIN
            IF cur_event_profile_bool('can_upload_and_delete_images') IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION 'Permission denied: cannot upload and delete images';
            END IF;
            
            IF OLD.profile_id IS DISTINCT FROM cur_profile_uuid('profile_id') AND OLD.profile_id NOT IN (
                SELECT profile_id FROM events_profiles_ctx
            ) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;

            DELETE FROM uploads WHERE upload_id = OLD.upload_id
            RETURNING upload_id INTO deleted_upload_id;
            
            IF deleted_upload_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_delete_uploads_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_uploads_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_uploads_ctx() CASCADE;
        """
    ),
    # Step 16: Attach uploads triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_insert_uploads_ctx ON uploads_ctx;
        CREATE TRIGGER trg_insert_uploads_ctx
            INSTEAD OF INSERT ON uploads_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_insert_uploads_ctx();

        DROP TRIGGER IF EXISTS trg_update_uploads_ctx ON uploads_ctx;
        CREATE TRIGGER trg_update_uploads_ctx
            INSTEAD OF UPDATE ON uploads_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_update_uploads_ctx();

        DROP TRIGGER IF EXISTS trg_delete_uploads_ctx ON uploads_ctx;
        CREATE TRIGGER trg_delete_uploads_ctx
            INSTEAD OF DELETE ON uploads_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_delete_uploads_ctx();
        """,
        """
        DROP TRIGGER IF EXISTS trg_delete_uploads_ctx ON uploads_ctx;
        DROP TRIGGER IF EXISTS trg_update_uploads_ctx ON uploads_ctx;
        DROP TRIGGER IF EXISTS trg_insert_uploads_ctx ON uploads_ctx;
        """
    ),
    # Step 17: Critical BEFORE/AFTER table triggers
    step(
        """
        -- Function to prevent reserved event URLs
        CREATE OR REPLACE FUNCTION trg_prevent_reserved_event_urls()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.url IN ('dashboard', 'reset-password', 'about') THEN
                RAISE EXCEPTION 'Policy error: The URL "%" is reserved and cannot be used for events', NEW.url;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to ensure events images limit valid
        CREATE OR REPLACE FUNCTION trg_ensure_events_images_limit_valid()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.images_count_limit < 0 OR NEW.images_count_limit > (SELECT images_count_limit FROM settings WHERE id = 1 LIMIT 1) THEN
                RAISE EXCEPTION 'Policy error: Invalid images count limit';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to ensure events image size limit valid
        CREATE OR REPLACE FUNCTION trg_ensure_events_image_size_limit_valid()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.image_size_limit_bytes < 0 OR NEW.image_size_limit_bytes > (SELECT image_size_limit_bytes FROM settings WHERE id = 1 LIMIT 1) THEN
                RAISE EXCEPTION 'Policy error: Invalid image size limit';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to ensure profiles unique
        CREATE OR REPLACE FUNCTION trg_ensure_profiles_unique()
        RETURNS TRIGGER AS $$
        DECLARE
            exclude_id UUID := NULL;
        BEGIN
            IF TG_OP = 'UPDATE' THEN
                exclude_id := OLD.profile_id;
            END IF;
            IF EXISTS (
                SELECT 1 FROM profiles
                WHERE LOWER(label) = LOWER(NEW.label)
                AND (
                    restricted_to_event IS NOT DISTINCT FROM NEW.restricted_to_event
                    OR restricted_to_event IS NULL
                )
                AND (TG_OP = 'INSERT' OR profile_id <> exclude_id)
            ) THEN
                RAISE EXCEPTION 'Policy error: Profile label already exists';
            END IF;
            
            IF EXISTS (
                SELECT 1 FROM profiles
                WHERE password = NEW.password AND label = NEW.label
                AND (TG_OP = 'INSERT' OR profile_id <> exclude_id)
            ) THEN
                RAISE EXCEPTION 'Policy error: Label with this password already exists';
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to ensure profiles email required
        CREATE OR REPLACE FUNCTION trg_ensure_profiles_email_required()
        RETURNS TRIGGER AS $$
        DECLARE
            exclude_id UUID := NULL;
        BEGIN
            IF COALESCE(NEW.email, '') = '' AND NOT NEW.is_public THEN
                RAISE EXCEPTION 'Policy error: Email is required for non-public profiles';
            END IF;
            
            IF TG_OP = 'UPDATE' THEN
                exclude_id := OLD.profile_id;
            END IF;
            
            IF NEW.email IS NOT NULL AND EXISTS (
                SELECT 1 FROM profiles
                WHERE LOWER(email) = LOWER(NEW.email)
                AND (TG_OP = 'INSERT' OR profile_id <> exclude_id)
            ) THEN
                RAISE EXCEPTION 'Policy error: Email already exists';
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to insert default preferences
        CREATE OR REPLACE FUNCTION trg_profiles_insert_default_preferences()
        RETURNS TRIGGER AS $$
        BEGIN
            INSERT INTO profiles_preferences (
                profile_id,
                preference_group,
                preference_key,
                preference_value
            )
            SELECT
                NEW.profile_id,
                dp.preference_group,
                dp.preference_key,
                dp.value
            FROM default_preferences dp
            ON CONFLICT DO NOTHING;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to ensure defaults in event
        CREATE OR REPLACE FUNCTION trg_ensure_defaults_in_event_insert()
        RETURNS TRIGGER AS $$
        DECLARE
            v_archive_album_id UUID := gen_random_uuid();
            v_favorites_album_id UUID := gen_random_uuid();
            v_unassociated_group_id UUID := gen_random_uuid();
        BEGIN
            INSERT INTO events_profiles (
                event_id,
                profile_id,
                can_manage_event,
                can_delete_event,
                can_upload_and_delete_images,
                can_edit,
                all_images,
                all_groups,
                all_albums
            )
            SELECT
                NEW.event_id, developer_id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE
            FROM settings
            WHERE settings.id = 1
            ON CONFLICT DO NOTHING;

            INSERT INTO albums (event_id, album_id, label)
            VALUES (NEW.event_id, v_archive_album_id, 'Archive')
            ON CONFLICT DO NOTHING;

            INSERT INTO albums (event_id, album_id, label)
            VALUES (NEW.event_id, v_favorites_album_id, 'Favorites')
            ON CONFLICT DO NOTHING;

            INSERT INTO groups (event_id, group_id, label)
            VALUES (NEW.event_id, v_unassociated_group_id, 'Unassociated')
            ON CONFLICT DO NOTHING;

            UPDATE events SET
                archive_album_id = v_archive_album_id,
                favorites_album_id = v_favorites_album_id,
                unassociated_group_id = v_unassociated_group_id
            WHERE event_id = NEW.event_id;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_ensure_defaults_in_event_insert() CASCADE;
        DROP FUNCTION IF EXISTS trg_profiles_insert_default_preferences() CASCADE;
        DROP FUNCTION IF EXISTS trg_ensure_profiles_email_required() CASCADE;
        DROP FUNCTION IF EXISTS trg_ensure_profiles_unique() CASCADE;
        DROP FUNCTION IF EXISTS trg_ensure_events_image_size_limit_valid() CASCADE;
        DROP FUNCTION IF EXISTS trg_ensure_events_images_limit_valid() CASCADE;
        DROP FUNCTION IF EXISTS trg_prevent_reserved_event_urls() CASCADE;
        """
    ),
    # Step 18: Attach BEFORE/AFTER table triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_prevent_reserved_event_urls_insert ON events;
        CREATE TRIGGER trg_prevent_reserved_event_urls_insert
            BEFORE INSERT ON events
            FOR EACH ROW EXECUTE FUNCTION trg_prevent_reserved_event_urls();

        DROP TRIGGER IF EXISTS trg_prevent_reserved_event_urls_update ON events;
        CREATE TRIGGER trg_prevent_reserved_event_urls_update
            BEFORE UPDATE ON events
            FOR EACH ROW EXECUTE FUNCTION trg_prevent_reserved_event_urls();

        DROP TRIGGER IF EXISTS trg_ensure_events_images_limit_valid_insert ON events;
        CREATE TRIGGER trg_ensure_events_images_limit_valid_insert
            BEFORE INSERT ON events
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_events_images_limit_valid();

        DROP TRIGGER IF EXISTS trg_ensure_events_images_limit_valid_update ON events;
        CREATE TRIGGER trg_ensure_events_images_limit_valid_update
            BEFORE UPDATE ON events
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_events_images_limit_valid();

        DROP TRIGGER IF EXISTS trg_ensure_events_image_size_limit_valid_insert ON events;
        CREATE TRIGGER trg_ensure_events_image_size_limit_valid_insert
            BEFORE INSERT ON events
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_events_image_size_limit_valid();

        DROP TRIGGER IF EXISTS trg_ensure_events_image_size_limit_valid_update ON events;
        CREATE TRIGGER trg_ensure_events_image_size_limit_valid_update
            BEFORE UPDATE ON events
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_events_image_size_limit_valid();

        DROP TRIGGER IF EXISTS trg_ensure_profiles_unique_insert ON profiles;
        CREATE TRIGGER trg_ensure_profiles_unique_insert
            BEFORE INSERT ON profiles
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_profiles_unique();

        DROP TRIGGER IF EXISTS trg_ensure_profiles_unique_update ON profiles;
        CREATE TRIGGER trg_ensure_profiles_unique_update
            BEFORE UPDATE ON profiles
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_profiles_unique();

        DROP TRIGGER IF EXISTS trg_ensure_profiles_email_required_insert ON profiles;
        CREATE TRIGGER trg_ensure_profiles_email_required_insert
            BEFORE INSERT ON profiles
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_profiles_email_required();

        DROP TRIGGER IF EXISTS trg_ensure_profiles_email_required_update ON profiles;
        CREATE TRIGGER trg_ensure_profiles_email_required_update
            BEFORE UPDATE ON profiles
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_profiles_email_required();

        DROP TRIGGER IF EXISTS trg_profiles_insert_default_preferences ON profiles;
        CREATE TRIGGER trg_profiles_insert_default_preferences
            AFTER INSERT ON profiles
            FOR EACH ROW EXECUTE FUNCTION trg_profiles_insert_default_preferences();

        DROP TRIGGER IF EXISTS trg_ensure_defaults_in_event_insert ON events;
        CREATE TRIGGER trg_ensure_defaults_in_event_insert
            AFTER INSERT ON events
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_defaults_in_event_insert();
        """,
        """
        DROP TRIGGER IF EXISTS trg_ensure_defaults_in_event_insert ON events;
        DROP TRIGGER IF EXISTS trg_profiles_insert_default_preferences ON profiles;
        DROP TRIGGER IF EXISTS trg_ensure_profiles_email_required_update ON profiles;
        DROP TRIGGER IF EXISTS trg_ensure_profiles_email_required_insert ON profiles;
        DROP TRIGGER IF EXISTS trg_ensure_profiles_unique_update ON profiles;
        DROP TRIGGER IF EXISTS trg_ensure_profiles_unique_insert ON profiles;
        DROP TRIGGER IF EXISTS trg_ensure_events_image_size_limit_valid_update ON events;
        DROP TRIGGER IF EXISTS trg_ensure_events_image_size_limit_valid_insert ON events;
        DROP TRIGGER IF EXISTS trg_ensure_events_images_limit_valid_update ON events;
        DROP TRIGGER IF EXISTS trg_ensure_events_images_limit_valid_insert ON events;
        DROP TRIGGER IF EXISTS trg_prevent_reserved_event_urls_update ON events;
        DROP TRIGGER IF EXISTS trg_prevent_reserved_event_urls_insert ON events;
        """
    ),
    # Step 19: Access requests trigger functions
    step(
        """
        -- Function for my_access_requests_ctx INSERT
        CREATE OR REPLACE FUNCTION trg_insert_my_access_requests_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            new_access_request_id INTEGER;
        BEGIN
            IF cur_event_profile_uuid('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF
                NEW.profile_id IS DISTINCT FROM cur_profile_uuid('profile_id')
                OR (NEW.applicant_profile_id IS NOT NULL AND NEW.applicant_profile_id IS DISTINCT FROM cur_profile_uuid('profile_id'))
            THEN
                RAISE EXCEPTION 'Permission denied: cannot create access request for another profile';
            END IF;
            
            IF cur_profile_bool('is_public') AND (NEW.applicant_name IS NULL OR NEW.applicant_email IS NULL) THEN
                RAISE EXCEPTION 'Permission denied: access request by public profile is only allowed for another profile with name and email required';
            END IF;

            INSERT INTO access_requests (
                event_id,
                profile_id,
                requested_at,
                applicant_name,
                applicant_email,
                applicant_phone,
                details,
                applicant_profile_id,
                communication_consent
            )
            VALUES (
                cur_event_profile_uuid('event_id'),
                NEW.profile_id,
                COALESCE(NEW.requested_at, CURRENT_TIMESTAMP),
                CASE WHEN cur_profile_bool('is_public') THEN NEW.applicant_name ELSE NULL END,
                CASE WHEN cur_profile_bool('is_public') THEN NEW.applicant_email ELSE NULL END,
                CASE WHEN cur_profile_bool('is_public') THEN NEW.applicant_phone ELSE NULL END,
                NEW.details,
                CASE WHEN NOT cur_profile_bool('is_public') THEN NEW.applicant_profile_id ELSE NULL END,
                COALESCE(CASE WHEN cur_profile_bool('is_public') THEN TRUE ELSE NEW.communication_consent END, FALSE)
            )
            RETURNING access_request_id INTO new_access_request_id;
            
            NEW.access_request_id := new_access_request_id;
            
            IF new_access_request_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for my_access_requests_ctx UPDATE
        CREATE OR REPLACE FUNCTION trg_update_my_access_requests_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            updated_access_request_id INTEGER;
        BEGIN
            IF OLD.is_closed THEN
                RAISE EXCEPTION 'Permission denied: cannot update closed access request';
            END IF;

            UPDATE access_requests SET
                details = NEW.details,
                communication_consent = COALESCE(cur_profile_bool('is_public') OR NEW.communication_consent, FALSE)
            WHERE access_request_id = OLD.access_request_id
            RETURNING access_request_id INTO updated_access_request_id;
            
            IF updated_access_request_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for my_access_requests_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_delete_my_access_requests_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_access_request_id INTEGER;
            has_closed_group BOOLEAN;
        BEGIN
            IF OLD.is_closed THEN
                RAISE EXCEPTION 'Permission denied: cannot delete closed access request';
            END IF;

            -- Check if there is at least one closed group (approved or denied)
            SELECT EXISTS(
                SELECT 1 
                FROM access_requests_groups arg
                WHERE arg.access_request_id = OLD.access_request_id
                AND arg.approved IS NOT NULL
            ) INTO has_closed_group;

            IF has_closed_group THEN
                RAISE EXCEPTION 'Permission denied: cannot delete access request with closed groups';
            END IF;

            DELETE FROM access_requests WHERE access_request_id = OLD.access_request_id
            RETURNING access_request_id INTO deleted_access_request_id;
            
            IF deleted_access_request_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for my_access_requests_groups_ctx INSERT
        CREATE OR REPLACE FUNCTION trg_insert_my_access_requests_groups_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            inserted_access_request_id INTEGER;
            inserted_group_id UUID;
        BEGIN
            IF cur_event_profile_uuid('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF cur_profile_uuid('profile_id') IS DISTINCT FROM (SELECT ar.profile_id FROM access_requests ar WHERE NEW.access_request_id = ar.access_request_id) THEN
                RAISE EXCEPTION 'Permission denied: the access request is not accessible';
            END IF;
            
            IF (SELECT is_closed FROM access_requests WHERE access_request_id = NEW.access_request_id) THEN
                RAISE EXCEPTION 'Permission denied: the access request is closed';
            END IF;

            INSERT INTO access_requests_groups (access_request_id, group_id)
            SELECT NEW.access_request_id, cgtra.group_id
            FROM groups_to_access_requests_ctx cgtra
            WHERE cgtra.group_id = NEW.group_id
            ON CONFLICT DO NOTHING
            RETURNING access_request_id, group_id INTO inserted_access_request_id, inserted_group_id;

            INSERT INTO notifications (
                profile_id,
                message,
                type,
                data
            )
            SELECT
                p.profile_id,
                'A new access request was created',
                'access_request',
                json_build_object('access_request_id', NEW.access_request_id, 'event_id', cur_event_profile_uuid('event_id'))
            FROM events_profiles ep
            INNER JOIN profiles p ON ep.profile_id = p.profile_id
            WHERE
                ep.event_id = cur_event_profile_uuid('event_id')
                AND p.hierarchy_rank > 0
                AND NOT EXISTS (
                    SELECT 1
                    FROM notifications n
                    WHERE n.type = 'access_request'
                    AND n.profile_id = p.profile_id
                    AND (n.data->>'access_request_id')::INTEGER = NEW.access_request_id::INTEGER
                    AND (n.data->>'event_id')::UUID = cur_event_profile_uuid('event_id')
                )
                AND EXISTS (
                    SELECT 1
                    FROM groups_eff ga
                    WHERE ga.group_id = NEW.group_id
                    AND ga.profile_id = p.profile_id
                    AND ga.event_id = cur_event_profile_uuid('event_id')
                    AND ga.is_accessible
                );
            
            IF inserted_access_request_id IS NOT NULL AND inserted_group_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for my_access_requests_groups_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_delete_my_access_requests_groups_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_access_request_id INTEGER;
            deleted_group_id UUID;
        BEGIN
            IF cur_profile_uuid('profile_id') IS DISTINCT FROM (SELECT ar.profile_id FROM access_requests ar WHERE OLD.access_request_id = ar.access_request_id) THEN
                RAISE EXCEPTION 'Permission denied: the access request is not accessible';
            END IF;
            
            IF (SELECT is_closed FROM access_requests WHERE access_request_id = OLD.access_request_id) THEN
                RAISE EXCEPTION 'Permission denied: the access request is closed';
            END IF;

            DELETE FROM access_requests_groups 
            WHERE access_request_id = OLD.access_request_id AND group_id = OLD.group_id
            RETURNING access_request_id, group_id INTO deleted_access_request_id, deleted_group_id;
            
            PERFORM ensure_access_requests_closed_func(OLD.access_request_id, NULL);

            IF deleted_access_request_id IS NOT NULL AND deleted_group_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for access_requests_ctx UPDATE
        CREATE OR REPLACE FUNCTION trg_update_access_requests_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            updated_access_request_id INTEGER;
        BEGIN
            IF OLD.is_closed THEN
                RAISE EXCEPTION 'Permission denied: the access request is closed';
            END IF;

            UPDATE access_requests SET applicant_profile_id = NEW.applicant_profile_id
            WHERE access_request_id = OLD.access_request_id
            RETURNING access_request_id INTO updated_access_request_id;
            
            IF updated_access_request_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for access_requests_ctx DELETE
        CREATE OR REPLACE FUNCTION trg_delete_access_requests_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            deleted_access_request_id INTEGER;
        BEGIN
            DELETE FROM access_requests WHERE access_request_id = OLD.access_request_id
            RETURNING access_request_id INTO deleted_access_request_id;
            
            IF deleted_access_request_id IS NOT NULL THEN
                RETURN OLD;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for access_requests_groups_ctx UPDATE
        CREATE OR REPLACE FUNCTION trg_update_access_requests_groups_ctx()
        RETURNS TRIGGER AS $$
        DECLARE
            applicant_profile_id UUID := (SELECT applicant_profile_id FROM access_requests WHERE access_request_id = OLD.access_request_id);
            updated_access_request_id INTEGER;
            was_closed BOOLEAN;
            v_event_id UUID;
        BEGIN
            was_closed := (SELECT is_closed FROM access_requests WHERE access_request_id = OLD.access_request_id);
            
            IF was_closed THEN
                RAISE EXCEPTION 'Permission denied: the access request is closed';
            END IF;
            
            IF OLD.approved IS NOT NULL THEN
                RAISE EXCEPTION 'Permission denied: the access request group is closed';
            END IF;
            
            IF NEW.approved IS TRUE AND OLD.group_id NOT IN (SELECT group_id FROM groups_ctx) THEN
                RAISE EXCEPTION 'Permission denied: the group is not accessible';
            END IF;

            IF NEW.approved IS TRUE THEN
                IF (
                    SELECT all_groups
                    FROM events_profiles_ctx
                    WHERE
                        profile_id = applicant_profile_id
                ) IS DISTINCT FROM TRUE
                THEN
                    INSERT INTO profiles_groups (profile_id, group_id)
                    VALUES (applicant_profile_id, OLD.group_id)
                    ON CONFLICT DO NOTHING;
                ELSE
                    DELETE FROM profiles_groups
                    WHERE profile_id = applicant_profile_id
                    AND group_id = OLD.group_id;
                END IF;
            END IF;

            UPDATE access_requests_groups SET
                approved = NEW.approved,
                closed_at = COALESCE(NEW.closed_at, CURRENT_TIMESTAMP),
                closed_by = cur_profile_uuid('profile_id')
            WHERE access_request_id = OLD.access_request_id AND group_id = OLD.group_id
            RETURNING access_request_id INTO updated_access_request_id;

            PERFORM ensure_access_requests_closed_func(OLD.access_request_id, NEW.closed_at);
            
            -- Create notification when request is updated (even partially) if applicant_profile_id exists
            IF applicant_profile_id IS NOT NULL THEN
                SELECT event_id INTO v_event_id
                FROM access_requests
                WHERE access_request_id = OLD.access_request_id;
                
                INSERT INTO notifications (
                    profile_id,
                    message,
                    type,
                    data
                )
                SELECT
                    applicant_profile_id,
                    'Your access request was processed',
                    'my_access_request',
                    json_build_object('access_request_id', OLD.access_request_id, 'event_id', v_event_id)
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM notifications n
                    WHERE n.type = 'my_access_request'
                    AND n.profile_id = applicant_profile_id
                    AND (n.data->>'access_request_id')::INTEGER = OLD.access_request_id
                    AND (n.data->>'event_id')::UUID = v_event_id
                );
            END IF;
            
            IF updated_access_request_id IS NOT NULL THEN
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_update_access_requests_groups_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_access_requests_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_access_requests_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_my_access_requests_groups_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_my_access_requests_groups_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_my_access_requests_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_my_access_requests_ctx() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_my_access_requests_ctx() CASCADE;
        """
    ),
    # Step 20: Attach access requests triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_insert_my_access_requests_ctx ON my_access_requests_ctx;
        CREATE TRIGGER trg_insert_my_access_requests_ctx
            INSTEAD OF INSERT ON my_access_requests_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_insert_my_access_requests_ctx();

        DROP TRIGGER IF EXISTS trg_update_my_access_requests_ctx ON my_access_requests_ctx;
        CREATE TRIGGER trg_update_my_access_requests_ctx
            INSTEAD OF UPDATE ON my_access_requests_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_update_my_access_requests_ctx();

        DROP TRIGGER IF EXISTS trg_delete_my_access_requests_ctx ON my_access_requests_ctx;
        CREATE TRIGGER trg_delete_my_access_requests_ctx
            INSTEAD OF DELETE ON my_access_requests_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_delete_my_access_requests_ctx();

        DROP TRIGGER IF EXISTS trg_insert_my_access_requests_groups_ctx ON my_access_requests_groups_ctx;
        CREATE TRIGGER trg_insert_my_access_requests_groups_ctx
            INSTEAD OF INSERT ON my_access_requests_groups_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_insert_my_access_requests_groups_ctx();

        DROP TRIGGER IF EXISTS trg_delete_my_access_requests_groups_ctx ON my_access_requests_groups_ctx;
        CREATE TRIGGER trg_delete_my_access_requests_groups_ctx
            INSTEAD OF DELETE ON my_access_requests_groups_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_delete_my_access_requests_groups_ctx();

        DROP TRIGGER IF EXISTS trg_update_access_requests_ctx ON access_requests_ctx;
        CREATE TRIGGER trg_update_access_requests_ctx
            INSTEAD OF UPDATE ON access_requests_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_update_access_requests_ctx();

        DROP TRIGGER IF EXISTS trg_delete_access_requests_ctx ON access_requests_ctx;
        CREATE TRIGGER trg_delete_access_requests_ctx
            INSTEAD OF DELETE ON access_requests_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_delete_access_requests_ctx();

        DROP TRIGGER IF EXISTS trg_update_access_requests_groups_ctx ON access_requests_groups_ctx;
        CREATE TRIGGER trg_update_access_requests_groups_ctx
            INSTEAD OF UPDATE ON access_requests_groups_ctx
            FOR EACH ROW EXECUTE FUNCTION trg_update_access_requests_groups_ctx();
        """,
        """
        DROP TRIGGER IF EXISTS trg_update_access_requests_groups_ctx ON access_requests_groups_ctx;
        DROP TRIGGER IF EXISTS trg_delete_access_requests_ctx ON access_requests_ctx;
        DROP TRIGGER IF EXISTS trg_update_access_requests_ctx ON access_requests_ctx;
        DROP TRIGGER IF EXISTS trg_delete_my_access_requests_groups_ctx ON my_access_requests_groups_ctx;
        DROP TRIGGER IF EXISTS trg_insert_my_access_requests_groups_ctx ON my_access_requests_groups_ctx;
        DROP TRIGGER IF EXISTS trg_delete_my_access_requests_ctx ON my_access_requests_ctx;
        DROP TRIGGER IF EXISTS trg_update_my_access_requests_ctx ON my_access_requests_ctx;
        DROP TRIGGER IF EXISTS trg_insert_my_access_requests_ctx ON my_access_requests_ctx;
        """
    ),
    # Step 21: More BEFORE/AFTER table trigger functions
    step(
        """
        -- Function to ensure profiles restricted to event validity
        CREATE OR REPLACE FUNCTION trg_ensure_profiles_restricted_to_event_validity()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.restricted_to_event IS NOT NULL AND EXISTS (
                SELECT 1 FROM events_profiles
                WHERE profile_id = OLD.profile_id AND event_id <> NEW.restricted_to_event
            ) THEN
                RAISE EXCEPTION 'Policy error: the profile is already associated with another event';
            END IF;
            
            IF NEW.restricted_to_event IS NOT NULL AND NEW.can_create_events = TRUE THEN
                RAISE EXCEPTION 'Policy error: restricted profiles cannot have create events permission';
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to ensure profiles publicity policy
        CREATE OR REPLACE FUNCTION trg_ensure_profiles_publicity()
        RETURNS TRIGGER AS $$
        DECLARE
            old_id UUID := NULL;
        BEGIN
            IF TG_OP = 'UPDATE' THEN
                old_id := OLD.profile_id;
            END IF;

            IF NEW.is_public AND NEW.hierarchy_rank > 0 THEN
                RAISE EXCEPTION 'Policy error: public profiles cannot be managers';
            END IF;
            
            IF NEW.is_public AND NEW.restricted_to_event IS NULL THEN
                RAISE EXCEPTION 'Policy error: public profiles must be restricted to an event';
            END IF;
            
            IF NEW.is_public AND NEW.can_create_events THEN
                RAISE EXCEPTION 'Policy error: public profiles cannot have create events permission';
            END IF;
            
            IF TG_OP = 'UPDATE' AND NEW.is_public AND EXISTS (
                SELECT 1 FROM events_profiles ep
                WHERE ep.profile_id = old_id
                AND (ep.can_manage_event OR ep.can_delete_event OR ep.can_upload_and_delete_images OR ep.can_edit)
            ) THEN
                RAISE EXCEPTION 'Policy error: public profiles cannot have event managing or editing permissions';
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to ensure events_profiles publicity
        CREATE OR REPLACE FUNCTION trg_events_profiles_ensure_profiles_publicity()
        RETURNS TRIGGER AS $$
        BEGIN
            IF
                (SELECT is_public FROM profiles WHERE profile_id = NEW.profile_id)
                AND (NEW.can_manage_event OR NEW.can_delete_event OR NEW.can_upload_and_delete_images OR NEW.can_edit)
            THEN
                RAISE EXCEPTION 'Policy error: public profiles cannot have event managing or editing permissions';
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to ensure profiles public access code
        CREATE OR REPLACE FUNCTION trg_ensure_profiles_public_access_code()
        RETURNS TRIGGER AS $$
        BEGIN
            IF TG_OP = 'INSERT' AND NOT NEW.is_public AND NEW.public_access_code IS NOT NULL THEN
                RAISE EXCEPTION 'Policy error: cannot set public access code if profile is not public';
            END IF;
            
            IF TG_OP = 'UPDATE' AND NOT NEW.is_public THEN
                NEW.public_access_code := NULL;
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to ensure profiles can upload validity
        CREATE OR REPLACE FUNCTION trg_ensure_profiles_can_upload_validity()
        RETURNS TRIGGER AS $$
        DECLARE
            old_id UUID := NULL;
        BEGIN
            IF TG_OP = 'UPDATE' THEN
                old_id := OLD.profile_id;
            END IF;

            IF NEW.can_upload_and_delete_images AND NOT NEW.can_edit THEN
                RAISE EXCEPTION 'Policy error: cannot update profile with can_upload_and_delete_images=1 and can_edit=0';
            END IF;
            
            IF NEW.can_upload_and_delete_images AND NOT NEW.all_groups THEN
                RAISE EXCEPTION 'Policy error: profile with upload permissions cannot be restricted to groups';
            END IF;
            
            IF TG_OP = 'UPDATE' AND NEW.can_upload_and_delete_images AND EXISTS (
                SELECT 1 FROM profiles_groups
                WHERE profile_id = old_id
            ) THEN
                RAISE EXCEPTION 'Policy error: profile with upload permissions cannot be restricted to groups';
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to ensure profiles can upload validity for profiles_groups
        CREATE OR REPLACE FUNCTION trg_ensure_profiles_can_upload_validity_profile_groups()
        RETURNS TRIGGER AS $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM events_profiles
                WHERE event_id = cur_event_profile_uuid('event_id')
                AND profile_id = NEW.profile_id
                AND can_upload_and_delete_images
            ) THEN
                RAISE EXCEPTION 'Policy error: profile with upload permissions cannot be restricted to groups';
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to revoke refresh tokens when profile password is updated
        CREATE OR REPLACE FUNCTION trg_revoke_refresh_tokens_when_profile_password_updated()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.password <> OLD.password AND (NEW.password IS NOT NULL OR OLD.password IS NOT NULL) THEN
                UPDATE refresh_tokens SET
                    revoked = TRUE,
                    revoked_at = CURRENT_TIMESTAMP
                WHERE profile_id = OLD.profile_id AND NOT revoked;
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to ensure groups unassociated permissions
        CREATE OR REPLACE FUNCTION trg_insert_ensure_groups_unassociated_permissions()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.group_id = (
                SELECT e.unassociated_group_id
                FROM groups g
                INNER JOIN events e ON g.event_id = e.event_id
                WHERE g.event_id = cur_event_profile_uuid('event_id') AND g.group_id = e.unassociated_group_id
            ) THEN
                RAISE EXCEPTION 'Policy error: cannot edit unassociated group permissions';
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Helper function to ensure access requests closed
        CREATE OR REPLACE FUNCTION ensure_access_requests_closed_func(p_access_request_id INTEGER DEFAULT NULL, p_closed_at TIMESTAMP DEFAULT NULL)
        RETURNS VOID AS $$
        BEGIN
            UPDATE access_requests SET
                is_closed = TRUE,
                closed_at = COALESCE(p_closed_at, CURRENT_TIMESTAMP),
                closed_by = cur_profile_uuid('profile_id')
            WHERE event_id = cur_event_profile_uuid('event_id')
            AND access_request_id = COALESCE(p_access_request_id, access_request_id)
            AND NOT EXISTS (
                SELECT 1 FROM access_requests_groups arg
                WHERE arg.access_request_id = access_requests.access_request_id
                AND arg.approved IS NULL
            );
        END;
        $$ LANGUAGE plpgsql;

        -- Function to ensure complete deletion faces in group
        CREATE OR REPLACE FUNCTION trg_ensure_complete_deletion_faces_in_group()
        RETURNS TRIGGER AS $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM faces f WHERE f.group_id = OLD.group_id
            ) AND cur_transaction('temp_event_in_deletion')::UUID IS DISTINCT FROM OLD.event_id THEN
                RAISE EXCEPTION 'Policy error: cannot delete group with faces';
            END IF;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to ensure complete deletion access requests
        CREATE OR REPLACE FUNCTION trg_ensure_complete_deletion_access_requests()
        RETURNS TRIGGER AS $$
        BEGIN
            DELETE FROM access_requests WHERE applicant_profile_id = OLD.profile_id;
            DELETE FROM access_requests WHERE profile_id = OLD.profile_id AND applicant_profile_id IS NULL;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to ensure default albums
        CREATE OR REPLACE FUNCTION trg_ensure_default_albums()
        RETURNS TRIGGER AS $$
        BEGIN
            IF TG_OP = 'UPDATE' AND (
                OLD.album_id = (SELECT archive_album_id FROM events WHERE event_id = OLD.event_id)
                OR OLD.album_id = (SELECT favorites_album_id FROM events WHERE event_id = OLD.event_id)
            ) AND (NEW.album_id <> OLD.album_id OR NEW.label <> OLD.label) THEN
                RAISE EXCEPTION 'Policy error: cannot update default albums';
            END IF;
            
            IF TG_OP = 'DELETE' AND (
                OLD.album_id = (SELECT archive_album_id FROM events WHERE event_id = OLD.event_id)
                OR OLD.album_id = (SELECT favorites_album_id FROM events WHERE event_id = OLD.event_id)
            ) AND cur_transaction('temp_event_in_deletion')::UUID IS DISTINCT FROM OLD.event_id THEN
                RAISE EXCEPTION 'Policy error: cannot delete default albums';
            END IF;
            
            RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to ensure default groups
        CREATE OR REPLACE FUNCTION trg_ensure_default_groups()
        RETURNS TRIGGER AS $$
        BEGIN
            IF TG_OP = 'UPDATE' AND OLD.group_id = (SELECT unassociated_group_id FROM events WHERE event_id = OLD.event_id)
                AND (
                    OLD.group_id IS DISTINCT FROM NEW.group_id
                    OR OLD.label IS DISTINCT FROM NEW.label
                    OR OLD.representative_face IS DISTINCT FROM NEW.representative_face) THEN
                RAISE EXCEPTION 'Policy error: cannot update default group';
            END IF;
            
            IF TG_OP = 'DELETE' AND OLD.group_id = (SELECT unassociated_group_id FROM events WHERE event_id = OLD.event_id)
                AND cur_transaction('temp_event_in_deletion')::UUID IS DISTINCT FROM OLD.event_id THEN
                RAISE EXCEPTION 'Policy error: cannot delete default group';
            END IF;
            
            RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_ensure_default_groups() CASCADE;
        DROP FUNCTION IF EXISTS trg_ensure_default_albums() CASCADE;
        DROP FUNCTION IF EXISTS trg_ensure_complete_deletion_access_requests() CASCADE;
        DROP FUNCTION IF EXISTS trg_ensure_complete_deletion_faces_in_group() CASCADE;
        DROP FUNCTION IF EXISTS ensure_access_requests_closed_func(INTEGER, TIMESTAMP) CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_ensure_groups_unassociated_permissions() CASCADE;
        DROP FUNCTION IF EXISTS trg_revoke_refresh_tokens_when_profile_password_updated() CASCADE;
        DROP FUNCTION IF EXISTS trg_ensure_profiles_can_upload_validity_profile_groups() CASCADE;
        DROP FUNCTION IF EXISTS trg_ensure_profiles_can_upload_validity() CASCADE;
        DROP FUNCTION IF EXISTS trg_ensure_profiles_public_access_code() CASCADE;
        DROP FUNCTION IF EXISTS trg_events_profiles_ensure_profiles_publicity() CASCADE;
        DROP FUNCTION IF EXISTS trg_ensure_profiles_publicity() CASCADE;
        DROP FUNCTION IF EXISTS trg_ensure_profiles_restricted_to_event_validity() CASCADE;
        """
    ),
    # Step 22: Attach remaining BEFORE/AFTER table triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_ensure_profiles_restricted_to_event_validity_update ON profiles;
        CREATE TRIGGER trg_ensure_profiles_restricted_to_event_validity_update
            BEFORE UPDATE ON profiles
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_profiles_restricted_to_event_validity();

        DROP TRIGGER IF EXISTS trg_insert_ensure_profiles_publicity ON profiles;
        CREATE TRIGGER trg_insert_ensure_profiles_publicity
            BEFORE INSERT ON profiles
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_profiles_publicity();

        DROP TRIGGER IF EXISTS trg_update_ensure_profiles_publicity ON profiles;
        CREATE TRIGGER trg_update_ensure_profiles_publicity
            BEFORE UPDATE ON profiles
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_profiles_publicity();

        DROP TRIGGER IF EXISTS trg_insert_events_profiles_ensure_profiles_publicity ON events_profiles;
        CREATE TRIGGER trg_insert_events_profiles_ensure_profiles_publicity
            BEFORE INSERT ON events_profiles
            FOR EACH ROW EXECUTE FUNCTION trg_events_profiles_ensure_profiles_publicity();

        DROP TRIGGER IF EXISTS trg_update_events_profiles_ensure_profiles_publicity ON events_profiles;
        CREATE TRIGGER trg_update_events_profiles_ensure_profiles_publicity
            BEFORE UPDATE ON events_profiles
            FOR EACH ROW EXECUTE FUNCTION trg_events_profiles_ensure_profiles_publicity();

        DROP TRIGGER IF EXISTS trg_insert_ensure_profiles_public_access_code ON profiles;
        CREATE TRIGGER trg_insert_ensure_profiles_public_access_code
            BEFORE INSERT ON profiles
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_profiles_public_access_code();

        DROP TRIGGER IF EXISTS trg_update_ensure_profiles_public_access_code ON profiles;
        CREATE TRIGGER trg_update_ensure_profiles_public_access_code
            AFTER UPDATE ON profiles
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_profiles_public_access_code();

        DROP TRIGGER IF EXISTS trg_insert_ensure_profiles_can_upload_validity ON events_profiles;
        CREATE TRIGGER trg_insert_ensure_profiles_can_upload_validity
            BEFORE INSERT ON events_profiles
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_profiles_can_upload_validity();

        DROP TRIGGER IF EXISTS trg_update_ensure_profiles_can_upload_validity ON events_profiles;
        CREATE TRIGGER trg_update_ensure_profiles_can_upload_validity
            BEFORE UPDATE ON events_profiles
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_profiles_can_upload_validity();

        DROP TRIGGER IF EXISTS trg_ensure_profiles_can_upload_validity_profile_groups_insert ON profiles_groups;
        CREATE TRIGGER trg_ensure_profiles_can_upload_validity_profile_groups_insert
            BEFORE INSERT ON profiles_groups
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_profiles_can_upload_validity_profile_groups();

        DROP TRIGGER IF EXISTS trg_revoke_refresh_tokens_when_profile_password_updated ON profiles;
        CREATE TRIGGER trg_revoke_refresh_tokens_when_profile_password_updated
            AFTER UPDATE ON profiles
            FOR EACH ROW EXECUTE FUNCTION trg_revoke_refresh_tokens_when_profile_password_updated();

        DROP TRIGGER IF EXISTS trg_insert_ensure_groups_unassociated_permissions ON profiles_groups;
        CREATE TRIGGER trg_insert_ensure_groups_unassociated_permissions
            BEFORE INSERT ON profiles_groups
            FOR EACH ROW EXECUTE FUNCTION trg_insert_ensure_groups_unassociated_permissions();

        DROP TRIGGER IF EXISTS trg_ensure_complete_deletion_faces_in_group ON groups;
        CREATE TRIGGER trg_ensure_complete_deletion_faces_in_group
            BEFORE DELETE ON groups
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_complete_deletion_faces_in_group();

        DROP TRIGGER IF EXISTS trg_ensure_complete_deletion_access_requests ON profiles;
        CREATE TRIGGER trg_ensure_complete_deletion_access_requests
            AFTER DELETE ON profiles
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_complete_deletion_access_requests();

        DROP TRIGGER IF EXISTS trg_update_ensure_default_albums ON albums;
        CREATE TRIGGER trg_update_ensure_default_albums
            BEFORE UPDATE ON albums
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_default_albums();

        DROP TRIGGER IF EXISTS trg_delete_ensure_default_albums ON albums;
        CREATE TRIGGER trg_delete_ensure_default_albums
            BEFORE DELETE ON albums
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_default_albums();

        DROP TRIGGER IF EXISTS trg_update_ensure_default_groups ON groups;
        CREATE TRIGGER trg_update_ensure_default_groups
            BEFORE UPDATE ON groups
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_default_groups();

        DROP TRIGGER IF EXISTS trg_delete_ensure_default_groups ON groups;
        CREATE TRIGGER trg_delete_ensure_default_groups
            BEFORE DELETE ON groups
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_default_groups();
        """,
        """
        DROP TRIGGER IF EXISTS trg_delete_ensure_default_groups ON groups;
        DROP TRIGGER IF EXISTS trg_update_ensure_default_groups ON groups;
        DROP TRIGGER IF EXISTS trg_delete_ensure_default_albums ON albums;
        DROP TRIGGER IF EXISTS trg_update_ensure_default_albums ON albums;
        DROP TRIGGER IF EXISTS trg_ensure_complete_deletion_access_requests ON profiles;
        DROP TRIGGER IF EXISTS trg_ensure_complete_deletion_faces_in_group ON groups;
        DROP TRIGGER IF EXISTS trg_insert_ensure_groups_unassociated_permissions ON profiles_groups;
        DROP TRIGGER IF EXISTS trg_revoke_refresh_tokens_when_profile_password_updated ON profiles;
        DROP TRIGGER IF EXISTS trg_ensure_profiles_can_upload_validity_profile_groups_insert ON profiles_groups;
        DROP TRIGGER IF EXISTS trg_update_ensure_profiles_can_upload_validity ON events_profiles;
        DROP TRIGGER IF EXISTS trg_insert_ensure_profiles_can_upload_validity ON events_profiles;
        DROP TRIGGER IF EXISTS trg_update_ensure_profiles_public_access_code ON profiles;
        DROP TRIGGER IF EXISTS trg_insert_ensure_profiles_public_access_code ON profiles;
        DROP TRIGGER IF EXISTS trg_update_events_profiles_ensure_profiles_publicity ON events_profiles;
        DROP TRIGGER IF EXISTS trg_insert_events_profiles_ensure_profiles_publicity ON events_profiles;
        DROP TRIGGER IF EXISTS trg_update_ensure_profiles_publicity ON profiles;
        DROP TRIGGER IF EXISTS trg_insert_ensure_profiles_publicity ON profiles;
        DROP TRIGGER IF EXISTS trg_ensure_profiles_restricted_to_event_validity_update ON profiles;
        """
    ),
    # Step 23: Access requests groups validity trigger functions
    step(
        """
        -- Function to update profile ensure access requests groups validity
        CREATE OR REPLACE FUNCTION trg_update_profile_ensure_access_requests_groups_validity()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NOT OLD.all_groups AND NEW.all_groups THEN
                UPDATE access_requests_groups SET
                    approved = TRUE,
                    closed_at = CURRENT_TIMESTAMP,
                    closed_by = cur_profile_uuid('profile_id')
                WHERE (
                    SELECT ar.applicant_profile_id FROM access_requests ar
                    WHERE access_requests_groups.access_request_id = ar.access_request_id
                ) = OLD.profile_id
                AND approved IS NULL;

                PERFORM ensure_access_requests_closed_func(NULL, NULL);
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to insert profiles_groups ensure access requests groups validity
        CREATE OR REPLACE FUNCTION trg_insert_profiles_groups_ensure_access_requests_groups_validity()
        RETURNS TRIGGER AS $$
        BEGIN
            IF
                (
                    SELECT all_groups
                    FROM events_profiles_ctx
                    WHERE
                        profile_id = NEW.profile_id
                ) IS DISTINCT FROM TRUE
            THEN
                UPDATE access_requests_groups SET
                    approved = TRUE,
                    closed_at = CURRENT_TIMESTAMP,
                    closed_by = cur_profile_uuid('profile_id')
                WHERE
                    group_id = NEW.group_id
                    AND (
                        SELECT ar.applicant_profile_id
                        FROM access_requests ar
                        WHERE ar.access_request_id = access_requests_groups.access_request_id
                    ) = NEW.profile_id
                    AND approved IS NULL;

                PERFORM ensure_access_requests_closed_func(NULL, NULL);
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to delete profiles_groups ensure access requests groups validity
        CREATE OR REPLACE FUNCTION trg_delete_profiles_groups_ensure_access_requests_groups_validity()
        RETURNS TRIGGER AS $$
        BEGIN
            IF
                (
                    SELECT all_groups
                    FROM events_profiles_ctx
                    WHERE
                        profile_id = OLD.profile_id
                ) IS DISTINCT FROM FALSE
            THEN
                UPDATE access_requests_groups SET
                    approved = TRUE,
                    closed_at = CURRENT_TIMESTAMP,
                    closed_by = cur_profile_uuid('profile_id')
                WHERE (
                    OLD.profile_id = (
                        SELECT ar.applicant_profile_id
                        FROM access_requests ar
                        WHERE ar.access_request_id = access_requests_groups.access_request_id
                    )
                    AND group_id = OLD.group_id
                ) AND approved IS NULL;

                PERFORM ensure_access_requests_closed_func(NULL, NULL);
            END IF;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_delete_profiles_groups_ensure_access_requests_groups_validity() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_profiles_groups_ensure_access_requests_groups_validity() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_profile_ensure_access_requests_groups_validity() CASCADE;
        """
    ),
    # Step 24: Attach access requests groups validity triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_update_profile_ensure_access_requests_groups_validity ON events_profiles;
        CREATE TRIGGER trg_update_profile_ensure_access_requests_groups_validity
            AFTER UPDATE ON events_profiles
            FOR EACH ROW EXECUTE FUNCTION trg_update_profile_ensure_access_requests_groups_validity();

        DROP TRIGGER IF EXISTS trg_insert_profiles_groups_ensure_access_requests_groups_validity ON profiles_groups;
        CREATE TRIGGER trg_insert_profiles_groups_ensure_access_requests_groups_validity
            AFTER INSERT ON profiles_groups
            FOR EACH ROW EXECUTE FUNCTION trg_insert_profiles_groups_ensure_access_requests_groups_validity();

        DROP TRIGGER IF EXISTS trg_delete_profiles_groups_ensure_access_requests_groups_validity ON profiles_groups;
        CREATE TRIGGER trg_delete_profiles_groups_ensure_access_requests_groups_validity
            AFTER DELETE ON profiles_groups
            FOR EACH ROW EXECUTE FUNCTION trg_delete_profiles_groups_ensure_access_requests_groups_validity();
        """,
        """
        DROP TRIGGER IF EXISTS trg_delete_profiles_groups_ensure_access_requests_groups_validity ON profiles_groups;
        DROP TRIGGER IF EXISTS trg_insert_profiles_groups_ensure_access_requests_groups_validity ON profiles_groups;
        DROP TRIGGER IF EXISTS trg_update_profile_ensure_access_requests_groups_validity ON events_profiles;
        """
    ),
]
