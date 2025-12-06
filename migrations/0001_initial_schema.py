"""
Initial PostgreSQL schema migration.
Creates all tables, indexes, and foreign key constraints.
"""

from yoyo import step

__depends__ = {}

steps = [
    # Step 1: Create all tables
    step(
        """
        -- settings
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
            developer_id UUID,
            image_size_limit_bytes INTEGER DEFAULT 0,
            images_count_limit INTEGER DEFAULT 0,
            rekognition_calls_limit INTEGER DEFAULT 0,
            min_rank_to_create_event INTEGER DEFAULT 0
        );
        
        -- rekognition_usaged
        CREATE TABLE IF NOT EXISTS rekognition_usaged (
            usage_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
            event_id UUID NOT NULL,
            event_label TEXT NOT NULL,
            profile_id UUID NOT NULL,
            profile_label TEXT NOT NULL,
            calls_count INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        -- default_preferences
        CREATE TABLE IF NOT EXISTS default_preferences (
            preference_group TEXT NOT NULL,
            preference_key TEXT NOT NULL,
            value_type TEXT NOT NULL,
            value TEXT NOT NULL,
            PRIMARY KEY (preference_group, preference_key)
        );
        
        -- events
        CREATE TABLE IF NOT EXISTS events (
            event_id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            date TEXT,
            url TEXT NOT NULL,
            is_public BOOLEAN NOT NULL DEFAULT FALSE,
            images_count_limit INTEGER NOT NULL DEFAULT 0,
            image_size_limit_bytes INTEGER NOT NULL DEFAULT 0,
            rekognition_calls_limit INTEGER NOT NULL DEFAULT 0,
            rekognition_calls_used INTEGER NOT NULL DEFAULT 0,
            archive_album_id UUID,
            favorites_album_id UUID,
            unassociated_group_id UUID,
            representative_image UUID,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by UUID
        );
        
        -- profiles
        CREATE TABLE IF NOT EXISTS profiles (
            profile_id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
            label TEXT NOT NULL,
            email TEXT,
            password TEXT NOT NULL,
            hierarchy_rank INTEGER DEFAULT 0 CHECK (hierarchy_rank >= 0),
            can_create_events BOOLEAN NOT NULL DEFAULT FALSE,
            restricted_to_event UUID DEFAULT NULL,
            is_public BOOLEAN NOT NULL DEFAULT FALSE,
            public_access_code TEXT
        );
        
        -- profiles_preferences
        CREATE TABLE IF NOT EXISTS profiles_preferences (
            profile_id UUID NOT NULL,
            preference_group TEXT NOT NULL,
            preference_key TEXT NOT NULL,
            preference_value TEXT NOT NULL,
            PRIMARY KEY (profile_id, preference_group, preference_key)
        );
        
        -- refresh_tokens
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            token_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
            profile_id UUID NOT NULL,
            token TEXT NOT NULL UNIQUE,
            issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP NOT NULL,
            user_agent TEXT,
            ip_address TEXT,
            revoked BOOLEAN NOT NULL DEFAULT FALSE,
            revoked_at TIMESTAMP
        );
        
        -- password_reset_links
        CREATE TABLE IF NOT EXISTS password_reset_links (
            reset_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
            profile_id UUID NOT NULL,
            token TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP NOT NULL,
            used BOOLEAN NOT NULL DEFAULT FALSE,
            used_at TIMESTAMP
        );
        
        -- notifications
        CREATE TABLE IF NOT EXISTS notifications (
            notification_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
            profile_id UUID NOT NULL,
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            read BOOLEAN NOT NULL DEFAULT FALSE,
            read_at TIMESTAMP,
            type TEXT,
            data JSONB
        );
        
        -- feedbacks
        CREATE TABLE IF NOT EXISTS feedbacks (
            feedback_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
            profile_id UUID,
            sender_name TEXT,
            sender_email TEXT,
            communication_consent BOOLEAN NOT NULL DEFAULT FALSE,
            title TEXT,
            type INTEGER DEFAULT 0,
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            user_agent TEXT,
            ip_address TEXT,
            diagnostics TEXT,
            notes TEXT,
            is_closed BOOLEAN NOT NULL DEFAULT FALSE,
            solved BOOLEAN NOT NULL DEFAULT FALSE,
            closed_at TIMESTAMP,
            closed_by UUID,
            closed_details TEXT,
            error_ids INTEGER[]
        );
        
        -- events_profiles
        CREATE TABLE IF NOT EXISTS events_profiles (
            event_id UUID,
            profile_id UUID,
            can_manage_event BOOLEAN NOT NULL DEFAULT FALSE,
            can_delete_event BOOLEAN NOT NULL DEFAULT FALSE,
            can_upload_and_delete_images BOOLEAN NOT NULL DEFAULT FALSE,
            can_edit BOOLEAN NOT NULL DEFAULT FALSE,
            all_images BOOLEAN NOT NULL DEFAULT FALSE,
            all_groups BOOLEAN NOT NULL DEFAULT FALSE,
            all_albums BOOLEAN NOT NULL DEFAULT FALSE,
            PRIMARY KEY (event_id, profile_id)
        );
        
        -- images
        CREATE TABLE IF NOT EXISTS images (
            event_id UUID NOT NULL,
            image_id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
            label TEXT,
            date_taken TIMESTAMP,
            file_size INTEGER,
            high_quality_file_size INTEGER,
            display_file_size INTEGER,
            thumb_file_size INTEGER,
            width INTEGER,
            height INTEGER,
            moment_id UUID,
            description TEXT,
            upload_id INTEGER,
            UNIQUE (event_id, label)
        );
        
        -- faces
        CREATE TABLE IF NOT EXISTS faces (
            face_id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
            image_id UUID NOT NULL,
            face_width REAL,
            face_height REAL,
            face_left REAL,
            face_top REAL,
            file_size INTEGER,
            group_id UUID NOT NULL
        );
        
        -- groups
        CREATE TABLE IF NOT EXISTS groups (
            event_id UUID NOT NULL,
            group_id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
            label TEXT,
            representative_face UUID,
            UNIQUE (event_id, label)
        );
        
        -- moments
        CREATE TABLE IF NOT EXISTS moments (
            event_id UUID NOT NULL,
            moment_id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
            label TEXT,
            description TEXT,
            start_date TIMESTAMP,
            end_date TIMESTAMP,
            representative_image UUID,
            UNIQUE (event_id, label)
        );
        
        -- albums
        CREATE TABLE IF NOT EXISTS albums (
            event_id UUID NOT NULL,
            album_id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
            label TEXT,
            description TEXT,
            representative_image UUID,
            UNIQUE (event_id, label)
        );
        
        -- albums_images
        CREATE TABLE IF NOT EXISTS albums_images (
            album_id UUID NOT NULL,
            image_id UUID NOT NULL,
            PRIMARY KEY (album_id, image_id)
        );
        
        -- profiles_images
        CREATE TABLE IF NOT EXISTS profiles_images (
            profile_id UUID,
            image_id UUID,
            PRIMARY KEY (profile_id, image_id)
        );
        
        -- profiles_groups
        CREATE TABLE IF NOT EXISTS profiles_groups (
            profile_id UUID,
            group_id UUID,
            PRIMARY KEY (profile_id, group_id)
        );
        
        -- profiles_albums
        CREATE TABLE IF NOT EXISTS profiles_albums (
            profile_id UUID,
            album_id UUID,
            PRIMARY KEY (profile_id, album_id)
        );
        
        -- uploads
        CREATE TABLE IF NOT EXISTS uploads (
            event_id UUID,
            upload_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP,
            status TEXT,
            images_count INTEGER,
            faces_count INTEGER,
            clusters_count INTEGER,
            moments_count INTEGER,
            errors TEXT,
            notes TEXT,
            profile_id UUID
        );
        
        -- access_requests
        CREATE TABLE IF NOT EXISTS access_requests (
            event_id UUID,
            access_request_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
            profile_id UUID NOT NULL,
            requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            applicant_name TEXT,
            applicant_email TEXT,
            applicant_phone TEXT,
            details TEXT,
            communication_consent BOOLEAN NOT NULL DEFAULT FALSE,
            is_closed BOOLEAN NOT NULL DEFAULT FALSE,
            closed_at TIMESTAMP,
            closed_by UUID,
            closed_details TEXT,
            applicant_profile_id UUID
        );
        
        -- access_requests_groups
        CREATE TABLE IF NOT EXISTS access_requests_groups (
            access_request_id INTEGER,
            group_id UUID,
            approved BOOLEAN DEFAULT NULL,
            closed_at TIMESTAMP,
            closed_by UUID,
            closed_details TEXT,
            PRIMARY KEY (access_request_id, group_id)
        );
        
        -- errors
        CREATE TABLE IF NOT EXISTS errors (
            error_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
            error_type TEXT NOT NULL,
            error_message TEXT NOT NULL,
            traceback TEXT,
            profile_id UUID,
            event_id UUID,
            request_path TEXT,
            request_method TEXT,
            user_agent TEXT,
            ip_address TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        -- audit_logs
        CREATE TABLE IF NOT EXISTS audit_logs (
            audit_log_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
            timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            actor_profile_id UUID,
            action TEXT NOT NULL,
            severity TEXT NOT NULL,
            ip_address TEXT,
            details JSONB
        );
        
        -- Create unique constraints for case-insensitive fields
        CREATE UNIQUE INDEX IF NOT EXISTS idx_events_name_lower ON events(LOWER(name));
        CREATE UNIQUE INDEX IF NOT EXISTS idx_events_url_lower ON events(LOWER(url));
        CREATE UNIQUE INDEX IF NOT EXISTS idx_images_event_label_lower ON images(event_id, LOWER(label));
        CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_event_label_lower ON groups(event_id, LOWER(label));
        CREATE UNIQUE INDEX IF NOT EXISTS idx_moments_event_label_lower ON moments(event_id, LOWER(label));
        CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_event_label_lower ON albums(event_id, LOWER(label));
        """,
        """
        DROP INDEX IF EXISTS idx_albums_event_label_lower;
        DROP INDEX IF EXISTS idx_moments_event_label_lower;
        DROP INDEX IF EXISTS idx_groups_event_label_lower;
        DROP INDEX IF EXISTS idx_images_event_label_lower;
        DROP INDEX IF EXISTS idx_events_url_lower;
        DROP INDEX IF EXISTS idx_events_name_lower;
        DROP TABLE IF EXISTS audit_logs CASCADE;
        DROP TABLE IF EXISTS errors CASCADE;
        DROP TABLE IF EXISTS access_requests_groups CASCADE;
        DROP TABLE IF EXISTS access_requests CASCADE;
        DROP TABLE IF EXISTS uploads CASCADE;
        DROP TABLE IF EXISTS profiles_albums CASCADE;
        DROP TABLE IF EXISTS profiles_groups CASCADE;
        DROP TABLE IF EXISTS profiles_images CASCADE;
        DROP TABLE IF EXISTS albums_images CASCADE;
        DROP TABLE IF EXISTS albums CASCADE;
        DROP TABLE IF EXISTS moments CASCADE;
        DROP TABLE IF EXISTS groups CASCADE;
        DROP TABLE IF EXISTS faces CASCADE;
        DROP TABLE IF EXISTS images CASCADE;
        DROP TABLE IF EXISTS events_profiles CASCADE;
        DROP TABLE IF EXISTS feedbacks CASCADE;
        DROP TABLE IF EXISTS notifications CASCADE;
        DROP TABLE IF EXISTS password_reset_links CASCADE;
        DROP TABLE IF EXISTS refresh_tokens CASCADE;
        DROP TABLE IF EXISTS profiles_preferences CASCADE;
        DROP TABLE IF EXISTS profiles CASCADE;
        DROP TABLE IF EXISTS events CASCADE;
        DROP TABLE IF EXISTS default_preferences CASCADE;
        DROP TABLE IF EXISTS rekognition_usaged CASCADE;
        DROP TABLE IF EXISTS settings CASCADE;
        """
    ),
    # Step 2: Add all foreign keys
    step(
        """
        -- Foreign keys for settings
        ALTER TABLE settings
            ADD CONSTRAINT fk_settings_developer_id 
            FOREIGN KEY (developer_id) REFERENCES profiles(profile_id) ON DELETE SET NULL;
        
        -- Foreign keys for events
        ALTER TABLE events
            ADD CONSTRAINT fk_events_archive_album_id 
            FOREIGN KEY (archive_album_id) REFERENCES albums(album_id) ON DELETE SET NULL;
        
        ALTER TABLE events
            ADD CONSTRAINT fk_events_favorites_album_id 
            FOREIGN KEY (favorites_album_id) REFERENCES albums(album_id) ON DELETE SET NULL;
        
        ALTER TABLE events
            ADD CONSTRAINT fk_events_unassociated_group_id 
            FOREIGN KEY (unassociated_group_id) REFERENCES groups(group_id) ON DELETE SET NULL;
        
        ALTER TABLE events
            ADD CONSTRAINT fk_events_representative_image 
            FOREIGN KEY (representative_image) REFERENCES images(image_id) ON DELETE SET NULL;
        
        ALTER TABLE events
            ADD CONSTRAINT fk_events_created_by 
            FOREIGN KEY (created_by) REFERENCES profiles(profile_id) ON DELETE SET NULL;
        
        -- Foreign keys for profiles
        ALTER TABLE profiles
            ADD CONSTRAINT fk_profiles_restricted_to_event 
            FOREIGN KEY (restricted_to_event) REFERENCES events(event_id) ON DELETE CASCADE;
        
        -- Foreign keys for profiles_preferences
        ALTER TABLE profiles_preferences
            ADD CONSTRAINT fk_profiles_preferences_profile_id 
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE;
        
        ALTER TABLE profiles_preferences
            ADD CONSTRAINT fk_profiles_preferences_preference 
            FOREIGN KEY (preference_group, preference_key) 
            REFERENCES default_preferences(preference_group, preference_key) ON DELETE CASCADE;
        
        -- Foreign keys for refresh_tokens
        ALTER TABLE refresh_tokens
            ADD CONSTRAINT fk_refresh_tokens_profile_id 
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE;
        
        -- Foreign keys for password_reset_links
        ALTER TABLE password_reset_links
            ADD CONSTRAINT fk_password_reset_links_profile_id 
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE;
        
        -- Foreign keys for notifications
        ALTER TABLE notifications
            ADD CONSTRAINT fk_notifications_profile_id 
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE;
        
        -- Foreign keys for feedbacks
        ALTER TABLE feedbacks
            ADD CONSTRAINT fk_feedbacks_profile_id 
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE SET NULL;
        
        ALTER TABLE feedbacks
            ADD CONSTRAINT fk_feedbacks_closed_by 
            FOREIGN KEY (closed_by) REFERENCES profiles(profile_id) ON DELETE SET NULL;
        
        -- Foreign keys for events_profiles
        ALTER TABLE events_profiles
            ADD CONSTRAINT fk_events_profiles_event_id 
            FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE;
        
        ALTER TABLE events_profiles
            ADD CONSTRAINT fk_events_profiles_profile_id 
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE;
        
        -- Foreign keys for images
        ALTER TABLE images
            ADD CONSTRAINT fk_images_event_id 
            FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE;
        
        ALTER TABLE images
            ADD CONSTRAINT fk_images_moment_id 
            FOREIGN KEY (moment_id) REFERENCES moments(moment_id) ON DELETE SET NULL;
        
        ALTER TABLE images
            ADD CONSTRAINT fk_images_upload_id 
            FOREIGN KEY (upload_id) REFERENCES uploads(upload_id) ON DELETE SET NULL;
        
        -- Foreign keys for faces
        ALTER TABLE faces
            ADD CONSTRAINT fk_faces_image_id 
            FOREIGN KEY (image_id) REFERENCES images(image_id) ON DELETE CASCADE;
        
        ALTER TABLE faces
            ADD CONSTRAINT fk_faces_group_id 
            FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE;
        
        -- Foreign keys for groups
        ALTER TABLE groups
            ADD CONSTRAINT fk_groups_event_id 
            FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE;
        
        ALTER TABLE groups
            ADD CONSTRAINT fk_groups_representative_face 
            FOREIGN KEY (representative_face) REFERENCES faces(face_id) ON DELETE SET NULL;
        
        -- Foreign keys for moments
        ALTER TABLE moments
            ADD CONSTRAINT fk_moments_event_id 
            FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE;
        
        ALTER TABLE moments
            ADD CONSTRAINT fk_moments_representative_image 
            FOREIGN KEY (representative_image) REFERENCES images(image_id) ON DELETE SET NULL;
        
        -- Foreign keys for albums
        ALTER TABLE albums
            ADD CONSTRAINT fk_albums_event_id 
            FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE;
        
        ALTER TABLE albums
            ADD CONSTRAINT fk_albums_representative_image 
            FOREIGN KEY (representative_image) REFERENCES images(image_id) ON DELETE SET NULL;
        
        -- Foreign keys for albums_images
        ALTER TABLE albums_images
            ADD CONSTRAINT fk_albums_images_album_id 
            FOREIGN KEY (album_id) REFERENCES albums(album_id) ON DELETE CASCADE;
        
        ALTER TABLE albums_images
            ADD CONSTRAINT fk_albums_images_image_id 
            FOREIGN KEY (image_id) REFERENCES images(image_id) ON DELETE CASCADE;
        
        -- Foreign keys for profiles_images
        ALTER TABLE profiles_images
            ADD CONSTRAINT fk_profiles_images_profile_id 
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE;
        
        ALTER TABLE profiles_images
            ADD CONSTRAINT fk_profiles_images_image_id 
            FOREIGN KEY (image_id) REFERENCES images(image_id) ON DELETE CASCADE;
        
        -- Foreign keys for profiles_groups
        ALTER TABLE profiles_groups
            ADD CONSTRAINT fk_profiles_groups_profile_id 
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE;
        
        ALTER TABLE profiles_groups
            ADD CONSTRAINT fk_profiles_groups_group_id 
            FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE;
        
        -- Foreign keys for profiles_albums
        ALTER TABLE profiles_albums
            ADD CONSTRAINT fk_profiles_albums_profile_id 
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE;
        
        ALTER TABLE profiles_albums
            ADD CONSTRAINT fk_profiles_albums_album_id 
            FOREIGN KEY (album_id) REFERENCES albums(album_id) ON DELETE CASCADE;
        
        -- Foreign keys for uploads
        ALTER TABLE uploads
            ADD CONSTRAINT fk_uploads_event_id 
            FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE;
        
        ALTER TABLE uploads
            ADD CONSTRAINT fk_uploads_profile_id 
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE SET NULL;
        
        -- Foreign keys for access_requests
        ALTER TABLE access_requests
            ADD CONSTRAINT fk_access_requests_event_id 
            FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE;
        
        ALTER TABLE access_requests
            ADD CONSTRAINT fk_access_requests_profile_id 
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE SET NULL;
        
        ALTER TABLE access_requests
            ADD CONSTRAINT fk_access_requests_closed_by 
            FOREIGN KEY (closed_by) REFERENCES profiles(profile_id) ON DELETE SET NULL;
        
        ALTER TABLE access_requests
            ADD CONSTRAINT fk_access_requests_applicant_profile_id 
            FOREIGN KEY (applicant_profile_id) REFERENCES profiles(profile_id) ON DELETE SET NULL;
        
        -- Foreign keys for access_requests_groups
        ALTER TABLE access_requests_groups
            ADD CONSTRAINT fk_access_requests_groups_access_request_id 
            FOREIGN KEY (access_request_id) REFERENCES access_requests(access_request_id) ON DELETE CASCADE;
        
        ALTER TABLE access_requests_groups
            ADD CONSTRAINT fk_access_requests_groups_group_id 
            FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE;
        
        ALTER TABLE access_requests_groups
            ADD CONSTRAINT fk_access_requests_groups_closed_by 
            FOREIGN KEY (closed_by) REFERENCES profiles(profile_id) ON DELETE SET NULL;
        
        -- Foreign keys for errors
        ALTER TABLE errors
            ADD CONSTRAINT fk_errors_profile_id 
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE SET NULL;
        
        ALTER TABLE errors
            ADD CONSTRAINT fk_errors_event_id 
            FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE SET NULL;
        
        -- Foreign keys for audit_logs
        ALTER TABLE audit_logs
            ADD CONSTRAINT fk_audit_logs_actor_profile_id 
            FOREIGN KEY (actor_profile_id) REFERENCES profiles(profile_id) ON DELETE SET NULL;
        """,
        """
        ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS fk_audit_logs_actor_profile_id;
        ALTER TABLE errors DROP CONSTRAINT IF EXISTS fk_errors_event_id;
        ALTER TABLE errors DROP CONSTRAINT IF EXISTS fk_errors_profile_id;
        ALTER TABLE access_requests_groups DROP CONSTRAINT IF EXISTS fk_access_requests_groups_closed_by;
        ALTER TABLE access_requests_groups DROP CONSTRAINT IF EXISTS fk_access_requests_groups_group_id;
        ALTER TABLE access_requests_groups DROP CONSTRAINT IF EXISTS fk_access_requests_groups_access_request_id;
        ALTER TABLE access_requests DROP CONSTRAINT IF EXISTS fk_access_requests_applicant_profile_id;
        ALTER TABLE access_requests DROP CONSTRAINT IF EXISTS fk_access_requests_closed_by;
        ALTER TABLE access_requests DROP CONSTRAINT IF EXISTS fk_access_requests_profile_id;
        ALTER TABLE access_requests DROP CONSTRAINT IF EXISTS fk_access_requests_event_id;
        ALTER TABLE uploads DROP CONSTRAINT IF EXISTS fk_uploads_profile_id;
        ALTER TABLE uploads DROP CONSTRAINT IF EXISTS fk_uploads_event_id;
        ALTER TABLE profiles_albums DROP CONSTRAINT IF EXISTS fk_profiles_albums_album_id;
        ALTER TABLE profiles_albums DROP CONSTRAINT IF EXISTS fk_profiles_albums_profile_id;
        ALTER TABLE profiles_groups DROP CONSTRAINT IF EXISTS fk_profiles_groups_group_id;
        ALTER TABLE profiles_groups DROP CONSTRAINT IF EXISTS fk_profiles_groups_profile_id;
        ALTER TABLE profiles_images DROP CONSTRAINT IF EXISTS fk_profiles_images_image_id;
        ALTER TABLE profiles_images DROP CONSTRAINT IF EXISTS fk_profiles_images_profile_id;
        ALTER TABLE albums_images DROP CONSTRAINT IF EXISTS fk_albums_images_image_id;
        ALTER TABLE albums_images DROP CONSTRAINT IF EXISTS fk_albums_images_album_id;
        ALTER TABLE albums DROP CONSTRAINT IF EXISTS fk_albums_representative_image;
        ALTER TABLE albums DROP CONSTRAINT IF EXISTS fk_albums_event_id;
        ALTER TABLE moments DROP CONSTRAINT IF EXISTS fk_moments_representative_image;
        ALTER TABLE moments DROP CONSTRAINT IF EXISTS fk_moments_event_id;
        ALTER TABLE groups DROP CONSTRAINT IF EXISTS fk_groups_representative_face;
        ALTER TABLE groups DROP CONSTRAINT IF EXISTS fk_groups_event_id;
        ALTER TABLE faces DROP CONSTRAINT IF EXISTS fk_faces_group_id;
        ALTER TABLE faces DROP CONSTRAINT IF EXISTS fk_faces_image_id;
        ALTER TABLE images DROP CONSTRAINT IF EXISTS fk_images_upload_id;
        ALTER TABLE images DROP CONSTRAINT IF EXISTS fk_images_moment_id;
        ALTER TABLE images DROP CONSTRAINT IF EXISTS fk_images_event_id;
        ALTER TABLE events_profiles DROP CONSTRAINT IF EXISTS fk_events_profiles_profile_id;
        ALTER TABLE events_profiles DROP CONSTRAINT IF EXISTS fk_events_profiles_event_id;
        ALTER TABLE feedbacks DROP CONSTRAINT IF EXISTS fk_feedbacks_closed_by;
        ALTER TABLE feedbacks DROP CONSTRAINT IF EXISTS fk_feedbacks_profile_id;
        ALTER TABLE notifications DROP CONSTRAINT IF EXISTS fk_notifications_profile_id;
        ALTER TABLE password_reset_links DROP CONSTRAINT IF EXISTS fk_password_reset_links_profile_id;
        ALTER TABLE refresh_tokens DROP CONSTRAINT IF EXISTS fk_refresh_tokens_profile_id;
        ALTER TABLE profiles_preferences DROP CONSTRAINT IF EXISTS fk_profiles_preferences_preference;
        ALTER TABLE profiles_preferences DROP CONSTRAINT IF EXISTS fk_profiles_preferences_profile_id;
        ALTER TABLE profiles DROP CONSTRAINT IF EXISTS fk_profiles_restricted_to_event;
        ALTER TABLE events DROP CONSTRAINT IF EXISTS fk_events_created_by;
        ALTER TABLE events DROP CONSTRAINT IF EXISTS fk_events_representative_image;
        ALTER TABLE events DROP CONSTRAINT IF EXISTS fk_events_unassociated_group_id;
        ALTER TABLE events DROP CONSTRAINT IF EXISTS fk_events_favorites_album_id;
        ALTER TABLE events DROP CONSTRAINT IF EXISTS fk_events_archive_album_id;
        ALTER TABLE settings DROP CONSTRAINT IF EXISTS fk_settings_event_in_deletion;
        ALTER TABLE settings DROP CONSTRAINT IF EXISTS fk_settings_developer_id;
        """
    ),
    # Step 3: Add all indexes
step(
        """
        CREATE INDEX IF NOT EXISTS idx_rekognition_usaged_created_at ON rekognition_usaged(created_at);
        CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
        CREATE INDEX IF NOT EXISTS idx_events_rekognition_calls_used ON events(rekognition_calls_used);
        CREATE INDEX IF NOT EXISTS idx_profiles_label_lower ON profiles(LOWER(label));
        CREATE INDEX IF NOT EXISTS idx_profiles_public_access_code ON profiles(public_access_code);
        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
        CREATE INDEX IF NOT EXISTS idx_password_reset_links_token ON password_reset_links(token);
        CREATE INDEX IF NOT EXISTS idx_notifications_message ON notifications(message);
        CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
        CREATE INDEX IF NOT EXISTS idx_feedbacks_type ON feedbacks(type);
        CREATE INDEX IF NOT EXISTS idx_images_event_id_image_id ON images(event_id, image_id);
        CREATE INDEX IF NOT EXISTS idx_images_date_taken ON images(date_taken);
        CREATE INDEX IF NOT EXISTS idx_images_upload_id ON images(upload_id);
        CREATE INDEX IF NOT EXISTS idx_faces_group_id_image_id ON faces(group_id, image_id);
        CREATE INDEX IF NOT EXISTS idx_faces_image_id_group_id ON faces(image_id, group_id); -- Reverse index for joins
        CREATE INDEX IF NOT EXISTS idx_events_profiles_profile_event ON events_profiles(profile_id, event_id);
        CREATE INDEX IF NOT EXISTS idx_events_profiles_composite ON events_profiles(event_id, profile_id, all_images, all_groups, can_edit);
        CREATE INDEX IF NOT EXISTS idx_albums_images_image_id ON albums_images(image_id);
        CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);
        CREATE INDEX IF NOT EXISTS idx_uploads_started_at ON uploads(started_at);
        CREATE INDEX IF NOT EXISTS idx_access_requests_requested_at ON access_requests(requested_at);
        CREATE INDEX IF NOT EXISTS idx_errors_created_at ON errors(created_at);
        CREATE INDEX IF NOT EXISTS idx_errors_error_type ON errors(error_type);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
        """,
        """
        DROP INDEX IF EXISTS idx_audit_logs_action;
        DROP INDEX IF EXISTS idx_audit_logs_severity;
        DROP INDEX IF EXISTS idx_audit_logs_timestamp;
        DROP INDEX IF EXISTS idx_errors_error_type;
        DROP INDEX IF EXISTS idx_errors_created_at;
        DROP INDEX IF EXISTS idx_access_requests_requested_at;
        DROP INDEX IF EXISTS idx_uploads_started_at;
        DROP INDEX IF EXISTS idx_uploads_status;
        DROP INDEX IF EXISTS idx_albums_images_image_id;
        DROP INDEX IF EXISTS idx_events_profiles_composite;
        DROP INDEX IF EXISTS idx_events_profiles_profile_event;
        DROP INDEX IF EXISTS idx_faces_image_id_group_id;
        DROP INDEX IF EXISTS idx_faces_group_id_image_id;
        DROP INDEX IF EXISTS idx_images_upload_id;
        DROP INDEX IF EXISTS idx_images_date_taken;
        DROP INDEX IF EXISTS idx_images_event_id_image_id;
        DROP INDEX IF EXISTS idx_feedbacks_type;
        DROP INDEX IF EXISTS idx_notifications_type;
        DROP INDEX IF EXISTS idx_notifications_message;
        DROP INDEX IF EXISTS idx_password_reset_links_token;
        DROP INDEX IF EXISTS idx_refresh_tokens_token;
        DROP INDEX IF EXISTS idx_profiles_public_access_code;
        DROP INDEX IF EXISTS idx_profiles_label_lower;
        DROP INDEX IF EXISTS idx_events_rekognition_calls_used;
        DROP INDEX IF EXISTS idx_events_created_at;
        DROP INDEX IF EXISTS idx_rekognition_usaged_created_at;
        """
    ),
    # Step 4: Insert initial data (developer profile, settings, and default preferences)
    step(
        """
        -- Insert developer profile
        INSERT INTO profiles (profile_id, label, email, password, hierarchy_rank, can_create_events, restricted_to_event, is_public, public_access_code)
        VALUES (
            '89cb4967-0eba-48af-99cc-5e87407fb639',
            'Developer',
            'metaichman@gmail.com',
            'scrypt:32768:8:1$GuxrXuUGt7Ampf2f$230050c7b95489495fc44b2dbc4781dc8265f9a4a513f987a0bdc4260660403e10f39ce37036e26d84e56950ef3d0fabac79f4257b38c413c36440a160848793',
            10,
            TRUE,
            NULL,
            FALSE,
            NULL
        )
        ON CONFLICT (profile_id) DO NOTHING;
        
        -- Insert settings row
        INSERT INTO settings (developer_id, image_size_limit_bytes, images_count_limit, rekognition_calls_limit, min_rank_to_create_event)
        SELECT 
            '89cb4967-0eba-48af-99cc-5e87407fb639',
            13631488,
            6000,
            20000,
            2
        WHERE NOT EXISTS (SELECT 1 FROM settings LIMIT 1);
        
        -- Insert default preferences
        INSERT INTO default_preferences (preference_group, preference_key, value_type, value) VALUES
            ('general', 'select', 'bool', '0'),
            ('general', 'size', 'float', '1.0'),
            ('general', 'includeArchived', 'bool', '0'),
            ('ImageViewer', 'albumsHeight', 'int', '200'),
            ('ImageViewer', 'albumsOpen', 'bool', '0'),
            ('ImageViewer', 'facesOpen', 'bool', '0'),
            ('ImageViewer', 'sidebarOpen', 'bool', '0'),
            ('GroupDetail', 'sortDir', 'str', 'asc'),
            ('Moments', 'sortBy', 'str', 'date'),
            ('Moments', 'sortDir', 'str', 'asc'),
            ('Moments', 'carouselExpanded', 'bool', '1'),
            ('EditMomentImagesModal', 'filter', 'str', 'all'),
            ('EditMomentImagesModal', 'sortDir', 'str', 'asc'),
            ('GroupsGallery', 'sortDir', 'str', 'desc'),
            ('GroupsGallery', 'sortBy', 'str', 'name'),
            ('AlbumsGallery', 'sortBy', 'str', 'name'),
            ('AlbumsGallery', 'sortDir', 'str', 'asc'),
            ('AlbumsDetail', 'sortDir', 'str', 'asc'),
            ('BucketDrawer', 'mode', 'str', 'download'),
            ('BucketDrawer', 'quality', 'str', 'high'),
            ('BucketDrawer', 'excludeAlready', 'bool', '1'),
            ('BucketDrawer', 'alreadyDownloaded', 'list', '[]'),
            ('BucketDrawer', 'alreadyUploaded', 'list', '[]'),
            ('BucketDrawer', 'queue', 'list', '[]'),
            ('UploadsGallery', 'sortDir', 'str', 'desc'),
            ('UploadsGallery', 'sortBy', 'str', 'started_at'),
            ('UploadDetail', 'mode', 'str', 'groups'),
            ('UploadDetail', 'sortDir', 'str', 'asc'),
            ('EventsGallery', 'filterVisibility', 'str', 'all'),
            ('EventsGallery', 'sortDir', 'str', 'desc'),
            ('EventsGallery', 'sortBy', 'str', 'date'),
            ('RequestsGallery', 'filterStatus', 'str', 'all'),
            ('RequestsGallery', 'sortDir', 'str', 'desc'),
            ('RequestsGallery', 'sortBy', 'str', 'requested_at'),
            ('RequestsDetail', 'sortDir', 'str', 'asc'),
            ('FeedbacksGallery', 'filterStatus', 'str', 'all'),
            ('FeedbacksGallery', 'sortDir', 'str', 'desc'),
            ('FeedbacksGallery', 'sortBy', 'str', 'created_at'),
            ('ProfilesGallery', 'filterStatus', 'string', 'all'),
            ('ProfilesGallery', 'sortDir', 'string', 'desc'),
            ('ProfilesGallery', 'sortBy', 'string', 'name'),
            ('ProfilesGallery', 'filterEventId', 'string', 'all'),
            ('SettingsPage', 'activeSection', 'str', 'limits'),
            ('SettingsPage', 'usageFilterPeriod', 'str', 'all'),
            ('SettingsPage', 'usageFilterDateFrom', 'str', ''),
            ('SettingsPage', 'usageFilterDateTo', 'str', ''),
            ('SettingsPage', 'usageSortBy', 'str', 'created_at'),
            ('SettingsPage', 'usageSortDir', 'str', 'desc'),
            ('SettingsPage', 'errorFilterPeriod', 'str', 'all'),
            ('SettingsPage', 'errorFilterDateFrom', 'str', ''),
            ('SettingsPage', 'errorFilterDateTo', 'str', ''),
            ('SettingsPage', 'errorFilterType', 'str', 'all'),
            ('SettingsPage', 'errorSortBy', 'str', 'created_at'),
            ('SettingsPage', 'errorSortDir', 'str', 'asc'),
            ('SettingsPage', 'auditFilterPeriod', 'str', 'all'),
            ('SettingsPage', 'auditFilterDateFrom', 'str', ''),
            ('SettingsPage', 'auditFilterDateTo', 'str', ''),
            ('SettingsPage', 'auditFilterSeverity', 'str', 'all'),
            ('SettingsPage', 'auditFilterAction', 'str', 'all'),
            ('SettingsPage', 'auditSortBy', 'str', 'timestamp'),
            ('SettingsPage', 'auditSortDir', 'str', 'desc')
        ON CONFLICT (preference_group, preference_key) DO NOTHING;
        """,
        """
        -- Delete default preferences
        DELETE FROM default_preferences;
        
        -- Delete settings
        DELETE FROM settings;
        
        -- Delete developer profile
        DELETE FROM profiles WHERE profile_id = '89cb4967-0eba-48af-99cc-5e87407fb639';
        """
    ),
]