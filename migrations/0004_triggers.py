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
        -- Function for accessible_settings UPDATE
        CREATE OR REPLACE FUNCTION trg_accessible_settings_update()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NOT cur_profile_bool('is_developer') THEN
                RAISE EXCEPTION 'Permission denied: only developer can update settings';
            END IF;

            UPDATE settings SET
                image_size_limit_bytes = NEW.image_size_limit_bytes,
                images_count_limit = NEW.images_count_limit,
                min_rank_to_create_event = NEW.min_rank_to_create_event,
                rekognition_calls_limit = NEW.rekognition_calls_limit
            WHERE id = 1;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_rekognition_usaged INSERT
        CREATE OR REPLACE FUNCTION trg_accessible_rekognition_usaged_insert()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NOT cur_profile_bool('is_developer') THEN
                RAISE EXCEPTION 'Permission denied: only developer can insert rekognition usage';
            END IF;

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
            );
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_events INSERT
        CREATE OR REPLACE FUNCTION trg_accessible_events_insert()
        RETURNS TRIGGER AS $$
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
                NEW.event_id,
                NEW.name,
                NEW.date,
                NEW.url,
                COALESCE(NEW.is_public, FALSE),
                COALESCE(NEW.images_count_limit, 0),
                COALESCE(NEW.image_size_limit_bytes, 0),
                NEW.representative_image,
                COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
                cur_profile('profile_id'),
                (SELECT rekognition_calls_limit FROM settings WHERE id = 1 LIMIT 1)
            );

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
            VALUES (cur_profile('profile_id'), NEW.event_id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE)
            ON CONFLICT (event_id, profile_id) DO NOTHING;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_events UPDATE
        CREATE OR REPLACE FUNCTION trg_accessible_events_update()
        RETURNS TRIGGER AS $$
        DECLARE
            can_manage BOOLEAN;
        BEGIN
            SELECT can_manage_event INTO can_manage
            FROM events_profiles
            WHERE profile_id = cur_profile('profile_id') AND event_id = OLD.event_id;
            
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

        -- Function for accessible_events DELETE
        CREATE OR REPLACE FUNCTION trg_accessible_events_delete()
        RETURNS TRIGGER AS $$
        DECLARE
            can_delete BOOLEAN;
        BEGIN
            SELECT can_delete_event INTO can_delete
            FROM events_profiles
            WHERE event_id = OLD.event_id AND profile_id = cur_profile('profile_id');
            
            IF can_delete IS NOT TRUE THEN
                RAISE EXCEPTION 'Permission denied: cannot delete event';
            END IF;
            
            IF (SELECT event_in_deletion FROM settings WHERE id = 1 LIMIT 1) IS NOT NULL THEN
                RAISE EXCEPTION 'Policy error: other event is in deletion. Try again later';
            END IF;

            UPDATE settings SET event_in_deletion = OLD.event_id WHERE id = 1;
            
            DELETE FROM profiles WHERE restricted_to_event = OLD.event_id;
            DELETE FROM events WHERE event_id = OLD.event_id;
            UPDATE settings SET event_in_deletion = NULL WHERE id = 1;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for current_profile UPDATE
        CREATE OR REPLACE FUNCTION trg_current_profile_update()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_profile_bool('is_public') THEN
                RAISE EXCEPTION 'Permission denied: cannot update current profile to a public profile';
            END IF;

            UPDATE profiles SET
                label = NEW.label,
                email = NEW.email,
                password = NEW.password
            WHERE profile_id = cur_profile('profile_id');
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_current_profile_update() CASCADE;
        DROP FUNCTION IF EXISTS trg_accessible_events_delete() CASCADE;
        DROP FUNCTION IF EXISTS trg_accessible_events_update() CASCADE;
        DROP FUNCTION IF EXISTS trg_accessible_events_insert() CASCADE;
        DROP FUNCTION IF EXISTS trg_accessible_rekognition_usaged_insert() CASCADE;
        DROP FUNCTION IF EXISTS trg_accessible_settings_update() CASCADE;
        """
    ),
    # Step 2: Attach INSTEAD OF triggers to views (first batch)
    step(
        """
        DROP TRIGGER IF EXISTS trg_accessible_settings_update ON accessible_settings;
        CREATE TRIGGER trg_accessible_settings_update
            INSTEAD OF UPDATE ON accessible_settings
            FOR EACH ROW EXECUTE FUNCTION trg_accessible_settings_update();

        DROP TRIGGER IF EXISTS trg_accessible_rekognition_usaged_insert ON accessible_rekognition_usaged;
        CREATE TRIGGER trg_accessible_rekognition_usaged_insert
            INSTEAD OF INSERT ON accessible_rekognition_usaged
            FOR EACH ROW EXECUTE FUNCTION trg_accessible_rekognition_usaged_insert();

        DROP TRIGGER IF EXISTS trg_accessible_events_insert ON accessible_events;
        CREATE TRIGGER trg_accessible_events_insert
            INSTEAD OF INSERT ON accessible_events
            FOR EACH ROW EXECUTE FUNCTION trg_accessible_events_insert();

        DROP TRIGGER IF EXISTS trg_accessible_events_update ON accessible_events;
        CREATE TRIGGER trg_accessible_events_update
            INSTEAD OF UPDATE ON accessible_events
            FOR EACH ROW EXECUTE FUNCTION trg_accessible_events_update();

        DROP TRIGGER IF EXISTS trg_accessible_events_delete ON accessible_events;
        CREATE TRIGGER trg_accessible_events_delete
            INSTEAD OF DELETE ON accessible_events
            FOR EACH ROW EXECUTE FUNCTION trg_accessible_events_delete();

        DROP TRIGGER IF EXISTS trg_current_profile_update ON current_profile;
        CREATE TRIGGER trg_current_profile_update
            INSTEAD OF UPDATE ON current_profile
            FOR EACH ROW EXECUTE FUNCTION trg_current_profile_update();
        """,
        """
        DROP TRIGGER IF EXISTS trg_current_profile_update ON current_profile;
        DROP TRIGGER IF EXISTS trg_accessible_events_delete ON accessible_events;
        DROP TRIGGER IF EXISTS trg_accessible_events_update ON accessible_events;
        DROP TRIGGER IF EXISTS trg_accessible_events_insert ON accessible_events;
        DROP TRIGGER IF EXISTS trg_accessible_rekognition_usaged_insert ON accessible_rekognition_usaged;
        DROP TRIGGER IF EXISTS trg_accessible_settings_update ON accessible_settings;
        """
    ),
    # Step 3: More trigger functions for views
    step(
        """
        -- Function for accessible_profiles INSERT
        CREATE OR REPLACE FUNCTION trg_accessible_profiles_insert()
        RETURNS TRIGGER AS $$
        DECLARE
            min_rank INTEGER;
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
            
            IF NEW.restricted_to_event IS NOT NULL AND cur_profile('restricted_to_event') <> COALESCE(NEW.restricted_to_event, '') THEN
                RAISE EXCEPTION 'Permission denied: cannot create profile to a different event than the current profile';
            END IF;
            
            IF NEW.restricted_to_event IS NOT NULL AND NEW.restricted_to_event NOT IN (SELECT ae.event_id FROM accessible_events ae WHERE ae.is_accessible = 1) THEN
                RAISE EXCEPTION 'Permission denied: the event is not accessible';
            END IF;

            INSERT INTO profiles (profile_id, label, email, password, hierarchy_rank, can_create_events, restricted_to_event, is_public)
            VALUES (
                NEW.profile_id,
                NEW.label,
                NEW.email,
                NEW.password,
                COALESCE(NEW.hierarchy_rank, 0),
                COALESCE(NEW.can_create_events, FALSE),
                NEW.restricted_to_event,
                COALESCE(NEW.is_public, FALSE)
            );
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_profiles UPDATE
        CREATE OR REPLACE FUNCTION trg_accessible_profiles_update()
        RETURNS TRIGGER AS $$
        DECLARE
            min_rank INTEGER;
        BEGIN
            IF OLD.profile_id NOT IN (
                SELECT profile_id FROM accessible_profiles ap
                WHERE ap.profile_id = OLD.profile_id AND ap.is_editable = 1
            ) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;
            
            min_rank := (SELECT min_rank_to_create_event FROM settings WHERE id = 1 LIMIT 1);
            
            IF NEW.hierarchy_rank >= cur_profile_int('hierarchy_rank') THEN
                RAISE EXCEPTION 'Permission denied: cannot update profile to a higher or equal rank than the current profile';
            END IF;
            
            IF NEW.can_create_events AND NOT OLD.can_create_events AND cur_profile_int('hierarchy_rank') <= min_rank THEN
                RAISE EXCEPTION 'Permission denied: the profile dose not have permission to manage create events permissions';
            END IF;
            
            IF NEW.restricted_to_event IS NOT NULL AND cur_profile('restricted_to_event') <> COALESCE(NEW.restricted_to_event, '') THEN
                RAISE EXCEPTION 'Permission denied: cannot update profile to a different event than the current profile';
            END IF;
            
            IF NEW.restricted_to_event IS NOT NULL AND NEW.restricted_to_event NOT IN (SELECT ae.event_id FROM accessible_events ae WHERE ae.is_accessible = 1) THEN
                RAISE EXCEPTION 'Permission denied: the event is not accessible';
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
            WHERE profile_id = OLD.profile_id;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_profiles DELETE
        CREATE OR REPLACE FUNCTION trg_accessible_profiles_delete()
        RETURNS TRIGGER AS $$
        BEGIN
            IF OLD.profile_id NOT IN (
                SELECT profile_id FROM accessible_profiles ap
                WHERE ap.profile_id = OLD.profile_id AND ap.is_editable = 1
            ) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;
            
            IF EXISTS (SELECT 1 FROM events_profiles ep WHERE ep.profile_id = OLD.profile_id) THEN
                RAISE EXCEPTION 'Policy error: the profile is associated with an event. Please remove the profile from all events first.';
            END IF;

            DELETE FROM profiles WHERE profile_id = OLD.profile_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for my_preferences UPDATE
        CREATE OR REPLACE FUNCTION trg_my_preferences_update()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_profile('profile_id') <> OLD.profile_id THEN
                RAISE EXCEPTION 'Permission denied: cannot update preferences for another profile';
            END IF;

            UPDATE profiles_preferences SET
                preference_value = NEW.preference_value
            WHERE profile_id = OLD.profile_id AND preference_group = OLD.preference_group AND preference_key = OLD.preference_key;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_notifications INSERT
        CREATE OR REPLACE FUNCTION trg_accessible_notifications_insert()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.profile_id NOT IN (SELECT profile_id FROM accessible_profiles) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;

            INSERT INTO notifications (profile_id, message, created_at, read, type, data)
            VALUES (NEW.profile_id, NEW.message, COALESCE(NEW.created_at, CURRENT_TIMESTAMP), COALESCE(NEW.read, FALSE), NEW.type, NEW.data);
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_my_notifications UPDATE
        CREATE OR REPLACE FUNCTION trg_accessible_my_notifications_update()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_profile('profile_id') <> OLD.profile_id THEN
                RAISE EXCEPTION 'Permission denied: the notification is not accessible';
            END IF;

            UPDATE notifications SET
                read = COALESCE(NEW.read, read),
                read_at = COALESCE(NEW.read_at, CURRENT_TIMESTAMP)
            WHERE notification_id = OLD.notification_id;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_my_notifications DELETE
        CREATE OR REPLACE FUNCTION trg_accessible_my_notifications_delete()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_profile('profile_id') <> OLD.profile_id THEN
                RAISE EXCEPTION 'Permission denied: the notification is not accessible';
            END IF;

            DELETE FROM notifications WHERE notification_id = OLD.notification_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_accessible_my_notifications_delete() CASCADE;
        DROP FUNCTION IF EXISTS trg_accessible_my_notifications_update() CASCADE;
        DROP FUNCTION IF EXISTS trg_accessible_notifications_insert() CASCADE;
        DROP FUNCTION IF EXISTS trg_my_preferences_update() CASCADE;
        DROP FUNCTION IF EXISTS trg_accessible_profiles_delete() CASCADE;
        DROP FUNCTION IF EXISTS trg_accessible_profiles_update() CASCADE;
        DROP FUNCTION IF EXISTS trg_accessible_profiles_insert() CASCADE;
        """
    ),
    # Step 4: Attach more triggers to views
    step(
        """
        DROP TRIGGER IF EXISTS trg_accessible_profiles_insert ON accessible_profiles;
        CREATE TRIGGER trg_accessible_profiles_insert
            INSTEAD OF INSERT ON accessible_profiles
            FOR EACH ROW EXECUTE FUNCTION trg_accessible_profiles_insert();

        DROP TRIGGER IF EXISTS trg_accessible_profiles_update ON accessible_profiles;
        CREATE TRIGGER trg_accessible_profiles_update
            INSTEAD OF UPDATE ON accessible_profiles
            FOR EACH ROW EXECUTE FUNCTION trg_accessible_profiles_update();

        DROP TRIGGER IF EXISTS trg_accessible_profiles_delete ON accessible_profiles;
        CREATE TRIGGER trg_accessible_profiles_delete
            INSTEAD OF DELETE ON accessible_profiles
            FOR EACH ROW EXECUTE FUNCTION trg_accessible_profiles_delete();

        DROP TRIGGER IF EXISTS trg_my_preferences_update ON my_preferences;
        CREATE TRIGGER trg_my_preferences_update
            INSTEAD OF UPDATE ON my_preferences
            FOR EACH ROW EXECUTE FUNCTION trg_my_preferences_update();

        DROP TRIGGER IF EXISTS trg_accessible_notifications_insert ON accessible_notifications;
        CREATE TRIGGER trg_accessible_notifications_insert
            INSTEAD OF INSERT ON accessible_notifications
            FOR EACH ROW EXECUTE FUNCTION trg_accessible_notifications_insert();

        DROP TRIGGER IF EXISTS trg_accessible_my_notifications_update ON accessible_my_notifications;
        CREATE TRIGGER trg_accessible_my_notifications_update
            INSTEAD OF UPDATE ON accessible_my_notifications
            FOR EACH ROW EXECUTE FUNCTION trg_accessible_my_notifications_update();

        DROP TRIGGER IF EXISTS trg_accessible_my_notifications_delete ON accessible_my_notifications;
        CREATE TRIGGER trg_accessible_my_notifications_delete
            INSTEAD OF DELETE ON accessible_my_notifications
            FOR EACH ROW EXECUTE FUNCTION trg_accessible_my_notifications_delete();
        """,
        """
        DROP TRIGGER IF EXISTS trg_accessible_my_notifications_delete ON accessible_my_notifications;
        DROP TRIGGER IF EXISTS trg_accessible_my_notifications_update ON accessible_my_notifications;
        DROP TRIGGER IF EXISTS trg_accessible_notifications_insert ON accessible_notifications;
        DROP TRIGGER IF EXISTS trg_my_preferences_update ON my_preferences;
        DROP TRIGGER IF EXISTS trg_accessible_profiles_delete ON accessible_profiles;
        DROP TRIGGER IF EXISTS trg_accessible_profiles_update ON accessible_profiles;
        DROP TRIGGER IF EXISTS trg_accessible_profiles_insert ON accessible_profiles;
        """
    ),
    # Step 5: Feedback trigger functions
    step(
        """
        -- Function for accessible_my_feedbacks INSERT
        CREATE OR REPLACE FUNCTION trg_accessible_my_feedbacks_insert()
        RETURNS TRIGGER AS $$
        DECLARE
            new_feedback_id INTEGER;
        BEGIN
            IF NEW.profile_id <> cur_profile('profile_id') THEN
                RAISE EXCEPTION 'Permission denied: cannot create feedback for another profile';
            END IF;

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
                diagnostics
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
                NEW.diagnostics
            )
            RETURNING feedback_id INTO new_feedback_id;
        
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
                new_feedback_id::TEXT
            FROM settings
            WHERE settings.id = 1;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_my_feedbacks UPDATE
        CREATE OR REPLACE FUNCTION trg_accessible_my_feedbacks_update()
        RETURNS TRIGGER AS $$
        BEGIN
            IF OLD.profile_id <> cur_profile('profile_id') THEN
                RAISE EXCEPTION 'Permission denied: cannot update feedback for another profile';
            END IF;
            
            IF cur_profile_bool('is_public') THEN
                RAISE EXCEPTION 'Permission denied: the feedback is not accessible';
            END IF;
            
            IF OLD.is_closed = TRUE THEN
                RAISE EXCEPTION 'Permission denied: cannot update closed feedback';
            END IF;

            UPDATE feedbacks SET
                title = NEW.title,
                type = NEW.type,
                message = NEW.message,
                communication_consent = COALESCE(CASE WHEN NEW.sender_email IS NOT NULL THEN TRUE ELSE NEW.communication_consent END, FALSE)
            WHERE feedback_id = OLD.feedback_id;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_my_feedbacks DELETE
        CREATE OR REPLACE FUNCTION trg_accessible_my_feedbacks_delete()
        RETURNS TRIGGER AS $$
        BEGIN
            IF OLD.profile_id <> cur_profile('profile_id') THEN
                RAISE EXCEPTION 'Permission denied: cannot delete feedback for another profile';
            END IF;
            
            IF cur_profile_bool('is_public') THEN
                RAISE EXCEPTION 'Permission denied: the feedback is not accessible';
            END IF;
            
            IF OLD.is_closed = TRUE THEN
                RAISE EXCEPTION 'Permission denied: cannot delete closed feedback';
            END IF;

            DELETE FROM feedbacks WHERE feedback_id = OLD.feedback_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_feedbacks UPDATE
        CREATE OR REPLACE FUNCTION trg_accessible_feedbacks_update()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NOT cur_profile_bool('is_developer') THEN
                RAISE EXCEPTION 'Permission denied: only developer can update feedbacks';
            END IF;

            UPDATE feedbacks SET
                type = NEW.type,
                notes = NEW.notes,
                is_closed = NEW.is_closed,
                solved = NEW.solved,
                closed_at = COALESCE(NEW.closed_at, CURRENT_TIMESTAMP),
                closed_by = cur_profile('profile_id'),
                closed_details = NEW.closed_details
            WHERE feedback_id = OLD.feedback_id;

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
                    OLD.feedback_id::TEXT
                FROM feedbacks
                INNER JOIN profiles p ON feedbacks.profile_id = p.profile_id
                WHERE feedback_id = OLD.feedback_id
                AND p.is_public = FALSE;
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_feedbacks DELETE
        CREATE OR REPLACE FUNCTION trg_accessible_feedbacks_delete()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NOT cur_profile_bool('is_developer') THEN
                RAISE EXCEPTION 'Permission denied: only developer can delete feedbacks';
            END IF;

            DELETE FROM feedbacks WHERE feedback_id = OLD.feedback_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_accessible_feedbacks_delete() CASCADE;
        DROP FUNCTION IF EXISTS trg_accessible_feedbacks_update() CASCADE;
        DROP FUNCTION IF EXISTS trg_accessible_my_feedbacks_delete() CASCADE;
        DROP FUNCTION IF EXISTS trg_accessible_my_feedbacks_update() CASCADE;
        DROP FUNCTION IF EXISTS trg_accessible_my_feedbacks_insert() CASCADE;
        """
    ),
    # Step 6: Attach feedback triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_accessible_my_feedbacks_insert ON accessible_my_feedbacks;
        CREATE TRIGGER trg_accessible_my_feedbacks_insert
            INSTEAD OF INSERT ON accessible_my_feedbacks
            FOR EACH ROW EXECUTE FUNCTION trg_accessible_my_feedbacks_insert();

        DROP TRIGGER IF EXISTS trg_accessible_my_feedbacks_update ON accessible_my_feedbacks;
        CREATE TRIGGER trg_accessible_my_feedbacks_update
            INSTEAD OF UPDATE ON accessible_my_feedbacks
            FOR EACH ROW EXECUTE FUNCTION trg_accessible_my_feedbacks_update();

        DROP TRIGGER IF EXISTS trg_accessible_my_feedbacks_delete ON accessible_my_feedbacks;
        CREATE TRIGGER trg_accessible_my_feedbacks_delete
            INSTEAD OF DELETE ON accessible_my_feedbacks
            FOR EACH ROW EXECUTE FUNCTION trg_accessible_my_feedbacks_delete();

        DROP TRIGGER IF EXISTS trg_accessible_feedbacks_update ON accessible_feedbacks;
        CREATE TRIGGER trg_accessible_feedbacks_update
            INSTEAD OF UPDATE ON accessible_feedbacks
            FOR EACH ROW EXECUTE FUNCTION trg_accessible_feedbacks_update();

        DROP TRIGGER IF EXISTS trg_accessible_feedbacks_delete ON accessible_feedbacks;
        CREATE TRIGGER trg_accessible_feedbacks_delete
            INSTEAD OF DELETE ON accessible_feedbacks
            FOR EACH ROW EXECUTE FUNCTION trg_accessible_feedbacks_delete();
        """,
        """
        DROP TRIGGER IF EXISTS trg_accessible_feedbacks_delete ON accessible_feedbacks;
        DROP TRIGGER IF EXISTS trg_accessible_feedbacks_update ON accessible_feedbacks;
        DROP TRIGGER IF EXISTS trg_accessible_my_feedbacks_delete ON accessible_my_feedbacks;
        DROP TRIGGER IF EXISTS trg_accessible_my_feedbacks_update ON accessible_my_feedbacks;
        DROP TRIGGER IF EXISTS trg_accessible_my_feedbacks_insert ON accessible_my_feedbacks;
        """
    ),
    # Step 7: events_profiles trigger functions
    step(
        """
        -- Function for accessible_events_profiles INSERT
        CREATE OR REPLACE FUNCTION trg_insert_accessible_events_profiles()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NEW.profile_id NOT IN (
                SELECT profile_id FROM accessible_profiles ap WHERE ap.is_editable = 1
            ) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;
            
            IF NEW.all_images AND NOT cur_event_profile_bool('all_images') THEN
                RAISE EXCEPTION 'Permission denied: cannot create profile with all_images=1 if current profile does not have all_images=1';
            END IF;
            
            IF NEW.all_groups AND NOT cur_event_profile('all_groups') THEN
                RAISE EXCEPTION 'Permission denied: cannot create profile with all_groups=1 if current profile does not have all_groups=1';
            END IF;
            
            IF NEW.all_albums AND NOT cur_event_profile_bool('all_albums') THEN
                RAISE EXCEPTION 'Permission denied: cannot create profile with all_albums=1 if current profile does not have all_albums=1';
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
                cur_event_profile('event_id'),
                COALESCE(NEW.can_manage_event, FALSE),
                COALESCE(NEW.can_delete_event, FALSE),
                COALESCE(NEW.can_upload_and_delete_images, FALSE),
                COALESCE(NEW.can_edit, FALSE),
                COALESCE(NEW.all_images, FALSE),
                COALESCE(NEW.all_groups, FALSE),
                COALESCE(NEW.all_albums, FALSE)
            );

            IF NEW.all_images THEN
                INSERT INTO events_profiles_images (event_id, profile_id, image_id)
                SELECT epi.event_id, NEW.profile_id, epi.image_id
                FROM events_profiles_images epi
                WHERE epi.event_id = cur_event_profile('event_id')
                AND epi.profile_id = cur_profile('profile_id')
                ON CONFLICT DO NOTHING;
            END IF;

            IF NEW.all_groups THEN
                INSERT INTO events_profiles_groups (event_id, profile_id, group_id)
                SELECT epg.event_id, NEW.profile_id, epg.group_id
                FROM events_profiles_groups epg
                WHERE epg.event_id = cur_event_profile('event_id')
                AND epg.profile_id = cur_profile('profile_id')
                ON CONFLICT DO NOTHING;
            END IF;
            
            IF NEW.all_albums THEN
                INSERT INTO events_profiles_albums (event_id, profile_id, album_id)
                SELECT epa.event_id, NEW.profile_id, epa.album_id
                FROM events_profiles_albums epa
                WHERE epa.event_id = cur_event_profile('event_id')
                AND epa.profile_id = cur_profile('profile_id')
                ON CONFLICT DO NOTHING;
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_events_profiles UPDATE
        CREATE OR REPLACE FUNCTION trg_update_accessible_events_profiles()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF OLD.profile_id NOT IN (SELECT profile_id FROM accessible_events_profiles) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;
            
            IF NEW.all_images AND NOT OLD.all_images AND NOT cur_event_profile_bool('all_images') THEN
                RAISE EXCEPTION 'Permission denied: cannot set profile all_images=1 if current profile does not have all_images=1';
            END IF;
            
            IF NEW.all_groups AND NOT OLD.all_groups AND NOT cur_event_profile_bool('all_groups') THEN
                RAISE EXCEPTION 'Permission denied: cannot set profile all_groups=1 if current profile does not have all_groups=1';
            END IF;
            
            IF NEW.all_albums AND NOT OLD.all_albums AND NOT cur_event_profile_bool('all_albums') THEN
                RAISE EXCEPTION 'Permission denied: cannot set profile all_albums=1 if current profile does not have all_albums=1';
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
            WHERE event_id = cur_event_profile('event_id')
            AND profile_id = OLD.profile_id;

            IF OLD.all_images AND NOT NEW.all_images THEN
                DELETE FROM events_profiles_images 
                WHERE event_id = cur_event_profile('event_id')
                AND profile_id = OLD.profile_id;
            END IF;

            IF NOT OLD.all_images AND NEW.all_images THEN
                INSERT INTO events_profiles_images (event_id, profile_id, image_id)
                SELECT epi.event_id, OLD.profile_id, epi.image_id
                FROM events_profiles_images epi
                WHERE epi.event_id = cur_event_profile('event_id')
                AND epi.profile_id = cur_profile('profile_id')
                ON CONFLICT DO NOTHING;
            END IF;

            IF OLD.all_groups AND NOT NEW.all_groups THEN
                DELETE FROM events_profiles_groups 
                WHERE event_id = cur_event_profile('event_id')
                AND profile_id = OLD.profile_id;
            END IF;

            IF NOT OLD.all_groups AND NEW.all_groups THEN
                INSERT INTO events_profiles_groups (event_id, profile_id, group_id)
                SELECT epg.event_id, OLD.profile_id, epg.group_id
                FROM events_profiles_groups epg
                WHERE epg.event_id = cur_event_profile('event_id')
                AND epg.profile_id = cur_profile('profile_id')
                ON CONFLICT DO NOTHING;
            END IF;

            IF OLD.all_albums AND NOT NEW.all_albums THEN
                DELETE FROM events_profiles_albums 
                WHERE event_id = cur_event_profile('event_id')
                AND profile_id = OLD.profile_id;
            END IF;

            IF NOT OLD.all_albums AND NEW.all_albums THEN
                INSERT INTO events_profiles_albums (event_id, profile_id, album_id)
                SELECT epa.event_id, OLD.profile_id, epa.album_id
                FROM events_profiles_albums epa
                WHERE epa.event_id = cur_event_profile('event_id')
                AND epa.profile_id = cur_profile('profile_id')
                ON CONFLICT DO NOTHING;
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_events_profiles DELETE
        CREATE OR REPLACE FUNCTION trg_delete_accessible_events_profiles()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF OLD.profile_id NOT IN (SELECT profile_id FROM accessible_events_profiles) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;

            DELETE FROM events_profiles WHERE event_id = cur_event_profile('event_id') AND profile_id = OLD.profile_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_delete_accessible_events_profiles() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_accessible_events_profiles() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_accessible_events_profiles() CASCADE;
        """
    ),
    # Step 8: Attach events_profiles triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_insert_accessible_events_profiles ON accessible_events_profiles;
        CREATE TRIGGER trg_insert_accessible_events_profiles
            INSTEAD OF INSERT ON accessible_events_profiles
            FOR EACH ROW EXECUTE FUNCTION trg_insert_accessible_events_profiles();

        DROP TRIGGER IF EXISTS trg_update_accessible_events_profiles ON accessible_events_profiles;
        CREATE TRIGGER trg_update_accessible_events_profiles
            INSTEAD OF UPDATE ON accessible_events_profiles
            FOR EACH ROW EXECUTE FUNCTION trg_update_accessible_events_profiles();

        DROP TRIGGER IF EXISTS trg_delete_accessible_events_profiles ON accessible_events_profiles;
        CREATE TRIGGER trg_delete_accessible_events_profiles
            INSTEAD OF DELETE ON accessible_events_profiles
            FOR EACH ROW EXECUTE FUNCTION trg_delete_accessible_events_profiles();
        """,
        """
        DROP TRIGGER IF EXISTS trg_delete_accessible_events_profiles ON accessible_events_profiles;
        DROP TRIGGER IF EXISTS trg_update_accessible_events_profiles ON accessible_events_profiles;
        DROP TRIGGER IF EXISTS trg_insert_accessible_events_profiles ON accessible_events_profiles;
        """
    ),
    # Step 9: More view trigger functions (events_profiles_images, events_profiles_groups, events_profiles_albums)
    step(
        """
        -- Function for accessible_events_profiles_images INSERT
        CREATE OR REPLACE FUNCTION trg_insert_accessible_events_profiles_images()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NEW.profile_id NOT IN (SELECT profile_id FROM accessible_events_profiles) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;
            
            IF NEW.image_id NOT IN (SELECT image_id FROM accessible_images) THEN
                RAISE EXCEPTION 'Permission denied: the image is not accessible';
            END IF;

            INSERT INTO events_profiles_images (event_id, profile_id, image_id)
            VALUES (cur_event_profile('event_id'), NEW.profile_id, NEW.image_id)
            ON CONFLICT DO NOTHING;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_events_profiles_images DELETE
        CREATE OR REPLACE FUNCTION trg_delete_accessible_events_profiles_images()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF OLD.profile_id NOT IN (SELECT profile_id FROM accessible_events_profiles) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;
            
            IF OLD.image_id NOT IN (SELECT image_id FROM accessible_images) THEN
                RAISE EXCEPTION 'Permission denied: the image is not accessible';
            END IF;

            DELETE FROM events_profiles_images
            WHERE event_id = cur_event_profile('event_id')
            AND profile_id = OLD.profile_id
            AND image_id = OLD.image_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_events_profiles_groups INSERT
        CREATE OR REPLACE FUNCTION trg_insert_accessible_events_profiles_groups()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NEW.profile_id NOT IN (SELECT profile_id FROM accessible_events_profiles) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;
            
            IF NEW.group_id NOT IN (SELECT group_id FROM accessible_groups) THEN
                RAISE EXCEPTION 'Permission denied: the group is not accessible';
            END IF;

            INSERT INTO events_profiles_groups (event_id, profile_id, group_id)
            VALUES (cur_event_profile('event_id'), NEW.profile_id, NEW.group_id)
            ON CONFLICT DO NOTHING;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_events_profiles_groups DELETE
        CREATE OR REPLACE FUNCTION trg_delete_accessible_events_profiles_groups()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF OLD.profile_id NOT IN (SELECT profile_id FROM accessible_events_profiles) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;
            
            IF OLD.group_id NOT IN (SELECT group_id FROM accessible_groups) THEN
                RAISE EXCEPTION 'Permission denied: the group is not accessible';
            END IF;

            DELETE FROM events_profiles_groups
            WHERE event_id = cur_event_profile('event_id')
            AND profile_id = OLD.profile_id
            AND group_id = OLD.group_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_events_profiles_albums INSERT
        CREATE OR REPLACE FUNCTION trg_insert_accessible_events_profiles_albums()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NEW.profile_id NOT IN (SELECT profile_id FROM accessible_events_profiles) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;
            
            IF NEW.album_id NOT IN (SELECT album_id FROM accessible_albums) THEN
                RAISE EXCEPTION 'Permission denied: the album is not accessible';
            END IF;

            INSERT INTO events_profiles_albums (event_id, profile_id, album_id)
            VALUES (cur_event_profile('event_id'), NEW.profile_id, NEW.album_id)
            ON CONFLICT DO NOTHING;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_events_profiles_albums DELETE
        CREATE OR REPLACE FUNCTION trg_delete_accessible_events_profiles_albums()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF OLD.profile_id NOT IN (SELECT profile_id FROM accessible_events_profiles) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;
            
            IF OLD.album_id NOT IN (SELECT album_id FROM accessible_albums) THEN
                RAISE EXCEPTION 'Permission denied: the album is not accessible';
            END IF;

            DELETE FROM events_profiles_albums
            WHERE event_id = cur_event_profile('event_id')
            AND profile_id = OLD.profile_id
            AND album_id = OLD.album_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_delete_accessible_events_profiles_albums() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_accessible_events_profiles_albums() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_accessible_events_profiles_groups() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_accessible_events_profiles_groups() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_accessible_events_profiles_images() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_accessible_events_profiles_images() CASCADE;
        """
    ),
    # Step 10: Attach events_profiles_images/groups/albums triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_insert_accessible_events_profiles_images ON accessible_events_profiles_images;
        CREATE TRIGGER trg_insert_accessible_events_profiles_images
            INSTEAD OF INSERT ON accessible_events_profiles_images
            FOR EACH ROW EXECUTE FUNCTION trg_insert_accessible_events_profiles_images();

        DROP TRIGGER IF EXISTS trg_delete_accessible_events_profiles_images ON accessible_events_profiles_images;
        CREATE TRIGGER trg_delete_accessible_events_profiles_images
            INSTEAD OF DELETE ON accessible_events_profiles_images
            FOR EACH ROW EXECUTE FUNCTION trg_delete_accessible_events_profiles_images();

        DROP TRIGGER IF EXISTS trg_insert_accessible_events_profiles_groups ON accessible_events_profiles_groups;
        CREATE TRIGGER trg_insert_accessible_events_profiles_groups
            INSTEAD OF INSERT ON accessible_events_profiles_groups
            FOR EACH ROW EXECUTE FUNCTION trg_insert_accessible_events_profiles_groups();

        DROP TRIGGER IF EXISTS trg_delete_accessible_events_profiles_groups ON accessible_events_profiles_groups;
        CREATE TRIGGER trg_delete_accessible_events_profiles_groups
            INSTEAD OF DELETE ON accessible_events_profiles_groups
            FOR EACH ROW EXECUTE FUNCTION trg_delete_accessible_events_profiles_groups();

        DROP TRIGGER IF EXISTS trg_insert_accessible_events_profiles_albums ON accessible_events_profiles_albums;
        CREATE TRIGGER trg_insert_accessible_events_profiles_albums
            INSTEAD OF INSERT ON accessible_events_profiles_albums
            FOR EACH ROW EXECUTE FUNCTION trg_insert_accessible_events_profiles_albums();

        DROP TRIGGER IF EXISTS trg_delete_accessible_events_profiles_albums ON accessible_events_profiles_albums;
        CREATE TRIGGER trg_delete_accessible_events_profiles_albums
            INSTEAD OF DELETE ON accessible_events_profiles_albums
            FOR EACH ROW EXECUTE FUNCTION trg_delete_accessible_events_profiles_albums();
        """,
        """
        DROP TRIGGER IF EXISTS trg_delete_accessible_events_profiles_albums ON accessible_events_profiles_albums;
        DROP TRIGGER IF EXISTS trg_insert_accessible_events_profiles_albums ON accessible_events_profiles_albums;
        DROP TRIGGER IF EXISTS trg_delete_accessible_events_profiles_groups ON accessible_events_profiles_groups;
        DROP TRIGGER IF EXISTS trg_insert_accessible_events_profiles_groups ON accessible_events_profiles_groups;
        DROP TRIGGER IF EXISTS trg_delete_accessible_events_profiles_images ON accessible_events_profiles_images;
        DROP TRIGGER IF EXISTS trg_insert_accessible_events_profiles_images ON accessible_events_profiles_images;
        """
    ),
    # Step 11: Faces, images, groups, moments, albums trigger functions
    step(
        """
        -- Function for accessible_faces INSERT
        CREATE OR REPLACE FUNCTION trg_insert_accessible_faces()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_upload_and_delete_images') THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to upload images';
            END IF;
            
            IF NEW.image_id NOT IN (SELECT image_id FROM accessible_images) THEN
                RAISE EXCEPTION 'Permission denied: the image is not accessible';
            END IF;
            
            IF NEW.group_id NOT IN (SELECT group_id FROM accessible_groups) THEN
                RAISE EXCEPTION 'Permission denied: the group is not accessible';
            END IF;

            INSERT INTO faces (
                face_id,
                image_id,
                group_id,
                width,
                height,
                left,
                top
            )
            VALUES (
                NEW.face_id,
                NEW.image_id,
                NEW.group_id,
                COALESCE(NEW.width, 0),
                COALESCE(NEW.height, 0),
                COALESCE(NEW.left, 0),
                COALESCE(NEW.top, 0)
            );
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_faces UPDATE
        CREATE OR REPLACE FUNCTION trg_update_accessible_faces()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_edit') THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;
            
            IF OLD.face_id NOT IN (SELECT face_id FROM accessible_faces) THEN
                RAISE EXCEPTION 'Permission denied: the face is not accessible';
            END IF;
            
            IF NEW.group_id IS NOT NULL AND NEW.group_id NOT IN (SELECT group_id FROM accessible_groups) THEN
                RAISE EXCEPTION 'Permission denied: the target group is not accessible';
            END IF;

            UPDATE faces SET group_id = NEW.group_id WHERE face_id = OLD.face_id;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_faces DELETE
        CREATE OR REPLACE FUNCTION trg_delete_accessible_faces()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_upload_and_delete_images') THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;
            
            IF OLD.face_id NOT IN (SELECT face_id FROM accessible_faces) THEN
                RAISE EXCEPTION 'Permission denied: the face is not accessible';
            END IF;

            DELETE FROM faces WHERE face_id = OLD.face_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_images INSERT
        CREATE OR REPLACE FUNCTION trg_insert_accessible_images()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_upload_and_delete_images') THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to upload images';
            END IF;

            INSERT INTO images (
                image_id,
                event_id,
                date_taken,
                label,
                file_size,
                width,
                height,
                description,
                moment_id,
                upload_id
            )
            VALUES (
                NEW.image_id,
                cur_event_profile('event_id'),
                NEW.date_taken,
                NEW.label,
                COALESCE(NEW.file_size, 0),
                COALESCE(NEW.width, 0),
                COALESCE(NEW.height, 0),
                NEW.description,
                NEW.moment_id,
                NEW.upload_id
            );

            IF NOT cur_event_profile_bool('all_images') THEN
                INSERT INTO events_profiles_images (event_id, profile_id, image_id)
                VALUES (cur_event_profile('event_id'), cur_profile('profile_id'), NEW.image_id)
                ON CONFLICT DO NOTHING;
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_images UPDATE
        CREATE OR REPLACE FUNCTION trg_update_accessible_images()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_edit') THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            UPDATE images SET
                description = NEW.description,
                moment_id = NEW.moment_id
            WHERE image_id = OLD.image_id;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_images DELETE
        CREATE OR REPLACE FUNCTION trg_delete_accessible_images()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_upload_and_delete_images') THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to delete images';
            END IF;

            DELETE FROM images WHERE image_id = OLD.image_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_delete_accessible_images() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_accessible_images() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_accessible_images() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_accessible_faces() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_accessible_faces() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_accessible_faces() CASCADE;
        """
    ),
    # Step 12: Attach faces and images triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_insert_accessible_faces ON accessible_faces;
        CREATE TRIGGER trg_insert_accessible_faces
            INSTEAD OF INSERT ON accessible_faces
            FOR EACH ROW EXECUTE FUNCTION trg_insert_accessible_faces();

        DROP TRIGGER IF EXISTS trg_update_accessible_faces ON accessible_faces;
        CREATE TRIGGER trg_update_accessible_faces
            INSTEAD OF UPDATE ON accessible_faces
            FOR EACH ROW EXECUTE FUNCTION trg_update_accessible_faces();

        DROP TRIGGER IF EXISTS trg_delete_accessible_faces ON accessible_faces;
        CREATE TRIGGER trg_delete_accessible_faces
            INSTEAD OF DELETE ON accessible_faces
            FOR EACH ROW EXECUTE FUNCTION trg_delete_accessible_faces();

        DROP TRIGGER IF EXISTS trg_insert_accessible_images ON accessible_images;
        CREATE TRIGGER trg_insert_accessible_images
            INSTEAD OF INSERT ON accessible_images
            FOR EACH ROW EXECUTE FUNCTION trg_insert_accessible_images();

        DROP TRIGGER IF EXISTS trg_update_accessible_images ON accessible_images;
        CREATE TRIGGER trg_update_accessible_images
            INSTEAD OF UPDATE ON accessible_images
            FOR EACH ROW EXECUTE FUNCTION trg_update_accessible_images();

        DROP TRIGGER IF EXISTS trg_delete_accessible_images ON accessible_images;
        CREATE TRIGGER trg_delete_accessible_images
            INSTEAD OF DELETE ON accessible_images
            FOR EACH ROW EXECUTE FUNCTION trg_delete_accessible_images();
        """,
        """
        DROP TRIGGER IF EXISTS trg_delete_accessible_images ON accessible_images;
        DROP TRIGGER IF EXISTS trg_update_accessible_images ON accessible_images;
        DROP TRIGGER IF EXISTS trg_insert_accessible_images ON accessible_images;
        DROP TRIGGER IF EXISTS trg_delete_accessible_faces ON accessible_faces;
        DROP TRIGGER IF EXISTS trg_update_accessible_faces ON accessible_faces;
        DROP TRIGGER IF EXISTS trg_insert_accessible_faces ON accessible_faces;
        """
    ),
    # Step 13: Groups, moments, albums trigger functions
    step(
        """
        -- Function for accessible_groups INSERT
        CREATE OR REPLACE FUNCTION trg_insert_accessible_groups()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_edit') THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            INSERT INTO groups (
                group_id,
                event_id,
                label,
                representative_face
            )
            VALUES (
                NEW.group_id,
                cur_event_profile('event_id'),
                NEW.label,
                NEW.representative_face
            );
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_groups UPDATE
        CREATE OR REPLACE FUNCTION trg_update_accessible_groups()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_edit') THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;
            
            IF OLD.group_id NOT IN (SELECT group_id FROM accessible_groups) THEN
                RAISE EXCEPTION 'Permission denied: the group is not accessible';
            END IF;

            UPDATE groups SET label = NEW.label, representative_face = NEW.representative_face
            WHERE group_id = OLD.group_id;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_groups DELETE
        CREATE OR REPLACE FUNCTION trg_delete_accessible_groups()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_edit') THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;
            
            IF OLD.group_id NOT IN (SELECT group_id FROM accessible_groups) THEN
                RAISE EXCEPTION 'Permission denied: the group is not accessible';
            END IF;

            DELETE FROM groups WHERE group_id = OLD.group_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_moments INSERT
        CREATE OR REPLACE FUNCTION trg_insert_accessible_moments()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_edit') THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            INSERT INTO moments (
                moment_id,
                event_id,
                label,
                description,
                start,
                end,
                representative_image
            )
            VALUES (
                NEW.moment_id,
                cur_event_profile('event_id'),
                NEW.label,
                NEW.description,
                NEW.start,
                NEW.end,
                NEW.representative_image
            );
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_moments UPDATE
        CREATE OR REPLACE FUNCTION trg_update_accessible_moments()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_edit') THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            IF OLD.moment_id NOT IN (SELECT moment_id FROM accessible_moments) THEN
                RAISE EXCEPTION 'Permission denied: the moment is not accessible';
            END IF;

            UPDATE moments SET
                label = NEW.label,
                description = NEW.description,
                start = NEW.start,
                end = NEW.end,
                representative_image = NEW.representative_image
            WHERE moment_id = OLD.moment_id;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_moments DELETE
        CREATE OR REPLACE FUNCTION trg_delete_accessible_moments()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_edit') THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            IF OLD.moment_id NOT IN (SELECT moment_id FROM accessible_moments) THEN
                RAISE EXCEPTION 'Permission denied: the moment is not accessible';
            END IF;

            DELETE FROM moments WHERE moment_id = OLD.moment_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_albums INSERT
        CREATE OR REPLACE FUNCTION trg_insert_accessible_albums()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_edit') THEN
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
                NEW.album_id,
                cur_event_profile('event_id'),
                NEW.label,
                NEW.description,
                NEW.representative_image
            );
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_albums UPDATE
        CREATE OR REPLACE FUNCTION trg_update_accessible_albums()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_edit') THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;
            
            IF OLD.album_id NOT IN (SELECT album_id FROM accessible_albums) THEN
                RAISE EXCEPTION 'Permission denied: the album is not accessible';
            END IF;

            UPDATE albums SET
                label = NEW.label,
                description = NEW.description,
                representative_image = NEW.representative_image
            WHERE album_id = OLD.album_id;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_albums DELETE
        CREATE OR REPLACE FUNCTION trg_delete_accessible_albums()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_edit') THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            IF OLD.album_id NOT IN (SELECT album_id FROM accessible_albums) THEN
                RAISE EXCEPTION 'Permission denied: the album is not accessible';
            END IF;

            DELETE FROM albums WHERE album_id = OLD.album_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_albums_images INSERT
        CREATE OR REPLACE FUNCTION trg_insert_accessible_albums_images()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_edit') THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            IF NEW.image_id NOT IN (SELECT image_id FROM accessible_images) THEN
                RAISE EXCEPTION 'Permission denied: the image is not accessible';
            END IF;

            IF NEW.album_id NOT IN (SELECT album_id FROM accessible_albums) THEN
                RAISE EXCEPTION 'Permission denied: the album is not accessible';
            END IF;

            INSERT INTO albums_images (album_id, image_id)
            VALUES (NEW.album_id, NEW.image_id)
            ON CONFLICT DO NOTHING;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_albums_images DELETE
        CREATE OR REPLACE FUNCTION trg_delete_accessible_albums_images()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_edit') THEN
                RAISE EXCEPTION 'Permission denied: the profile does not have permission to edit entities';
            END IF;

            IF OLD.image_id NOT IN (SELECT image_id FROM accessible_images) THEN
                RAISE EXCEPTION 'Permission denied: the image is not accessible';
            END IF;

            IF OLD.album_id NOT IN (SELECT album_id FROM accessible_albums) THEN
                RAISE EXCEPTION 'Permission denied: the album is not accessible';
            END IF;

            DELETE FROM albums_images
            WHERE album_id = OLD.album_id AND image_id = OLD.image_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_delete_accessible_albums_images() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_accessible_albums_images() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_accessible_albums() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_accessible_albums() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_accessible_albums() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_accessible_moments() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_accessible_moments() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_accessible_moments() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_accessible_groups() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_accessible_groups() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_accessible_groups() CASCADE;
        """
    ),
    # Step 14: Attach groups, moments, albums triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_insert_accessible_groups ON accessible_groups;
        CREATE TRIGGER trg_insert_accessible_groups
            INSTEAD OF INSERT ON accessible_groups
            FOR EACH ROW EXECUTE FUNCTION trg_insert_accessible_groups();

        DROP TRIGGER IF EXISTS trg_update_accessible_groups ON accessible_groups;
        CREATE TRIGGER trg_update_accessible_groups
            INSTEAD OF UPDATE ON accessible_groups
            FOR EACH ROW EXECUTE FUNCTION trg_update_accessible_groups();

        DROP TRIGGER IF EXISTS trg_delete_accessible_groups ON accessible_groups;
        CREATE TRIGGER trg_delete_accessible_groups
            INSTEAD OF DELETE ON accessible_groups
            FOR EACH ROW EXECUTE FUNCTION trg_delete_accessible_groups();

        DROP TRIGGER IF EXISTS trg_insert_accessible_moments ON accessible_moments;
        CREATE TRIGGER trg_insert_accessible_moments
            INSTEAD OF INSERT ON accessible_moments
            FOR EACH ROW EXECUTE FUNCTION trg_insert_accessible_moments();

        DROP TRIGGER IF EXISTS trg_update_accessible_moments ON accessible_moments;
        CREATE TRIGGER trg_update_accessible_moments
            INSTEAD OF UPDATE ON accessible_moments
            FOR EACH ROW EXECUTE FUNCTION trg_update_accessible_moments();

        DROP TRIGGER IF EXISTS trg_delete_accessible_moments ON accessible_moments;
        CREATE TRIGGER trg_delete_accessible_moments
            INSTEAD OF DELETE ON accessible_moments
            FOR EACH ROW EXECUTE FUNCTION trg_delete_accessible_moments();

        DROP TRIGGER IF EXISTS trg_insert_accessible_albums ON accessible_albums;
        CREATE TRIGGER trg_insert_accessible_albums
            INSTEAD OF INSERT ON accessible_albums
            FOR EACH ROW EXECUTE FUNCTION trg_insert_accessible_albums();

        DROP TRIGGER IF EXISTS trg_update_accessible_albums ON accessible_albums;
        CREATE TRIGGER trg_update_accessible_albums
            INSTEAD OF UPDATE ON accessible_albums
            FOR EACH ROW EXECUTE FUNCTION trg_update_accessible_albums();

        DROP TRIGGER IF EXISTS trg_delete_accessible_albums ON accessible_albums;
        CREATE TRIGGER trg_delete_accessible_albums
            INSTEAD OF DELETE ON accessible_albums
            FOR EACH ROW EXECUTE FUNCTION trg_delete_accessible_albums();

        DROP TRIGGER IF EXISTS trg_insert_accessible_albums_images ON accessible_albums_images;
        CREATE TRIGGER trg_insert_accessible_albums_images
            INSTEAD OF INSERT ON accessible_albums_images
            FOR EACH ROW EXECUTE FUNCTION trg_insert_accessible_albums_images();

        DROP TRIGGER IF EXISTS trg_delete_accessible_albums_images ON accessible_albums_images;
        CREATE TRIGGER trg_delete_accessible_albums_images
            INSTEAD OF DELETE ON accessible_albums_images
            FOR EACH ROW EXECUTE FUNCTION trg_delete_accessible_albums_images();
        """,
        """
        DROP TRIGGER IF EXISTS trg_delete_accessible_albums_images ON accessible_albums_images;
        DROP TRIGGER IF EXISTS trg_insert_accessible_albums_images ON accessible_albums_images;
        DROP TRIGGER IF EXISTS trg_delete_accessible_albums ON accessible_albums;
        DROP TRIGGER IF EXISTS trg_update_accessible_albums ON accessible_albums;
        DROP TRIGGER IF EXISTS trg_insert_accessible_albums ON accessible_albums;
        DROP TRIGGER IF EXISTS trg_delete_accessible_moments ON accessible_moments;
        DROP TRIGGER IF EXISTS trg_update_accessible_moments ON accessible_moments;
        DROP TRIGGER IF EXISTS trg_insert_accessible_moments ON accessible_moments;
        DROP TRIGGER IF EXISTS trg_delete_accessible_groups ON accessible_groups;
        DROP TRIGGER IF EXISTS trg_update_accessible_groups ON accessible_groups;
        DROP TRIGGER IF EXISTS trg_insert_accessible_groups ON accessible_groups;
        """
    ),
    # Step 15: Uploads and access_requests trigger functions
    step(
        """
        -- Function for accessible_uploads INSERT
        CREATE OR REPLACE FUNCTION trg_insert_accessible_uploads()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_upload_and_delete_images') THEN
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
                cur_event_profile('event_id'),
                cur_profile('profile_id'),
                COALESCE(NEW.started_at, CURRENT_TIMESTAMP),
                NEW.completed_at,
                COALESCE(NEW.status, 'pending'),
                COALESCE(NEW.images_count, 0),
                COALESCE(NEW.faces_count, 0),
                COALESCE(NEW.clusters_count, 0),
                COALESCE(NEW.moments_count, 0),
                NEW.errors,
                NEW.notes
            )
            ON CONFLICT DO NOTHING;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_uploads UPDATE
        CREATE OR REPLACE FUNCTION trg_update_accessible_uploads()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF OLD.profile_id <> cur_profile('profile_id') THEN
                RAISE EXCEPTION 'Permission denied: the upload is not editable';
            END IF;
            
            IF OLD.upload_id NOT IN (SELECT upload_id FROM accessible_uploads) THEN
                RAISE EXCEPTION 'Permission denied: the upload is not accessible';
            END IF;
            
            IF NOT cur_event_profile_bool('can_upload_and_delete_images') THEN
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
            WHERE upload_id = OLD.upload_id;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_uploads DELETE
        CREATE OR REPLACE FUNCTION trg_delete_accessible_uploads()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NOT cur_event_profile_bool('can_upload_and_delete_images') THEN
                RAISE EXCEPTION 'Permission denied: cannot upload and delete images';
            END IF;
            
            IF OLD.upload_id NOT IN (SELECT upload_id FROM accessible_uploads) THEN
                RAISE EXCEPTION 'Permission denied: the upload is not accessible';
            END IF;
            
            IF OLD.profile_id <> cur_profile('profile_id') AND OLD.profile_id NOT IN (
                SELECT profile_id FROM accessible_events_profiles
                WHERE event_id = cur_event_profile('event_id') AND profile_id = OLD.profile_id
            ) THEN
                RAISE EXCEPTION 'Permission denied: the profile is not accessible';
            END IF;

            DELETE FROM uploads WHERE upload_id = OLD.upload_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_delete_accessible_uploads() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_accessible_uploads() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_accessible_uploads() CASCADE;
        """
    ),
    # Step 16: Attach uploads triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_insert_accessible_uploads ON accessible_uploads;
        CREATE TRIGGER trg_insert_accessible_uploads
            INSTEAD OF INSERT ON accessible_uploads
            FOR EACH ROW EXECUTE FUNCTION trg_insert_accessible_uploads();

        DROP TRIGGER IF EXISTS trg_update_accessible_uploads ON accessible_uploads;
        CREATE TRIGGER trg_update_accessible_uploads
            INSTEAD OF UPDATE ON accessible_uploads
            FOR EACH ROW EXECUTE FUNCTION trg_update_accessible_uploads();

        DROP TRIGGER IF EXISTS trg_delete_accessible_uploads ON accessible_uploads;
        CREATE TRIGGER trg_delete_accessible_uploads
            INSTEAD OF DELETE ON accessible_uploads
            FOR EACH ROW EXECUTE FUNCTION trg_delete_accessible_uploads();
        """,
        """
        DROP TRIGGER IF EXISTS trg_delete_accessible_uploads ON accessible_uploads;
        DROP TRIGGER IF EXISTS trg_update_accessible_uploads ON accessible_uploads;
        DROP TRIGGER IF EXISTS trg_insert_accessible_uploads ON accessible_uploads;
        """
    ),
    # Step 17: Critical BEFORE/AFTER table triggers
    step(
        """
        -- Function to prevent reserved event URLs
        CREATE OR REPLACE FUNCTION trg_prevent_reserved_event_urls()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.url = 'dashboard' THEN
                RAISE EXCEPTION 'Policy error: The URL "dashboard" is reserved and cannot be used for events';
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
            exclude_id TEXT := NULL;
        BEGIN
            IF TG_OP = 'UPDATE' THEN
                exclude_id := OLD.profile_id;
            END IF;
            IF EXISTS (
                SELECT 1 FROM profiles
                WHERE LOWER(label) = LOWER(NEW.label)
                AND (
                    COALESCE(restricted_to_event, '') = COALESCE(NEW.restricted_to_event, '')
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
            archive_album_id TEXT := gen_random_uuid();
            favorites_album_id TEXT := gen_random_uuid();
            unassociated_group_id TEXT := gen_random_uuid();
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
            VALUES (NEW.event_id, archive_album_id, 'Archive')
            ON CONFLICT DO NOTHING;

            INSERT INTO albums (event_id, album_id, label)
            VALUES (NEW.event_id, favorites_album_id, 'Favorites')
            ON CONFLICT DO NOTHING;

            INSERT INTO groups (event_id, group_id, label)
            VALUES (NEW.event_id, unassociated_group_id, 'Unassociated')
            ON CONFLICT DO NOTHING;

            UPDATE events SET
                archive_album_id = archive_album_id,
                favorites_album_id = favorites_album_id,
                unassociated_group_id = unassociated_group_id
            WHERE event_id = NEW.event_id;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_ensure_defaults_in_event_insert() CASCADE;
        DROP FUNCTION IF EXISTS trg_profiles_insert_default_preferences() CASCADE;
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
        -- Function for accessible_my_access_requests INSERT
        CREATE OR REPLACE FUNCTION trg_insert_accessible_my_access_requests()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF NEW.profile_id <> cur_profile('profile_id') OR (NEW.applicant_profile_id IS NOT NULL AND NEW.applicant_profile_id <> cur_profile('profile_id')) THEN
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
                cur_event_profile('event_id'),
                NEW.profile_id,
                COALESCE(NEW.requested_at, CURRENT_TIMESTAMP),
                CASE WHEN cur_profile_bool('is_public') THEN NEW.applicant_name ELSE NULL END,
                CASE WHEN cur_profile_bool('is_public') THEN NEW.applicant_email ELSE NULL END,
                CASE WHEN cur_profile_bool('is_public') THEN NEW.applicant_phone ELSE NULL END,
                NEW.details,
                CASE WHEN NOT cur_profile_bool('is_public') THEN NEW.applicant_profile_id ELSE NULL END,
                COALESCE(CASE WHEN cur_profile_bool('is_public') THEN TRUE ELSE NEW.communication_consent END, FALSE)
            );
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_my_access_requests UPDATE
        CREATE OR REPLACE FUNCTION trg_update_accessible_my_access_requests()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF OLD.profile_id <> cur_profile('profile_id') OR cur_profile('is_public') THEN
                RAISE EXCEPTION 'Permission denied: the access request is not accessible';
            END IF;
            
            IF OLD.is_closed THEN
                RAISE EXCEPTION 'Permission denied: cannot update closed access request';
            END IF;

            UPDATE access_requests SET
                details = NEW.details,
                communication_consent = COALESCE(cur_profile_bool('is_public') OR NEW.communication_consent, FALSE)
            WHERE access_request_id = OLD.access_request_id;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_my_access_requests DELETE
        CREATE OR REPLACE FUNCTION trg_delete_accessible_my_access_requests()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF OLD.profile_id <> cur_profile('profile_id') OR cur_profile('is_public') THEN
                RAISE EXCEPTION 'Permission denied: the access request is not accessible';
            END IF;
            
            IF OLD.is_closed THEN
                RAISE EXCEPTION 'Permission denied: cannot delete closed access request';
            END IF;

            DELETE FROM access_requests WHERE access_request_id = OLD.access_request_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_my_access_requests_groups INSERT
        CREATE OR REPLACE FUNCTION trg_insert_accessible_my_access_requests_groups()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF cur_profile('profile_id') <> (SELECT ar.profile_id FROM access_requests ar WHERE NEW.access_request_id = ar.access_request_id) THEN
                RAISE EXCEPTION 'Permission denied: the access request is not accessible';
            END IF;
            
            IF (SELECT is_closed FROM access_requests WHERE access_request_id = NEW.access_request_id) THEN
                RAISE EXCEPTION 'Permission denied: the access request is closed';
            END IF;

            INSERT INTO access_requests_groups (access_request_id, group_id)
            SELECT NEW.access_request_id, cgtra.group_id
            FROM current_groups_to_request_access cgtra
            WHERE cgtra.group_id = NEW.group_id
            ON CONFLICT DO NOTHING;

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
                json_build_object('access_request_id', NEW.access_request_id, 'event_id', cur_event_profile('event_id'))
            FROM events_profiles ep
            INNER JOIN profiles p ON ep.profile_id = p.profile_id
            WHERE
                ep.event_id = cur_event_profile('event_id')
                AND p.hierarchy_rank > 0
                AND NOT EXISTS (
                    SELECT 1
                    FROM notifications n
                    WHERE n.type = 'access_request'
                    AND n.profile_id = p.profile_id
                    AND (n.data->>'access_request_id')::TEXT = NEW.access_request_id::TEXT
                    AND (n.data->>'event_id')::TEXT = cur_event_profile('event_id')
                )
                AND EXISTS (
                    SELECT 1
                    FROM groups_accessibility ga
                    WHERE ga.group_id = NEW.group_id
                    AND ga.profile_id = p.profile_id
                    AND ga.event_id = cur_event_profile('event_id')
                    AND ga.is_accessible
                );
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_my_access_requests_groups DELETE
        CREATE OR REPLACE FUNCTION trg_delete_accessible_my_access_requests_groups()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF cur_profile('profile_id') <> (SELECT ar.profile_id FROM access_requests ar WHERE OLD.access_request_id = ar.access_request_id) THEN
                RAISE EXCEPTION 'Permission denied: the access request is not accessible';
            END IF;
            
            IF (SELECT is_closed FROM access_requests WHERE access_request_id = OLD.access_request_id) THEN
                RAISE EXCEPTION 'Permission denied: the access request is closed';
            END IF;

            DELETE FROM access_requests_groups WHERE access_request_id = OLD.access_request_id AND group_id = OLD.group_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_access_requests UPDATE
        CREATE OR REPLACE FUNCTION trg_update_accessible_access_requests()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF OLD.access_request_id NOT IN (SELECT access_request_id FROM accessible_access_requests) THEN
                RAISE EXCEPTION 'Permission denied: the access request is not accessible';
            END IF;
            
            IF OLD.is_closed THEN
                RAISE EXCEPTION 'Permission denied: the access request is closed';
            END IF;

            UPDATE access_requests SET applicant_profile_id = NEW.applicant_profile_id
            WHERE access_request_id = OLD.access_request_id;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_access_requests DELETE
        CREATE OR REPLACE FUNCTION trg_delete_accessible_access_requests()
        RETURNS TRIGGER AS $$
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF OLD.access_request_id NOT IN (SELECT access_request_id FROM accessible_access_requests) THEN
                RAISE EXCEPTION 'Permission denied: the access request is not accessible';
            END IF;

            DELETE FROM access_requests WHERE access_request_id = OLD.access_request_id;
            
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        -- Function for accessible_access_requests_groups UPDATE
        CREATE OR REPLACE FUNCTION trg_update_accessible_access_requests_groups()
        RETURNS TRIGGER AS $$
        DECLARE
            applicant_profile_id TEXT := (SELECT applicant_profile_id FROM access_requests WHERE access_request_id = OLD.access_request_id);
        BEGIN
            IF cur_event_profile('event_id') IS NULL THEN
                RAISE EXCEPTION 'Permission denied: event not found';
            END IF;
            
            IF OLD.access_request_id NOT IN (SELECT access_request_id FROM accessible_access_requests) THEN
                RAISE EXCEPTION 'Permission denied: the access request is not accessible';
            END IF;
            
            IF (SELECT is_closed FROM access_requests WHERE access_request_id = OLD.access_request_id) THEN
                RAISE EXCEPTION 'Permission denied: the access request is closed';
            END IF;
            
            IF OLD.approved IS NOT NULL THEN
                RAISE EXCEPTION 'Permission denied: the access request group is closed';
            END IF;
            
            IF NEW.approved IS TRUE AND OLD.group_id NOT IN (SELECT group_id FROM accessible_groups) THEN
                RAISE EXCEPTION 'Permission denied: the group is not accessible';
            END IF;

            IF NEW.approved IS TRUE THEN
                IF (SELECT all_groups FROM accessible_events_profiles WHERE profile_id = applicant_profile_id AND event_id = cur_event_profile('event_id')) IS FALSE THEN
                    INSERT INTO events_profiles_groups (event_id, profile_id, group_id)
                    VALUES (cur_event_profile('event_id'), applicant_profile_id, OLD.group_id)
                    ON CONFLICT DO NOTHING;
                ELSE
                    DELETE FROM events_profiles_groups
                    WHERE event_id = cur_event_profile('event_id')
                    AND profile_id = applicant_profile_id
                    AND group_id = OLD.group_id;
                END IF;
            END IF;

            UPDATE access_requests_groups SET
                approved = NEW.approved,
                closed_at = COALESCE(NEW.closed_at, CURRENT_TIMESTAMP),
                closed_by = cur_profile('profile_id')
            WHERE access_request_id = OLD.access_request_id AND group_id = OLD.group_id;

            PERFORM ensure_access_requests_closed_func(OLD.access_request_id, NEW.closed_at);
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """,
        """
        DROP FUNCTION IF EXISTS trg_update_accessible_access_requests_groups() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_accessible_access_requests() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_accessible_access_requests() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_accessible_my_access_requests_groups() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_accessible_my_access_requests_groups() CASCADE;
        DROP FUNCTION IF EXISTS trg_delete_accessible_my_access_requests() CASCADE;
        DROP FUNCTION IF EXISTS trg_update_accessible_my_access_requests() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_accessible_my_access_requests() CASCADE;
        """
    ),
    # Step 20: Attach access requests triggers
    step(
        """
        DROP TRIGGER IF EXISTS trg_insert_accessible_my_access_requests ON accessible_my_access_requests;
        CREATE TRIGGER trg_insert_accessible_my_access_requests
            INSTEAD OF INSERT ON accessible_my_access_requests
            FOR EACH ROW EXECUTE FUNCTION trg_insert_accessible_my_access_requests();

        DROP TRIGGER IF EXISTS trg_update_accessible_my_access_requests ON accessible_my_access_requests;
        CREATE TRIGGER trg_update_accessible_my_access_requests
            INSTEAD OF UPDATE ON accessible_my_access_requests
            FOR EACH ROW EXECUTE FUNCTION trg_update_accessible_my_access_requests();

        DROP TRIGGER IF EXISTS trg_delete_accessible_my_access_requests ON accessible_my_access_requests;
        CREATE TRIGGER trg_delete_accessible_my_access_requests
            INSTEAD OF DELETE ON accessible_my_access_requests
            FOR EACH ROW EXECUTE FUNCTION trg_delete_accessible_my_access_requests();

        DROP TRIGGER IF EXISTS trg_insert_accessible_my_access_requests_groups ON accessible_my_access_requests_groups;
        CREATE TRIGGER trg_insert_accessible_my_access_requests_groups
            INSTEAD OF INSERT ON accessible_my_access_requests_groups
            FOR EACH ROW EXECUTE FUNCTION trg_insert_accessible_my_access_requests_groups();

        DROP TRIGGER IF EXISTS trg_delete_accessible_my_access_requests_groups ON accessible_my_access_requests_groups;
        CREATE TRIGGER trg_delete_accessible_my_access_requests_groups
            INSTEAD OF DELETE ON accessible_my_access_requests_groups
            FOR EACH ROW EXECUTE FUNCTION trg_delete_accessible_my_access_requests_groups();

        DROP TRIGGER IF EXISTS trg_update_accessible_access_requests ON accessible_access_requests;
        CREATE TRIGGER trg_update_accessible_access_requests
            INSTEAD OF UPDATE ON accessible_access_requests
            FOR EACH ROW EXECUTE FUNCTION trg_update_accessible_access_requests();

        DROP TRIGGER IF EXISTS trg_delete_accessible_access_requests ON accessible_access_requests;
        CREATE TRIGGER trg_delete_accessible_access_requests
            INSTEAD OF DELETE ON accessible_access_requests
            FOR EACH ROW EXECUTE FUNCTION trg_delete_accessible_access_requests();

        DROP TRIGGER IF EXISTS trg_update_accessible_access_requests_groups ON accessible_access_requests_groups;
        CREATE TRIGGER trg_update_accessible_access_requests_groups
            INSTEAD OF UPDATE ON accessible_access_requests_groups
            FOR EACH ROW EXECUTE FUNCTION trg_update_accessible_access_requests_groups();
        """,
        """
        DROP TRIGGER IF EXISTS trg_update_accessible_access_requests_groups ON accessible_access_requests_groups;
        DROP TRIGGER IF EXISTS trg_delete_accessible_access_requests ON accessible_access_requests;
        DROP TRIGGER IF EXISTS trg_update_accessible_access_requests ON accessible_access_requests;
        DROP TRIGGER IF EXISTS trg_delete_accessible_my_access_requests_groups ON accessible_my_access_requests_groups;
        DROP TRIGGER IF EXISTS trg_insert_accessible_my_access_requests_groups ON accessible_my_access_requests_groups;
        DROP TRIGGER IF EXISTS trg_delete_accessible_my_access_requests ON accessible_my_access_requests;
        DROP TRIGGER IF EXISTS trg_update_accessible_my_access_requests ON accessible_my_access_requests;
        DROP TRIGGER IF EXISTS trg_insert_accessible_my_access_requests ON accessible_my_access_requests;
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
            old_id TEXT := NULL;
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
            old_id TEXT := NULL;
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
                SELECT 1 FROM events_profiles_groups
                WHERE event_id = cur_event_profile('event_id') AND profile_id = old_id
            ) THEN
                RAISE EXCEPTION 'Policy error: profile with upload permissions cannot be restricted to groups';
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Function to ensure profiles can upload validity for events_profiles_groups
        CREATE OR REPLACE FUNCTION trg_ensure_profiles_can_upload_validity_profile_groups()
        RETURNS TRIGGER AS $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM events_profiles
                WHERE event_id = cur_event_profile('event_id')
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
                WHERE g.event_id = cur_event_profile('event_id') AND g.group_id = e.unassociated_group_id
            ) THEN
                RAISE EXCEPTION 'Policy error: cannot edit unassociated group permissions';
            END IF;
            
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Helper function to ensure access requests closed
        CREATE OR REPLACE FUNCTION ensure_access_requests_closed_func(p_access_request_id TEXT DEFAULT NULL, p_closed_at TIMESTAMP DEFAULT NULL)
        RETURNS VOID AS $$
        BEGIN
            UPDATE access_requests SET
                is_closed = TRUE,
                closed_at = COALESCE(p_closed_at, CURRENT_TIMESTAMP),
                closed_by = cur_profile('profile_id')
            WHERE event_id = cur_event_profile('event_id')
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
            ) AND COALESCE((SELECT event_in_deletion FROM settings WHERE id = 1 LIMIT 1), '') <> OLD.event_id THEN
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
            ) AND COALESCE((SELECT event_in_deletion FROM settings WHERE id = 1 LIMIT 1), '') <> OLD.event_id THEN
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
                AND (OLD.group_id <> NEW.group_id OR OLD.label <> NEW.label
                    OR COALESCE(OLD.representative_face, '') <> COALESCE(NEW.representative_face, '')) THEN
                RAISE EXCEPTION 'Policy error: cannot update default group';
            END IF;
            
            IF TG_OP = 'DELETE' AND OLD.group_id = (SELECT unassociated_group_id FROM events WHERE event_id = OLD.event_id)
                AND COALESCE((SELECT event_in_deletion FROM settings WHERE id = 1 LIMIT 1), '') <> OLD.event_id THEN
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
        DROP FUNCTION IF EXISTS ensure_access_requests_closed_func(TEXT, TIMESTAMP) CASCADE;
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

        DROP TRIGGER IF EXISTS trg_ensure_profiles_can_upload_validity_profile_groups_insert ON events_profiles_groups;
        CREATE TRIGGER trg_ensure_profiles_can_upload_validity_profile_groups_insert
            BEFORE INSERT ON events_profiles_groups
            FOR EACH ROW EXECUTE FUNCTION trg_ensure_profiles_can_upload_validity_profile_groups();

        DROP TRIGGER IF EXISTS trg_revoke_refresh_tokens_when_profile_password_updated ON profiles;
        CREATE TRIGGER trg_revoke_refresh_tokens_when_profile_password_updated
            AFTER UPDATE ON profiles
            FOR EACH ROW EXECUTE FUNCTION trg_revoke_refresh_tokens_when_profile_password_updated();

        DROP TRIGGER IF EXISTS trg_insert_ensure_groups_unassociated_permissions ON events_profiles_groups;
        CREATE TRIGGER trg_insert_ensure_groups_unassociated_permissions
            BEFORE INSERT ON events_profiles_groups
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
        DROP TRIGGER IF EXISTS trg_insert_ensure_groups_unassociated_permissions ON events_profiles_groups;
        DROP TRIGGER IF EXISTS trg_revoke_refresh_tokens_when_profile_password_updated ON profiles;
        DROP TRIGGER IF EXISTS trg_ensure_profiles_can_upload_validity_profile_groups_insert ON events_profiles_groups;
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
                    closed_by = cur_profile('profile_id')
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

        -- Function to insert events_profiles_groups ensure access requests groups validity
        CREATE OR REPLACE FUNCTION trg_insert_events_profiles_groups_ensure_access_requests_groups_validity()
        RETURNS TRIGGER AS $$
        BEGIN
            IF
                (SELECT all_groups FROM accessible_events_profiles WHERE profile_id = NEW.profile_id AND event_id = cur_event_profile('event_id')) IS FALSE
            THEN
                UPDATE access_requests_groups SET
                    approved = TRUE,
                    closed_at = CURRENT_TIMESTAMP,
                    closed_by = cur_profile('profile_id')
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

        -- Function to delete events_profiles_groups ensure access requests groups validity
        CREATE OR REPLACE FUNCTION trg_delete_events_profiles_groups_ensure_access_requests_groups_validity()
        RETURNS TRIGGER AS $$
        BEGIN
            IF
                (SELECT all_groups FROM accessible_events_profiles WHERE profile_id = OLD.profile_id AND event_id = cur_event_profile('event_id')) IS TRUE
            THEN
                UPDATE access_requests_groups SET
                    approved = TRUE,
                    closed_at = CURRENT_TIMESTAMP,
                    closed_by = cur_profile('profile_id')
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
        DROP FUNCTION IF EXISTS trg_delete_events_profiles_groups_ensure_access_requests_groups_validity() CASCADE;
        DROP FUNCTION IF EXISTS trg_insert_events_profiles_groups_ensure_access_requests_groups_validity() CASCADE;
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

        DROP TRIGGER IF EXISTS trg_insert_events_profiles_groups_ensure_access_requests_groups_validity ON events_profiles_groups;
        CREATE TRIGGER trg_insert_events_profiles_groups_ensure_access_requests_groups_validity
            AFTER INSERT ON events_profiles_groups
            FOR EACH ROW EXECUTE FUNCTION trg_insert_events_profiles_groups_ensure_access_requests_groups_validity();

        DROP TRIGGER IF EXISTS trg_delete_events_profiles_groups_ensure_access_requests_groups_validity ON events_profiles_groups;
        CREATE TRIGGER trg_delete_events_profiles_groups_ensure_access_requests_groups_validity
            AFTER DELETE ON events_profiles_groups
            FOR EACH ROW EXECUTE FUNCTION trg_delete_events_profiles_groups_ensure_access_requests_groups_validity();
        """,
        """
        DROP TRIGGER IF EXISTS trg_delete_events_profiles_groups_ensure_access_requests_groups_validity ON events_profiles_groups;
        DROP TRIGGER IF EXISTS trg_insert_events_profiles_groups_ensure_access_requests_groups_validity ON events_profiles_groups;
        DROP TRIGGER IF EXISTS trg_update_profile_ensure_access_requests_groups_validity ON events_profiles;
        """
    ),
]
