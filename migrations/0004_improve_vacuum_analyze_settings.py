"""
Improve vacuum and analyze settings for better query performance.
Sets statistics target to 1000 for important columns and configures
better autovacuum settings for high-write tables.
"""

from yoyo import step

__depends__ = {'0003_add_email_verification_code'}

steps = [
    step(
        """
        -- Set statistics target to 1000 for important columns
        -- This improves query planning accuracy for frequently queried columns
        
        -- images table (high volume, frequently queried)
        ALTER TABLE images ALTER COLUMN event_id SET STATISTICS 1000;
        ALTER TABLE images ALTER COLUMN image_id SET STATISTICS 1000;
        ALTER TABLE images ALTER COLUMN status SET STATISTICS 1000;
        ALTER TABLE images ALTER COLUMN upload_id SET STATISTICS 1000;
        ALTER TABLE images ALTER COLUMN date_taken SET STATISTICS 1000;
        ALTER TABLE images ALTER COLUMN moment_id SET STATISTICS 1000;
        
        -- faces table (high volume, frequently joined)
        ALTER TABLE faces ALTER COLUMN image_id SET STATISTICS 1000;
        ALTER TABLE faces ALTER COLUMN group_id SET STATISTICS 1000;
        ALTER TABLE faces ALTER COLUMN face_id SET STATISTICS 1000;
        
        -- groups table (frequently queried)
        ALTER TABLE groups ALTER COLUMN event_id SET STATISTICS 1000;
        ALTER TABLE groups ALTER COLUMN group_id SET STATISTICS 1000;
        
        -- events table (core table, frequently queried)
        ALTER TABLE events ALTER COLUMN event_id SET STATISTICS 1000;
        ALTER TABLE events ALTER COLUMN status SET STATISTICS 1000;
        
        -- profiles table (core table, frequently queried)
        ALTER TABLE profiles ALTER COLUMN profile_id SET STATISTICS 1000;
        
        -- events_profiles junction table (frequently queried, complex joins)
        ALTER TABLE events_profiles ALTER COLUMN event_id SET STATISTICS 1000;
        ALTER TABLE events_profiles ALTER COLUMN profile_id SET STATISTICS 1000;
        
        -- Junction tables (frequently joined)
        ALTER TABLE albums_images ALTER COLUMN album_id SET STATISTICS 1000;
        ALTER TABLE albums_images ALTER COLUMN image_id SET STATISTICS 1000;
        
        ALTER TABLE profiles_images ALTER COLUMN profile_id SET STATISTICS 1000;
        ALTER TABLE profiles_images ALTER COLUMN image_id SET STATISTICS 1000;
        
        ALTER TABLE profiles_groups ALTER COLUMN profile_id SET STATISTICS 1000;
        ALTER TABLE profiles_groups ALTER COLUMN group_id SET STATISTICS 1000;
        
        ALTER TABLE profiles_albums ALTER COLUMN profile_id SET STATISTICS 1000;
        ALTER TABLE profiles_albums ALTER COLUMN album_id SET STATISTICS 1000;
        
        -- uploads table (frequently updated)
        ALTER TABLE uploads ALTER COLUMN event_id SET STATISTICS 1000;
        ALTER TABLE uploads ALTER COLUMN upload_id SET STATISTICS 1000;
        ALTER TABLE uploads ALTER COLUMN status SET STATISTICS 1000;
        
        -- moments table
        ALTER TABLE moments ALTER COLUMN event_id SET STATISTICS 1000;
        ALTER TABLE moments ALTER COLUMN moment_id SET STATISTICS 1000;
        
        -- albums table
        ALTER TABLE albums ALTER COLUMN event_id SET STATISTICS 1000;
        ALTER TABLE albums ALTER COLUMN album_id SET STATISTICS 1000;
        
        -- notifications table (frequently inserted)
        ALTER TABLE notifications ALTER COLUMN profile_id SET STATISTICS 1000;
        ALTER TABLE notifications ALTER COLUMN created_at SET STATISTICS 1000;
        
        -- feedbacks table (frequently inserted)
        ALTER TABLE feedbacks ALTER COLUMN profile_id SET STATISTICS 1000;
        ALTER TABLE feedbacks ALTER COLUMN created_at SET STATISTICS 1000;
        
        -- errors table (frequently inserted)
        ALTER TABLE errors ALTER COLUMN created_at SET STATISTICS 1000;
        ALTER TABLE errors ALTER COLUMN error_type SET STATISTICS 1000;
        
        -- audit_logs table (frequently inserted)
        ALTER TABLE audit_logs ALTER COLUMN timestamp SET STATISTICS 1000;
        ALTER TABLE audit_logs ALTER COLUMN action SET STATISTICS 1000;
        ALTER TABLE audit_logs ALTER COLUMN severity SET STATISTICS 1000;
        
        -- access_requests table
        ALTER TABLE access_requests ALTER COLUMN event_id SET STATISTICS 1000;
        ALTER TABLE access_requests ALTER COLUMN profile_id SET STATISTICS 1000;
        ALTER TABLE access_requests ALTER COLUMN requested_at SET STATISTICS 1000;
        
        -- access_requests_groups table
        ALTER TABLE access_requests_groups ALTER COLUMN access_request_id SET STATISTICS 1000;
        ALTER TABLE access_requests_groups ALTER COLUMN group_id SET STATISTICS 1000;
        """,
        """
        -- Revert statistics targets to default (100)
        ALTER TABLE images ALTER COLUMN event_id SET STATISTICS -1;
        ALTER TABLE images ALTER COLUMN image_id SET STATISTICS -1;
        ALTER TABLE images ALTER COLUMN status SET STATISTICS -1;
        ALTER TABLE images ALTER COLUMN upload_id SET STATISTICS -1;
        ALTER TABLE images ALTER COLUMN date_taken SET STATISTICS -1;
        ALTER TABLE images ALTER COLUMN moment_id SET STATISTICS -1;
        
        ALTER TABLE faces ALTER COLUMN image_id SET STATISTICS -1;
        ALTER TABLE faces ALTER COLUMN group_id SET STATISTICS -1;
        ALTER TABLE faces ALTER COLUMN face_id SET STATISTICS -1;
        
        ALTER TABLE groups ALTER COLUMN event_id SET STATISTICS -1;
        ALTER TABLE groups ALTER COLUMN group_id SET STATISTICS -1;
        
        ALTER TABLE events ALTER COLUMN event_id SET STATISTICS -1;
        ALTER TABLE events ALTER COLUMN status SET STATISTICS -1;
        
        ALTER TABLE profiles ALTER COLUMN profile_id SET STATISTICS -1;
        
        ALTER TABLE events_profiles ALTER COLUMN event_id SET STATISTICS -1;
        ALTER TABLE events_profiles ALTER COLUMN profile_id SET STATISTICS -1;
        
        ALTER TABLE albums_images ALTER COLUMN album_id SET STATISTICS -1;
        ALTER TABLE albums_images ALTER COLUMN image_id SET STATISTICS -1;
        
        ALTER TABLE profiles_images ALTER COLUMN profile_id SET STATISTICS -1;
        ALTER TABLE profiles_images ALTER COLUMN image_id SET STATISTICS -1;
        
        ALTER TABLE profiles_groups ALTER COLUMN profile_id SET STATISTICS -1;
        ALTER TABLE profiles_groups ALTER COLUMN group_id SET STATISTICS -1;
        
        ALTER TABLE profiles_albums ALTER COLUMN profile_id SET STATISTICS -1;
        ALTER TABLE profiles_albums ALTER COLUMN album_id SET STATISTICS -1;
        
        ALTER TABLE uploads ALTER COLUMN event_id SET STATISTICS -1;
        ALTER TABLE uploads ALTER COLUMN upload_id SET STATISTICS -1;
        ALTER TABLE uploads ALTER COLUMN status SET STATISTICS -1;
        
        ALTER TABLE moments ALTER COLUMN event_id SET STATISTICS -1;
        ALTER TABLE moments ALTER COLUMN moment_id SET STATISTICS -1;
        
        ALTER TABLE albums ALTER COLUMN event_id SET STATISTICS -1;
        ALTER TABLE albums ALTER COLUMN album_id SET STATISTICS -1;
        
        ALTER TABLE notifications ALTER COLUMN profile_id SET STATISTICS -1;
        ALTER TABLE notifications ALTER COLUMN created_at SET STATISTICS -1;
        
        ALTER TABLE feedbacks ALTER COLUMN profile_id SET STATISTICS -1;
        ALTER TABLE feedbacks ALTER COLUMN created_at SET STATISTICS -1;
        
        ALTER TABLE errors ALTER COLUMN created_at SET STATISTICS -1;
        ALTER TABLE errors ALTER COLUMN error_type SET STATISTICS -1;
        
        ALTER TABLE audit_logs ALTER COLUMN timestamp SET STATISTICS -1;
        ALTER TABLE audit_logs ALTER COLUMN action SET STATISTICS -1;
        ALTER TABLE audit_logs ALTER COLUMN severity SET STATISTICS -1;
        
        ALTER TABLE access_requests ALTER COLUMN event_id SET STATISTICS -1;
        ALTER TABLE access_requests ALTER COLUMN profile_id SET STATISTICS -1;
        ALTER TABLE access_requests ALTER COLUMN requested_at SET STATISTICS -1;
        
        ALTER TABLE access_requests_groups ALTER COLUMN access_request_id SET STATISTICS -1;
        ALTER TABLE access_requests_groups ALTER COLUMN group_id SET STATISTICS -1;
        """
    ),
    step(
        """
        -- Configure better autovacuum settings for high-write tables
        -- Lower scale factors mean autovacuum runs more frequently
        -- This is important for tables with frequent INSERT/UPDATE/DELETE operations
        
        -- images table: high volume, frequent updates (status changes)
        ALTER TABLE images SET (
            autovacuum_vacuum_scale_factor = 0.05,
            autovacuum_analyze_scale_factor = 0.02,
            autovacuum_vacuum_cost_delay = 10
        );
        
        -- faces table: high volume, frequent inserts
        ALTER TABLE faces SET (
            autovacuum_vacuum_scale_factor = 0.05,
            autovacuum_analyze_scale_factor = 0.02,
            autovacuum_vacuum_cost_delay = 10
        );
        
        -- events_profiles: junction table, frequently updated
        ALTER TABLE events_profiles SET (
            autovacuum_vacuum_scale_factor = 0.1,
            autovacuum_analyze_scale_factor = 0.05
        );
        
        -- Junction tables: frequently updated
        ALTER TABLE albums_images SET (
            autovacuum_vacuum_scale_factor = 0.1,
            autovacuum_analyze_scale_factor = 0.05
        );
        
        ALTER TABLE profiles_images SET (
            autovacuum_vacuum_scale_factor = 0.1,
            autovacuum_analyze_scale_factor = 0.05
        );
        
        ALTER TABLE profiles_groups SET (
            autovacuum_vacuum_scale_factor = 0.1,
            autovacuum_analyze_scale_factor = 0.05
        );
        
        ALTER TABLE profiles_albums SET (
            autovacuum_vacuum_scale_factor = 0.1,
            autovacuum_analyze_scale_factor = 0.05
        );
        
        -- uploads table: frequently updated during processing
        ALTER TABLE uploads SET (
            autovacuum_vacuum_scale_factor = 0.1,
            autovacuum_analyze_scale_factor = 0.05
        );
        
        -- notifications: high insert rate
        ALTER TABLE notifications SET (
            autovacuum_analyze_scale_factor = 0.05,
            autovacuum_vacuum_scale_factor = 0.2
        );
        
        -- feedbacks: frequent inserts
        ALTER TABLE feedbacks SET (
            autovacuum_analyze_scale_factor = 0.05,
            autovacuum_vacuum_scale_factor = 0.2
        );
        
        -- errors: high insert rate
        ALTER TABLE errors SET (
            autovacuum_analyze_scale_factor = 0.05,
            autovacuum_vacuum_scale_factor = 0.2
        );
        
        -- audit_logs: high insert rate
        ALTER TABLE audit_logs SET (
            autovacuum_analyze_scale_factor = 0.05,
            autovacuum_vacuum_scale_factor = 0.2
        );
        
        -- refresh_tokens: frequent inserts/deletes
        ALTER TABLE refresh_tokens SET (
            autovacuum_vacuum_scale_factor = 0.1,
            autovacuum_analyze_scale_factor = 0.05
        );
        
        -- groups: moderate updates
        ALTER TABLE groups SET (
            autovacuum_analyze_scale_factor = 0.1
        );
        
        -- events: moderate updates
        ALTER TABLE events SET (
            autovacuum_analyze_scale_factor = 0.1
        );
        
        -- profiles: moderate updates
        ALTER TABLE profiles SET (
            autovacuum_analyze_scale_factor = 0.1
        );
        """,
        """
        -- Revert autovacuum settings to defaults
        ALTER TABLE images RESET (
            autovacuum_vacuum_scale_factor,
            autovacuum_analyze_scale_factor,
            autovacuum_vacuum_cost_delay
        );
        
        ALTER TABLE faces RESET (
            autovacuum_vacuum_scale_factor,
            autovacuum_analyze_scale_factor,
            autovacuum_vacuum_cost_delay
        );
        
        ALTER TABLE events_profiles RESET (
            autovacuum_vacuum_scale_factor,
            autovacuum_analyze_scale_factor
        );
        
        ALTER TABLE albums_images RESET (
            autovacuum_vacuum_scale_factor,
            autovacuum_analyze_scale_factor
        );
        
        ALTER TABLE profiles_images RESET (
            autovacuum_vacuum_scale_factor,
            autovacuum_analyze_scale_factor
        );
        
        ALTER TABLE profiles_groups RESET (
            autovacuum_vacuum_scale_factor,
            autovacuum_analyze_scale_factor
        );
        
        ALTER TABLE profiles_albums RESET (
            autovacuum_vacuum_scale_factor,
            autovacuum_analyze_scale_factor
        );
        
        ALTER TABLE uploads RESET (
            autovacuum_vacuum_scale_factor,
            autovacuum_analyze_scale_factor
        );
        
        ALTER TABLE notifications RESET (
            autovacuum_vacuum_scale_factor,
            autovacuum_analyze_scale_factor
        );
        
        ALTER TABLE feedbacks RESET (
            autovacuum_vacuum_scale_factor,
            autovacuum_analyze_scale_factor
        );
        
        ALTER TABLE errors RESET (
            autovacuum_vacuum_scale_factor,
            autovacuum_analyze_scale_factor
        );
        
        ALTER TABLE audit_logs RESET (
            autovacuum_vacuum_scale_factor,
            autovacuum_analyze_scale_factor
        );
        
        ALTER TABLE refresh_tokens RESET (
            autovacuum_vacuum_scale_factor,
            autovacuum_analyze_scale_factor
        );
        
        ALTER TABLE groups RESET (
            autovacuum_analyze_scale_factor
        );
        
        ALTER TABLE events RESET (
            autovacuum_analyze_scale_factor
        );
        
        ALTER TABLE profiles RESET (
            autovacuum_analyze_scale_factor
        );
        """
    ),
]
