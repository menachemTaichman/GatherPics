#!/usr/bin/env bash
# Copy photo_app_db from port 9000 to photo_app_db_prod on port 5432.
# Usage: ./scripts/copy_db_to_prod.sh
# Requires: PGPASSWORD or .env with DB_USER, DB_PASSWORD

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load .env if present
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

# Use 127.0.0.1 for source to avoid IPv6 issues with SSH tunnel
SRC_HOST="127.0.0.1"
SRC_PORT="9000"
SRC_DB="photo_app_db"
DST_HOST="${DB_HOST:-localhost}"
DST_PORT="5432"
DST_DB="photo_app_db_prod"
USER="${DB_USER:-app_user}"
export PGPASSWORD="${DB_PASSWORD:-}"

DUMP_FILE="/tmp/photo_app_db_copy_$$.dump"

# Check if pg_dump actually works (not just exists)
USE_DOCKER=false
if command -v pg_dump &> /dev/null && pg_dump --version &> /dev/null; then
  USE_DOCKER=false
else
  USE_DOCKER=true
  echo "Using Docker postgres:15 image for database operations..."
fi

echo "Dumping $SRC_DB from $SRC_HOST:$SRC_PORT..."
if [ "$USE_DOCKER" = true ]; then
  docker run --rm --add-host host.docker.internal:host-gateway -e PGPASSWORD="$PGPASSWORD" -v /tmp:/tmp postgres:15 \
    pg_dump -h host.docker.internal -p "$SRC_PORT" -U "$USER" -d "$SRC_DB" -F c -f "/tmp/$(basename $DUMP_FILE)"
else
  pg_dump -h "$SRC_HOST" -p "$SRC_PORT" -U "$USER" -d "$SRC_DB" -F c -f "$DUMP_FILE"
fi

echo "Creating $DST_DB on $DST_HOST:$DST_PORT (if not exists)..."
if [ "$USE_DOCKER" = true ]; then
  docker run --rm --network host -e PGPASSWORD="$PGPASSWORD" postgres:15 \
    psql -h "$DST_HOST" -p "$DST_PORT" -U "$USER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$DST_DB'" | grep -q 1 \
    || docker run --rm --network host -e PGPASSWORD="$PGPASSWORD" postgres:15 \
    psql -h "$DST_HOST" -p "$DST_PORT" -U "$USER" -d postgres -c "CREATE DATABASE $DST_DB;"
else
  psql -h "$DST_HOST" -p "$DST_PORT" -U "$USER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$DST_DB'" | grep -q 1 \
    || psql -h "$DST_HOST" -p "$DST_PORT" -U "$USER" -d postgres -c "CREATE DATABASE $DST_DB;"
fi

echo "Restoring into $DST_DB..."
if [ "$USE_DOCKER" = true ]; then
  docker run --rm --network host -e PGPASSWORD="$PGPASSWORD" -v /tmp:/tmp postgres:15 \
    pg_restore -h "$DST_HOST" -p "$DST_PORT" -U "$USER" -d "$DST_DB" -F c "/tmp/$(basename $DUMP_FILE)"
else
  pg_restore -h "$DST_HOST" -p "$DST_PORT" -U "$USER" -d "$DST_DB" -F c "$DUMP_FILE"
fi

# Cleanup - file might be owned by root if created in Docker
sudo rm -f "$DUMP_FILE" 2>/dev/null || rm -f "$DUMP_FILE" 2>/dev/null || true
echo "Done: $SRC_DB -> $DST_DB"
