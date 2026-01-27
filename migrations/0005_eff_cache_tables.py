"""
Refactor effective-permissions from materialized views to cache tables.

- Creates images_eff, faces_eff, groups_eff, moments_eff, albums_eff as regular tables
  with indexes, ANALYZE-friendly stats, and autovacuum settings.
"""

from yoyo import step

__depends__ = {'0004_improve_vacuum_analyze_settings'}

steps = [
    step(
        """
        DROP MATERIALIZED VIEW IF EXISTS images_eff CASCADE;
        DROP MATERIALIZED VIEW IF EXISTS faces_eff CASCADE;
        DROP MATERIALIZED VIEW IF EXISTS groups_eff CASCADE;
        DROP MATERIALIZED VIEW IF EXISTS moments_eff CASCADE;
        DROP MATERIALIZED VIEW IF EXISTS albums_eff CASCADE;

        CREATE TABLE IF NOT EXISTS images_eff (
            event_id UUID NOT NULL,
            profile_id UUID NOT NULL,
            image_id UUID NOT NULL,
            is_accessible BOOLEAN NOT NULL,
            PRIMARY KEY (profile_id, image_id)
        );

        CREATE TABLE IF NOT EXISTS faces_eff (
            event_id UUID NOT NULL,
            profile_id UUID NOT NULL,
            face_id UUID NOT NULL,
            is_accessible BOOLEAN NOT NULL,
            PRIMARY KEY (profile_id, face_id)
        );

        CREATE TABLE IF NOT EXISTS groups_eff (
            event_id UUID NOT NULL,
            profile_id UUID NOT NULL,
            group_id UUID NOT NULL,
            is_accessible BOOLEAN NOT NULL,
            PRIMARY KEY (profile_id, group_id)
        );

        CREATE TABLE IF NOT EXISTS moments_eff (
            event_id UUID NOT NULL,
            profile_id UUID NOT NULL,
            moment_id UUID NOT NULL,
            is_accessible BOOLEAN NOT NULL,
            PRIMARY KEY (profile_id, moment_id)
        );

        CREATE TABLE IF NOT EXISTS albums_eff (
            event_id UUID NOT NULL,
            profile_id UUID NOT NULL,
            album_id UUID NOT NULL,
            is_accessible BOOLEAN NOT NULL,
            PRIMARY KEY (profile_id, album_id)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_images_eff_unique ON images_eff(profile_id, image_id);
        CREATE INDEX IF NOT EXISTS idx_images_eff_event_profile ON images_eff(event_id, profile_id);
        CREATE INDEX IF NOT EXISTS idx_images_eff_accessible ON images_eff(profile_id, image_id) WHERE is_accessible = TRUE;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_faces_eff_unique ON faces_eff(profile_id, face_id);
        CREATE INDEX IF NOT EXISTS idx_faces_eff_accessible ON faces_eff(profile_id, face_id) WHERE is_accessible = TRUE;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_eff_unique ON groups_eff(profile_id, group_id);
        CREATE INDEX IF NOT EXISTS idx_groups_eff_accessible ON groups_eff(profile_id, group_id) WHERE is_accessible = TRUE;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_moments_eff_unique ON moments_eff(profile_id, moment_id);
        CREATE INDEX IF NOT EXISTS idx_moments_eff_accessible ON moments_eff(profile_id, moment_id) WHERE is_accessible = TRUE;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_eff_unique ON albums_eff(profile_id, album_id);
        CREATE INDEX IF NOT EXISTS idx_albums_eff_accessible ON albums_eff(profile_id, album_id) WHERE is_accessible = TRUE;

        ALTER TABLE images_eff ALTER COLUMN event_id SET STATISTICS 1000;
        ALTER TABLE images_eff ALTER COLUMN profile_id SET STATISTICS 1000;
        ALTER TABLE images_eff ALTER COLUMN image_id SET STATISTICS 1000;
        ALTER TABLE images_eff SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.05);

        ALTER TABLE faces_eff ALTER COLUMN event_id SET STATISTICS 1000;
        ALTER TABLE faces_eff ALTER COLUMN profile_id SET STATISTICS 1000;
        ALTER TABLE faces_eff ALTER COLUMN face_id SET STATISTICS 1000;
        ALTER TABLE faces_eff SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.05);

        ALTER TABLE groups_eff ALTER COLUMN event_id SET STATISTICS 1000;
        ALTER TABLE groups_eff ALTER COLUMN profile_id SET STATISTICS 1000;
        ALTER TABLE groups_eff ALTER COLUMN group_id SET STATISTICS 1000;
        ALTER TABLE groups_eff SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.05);

        ALTER TABLE moments_eff ALTER COLUMN event_id SET STATISTICS 1000;
        ALTER TABLE moments_eff ALTER COLUMN profile_id SET STATISTICS 1000;
        ALTER TABLE moments_eff ALTER COLUMN moment_id SET STATISTICS 1000;
        ALTER TABLE moments_eff SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.05);

        ALTER TABLE albums_eff ALTER COLUMN event_id SET STATISTICS 1000;
        ALTER TABLE albums_eff ALTER COLUMN profile_id SET STATISTICS 1000;
        ALTER TABLE albums_eff ALTER COLUMN album_id SET STATISTICS 1000;
        ALTER TABLE albums_eff SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.05);
        """,
        """
        DROP TABLE IF EXISTS albums_eff CASCADE;
        DROP TABLE IF EXISTS moments_eff CASCADE;
        DROP TABLE IF EXISTS groups_eff CASCADE;
        DROP TABLE IF EXISTS faces_eff CASCADE;
        DROP TABLE IF EXISTS images_eff CASCADE;
        """,
    ),
]
