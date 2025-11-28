def TABLES() -> dict:
    return {
        'settings': '''
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            developer_id TEXT,
            image_size_limit_bytes INTEGER DEFAULT 0,
            images_count_limit INTEGER DEFAULT 0,
            rekognition_calls_limit INTEGER DEFAULT 0,
            min_rank_to_create_event INTEGER DEFAULT 0,
            event_in_deletion TEXT DEFAULT NULL,
            FOREIGN KEY (developer_id) REFERENCES profiles(profile_id) ON DELETE SET NULL,
            FOREIGN KEY (event_in_deletion) REFERENCES events(event_id) ON DELETE SET NULL
        ''',
        'rekognition_usaged': '''
            usage_id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL,
            event_label TEXT NOT NULL,
            profile_id TEXT NOT NULL,
            profile_label TEXT NOT NULL,
            calls_count INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ''',
        'default_preferences': '''
            preference_group TEXT NOT NULL,
            preference_key TEXT NOT NULL,
            value_type TEXT NOT NULL,
            value TEXT NOT NULL,
            PRIMARY KEY (preference_group, preference_key)
        ''',
        'events': '''
            event_id TEXT PRIMARY KEY NOT NULL,
            name TEXT COLLATE NOCASE UNIQUE NOT NULL,
            date TEXT,
            url TEXT COLLATE NOCASE UNIQUE NOT NULL,
            is_public INTEGER DEFAULT 0,
            images_count_limit INTEGER NOT NULL DEFAULT 0,
            image_size_limit_bytes INTEGER NOT NULL DEFAULT 0,
            rekognition_calls_limit INTEGER NOT NULL DEFAULT 0,
            rekognition_calls_used INTEGER NOT NULL DEFAULT 0,
            archive_album_id TEXT,
            favorites_album_id TEXT,
            unassociated_group_id TEXT,
            representative_image TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT,
            FOREIGN KEY (archive_album_id) REFERENCES albums(album_id) ON DELETE SET NULL,
            FOREIGN KEY (favorites_album_id) REFERENCES albums(album_id) ON DELETE SET NULL,
            FOREIGN KEY (unassociated_group_id) REFERENCES groups(group_id) ON DELETE SET NULL,
            FOREIGN KEY (representative_image) REFERENCES images(image_id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES profiles(profile_id) ON DELETE SET NULL
        ''',
        'profiles': '''
            profile_id TEXT PRIMARY KEY NOT NULL,
            label TEXT COLLATE NOCASE NOT NULL,
            email TEXT,
            password TEXT NOT NULL,
            hierarchy_rank INTEGER DEFAULT 0 CHECK (hierarchy_rank >= 0),
            can_create_events INTEGER DEFAULT 0,
            restricted_to_event TEXT DEFAULT NULL,
            is_public INTEGER DEFAULT 0,
            public_access_code TEXT,
            FOREIGN KEY (restricted_to_event) REFERENCES events(event_id) ON DELETE SET NULL
        ''',
        'profiles_preferences': '''
            profile_id TEXT NOT NULL,
            preference_group TEXT NOT NULL,
            preference_key TEXT NOT NULL,
            preference_value TEXT NOT NULL,
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
            FOREIGN KEY (preference_group, preference_key) REFERENCES default_preferences(preference_group, preference_key) ON DELETE CASCADE,
            PRIMARY KEY (profile_id, preference_group, preference_key)
        ''',
        'refresh_tokens': '''
            token_id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE,
            issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            user_agent TEXT,
            ip_address TEXT,
            revoked INTEGER DEFAULT 0,
            revoked_at DATETIME,
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE
        ''',
        'notifications': '''
            notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            read INTEGER DEFAULT 0,
            read_at DATETIME,
            type TEXT,
            data TEXT,
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE
        ''',
        'feedbacks': '''
            feedback_id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id TEXT,
            sender_name TEXT,
            sender_email TEXT,
            communication_consent INTEGER DEFAULT 0,
            title TEXT,
            type INTEGER DEFAULT 0,
            message TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            user_agent TEXT,
            ip_address TEXT,
            diagnostics TEXT,
            notes TEXT,
            is_closed INTEGER DEFAULT 0,
            solved INTEGER DEFAULT 0,
            closed_at DATETIME,
            closed_by TEXT,
            closed_details TEXT,
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
            FOREIGN KEY (closed_by) REFERENCES profiles(profile_id) ON DELETE SET NULL
        ''',
        'events_profiles': '''
            event_id TEXT,
            profile_id TEXT,
            can_manage_event BOOLEAN DEFAULT 0,
            can_delete_event BOOLEAN DEFAULT 0,
            can_upload_and_delete_images BOOLEAN DEFAULT 0,
            can_edit BOOLEAN DEFAULT 0,
            all_images BOOLEAN DEFAULT 0,
            all_groups BOOLEAN DEFAULT 0,
            all_albums BOOLEAN DEFAULT 0,
            FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
            PRIMARY KEY (event_id, profile_id)
        ''',
        'images': '''
            event_id TEXT NOT NULL,
            image_id TEXT PRIMARY KEY NOT NULL,
            label TEXT,
            date_taken TEXT,
            file_size INTEGER,
            high_quality_file_size INTEGER,
            display_file_size INTEGER,
            thumb_file_size INTEGER,
            width INTEGER,
            height INTEGER,
            moment_id TEXT,
            description TEXT,
            upload_id INTEGER,
            UNIQUE (event_id, label),
            FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
            FOREIGN KEY (moment_id) REFERENCES moments(moment_id) ON DELETE SET NULL,
            FOREIGN KEY (upload_id) REFERENCES uploads(upload_id) ON DELETE SET NULL
        ''',
        'faces': '''
            face_id TEXT PRIMARY KEY NOT NULL,
            image_id TEXT NOT NULL,
            face_width REAL,
            face_height REAL,
            face_left REAL,
            face_top REAL,
            file_size INTEGER,
            group_id TEXT NOT NULL,
            FOREIGN KEY (image_id) REFERENCES images(image_id) ON DELETE CASCADE,
            FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE
        ''',
        'groups': '''
            event_id TEXT NOT NULL,
            group_id TEXT PRIMARY KEY NOT NULL,
            label TEXT COLLATE NOCASE,
            representative_face TEXT,
            UNIQUE (event_id, label),
            FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
            FOREIGN KEY (representative_face) REFERENCES faces(face_id) ON DELETE SET NULL
        ''',
        'moments': '''
            event_id TEXT NOT NULL,
            moment_id TEXT PRIMARY KEY NOT NULL,
            label TEXT COLLATE NOCASE,
            description TEXT,
            start TEXT,
            end TEXT,
            representative_image TEXT,
            UNIQUE (event_id, label),
            FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
            FOREIGN KEY (representative_image) REFERENCES images(image_id) ON DELETE SET NULL
        ''',
        'albums': '''
            event_id TEXT NOT NULL,
            album_id TEXT PRIMARY KEY NOT NULL,
            label TEXT COLLATE NOCASE,
            description TEXT,
            representative_image TEXT,
            UNIQUE (event_id, label),
            FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
            FOREIGN KEY (representative_image) REFERENCES images(image_id) ON DELETE SET NULL
        ''',
        'albums_images': '''
            album_id TEXT NOT NULL,
            image_id TEXT NOT NULL,
            FOREIGN KEY (album_id) REFERENCES albums(album_id) ON DELETE CASCADE,
            FOREIGN KEY (image_id) REFERENCES images(image_id) ON DELETE CASCADE,
            PRIMARY KEY (album_id, image_id)
        ''',
        'events_profiles_images': '''
            event_id TEXT,
            profile_id TEXT,
            image_id TEXT,
            FOREIGN KEY (event_id, profile_id) REFERENCES events_profiles(event_id, profile_id) ON DELETE CASCADE,
            FOREIGN KEY (image_id) REFERENCES images(image_id) ON DELETE CASCADE,
            PRIMARY KEY (event_id, profile_id, image_id)
        ''',
        'events_profiles_groups': '''
            event_id TEXT,
            profile_id TEXT,
            group_id TEXT,
            FOREIGN KEY (event_id, profile_id) REFERENCES events_profiles(event_id, profile_id) ON DELETE CASCADE,
            FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE,
            PRIMARY KEY (event_id, profile_id, group_id)
        ''',
        'events_profiles_albums': '''
            event_id TEXT,
            profile_id TEXT,
            album_id TEXT,
            FOREIGN KEY (event_id, profile_id) REFERENCES events_profiles(event_id, profile_id) ON DELETE CASCADE,
            FOREIGN KEY (album_id) REFERENCES albums(album_id) ON DELETE CASCADE,
            PRIMARY KEY (event_id, profile_id, album_id)
        ''',
        'uploads': '''
            event_id TEXT,
            upload_id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            status TEXT,
            images_count INTEGER,
            faces_count INTEGER,
            clusters_count INTEGER,
            moments_count INTEGER,
            errors TEXT,
            notes TEXT,
            profile_id TEXT,
            FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE SET NULL
        ''',
        'access_requests': '''
            event_id TEXT,
            access_request_id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id TEXT NOT NULL,
            requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            applicant_name TEXT,
            applicant_email TEXT,
            applicant_phone TEXT,
            details TEXT,
            communication_consent BOOLEAN DEFAULT 0,
            is_closed BOOLEAN DEFAULT 0,
            closed_at DATETIME,
            closed_by TEXT,
            closed_details TEXT,
            applicant_profile_id TEXT,
            FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE SET NULL,
            FOREIGN KEY (closed_by) REFERENCES profiles(profile_id) ON DELETE SET NULL,
            FOREIGN KEY (applicant_profile_id) REFERENCES profiles(profile_id) ON DELETE SET NULL
        ''',
        'access_requests_groups': '''
            access_request_id INTEGER,
            group_id TEXT,
            approved BOOLEAN DEFAULT NULL,
            closed_at DATETIME,
            closed_by TEXT,
            closed_details TEXT,
            FOREIGN KEY (access_request_id) REFERENCES access_requests(access_request_id) ON DELETE CASCADE,
            FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE,
            FOREIGN KEY (closed_by) REFERENCES profiles(profile_id) ON DELETE SET NULL,
            PRIMARY KEY (access_request_id, group_id)
        ''',
    }

def INDEXES() -> list:
    return {
        'idx_rekognition_usaged_event_id': 'rekognition_usaged(event_id)',
        'idx_rekognition_usaged_profile_id': 'rekognition_usaged(profile_id)',
        'idx_rekognition_usaged_created_at': 'rekognition_usaged(created_at)',
        'idx_events_name': 'events(name)',
        'idx_events_url': 'events(url)',
        'idx_events_representative_image': 'events(representative_image)',
        'idx_events_created_at': 'events(created_at)',
        'idx_events_created_by': 'events(created_by)',
        'idx_events_rekognition_calls_used': 'events(rekognition_calls_used)',
        'idx_profiles_label': 'profiles(label)',
        'idx_profiles_restricted_to_event': 'profiles(restricted_to_event)',
        'idx_profiles_public_access_code': 'profiles(public_access_code)',
        'idx_refresh_tokens_profile_id': 'refresh_tokens(profile_id)',
        'idx_refresh_tokens_token': 'refresh_tokens(token)',
        'idx_notifications_profile_id': 'notifications(profile_id)',
        'idx_notifications_notification_id': 'notifications(notification_id)',
        'idx_notifications_message': 'notifications(message)',
        'idx_notifications_read': 'notifications(read)',
        'idx_notifications_type': 'notifications(type)',
        'idx_feedbacks_profile_id': 'feedbacks(profile_id)',
        'idx_feedbacks_is_closed': 'feedbacks(is_closed)',
        'idx_feedbacks_type': 'feedbacks(type)',
        'idx_feedbacks_closed_by': 'feedbacks(closed_by)',
        'idx_feedbacks_solved': 'feedbacks(solved)',
        'idx_images_moment_id': 'images(moment_id)',
        'idx_images_upload_id': 'images(upload_id)',
        'idx_images_date_taken': 'images(date_taken)',
        'idx_faces_image_id': 'faces(image_id)',
        'idx_faces_group_id': 'faces(group_id)',
        'idx_faces_group_id_image_id': 'faces(group_id, image_id)',
        'idx_groups_representative_face': 'groups(representative_face)',
        'idx_moments_representative_image': 'moments(representative_image)',
        'idx_albums_representative_image': 'albums(representative_image)',
        'idx_uploads_profile_id': 'uploads(profile_id)',
        'idx_uploads_status': 'uploads(status)',
        'idx_uploads_started_at': 'uploads(started_at)',
        'idx_access_requests_profile_id': 'access_requests(profile_id)',
        'idx_access_requests_is_closed': 'access_requests(is_closed)',
        'idx_access_requests_requested_at': 'access_requests(requested_at)',
        'idx_access_requests_closed_by': 'access_requests(closed_by)',
        'idx_access_requests_applicant_profile_id': 'access_requests(applicant_profile_id)',
        'idx_access_requests_groups_approved': 'access_requests_groups(approved)',
        'idx_access_requests_groups_closed_by': 'access_requests_groups(closed_by)',
    }

def VIEWS() -> dict:
    return {
        # settings
        'accessible_settings': '''
            SELECT
                s.*
            FROM settings s
            WHERE s.id = 1
            AND s.developer_id = cur_profile('profile_id')
        ''',
        # rekognition usage
        'accessible_rekognition_usaged': '''
            SELECT
                ru.*
            FROM rekognition_usaged ru
            JOIN settings s ON s.id = 1
            WHERE s.developer_id = cur_profile('profile_id')
        ''',

        # all profiles accessibility
        'albums_accessibility_helper': '''
            SELECT
                a.event_id,
                a.album_id,
                ep.profile_id,
                CASE WHEN
                    (ep.all_albums = 1 AND epa.album_id IS NULL)
                    OR (ep.all_albums = 0 AND epa.album_id IS NOT NULL)
                THEN 1 ELSE 0 END AS is_accessible
            FROM albums a
            JOIN events_profiles ep ON a.event_id = ep.event_id
            LEFT JOIN events_profiles_albums epa ON
                a.album_id = epa.album_id
                AND ep.profile_id = epa.profile_id
                AND a.album_id = epa.album_id
        ''',
        'images_accessibility': '''
            SELECT
                i.event_id,
                i.image_id,
                ep.profile_id,
                CASE WHEN
                    ((ep.all_images = 1 AND epi.image_id IS NULL)
                    OR (ep.all_images = 0 AND epi.image_id IS NOT NULL))
                    AND (aah.is_accessible = 1 OR aah.is_accessible IS NULL)
                THEN 1 ELSE 0 END AS is_accessible
            FROM images i
            JOIN events_profiles ep ON i.event_id = ep.event_id
            LEFT JOIN events_profiles_images epi ON
                i.image_id = epi.image_id
                AND ep.profile_id = epi.profile_id
                AND i.image_id = epi.image_id
            LEFT JOIN (
                albums_images ai
                INNER JOIN albums a ON ai.album_id = a.album_id
                INNER JOIN events e ON
                    e.event_id = a.event_id
                    AND a.album_id = e.archive_album_id
                INNER JOIN albums_accessibility_helper aah ON aah.album_id = ai.album_id
            ) ON i.image_id = ai.image_id AND aah.profile_id = ep.profile_id
        ''',
        'groups_accessibility_helper': '''
            SELECT
                g.event_id,
                g.group_id,
                ep.profile_id,
                CASE WHEN
                    ((ep.all_groups = 1 AND epg.group_id IS NULL)
                    OR (ep.all_groups = 0 AND epg.group_id IS NOT NULL))
                    AND (ep.can_edit = 1 OR g.group_id <> e.unassociated_group_id)
                THEN 1 ELSE 0 END AS is_accessible_helper
            FROM groups g
            INNER JOIN events e ON g.event_id = e.event_id
            JOIN events_profiles ep ON g.event_id = ep.event_id
            LEFT JOIN events_profiles_groups epg ON
                g.group_id = epg.group_id
                AND ep.profile_id = epg.profile_id
                AND g.group_id = epg.group_id
        ''',
        'faces_accessibility': '''
            SELECT
                ep.event_id,
                f.face_id,
                ep.profile_id,
                CASE WHEN
                    (ia.is_accessible = 1 AND gah.is_accessible_helper = 1)
                THEN 1 ELSE 0 END AS is_accessible
            FROM faces f
            INNER JOIN images i ON f.image_id = i.image_id
            JOIN events_profiles ep ON i.event_id = ep.event_id
            INNER JOIN images_accessibility ia ON f.image_id = ia.image_id AND ia.profile_id = ep.profile_id
            INNER JOIN groups_accessibility_helper gah ON f.group_id = gah.group_id AND gah.profile_id = ep.profile_id
        ''',
        'groups_accessibility': '''
            SELECT
                gah.event_id,
                gah.group_id,
                gah.profile_id,
                CASE WHEN
                    gah.is_accessible_helper = 1
                    AND (ep.can_edit = 1 OR 
                        EXISTS (
                            SELECT 1
                            FROM faces_accessibility fa
                            INNER JOIN faces f ON fa.face_id = f.face_id
                            WHERE f.group_id = gah.group_id
                            AND fa.profile_id = gah.profile_id
                            AND fa.is_accessible = 1
                        )
                    )
                THEN 1 ELSE 0 END AS is_accessible
            FROM groups_accessibility_helper gah
            JOIN events_profiles ep ON gah.event_id = ep.event_id AND gah.profile_id = ep.profile_id
        ''',
        'groups_to_request_access': '''
            SELECT
                gah.event_id,
                gah.profile_id,
                gah.group_id
            FROM groups_accessibility_helper gah
            WHERE gah.is_accessible_helper = 0
            AND EXISTS (
                SELECT 1
                FROM groups_images gi
                INNER JOIN images_accessibility ia ON
                    gi.image_id = ia.image_id
                    AND ia.event_id = gah.event_id
                    AND ia.profile_id = gah.profile_id
                    AND ia.is_accessible = 1
                WHERE gi.group_id = gah.group_id
            )
        ''',
        'moments_accessibility': '''
            SELECT
                ep.event_id,
                m.moment_id,
                ep.profile_id,
                CASE WHEN
                    (ep.can_edit = 1 OR EXISTS (
                        SELECT 1
                        FROM images_accessibility ia
                        INNER JOIN images i ON i.image_id = ia.image_id
                        WHERE i.moment_id = m.moment_id
                        AND ia.profile_id = ep.profile_id
                        AND ia.is_accessible = 1
                    ))
                THEN 1 ELSE 0 END AS is_accessible
            FROM moments m
            JOIN events_profiles ep ON m.event_id = ep.event_id
        ''',
        'albums_accessibility': '''
            SELECT
                aah.event_id,
                aah.album_id,
                ep.profile_id,
                CASE WHEN
                    aah.is_accessible = 1
                    AND (ep.can_edit = 1 OR EXISTS (
                        SELECT 1
                        FROM images_accessibility ia
                        INNER JOIN albums_images ai ON ai.image_id = ia.image_id
                        WHERE ai.album_id = aah.album_id
                        AND ia.profile_id = ep.profile_id
                        AND ia.is_accessible = 1
                    ))
                THEN 1 ELSE 0 END AS is_accessible
            FROM albums_accessibility_helper aah
            JOIN events_profiles ep ON aah.event_id = ep.event_id AND aah.profile_id = ep.profile_id
        ''',

        # events
        'accessible_events': """
            SELECT
                e.*,
                (
                    SELECT COUNT(*)
                    FROM images_accessibility ia
                    WHERE ia.event_id = e.event_id
                    AND ia.profile_id = ep.profile_id
                    AND ia.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN ia.is_accessible ELSE 0 END
                ) AS images_count,
                (
                    SELECT SUM(i.file_size)
                    FROM images_accessibility ia
                    INNER JOIN images i ON i.image_id = ia.image_id
                    WHERE ia.event_id = e.event_id
                    AND ia.profile_id = ep.profile_id
                    AND ia.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN ia.is_accessible ELSE -1 END
                ) AS total_original_size,
                (
                    SELECT SUM(i.high_quality_file_size)
                    FROM images_accessibility ia
                    INNER JOIN images i ON i.image_id = ia.image_id
                    WHERE ia.event_id = e.event_id
                    AND ia.profile_id = ep.profile_id
                    AND ia.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN ia.is_accessible ELSE -1 END
                ) AS total_high_quality_size,
                (
                    SELECT SUM(i.file_size + i.high_quality_file_size + i.display_file_size + i.thumb_file_size)
                    FROM images_accessibility ia
                    INNER JOIN images i ON i.image_id = ia.image_id
                    WHERE ia.event_id = e.event_id
                    AND ia.profile_id = ep.profile_id
                    AND ia.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN ia.is_accessible ELSE -1 END
                ) + (
                    SELECT SUM(f.file_size)
                    FROM faces_accessibility fa
                    INNER JOIN faces f ON f.face_id = fa.face_id
                    WHERE fa.event_id = e.event_id
                    AND fa.profile_id = ep.profile_id
                    AND fa.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN fa.is_accessible ELSE -1 END
                ) AS total_size,
                (
                    SELECT MAX(i.file_size)
                    FROM images_accessibility ia
                    INNER JOIN images i ON i.image_id = ia.image_id
                    WHERE ia.event_id = e.event_id
                    AND ia.profile_id = ep.profile_id
                    AND ia.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN ia.is_accessible ELSE -1 END
                ) AS max_image_size,
                (
                    SELECT COUNT(*)
                    FROM faces_accessibility fa
                    WHERE fa.event_id = e.event_id
                    AND fa.profile_id = ep.profile_id
                    AND fa.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN fa.is_accessible ELSE 0 END
                ) AS faces_count,
                (
                    SELECT COUNT(*)
                    FROM albums_accessibility aa
                    WHERE aa.event_id = e.event_id
                    AND aa.profile_id = ep.profile_id
                    AND aa.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN aa.is_accessible ELSE 0 END
                ) AS albums_count,
                (
                    SELECT COUNT(*)
                    FROM moments_accessibility ma
                    WHERE ma.event_id = e.event_id
                    AND ma.profile_id = ep.profile_id
                    AND ma.is_accessible = CASE WHEN ep.can_manage_event = 1 THEN ma.is_accessible ELSE 0 END
                ) AS moments_count
            FROM events e
            LEFT JOIN events_profiles ep ON
                e.event_id = ep.event_id
                AND ep.profile_id = cur_profile('profile_id')
            WHERE e.is_public = 1 OR ep.profile_id IS NOT NULL
        """,

        # profiles
        'accessible_profiles': """
            SELECT
                p.*,
                ae.name AS restricted_to_event_name,
                CASE WHEN
                    cur_profile('restricted_to_event') IS NULL
                    OR cur_profile('restricted_to_event') = p.restricted_to_event
                THEN 1 ELSE 0 END AS is_editable,
                public_access_code IS NOT NULL AS has_public_access_code
            FROM profiles p
            LEFT JOIN accessible_events ae ON p.restricted_to_event = ae.event_id
            WHERE p.hierarchy_rank < cur_profile('hierarchy_rank')
            AND
                (p.restricted_to_event IS NULL OR p.restricted_to_event IN (
                    SELECT event_id
                    FROM events_profiles ep
                    WHERE ep.profile_id = cur_profile('profile_id')
                ))
        """,
        'my_preferences': """
            SELECT
                pp.*,
                dp.value_type
            FROM profiles_preferences pp
            INNER JOIN default_preferences dp
            ON pp.preference_group = dp.preference_group
            AND pp.preference_key = dp.preference_key
            WHERE pp.profile_id = cur_profile('profile_id')
        """,

        # current profile
        'current_groups_to_request_access': '''
            SELECT
                gta.group_id
            FROM groups_to_request_access gta
            WHERE gta.event_id = cur_event_profile('event_id')
            AND gta.profile_id = cur_profile('profile_id')
        ''',
        'current_event_profile': '''
            SELECT
                ep.event_id,
                ep.profile_id,
                can_manage_event,
                can_delete_event,
                can_upload_and_delete_images,
                can_edit,
                all_images,
                all_groups,
                all_albums,
                CASE WHEN a1.album_id IS NOT NULL THEN 1 ELSE 0 END as has_archive_album,
                CASE WHEN a2.album_id IS NOT NULL THEN 1 ELSE 0 END as has_favorites_album,
                CASE WHEN
                    can_edit = 1
                    OR EXISTS (
                        SELECT 1
                        FROM accessible_images ai
                    )
                THEN 1 ELSE 0 END as has_images,
                CASE WHEN
                    can_edit = 1
                    OR EXISTS (
                        SELECT 1
                        FROM accessible_groups g
                    )
                THEN 1 ELSE 0 END as has_groups,
                CASE WHEN
                    can_edit = 1
                    OR EXISTS (
                        SELECT 1
                        FROM accessible_albums aa
                        WHERE aa.album_id <> e.archive_album_id
                        AND aa.album_id <> e.favorites_album_id
                    )
                THEN 1 ELSE 0 END as has_albums,
                CASE WHEN EXISTS (
                    SELECT 1
                    FROM current_groups_to_request_access cgtra
                )
                THEN 1 ELSE 0 END as enable_new_requests,
                COUNT(DISTINCT aar.access_request_id) as pending_access_requests_count
            FROM events_profiles ep
            INNER JOIN events e ON e.event_id = ep.event_id
            LEFT JOIN accessible_albums a1 ON e.archive_album_id = a1.album_id
            LEFT JOIN accessible_albums a2 ON e.favorites_album_id = a2.album_id
            LEFT JOIN accessible_access_requests aar ON aar.is_closed = 0
            LEFT JOIN current_groups_to_request_access cgtra
            WHERE ep.event_id = cur_event_profile('event_id')
            AND ep.profile_id = cur_profile('profile_id')
            GROUP BY ep.profile_id
        ''',
        'current_profile': """
            SELECT
                p.profile_id,
                p.label,
                p.password,
                p.email,
                p.hierarchy_rank,
                p.can_create_events,
                p.restricted_to_event,
                p.is_public,
                p.hierarchy_rank > 0 AS is_profiles_manager,
                p.hierarchy_rank > (SELECT min_rank_to_create_event FROM settings WHERE id = 1 LIMIT 1) AS can_manage_create_events,
                COUNT(mn.notification_id) AS total_notifications,
                COUNT(mn.notification_id) - COALESCE(SUM(mn.read), 0) AS unread_notifications,
                (SELECT COUNT(*) FROM accessible_feedbacks WHERE is_closed = 0) AS pending_feedbacks,
                CASE WHEN p.profile_id = (SELECT developer_id FROM settings WHERE id = 1 LIMIT 1) THEN 1 ELSE 0 END AS has_feedbacks,
                CASE WHEN
                    p.profile_id = (SELECT developer_id FROM settings WHERE id = 1 LIMIT 1)
                THEN 1 ELSE 0 END AS has_settings,
                CASE WHEN
                    COALESCE(SUM(cpe.can_manage_event), 0) > 0
                    OR p.can_create_events = 1
                THEN 1 ELSE 0 END AS has_manageable_events,
                CASE WHEN
                    COALESCE(SUM(cpe.can_manage_event), 0) > 0
                    OR p.can_create_events = 1
                    OR p.profile_id = (SELECT developer_id FROM settings WHERE id = 1 LIMIT 1)
                THEN 1 ELSE 0 END AS has_dashboard
            FROM profiles p
            LEFT JOIN my_notifications mn ON p.profile_id = mn.profile_id
            LEFT JOIN current_profile_events cpe ON p.profile_id = cpe.profile_id
            WHERE p.profile_id = cur_profile('profile_id')
            GROUP BY p.profile_id
        """,
        'current_profile_events': '''
            SELECT
                ep.profile_id,
                ep.event_id,
                ep.can_manage_event,
                ep.can_delete_event
            FROM events_profiles ep
            WHERE ep.profile_id = cur_profile('profile_id')
            GROUP BY ep.event_id
        ''',

        # event profiles
        'accessible_events_profiles': """
            SELECT ep.*
            FROM events_profiles ep
            INNER JOIN profiles p ON ep.profile_id = p.profile_id
            INNER JOIN accessible_events ae ON ep.event_id = ae.event_id
            WHERE p.hierarchy_rank < cur_profile('hierarchy_rank')
        """,
        'accessible_events_profiles_images': '''
            SELECT epi.*
            FROM events_profiles_images epi
            INNER JOIN accessible_events_profiles aep
            ON epi.profile_id = aep.profile_id
            AND aep.event_id = epi.event_id
            WHERE aep.event_id = cur_event_profile('event_id')
        ''',
        'accessible_events_profiles_groups': '''
            SELECT epg.*
            FROM events_profiles_groups epg
            INNER JOIN accessible_events_profiles aep
            ON epg.profile_id = aep.profile_id
            AND epg.event_id = aep.event_id
            WHERE aep.event_id = cur_event_profile('event_id')
        ''',
        'accessible_events_profiles_albums': '''
            SELECT epa.*
            FROM events_profiles_albums epa
            INNER JOIN accessible_events_profiles aep
            ON epa.profile_id = aep.profile_id
            AND epa.event_id = aep.event_id
            WHERE aep.event_id = cur_event_profile('event_id')
        ''',

        # notifications
        'my_notifications': """
            SELECT * FROM notifications
            WHERE profile_id = cur_profile('profile_id')
        """,
        'accessible_my_notifications': """
            SELECT * FROM my_notifications
        """,
        'accessible_notifications': """
            SELECT * FROM notifications
            INNER JOIN accessible_profiles ap ON notifications.profile_id = ap.profile_id
        """,

        # feedbacks
        'feedbacks_details': """
            SELECT
                fe.feedback_id,
                fe.profile_id,
                p.label AS profile_label,
                p.is_public AS profile_is_public,
                CASE WHEN p.is_public = 1 THEN fe.sender_name ELSE p.label END AS sender_name,
                CASE WHEN p.is_public = 1 THEN fe.sender_email ELSE p.email END AS sender_email,
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
            LEFT JOIN profiles p ON fe.profile_id = p.profile_id
        """,
        'my_feedbacks': """
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
            WHERE profile_id = cur_profile('profile_id')
        """,
        'accessible_my_feedbacks': """
            SELECT * FROM my_feedbacks
            INNER JOIN current_profile cp ON my_feedbacks.profile_id = cp.profile_id
            WHERE cp.is_public = 0
        """,
        'accessible_feedbacks': """
            SELECT
                *,
                p.label AS closed_by_label
            FROM feedbacks_details fe
            LEFT JOIN profiles p ON fe.closed_by = p.profile_id
            WHERE cur_profile('profile_id') = (SELECT developer_id FROM settings WHERE id = 1 LIMIT 1)
        """,

        # images
        'accessible_images': '''
            SELECT
                i.*,
                ai1.image_id IS NOT NULL AS is_archived,
                ai2.image_id IS NOT NULL AS is_favorite
            FROM images i
            INNER JOIN images_accessibility ia ON i.image_id = ia.image_id
            INNER JOIN events e ON e.event_id = ia.event_id
            LEFT JOIN (
                albums_accessibility_helper aa1
                INNER JOIN albums_images ai1 ON
                    aa1.album_id = ai1.album_id
                    AND aa1.is_accessible = 1
            ) ON
                ai1.image_id = ia.image_id
                AND aa1.profile_id = ia.profile_id
                AND aa1.album_id = e.archive_album_id
            LEFT JOIN (
                albums_accessibility_helper aa2
                INNER JOIN albums_images ai2 ON
                    aa2.album_id = ai2.album_id
                    AND aa2.is_accessible = 1
            ) ON
                ai2.image_id = ia.image_id
                AND aa2.profile_id = ia.profile_id
                AND aa2.album_id = e.favorites_album_id
            WHERE
                ia.event_id = cur_event_profile('event_id')
                AND ia.profile_id = cur_profile('profile_id')
                AND ia.is_accessible = 1
        ''',

        # faces
        'accessible_faces': '''
            SELECT
                f.*,
                i.upload_id
            FROM faces f 
            INNER JOIN images i ON f.image_id = i.image_id
            INNER JOIN faces_accessibility fa ON
                f.face_id = fa.face_id
                AND fa.profile_id = cur_profile('profile_id')
                AND fa.is_accessible = 1
                AND fa.event_id = cur_event_profile('event_id')
                AND fa.is_accessible = 1
        ''',

        # groups
        'groups_images': '''
            SELECT
                i.image_id as image_id,
                g.group_id as group_id
            FROM images i
            INNER JOIN faces f ON i.image_id = f.image_id
            INNER JOIN groups g ON f.group_id = g.group_id
            GROUP BY i.image_id, g.group_id
        ''',
        'accessible_groups_images': '''
            SELECT
                ai.image_id as image_id,
                af.group_id as group_id
            FROM accessible_images ai
            INNER JOIN accessible_faces af ON ai.image_id = af.image_id
            INNER JOIN groups_accessibility ga ON
                af.group_id = ga.group_id
                AND ga.profile_id = cur_profile('profile_id')
                AND ga.is_accessible = 1
                AND ga.event_id = cur_event_profile('event_id')
            GROUP BY ai.image_id, af.group_id
        ''',
        'accessible_groups': '''
            SELECT 
                g.*,
                rf.image_id as representative_image,
                COUNT(DISTINCT af.face_id) AS faces_count,
                COUNT(DISTINCT agi.image_id) AS images_count,
                COUNT(DISTINCT CASE WHEN ai.is_archived = 0 THEN agi.image_id END) AS active_images_count
            FROM (
                groups g
                LEFT JOIN faces rf ON g.representative_face = rf.face_id
            )
            INNER JOIN groups_accessibility ga ON
                g.group_id = ga.group_id
                AND ga.profile_id = cur_profile('profile_id')
                AND ga.is_accessible = 1
                AND ga.event_id = cur_event_profile('event_id')
            LEFT JOIN (
                accessible_groups_images agi
                INNER JOIN accessible_images ai ON agi.image_id = ai.image_id
            ) ON g.group_id = agi.group_id
            LEFT JOIN accessible_faces af ON af.group_id = g.group_id
            GROUP BY g.group_id
        ''',

        # moments
        'accessible_moments': '''
            SELECT m.*,
            COUNT(ai.image_id) as images_count,
            COUNT(ai.image_id) - COALESCE(SUM(ai.is_archived), 0) AS active_images_count
            FROM moments m
            INNER JOIN moments_accessibility ma ON m.moment_id = ma.moment_id
            LEFT JOIN accessible_images ai ON ma.moment_id = ai.moment_id
            WHERE
                ma.event_id = cur_event_profile('event_id')
                AND ma.profile_id = cur_profile('profile_id')
                AND ma.is_accessible = 1
            GROUP BY m.moment_id
        ''',

        # albums
        'albums_images_actual': '''
            SELECT albums_images.*
            FROM albums_images
            INNER JOIN albums ON albums_images.album_id = albums.album_id
            INNER JOIN events e ON albums.event_id = e.event_id
            WHERE albums.album_id <> e.archive_album_id AND albums.album_id <> e.favorites_album_id
            AND albums.event_id = cur_event_profile('event_id')
        ''',
        'accessible_albums_images': '''
            SELECT ali.*
            FROM albums_images ali
            INNER JOIN accessible_images ai ON ali.image_id = ai.image_id
            INNER JOIN albums_accessibility aa ON ali.album_id = aa.album_id
            WHERE
                aa.event_id = cur_event_profile('event_id')
                AND aa.profile_id = cur_profile('profile_id')
                AND aa.is_accessible = 1
        ''',
        'accessible_albums_images_actual': '''
            SELECT aia.*
            FROM albums_images_actual aia
            INNER JOIN accessible_images ai ON aia.image_id = ai.image_id
            INNER JOIN albums_accessibility aa ON aia.album_id = aa.album_id
            WHERE
                aa.event_id = cur_event_profile('event_id')
                AND aa.profile_id = cur_profile('profile_id')
                AND aa.is_accessible = 1
        ''',
        'accessible_albums': '''
            SELECT a.*,
            COUNT(ai.image_id) as images_count,
            COUNT(ai.image_id) - COALESCE(SUM(ai.is_archived), 0) AS active_images_count
            FROM albums a
            INNER JOIN albums_accessibility aa ON a.album_id = aa.album_id
            LEFT JOIN (
                accessible_albums_images aai
                INNER JOIN accessible_images ai ON aai.image_id = ai.image_id
            ) ON aa.album_id = aai.album_id
            WHERE
                aa.event_id = cur_event_profile('event_id')
                AND aa.profile_id = cur_profile('profile_id')
                AND aa.is_accessible = 1
            GROUP BY aa.album_id
        ''',

        # uploads
        'uploads_details': '''
            SELECT
                u.*,
                p.label AS profile_label
            FROM uploads u
            INNER JOIN profiles p ON u.profile_id = p.profile_id
            WHERE u.event_id = cur_event_profile('event_id')
        ''',
        'accessible_uploads': '''
            SELECT u.*
            FROM uploads_details u
            WHERE cur_event_profile('can_upload_and_delete_images') = 1
        ''',
        'uploads_groups': '''
            SELECT u.*,
            g.group_id as group_id
            FROM uploads u
            INNER JOIN images i ON u.upload_id = i.upload_id
            INNER JOIN faces f ON i.image_id = f.image_id
            INNER JOIN groups g ON f.group_id = g.group_id
            WHERE u.event_id = cur_event_profile('event_id')
            GROUP BY u.upload_id, g.group_id
        ''',
        'accessible_uploads_groups': '''
            SELECT u.*,
            g.group_id as group_id,
            g.faces_count as group_faces_count,
            COUNT(DISTINCT f.face_id) as group_upload_faces_count
            FROM accessible_uploads u
            INNER JOIN accessible_images i ON u.upload_id = i.upload_id
            INNER JOIN accessible_faces f ON i.image_id = f.image_id
            INNER JOIN accessible_groups g ON f.group_id = g.group_id
            GROUP BY u.upload_id, g.group_id
        ''',
        'uploads_moments': '''
            SELECT u.*, m.moment_id as moment_id
            FROM uploads u
            INNER JOIN images i ON u.upload_id = i.upload_id
            INNER JOIN moments m ON i.moment_id = m.moment_id
            WHERE u.event_id = cur_event_profile('event_id')
            GROUP BY u.upload_id, m.moment_id
        ''',
        'accessible_uploads_moments': '''
            SELECT u.*,
            m.moment_id as moment_id,
            m.images_count as moment_images_count,
            COUNT(DISTINCT i.image_id) as moment_upload_images_count
            FROM accessible_uploads u
            INNER JOIN accessible_images i ON u.upload_id = i.upload_id
            INNER JOIN accessible_moments m ON i.moment_id = m.moment_id
            GROUP BY u.upload_id, m.moment_id
        ''',
        'uploads_faces': '''
            SELECT u.upload_id, f.face_id, f.group_id
            FROM uploads u
            INNER JOIN images i ON u.upload_id = i.upload_id
            INNER JOIN faces f ON i.image_id = f.image_id
            WHERE u.event_id = cur_event_profile('event_id')
        ''',
        'accessible_uploads_faces': '''
            SELECT u.upload_id, f.face_id, f.group_id
            FROM accessible_uploads u
            INNER JOIN accessible_images i ON u.upload_id = i.upload_id
            INNER JOIN accessible_faces f ON i.image_id = f.image_id
        ''',

        # access requests
        'access_requests_groups_details': '''
            SELECT arg.*,
            ga.is_accessible
            FROM access_requests_groups arg
            INNER JOIN groups_accessibility ga ON
                arg.group_id = ga.group_id
                AND ga.profile_id = cur_profile('profile_id')
                AND ga.event_id = cur_event_profile('event_id')
        ''',
        'access_requests_details': '''
            SELECT
                ar.*,
                p.label AS profile_label,
                COUNT(argd.group_id) AS groups_count,
                COALESCE(SUM(argd.is_accessible), 0) AS accessible_groups_count,
                COALESCE(SUM(argd.approved), 0) AS approved_groups_count,
                SUM(1 - COALESCE(argd.approved, 1)) AS rejected_groups_count,
                SUM(argd.approved IS NULL) AS pending_groups_count,
                CASE 
                    WHEN
                        ar.is_closed = 0
                    THEN
                        'pending'
                    ELSE
                        (CASE
                            WHEN
                                COALESCE(SUM(argd.approved), 0) = COUNT(argd.group_id)
                            THEN
                                'approved'
                            WHEN
                                COALESCE(SUM(argd.approved), 0) = 0
                            THEN
                                'rejected'
                            ELSE
                                'mixed'
                        END)
                END AS status
            FROM access_requests ar
            INNER JOIN profiles p ON ((ar.profile_id = p.profile_id AND ar.applicant_profile_id IS NULL) OR ar.applicant_profile_id = p.profile_id)
            LEFT JOIN access_requests_groups_details argd ON ar.access_request_id = argd.access_request_id
            WHERE ar.event_id = cur_event_profile('event_id')
            GROUP BY ar.access_request_id
        ''',
        'my_access_requests': '''
            SELECT ard.*
            FROM access_requests_details ard
            WHERE ard.applicant_profile_id = cur_profile('profile_id')
        ''',
        'accessible_my_access_requests': '''
            SELECT mar.*
            FROM my_access_requests mar
            INNER JOIN current_profile cp ON mar.applicant_profile_id = cp.profile_id
            WHERE cp.is_public = 0
        ''',
        'my_access_requests_groups': '''
            SELECT argd.*
            FROM access_requests_groups_details argd
            INNER JOIN my_access_requests mar ON argd.access_request_id = mar.access_request_id;
        ''',
        'accessible_my_access_requests_groups': '''
            SELECT marg.*
            FROM my_access_requests_groups marg
        ''',
        'accessible_access_requests': '''
            SELECT ard.*
            FROM access_requests_details ard
            INNER JOIN accessible_profiles ap ON ard.profile_id = ap.profile_id AND ap.profile_id <> cur_profile('profile_id')
            WHERE ard.accessible_groups_count > 0 OR ard.groups_count = 0
        ''',
        'accessible_access_requests_groups': '''
            SELECT ag.*
            FROM access_requests_groups ag
            INNER JOIN accessible_access_requests ar ON ag.access_request_id = ar.access_request_id
            INNER JOIN groups_accessibility ga ON
                ag.group_id = ga.group_id
                AND ga.profile_id = cur_profile('profile_id')
                AND ga.is_accessible = 1
                AND ga.event_id = cur_event_profile('event_id')
        ''',
        'ensure_access_requests_closed': '''
            SELECT *
            FROM access_requests
        ''',

        # uuid
        'uuid': '''
            SELECT LOWER(
            substr(hex(randomblob(16)), 1, 8) || '-' ||
            substr(hex(randomblob(16)), 9, 4) || '-' ||
            substr(hex(randomblob(16)), 13, 4) || '-' ||
            substr(hex(randomblob(16)), 17, 4) || '-' ||
            substr(hex(randomblob(16)), 21, 12)
        ) AS uuid
        ''',
    }

def TRIGGERS() -> dict:
    return {
        # settings
        'trg_accessible_settings_update': """
            INSTEAD OF UPDATE ON accessible_settings
            BEGIN
                SELECT CASE
                    WHEN cur_profile('profile_id') <> (SELECT developer_id FROM settings WHERE id = 1 LIMIT 1) THEN
                        RAISE(ABORT, 'Permission denied: only developer can update settings')
                END;

                UPDATE settings SET
                    image_size_limit_bytes = NEW.image_size_limit_bytes,
                    images_count_limit = NEW.images_count_limit,
                    min_rank_to_create_event = NEW.min_rank_to_create_event,
                    rekognition_calls_limit = NEW.rekognition_calls_limit
                WHERE id = 1;
            END;
        """,

        # rekognition usage
        'trg_accessible_rekognition_usaged_insert': """
            INSTEAD OF INSERT ON accessible_rekognition_usaged
            BEGIN
                SELECT CASE
                    WHEN cur_profile('profile_id') <> (SELECT developer_id FROM settings WHERE id = 1 LIMIT 1) THEN
                        RAISE(ABORT, 'Permission denied: only developer can insert rekognition usage')
                END;

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
            END;
        """,

        # events
        'trg_accessible_events_insert': """
            INSTEAD OF INSERT ON accessible_events
            BEGIN
                SELECT CASE
                    WHEN cur_profile('can_create_events') = 0 THEN
                        RAISE(ABORT, 'Permission denied: cannot create event')
                END;

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
                    COALESCE(NEW.is_public, 0),
                    COALESCE(NEW.images_count_limit, 0),
                    COALESCE(NEW.image_size_limit_bytes, NULL),
                    NEW.representative_image,
                    COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
                    cur_profile('profile_id'),
                    (SELECT rekognition_calls_limit FROM settings WHERE id = 1 LIMIT 1)
                );

                INSERT OR IGNORE INTO events_profiles (
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
                VALUES (cur_profile('profile_id'), NEW.event_id, 1, 1, 1, 1, 1, 1, 1);
            END;
        """,
        'trg_accessible_events_update': """
            INSTEAD OF UPDATE ON accessible_events
            BEGIN
                SELECT CASE
                    WHEN (
                        SELECT can_manage_event
                        FROM events_profiles
                        WHERE profile_id = cur_profile('profile_id') AND event_id = OLD.event_id
                    ) = 0
                    THEN
                        RAISE(ABORT, 'Permission denied: cannot manage event')
                    WHEN NEW.rekognition_calls_limit <> OLD.rekognition_calls_limit AND (
                        SELECT can_upload_and_delete_images
                        FROM events_profiles
                        WHERE profile_id = cur_profile('profile_id') AND event_id = OLD.event_id
                    ) = 0
                    THEN
                        RAISE(ABORT, 'Permission denied: cannot update rekognition calls limit if cannot upload and delete images')
                    WHEN NEW.rekognition_calls_used <> OLD.rekognition_calls_used THEN
                        RAISE(ABORT, 'Policy error: cannot update rekognition calls used')
                    WHEN NEW.rekognition_calls_limit <> (
                        SELECT rekognition_calls_limit FROM settings WHERE id = 1 LIMIT 1
                    ) AND cur_profile('profile_id') <> (
                        SELECT developer_id FROM settings WHERE id = 1 LIMIT 1
                    )
                    THEN
                        RAISE(ABORT, 'Permission denied: cannot update rekognition calls limit')
                END;

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
            END;
        """,
        'trg_accessible_events_delete': """
            INSTEAD OF DELETE ON accessible_events
            BEGIN
                SELECT CASE
                    WHEN (
                        SELECT can_delete_event
                        FROM events_profiles
                        WHERE event_id = OLD.event_id AND profile_id = cur_profile('profile_id')
                    ) = 0
                    THEN
                        RAISE(ABORT, 'Permission denied: cannot delete event')
                    WHEN (SELECT event_in_deletion FROM settings WHERE id = 1 LIMIT 1) IS NOT NULL THEN
                        RAISE(ABORT, 'Policy error: other event is in deletion. Try again later')
                END;

                -- TODO: use transaction
                UPDATE settings SET
                    event_in_deletion = OLD.event_id
                WHERE id = 1;
                
                DELETE FROM profiles
                WHERE restricted_to_event = OLD.event_id;

                DELETE FROM events
                WHERE event_id = OLD.event_id;

                UPDATE settings SET
                    event_in_deletion = NULL
                WHERE id = 1;

            END;
        """,

        # current_profile
        'trg_current_profile_update': """
            INSTEAD OF UPDATE ON current_profile
            BEGIN
                SELECT CASE
                    WHEN cur_profile('is_public') = 1 THEN
                        RAISE(ABORT, 'Permission denied: cannot update current profile to a public profile')
                END;

                UPDATE profiles SET
                    label = NEW.label,
                    email = NEW.email,
                    password = NEW.password
                WHERE profile_id = cur_profile('profile_id');
            END;
        """,

        # accessible_profiles
        'trg_accessible_profiles_insert': """
            INSTEAD OF INSERT ON accessible_profiles
            BEGIN
                SELECT CASE
                    WHEN cur_profile('hierarchy_rank') = 0 THEN
                        RAISE(ABORT, 'Permission denied: not a profiles manager')
                    WHEN NEW.hierarchy_rank >= cur_profile('hierarchy_rank') THEN
                        RAISE(ABORT, 'Permission denied: cannot create profile with higher or equal rank')
                    WHEN NEW.can_create_events = 1 AND cur_profile('hierarchy_rank') <= (
                        SELECT min_rank_to_create_event FROM settings WHERE id = 1 LIMIT 1
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the profile dose not have permission to manage create events permissions')
                    WHEN NEW.restricted_to_event IS NOT NULL AND cur_profile('restricted_to_event') <> COALESCE(NEW.restricted_to_event, '') THEN
                        RAISE(ABORT, 'Permission denied: cannot create profile to a different event than the current profile')
                    WHEN NEW.restricted_to_event IS NOT NULL AND NEW.restricted_to_event NOT IN (SELECT event_id FROM accessible_events) THEN
                        RAISE(ABORT, 'Permission denied: the event is not accessible')
                END;

                INSERT INTO profiles (profile_id, label, email, password, hierarchy_rank, can_create_events, restricted_to_event, is_public)
                VALUES (
                    NEW.profile_id,
                    NEW.label,
                    NEW.email,
                    NEW.password,
                    COALESCE(NEW.hierarchy_rank, 0),
                    COALESCE(NEW.can_create_events, 0),
                    NEW.restricted_to_event,
                    COALESCE(NEW.is_public, 0)
                );
            END;
        """,
        'trg_accessible_profiles_update': """
            INSTEAD OF UPDATE ON accessible_profiles
            BEGIN
                SELECT CASE
                    WHEN OLD.profile_id NOT IN (
                        SELECT profile_id FROM accessible_profiles ap
                        WHERE ap.profile_id = OLD.profile_id
                        AND ap.is_editable = 1
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the profile is not accessible')
                    WHEN NEW.hierarchy_rank >= cur_profile('hierarchy_rank') AND NEW.profile_id <> cur_profile('profile_id') THEN
                        RAISE(ABORT, 'Permission denied: cannot update profile to a higher or equal rank than the current profile')
                    WHEN
                        NEW.can_create_events = 1 AND OLD.can_create_events = 0
                        AND cur_profile('hierarchy_rank') <= (
                            SELECT min_rank_to_create_event FROM settings WHERE id = 1 LIMIT 1
                        )
                    THEN
                        RAISE(ABORT, 'Permission denied: the profile dose not have permission to manage create events permissions')
                    WHEN NEW.restricted_to_event IS NOT NULL AND cur_profile('restricted_to_event') <> COALESCE(NEW.restricted_to_event, '') THEN
                        RAISE(ABORT, 'Permission denied: cannot update profile to a different event than the current profile')
                    WHEN NEW.restricted_to_event IS NOT NULL AND NEW.restricted_to_event NOT IN (SELECT event_id FROM accessible_events) THEN
                        RAISE(ABORT, 'Permission denied: the event is not accessible')
                END;

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
            END;
        """,
        'trg_accessible_profiles_delete': """
            INSTEAD OF DELETE ON accessible_profiles
            BEGIN
                SELECT CASE
                    WHEN OLD.profile_id NOT IN (
                        SELECT profile_id FROM accessible_profiles ap
                        WHERE ap.profile_id = OLD.profile_id
                        AND ap.is_editable = 1
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the profile is not accessible')
                    WHEN EXISTS (
                        SELECT 1
                        FROM events_profiles ep
                        WHERE ep.profile_id = OLD.profile_id
                    ) THEN
                        RAISE(ABORT, 'Policy error: the profile is associated with an event. Please remove the profile from all events first.')
                END;

                DELETE FROM profiles
                WHERE profile_id = OLD.profile_id;
            END;
        """,

        # my_preferences
        'trg_my_preferences_update': """
            INSTEAD OF UPDATE ON my_preferences
            BEGIN
                SELECT CASE
                    WHEN cur_profile('profile_id') <> OLD.profile_id THEN
                        RAISE(ABORT, 'Permission denied: cannot update preferences for another profile')
                END;

                UPDATE profiles_preferences SET
                    preference_value = NEW.preference_value
                WHERE profile_id = OLD.profile_id AND preference_group = OLD.preference_group AND preference_key = OLD.preference_key;
            END;
        """,

        # notifications
        'trg_accessible_notifications_insert': """
            INSTEAD OF INSERT ON accessible_notifications
            BEGIN
                SELECT CASE
                    WHEN NEW.profile_id NOT IN (
                        SELECT profile_id FROM accessible_profiles
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the profile is not accessible')
                END;

                INSERT INTO notifications (profile_id, message, created_at, read, type, data)
                VALUES (NEW.profile_id, NEW.message, COALESCE(NEW.created_at, CURRENT_TIMESTAMP), COALESCE(NEW.read, 0), NEW.type, NEW.data);
            END;
        """,
        
        # my_notifications
        'trg_accessible_my_notifications_update': """
            INSTEAD OF UPDATE ON accessible_my_notifications
            BEGIN
                SELECT CASE
                    WHEN cur_profile('profile_id') <> OLD.profile_id THEN
                        RAISE(ABORT, 'Permission denied: the notification is not accessible')
                END;

                UPDATE notifications SET
                    read = COALESCE(NEW.read, read),
                    read_at = COALESCE(NEW.read_at, CURRENT_TIMESTAMP)
                WHERE notification_id = OLD.notification_id;
            END;
        """,
        'trg_accessible_my_notifications_delete': """
            INSTEAD OF DELETE ON accessible_my_notifications
            BEGIN
                SELECT CASE
                    WHEN cur_profile('profile_id') <> OLD.profile_id THEN
                        RAISE(ABORT, 'Permission denied: the notification is not accessible')
                END;

                DELETE FROM notifications
                WHERE notification_id = OLD.notification_id;
            END;
        """,

        # my_feedbacks
        'trg_accessible_my_feedbacks_insert': """
            INSTEAD OF INSERT ON accessible_my_feedbacks
            BEGIN
                SELECT CASE
                    WHEN NEW.profile_id <> cur_profile('profile_id') THEN
                        RAISE(ABORT, 'Permission denied: cannot create feedback for another profile')
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
                    diagnostics
                )
                VALUES (
                    NEW.profile_id,
                    NEW.sender_name,
                    NEW.sender_email,
                    COALESCE(CASE WHEN NEW.sender_email IS NOT NULL THEN 1 ELSE NEW.communication_consent END, 0),
                    NEW.title,
                    COALESCE(NEW.type, 0),
                    NEW.message,
                    COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
                    NEW.user_agent,
                    NEW.ip_address,
                    NEW.diagnostics
                );
            
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
                    0,
                    'feedback',
                    last_insert_rowid()
                FROM settings
                WHERE settings.id = 1;
            END;
        """,
        'trg_accessible_my_feedbacks_update': """
            INSTEAD OF UPDATE ON accessible_my_feedbacks
            BEGIN
                SELECT CASE
                    WHEN OLD.profile_id <> cur_profile('profile_id') THEN
                        RAISE(ABORT, 'Permission denied: cannot update feedback for another profile')
                    WHEN cur_profile('is_public') = 1 THEN
                        RAISE(ABORT, 'Permission denied: the feedback is not accessible')
                    WHEN OLD.is_closed = 1 THEN
                        RAISE(ABORT, 'Permission denied: cannot update closed feedback')
                END;

                UPDATE feedbacks SET
                    title = NEW.title,
                    type = NEW.type,
                    message = NEW.message,
                    communication_consent = COALESCE(CASE WHEN NEW.sender_email IS NOT NULL THEN 1 ELSE NEW.communication_consent END, 0)
                WHERE feedback_id = OLD.feedback_id;
            END;
        """,
        'trg_accessible_my_feedbacks_delete': """
            INSTEAD OF DELETE ON accessible_my_feedbacks
            BEGIN
                SELECT CASE
                    WHEN OLD.profile_id <> cur_profile('profile_id') THEN
                        RAISE(ABORT, 'Permission denied: cannot delete feedback for another profile')
                    WHEN cur_profile('is_public') = 1 THEN
                        RAISE(ABORT, 'Permission denied: the feedback is not accessible')
                    WHEN OLD.is_closed = 1 THEN
                        RAISE(ABORT, 'Permission denied: cannot delete closed feedback')
                END;

                DELETE FROM feedbacks
                WHERE feedback_id = OLD.feedback_id;
            END;
        """,

        # accessible_feedbacks
        'trg_accessible_feedbacks_update': """
            INSTEAD OF UPDATE ON accessible_feedbacks
            BEGIN
                SELECT CASE
                    WHEN cur_profile('profile_id') <> (SELECT developer_id FROM settings WHERE id = 1 LIMIT 1) THEN
                        RAISE(ABORT, 'Permission denied: only developer can update feedbacks')
                END;

                UPDATE feedbacks SET
                    type = NEW.type,
                    notes = NEW.notes,
                    is_closed = NEW.is_closed,
                    solved = NEW.solved,
                    closed_at = COALESCE(NEW.closed_at, CURRENT_TIMESTAMP),
                    closed_by = cur_profile('profile_id'),
                    closed_details = NEW.closed_details
                WHERE feedback_id = OLD.feedback_id;

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
                    0,
                    'my_feedback',
                    feedback_id
                FROM feedbacks
                INNER JOIN profiles p ON feedbacks.profile_id = p.profile_id
                WHERE feedback_id = OLD.feedback_id
                AND NEW.is_closed = 1
                AND p.is_public = 0;
            END;
        """,
        'trg_accessible_feedbacks_delete': """
            INSTEAD OF DELETE ON accessible_feedbacks
            BEGIN
                SELECT CASE
                    WHEN cur_profile('profile_id') <> (SELECT developer_id FROM settings WHERE id = 1 LIMIT 1) THEN
                        RAISE(ABORT, 'Permission denied: only developer can delete feedbacks')
                END;

                DELETE FROM feedbacks
                WHERE feedback_id = OLD.feedback_id;
            END;
        """,

        # accessible_events_profiles
        'trg_insert_accessible_events_profiles': """
            INSTEAD OF INSERT ON accessible_events_profiles
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN NEW.profile_id NOT IN (
                        SELECT profile_id
                        FROM accessible_profiles ap
                        WHERE ap.is_editable = 1
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the profile is not accessible')
                    WHEN NEW.all_images = 1 and cur_event_profile('all_images') = 0 THEN
                        RAISE(ABORT, 'Permission denied: cannot create profile with all_images=1 if current profile does not have all_images=1')
                    WHEN NEW.all_groups = 1 and cur_event_profile('all_groups') = 0 THEN
                        RAISE(ABORT, 'Permission denied: cannot create profile with all_groups=1 if current profile does not have all_groups=1')
                    WHEN NEW.all_albums = 1 and cur_event_profile('all_albums') = 0 THEN
                        RAISE(ABORT, 'Permission denied: cannot create profile with all_albums=1 if current profile does not have all_albums=1')
                END;

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
                    COALESCE(NEW.can_manage_event, 0),
                    COALESCE(NEW.can_delete_event, 0),
                    COALESCE(NEW.can_upload_and_delete_images, 0),
                    COALESCE(NEW.can_edit, 0),
                    COALESCE(NEW.all_images, 0),
                    COALESCE(NEW.all_groups, 0),
                    COALESCE(NEW.all_albums, 0)
                );

                -- Create the events_profiles_images and events_profiles_groups and events_profiles_albums tables
                -- TODO: use IF
                INSERT INTO events_profiles_images (event_id, profile_id, image_id)
                SELECT epi.event_id, NEW.profile_id, epi.image_id
                FROM events_profiles_images epi
                INNER JOIN events_profiles ep ON epi.event_id = ep.event_id AND epi.profile_id = ep.profile_id
                WHERE epi.event_id = cur_event_profile('event_id')
                AND ep.profile_id = cur_profile('profile_id')
                AND ep.all_images = 1;

                INSERT INTO events_profiles_groups (event_id, profile_id, group_id)
                SELECT epg.event_id, NEW.profile_id, epg.group_id
                FROM events_profiles_groups epg
                INNER JOIN events_profiles ep ON epg.event_id = ep.event_id AND epg.profile_id = ep.profile_id
                WHERE epg.event_id = cur_event_profile('event_id')
                AND ep.profile_id = cur_profile('profile_id')
                AND ep.all_groups = 1;
                
                INSERT INTO events_profiles_albums (event_id, profile_id, album_id)
                SELECT epa.event_id, NEW.profile_id, epa.album_id
                FROM events_profiles_albums epa
                INNER JOIN events_profiles ep ON epa.event_id = ep.event_id AND epa.profile_id = ep.profile_id
                WHERE epa.event_id = cur_event_profile('event_id')
                AND ep.profile_id = cur_profile('profile_id')
                AND ep.all_albums = 1;

            END;
        """,
        'trg_update_accessible_events_profiles': """
            INSTEAD OF UPDATE ON accessible_events_profiles
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN OLD.profile_id NOT IN (
                        SELECT profile_id
                        FROM accessible_events_profiles
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the profile is not accessible')
                    WHEN NEW.all_images = 1 AND OLD.all_images = 0 AND cur_event_profile('all_images') = 0 THEN
                        RAISE(ABORT, 'Permission denied: cannot set profile all_images=1 if current profile does not have all_images=1')
                    WHEN NEW.all_groups = 1 AND OLD.all_groups = 0 AND cur_event_profile('all_groups') = 0 THEN
                        RAISE(ABORT, 'Permission denied: cannot set profile all_groups=1 if current profile does not have all_groups=1')
                    WHEN NEW.all_albums = 1 AND OLD.all_albums = 0 AND cur_event_profile('all_albums') = 0 THEN
                        RAISE(ABORT, 'Permission denied: cannot set profile all_albums=1 if current profile does not have all_albums=1')
                END;

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

                -- TODO: use IF
                DELETE FROM events_profiles_images 
                WHERE event_id = cur_event_profile('event_id')
                AND profile_id = OLD.profile_id 
                AND OLD.all_images = 1
                AND NEW.all_images = 0;

                INSERT INTO events_profiles_images (event_id, profile_id, image_id)
                SELECT epi.event_id, OLD.profile_id, epi.image_id
                FROM events_profiles_images epi
                INNER JOIN events_profiles ep ON epi.event_id = ep.event_id AND epi.profile_id = ep.profile_id
                WHERE epi.event_id = cur_event_profile('event_id')
                AND ep.profile_id = cur_profile('profile_id')
                AND NEW.all_images = 1 
                AND OLD.all_images = 0;

                DELETE FROM events_profiles_groups 
                WHERE event_id = cur_event_profile('event_id')
                AND profile_id = OLD.profile_id 
                AND OLD.all_groups = 1
                AND NEW.all_groups = 0;

                INSERT INTO events_profiles_groups (event_id, profile_id, group_id)
                SELECT epg.event_id, OLD.profile_id, epg.group_id
                FROM events_profiles_groups epg
                INNER JOIN events_profiles ep ON epg.event_id = ep.event_id AND epg.profile_id = ep.profile_id
                WHERE epg.event_id = cur_event_profile('event_id')
                AND ep.profile_id = cur_profile('profile_id')
                AND NEW.all_groups = 1 
                AND OLD.all_groups = 0;

                DELETE FROM events_profiles_albums 
                WHERE event_id = cur_event_profile('event_id')
                AND profile_id = OLD.profile_id 
                AND OLD.all_albums = 1
                AND NEW.all_albums = 0;

                INSERT INTO events_profiles_albums (event_id, profile_id, album_id)
                SELECT epa.event_id, OLD.profile_id, epa.album_id
                FROM events_profiles_albums epa
                INNER JOIN events_profiles ep ON epa.event_id = ep.event_id AND epa.profile_id = ep.profile_id
                WHERE epa.event_id = cur_event_profile('event_id')
                AND ep.profile_id = cur_profile('profile_id')
                AND NEW.all_albums = 1 
                AND OLD.all_albums = 0;

            END;
        """,
        'trg_delete_accessible_events_profiles': """
            INSTEAD OF DELETE ON accessible_events_profiles
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN OLD.profile_id NOT IN (
                        SELECT profile_id
                        FROM accessible_events_profiles
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the profile is not accessible')
                END;

                DELETE FROM events_profiles WHERE event_id = cur_event_profile('event_id') AND profile_id = OLD.profile_id;
            END;
        """,

        # accessible_events_profiles_images
        'trg_insert_accessible_events_profiles_images': """
            INSTEAD OF INSERT ON accessible_events_profiles_images
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN NEW.profile_id NOT IN (
                        SELECT profile_id
                        FROM accessible_events_profiles
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the profile is not accessible')
                    WHEN NOT EXISTS (
                        SELECT 1
                        FROM accessible_images
                        WHERE image_id = NEW.image_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the image is not accessible')
                END;

                INSERT OR IGNORE INTO events_profiles_images (event_id, profile_id, image_id)
                VALUES (cur_event_profile('event_id'), NEW.profile_id, NEW.image_id);
            END;
        """,
        'trg_delete_accessible_events_profiles_images': """
            INSTEAD OF DELETE ON accessible_events_profiles_images
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN OLD.profile_id NOT IN (
                        SELECT profile_id
                        FROM accessible_events_profiles
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the profile is not accessible')
                    WHEN NOT EXISTS (
                        SELECT 1
                        FROM accessible_images
                        WHERE image_id = OLD.image_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the image is not accessible')
                END;

                DELETE FROM events_profiles_images
                WHERE event_id = cur_event_profile('event_id')
                AND profile_id = OLD.profile_id
                AND image_id = OLD.image_id;
            END;
        """,

        # accessible_events_profiles_groups
        'trg_insert_accessible_events_profiles_groups': """
            INSTEAD OF INSERT ON accessible_events_profiles_groups
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN NEW.profile_id NOT IN (
                        SELECT profile_id
                        FROM accessible_events_profiles
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the profile is not accessible')
                    WHEN NOT EXISTS (
                        SELECT 1
                        FROM accessible_groups
                        WHERE group_id = NEW.group_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the group is not accessible')
                END;

                INSERT OR IGNORE INTO events_profiles_groups (event_id, profile_id, group_id)
                VALUES (cur_event_profile('event_id'), NEW.profile_id, NEW.group_id);
            END;
        """,
        'trg_delete_accessible_events_profiles_groups': """
            INSTEAD OF DELETE ON accessible_events_profiles_groups
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN OLD.profile_id NOT IN (
                        SELECT profile_id
                        FROM accessible_events_profiles
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the profile is not accessible')
                    WHEN NOT EXISTS (
                        SELECT 1
                        FROM accessible_groups
                        WHERE group_id = OLD.group_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the group is not accessible')
                END;

                DELETE FROM events_profiles_groups
                WHERE event_id = cur_event_profile('event_id')
                AND profile_id = OLD.profile_id
                AND group_id = OLD.group_id;
            END;
        """,

        # accessible_events_profiles_albums
        'trg_insert_accessible_events_profiles_albums': """
            INSTEAD OF INSERT ON accessible_events_profiles_albums
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN NEW.profile_id NOT IN (
                        SELECT profile_id
                        FROM accessible_events_profiles
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the profile is not accessible')
                    WHEN NOT EXISTS (
                        SELECT 1 FROM accessible_albums
                        WHERE album_id = NEW.album_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the album is not accessible')
                END;

                INSERT OR IGNORE INTO events_profiles_albums (event_id, profile_id, album_id)
                VALUES (cur_event_profile('event_id'), NEW.profile_id, NEW.album_id);
            END;
        """,
        'trg_delete_accessible_events_profiles_albums': """
            INSTEAD OF DELETE ON accessible_events_profiles_albums
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN OLD.profile_id NOT IN (
                        SELECT profile_id
                        FROM accessible_events_profiles
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the profile is not accessible')
                    WHEN NOT EXISTS (
                        SELECT 1 FROM accessible_albums
                        WHERE album_id = OLD.album_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the album is not accessible')
                END;

                DELETE FROM events_profiles_albums
                WHERE event_id = cur_event_profile('event_id')
                AND profile_id = OLD.profile_id
                AND album_id = OLD.album_id;
            END;
        """,

        # accessible_faces
        'trg_update_accessible_faces': """
            INSTEAD OF UPDATE ON accessible_faces
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_edit') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    WHEN OLD.face_id NOT IN (SELECT face_id FROM accessible_faces) THEN
                        RAISE(ABORT, 'Permission denied: the face is not accessible')
                    WHEN NEW.group_ID IS NOT NULL AND NEW.group_ID NOT IN (SELECT group_id FROM accessible_groups) THEN
                        RAISE(ABORT, 'Permission denied: the target group is not accessible')
                END;

                UPDATE faces
                SET group_id = NEW.group_id
                WHERE face_id = OLD.face_id;
            END;
        """,
        'trg_delete_accessible_faces': """
            INSTEAD OF DELETE ON accessible_faces
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_upload_and_delete_images') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    WHEN NOT EXISTS (
                        SELECT 1 FROM accessible_faces
                        WHERE face_id = OLD.face_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the face is not accessible')
                END;

                DELETE FROM faces
                WHERE face_id = OLD.face_id;
            END;
        """,
        'trg_insert_accessible_faces': """
            INSTEAD OF INSERT ON accessible_faces
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_upload_and_delete_images') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to upload images')
                    WHEN NOT EXISTS (
                        SELECT 1 FROM accessible_images
                        WHERE image_id = NEW.image_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the image is not accessible')
                    WHEN NOT EXISTS (
                        SELECT 1 FROM accessible_groups
                        WHERE group_id = NEW.group_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the group is not accessible')
                END;

                INSERT INTO faces (
                    face_id,
                    image_id,
                    group_id,
                    face_width,
                    face_height,
                    face_left,
                    face_top
                )
                VALUES (
                    NEW.face_id,
                    NEW.image_id,
                    NEW.group_id,
                    COALESCE(NEW.face_width, 0),
                    COALESCE(NEW.face_height, 0),
                    COALESCE(NEW.face_left, 0),
                    COALESCE(NEW.face_top, 0)
                );
            END;
        """,

        # accessible_images
        'trg_update_accessible_images': """
            INSTEAD OF UPDATE ON accessible_images
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_edit') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                END;

                UPDATE images
                SET
                    description = NEW.description,
                    moment_id = NEW.moment_id
                WHERE image_id = OLD.image_id;
            END;
        """,
        'trg_delete_accessible_images': """
            INSTEAD OF DELETE ON accessible_images
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_upload_and_delete_images') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to delete images')
                END;

                DELETE FROM images
                WHERE image_id = OLD.image_id;
            END;
        """,
        'trg_insert_accessible_images': """
            INSTEAD OF INSERT ON accessible_images
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_upload_and_delete_images') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to upload images')
                END;

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

                -- TODO: use IF
                INSERT OR IGNORE INTO events_profiles_images (event_id, profile_id, image_id)
                SELECT cur_event_profile('event_id'), profile_id, NEW.image_id
                FROM current_event_profile
                WHERE event_id = cur_event_profile('event_id')
                AND profile_id = cur_profile('profile_id')
                AND all_images = 0;
            END;
        """,

        # accessible_groups
        'trg_update_accessible_groups': """
            INSTEAD OF UPDATE ON accessible_groups
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_edit') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    WHEN OLD.group_ID NOT IN (SELECT group_id FROM accessible_groups) THEN
                        RAISE(ABORT, 'Permission denied: the group is not accessible')
                END;

                UPDATE groups
                SET label = NEW.label,
                    representative_face = NEW.representative_face
                WHERE group_id = OLD.group_id;
            END;
        """,
        'trg_delete_accessible_groups': """
            INSTEAD OF DELETE ON accessible_groups
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_edit') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                    WHEN OLD.group_ID NOT IN (SELECT group_id FROM accessible_groups) THEN
                        RAISE(ABORT, 'Permission denied: the group is not accessible')
                END;

                DELETE FROM groups
                WHERE group_id = OLD.group_id;
            END;
        """,
        'trg_insert_accessible_groups': """
            INSTEAD OF INSERT ON accessible_groups
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_edit') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                END;

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
            END;
        """,

        # accessible_moments
        'trg_update_accessible_moments': """
            INSTEAD OF UPDATE ON accessible_moments
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_edit') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                END;

                UPDATE moments
                SET label = NEW.label,
                    description = NEW.description,
                    start = NEW.start,
                    end = NEW.end,
                    representative_image = NEW.representative_image
                WHERE moment_id = OLD.moment_id;
            END;
        """,
        'trg_delete_accessible_moments': """
            INSTEAD OF DELETE ON accessible_moments
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_edit') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                END;

                DELETE FROM moments
                WHERE moment_id = OLD.moment_id;
            END;
        """,
        'trg_insert_accessible_moments': """
            INSTEAD OF INSERT ON accessible_moments
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_edit') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                END;

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
            END;
        """,

        # accessible_albums
        'trg_update_accessible_albums': """
            INSTEAD OF UPDATE ON accessible_albums
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_edit') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                END;

                UPDATE albums
                SET label = NEW.label,
                    description = NEW.description,
                    representative_image = NEW.representative_image
                WHERE album_id = OLD.album_id;
            END;
        """,
        'trg_delete_accessible_albums': """
            INSTEAD OF DELETE ON accessible_albums
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_edit') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                END;

                DELETE FROM albums
                WHERE album_id = OLD.album_id;
            END;
        """,
        'trg_insert_accessible_albums': """
            INSTEAD OF INSERT ON accessible_albums
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_edit') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                END;
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
            END;
        """,

        # accessible_albums_images
        'trg_insert_accessible_albums_images': """
            INSTEAD OF INSERT ON accessible_albums_images
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_edit') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                END;

                INSERT OR IGNORE INTO albums_images (album_id, image_id)
                SELECT accessible_albums.album_id, accessible_images.image_id
                FROM accessible_albums
                JOIN accessible_images
                WHERE accessible_albums.album_id = NEW.album_id
                AND accessible_images.image_id = NEW.image_id;
            END;
        """,
        'trg_delete_accessible_albums_images': """
            INSTEAD OF DELETE ON accessible_albums_images
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_edit') = 0 THEN
                        RAISE(ABORT, 'Permission denied: the profile does not have permission to edit entities')
                END;

                DELETE FROM albums_images
                WHERE album_id = OLD.album_id
                AND image_id = OLD.image_id;
            END;
        """,

        # accessible_uploads
        'trg_insert_accessible_uploads': """
            INSTEAD OF INSERT ON accessible_uploads
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_upload_and_delete_images') = 0 THEN
                        RAISE(ABORT, 'Permission denied: cannot upload and delete images')
                END;

                INSERT OR IGNORE INTO uploads (
                    event_id,
                    profile_id,
                    started_at,
                    completed_at,
                    status,
                    images_count,
                    faces_count,
                    clusters_count,
                    moments_count, errors, notes)
                VALUES (
                    cur_event_profile('event_id'),
                    cur_profile('profile_id'),
                    NEW.started_at,
                    NEW.completed_at,
                    NEW.status,
                    COALESCE(NEW.images_count, 0),
                    COALESCE(NEW.faces_count, 0),
                    COALESCE(NEW.clusters_count, 0),
                    COALESCE(NEW.moments_count, 0),
                    NEW.errors,
                    NEW.notes
                );
                
            END;
        """,
        'trg_delete_accessible_uploads': """
            INSTEAD OF DELETE ON accessible_uploads
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_event_profile('can_upload_and_delete_images') = 0 THEN
                        RAISE(ABORT, 'Permission denied: cannot upload and delete images')
                    WHEN NOT EXISTS (
                        SELECT 1 FROM accessible_uploads
                        WHERE accessible_uploads.upload_id = OLD.upload_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the upload is not accessible')
                    WHEN OLD.profile_id <> cur_profile('profile_id') AND OLD.profile_id NOT IN (
                        SELECT profile_id FROM accessible_events_profiles
                        WHERE event_id = cur_event_profile('event_id')
                        AND profile_id = OLD.profile_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the profile is not accessible')
                END;

                DELETE FROM uploads WHERE upload_id = OLD.upload_id;
            END;
        """,
        'trg_update_accessible_uploads': """
            INSTEAD OF UPDATE ON accessible_uploads
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN OLD.profile_id <> cur_profile('profile_id') THEN
                        RAISE(ABORT, 'Permission denied: the upload is not editable')
                    WHEN NOT EXISTS (
                        SELECT 1 FROM accessible_uploads
                        WHERE accessible_uploads.upload_id = OLD.upload_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the upload is not accessible')
                    WHEN cur_event_profile('can_upload_and_delete_images') = 0 THEN
                        RAISE(ABORT, 'Permission denied: cannot upload and delete images')
                END;

                UPDATE uploads
                SET
                    completed_at = NEW.completed_at,
                    status = NEW.status,
                    images_count = NEW.images_count,
                    faces_count = NEW.faces_count,
                    clusters_count = NEW.clusters_count,
                    moments_count = NEW.moments_count,
                    errors = NEW.errors,
                    notes = NEW.notes
                WHERE upload_id = OLD.upload_id;
            END;
        """,

        # accessible_my_access_requests
        'trg_insert_accessible_my_access_requests': """
            INSTEAD OF INSERT ON accessible_my_access_requests
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN NEW.profile_id <> cur_profile('profile_id') OR (NEW.applicant_profile_id IS NOT NULL AND NEW.applicant_profile_id <> cur_profile('profile_id')) THEN
                        RAISE(ABORT, 'Permission denied: cannot create access request for another profile')
                    WHEN
                        cur_profile('is_public') = 1 AND (
                            NEW.applicant_name IS NULL
                            OR NEW.applicant_email IS NULL
                        )
                    THEN
                        RAISE(ABORT, 'Permission denied: access request by public profile is only allowed for another profile with name and email required')
                    WHEN
                        NEW.applicant_profile_id IS NULL AND COALESCE(NEW.communication_consent, 0) = 0 THEN
                            RAISE(ABORT, 'Policy error: communication consent is required for anonymous access request')
                END;

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
                    CASE WHEN cur_profile('is_public') = 1 THEN NEW.applicant_name ELSE NULL END,
                    CASE WHEN cur_profile('is_public') = 1 THEN NEW.applicant_email ELSE NULL END,
                    CASE WHEN cur_profile('is_public') = 1 THEN NEW.applicant_phone ELSE NULL END,
                    NEW.details,
                    CASE WHEN cur_profile('is_public') = 0 THEN NEW.applicant_profile_id ELSE NULL END,
                    COALESCE(CASE WHEN cur_profile('is_public') = 1 THEN 1 ELSE NEW.communication_consent END, 0)
                );
            END;
        """,
        'trg_update_accessible_my_access_requests': """
            INSTEAD OF UPDATE ON accessible_my_access_requests
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN OLD.profile_id <> cur_profile('profile_id') THEN
                        RAISE(ABORT, 'Permission denied: the access request is not accessible')
                    WHEN cur_profile('is_public') = 1 THEN
                        RAISE(ABORT, 'Permission denied: the access request is not accessible')
                    WHEN OLD.is_closed = 1 THEN
                        RAISE(ABORT, 'Permission denied: cannot update closed access request')
                END;

                UPDATE access_requests SET
                    details = NEW.details,
                    communication_consent = COALESCE(CASE WHEN cur_profile('is_public') = 1 THEN 1 ELSE NEW.communication_consent END, 0)
                WHERE access_request_id = OLD.access_request_id;
            END;
        """,
        'trg_delete_accessible_my_access_requests': """
            INSTEAD OF DELETE ON accessible_my_access_requests
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN OLD.profile_id <> cur_profile('profile_id') THEN
                        RAISE(ABORT, 'Permission denied: the access request is not accessible')
                    WHEN cur_profile('is_public') = 1 THEN
                        RAISE(ABORT, 'Permission denied: the access request is not accessible')
                    WHEN OLD.is_closed = 1 THEN
                        RAISE(ABORT, 'Permission denied: cannot delete closed access request')
                END;

                DELETE FROM access_requests WHERE access_request_id = OLD.access_request_id;
            END;
        """,

        # accessible_my_access_requests_groups
        'trg_insert_accessible_my_access_requests_groups': """
            INSTEAD OF INSERT ON accessible_my_access_requests_groups
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_profile('profile_id') <> (
                        SELECT ar.profile_id
                        FROM access_requests ar
                        WHERE NEW.access_request_id = ar.access_request_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the access request is not accessible')
                    WHEN (SELECT is_closed FROM access_requests WHERE access_request_id = NEW.access_request_id) = 1 THEN
                        RAISE(ABORT, 'Permission denied: the access request is closed')
                END;

                INSERT INTO access_requests_groups
                (access_request_id, group_id)
                SELECT NEW.access_request_id as access_request_id, cgtra.group_id
                FROM current_groups_to_request_access cgtra
                WHERE cgtra.group_id = NEW.group_id;

                -- ensure notifications
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
                    json_object('access_request_id', NEW.access_request_id, 'event_id', cur_event_profile('event_id'))
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
                        AND n.data->>'access_request_id' = NEW.access_request_id
                        AND n.data->>'event_id' = cur_event_profile('event_id')
                    )
                    AND EXISTS (
                        SELECT 1
                        FROM groups_accessibility ga
                        WHERE ga.group_id = NEW.group_id
                        AND ga.profile_id = p.profile_id
                        AND ga.event_id = cur_event_profile('event_id')
                        AND ga.is_accessible = 1
                    );

            END;
        """,
        'trg_delete_accessible_my_access_requests_groups': """
            INSTEAD OF DELETE ON accessible_my_access_requests_groups
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN cur_profile('profile_id') <> (
                        SELECT ar.profile_id
                        FROM access_requests ar
                        WHERE OLD.access_request_id = ar.access_request_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the access request is not accessible')
                    WHEN (SELECT is_closed FROM access_requests WHERE access_request_id = OLD.access_request_id) = 1 THEN
                        RAISE(ABORT, 'Permission denied: the access request is closed')
                END;

                DELETE FROM access_requests_groups WHERE access_request_id = OLD.access_request_id AND group_id = OLD.group_id;
            END;
        """,

        # accessible_access_requests
        'trg_update_accessible_access_requests': """
            INSTEAD OF UPDATE ON accessible_access_requests
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN NOT EXISTS (
                        SELECT 1 FROM accessible_access_requests
                        WHERE accessible_access_requests.access_request_id = OLD.access_request_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the access request is not accessible')
                    WHEN OLD.is_closed = 1 THEN
                        RAISE(ABORT, 'Permission denied: the access request is closed')
                END;

                UPDATE access_requests SET
                    applicant_profile_id = NEW.applicant_profile_id
                WHERE access_request_id = OLD.access_request_id;
            
            END;
        """,
        'trg_delete_accessible_access_requests': """
            INSTEAD OF DELETE ON accessible_access_requests
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN NOT EXISTS (
                        SELECT 1 FROM accessible_access_requests
                        WHERE accessible_access_requests.access_request_id = OLD.access_request_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the access request is not accessible')
                END;

                DELETE FROM access_requests WHERE access_request_id = OLD.access_request_id;
            END;
        """,

        # accessible_access_requests_groups
        'trg_update_accessible_access_requests_groups': """
            INSTEAD OF UPDATE ON accessible_access_requests_groups
            BEGIN
                SELECT CASE
                    WHEN cur_event_profile('event_id') IS NULL THEN
                        RAISE(ABORT, 'Permission denied: event not found')
                    WHEN NOT EXISTS (
                        SELECT 1 FROM accessible_access_requests aar
                        WHERE aar.access_request_id = OLD.access_request_id
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the access request is not accessible')
                    WHEN (SELECT is_closed FROM access_requests WHERE access_request_id = OLD.access_request_id) = 1 THEN
                        RAISE(ABORT, 'Permission denied: the access request is closed')
                    WHEN OLD.approved IS NOT NULL THEN
                        RAISE(ABORT, 'Permission denied: the access request group is closed')
                    WHEN NEW.approved = 1 AND OLD.group_id NOT IN (
                        SELECT group_id FROM accessible_groups
                    ) THEN
                        RAISE(ABORT, 'Permission denied: the group is not accessible')
                END;

                -- TODO: use IF
                INSERT OR IGNORE INTO events_profiles_groups (event_id, profile_id, group_id)
                SELECT
                    aar.event_id as event_id,
                    aar.applicant_profile_id as profile_id,
                    OLD.group_id as group_id
                FROM accessible_access_requests aar
                INNER JOIN accessible_events_profiles aep
                    ON aep.profile_id = aar.applicant_profile_id
                WHERE aar.access_request_id = OLD.access_request_id
                AND aep.all_groups = 0 AND NEW.approved = 1;

                DELETE FROM events_profiles_groups
                WHERE rowid IN (
                    SELECT epg.rowid
                    FROM events_profiles ep
                    INNER JOIN events_profiles_groups epg ON
                        ep.event_id = epg.event_id
                        AND ep.profile_id = epg.profile_id
                    INNER JOIN access_requests ar ON
                        ar.applicant_profile_id = ep.profile_id
                        AND ar.event_id = ep.event_id
                    WHERE ar.access_request_id = OLD.access_request_id
                    AND epg.group_id = OLD.group_id
                    AND ep.all_groups = 1
                    AND NEW.approved = 1
                );

                UPDATE access_requests_groups SET
                    approved = NEW.approved,
                    closed_at = COALESCE(NEW.closed_at, CURRENT_TIMESTAMP),
                    closed_by = cur_profile('profile_id')
                WHERE access_request_id = OLD.access_request_id
                AND group_id = OLD.group_id;

                INSERT INTO ensure_access_requests_closed (access_request_id, closed_at)
                VALUES (OLD.access_request_id, NEW.closed_at);
            END;
        """,

        #########################################################
        #         Ensuring db policies triggers                 #
        #########################################################

        # prevent_reserved_event_urls
        'trg_prevent_reserved_event_urls_insert': """
            BEFORE INSERT ON events
            BEGIN
                SELECT CASE
                    WHEN NEW.url = 'dashboard' THEN
                        RAISE(ABORT, 'Policy error: The URL "dashboard" is reserved and cannot be used for events')
                END;
            END;
        """,
        'trg_prevent_reserved_event_urls_update': """
            BEFORE UPDATE ON events
            BEGIN
                SELECT CASE
                    WHEN NEW.url = 'dashboard' THEN
                        RAISE(ABORT, 'Policy error: The URL "dashboard" is reserved and cannot be used for events')
                END;
            END;
        """,

        # ensure_events_valid
        'trg_ensure_events_images_limit_valid_insert': """
            BEFORE INSERT ON events
            BEGIN
                SELECT CASE
                    WHEN NEW.images_count_limit < 0 OR NEW.images_count_limit > (SELECT images_count_limit FROM settings WHERE id = 1 LIMIT 1) THEN
                        RAISE(ABORT, 'Policy error: Invalid images count limit')
                END;
            END;
        """,
        'trg_ensure_events_images_limit_valid_update': """
            BEFORE UPDATE ON events
            BEGIN
                SELECT CASE
                    WHEN NEW.images_count_limit < 0 OR NEW.images_count_limit > (SELECT images_count_limit FROM settings WHERE id = 1 LIMIT 1) THEN
                        RAISE(ABORT, 'Policy error: Invalid images count limit')
                END;
            END;
        """,
        'trg_ensure_events_image_size_limit_valid_insert': """
            BEFORE INSERT ON events
            BEGIN
                SELECT CASE
                    WHEN NEW.image_size_limit_bytes < 0 OR NEW.image_size_limit_bytes > (SELECT image_size_limit_bytes FROM settings WHERE id = 1 LIMIT 1) THEN
                        RAISE(ABORT, 'Policy error: Invalid image size limit')
                END;
            END;
        """,
        'trg_ensure_events_image_size_limit_valid_update': """
            BEFORE UPDATE ON events
            BEGIN
                SELECT CASE
                    WHEN NEW.image_size_limit_bytes < 0 OR NEW.image_size_limit_bytes > (SELECT image_size_limit_bytes FROM settings WHERE id = 1 LIMIT 1) THEN
                        RAISE(ABORT, 'Policy error: Invalid image size limit')
                END;
            END;
        """,

        # ensure_profiles_unique
        'trg_ensure_profiles_unique_insert': """
            BEFORE INSERT ON profiles
            BEGIN
                SELECT CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM profiles
                        WHERE
                            LOWER(label) = LOWER(NEW.label)
                            AND (
                                COALESCE(restricted_to_event, '') = COALESCE(NEW.restricted_to_event, '')
                                OR restricted_to_event IS NULL
                            )
                    ) THEN
                        RAISE(ABORT, 'Policy error: Profile label already exists')
                    WHEN EXISTS (
                        SELECT 1
                        FROM profiles
                        WHERE password = NEW.password AND label = NEW.label
                    ) THEN
                        RAISE(ABORT, 'Policy error: Label with this password already exists')
                END;
            END;
        """,
        'trg_ensure_profiles_unique_update': """
            BEFORE UPDATE ON profiles
            BEGIN
                SELECT CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM profiles p
                        WHERE
                            LOWER(p.label) = LOWER(NEW.label)
                            AND (
                                (p.restricted_to_event IS NOT NULL AND p.restricted_to_event = NEW.restricted_to_event)
                                OR p.restricted_to_event IS NULL
                            )
                            AND p.profile_id <> OLD.profile_id
                    ) THEN
                        RAISE(ABORT, 'Policy error: Profile label already exists')
                    WHEN EXISTS (
                        SELECT 1
                        FROM profiles
                        WHERE password = NEW.password AND label = NEW.label AND profile_id <> OLD.profile_id
                    ) THEN
                        RAISE(ABORT, 'Policy error: Label with this password already exists')
                END;
            END;
        """,

        # ensure_profiles_restricted_to_event_validity
        'trg_ensure_profiles_restricted_to_event_validity_update': """
            BEFORE UPDATE ON profiles
            BEGIN
                SELECT CASE
                    WHEN NEW.restricted_to_event IS NOT NULL AND EXISTS (
                        SELECT 1 FROM events_profiles
                        WHERE profile_id = OLD.profile_id
                        AND event_id <> NEW.restricted_to_event
                    ) THEN
                        RAISE(ABORT, 'Policy error: the profile is already associated with another event')
                    WHEN NEW.restricted_to_event IS NOT NULL AND NEW.can_create_events = 1 THEN
                        RAISE(ABORT, 'Policy error: restricted profiles cannot have create events permission')
                END;
            END;
        """,

        # insert default preferences into profiles_preferences
        'trg_profiles_insert_default_preferences': """
            AFTER INSERT ON profiles
            BEGIN
                INSERT OR IGNORE INTO profiles_preferences (
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
                FROM default_preferences dp;
            END;
        """,

        # ensure_profiles_publicity_policy
        'trg_insert_ensure_profiles_publicity': """
            BEFORE INSERT ON profiles
            BEGIN
                SELECT CASE
                    WHEN NEW.is_public = 1 AND NEW.hierarchy_rank > 0 THEN
                        RAISE(ABORT, 'Policy error: public profiles cannot be managers')
                    WHEN NEW.is_public = 1 AND NEW.restricted_to_event IS NULL THEN
                        RAISE(ABORT, 'Policy error: public profiles must be restricted to an event')
                    WHEN NEW.is_public = 1 AND NEW.can_create_events = 1 THEN
                        RAISE(ABORT, 'Policy error: public profiles cannot have create events permission')
                END;
            END;
        """,
        'trg_update_ensure_profiles_publicity': """
            BEFORE UPDATE ON profiles
            BEGIN
                SELECT CASE
                    WHEN NEW.is_public = 1 AND NEW.hierarchy_rank > 0 THEN
                        RAISE(ABORT, 'Policy error: public profiles cannot be managers')
                    WHEN NEW.is_public = 1 AND NEW.restricted_to_event IS NULL THEN
                        RAISE(ABORT, 'Policy error: public profiles must be restricted to an event')
                    WHEN NEW.is_public = 1 AND NEW.can_create_events = 1 THEN
                        RAISE(ABORT, 'Policy error: public profiles cannot have create events permission')
                    WHEN
                        NEW.is_public = 1
                        AND EXISTS (
                            SELECT 1 FROM events_profiles ep
                            WHERE ep.profile_id = OLD.profile_id
                            AND (
                                ep.can_manage_event = 1
                                OR ep.can_delete_event = 1
                                OR ep.can_upload_and_delete_images = 1
                                OR ep.can_edit = 1
                            )
                        )
                    THEN
                        RAISE(ABORT, 'Policy error: public profiles cannot have event managing or editing permissions')
                END;
            END;
        """,
        'trg_insert_events_profiles_ensure_profiles_publicity': """
            BEFORE INSERT ON events_profiles
            BEGIN
                SELECT CASE
                    WHEN
                        (SELECT is_public FROM profiles WHERE profile_id = NEW.profile_id) = 1
                        AND (
                            NEW.can_manage_event = 1
                            OR NEW.can_delete_event = 1
                            OR NEW.can_upload_and_delete_images = 1
                            OR NEW.can_edit = 1
                        )
                    THEN
                        RAISE(ABORT, 'Policy error: public profiles cannot have event managing or editing permissions')
                END;
            END;
        """,
        'trg_update_events_profiles_ensure_profiles_publicity': """
            BEFORE UPDATE ON events_profiles
            BEGIN
                SELECT CASE
                    WHEN (SELECT is_public FROM profiles WHERE profile_id = OLD.profile_id) = 1
                    AND (
                        NEW.can_manage_event = 1
                        OR NEW.can_delete_event = 1
                        OR NEW.can_upload_and_delete_images = 1
                        OR NEW.can_edit = 1
                    )
                    THEN
                        RAISE(ABORT, 'Policy error: public profiles cannot have event managing or editing permissions')
                END;
            END;
        """,
        'trg_insert_ensure_profiles_public_access_code': """
            BEFORE INSERT ON profiles
            BEGIN
                SELECT CASE
                    WHEN NEW.is_public = 0 AND NEW.public_access_code IS NOT NULL THEN
                        RAISE(ABORT, 'Policy error: cannot set public access code if profile is not public')
                END;
            END;
        """,
        'trg_update_ensure_profiles_public_access_code': """
            AFTER UPDATE ON profiles
            BEGIN
                -- use IF
                UPDATE profiles
                SET public_access_code = NULL
                WHERE profile_id = OLD.profile_id
                AND is_public = 0;
            END;
        """,

        # ensure_profiles_can_upload_validity
        'trg_insert_ensure_profiles_can_upload_validity': """
            BEFORE INSERT ON events_profiles
            BEGIN
                SELECT CASE
                    WHEN NEW.can_upload_and_delete_images = 1 AND NEW.can_edit = 0 THEN
                        RAISE(ABORT, 'Policy error: cannot update profile with can_upload_and_delete_images=1 and can_edit=0')
                    WHEN NEW.can_upload_and_delete_images = 1 AND NEW.all_groups = 0 THEN
                        RAISE(ABORT, 'Policy error: profile with upload permissions cannot be restricted to groups')
                END;
            END;
        """,
        'trg_update_ensure_profiles_can_upload_validity': """
            BEFORE UPDATE ON events_profiles
            BEGIN
                SELECT CASE
                    WHEN NEW.can_upload_and_delete_images = 1 AND NEW.can_edit = 0 THEN
                        RAISE(ABORT, 'Policy error: cannot update profile with can_upload_and_delete_images=1 and can_edit=0')
                    WHEN NEW.can_upload_and_delete_images = 1 AND NEW.all_groups = 0 THEN
                        RAISE(ABORT, 'Policy error: profile with upload permissions cannot be restricted to groups')
                    WHEN
                        NEW.can_upload_and_delete_images = 1
                        AND EXISTS (
                            SELECT 1
                            FROM events_profiles_groups
                            WHERE event_id = cur_event_profile('event_id')
                            AND profile_id = NEW.profile_id
                        )
                    THEN
                        RAISE(ABORT, 'Policy error: profile with upload permissions cannot be restricted to groups')
                END;
            END;
        """,
        'trg_ensure_profiles_can_upload_validity_profile_groups_insert': """
            BEFORE INSERT ON events_profiles_groups
            BEGIN
                SELECT CASE
                    WHEN (
                        SELECT 1 FROM events_profiles
                        WHERE event_id = cur_event_profile('event_id')
                        AND profile_id = NEW.profile_id
                        AND can_upload_and_delete_images = 1
                    ) THEN
                        RAISE(ABORT, 'Policy error: profile with upload permissions cannot be restricted to groups')
                END;
            END;
        """,

        # revoke refresh tokens when profile password is updated
        'trg_revoke_refresh_tokens_when_profile_password_updated': """
            AFTER UPDATE ON profiles
            BEGIN
                -- use IF
                UPDATE refresh_tokens SET
                    revoked = 1,
                    revoked_at = CURRENT_TIMESTAMP
                WHERE profile_id = OLD.profile_id
                AND revoked = 0
                AND NEW.password <> OLD.password
                AND (NEW.password IS NOT NULL OR NEW.password <> '' OR OLD.password IS NOT NULL OR OLD.password <> '');
            END;
        """,

        # ensure_groups_unassociated_permissions
        'trg_insert_ensure_groups_unassociated_permissions': """
            BEFORE INSERT ON events_profiles_groups
            BEGIN
                SELECT CASE
                    WHEN NEW.group_id = (
                        SELECT g.group_id
                        FROM groups g
                        INNER JOIN events e ON g.event_id = e.event_id
                        WHERE g.event_id = cur_event_profile('event_id')
                        AND g.group_id = e.unassociated_group_id
                    ) THEN
                        RAISE(ABORT, 'Policy error: cannot edit unassociated group permissions')
                END;
            END;
        """,

        # ensure_access_requests_groups_validity
        'trg_ensure_access_requests_closed': """
            INSTEAD OF INSERT ON ensure_access_requests_closed
            BEGIN
                UPDATE access_requests SET
                    is_closed = 1,
                    closed_at = COALESCE(NEW.closed_at, CURRENT_TIMESTAMP),
                    closed_by = cur_profile('profile_id')
                WHERE event_id = cur_event_profile('event_id')
                AND access_request_id = COALESCE(NEW.access_request_id, access_request_id)
                AND NOT EXISTS (
                    SELECT 1 FROM access_requests_groups arg
                    WHERE arg.access_request_id = access_requests.access_request_id
                    AND arg.approved IS NULL
                );
            END;
        """,
        'trg_update_profile_ensure_access_requests_groups_validity': """
            AFTER UPDATE ON events_profiles
            BEGIN
                UPDATE access_requests_groups SET
                    approved = 1,
                    closed_at = CURRENT_TIMESTAMP,
                    closed_by = cur_profile('profile_id')
                WHERE (
                    (SELECT ar.applicant_profile_id FROM access_requests ar WHERE access_requests_groups.access_request_id = ar.access_request_id)
                    = OLD.profile_id
                AND approved IS NULL)
                AND (OLD.all_groups = 0 AND NEW.all_groups = 1);

                INSERT INTO ensure_access_requests_closed (access_request_id, closed_at)
                VALUES (NULL, NULL);
            END;
        """,
        'trg_insert_events_profiles_groups_ensure_access_requests_groups_validity': """
            AFTER INSERT ON events_profiles_groups
            BEGIN
                UPDATE access_requests_groups SET
                    approved = 1,
                    closed_at = CURRENT_TIMESTAMP,
                    closed_by = cur_profile('profile_id')
                WHERE
                    group_id = NEW.group_id
                    AND (
                        SELECT ar.applicant_profile_id
                        FROM access_requests ar
                        INNER JOIN events_profiles ep ON ep.profile_id = ar.applicant_profile_id
                        WHERE ar.access_request_id = access_requests_groups.access_request_id
                        AND ep.all_groups = 0
                    ) = NEW.profile_id
                    AND approved IS NULL
                ;

                INSERT INTO ensure_access_requests_closed (access_request_id, closed_at)
                VALUES (NULL, NULL);
            END;
        """,
        'trg_delete_events_profiles_groups_ensure_access_requests_groups_validity': """
            AFTER DELETE ON events_profiles_groups
            BEGIN
                UPDATE access_requests_groups SET
                    approved = 1,
                    closed_at = CURRENT_TIMESTAMP,
                    closed_by = cur_profile('profile_id')
                WHERE (
                    OLD.profile_id = (
                        SELECT ar.applicant_profile_id
                        FROM access_requests ar
                        INNER JOIN events_profiles ep ON ep.profile_id = ar.applicant_profile_id
                        WHERE ar.access_request_id = access_requests_groups.access_request_id
                        AND ep.all_groups = 1
                    )
                    AND group_id = OLD.group_id
                ) AND approved IS NULL;

                INSERT INTO ensure_access_requests_closed (access_request_id, closed_at)
                VALUES (NULL, NULL);
            END;
        """,

        # ensure_complete_deletion
        'trg_ensure_complete_deletion_faces_in_group': """
            BEFORE DELETE ON groups
            BEGIN
                SELECT CASE
                    WHEN 
                        EXISTS (
                            SELECT 1 FROM faces f
                            WHERE f.group_id = OLD.group_id
                        )
                        AND COALESCE((SELECT event_in_deletion FROM settings WHERE id = 1 LIMIT 1), '') <> OLD.event_id
                    THEN
                        RAISE(ABORT, 'Policy error: cannot delete group with faces')
                END;
            END;
        """,
        'trg_ensure_complete_deletion_access_requests': """
            AFTER DELETE ON profiles
            BEGIN
                DELETE FROM access_requests
                WHERE applicant_profile_id = OLD.profile_id;

                DELETE FROM access_requests
                WHERE
                    profile_id = OLD.profile_id
                    AND applicant_profile_id IS NULL;
            END;
        """,

        # ensure_defaults_in_event
        'trg_ensure_defaults_in_event_insert': """
            -- TODO: use variables
            AFTER INSERT ON events
            BEGIN
                INSERT OR IGNORE INTO events_profiles (
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
                    NEW.event_id, developer_id, 1, 1, 1, 1, 1, 1, 1
                FROM settings
                WHERE settings.id = 1;

                INSERT INTO albums (event_id, album_id, label)
                SELECT NEW.event_id, uuid, 'Archive'
                FROM uuid
                LIMIT 1;

                INSERT INTO albums (event_id, album_id, label)
                SELECT NEW.event_id, uuid, 'Favorites'
                FROM uuid
                LIMIT 1;

                INSERT INTO groups (event_id, group_id, label)
                SELECT NEW.event_id, uuid, 'Unassociated'
                FROM uuid
                LIMIT 1;

                UPDATE events SET
                    archive_album_id = (
                        SELECT album_id FROM albums WHERE event_id = NEW.event_id AND label = 'Archive'
                    ),
                    favorites_album_id = (
                        SELECT album_id FROM albums WHERE event_id = NEW.event_id AND label = 'Favorites'
                    ),
                    unassociated_group_id = (
                        SELECT group_id FROM groups WHERE event_id = NEW.event_id AND label = 'Unassociated'
                    )
                WHERE event_id = NEW.event_id;

            END;
        """,

        # ensure_default_albums
        'trg_update_ensure_default_albums': """
            BEFORE UPDATE ON albums
            BEGIN
                SELECT CASE
                    WHEN
                        OLD.album_id = (SELECT archive_album_id FROM events WHERE event_id = OLD.event_id)
                        OR OLD.album_id = (SELECT favorites_album_id FROM events WHERE event_id = OLD.event_id)
                        AND (NEW.album_id <> OLD.album_id OR NEW.label <> OLD.label)
                    THEN
                        RAISE(ABORT, 'Policy error: cannot update default albums')
                END;
            END;
        """,
        'trg_delete_ensure_default_albums': """
            BEFORE DELETE ON albums
            BEGIN
                SELECT CASE
                    WHEN
                        (
                            OLD.album_id = (SELECT archive_album_id FROM events WHERE event_id = OLD.event_id)
                            OR OLD.album_id = (SELECT favorites_album_id FROM events WHERE event_id = OLD.event_id)
                        )
                        AND COALESCE((SELECT event_in_deletion FROM settings WHERE id = 1 LIMIT 1), '') <> OLD.event_id
                    THEN
                        RAISE(ABORT, 'Policy error: cannot delete default albums')
                END;
            END;
        """,

        # ensure_default_groups
        'trg_update_ensure_default_groups': """
            BEFORE UPDATE ON groups
            BEGIN
                SELECT CASE
                    WHEN
                        OLD.group_id = (SELECT unassociated_group_id FROM events WHERE event_id = OLD.event_id)
                        AND (
                            OLD.group_id <> NEW.group_id
                            OR OLD.label <> NEW.label
                            OR COALESCE(OLD.representative_face, '') <> COALESCE(NEW.representative_face, '')
                        )
                    THEN
                        RAISE(ABORT, 'Policy error: cannot update default group')
                END;
            END;
        """,
        'trg_delete_ensure_default_groups': """
            BEFORE DELETE ON groups
            BEGIN
                SELECT CASE
                    WHEN
                        OLD.group_id = (SELECT unassociated_group_id FROM events WHERE event_id = OLD.event_id)
                        AND COALESCE((SELECT event_in_deletion FROM settings WHERE id = 1 LIMIT 1), '') <> OLD.event_id
                    THEN
                        RAISE(ABORT, 'Policy error: cannot delete default group')
                END;
            END;
        """,
    }

