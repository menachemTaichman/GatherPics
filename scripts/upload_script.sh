#!/bin/sh

echo "--> Starting custom upload to R2..."

export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"
export AWS_REGION="auto"

SOURCE_FILE="/backups/last/${POSTGRES_DB}-latest.sql.gz"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DESTINATION="s3://gather-pics-backup/db/backup-${TIMESTAMP}.sql.gz"

aws s3 cp "$SOURCE_FILE" "$DESTINATION" --endpoint-url "$S3_ENDPOINT"

echo "--> Upload finished!"

