"""
PostgreSQL views migration.
Creates all database views for access control and data aggregation.
"""

from yoyo import step

__depends__ = {'0002_functions'}

steps = [
    step(
        """
        -- refresh_tokens
        
        CREATE OR REPLACE VIEW refresh_tokens_ctx AS
        SELECT rt.*
        FROM refresh_tokens rt;
        
        -- settings
        
        CREATE OR REPLACE VIEW settings_ctx AS
        SELECT
            s.*
        FROM settings s
        WHERE s.id = 1
        AND cur_profile_bool('is_developer');

        CREATE OR REPLACE VIEW settings_ext AS
        SELECT
            sc.*
        FROM settings_ctx sc;

        -- rekognition usage
        
        CREATE OR REPLACE VIEW rekognition_usaged_ctx AS
        SELECT
            ru.*
        FROM rekognition_usaged ru
        JOIN settings s ON s.id = 1
        WHERE cur_profile_bool('is_developer');

        CREATE OR REPLACE VIEW rekognition_usaged_ext AS
        SELECT
            ruc.*
        FROM rekognition_usaged_ctx ruc;

        -- errors
        
        CREATE OR REPLACE VIEW errors_ctx AS
        SELECT
            e.*
        FROM errors e
        WHERE cur_profile_bool('is_developer');

        CREATE OR REPLACE VIEW errors_ext AS
        SELECT
            ec.*
        FROM errors_ctx ec;

        -- audit_logs
        
        CREATE OR REPLACE VIEW audit_logs_ctx AS
        SELECT
            al.*
        FROM audit_logs al
        WHERE cur_profile_bool('is_developer');

        CREATE OR REPLACE VIEW audit_logs_ext AS
        SELECT
            alc.*,
            p.label AS actor_profile_label
        FROM audit_logs_ctx alc
        LEFT JOIN profiles p ON alc.actor_profile_id = p.profile_id;

        -- profiles
        
        CREATE OR REPLACE VIEW profiles_ctx AS
        SELECT
            p.*,
            (
                cur_profile_uuid('restricted_to_event') IS NULL
                OR p.restricted_to_event IS NOT NULL
            ) AS is_editable
        FROM profiles p
        LEFT JOIN events_profiles cur_in_p_rest ON
            cur_in_p_rest.event_id = p.restricted_to_event
            AND cur_in_p_rest.profile_id = cur_profile_uuid('profile_id')
        LEFT JOIN events_profiles p_in_cur_rest ON
            p_in_cur_rest.event_id = cur_profile_uuid('restricted_to_event')
            AND p_in_cur_rest.profile_id = p.profile_id
        WHERE
            p.hierarchy_rank < cur_profile_int('hierarchy_rank')
            AND (
                p.restricted_to_event IS NOT DISTINCT FROM cur_profile_uuid('restricted_to_event')
                OR cur_in_p_rest.profile_id IS NOT NULL
                OR p_in_cur_rest.profile_id IS NOT NULL
            );
        
        CREATE OR REPLACE VIEW profiles_ext AS
        SELECT
            pc.*,
            e.name AS restricted_to_event_name,
            (pc.public_access_code IS NOT NULL) AS has_public_access_code
        FROM profiles_ctx pc
        LEFT JOIN events e ON pc.restricted_to_event = e.event_id;
        
        CREATE OR REPLACE VIEW my_preferences AS
        SELECT
            pp.*,
            dp.value_type
        FROM profiles_preferences pp
        INNER JOIN default_preferences dp
        ON pp.preference_group = dp.preference_group
        AND pp.preference_key = dp.preference_key
        WHERE pp.profile_id = cur_profile_uuid('profile_id');

        CREATE OR REPLACE VIEW my_preferences_ctx AS
        SELECT * FROM my_preferences;

        -- notifications
        
        CREATE OR REPLACE VIEW my_notifications_ctx AS
        SELECT n.* FROM notifications n
        WHERE n.profile_id = cur_profile_uuid('profile_id');

        CREATE OR REPLACE VIEW my_notifications_ext AS
        SELECT mnc.* FROM my_notifications_ctx mnc;

        -- feedbacks
        
        CREATE OR REPLACE VIEW feedbacks_details AS
        SELECT
            fe.feedback_id,
            fe.profile_id,
            p1.label AS profile_label,
            p1.is_public AS profile_is_public,
            CASE WHEN p1.is_public THEN fe.sender_name ELSE p1.label END AS sender_name,
            CASE WHEN p1.is_public THEN fe.sender_email ELSE p1.email END AS sender_email,
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
            p2.label AS closed_by_label,
            fe.closed_details,
            fe.error_ids
        FROM feedbacks fe
        LEFT JOIN profiles p1 ON fe.profile_id = p1.profile_id
        LEFT JOIN profiles p2 ON fe.closed_by = p2.profile_id;
        
        CREATE OR REPLACE VIEW my_feedbacks_ctx AS
        SELECT f.*
        FROM feedbacks f
        WHERE f.profile_id = cur_profile_uuid('profile_id')
        AND NOT cur_profile_bool('is_public');

        CREATE OR REPLACE VIEW my_feedbacks_ext AS
        SELECT
            fd.*
        FROM my_feedbacks_ctx mfc
        INNER JOIN feedbacks_details fd ON mfc.feedback_id = fd.feedback_id;
        
        CREATE OR REPLACE VIEW feedbacks_ctx AS
        SELECT
            f.*
        FROM feedbacks f
        WHERE cur_profile_bool('is_developer');
        
        CREATE OR REPLACE VIEW feedbacks_ext AS
        SELECT
            fd.*
        FROM feedbacks_details fd
        INNER JOIN feedbacks_ctx fc ON fd.feedback_id = fc.feedback_id;

        -- specific event views

        CREATE OR REPLACE VIEW images_default_albums AS
        SELECT
            i.image_id,
            (ai_arc.image_id IS NOT NULL) AS is_archived,
            (ai_fav.image_id IS NOT NULL) AS is_favorite
        FROM images i
        INNER JOIN events e ON i.event_id = e.event_id
        LEFT JOIN albums_images ai_arc ON
            e.archive_album_id = ai_arc.album_id
            AND ai_arc.image_id = i.image_id
        LEFT JOIN albums_images ai_fav ON
            e.favorites_album_id = ai_fav.album_id
            AND ai_fav.image_id = i.image_id;

        CREATE OR REPLACE VIEW groups_images AS
        SELECT DISTINCT 
            f.group_id,
            f.image_id
        FROM faces f; 
       
        CREATE OR REPLACE VIEW albums_images_actual AS
        SELECT ai.*
        FROM albums_images ai
        INNER JOIN albums a ON ai.album_id = a.album_id
        INNER JOIN events e ON a.event_id = e.event_id
        WHERE
            a.album_id <> e.archive_album_id
            AND a.album_id <> e.favorites_album_id;
        
        CREATE OR REPLACE VIEW uploads_moments AS
        SELECT DISTINCT
            u.upload_id,
            i.moment_id
        FROM uploads u
        INNER JOIN images i ON u.upload_id = i.upload_id
        INNER JOIN moments m ON i.moment_id = m.moment_id;
        
        CREATE OR REPLACE VIEW uploads_groups AS
        SELECT DISTINCT
            u.upload_id,
            f.group_id
        FROM uploads u
        INNER JOIN images i ON u.upload_id = i.upload_id
        INNER JOIN faces f ON i.image_id = f.image_id;
        
        CREATE OR REPLACE VIEW uploads_faces AS
        SELECT
            u.upload_id,
            f.face_id
        FROM uploads u
        INNER JOIN images i ON u.upload_id = i.upload_id
        INNER JOIN faces f ON i.image_id = f.image_id;
        
        -- all profiles accessibility
        
        -- permissions by definition
        
        CREATE OR REPLACE VIEW images_def AS
        SELECT
            i.event_id,
            ep.profile_id,
            i.image_id,
            (
                (ep.all_images AND pi.image_id IS NULL)
                OR (NOT ep.all_images AND pi.image_id IS NOT NULL)
            ) AS is_accessible
        FROM images i
        JOIN events_profiles ep ON i.event_id = ep.event_id
        LEFT JOIN profiles_images pi ON 
            i.image_id = pi.image_id 
            AND ep.profile_id = pi.profile_id;

        CREATE OR REPLACE VIEW groups_def AS
        SELECT
            g.event_id,
            ep.profile_id,
            g.group_id,
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

        CREATE OR REPLACE VIEW albums_def AS
        SELECT
            a.event_id,
            ep.profile_id,
            a.album_id,
            (
                (ep.all_albums AND pa.album_id IS NULL)
                OR (NOT ep.all_albums AND pa.album_id IS NOT NULL)
            ) AS is_accessible
        FROM albums a
        JOIN events_profiles ep ON a.event_id = ep.event_id
        LEFT JOIN profiles_albums pa ON 
            a.album_id = pa.album_id 
            AND ep.profile_id = pa.profile_id;

        -- effective permissions
        
        CREATE OR REPLACE VIEW images_eff AS
        SELECT
            id.event_id,
            id.profile_id,
            id.image_id,
            (
                id.is_accessible
                AND (NOT ida.is_archived OR ad.is_accessible)
            ) AS is_accessible
        FROM images_def id
        INNER JOIN images_default_albums ida ON id.image_id = ida.image_id
        INNER JOIN events e ON id.event_id = e.event_id
        INNER JOIN albums_def ad ON
            e.archive_album_id = ad.album_id
            AND ad.profile_id = id.profile_id;

        CREATE OR REPLACE VIEW faces_eff AS
        SELECT
            ep.event_id,
            ep.profile_id,
            f.face_id,
            (ie.is_accessible AND gd.is_accessible) AS is_accessible
        FROM faces f
        INNER JOIN images i ON f.image_id = i.image_id
        JOIN events_profiles ep ON i.event_id = ep.event_id
        INNER JOIN images_eff ie ON
            i.image_id = ie.image_id
            AND ie.profile_id = ep.profile_id
        INNER JOIN groups_def gd ON
            f.group_id = gd.group_id
            AND gd.profile_id = ep.profile_id;
        
        CREATE OR REPLACE VIEW groups_eff AS
        SELECT
            gd.event_id,
            gd.profile_id,
            gd.group_id,
            (
                gd.is_accessible
                AND (
                    ep.can_edit
                    OR EXISTS (
                        SELECT 1
                        FROM faces_eff fe
                        INNER JOIN faces f ON fe.face_id = f.face_id
                        WHERE f.group_id = gd.group_id
                        AND fe.profile_id = gd.profile_id
                        AND fe.is_accessible
                    )
                )
            ) AS is_accessible
        FROM groups_def gd
        INNER JOIN events_profiles ep ON
            gd.event_id = ep.event_id
            AND gd.profile_id = ep.profile_id;
        
        CREATE OR REPLACE VIEW moments_eff AS
        SELECT
            ep.event_id,
            ep.profile_id,
            m.moment_id,
            (
                ep.can_edit
                OR EXISTS (
                    SELECT 1
                    FROM images_eff ie
                    INNER JOIN images i ON i.image_id = ie.image_id
                    WHERE i.moment_id = m.moment_id
                    AND ie.profile_id = ep.profile_id
                    AND ie.is_accessible
                )
            ) AS is_accessible
        FROM moments m
        JOIN events_profiles ep ON
            m.event_id = ep.event_id;
        
        CREATE OR REPLACE VIEW albums_eff AS
        SELECT
            ad.event_id,
            ad.profile_id,
            ad.album_id,
            (
                ad.is_accessible
                AND (
                    ep.can_edit
                    OR EXISTS (
                        SELECT 1
                        FROM images_eff ie
                        INNER JOIN albums_images ai ON ai.image_id = ie.image_id
                        WHERE ai.album_id = ad.album_id
                        AND ie.profile_id = ad.profile_id
                        AND ie.is_accessible
                    )
                )
            ) AS is_accessible
        FROM albums_def ad
        INNER JOIN events_profiles ep ON
            ad.event_id = ep.event_id
            AND ad.profile_id = ep.profile_id;

        -- context views by current profile
        
        CREATE OR REPLACE VIEW events_ctx AS
        SELECT
            e.*,
            (ep.profile_id IS NOT NULL) AS is_editable
        FROM events e
        LEFT JOIN events_profiles ep ON
            e.event_id = ep.event_id
            AND ep.profile_id = cur_profile_uuid('profile_id')
        WHERE
            e.is_public
            OR ep.profile_id IS NOT NULL;

        -- context views by current profile and event

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
        
        CREATE OR REPLACE VIEW faces_ctx AS
        SELECT
            f.*
        FROM faces f
        INNER JOIN images i ON f.image_id = i.image_id
        INNER JOIN faces_eff fe ON f.face_id = fe.face_id
        WHERE
            i.event_id = cur_event_profile_uuid('event_id')
            AND fe.profile_id = cur_profile_uuid('profile_id')
            AND fe.is_accessible;
        
        CREATE OR REPLACE VIEW groups_ctx AS
        SELECT 
            g.*
        FROM groups g
        INNER JOIN groups_eff ge ON g.group_id = ge.group_id
        WHERE
            g.event_id = cur_event_profile_uuid('event_id')
            AND ge.profile_id = cur_profile_uuid('profile_id')
            AND ge.is_accessible;
        
        CREATE OR REPLACE VIEW groups_images_ctx AS
        SELECT
            gi.*
        FROM groups_images gi
        INNER JOIN images_ctx ic ON gi.image_id = ic.image_id
        INNER JOIN groups_ctx gc ON gi.group_id = gc.group_id;

        CREATE OR REPLACE VIEW moments_ctx AS
        SELECT
            m.*
        FROM moments m
        INNER JOIN moments_eff me ON
            m.moment_id = me.moment_id
        WHERE
            m.event_id = cur_event_profile_uuid('event_id')
            AND me.profile_id = cur_profile_uuid('profile_id')
            AND me.is_accessible;        

        CREATE OR REPLACE VIEW albums_ctx AS
        SELECT
            a.*
        FROM albums a
        INNER JOIN albums_eff ae ON a.album_id = ae.album_id
        WHERE
            a.event_id = cur_event_profile_uuid('event_id')
            AND ae.profile_id = cur_profile_uuid('profile_id')
            AND ae.is_accessible;        

        CREATE OR REPLACE VIEW albums_images_ctx AS
        SELECT ai.*
        FROM albums_images ai
        INNER JOIN images_ctx ic ON ai.image_id = ic.image_id
        INNER JOIN albums_ctx ac ON ai.album_id = ac.album_id;
        
        CREATE OR REPLACE VIEW albums_images_actual_ctx AS
        SELECT aia.*
        FROM albums_images_actual aia
        INNER JOIN images_ctx ic ON aia.image_id = ic.image_id
        INNER JOIN albums_ctx ac ON aia.album_id = ac.album_id;
        
        CREATE OR REPLACE VIEW uploads_ctx AS
        SELECT u.*
        FROM uploads u
        WHERE
            u.event_id = cur_event_profile_uuid('event_id')
            AND cur_event_profile_bool('can_upload_and_delete_images');
        
        CREATE OR REPLACE VIEW uploads_groups_ctx AS
        SELECT
            ug.upload_id,
            ug.group_id
        FROM uploads_groups ug
        INNER JOIN uploads_ctx uc ON ug.upload_id = uc.upload_id
        INNER JOIN groups_ctx gc ON ug.group_id = gc.group_id;
        
        CREATE OR REPLACE VIEW uploads_moments_ctx AS
        SELECT
            um.upload_id,
            um.moment_id
        FROM uploads_moments um
        INNER JOIN uploads_ctx uc ON um.upload_id = uc.upload_id
        INNER JOIN moments_ctx mc ON um.moment_id = mc.moment_id;
        
        CREATE OR REPLACE VIEW uploads_faces_ctx AS
        SELECT
            uf.upload_id,
            uf.face_id
        FROM uploads_faces uf
        INNER JOIN uploads_ctx uc ON uf.upload_id = uc.upload_id
        INNER JOIN faces_ctx fc ON uf.face_id = fc.face_id;
        
        CREATE OR REPLACE VIEW my_access_requests_ctx AS
        SELECT
            ar.*
        FROM access_requests ar
        WHERE
            (
                ar.event_id = cur_event_profile_uuid('event_id')
                AND ar.applicant_profile_id = cur_profile_uuid('profile_id')
            )
            OR ar.access_request_id = cur_transaction('temp_access_request_id')::INTEGER;

        CREATE OR REPLACE VIEW my_access_requests_groups_ctx AS
        SELECT
            arg.*
        FROM access_requests_groups arg
        INNER JOIN my_access_requests_ctx marc ON arg.access_request_id = marc.access_request_id;
        
        CREATE OR REPLACE VIEW access_requests_groups_ctx AS
        SELECT
            arg.*
        FROM access_requests_groups arg
        INNER JOIN groups_ctx gc ON arg.group_id = gc.group_id
        INNER JOIN access_requests ar ON arg.access_request_id = ar.access_request_id
        WHERE
            ar.event_id = cur_event_profile_uuid('event_id')
            AND cur_profile_int('hierarchy_rank') > 0;
        
        CREATE OR REPLACE VIEW access_requests_ctx AS
        SELECT
            ar.*
        FROM access_requests ar
        WHERE EXISTS (
            SELECT 1
            FROM access_requests_groups_ctx argc
            WHERE argc.access_request_id = ar.access_request_id
        )
        AND ar.profile_id <> cur_profile_uuid('profile_id')
        AND ar.applicant_profile_id IS DISTINCT FROM cur_profile_uuid('profile_id');
        
        CREATE OR REPLACE VIEW events_profiles_ctx AS
        SELECT
            ep.*
        FROM events_profiles ep
        INNER JOIN profiles_ctx pc ON ep.profile_id = pc.profile_id
        INNER JOIN events_ctx ec ON ep.event_id = ec.event_id
        WHERE
            ec.is_editable
            AND ep.event_id = COALESCE(cur_event_profile_uuid('event_id'), ep.event_id);
        
        CREATE OR REPLACE VIEW profiles_images_ctx AS
        SELECT pi.*
        FROM profiles_images pi
        INNER JOIN events_profiles_ctx epc ON pi.profile_id = epc.profile_id
        INNER JOIN images_ctx ic ON pi.image_id = ic.image_id;
        
        CREATE OR REPLACE VIEW profiles_groups_ctx AS
        SELECT pg.*
        FROM profiles_groups pg
        INNER JOIN events_profiles_ctx epc ON pg.profile_id = epc.profile_id
        INNER JOIN groups_ctx gc ON pg.group_id = gc.group_id;
        
        CREATE OR REPLACE VIEW profiles_albums_ctx AS
        SELECT pa.*
        FROM profiles_albums pa
        INNER JOIN events_profiles_ctx epc ON pa.profile_id = epc.profile_id
        INNER JOIN albums_ctx ac ON pa.album_id = ac.album_id;
        
        -- api

        -- details preparation views
        
        CREATE OR REPLACE VIEW access_requests_details AS
        WITH request_stats AS (
            SELECT
                ar.access_request_id,
                COUNT(arg.group_id) AS groups_count,
                COUNT(arg.group_id) FILTER (WHERE ge.is_accessible) AS accessible_groups_count,
                COUNT(arg.group_id) FILTER (WHERE arg.approved IS TRUE) AS approved_groups_count,
                COUNT(arg.group_id) FILTER (WHERE arg.approved IS FALSE) AS rejected_groups_count,
                COUNT(arg.group_id) FILTER (WHERE arg.approved IS NULL) AS pending_groups_count
            FROM access_requests ar
            LEFT JOIN access_requests_groups arg ON ar.access_request_id = arg.access_request_id
            LEFT JOIN groups_eff ge ON arg.group_id = ge.group_id
            WHERE
                ar.event_id = cur_event_profile_uuid('event_id')
                AND ge.profile_id = cur_profile_uuid('profile_id')
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
        LEFT JOIN profiles p ON p.profile_id = COALESCE(ar.applicant_profile_id, ar.profile_id);
        
        -- extended views to api
        
        CREATE OR REPLACE VIEW images_ext AS
        SELECT
            ic.*,
            (ida.is_archived AND arc_ctx.album_id IS NOT NULL) AS is_archived,
            (ida.is_favorite AND fav_ctx.album_id IS NOT NULL) AS is_favorite
        FROM images_ctx ic
        INNER JOIN images_default_albums ida ON ic.image_id = ida.image_id
        INNER JOIN events e ON ic.event_id = e.event_id
        LEFT JOIN albums_ctx arc_ctx ON e.archive_album_id = arc_ctx.album_id
        LEFT JOIN albums_ctx fav_ctx ON e.favorites_album_id = fav_ctx.album_id;        

        CREATE OR REPLACE VIEW faces_ext AS
        SELECT
            fc.*,
            i.upload_id
        FROM faces_ctx fc
        INNER JOIN images i ON fc.image_id = i.image_id;

        CREATE OR REPLACE VIEW groups_ext AS
        WITH
            faces_stats AS (
                SELECT 
                    fc.group_id,
                    COUNT(*) AS faces_count
                FROM faces_ctx fc
                GROUP BY fc.group_id
            ),
            images_stats AS (
                SELECT 
                    gic.group_id,
                    COUNT(*) AS images_count,
                    COUNT(*) FILTER (WHERE NOT ida.is_archived) AS active_images_count
                FROM groups_images_ctx gic
                INNER JOIN images_default_albums ida ON gic.image_id = ida.image_id
                GROUP BY gic.group_id
            )
        SELECT 
            gc.*,
            ri.image_id as representative_image,
            COALESCE(fs.faces_count, 0) AS faces_count,
            COALESCE(img_stats.images_count, 0) AS images_count,
            COALESCE(img_stats.active_images_count, 0) AS active_images_count
        FROM groups_ctx gc
        LEFT JOIN faces ri ON gc.representative_face = ri.face_id
        LEFT JOIN faces_stats fs ON gc.group_id = fs.group_id
        LEFT JOIN images_stats img_stats ON gc.group_id = img_stats.group_id;

        CREATE OR REPLACE VIEW moments_ext AS
        WITH moments_stats AS (
            SELECT
                ic.moment_id,
                COUNT(*) as images_count,
                COUNT(*) FILTER (WHERE NOT ida.is_archived) AS active_images_count
            FROM images_ctx ic
            INNER JOIN images_default_albums ida ON ic.image_id = ida.image_id
            GROUP BY ic.moment_id
        )
        SELECT
            mc.*,
            COALESCE(ms.images_count, 0) AS images_count,
            COALESCE(ms.active_images_count, 0) AS active_images_count
        FROM moments_ctx mc
        LEFT JOIN moments_stats ms ON mc.moment_id = ms.moment_id;

        CREATE OR REPLACE VIEW albums_ext AS
        WITH albums_stats AS (
            SELECT
                aic.album_id,
                COUNT(*) as images_count,
                COUNT(*) FILTER (WHERE NOT ida.is_archived) AS active_images_count
            FROM albums_images_ctx aic
            INNER JOIN images_default_albums ida ON aic.image_id = ida.image_id
            GROUP BY aic.album_id
        )
        SELECT 
            ac.*,
            COALESCE(albums_stats_alias.images_count, 0) AS images_count,
            COALESCE(albums_stats_alias.active_images_count, 0) AS active_images_count
        FROM albums_ctx ac
        LEFT JOIN albums_stats albums_stats_alias ON ac.album_id = albums_stats_alias.album_id;

        CREATE OR REPLACE VIEW uploads_ext AS
        SELECT
            uc.*,
            p.label AS profile_label
        FROM uploads_ctx uc
        INNER JOIN profiles p ON uc.profile_id = p.profile_id;
        
        CREATE OR REPLACE VIEW uploads_groups_ext AS
        WITH
            groups_stats AS (
                SELECT
                    fc.group_id,
                    COUNT(*) AS faces_count
                FROM faces_ctx fc
                GROUP BY fc.group_id
            ),
            uploads_groups_stats AS (
                SELECT
                    ufc.upload_id,
                    f.group_id,
                    COUNT(*) AS upload_faces_count
                FROM uploads_faces_ctx ufc
                INNER JOIN faces f ON ufc.face_id = f.face_id
                GROUP BY ufc.upload_id, f.group_id
            )
        SELECT
            ugc.*,
            COALESCE(gs.faces_count, 0) AS faces_count,
            COALESCE(ugs.upload_faces_count, 0) AS upload_faces_count
        FROM uploads_groups_ctx ugc
        LEFT JOIN groups_stats gs ON ugc.group_id = gs.group_id
        LEFT JOIN uploads_groups_stats ugs ON
            ugc.upload_id = ugs.upload_id
            AND ugc.group_id = ugs.group_id;

        CREATE OR REPLACE VIEW uploads_faces_ext AS
        SELECT * FROM uploads_faces_ctx;

        CREATE OR REPLACE VIEW uploads_moments_ext AS
        WITH
            moments_stats AS (
                SELECT
                    ic.moment_id,
                    COUNT(*) AS images_count
                FROM images_ctx ic
                GROUP BY ic.moment_id
            ),
            upload_moments_stats AS (
                SELECT
                    ic.upload_id,
                    ic.moment_id,
                    COUNT(*) as upload_images_count
                FROM images_ctx ic
                GROUP BY ic.upload_id, ic.moment_id
            )
        SELECT
            umc.*,
            COALESCE(ms.images_count, 0) AS images_count,
            COALESCE(ums.upload_images_count, 0) AS upload_images_count
        FROM uploads_moments_ctx umc
        LEFT JOIN moments_stats ms ON umc.moment_id = ms.moment_id
        LEFT JOIN upload_moments_stats ums ON
            umc.upload_id = ums.upload_id
            AND umc.moment_id = ums.moment_id;

        CREATE OR REPLACE VIEW my_access_requests_ext AS
        SELECT
            ard.*,
            (
                NOT EXISTS (
                    SELECT 1 
                    FROM access_requests_groups arg
                    WHERE arg.access_request_id = ard.access_request_id AND arg.approved IS NOT NULL
                )
                AND NOT ard.is_closed
            ) AS is_deletable
        FROM access_requests_details ard
        INNER JOIN my_access_requests_ctx marc ON ard.access_request_id = marc.access_request_id;
        
        CREATE OR REPLACE VIEW my_access_requests_groups_ext AS
        SELECT
            margc.*,
            g.label AS label,
            g.representative_face AS representative_face
        FROM my_access_requests_groups_ctx margc
        INNER JOIN groups g ON margc.group_id = g.group_id;
        
        CREATE OR REPLACE VIEW access_requests_ext AS
        SELECT ard.*
        FROM access_requests_ctx arc
        INNER JOIN access_requests_details ard ON arc.access_request_id = ard.access_request_id;
        
        CREATE OR REPLACE VIEW access_requests_groups_ext AS
        SELECT * FROM access_requests_groups_ctx;

        CREATE OR REPLACE VIEW events_profiles_ext AS
        SELECT * FROM events_profiles_ctx;
        
        CREATE OR REPLACE VIEW profiles_images_ext AS
        SELECT * FROM profiles_images_ctx;
        
        CREATE OR REPLACE VIEW profiles_groups_ext AS
        SELECT * FROM profiles_groups_ctx;
        
        CREATE OR REPLACE VIEW profiles_albums_ext AS
        SELECT * FROM profiles_albums_ctx;
        
        CREATE OR REPLACE VIEW events_ext AS
        WITH
        images_stats_base AS (
            SELECT
                ie.event_id,
                COUNT(*) AS images_count
            FROM images_eff ie
            WHERE
                ie.profile_id = cur_profile_uuid('profile_id')
                AND ie.is_accessible
            GROUP BY ie.event_id
        ),
        images_stats AS (
            SELECT
                ie.event_id,
                SUM(i.file_size) AS original_size,
                SUM(i.high_quality_file_size) AS high_quality_size,
                SUM(i.file_size + i.high_quality_file_size + i.display_file_size + i.thumb_file_size) AS total_size,
                MAX(i.file_size) AS max_image_size
            FROM images_eff ie
            INNER JOIN images i ON ie.image_id = i.image_id
            INNER JOIN events_profiles ep ON
                ie.event_id = ep.event_id
                AND ie.profile_id = ep.profile_id
            WHERE
                ie.profile_id = cur_profile_uuid('profile_id')
                AND ie.is_accessible
                AND ep.can_manage_event
            GROUP BY ie.event_id
        ),
        faces_stats AS (
            SELECT
                fe.event_id,
                COUNT(*) AS faces_count,
                SUM(f.file_size) AS size
            FROM faces f
            INNER JOIN faces_eff fe ON f.face_id = fe.face_id
            INNER JOIN events_profiles ep ON
                fe.event_id = ep.event_id
                AND fe.profile_id = ep.profile_id
            WHERE
                fe.profile_id = cur_profile_uuid('profile_id')
                AND fe.is_accessible
                AND ep.can_manage_event
            GROUP BY fe.event_id
        ),
        albums_stats AS (
            SELECT
                ae.event_id,
                COUNT(*) AS albums_count
            FROM albums_eff ae
            INNER JOIN events_profiles ep ON
                ae.event_id = ep.event_id
                AND ae.profile_id = ep.profile_id
            WHERE
                ae.profile_id = cur_profile_uuid('profile_id')
                AND ae.is_accessible
                AND ep.can_manage_event
            GROUP BY ae.event_id
        ),
        moments_stats AS (
            SELECT
                me.event_id,
                COUNT(*) AS moments_count
            FROM moments_eff me
            INNER JOIN events_profiles ep ON
                me.event_id = ep.event_id
                AND me.profile_id = ep.profile_id
            WHERE
                me.profile_id = cur_profile_uuid('profile_id')
                AND me.is_accessible
                AND ep.can_manage_event
            GROUP BY me.event_id
        )
        SELECT
            ec.*,
            COALESCE(isb.images_count, 0) AS images_count,
            COALESCE(fs.faces_count, 0) AS faces_count,
            COALESCE(albums_stats_alias.albums_count, 0) AS albums_count,
            COALESCE(ms.moments_count, 0) AS moments_count,
            COALESCE(img_stats.original_size, 0) AS total_original_size,
            COALESCE(img_stats.high_quality_size, 0) AS total_high_quality_size,
            COALESCE(img_stats.total_size, 0) + COALESCE(fs.size, 0) AS total_size,
            COALESCE(img_stats.max_image_size, 0) AS max_image_size
        FROM events_ctx ec
        LEFT JOIN images_stats_base isb ON ec.event_id = isb.event_id
        LEFT JOIN images_stats img_stats ON ec.event_id = img_stats.event_id
        LEFT JOIN faces_stats fs ON ec.event_id = fs.event_id
        LEFT JOIN albums_stats albums_stats_alias ON ec.event_id = albums_stats_alias.event_id
        LEFT JOIN moments_stats ms ON ec.event_id = ms.event_id;
        
        -- current profile views
        CREATE OR REPLACE VIEW groups_to_access_requests_ctx AS
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
        WITH
        has_manageable_events AS (
            SELECT (
                cur_profile_bool('can_create_events')
                OR EXISTS (
                    SELECT 1
                    FROM current_profile_events cpe
                    WHERE cpe.can_manage_event
                )
            ) AS has_manageable_events
        ),
        notifications_stats AS (
            SELECT
                mn.profile_id,
                COUNT(*) AS total_notifications,
                COUNT(*) FILTER (WHERE NOT mn.read) AS unread_notifications
            FROM my_notifications_ctx mn
            WHERE mn.profile_id = cur_profile_uuid('profile_id')
            GROUP BY mn.profile_id
        ),
        feedbacks_stats AS (
            SELECT
                COUNT(*) AS pending_feedbacks
            FROM feedbacks_ctx fb
            WHERE NOT fb.is_closed
        )
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
            (
                p.hierarchy_rank > (
                    SELECT min_rank_to_create_event
                    FROM settings
                    WHERE id = 1
                    LIMIT 1
                )
            ) AS can_manage_create_events,
            COALESCE(ns.total_notifications, 0) AS total_notifications,
            COALESCE(ns.unread_notifications, 0) AS unread_notifications,
            COALESCE(fs.pending_feedbacks, 0) AS pending_feedbacks,
            cur_profile_bool('is_developer') AS has_feedbacks,
            cur_profile_bool('is_developer') AS has_settings,
            hme.has_manageable_events AS has_manageable_events,
            (
                cur_profile_bool('is_developer')
                OR hme.has_manageable_events
            ) AS has_dashboard
        FROM profiles p
        LEFT JOIN notifications_stats ns ON TRUE
        LEFT JOIN feedbacks_stats fs ON TRUE
        LEFT JOIN has_manageable_events hme ON TRUE
        WHERE p.profile_id = cur_profile_uuid('profile_id');
        
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
            EXISTS (SELECT 1 FROM groups_to_access_requests_ctx) AS enable_new_requests,
            (SELECT COUNT(*) FROM access_requests_ctx WHERE NOT is_closed) AS pending_access_requests_count
        FROM events_profiles ep
        JOIN events e ON e.event_id = ep.event_id
        WHERE ep.event_id = cur_event_profile_uuid('event_id')
        AND ep.profile_id = cur_profile_uuid('profile_id');

        CREATE OR REPLACE VIEW current_profile_events_ctx AS
        SELECT * FROM current_profile_events;

        CREATE OR REPLACE VIEW current_profile_ctx AS
        SELECT * FROM current_profile;

        CREATE OR REPLACE VIEW current_event_profile_ctx AS
        SELECT * FROM current_event_profile;

        CREATE OR REPLACE VIEW current_profile_events_ext AS
        SELECT * FROM current_profile_events_ctx;

        CREATE OR REPLACE VIEW current_profile_ext AS
        SELECT * FROM current_profile_ctx;

        CREATE OR REPLACE VIEW current_event_profile_ext AS
        SELECT * FROM current_event_profile_ctx;
        """,
        """
        DROP VIEW IF EXISTS current_event_profile_ext CASCADE;
        DROP VIEW IF EXISTS current_profile_ext CASCADE;
        DROP VIEW IF EXISTS current_event_profile_ctx CASCADE;
        DROP VIEW IF EXISTS current_profile_ctx CASCADE;
        DROP VIEW IF EXISTS current_event_profile CASCADE;
        DROP VIEW IF EXISTS current_profile CASCADE;
        DROP VIEW IF EXISTS current_profile_events CASCADE;
        DROP VIEW IF EXISTS groups_to_access_requests_ctx CASCADE;
        DROP VIEW IF EXISTS events_ext CASCADE;
        DROP VIEW IF EXISTS profiles_albums_ext CASCADE;
        DROP VIEW IF EXISTS profiles_groups_ext CASCADE;
        DROP VIEW IF EXISTS profiles_images_ext CASCADE;
        DROP VIEW IF EXISTS events_profiles_ext CASCADE;
        DROP VIEW IF EXISTS access_requests_groups_ext CASCADE;
        DROP VIEW IF EXISTS access_requests_ext CASCADE;
        DROP VIEW IF EXISTS my_access_requests_groups_ext CASCADE;
        DROP VIEW IF EXISTS my_access_requests_ext CASCADE;
        DROP VIEW IF EXISTS uploads_moments_ext CASCADE;
        DROP VIEW IF EXISTS uploads_faces_ext CASCADE;
        DROP VIEW IF EXISTS uploads_groups_ext CASCADE;
        DROP VIEW IF EXISTS uploads_ext CASCADE;
        DROP VIEW IF EXISTS albums_ext CASCADE;
        DROP VIEW IF EXISTS moments_ext CASCADE;
        DROP VIEW IF EXISTS groups_ext CASCADE;
        DROP VIEW IF EXISTS faces_ext CASCADE;
        DROP VIEW IF EXISTS images_ext CASCADE;
        DROP VIEW IF EXISTS access_requests_details CASCADE;
        DROP VIEW IF EXISTS profiles_albums_ctx CASCADE;
        DROP VIEW IF EXISTS profiles_groups_ctx CASCADE;
        DROP VIEW IF EXISTS profiles_images_ctx CASCADE;
        DROP VIEW IF EXISTS events_profiles_ctx CASCADE;
        DROP VIEW IF EXISTS access_requests_ctx CASCADE;
        DROP VIEW IF EXISTS access_requests_groups_ctx CASCADE;
        DROP VIEW IF EXISTS my_access_requests_groups_ctx CASCADE;
        DROP VIEW IF EXISTS my_access_requests_ctx CASCADE;
        DROP VIEW IF EXISTS uploads_faces_ctx CASCADE;
        DROP VIEW IF EXISTS uploads_moments_ctx CASCADE;
        DROP VIEW IF EXISTS uploads_groups_ctx CASCADE;
        DROP VIEW IF EXISTS uploads_ctx CASCADE;
        DROP VIEW IF EXISTS albums_images_actual_ctx CASCADE;
        DROP VIEW IF EXISTS albums_images_ctx CASCADE;
        DROP VIEW IF EXISTS albums_ctx CASCADE;
        DROP VIEW IF EXISTS moments_ctx CASCADE;
        DROP VIEW IF EXISTS groups_images_ctx CASCADE;
        DROP VIEW IF EXISTS groups_ctx CASCADE;
        DROP VIEW IF EXISTS faces_ctx CASCADE;
        DROP VIEW IF EXISTS images_ctx CASCADE;
        DROP VIEW IF EXISTS events_ctx CASCADE;
        DROP VIEW IF EXISTS albums_eff CASCADE;
        DROP VIEW IF EXISTS moments_eff CASCADE;
        DROP VIEW IF EXISTS groups_eff CASCADE;
        DROP VIEW IF EXISTS faces_eff CASCADE;
        DROP VIEW IF EXISTS images_eff CASCADE;
        DROP VIEW IF EXISTS albums_def CASCADE;
        DROP VIEW IF EXISTS groups_def CASCADE;
        DROP VIEW IF EXISTS images_def CASCADE;
        DROP VIEW IF EXISTS uploads_faces CASCADE;
        DROP VIEW IF EXISTS uploads_groups CASCADE;
        DROP VIEW IF EXISTS uploads_moments CASCADE;
        DROP VIEW IF EXISTS albums_images_actual CASCADE;
        DROP VIEW IF EXISTS groups_images CASCADE;
        DROP VIEW IF EXISTS images_default_albums CASCADE;
        DROP VIEW IF EXISTS feedbacks_ext CASCADE;
        DROP VIEW IF EXISTS feedbacks_ctx CASCADE;
        DROP VIEW IF EXISTS my_feedbacks_ext CASCADE;
        DROP VIEW IF EXISTS my_feedbacks_ctx CASCADE;
        DROP VIEW IF EXISTS feedbacks_details CASCADE;
        DROP VIEW IF EXISTS my_notifications_ext CASCADE;
        DROP VIEW IF EXISTS my_notifications_ctx CASCADE;
        DROP VIEW IF EXISTS my_preferences_ctx CASCADE;
        DROP VIEW IF EXISTS my_preferences CASCADE;
        DROP VIEW IF EXISTS profiles_ext CASCADE;
        DROP VIEW IF EXISTS profiles_ctx CASCADE;
        DROP VIEW IF EXISTS audit_logs_ext CASCADE;
        DROP VIEW IF EXISTS audit_logs_ctx CASCADE;
        DROP VIEW IF EXISTS errors_ext CASCADE;
        DROP VIEW IF EXISTS errors_ctx CASCADE;
        DROP VIEW IF EXISTS rekognition_usaged_ext CASCADE;
        DROP VIEW IF EXISTS rekognition_usaged_ctx CASCADE;
        DROP VIEW IF EXISTS settings_ext CASCADE;
        DROP VIEW IF EXISTS settings_ctx CASCADE;
        DROP VIEW IF EXISTS refresh_tokens_ctx CASCADE;
        """
    ),
]