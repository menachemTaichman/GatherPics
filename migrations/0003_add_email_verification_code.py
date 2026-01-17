"""
Add email_verification_links table similar to password_reset_links.
This table stores temporary verification codes when a user changes their email.
Also adds revoked_at column to both password_reset_links and email_verification_links.
"""

from yoyo import step

__depends__ = {'0002_upgrade_rekognitions_requests'}

steps = [
    step(
        """
        -- Add revoked_at to password_reset_links
        ALTER TABLE password_reset_links
        ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP;

        -- Create email_verification_links table
        CREATE TABLE IF NOT EXISTS email_verification_links (
            verification_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
            profile_id UUID NOT NULL,
            new_email TEXT NOT NULL,
            verification_code TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP NOT NULL,
            used BOOLEAN NOT NULL DEFAULT FALSE,
            used_at TIMESTAMP,
            revoked_at TIMESTAMP
        );

        -- Foreign key constraint
        ALTER TABLE email_verification_links
            ADD CONSTRAINT fk_email_verification_links_profile_id 
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE;

        -- Index for faster lookups
        CREATE INDEX IF NOT EXISTS idx_email_verification_links_code ON email_verification_links(verification_code);
        """,
        """
        DROP INDEX IF EXISTS idx_email_verification_links_code;
        DROP TABLE IF EXISTS email_verification_links CASCADE;
        ALTER TABLE password_reset_links DROP COLUMN IF EXISTS revoked_at;
        """
    )
]
