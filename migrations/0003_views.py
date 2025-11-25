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
        CREATE OR REPLACE VIEW albums_def AS
        SELECT
            a.event_id,
            a.album_id,
            ep.profile_id,
            (
                (ep.all_albums AND pa.album_id IS NULL)
                OR (NOT ep.all_albums AND pa.album_id IS NOT NULL)
            ) AS is_accessible
        FROM albums a
        JOIN events_profiles ep ON a.event_id = ep.event_id
        LEFT JOIN profiles_albums pa ON 
            a.album_id = pa.album_id 
            AND ep.profile_id = pa.profile_id;

        CREATE OR REPLACE VIEW groups_def AS
        SELECT
            g.event_id,
            g.group_id,
            ep.profile_id,
            (
                (
                    (ep.all_groups AND pg.group_id IS NULL)
                    OR (NOT ep.all_groups AND pg.group_id IS NOT NULL)
                )
                AND (ep.can_edit OR g.group_id <> e.unassociated_group_id)
            ) AS is_accessible
        FROM groups g
        JOIN events e ON g.event_id = e.event_id
        JOIN events_profiles ep ON g.event_id = ep.event_id
        LEFT JOIN profiles_groups pg ON 
            g.group_id = pg.group_id 
            AND ep.profile_id = pg.profile_id;

        CREATE OR REPLACE VIEW images_def AS
        SELECT
            i.event_id,
            i.image_id,
            ep.profile_id,
            (
                (ep.all_images AND pi.image_id IS NULL)
                OR (NOT ep.all_images AND pi.image_id IS NOT NULL)
            ) AS is_accessible
        FROM images i
        JOIN events_profiles ep ON i.event_id = ep.event_id
        LEFT JOIN profiles_images pi ON 
            i.image_id = pi.image_id 
            AND ep.profile_id = pi.profile_id;

        CREATE OR REPLACE VIEW images_eff AS
        SELECT
            iab.event_id,
            iab.image_id,
            iab.profile_id,
            (iab.is_accessible AND COALESCE(aab.is_accessible, TRUE)) AS is_accessible
        FROM images_def iab
        INNER JOIN events e ON iab.event_id = e.event_id
        LEFT JOIN albums_images ai ON
            e.archive_album_id = ai.album_id
            AND ai.image_id = iab.image_id
            LEFT JOIN albums_def aab ON
            aab.album_id = ai.album_id
            AND aab.profile_id = iab.profile_id;
            
        CREATE OR REPLACE VIEW faces_eff AS
        SELECT
            ep.event_id,
            f.face_id,
            ep.profile_id,
            (ia.is_accessible AND gab.is_accessible) AS is_accessible
        FROM faces f
        INNER JOIN images i ON f.image_id = i.image_id
        JOIN events_profiles ep ON i.event_id = ep.event_id
        INNER JOIN images_eff ia ON f.image_id = ia.image_id AND ia.profile_id = ep.profile_id
        INNER JOIN groups_def gab ON f.group_id = gab.group_id AND gab.profile_id = ep.profile_id;
        
        CREATE OR REPLACE VIEW groups_eff AS
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
                        FROM faces_eff fa
                        INNER JOIN faces f ON fa.face_id = f.face_id
                        WHERE f.group_id = gab.group_id
                        AND fa.profile_id = gab.profile_id
                        AND fa.is_accessible
                    )
                )
            ) AS is_accessible
        FROM groups_def gab
        JOIN events_profiles ep ON gab.event_id = ep.event_id AND gab.profile_id = ep.profile_id;
        
        -- groups_images view
        CREATE OR REPLACE VIEW groups_images AS
        SELECT DISTINCT 
            f.image_id,
            f.group_id
        FROM faces f; 
       
        CREATE OR REPLACE VIEW moments_eff AS
        SELECT
            ep.event_id,
            m.moment_id,
            ep.profile_id,
            (
                ep.can_edit
                OR EXISTS (
                    SELECT 1
                    FROM images_eff ia
                    INNER JOIN images i ON i.image_id = ia.image_id
                    WHERE i.moment_id = m.moment_id
                    AND ia.profile_id = ep.profile_id
                    AND ia.is_accessible
                )
            ) AS is_accessible
        FROM moments m
        JOIN events_profiles ep ON m.event_id = ep.event_id;
        
        CREATE OR REPLACE VIEW albums_eff AS
        SELECT
            aab.event_id,
            aab.album_id,
            ep.profile_id,
            (
                aab.is_accessible
                AND (ep.can_edit OR EXISTS (
                    SELECT 1
                    FROM images_eff ia
                    INNER JOIN albums_images ai ON ai.image_id = ia.image_id
                    WHERE ai.album_id = aab.album_id
                    AND ia.profile_id = ep.profile_id
                    AND ia.is_accessible
                ))
            ) AS is_accessible
        FROM albums_def aab
        JOIN events_profiles ep ON aab.event_id = ep.event_id AND aab.profile_id = ep.profile_id;

        -- events
        CREATE OR REPLACE VIEW events_eff AS
        SELECT
            e.*,
            ep.profile_id,
            (ep.profile_id IS NOT NULL) AS is_accessible
        FROM events e
        LEFT JOIN events_profiles ep ON e.event_id = ep.event_id
        WHERE e.is_public OR ep.profile_id IS NOT NULL;
        
        CREATE OR REPLACE VIEW events_ctx AS
        SELECT
            ee.*
        FROM events_eff ee
        WHERE ee.profile_id = cur_profile_uuid('profile_id');
        
        CREATE OR REPLACE VIEW events_ext AS
        SELECT
            ec.*,
            CASE WHEN ep.can_manage_event THEN (
                SELECT COUNT(*)
                FROM images_eff ia
                WHERE ia.event_id = ec.event_id
                AND ia.profile_id = ec.profile_id
                AND ia.is_accessible
            ) ELSE 0 END AS images_count,
            CASE WHEN ep.can_manage_event THEN (
                SELECT SUM(i.file_size)
                FROM images_eff ia
                INNER JOIN images i ON i.image_id = ia.image_id
                WHERE ia.event_id = ec.event_id
                AND ia.profile_id = ec.profile_id
                AND ia.is_accessible
            ) ELSE 0 END AS total_original_size,
            CASE WHEN ep.can_manage_event THEN (
                SELECT SUM(i.high_quality_file_size)
                FROM images_eff ia
                INNER JOIN images i ON i.image_id = ia.image_id
                WHERE ia.event_id = ec.event_id
                AND ia.profile_id = ec.profile_id
                AND ia.is_accessible
            ) ELSE 0 END AS total_high_quality_size,
            CASE WHEN ep.can_manage_event THEN ((
                SELECT SUM(i.file_size + i.high_quality_file_size + i.display_file_size + i.thumb_file_size)
                FROM images_eff ia
                INNER JOIN images i ON i.image_id = ia.image_id
                WHERE ia.event_id = ec.event_id
                AND ia.profile_id = ec.profile_id
                AND ia.is_accessible
            ) + (
                SELECT SUM(f.file_size)
                FROM faces_eff fa
                INNER JOIN faces f ON f.face_id = fa.face_id
                WHERE fa.event_id = ec.event_id
                AND fa.profile_id = ec.profile_id
                AND fa.is_accessible
            )) ELSE 0 END AS total_size,
            CASE WHEN ep.can_manage_event THEN (
                SELECT MAX(i.file_size)
                FROM images_eff ia
                INNER JOIN images i ON i.image_id = ia.image_id
                WHERE ia.event_id = ec.event_id
                AND ia.profile_id = ec.profile_id
                AND ia.is_accessible
            ) ELSE 0 END AS max_image_size,
            CASE WHEN ep.can_manage_event THEN (
                SELECT COUNT(*)
                FROM faces_eff fa
                WHERE fa.event_id = ec.event_id
                AND fa.profile_id = ec.profile_id
                AND fa.is_accessible
            ) ELSE 0 END AS faces_count,
            CASE WHEN ep.can_manage_event THEN (
                SELECT COUNT(*)
                FROM albums_eff aa
                WHERE aa.event_id = ec.event_id
                AND aa.profile_id = ec.profile_id
                AND aa.is_accessible
            ) ELSE 0 END AS albums_count,
            CASE WHEN ep.can_manage_event THEN (
                SELECT COUNT(*)
                FROM moments_eff ma
                WHERE ma.event_id = ec.event_id
                AND ma.profile_id = ec.profile_id
                AND ma.is_accessible
            ) ELSE 0 END AS moments_count
        FROM events_ctx ec
        LEFT JOIN events_profiles ep ON
            ec.event_id = ep.event_id
            AND ec.profile_id = ep.profile_id;
        

        -- profiles
        CREATE OR REPLACE VIEW profiles_eff AS
        SELECT
            p.*,
            cur_profile_int('hierarchy_rank') AS viewer_hierarchy_rank,
            cur_profile_uuid('profile_id') AS viewer_profile_id,
            (p.hierarchy_rank < cur_profile_int('hierarchy_rank')) AS is_accessible,
            cur_profile_uuid('restricted_to_event') AS viewer_restricted_to_event
        FROM profiles p;
        
        CREATE OR REPLACE VIEW profiles_ctx AS
        SELECT
            pe.*,
            ae.name AS restricted_to_event_name,
            (
                pe.viewer_restricted_to_event IS NULL
                OR pe.viewer_restricted_to_event = COALESCE(pe.restricted_to_event, '')
            ) AS is_editable,
            (pe.public_access_code IS NOT NULL) AS has_public_access_code
        FROM profiles_eff pe
        LEFT JOIN events_ext ae ON pe.restricted_to_event = ae.event_id
        WHERE pe.is_accessible
        AND (
            pe.restricted_to_event IS NULL 
            OR pe.restricted_to_event IN (
                SELECT event_id
                FROM events_profiles ep
                WHERE ep.profile_id = pe.viewer_profile_id
            )
        );
        
        CREATE OR REPLACE VIEW profiles_ext AS
        SELECT * FROM profiles_ctx;
        
        CREATE OR REPLACE VIEW my_preferences AS
        SELECT
            pp.*,
            dp.value_type
        FROM profiles_preferences pp
        INNER JOIN default_preferences dp
        ON pp.preference_group = dp.preference_group
        AND pp.preference_key = dp.preference_key
        WHERE pp.profile_id = cur_profile_uuid('profile_id');

        -- notifications
        CREATE OR REPLACE VIEW my_notifications AS
        SELECT * FROM notifications
        WHERE profile_id = cur_profile_uuid('profile_id');

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
        WHERE profile_id = cur_profile_uuid('profile_id');
        
        CREATE OR REPLACE VIEW feedbacks_eff AS
        SELECT
            fd.*,
            cur_profile_bool('is_developer') AS is_accessible
        FROM feedbacks_details fd;
        
        CREATE OR REPLACE VIEW feedbacks_ctx AS
        SELECT
            fe.*,
            p.label AS closed_by_label
        FROM feedbacks_eff fe
        LEFT JOIN profiles p ON fe.closed_by = p.profile_id
        WHERE fe.is_accessible;
        
        CREATE OR REPLACE VIEW feedbacks_ext AS
        SELECT * FROM feedbacks_ctx;

        -- event profiles
        CREATE OR REPLACE VIEW events_profiles_eff AS
        SELECT
            ep.*,
            p.hierarchy_rank AS profile_hierarchy_rank,
            cur_profile_int('hierarchy_rank') AS viewer_hierarchy_rank,
            (p.hierarchy_rank < cur_profile_int('hierarchy_rank')) AS is_accessible
        FROM events_profiles ep
        INNER JOIN profiles p ON ep.profile_id = p.profile_id;
        
        CREATE OR REPLACE VIEW events_profiles_ctx AS
        SELECT
            epe.*
        FROM events_profiles_eff epe
        INNER JOIN events_ext ae ON epe.event_id = ae.event_id
        WHERE epe.is_accessible;
        
        CREATE OR REPLACE VIEW events_profiles_ext AS
        SELECT * FROM events_profiles_ctx;
        
        CREATE OR REPLACE VIEW profiles_images_ctx AS
        SELECT pi.*
        FROM profiles_images pi
        INNER JOIN events_profiles_ctx aep
        ON pi.profile_id = aep.profile_id
        INNER JOIN images i ON pi.image_id = i.image_id
        WHERE i.event_id = cur_event_profile_uuid('event_id');
        
        CREATE OR REPLACE VIEW profiles_groups_ctx AS
        SELECT pg.*
        FROM profiles_groups pg
        INNER JOIN events_profiles_ctx aep
        ON pg.profile_id = aep.profile_id
        INNER JOIN groups g ON pg.group_id = g.group_id
        WHERE g.event_id = cur_event_profile_uuid('event_id');
        
        CREATE OR REPLACE VIEW profiles_albums_ctx AS
        SELECT pa.*
        FROM profiles_albums pa
        INNER JOIN events_profiles_ctx aep
        ON pa.profile_id = aep.profile_id
        INNER JOIN albums a ON pa.album_id = a.album_id
        WHERE a.event_id = cur_event_profile_uuid('event_id');

        -- images
        CREATE OR REPLACE VIEW images_ctx AS
        SELECT
            i.*,
            (ai1.image_id IS NOT NULL) AS is_archived,
            (ai2.image_id IS NOT NULL) AS is_favorite
        FROM images i
        INNER JOIN images_eff ia ON i.image_id = ia.image_id
        INNER JOIN events e ON e.event_id = ia.event_id
        LEFT JOIN (
            albums_def aa1
            INNER JOIN albums_images ai1 ON
                aa1.album_id = ai1.album_id
                AND aa1.is_accessible
        ) ON
            ai1.image_id = ia.image_id
            AND aa1.profile_id = ia.profile_id
            AND aa1.album_id = e.archive_album_id
        LEFT JOIN (
            albums_def aa2
            INNER JOIN albums_images ai2 ON
                aa2.album_id = ai2.album_id
                AND aa2.is_accessible
        ) ON
            ai2.image_id = ia.image_id
            AND aa2.profile_id = ia.profile_id
            AND aa2.album_id = e.favorites_album_id
        WHERE
            ia.event_id = cur_event_profile_uuid('event_id')
            AND ia.profile_id = cur_profile_uuid('profile_id')
            AND ia.is_accessible;
        
        CREATE OR REPLACE VIEW images_ext AS
        SELECT * FROM images_ctx;
        

        -- faces
        CREATE OR REPLACE VIEW faces_ctx AS
        SELECT
            f.*,
            i.upload_id
        FROM faces f 
        INNER JOIN images i ON f.image_id = i.image_id
        INNER JOIN faces_eff fa ON
            f.face_id = fa.face_id
            AND fa.profile_id = cur_profile_uuid('profile_id')
            AND fa.is_accessible
            AND fa.event_id = cur_event_profile_uuid('event_id')
            AND fa.is_accessible;
        
        CREATE OR REPLACE VIEW faces_ext AS
        SELECT * FROM faces_ctx;
        

        -- groups (groups_images view already created above)
        CREATE OR REPLACE VIEW accessible_groups_images AS
        SELECT DISTINCT ON (ai.image_id, af.group_id)
            ai.image_id as image_id,
            af.group_id as group_id
        FROM images_ctx ai
        INNER JOIN faces_ctx af ON ai.image_id = af.image_id
        INNER JOIN groups_ctx ga ON
            af.group_id = ga.group_id;
        
        CREATE OR REPLACE VIEW groups_ctx AS
        SELECT 
            g.*,
            rf.image_id as representative_image
        FROM groups g
        LEFT JOIN faces rf ON g.representative_face = rf.face_id
        INNER JOIN groups_eff ga ON
            g.group_id = ga.group_id
            AND ga.profile_id = cur_profile_uuid('profile_id')
            AND ga.is_accessible
            AND ga.event_id = cur_event_profile_uuid('event_id');
        
        CREATE OR REPLACE VIEW groups_ext AS
        WITH group_faces_stats AS (
            SELECT 
                af.group_id,
                COUNT(DISTINCT af.face_id) AS faces_count
            FROM faces_ctx af
            GROUP BY af.group_id
        ),
        group_images_stats AS (
            SELECT 
                agi.group_id,
                COUNT(DISTINCT agi.image_id) AS images_count,
                COUNT(DISTINCT CASE WHEN NOT ai.is_archived THEN agi.image_id END) AS active_images_count
            FROM accessible_groups_images agi
            INNER JOIN images_ctx ai ON agi.image_id = ai.image_id
            GROUP BY agi.group_id
        )
        SELECT 
            gc.*,
            COALESCE(gfs.faces_count, 0) AS faces_count,
            COALESCE(gis.images_count, 0) AS images_count,
            COALESCE(gis.active_images_count, 0) AS active_images_count
        FROM groups_ctx gc
        LEFT JOIN group_faces_stats gfs ON gc.group_id = gfs.group_id
        LEFT JOIN group_images_stats gis ON gc.group_id = gis.group_id;
        

        -- moments
        CREATE OR REPLACE VIEW moments_ctx AS
        SELECT
            m.*
        FROM moments m
        INNER JOIN moments_eff ma ON
            m.moment_id = ma.moment_id
            AND ma.event_id = cur_event_profile_uuid('event_id')
            AND ma.profile_id = cur_profile_uuid('profile_id')
            AND ma.is_accessible;
        
        CREATE OR REPLACE VIEW moments_ext AS
        WITH moments_stats AS (
            SELECT
                mc.moment_id,
                COUNT(ai.image_id) as images_count,
                COUNT(DISTINCT CASE WHEN NOT ai.is_archived THEN ai.image_id END) AS active_images_count
            FROM moments_ctx mc
            LEFT JOIN images_ctx ai ON mc.moment_id = ai.moment_id
            GROUP BY mc.moment_id
        )
        SELECT
            mc.*,
            ms.images_count,
            ms.active_images_count
        FROM moments_ctx mc
        INNER JOIN moments_stats ms ON mc.moment_id = ms.moment_id;
        

        -- albums
        CREATE OR REPLACE VIEW albums_images_actual AS
        SELECT albums_images.*
        FROM albums_images
        INNER JOIN albums ON albums_images.album_id = albums.album_id
        INNER JOIN events e ON albums.event_id = e.event_id
        WHERE albums.album_id <> e.archive_album_id AND albums.album_id <> e.favorites_album_id
        AND albums.event_id = cur_event_profile_uuid('event_id');
        
        CREATE OR REPLACE VIEW accessible_albums_images AS
        SELECT ali.*
        FROM albums_images ali
        INNER JOIN images_ctx ai ON ali.image_id = ai.image_id
        INNER JOIN albums_ctx aa ON ali.album_id = aa.album_id;
        
        CREATE OR REPLACE VIEW accessible_albums_images_actual AS
        SELECT aia.*
        FROM albums_images_actual aia
        INNER JOIN images_ctx ai ON aia.image_id = ai.image_id
        INNER JOIN albums_ctx aa ON aia.album_id = aa.album_id;
        
        CREATE OR REPLACE VIEW albums_ctx AS
        SELECT a.*
        FROM albums a
        INNER JOIN albums_eff aa ON a.album_id = aa.album_id
        WHERE
            aa.event_id = cur_event_profile_uuid('event_id')
            AND aa.profile_id = cur_profile_uuid('profile_id')
            AND aa.is_accessible;
        
        CREATE OR REPLACE VIEW albums_ext AS
        SELECT 
            ac.*,
            COUNT(ai.image_id) as images_count,
            COUNT(DISTINCT CASE WHEN NOT ai.is_archived THEN ai.image_id END) AS active_images_count
        FROM albums_ctx ac
        LEFT JOIN (
            accessible_albums_images aai
            INNER JOIN images_ctx ai ON aai.image_id = ai.image_id
        ) ON ac.album_id = aai.album_id
        GROUP BY ac.album_id, ac.event_id, ac.label, ac.description, ac.representative_image;
        

        -- uploads
        CREATE OR REPLACE VIEW uploads_details AS
        SELECT
            u.*,
            p.label AS profile_label
        FROM uploads u
        INNER JOIN profiles p ON u.profile_id = p.profile_id
        WHERE u.event_id = cur_event_profile_uuid('event_id');
        
        CREATE OR REPLACE VIEW uploads_ctx AS
        SELECT u.*
        FROM uploads_details u
        WHERE cur_event_profile_bool('can_upload_and_delete_images');
        
        CREATE OR REPLACE VIEW uploads_ext AS
        SELECT * FROM uploads_ctx;
        
        CREATE OR REPLACE VIEW uploads_groups AS
        SELECT DISTINCT ON (u.upload_id, gi.group_id)
            u.*,
            gi.group_id as group_id
        FROM uploads u
        INNER JOIN images i ON u.upload_id = i.upload_id
        INNER JOIN groups_images gi ON i.image_id = gi.image_id
        WHERE u.event_id = cur_event_profile_uuid('event_id');
        
        CREATE OR REPLACE VIEW uploads_groups_ctx AS
        SELECT DISTINCT ON (u.upload_id, gi.group_id)
            u.*,
            gi.group_id as group_id
        FROM uploads_ctx u
        INNER JOIN images_ctx i ON u.upload_id = i.upload_id
        INNER JOIN groups_images gi ON i.image_id = gi.image_id;
        
        CREATE OR REPLACE VIEW uploads_groups_ext AS
        WITH upload_groups_stats AS (
            SELECT
                u.upload_id,
                f.group_id,
                COUNT(DISTINCT f.face_id) as group_upload_faces_count
            FROM uploads_ctx u
            INNER JOIN images_ctx i ON u.upload_id = i.upload_id
            INNER JOIN faces_ctx f ON i.image_id = f.image_id
            GROUP BY u.upload_id, f.group_id
        )
        SELECT
            ugc.*,
            g.faces_count as group_faces_count,
            ugs.group_upload_faces_count
        FROM uploads_groups_ctx ugc
        INNER JOIN upload_groups_stats ugs ON ugc.upload_id = ugs.upload_id AND ugc.group_id = ugs.group_id
        INNER JOIN groups_ext g ON ugc.group_id = g.group_id;
        
        CREATE OR REPLACE VIEW uploads_moments AS
        SELECT DISTINCT ON (u.upload_id, m.moment_id)
            u.*,
            m.moment_id as moment_id
        FROM uploads u
        INNER JOIN images i ON u.upload_id = i.upload_id
        INNER JOIN moments m ON i.moment_id = m.moment_id
        WHERE u.event_id = cur_event_profile_uuid('event_id');
        
        CREATE OR REPLACE VIEW uploads_moments_ctx AS
        SELECT DISTINCT ON (u.upload_id, m.moment_id)
            u.*,
            m.moment_id as moment_id
        FROM uploads_ctx u
        INNER JOIN images_ctx i ON u.upload_id = i.upload_id
        INNER JOIN moments_ctx m ON i.moment_id = m.moment_id;
        
        CREATE OR REPLACE VIEW uploads_moments_ext AS
        WITH upload_moments_stats AS (
            SELECT
                u.upload_id,
                i.moment_id,
                COUNT(DISTINCT i.image_id) as moment_upload_images_count
            FROM uploads_ctx u
            INNER JOIN images_ctx i ON u.upload_id = i.upload_id
            WHERE i.moment_id IS NOT NULL
            GROUP BY u.upload_id, i.moment_id
        )
        SELECT
            umc.*,
            m.images_count as moment_images_count,
            ums.moment_upload_images_count
        FROM uploads_moments_ctx umc
        INNER JOIN upload_moments_stats ums ON umc.upload_id = ums.upload_id AND umc.moment_id = ums.moment_id
        INNER JOIN moments_ext m ON umc.moment_id = m.moment_id;
        
        CREATE OR REPLACE VIEW uploads_faces AS
        SELECT u.upload_id, f.face_id, f.group_id
        FROM uploads u
        INNER JOIN images i ON u.upload_id = i.upload_id
        INNER JOIN faces f ON i.image_id = f.image_id
        WHERE u.event_id = cur_event_profile_uuid('event_id');
        
        CREATE OR REPLACE VIEW uploads_faces_ctx AS
        SELECT u.upload_id, f.face_id, f.group_id
        FROM uploads_ctx u
        INNER JOIN images_ctx i ON u.upload_id = i.upload_id
        INNER JOIN faces_ctx f ON i.image_id = f.image_id;
        
        CREATE OR REPLACE VIEW uploads_faces_ext AS
        SELECT * FROM uploads_faces_ctx;

        -- access requests
        CREATE OR REPLACE VIEW access_requests_groups_details AS
        SELECT arg.*,
        ga.is_accessible
        FROM access_requests_groups arg
        INNER JOIN groups_eff ga ON
            arg.group_id = ga.group_id
            AND ga.profile_id = cur_profile_uuid('profile_id')
            AND ga.event_id = cur_event_profile_uuid('event_id');
        
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
            WHERE ar.event_id = cur_event_profile_uuid('event_id')
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
        WHERE ar.event_id = cur_event_profile_uuid('event_id');
        
        CREATE OR REPLACE VIEW my_access_requests AS
        SELECT ard.*
        FROM access_requests_details ard
        WHERE ard.applicant_profile_id = cur_profile_uuid('profile_id');
        
        CREATE OR REPLACE VIEW my_access_requests_groups AS
        SELECT argd.*
        FROM access_requests_groups_details argd
        INNER JOIN my_access_requests mar ON argd.access_request_id = mar.access_request_id;
        
        CREATE OR REPLACE VIEW access_requests_ctx AS
        SELECT ard.*
        FROM access_requests_details ard
        INNER JOIN profiles_ext ap ON ard.profile_id = ap.profile_id
        WHERE ard.accessible_groups_count > 0 OR ard.groups_count = 0;
        
        CREATE OR REPLACE VIEW access_requests_ext AS
        SELECT * FROM access_requests_ctx;
        
        CREATE OR REPLACE VIEW access_requests_groups_ctx AS
        SELECT ag.*
        FROM access_requests_groups ag
        INNER JOIN access_requests_ctx ar ON ag.access_request_id = ar.access_request_id
        INNER JOIN groups_ctx ga ON
            ag.group_id = ga.group_id;
        
        CREATE OR REPLACE VIEW access_requests_groups_ext AS
        SELECT * FROM access_requests_groups_ctx;

        -- current profile views
        CREATE OR REPLACE VIEW current_groups_to_request_access AS
        SELECT
            gab.group_id
        FROM groups_def gab
        WHERE NOT gab.is_accessible
        AND gab.event_id = cur_event_profile_uuid('event_id')
        AND gab.profile_id = cur_profile_uuid('profile_id')
        AND EXISTS (
            SELECT 1
            FROM groups_images gi
            INNER JOIN images_ctx ia ON
                gi.image_id = ia.image_id
            WHERE gi.group_id = gab.group_id
        );
        
        CREATE OR REPLACE VIEW current_profile_events AS
        SELECT
            ep.profile_id,
            ep.event_id,
            ep.can_manage_event,
            ep.can_delete_event
        FROM events_profiles ep
        WHERE ep.profile_id = cur_profile_uuid('profile_id');
        
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
            (SELECT COUNT(*) FROM feedbacks_ctx WHERE NOT is_closed) AS pending_feedbacks,
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
        WHERE p.profile_id = cur_profile_uuid('profile_id')
        GROUP BY p.profile_id;
        
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
            EXISTS (SELECT 1 FROM albums_ctx aa WHERE aa.album_id = e.archive_album_id) AS has_archive_album,
            EXISTS (SELECT 1 FROM albums_ctx aa WHERE aa.album_id = e.favorites_album_id) AS has_favorites_album,
            (ep.can_edit OR EXISTS (SELECT 1 FROM images_ctx)) AS has_images,
            (ep.can_edit OR EXISTS (SELECT 1 FROM groups_ctx)) AS has_groups,
            (ep.can_edit OR EXISTS (
                SELECT 1 FROM albums_ctx
                WHERE album_id IS DISTINCT FROM e.archive_album_id
                AND album_id IS DISTINCT FROM e.favorites_album_id
            )) AS has_albums,
            EXISTS (SELECT 1 FROM current_groups_to_request_access) AS enable_new_requests,
            (SELECT COUNT(*) FROM access_requests_ctx WHERE NOT is_closed) AS pending_access_requests_count
        FROM events_profiles ep
        JOIN events e ON e.event_id = ep.event_id
        WHERE ep.event_id = cur_event_profile_uuid('event_id')
        AND ep.profile_id = cur_profile_uuid('profile_id');
        """,
        """
        DROP VIEW IF EXISTS current_event_profile CASCADE;
        DROP VIEW IF EXISTS access_requests_groups_ext CASCADE;
        DROP VIEW IF EXISTS access_requests_groups_ctx CASCADE;
        DROP VIEW IF EXISTS access_requests_ext CASCADE;
        DROP VIEW IF EXISTS access_requests_ctx CASCADE;
        DROP VIEW IF EXISTS my_access_requests_groups CASCADE;
        DROP VIEW IF EXISTS my_access_requests CASCADE;
        DROP VIEW IF EXISTS access_requests_details CASCADE;
        DROP VIEW IF EXISTS access_requests_groups_details CASCADE;
        DROP VIEW IF EXISTS uploads_faces_ext CASCADE;
        DROP VIEW IF EXISTS uploads_faces_ctx CASCADE;
        DROP VIEW IF EXISTS uploads_faces CASCADE;
        DROP VIEW IF EXISTS uploads_moments_ext CASCADE;
        DROP VIEW IF EXISTS uploads_moments_ctx CASCADE;
        DROP VIEW IF EXISTS uploads_moments CASCADE;
        DROP VIEW IF EXISTS uploads_groups_ext CASCADE;
        DROP VIEW IF EXISTS uploads_groups_ctx CASCADE;
        DROP VIEW IF EXISTS uploads_groups CASCADE;
        DROP VIEW IF EXISTS uploads_ext CASCADE;
        DROP VIEW IF EXISTS uploads_ctx CASCADE;
        DROP VIEW IF EXISTS uploads_details CASCADE;
        DROP VIEW IF EXISTS albums_ext CASCADE;
        DROP VIEW IF EXISTS albums_ctx CASCADE;
        DROP VIEW IF EXISTS accessible_albums_images_actual CASCADE;
        DROP VIEW IF EXISTS accessible_albums_images CASCADE;
        DROP VIEW IF EXISTS albums_images_actual CASCADE;
        DROP VIEW IF EXISTS moments_ext CASCADE;
        DROP VIEW IF EXISTS moments_ctx CASCADE;
        DROP VIEW IF EXISTS groups_ext CASCADE;
        DROP VIEW IF EXISTS groups_ctx CASCADE;
        DROP VIEW IF EXISTS accessible_groups_images CASCADE;
        DROP VIEW IF EXISTS faces_ext CASCADE;
        DROP VIEW IF EXISTS faces_ctx CASCADE;
        DROP VIEW IF EXISTS images_ext CASCADE;
        DROP VIEW IF EXISTS images_ctx CASCADE;
        DROP VIEW IF EXISTS profiles_albums_ctx CASCADE;
        DROP VIEW IF EXISTS profiles_groups_ctx CASCADE;
        DROP VIEW IF EXISTS profiles_images_ctx CASCADE;
        DROP VIEW IF EXISTS events_profiles_ext CASCADE;
        DROP VIEW IF EXISTS events_profiles_ctx CASCADE;
        DROP VIEW IF EXISTS events_profiles_eff CASCADE;
        DROP VIEW IF EXISTS current_event_profile CASCADE;
        DROP VIEW IF EXISTS current_profile CASCADE;
        DROP VIEW IF EXISTS current_profile_events CASCADE;
        DROP VIEW IF EXISTS current_groups_to_request_access CASCADE;
        DROP VIEW IF EXISTS feedbacks_ext CASCADE;
        DROP VIEW IF EXISTS feedbacks_ctx CASCADE;
        DROP VIEW IF EXISTS feedbacks_eff CASCADE;
        DROP VIEW IF EXISTS my_feedbacks CASCADE;
        DROP VIEW IF EXISTS feedbacks_details CASCADE;
        DROP VIEW IF EXISTS my_notifications CASCADE;
        DROP VIEW IF EXISTS my_preferences CASCADE;
        DROP VIEW IF EXISTS profiles_ext CASCADE;
        DROP VIEW IF EXISTS profiles_ctx CASCADE;
        DROP VIEW IF EXISTS profiles_eff CASCADE;
        DROP VIEW IF EXISTS events_ext CASCADE;
        DROP VIEW IF EXISTS events_ext CASCADE;
        DROP VIEW IF EXISTS events_ctx CASCADE;
        DROP VIEW IF EXISTS events_eff CASCADE;
        DROP VIEW IF EXISTS albums_eff CASCADE;
        DROP VIEW IF EXISTS moments_eff CASCADE;
        DROP VIEW IF EXISTS groups_images CASCADE;
        DROP VIEW IF EXISTS groups_eff CASCADE;
        DROP VIEW IF EXISTS faces_eff CASCADE;
        DROP VIEW IF EXISTS groups_def CASCADE;
        DROP VIEW IF EXISTS images_eff CASCADE;
        DROP VIEW IF EXISTS albums_def CASCADE;
        DROP VIEW IF EXISTS images_def CASCADE;
        DROP VIEW IF EXISTS accessible_rekognition_usaged CASCADE;
        DROP VIEW IF EXISTS accessible_settings CASCADE;
        """
    ),
]