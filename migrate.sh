#!/bin/bash
# Script to run yoyo database migrations
# Usage: ./migrate.sh [apply|rollback|list]

set -e

# Load environment variables from .env file if it exists
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Set defaults
DB_USER=${DB_USER:-postgres}
DB_PASSWORD=${DB_PASSWORD:-}
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-photo_app_db}

# Build database URL
DB_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
MIGRATIONS_DIR="./migrations"

# Get command (default: apply)
COMMAND=${1:-apply}

case "$COMMAND" in
    apply)
        echo "Applying migrations..."
        yoyo apply --database "$DB_URL" "$MIGRATIONS_DIR" --batch
        ;;
    rollback)
        echo "Rolling back migrations..."
        yoyo rollback --database "$DB_URL" "$MIGRATIONS_DIR" --batch
        ;;
    list)
        echo "Migration status:"
        yoyo list --database "$DB_URL" "$MIGRATIONS_DIR"
        ;;
    *)
        echo "Usage: $0 [apply|rollback|list]"
        echo ""
        echo "Examples:"
        echo "  $0 apply              # Apply pending migrations"
        echo "  $0 rollback           # Rollback last migration"
        echo "  $0 list               # List migration status"
        echo ""
        echo "For Docker, use:"
        echo "  docker compose exec web yoyo apply --database \"\$DB_URL\" ./migrations --batch"
        exit 1
        ;;
esac

