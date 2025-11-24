"""
PostgreSQL views migration.
Creates all database views for access control and data aggregation.
"""

from yoyo import step

__depends__ = {'0002_functions'}

steps = [
    step(
        """
        -- settings
        CREATE OR REPLACE VIEW accessible_settings AS
        SELECT
            s.*
        FROM settings s
        WHERE s.id = 1
        AND cur_profile_bool('is_developer');
        
        -- rekognition usage
        CREATE OR REPLACE VIEW accessible_rekognition_usaged AS
        SELECT
            ru.*
        FROM rekognition_usaged ru
        JOIN settings s ON s.id = 1
        WHERE cur_profile_bool('is_developer');

        -- all profiles accessibility
        CREATE OR REPLACE VIEW albums_accessibility_base AS
        SELECT
            a.event_id,
            a.album_id,
            ep.profile_id,
            (
                (ep.all_albums AND epa.album_id IS NULL)
                OR (NOT ep.all_albums AND epa.album_id IS NOT NULL)
            ) AS is_accessible
        FROM albums a
        JOIN events_profiles ep ON a.event_id = ep.event_id
        LEFT JOIN events_profiles_albums epa ON 
            a.album_id = epa.album_id 
            AND ep.profile_id = epa.profile_id;

        CREATE OR REPLACE VIEW groups_accessibility_base AS
        SELECT
            g.event_id,
            g.group_id,
            ep.profile_id,
            (
                (
                    (ep.all_groups AND epg.group_id IS NULL)
                    OR (NOT ep.all_groups AND epg.group_id IS NOT NULL)
                )
                AND (ep.can_edit OR g.group_id <> e.unassociated_group_id)
            ) AS is_accessible
        FROM groups g
        JOIN events e ON g.event_id = e.event_id
        JOIN events_profiles ep ON g.event_id = ep.event_id
        LEFT JOIN events_profiles_groups epg ON 
            g.group_id = epg.group_id 
            AND ep.profile_id = epg.profile_id;

        CREATE OR REPLACE VIEW images_accessibility_base AS
        SELECT
            i.event_id,
            i.image_id,
            ep.profile_id,
            (
                (ep.all_images AND epi.image_id IS NULL)
                OR (NOT ep.all_images AND epi.image_id IS NOT NULL)
            ) AS is_accessible
        FROM images i
        JOIN events_profiles ep ON i.event_id = ep.event_id
        LEFT JOIN events_profiles_images epi ON 
            i.image_id = epi.image_id 
            AND ep.profile_id = epi.profile_id;

        CREATE OR REPLACE VIEW images_accessibility AS
        SELECT
            iab.event_id,
            iab.image_id,
            iab.profile_id,
            (iab.is_accessible AND COALESCE(aab.is_accessible, TRUE)) AS is_accessible
        FROM images_accessibility_base iab
        INNER JOIN events e ON iab.event_id = e.event_id
        LEFT JOIN albums_images ai ON
            e.archive_album_id = ai.album_id
            AND ai.image_id = iab.image_id
        LEFT JOIN albums_accessibility_base aab ON
            aab.album_id = ai.album_id
            AND aab.profile_id = iab.profile_id;
            
        CREATE OR REPLACE VIEW faces_accessibility AS
        SELECT
            ep.event_id,
            f.face_id,
            ep.profile_id,
            (ia.is_accessible AND gab.is_accessible) AS is_accessible
        FROM faces f
        INNER JOIN images i ON f.image_id = i.image_id
        JOIN events_profiles ep ON i.event_id = ep.event_id
        INNER JOIN images_accessibility ia ON f.image_id = ia.image_id AND ia.profile_id = ep.profile_id
        INNER JOIN groups_accessibility_base gab ON f.group_id = gab.group_id AND gab.profile_id = ep.profile_id;
        
        CREATE OR REPLACE VIEW groups_accessibility AS
        SELECT
            gab.event_id,
            gab.group_id,
            gab.profile_id,
            (
                gab.is_accessible
                AND (
                    ep.can_edit
                    OR EXISTS (
                        SELECT 1
                        FROM faces_accessibility fa
                        INNER JOIN faces f ON fa.face_id = f.face_id
                        WHERE f.group_id = gab.group_id
                        AND fa.profile_id = gab.profile_id
                        AND fa.is_accessible
                    )
                )
            ) AS is_accessible
        FROM groups_accessibility_base gab
        JOIN events_profiles ep ON gab.event_id = ep.event_id AND gab.profile_id = ep.profile_id;
        
        -- groups_images view (needed by groups_to_request_access)
        CREATE OR REPLACE VIEW groups_images AS
        SELECT DISTINCT ON (i.image_id, g.group_id)
            i.image_id as image_id,
            g.group_id as group_id
        FROM images i
        INNER JOIN faces f ON i.image_id = f.image_id
        INNER JOIN groups g ON f.group_id = g.group_id;
        
        CREATE OR REPLACE VIEW groups_to_request_access AS
        SELECT
            gab.event_id,
            gab.profile_id,
            gab.group_id
        FROM groups_accessibility_base gab
        WHERE gab.is_accessible
        AND EXISTS (
            SELECT 1
            FROM groups_images gi
            INNER JOIN images_accessibility ia ON
                gi.image_id = ia.image_id
                AND ia.event_id = gab.event_id
                AND ia.profile_id = gab.profile_id
                AND ia.is_accessible
            WHERE gi.group_id = gab.group_id
        );
        
        CREATE OR REPLACE VIEW moments_accessibility AS
        SELECT
            ep.event_id,
            m.moment_id,
            ep.profile_id,
            (
                ep.can_edit
                OR EXISTS (
                    SELECT 1
                    FROM images_accessibility ia
                    INNER JOIN images i ON i.image_id = ia.image_id
                    WHERE i.moment_id = m.moment_id
                    AND ia.profile_id = ep.profile_id
                    AND ia.is_accessible
                )
            ) AS is_accessible
        FROM moments m
        JOIN events_profiles ep ON m.event_id = ep.event_id;
        
        CREATE OR REPLACE VIEW albums_accessibility AS
        SELECT
            aab.event_id,
            aab.album_id,
            ep.profile_id,
            (
                aab.is_accessible
                AND (ep.can_edit OR EXISTS (
                    SELECT 1
                    FROM images_accessibility ia
                    INNER JOIN albums_images ai ON ai.image_id = ia.image_id
                    WHERE ai.album_id = aab.album_id
                    AND ia.profile_id = ep.profile_id
                    AND ia.is_accessible
                ))
            ) AS is_accessible
        FROM albums_accessibility_base aab
        JOIN events_profiles ep ON aab.event_id = ep.event_id AND aab.profile_id = ep.profile_id;

        -- events
        CREATE OR REPLACE VIEW accessible_events AS
        SELECT
            e.*,
            (ep.profile_id IS NOT NULL) AS is_accessible,
            CASE WHEN ep.can_manage_event THEN (
                SELECT COUNT(*)
                FROM images_accessibility ia
                WHERE ia.event_id = e.event_id
                AND ia.profile_id = ep.profile_id
                AND ia.is_accessible
            ) ELSE 0 END AS images_count,
            CASE WHEN ep.can_manage_event THEN (
                SELECT SUM(i.file_size)
                FROM images_accessibility ia
                INNER JOIN images i ON i.image_id = ia.image_id
                WHERE ia.event_id = e.event_id
                AND ia.profile_id = ep.profile_id
                AND ia.is_accessible
            ) ELSE 0 END AS total_original_size,
            CASE WHEN ep.can_manage_event THEN (
                SELECT SUM(i.high_quality_file_size)
                FROM images_accessibility ia
                INNER JOIN images i ON i.image_id = ia.image_id
                WHERE ia.event_id = e.event_id
                AND ia.profile_id = ep.profile_id
                AND ia.is_accessible
            ) ELSE 0 END AS total_high_quality_size,
            CASE WHEN ep.can_manage_event THEN ((
                SELECT SUM(i.file_size + i.high_quality_file_size + i.display_file_size + i.thumb_file_size)
                FROM images_accessibility ia
                INNER JOIN images i ON i.image_id = ia.image_id
                WHERE ia.event_id = e.event_id
                AND ia.profile_id = ep.profile_id
                AND ia.is_accessible
            ) + (
                SELECT SUM(f.file_size)
                FROM faces_accessibility fa
                INNER JOIN faces f ON f.face_id = fa.face_id
                WHERE fa.event_id = e.event_id
                AND fa.profile_id = ep.profile_id
                AND fa.is_accessible
            )) ELSE 0 END AS total_size,
            CASE WHEN ep.can_manage_event THEN (
                SELECT MAX(i.file_size)
                FROM images_accessibility ia
                INNER JOIN images i ON i.image_id = ia.image_id
                WHERE ia.event_id = e.event_id
                AND ia.profile_id = ep.profile_id
                AND ia.is_accessible
            ) ELSE 0 END AS max_image_size,
            CASE WHEN ep.can_manage_event THEN (
                SELECT COUNT(*)
                FROM faces_accessibility fa
                WHERE fa.event_id = e.event_id
                AND fa.profile_id = ep.profile_id
                AND fa.is_accessible
            ) ELSE 0 END AS faces_count,
            CASE WHEN ep.can_manage_event THEN (
                SELECT COUNT(*)
                FROM albums_accessibility aa
                WHERE aa.event_id = e.event_id
                AND aa.profile_id = ep.profile_id
                AND aa.is_accessible
            ) ELSE 0 END AS albums_count,
            CASE WHEN ep.can_manage_event THEN (
                SELECT COUNT(*)
                FROM moments_accessibility ma
                WHERE ma.event_id = e.event_id
                AND ma.profile_id = ep.profile_id
                AND ma.is_accessible
            ) ELSE 0 END AS moments_count
        FROM events e
        LEFT JOIN events_profiles ep ON
            e.event_id = ep.event_id
            AND ep.profile_id = cur_profile('profile_id')
        WHERE e.is_public OR ep.profile_id IS NOT NULL;

        -- profiles
        CREATE OR REPLACE VIEW accessible_profiles AS
        SELECT
            p.*,
            ae.name AS restricted_to_event_name,
            (
                cur_profile('restricted_to_event') IS NULL
                OR cur_profile('restricted_to_event') = COALESCE(p.restricted_to_event, '')
            ) AS is_editable,
            (public_access_code IS NOT NULL) AS has_public_access_code
        FROM profiles p
        LEFT JOIN accessible_events ae ON p.restricted_to_event = ae.event_id
        WHERE p.hierarchy_rank < cur_profile_int('hierarchy_rank')
        AND
            (p.restricted_to_event IS NULL OR p.restricted_to_event IN (
                SELECT event_id
                FROM events_profiles ep
                WHERE ep.profile_id = cur_profile('profile_id')
            ));
        
        CREATE OR REPLACE VIEW my_preferences AS
        SELECT
            pp.*,
            dp.value_type
        FROM profiles_preferences pp
        INNER JOIN default_preferences dp
        ON pp.preference_group = dp.preference_group
        AND pp.preference_key = dp.preference_key
        WHERE pp.profile_id = cur_profile('profile_id');

        -- notifications
        CREATE OR REPLACE VIEW my_notifications AS
        SELECT * FROM notifications
        WHERE profile_id = cur_profile('profile_id');
        
        CREATE OR REPLACE VIEW accessible_my_notifications AS
        SELECT * FROM my_notifications
        WHERE NOT cur_profile_bool('is_public');
        
        CREATE OR REPLACE VIEW accessible_notifications AS
        SELECT n.* FROM notifications n
        INNER JOIN accessible_profiles ap ON n.profile_id = ap.profile_id;

        -- feedbacks
        CREATE OR REPLACE VIEW feedbacks_details AS
        SELECT
            fe.feedback_id,
            fe.profile_id,
            p.label AS profile_label,
            p.is_public AS profile_is_public,
            CASE WHEN p.is_public THEN fe.sender_name ELSE p.label END AS sender_name,
            CASE WHEN p.is_public THEN fe.sender_email ELSE p.email END AS sender_email,
            fe.communication_consent,
            fe.title,
            fe.type,
            fe.message,
            fe.created_at,
            fe.user_agent,
            fe.ip_address,
            fe.diagnostics,
            fe.notes,
            fe.is_closed,
            fe.solved,
            fe.closed_at,
            fe.closed_by,
            fe.closed_details
        FROM feedbacks fe
        LEFT JOIN profiles p ON fe.profile_id = p.profile_id;
        
        CREATE OR REPLACE VIEW my_feedbacks AS
        SELECT
            feedback_id,
            profile_id,
            sender_name,
            sender_email,
            communication_consent,
            title,
            type,
            message,
            created_at,
            is_closed,
            closed_at,
            closed_details,
            user_agent,
            ip_address,
            diagnostics
        FROM feedbacks_details
        WHERE profile_id = cur_profile('profile_id');
        
        CREATE OR REPLACE VIEW accessible_my_feedbacks AS
        SELECT * FROM my_feedbacks
        WHERE NOT cur_profile_bool('is_public');
        
        CREATE OR REPLACE VIEW accessible_feedbacks AS
        SELECT
            fe.*,
            p.label AS closed_by_label
        FROM feedbacks_details fe
        LEFT JOIN profiles p ON fe.closed_by = p.profile_id
        WHERE cur_profile_bool('is_developer');

        -- current profile
        CREATE OR REPLACE VIEW current_profile_events AS
        SELECT
            ep.profile_id,
            ep.event_id,
            ep.can_manage_event,
            ep.can_delete_event
        FROM events_profiles ep
        WHERE ep.profile_id = cur_profile('profile_id');
        
        CREATE OR REPLACE VIEW current_groups_to_request_access AS
        SELECT
            gta.group_id
        FROM groups_to_request_access gta
        WHERE gta.event_id = cur_event_profile('event_id')
        AND gta.profile_id = cur_profile('profile_id');
     
        CREATE OR REPLACE VIEW current_profile AS
        SELECT
            p.profile_id,
            p.label,
            p.password,
            p.email,
            p.hierarchy_rank,
            p.can_create_events,
            p.restricted_to_event,
            p.is_public,
            (p.hierarchy_rank > 0) AS is_profiles_manager,
            (p.hierarchy_rank > (SELECT min_rank_to_create_event FROM settings WHERE id = 1 LIMIT 1)) AS can_manage_create_events,
            COUNT(mn.notification_id) AS total_notifications,
            COUNT(DISTINCT CASE WHEN NOT mn.read THEN mn.notification_id END) AS unread_notifications,
            (SELECT COUNT(*) FROM accessible_feedbacks WHERE NOT is_closed) AS pending_feedbacks,
            cur_profile_bool('is_developer') AS has_feedbacks,
            cur_profile_bool('is_developer') AS has_settings,
            (SUM(CASE WHEN cpe.can_manage_event THEN 1 ELSE 0 END) > 0 OR p.can_create_events) AS has_manageable_events,
            (
                SUM(CASE WHEN cpe.can_manage_event THEN 1 ELSE 0 END) > 0
                OR p.can_create_events
                OR cur_profile_bool('is_developer')
            ) AS has_dashboard
        FROM profiles p
        LEFT JOIN my_notifications mn ON p.profile_id = mn.profile_id
        LEFT JOIN current_profile_events cpe ON p.profile_id = cpe.profile_id
        WHERE p.profile_id = cur_profile('profile_id')
        GROUP BY p.profile_id;

        -- event profiles
        CREATE OR REPLACE VIEW accessible_events_profiles AS
        SELECT ep.*
        FROM events_profiles ep
        INNER JOIN profiles p ON ep.profile_id = p.profile_id
        INNER JOIN accessible_events ae ON ep.event_id = ae.event_id
        WHERE p.hierarchy_rank < cur_profile_int('hierarchy_rank');
        
        CREATE OR REPLACE VIEW accessible_events_profiles_images AS
        SELECT epi.*
        FROM events_profiles_images epi
        INNER JOIN accessible_events_profiles aep
        ON epi.profile_id = aep.profile_id
        AND aep.event_id = epi.event_id
        WHERE aep.event_id = cur_event_profile('event_id');
        
        CREATE OR REPLACE VIEW accessible_events_profiles_groups AS
        SELECT epg.*
        FROM events_profiles_groups epg
        INNER JOIN accessible_events_profiles aep
        ON epg.profile_id = aep.profile_id
        AND epg.event_id = aep.event_id
        WHERE aep.event_id = cur_event_profile('event_id');
        
        CREATE OR REPLACE VIEW accessible_events_profiles_albums AS
        SELECT epa.*
        FROM events_profiles_albums epa
        INNER JOIN accessible_events_profiles aep
        ON epa.profile_id = aep.profile_id
        AND epa.event_id = aep.event_id
        WHERE aep.event_id = cur_event_profile('event_id');

        -- images
        CREATE OR REPLACE VIEW accessible_images AS
        SELECT
            i.*,
            (ai1.image_id IS NOT NULL) AS is_archived,
            (ai2.image_id IS NOT NULL) AS is_favorite
        FROM images i
        INNER JOIN images_accessibility ia ON i.image_id = ia.image_id
        INNER JOIN events e ON e.event_id = ia.event_id
        LEFT JOIN (
            albums_accessibility_base aa1
            INNER JOIN albums_images ai1 ON
                aa1.album_id = ai1.album_id
                AND aa1.is_accessible
        ) ON
            ai1.image_id = ia.image_id
            AND aa1.profile_id = ia.profile_id
            AND aa1.album_id = e.archive_album_id
        LEFT JOIN (
            albums_accessibility_base aa2
            INNER JOIN albums_images ai2 ON
                aa2.album_id = ai2.album_id
                AND aa2.is_accessible
        ) ON
            ai2.image_id = ia.image_id
            AND aa2.profile_id = ia.profile_id
            AND aa2.album_id = e.favorites_album_id
        WHERE
            ia.event_id = cur_event_profile('event_id')
            AND ia.profile_id = cur_profile('profile_id')
            AND ia.is_accessible;

        -- faces
        CREATE OR REPLACE VIEW accessible_faces AS
        SELECT
            f.*,
            i.upload_id
        FROM faces f 
        INNER JOIN images i ON f.image_id = i.image_id
        INNER JOIN faces_accessibility fa ON
            f.face_id = fa.face_id
            AND fa.profile_id = cur_profile('profile_id')
            AND fa.is_accessible
            AND fa.event_id = cur_event_profile('event_id')
            AND fa.is_accessible;

        -- groups (groups_images view already created above)
        CREATE OR REPLACE VIEW accessible_groups_images AS
        SELECT DISTINCT ON (ai.image_id, af.group_id)
            ai.image_id as image_id,
            af.group_id as group_id
        FROM accessible_images ai
        INNER JOIN accessible_faces af ON ai.image_id = af.image_id
        INNER JOIN groups_accessibility ga ON
            af.group_id = ga.group_id
            AND ga.profile_id = cur_profile('profile_id')
            AND ga.is_accessible
            AND ga.event_id = cur_event_profile('event_id');
        
        CREATE OR REPLACE VIEW accessible_groups AS
        SELECT 
            g.event_id,
            g.group_id,
            g.label,
            g.representative_face,
            rf.image_id as representative_image,
            COALESCE(stats.faces_count, 0) as faces_count,
            COALESCE(stats.images_count, 0) as images_count,
            COALESCE(stats.active_images_count, 0) as active_images_count
        FROM groups g
        JOIN events_profiles ep ON g.event_id = ep.event_id AND ep.profile_id = cur_profile('profile_id')
        LEFT JOIN faces rf ON g.representative_face = rf.face_id
        LEFT JOIN events_profiles_groups epg ON g.group_id = epg.group_id AND ep.profile_id = epg.profile_id
        JOIN events e ON g.event_id = e.event_id
        LEFT JOIN LATERAL (
            SELECT 
                COUNT(f.face_id) as faces_count,
                COUNT(DISTINCT f.image_id) as images_count,
                COUNT(DISTINCT CASE WHEN ai.image_id IS NULL THEN f.image_id END) as active_images_count
            FROM faces f
            JOIN images i ON f.image_id = i.image_id
            LEFT JOIN events_profiles_images epi ON i.image_id = epi.image_id AND epi.profile_id = ep.profile_id
            LEFT JOIN albums_images ai ON i.image_id = ai.image_id AND ai.album_id = e.archive_album_id
            WHERE f.group_id = g.group_id
            AND (ep.all_images OR epi.image_id IS NOT NULL)
        ) stats ON TRUE
        WHERE 
            g.event_id = cur_event_profile('event_id')
            AND (
                ep.all_groups 
                OR epg.group_id IS NOT NULL
                OR (NOT ep.can_edit AND g.group_id = e.unassociated_group_id)
            );

        -- moments
        CREATE OR REPLACE VIEW accessible_moments AS
        WITH moments_stats AS (
            SELECT
                ma.moment_id,
                COUNT(ai.image_id) as images_count,
                COUNT(DISTINCT CASE WHEN NOT ai.is_archived THEN ai.image_id END) AS active_images_count
            FROM moments_accessibility ma
            LEFT JOIN accessible_images ai ON ma.moment_id = ai.moment_id
            WHERE
                ma.event_id = cur_event_profile('event_id')
                AND ma.profile_id = cur_profile('profile_id')
                AND ma.is_accessible
            GROUP BY ma.moment_id
        )
        SELECT
            m.*,
            ms.images_count,
            ms.active_images_count
        FROM moments m
        INNER JOIN moments_stats ms ON m.moment_id = ms.moment_id;

        -- albums
        CREATE OR REPLACE VIEW albums_images_actual AS
        SELECT albums_images.*
        FROM albums_images
        INNER JOIN albums ON albums_images.album_id = albums.album_id
        INNER JOIN events e ON albums.event_id = e.event_id
        WHERE albums.album_id <> e.archive_album_id AND albums.album_id <> e.favorites_album_id
        AND albums.event_id = cur_event_profile('event_id');
        
        CREATE OR REPLACE VIEW accessible_albums_images AS
        SELECT ali.*
        FROM albums_images ali
        INNER JOIN accessible_images ai ON ali.image_id = ai.image_id
        INNER JOIN albums_accessibility aa ON ali.album_id = aa.album_id
        WHERE
            aa.event_id = cur_event_profile('event_id')
            AND aa.profile_id = cur_profile('profile_id')
            AND aa.is_accessible;
        
        CREATE OR REPLACE VIEW accessible_albums_images_actual AS
        SELECT aia.*
        FROM albums_images_actual aia
        INNER JOIN accessible_images ai ON aia.image_id = ai.image_id
        INNER JOIN albums_accessibility aa ON aia.album_id = aa.album_id
        WHERE
            aa.event_id = cur_event_profile('event_id')
            AND aa.profile_id = cur_profile('profile_id')
            AND aa.is_accessible;
        
        CREATE OR REPLACE VIEW accessible_albums AS
        SELECT a.*,
        COUNT(ai.image_id) as images_count,
        COUNT(DISTINCT CASE WHEN NOT ai.is_archived THEN ai.image_id END) AS active_images_count
        FROM albums a
        INNER JOIN albums_accessibility aa ON a.album_id = aa.album_id
        LEFT JOIN (
            accessible_albums_images aai
            INNER JOIN accessible_images ai ON aai.image_id = ai.image_id
        ) ON aa.album_id = aai.album_id
        WHERE
            aa.event_id = cur_event_profile('event_id')
            AND aa.profile_id = cur_profile('profile_id')
            AND aa.is_accessible
        GROUP BY a.album_id, a.event_id, a.label, a.description, a.representative_image;

        -- uploads
        CREATE OR REPLACE VIEW uploads_details AS
        SELECT
            u.*,
            p.label AS profile_label
        FROM uploads u
        INNER JOIN profiles p ON u.profile_id = p.profile_id
        WHERE u.event_id = cur_event_profile('event_id');
        
        CREATE OR REPLACE VIEW accessible_uploads AS
        SELECT u.*
        FROM uploads_details u
        WHERE cur_event_profile_bool('can_upload_and_delete_images');
        
        CREATE OR REPLACE VIEW uploads_groups AS
        SELECT DISTINCT ON (u.upload_id, gi.group_id)
            u.*,
            gi.group_id as group_id
        FROM uploads u
        INNER JOIN images i ON u.upload_id = i.upload_id
        INNER JOIN groups_images gi ON i.image_id = gi.image_id
        WHERE u.event_id = cur_event_profile('event_id');
        
        CREATE OR REPLACE VIEW accessible_uploads_groups AS
        WITH upload_groups_stats AS (
            SELECT
                u.upload_id,
                f.group_id,
                COUNT(DISTINCT f.face_id) as group_upload_faces_count
            FROM accessible_uploads u
            INNER JOIN accessible_images i ON u.upload_id = i.upload_id
            INNER JOIN accessible_faces f ON i.image_id = f.image_id
            GROUP BY u.upload_id, f.group_id
        )
        SELECT
            u.*,
            ugs.group_id as group_id,
            g.faces_count as group_faces_count,
            ugs.group_upload_faces_count
        FROM accessible_uploads u
        INNER JOIN upload_groups_stats ugs ON u.upload_id = ugs.upload_id
        INNER JOIN accessible_groups g ON ugs.group_id = g.group_id;
        
        CREATE OR REPLACE VIEW uploads_moments AS
        SELECT DISTINCT ON (u.upload_id, m.moment_id)
            u.*,
            m.moment_id as moment_id
        FROM uploads u
        INNER JOIN images i ON u.upload_id = i.upload_id
        INNER JOIN moments m ON i.moment_id = m.moment_id
        WHERE u.event_id = cur_event_profile('event_id');
        
        CREATE OR REPLACE VIEW accessible_uploads_moments AS
        WITH upload_moments_stats AS (
            SELECT
                u.upload_id,
                i.moment_id,
                COUNT(DISTINCT i.image_id) as moment_upload_images_count
            FROM accessible_uploads u
            INNER JOIN accessible_images i ON u.upload_id = i.upload_id
            WHERE i.moment_id IS NOT NULL
            GROUP BY u.upload_id, i.moment_id
        )
        SELECT
            u.*,
            ums.moment_id as moment_id,
            m.images_count as moment_images_count,
            ums.moment_upload_images_count
        FROM accessible_uploads u
        INNER JOIN upload_moments_stats ums ON u.upload_id = ums.upload_id
        INNER JOIN accessible_moments m ON ums.moment_id = m.moment_id;
        
        CREATE OR REPLACE VIEW uploads_faces AS
        SELECT u.upload_id, f.face_id, f.group_id
        FROM uploads u
        INNER JOIN images i ON u.upload_id = i.upload_id
        INNER JOIN faces f ON i.image_id = f.image_id
        WHERE u.event_id = cur_event_profile('event_id');
        
        CREATE OR REPLACE VIEW accessible_uploads_faces AS
        SELECT u.upload_id, f.face_id, f.group_id
        FROM accessible_uploads u
        INNER JOIN accessible_images i ON u.upload_id = i.upload_id
        INNER JOIN accessible_faces f ON i.image_id = f.image_id;

        -- access requests
        CREATE OR REPLACE VIEW access_requests_groups_details AS
        SELECT arg.*,
        ga.is_accessible
        FROM access_requests_groups arg
        INNER JOIN groups_accessibility ga ON
            arg.group_id = ga.group_id
            AND ga.profile_id = cur_profile('profile_id')
            AND ga.event_id = cur_event_profile('event_id');
        
        CREATE OR REPLACE VIEW access_requests_details AS
        WITH request_stats AS (
            SELECT
                ar.access_request_id,
                COUNT(argd.group_id) AS groups_count,
                COUNT(argd.group_id) FILTER (WHERE argd.is_accessible) AS accessible_groups_count,
                COUNT(argd.group_id) FILTER (WHERE argd.approved IS TRUE) AS approved_groups_count,
                COUNT(argd.group_id) FILTER (WHERE argd.approved IS FALSE) AS rejected_groups_count,
                COUNT(argd.group_id) FILTER (WHERE argd.approved IS NULL) AS pending_groups_count
            FROM access_requests ar
            LEFT JOIN access_requests_groups_details argd ON ar.access_request_id = argd.access_request_id
            WHERE ar.event_id = cur_event_profile('event_id')
            GROUP BY ar.access_request_id
        )
        SELECT
            ar.*,
            p.label AS profile_label,
            rs.groups_count,
            rs.accessible_groups_count,
            rs.approved_groups_count,
            rs.rejected_groups_count,
            rs.pending_groups_count,
            CASE 
                WHEN NOT ar.is_closed THEN 'pending'
                ELSE 
                    CASE
                        WHEN rs.approved_groups_count = rs.groups_count AND rs.groups_count > 0 THEN 'approved'
                        WHEN rs.rejected_groups_count = rs.groups_count AND rs.groups_count > 0 THEN 'rejected'
                        ELSE 'mixed'
                    END
            END AS status
        FROM access_requests ar
        LEFT JOIN request_stats rs ON ar.access_request_id = rs.access_request_id
        LEFT JOIN profiles p ON p.profile_id = COALESCE(ar.applicant_profile_id, ar.profile_id)
        WHERE ar.event_id = cur_event_profile('event_id');
        
        CREATE OR REPLACE VIEW my_access_requests AS
        SELECT ard.*
        FROM access_requests_details ard
        WHERE ard.applicant_profile_id = cur_profile('profile_id');
        
        CREATE OR REPLACE VIEW accessible_my_access_requests AS
        SELECT mar.*
        FROM my_access_requests mar
        WHERE NOT cur_profile_bool('is_public');
        
        CREATE OR REPLACE VIEW my_access_requests_groups AS
        SELECT argd.*
        FROM access_requests_groups_details argd
        INNER JOIN my_access_requests mar ON argd.access_request_id = mar.access_request_id;
        
        CREATE OR REPLACE VIEW accessible_my_access_requests_groups AS
        SELECT marg.*
        FROM my_access_requests_groups marg
        INNER JOIN accessible_my_access_requests amar ON marg.access_request_id = amar.access_request_id;
        
        CREATE OR REPLACE VIEW accessible_access_requests AS
        SELECT ard.*
        FROM access_requests_details ard
        INNER JOIN accessible_profiles ap ON ard.profile_id = ap.profile_id
        WHERE ard.accessible_groups_count > 0 OR ard.groups_count = 0;
        
        CREATE OR REPLACE VIEW accessible_access_requests_groups AS
        SELECT ag.*
        FROM access_requests_groups ag
        INNER JOIN accessible_access_requests ar ON ag.access_request_id = ar.access_request_id
        INNER JOIN groups_accessibility ga ON
            ag.group_id = ga.group_id
            AND ga.profile_id = cur_profile('profile_id')
            AND ga.is_accessible
            AND ga.event_id = cur_event_profile('event_id');

        -- current_event_profile
        CREATE OR REPLACE VIEW current_event_profile AS
        SELECT
            ep.event_id,
            ep.profile_id,
            ep.can_manage_event,
            ep.can_delete_event,
            ep.can_upload_and_delete_images,
            ep.can_edit,
            ep.all_images,
            ep.all_groups,
            ep.all_albums,
            EXISTS (SELECT 1 FROM accessible_albums aa WHERE aa.album_id = e.archive_album_id) AS has_archive_album,
            EXISTS (SELECT 1 FROM accessible_albums aa WHERE aa.album_id = e.favorites_album_id) AS has_favorites_album,
            (ep.can_edit OR EXISTS (SELECT 1 FROM accessible_images)) AS has_images,
            (ep.can_edit OR EXISTS (SELECT 1 FROM accessible_groups)) AS has_groups,
            (ep.can_edit OR EXISTS (
                SELECT 1 FROM accessible_albums aa
                WHERE aa.album_id IS DISTINCT FROM e.archive_album_id
                AND aa.album_id IS DISTINCT FROM e.favorites_album_id
            )) AS has_albums,
            EXISTS (SELECT 1 FROM current_groups_to_request_access) AS enable_new_requests,
            (SELECT COUNT(*) FROM accessible_access_requests WHERE NOT is_closed) AS pending_access_requests_count
        FROM events_profiles ep
        JOIN events e ON e.event_id = ep.event_id
        WHERE ep.event_id = cur_event_profile('event_id')
        AND ep.profile_id = cur_profile('profile_id');
        """,
        """
        DROP VIEW IF EXISTS current_event_profile CASCADE;
        DROP VIEW IF EXISTS accessible_access_requests_groups CASCADE;
        DROP VIEW IF EXISTS accessible_access_requests CASCADE;
        DROP VIEW IF EXISTS accessible_my_access_requests_groups CASCADE;
        DROP VIEW IF EXISTS my_access_requests_groups CASCADE;
        DROP VIEW IF EXISTS accessible_my_access_requests CASCADE;
        DROP VIEW IF EXISTS my_access_requests CASCADE;
        DROP VIEW IF EXISTS access_requests_details CASCADE;
        DROP VIEW IF EXISTS access_requests_groups_details CASCADE;
        DROP VIEW IF EXISTS accessible_uploads_faces CASCADE;
        DROP VIEW IF EXISTS uploads_faces CASCADE;
        DROP VIEW IF EXISTS accessible_uploads_moments CASCADE;
        DROP VIEW IF EXISTS uploads_moments CASCADE;
        DROP VIEW IF EXISTS accessible_uploads_groups CASCADE;
        DROP VIEW IF EXISTS uploads_groups CASCADE;
        DROP VIEW IF EXISTS accessible_uploads CASCADE;
        DROP VIEW IF EXISTS uploads_details CASCADE;
        DROP VIEW IF EXISTS accessible_albums CASCADE;
        DROP VIEW IF EXISTS accessible_albums_images_actual CASCADE;
        DROP VIEW IF EXISTS accessible_albums_images CASCADE;
        DROP VIEW IF EXISTS albums_images_actual CASCADE;
        DROP VIEW IF EXISTS accessible_moments CASCADE;
        DROP VIEW IF EXISTS accessible_groups CASCADE;
        DROP VIEW IF EXISTS accessible_groups_images CASCADE;
        DROP VIEW IF EXISTS accessible_faces CASCADE;
        DROP VIEW IF EXISTS accessible_images CASCADE;
        DROP VIEW IF EXISTS accessible_events_profiles_albums CASCADE;
        DROP VIEW IF EXISTS accessible_events_profiles_groups CASCADE;
        DROP VIEW IF EXISTS accessible_events_profiles_images CASCADE;
        DROP VIEW IF EXISTS accessible_events_profiles CASCADE;
        DROP VIEW IF EXISTS current_profile CASCADE;
        DROP VIEW IF EXISTS current_groups_to_request_access CASCADE;
        DROP VIEW IF EXISTS current_profile_events CASCADE;
        DROP VIEW IF EXISTS accessible_feedbacks CASCADE;
        DROP VIEW IF EXISTS accessible_my_feedbacks CASCADE;
        DROP VIEW IF EXISTS my_feedbacks CASCADE;
        DROP VIEW IF EXISTS feedbacks_details CASCADE;
        DROP VIEW IF EXISTS accessible_notifications CASCADE;
        DROP VIEW IF EXISTS accessible_my_notifications CASCADE;
        DROP VIEW IF EXISTS my_notifications CASCADE;
        DROP VIEW IF EXISTS my_preferences CASCADE;
        DROP VIEW IF EXISTS accessible_profiles CASCADE;
        DROP VIEW IF EXISTS accessible_events CASCADE;
        DROP VIEW IF EXISTS albums_accessibility CASCADE;
        DROP VIEW IF EXISTS moments_accessibility CASCADE;
        DROP VIEW IF EXISTS groups_to_request_access CASCADE;
        DROP VIEW IF EXISTS groups_images CASCADE;
        DROP VIEW IF EXISTS groups_accessibility CASCADE;
        DROP VIEW IF EXISTS faces_accessibility CASCADE;
        DROP VIEW IF EXISTS groups_accessibility_base CASCADE;
        DROP VIEW IF EXISTS images_accessibility CASCADE;
        DROP VIEW IF EXISTS albums_accessibility_base CASCADE;
        DROP VIEW IF EXISTS images_accessibility_base CASCADE;
        DROP VIEW IF EXISTS accessible_rekognition_usaged CASCADE;
        DROP VIEW IF EXISTS accessible_settings CASCADE;
        """
    ),
]