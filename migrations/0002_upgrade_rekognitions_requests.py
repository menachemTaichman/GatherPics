"""
Upgrade rekognition_requests logic.
Add face_matches_raw table to store raw AWS Rekognition face match results.
"""

from yoyo import step

__depends__ = {'0001_initial_schema'}

steps = [
    step(
        """
        ALTER TABLE rekognition_requests
        ADD COLUMN request_type TEXT,
        ADD COLUMN details JSONB;

        UPDATE rekognition_requests
        SET request_type = 'DETECT_FACES';

        ALTER TABLE rekognition_requests
        ALTER COLUMN request_type SET NOT NULL;

        ALTER TABLE rekognition_requests
        ADD CONSTRAINT ck_rekognition_requests_request_type CHECK (request_type IN ('DETECT_FACES', 'FETCH_FACE_MATCHES'));

        CREATE INDEX IF NOT EXISTS idx_rekognition_requests_created_at ON rekognition_requests(created_at);

        CREATE TABLE IF NOT EXISTS face_matches_raw (
            rekognition_request_id INTEGER REFERENCES rekognition_requests(rekognition_request_id) ON DELETE CASCADE,
            face_id UUID PRIMARY KEY REFERENCES faces(face_id) ON DELETE CASCADE,
            raw_matches JSONB NOT NULL
        );

        ALTER TABLE uploads
        DROP COLUMN IF EXISTS images_count,
        DROP COLUMN IF EXISTS faces_count,
        DROP COLUMN IF EXISTS clusters_count,
        DROP COLUMN IF EXISTS moments_count;

        ALTER TABLE images
        DROP CONSTRAINT fk_images_upload_id;

        ALTER TABLE images
        ADD CONSTRAINT fk_images_upload_id
        FOREIGN KEY (upload_id) REFERENCES uploads(upload_id) ON DELETE RESTRICT;
        """,
        """
        ALTER TABLE images
        DROP CONSTRAINT fk_images_upload_id;

        ALTER TABLE images
        ADD CONSTRAINT fk_images_upload_id
        FOREIGN KEY (upload_id) REFERENCES uploads(upload_id) ON DELETE SET NULL;

        ALTER TABLE uploads
        ADD COLUMN IF NOT EXISTS images_count INTEGER,
        ADD COLUMN IF NOT EXISTS faces_count INTEGER,
        ADD COLUMN IF NOT EXISTS clusters_count INTEGER,
        ADD COLUMN IF NOT EXISTS moments_count INTEGER;

        DROP TABLE IF EXISTS face_matches_raw CASCADE;

        ALTER TABLE rekognition_requests
        DROP COLUMN IF EXISTS details,
        DROP COLUMN IF EXISTS request_type;
        """
    )
]

