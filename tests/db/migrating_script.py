"""
Development script to reset PostgreSQL database and migrate data from PostgreSQL or SQLite.
This script:
1. Connects to default 'postgres' database
2. (Default) Copies current PostgreSQL database to temporary database
3. Terminates all active connections to 'photo_app_db'
4. Drops and recreates 'photo_app_db'
5. Runs Yoyo migrations to create schema
6. Migrates data from PostgreSQL (default) or SQLite (if --from-sqlite flag is passed)
7. Converts timestamps from SQLite timezone to Israel timezone (Asia/Jerusalem) when migrating from SQLite

Schema Change Handling:
- Columns removed from target: Automatically excluded from migration
- Columns added to target: Will use default values or NULL (if nullable)
- Required columns (NOT NULL, no default) missing in source: Migration will fail with warning
- Column type changes: May cause issues if incompatible; basic type conversions are handled
- Column renames: Use COLUMN_MAPPING dictionary to map old names to new names

Timezone Configuration:
- SQLITE_TIMEZONE: The timezone used in the old SQLite database (default: 'UTC')
  If your SQLite database used a different timezone, update this value.
- POSTGRES_TIMEZONE: Target timezone for PostgreSQL (default: 'Asia/Jerusalem')
  The database will be configured to use this timezone, and all timestamps
  will be converted to this timezone during migration.

Backup Database Handling:
- Backup databases are preserved if migration fails (not cleaned up in error cases)
- Use --from-backup to restore from an existing backup database
- Backup databases are only cleaned up after successful migration completion
- If migration fails, you can run the script again with --from-backup to restore

Usage: 
  python migrating_script.py                    # Migrate from existing PostgreSQL database (default)
  python migrating_script.py --from-sqlite       # Migrate from SQLite instead
  python migrating_script.py --from-backup       # Migrate from existing backup database (most recent)
"""

import os
import sys
import json
import sqlite3
import psycopg2
import argparse
from psycopg2.extras import execute_batch, Json
from psycopg2 import errors as psycopg2_errors
from dotenv import load_dotenv
from yoyo import read_migrations, get_backend
from datetime import datetime, timezone, timedelta

# Try to import dateutil for timezone support, fallback to UTC if not available
try:
    from dateutil import tz
    HAS_DATEUTIL = True
except ImportError:
    HAS_DATEUTIL = False
    print("Warning: python-dateutil not installed. Using UTC for timezone conversions.")

# Load environment variables
load_dotenv()

# Database configuration
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_USER = os.getenv('DB_USER', 'postgres')
DB_PASSWORD = os.getenv('DB_PASSWORD', '')
DB_NAME = os.getenv('DB_NAME', 'photo_app_db')
SQLITE_DB_PATH = os.path.join(os.path.dirname(__file__), 'old_db.db')

# Boolean field mapping - INTEGER fields that should be converted to BOOLEAN
BOOLEAN_FIELDS = {
    'settings': [],
    'rekognition_usaged': [],
    'default_preferences': [],
    'profiles': ['can_create_events', 'is_public'],
    'events': ['is_public'],
    'profiles_preferences': [],
    'refresh_tokens': ['revoked'],
    'notifications': ['read'],
    'feedbacks': ['communication_consent', 'is_closed', 'solved'],
    'events_profiles': ['can_manage_event', 'can_delete_event', 'can_upload_and_delete_images', 
                        'can_edit', 'all_images', 'all_groups', 'all_albums'],
    'images': [],
    'faces': [],
    'groups': [],
    'moments': [],
    'albums': [],
    'albums_images': [],
    'events_profiles_images': [],
    'events_profiles_groups': [],
    'events_profiles_albums': [],
    'uploads': [],
    'access_requests': ['communication_consent', 'is_closed'],
    'access_requests_groups': ['approved'],
}

# Deferred FK columns - columns that reference tables that come later in migration order
# These will be copied without FK values first, then updated after referenced tables are migrated
DEFERRED_FK_COLUMNS = {
    'events': ['representative_image', 'archive_album_id', 'favorites_album_id', 'unassociated_group_id'],
    'moments': ['representative_image'],
    'albums': ['representative_image'],
    'groups': ['representative_face'],
}

# Columns that don't exist in PostgreSQL schema (removed/moved to other tables)
EXCLUDED_COLUMNS = {
    'events': ['min_rank_to_create_event'],  # This column is in settings table in PostgreSQL
    'events_profiles_images': ['event_id'],  # Junction table doesn't have event_id in PostgreSQL
    'events_profiles_groups': ['event_id'],  # Junction table doesn't have event_id in PostgreSQL
    'events_profiles_albums': ['event_id'],  # Junction table doesn't have event_id in PostgreSQL
}

# IDs to skip per table (rows already inserted by initial schema migration)
SKIP_IDS = {
    'profiles': {
        '89cb4967-0eba-48af-99cc-5e87407fb639',  # Developer profile inserted in 0001_initial_schema.py
    },
    'settings': {
        1,  # Settings row with id=1 inserted in 0001_initial_schema.py
    },
    # Add more tables/IDs as needed
}

# Table name mappings - maps old SQLite table names to new PostgreSQL table names
# Used when table names have changed between SQLite and PostgreSQL schemas
TABLE_MAPPING = {
    'events_profiles_images': 'profiles_images',
    'events_profiles_groups': 'profiles_groups',
    'events_profiles_albums': 'profiles_albums',
}

# Column name mappings - maps old SQLite column names to new PostgreSQL column names
# Used when column names have changed between SQLite and PostgreSQL schemas
COLUMN_MAPPING = {
    'faces': {
        'left': 'face_left',
        'top': 'face_top',
        'width': 'face_width',
        'height': 'face_height',
    },
    'moments': {
        'start': 'start_date',
        'end': 'end_date',
    }
}

# Tables with identity columns that need OVERRIDING SYSTEM VALUE
IDENTITY_COLUMN_TABLES = {
    'settings': 'id',
    'rekognition_usaged': 'usage_id',
    'refresh_tokens': 'token_id',
    'notifications': 'notification_id',
    'feedbacks': 'feedback_id',
    'uploads': 'upload_id',
    'access_requests': 'access_request_id',
}

# Timestamp columns that need timezone conversion
# Maps table name to list of timestamp column names
TIMESTAMP_COLUMNS = {
    'rekognition_usaged': ['created_at'],
    'events': ['created_at'],
    'refresh_tokens': ['issued_at', 'expires_at', 'revoked_at'],
    'notifications': ['created_at', 'read_at'],
    'feedbacks': ['created_at', 'closed_at'],
    'images': ['date_taken'],
    'moments': ['start_date', 'end_date'],
    'uploads': ['started_at', 'completed_at'],
    'access_requests': ['requested_at', 'closed_at'],
    'access_requests_groups': ['closed_at'],
}

# Timezone configuration
# SQLite timestamps are typically stored in UTC or local time
# We'll convert them to Israel timezone (Asia/Jerusalem)
SQLITE_TIMEZONE = 'Asia/Jerusalem'  # SQLite stored timestamps in Israel timezone
POSTGRES_TIMEZONE = 'Asia/Jerusalem'  # Target timezone for PostgreSQL

def get_postgres_conn(database='postgres'):
    """Get PostgreSQL connection with timezone configured."""
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=database
    )
    # Set timezone to Israel timezone
    if database != 'postgres':  # Don't set timezone for postgres database (used for admin operations)
        with conn.cursor() as cursor:
            cursor.execute(f"SET timezone = '{POSTGRES_TIMEZONE}'")
        conn.commit()
    return conn

def backup_postgres_database():
    """Backup current PostgreSQL database to a temporary database.
    
    Returns:
        str: Name of the temporary backup database
    """
    backup_db_name = f"{DB_NAME}_backup_{int(datetime.now().timestamp())}"
    print(f"Creating backup database: {backup_db_name}...")
    
    conn = get_postgres_conn('postgres')
    conn.autocommit = True
    cursor = conn.cursor()
    
    try:
        # Check if source database exists
        cursor.execute("""
            SELECT 1 FROM pg_database WHERE datname = %s
        """, (DB_NAME,))
        if not cursor.fetchone():
            raise ValueError(f"Source database {DB_NAME} does not exist!")
        
        # Terminate connections to source database
        print(f"Terminating active connections to {DB_NAME}...")
        cursor.execute("""
            SELECT pg_terminate_backend(pg_stat_activity.pid)
            FROM pg_stat_activity
            WHERE pg_stat_activity.datname = %s
            AND pid <> pg_backend_pid();
        """, (DB_NAME,))
        
        # Create backup database
        cursor.execute(f'CREATE DATABASE {backup_db_name} WITH TEMPLATE {DB_NAME}')
        print(f"Backup database {backup_db_name} created successfully!")
        return backup_db_name
        
    finally:
        cursor.close()
        conn.close()

def find_existing_backup_databases():
    """Find existing backup databases for the current DB_NAME.
    
    Returns:
        list: List of (backup_db_name, timestamp) tuples, sorted by timestamp (newest first)
    """
    conn = get_postgres_conn('postgres')
    conn.autocommit = True
    cursor = conn.cursor()
    
    try:
        # Find all databases that match the backup pattern
        backup_pattern = f"{DB_NAME}_backup_"
        cursor.execute("""
            SELECT datname 
            FROM pg_database 
            WHERE datname LIKE %s
            ORDER BY datname DESC
        """, (f"{backup_pattern}%",))
        
        backups = []
        for row in cursor.fetchall():
            backup_db_name = row[0]
            # Extract timestamp from backup name
            try:
                timestamp_str = backup_db_name.replace(backup_pattern, "")
                timestamp = int(timestamp_str)
                backups.append((backup_db_name, timestamp))
            except ValueError:
                # Skip if timestamp can't be parsed
                continue
        
        # Sort by timestamp (newest first)
        backups.sort(key=lambda x: x[1], reverse=True)
        return backups
    finally:
        cursor.close()
        conn.close()

def cleanup_backup_database(backup_db_name):
    """Drop the temporary backup database."""
    if not backup_db_name:
        return
    
    print(f"Cleaning up backup database: {backup_db_name}...")
    conn = get_postgres_conn('postgres')
    conn.autocommit = True
    cursor = conn.cursor()
    
    try:
        # Terminate connections to backup database
        cursor.execute("""
            SELECT pg_terminate_backend(pg_stat_activity.pid)
            FROM pg_stat_activity
            WHERE pg_stat_activity.datname = %s
            AND pid <> pg_backend_pid();
        """, (backup_db_name,))
        
        # Drop backup database
        cursor.execute(f'DROP DATABASE IF EXISTS {backup_db_name}')
        print(f"Backup database {backup_db_name} dropped.")
    finally:
        cursor.close()
        conn.close()

def reset_database():
    """Reset PostgreSQL database - drop and recreate."""
    print("Connecting to PostgreSQL server...")
    conn = get_postgres_conn('postgres')
    conn.autocommit = True
    cursor = conn.cursor()
    
    try:
        # Terminate all active connections to target database
        print(f"Terminating active connections to {DB_NAME}...")
        cursor.execute("""
            SELECT pg_terminate_backend(pg_stat_activity.pid)
            FROM pg_stat_activity
            WHERE pg_stat_activity.datname = %s
            AND pid <> pg_backend_pid();
        """, (DB_NAME,))
        
        # Drop database if exists
        print(f"Dropping database {DB_NAME} if exists...")
        cursor.execute(f'DROP DATABASE IF EXISTS {DB_NAME}')
        
        # Create database
        print(f"Creating database {DB_NAME}...")
        cursor.execute(f'CREATE DATABASE {DB_NAME}')
        
        print("Database reset complete!")
        
    finally:
        cursor.close()
        conn.close()

def run_migrations():
    """Run Yoyo migrations to create schema."""
    print("Running migrations...")
    backend = get_backend(
        f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    )
    migrations = read_migrations('migrations')
    backend.apply_migrations(backend.to_apply(migrations))
    
    # Set timezone for the database after migrations
    print("Setting database timezone to Asia/Jerusalem...")
    conn = get_postgres_conn(DB_NAME)
    try:
        with conn.cursor() as cursor:
            # Set timezone for the session
            cursor.execute(f"SET timezone = '{POSTGRES_TIMEZONE}'")
            # Optionally set default timezone for the database (affects new connections)
            cursor.execute(f"ALTER DATABASE {DB_NAME} SET timezone = '{POSTGRES_TIMEZONE}'")
        conn.commit()
        print("Database timezone configured!")
    finally:
        conn.close()
    
    print("Migrations complete!")

def convert_boolean_value(value, field_name, table_name):
    """Convert SQLite INTEGER boolean to PostgreSQL BOOLEAN."""
    if field_name in BOOLEAN_FIELDS.get(table_name, []):
        if value is None:
            return None
        return bool(value)  # Convert 0/1 to False/True
    return value

def convert_timestamp_value(value, field_name, table_name):
    """Convert SQLite timestamp to PostgreSQL timestamp with timezone conversion.
    
    SQLite timestamps are typically stored as strings in ISO format or as Unix timestamps.
    We convert them from SQLITE_TIMEZONE to POSTGRES_TIMEZONE (Israel timezone).
    """
    if value is None:
        return None
    
    # Check if this is a timestamp column
    if table_name not in TIMESTAMP_COLUMNS:
        return value
    if field_name not in TIMESTAMP_COLUMNS[table_name]:
        return value
    
    try:
        # SQLite timestamps can be stored as:
        # 1. ISO format strings: '2023-01-01 12:00:00' or '2023-01-01T12:00:00'
        # 2. Unix timestamps (integers/floats)
        # 3. Already datetime objects (if using datetime adapter)
        
        if isinstance(value, (int, float)):
            # Unix timestamp - convert to datetime in UTC
            if HAS_DATEUTIL:
                dt = datetime.fromtimestamp(value, tz=tz.gettz(SQLITE_TIMEZONE))
            else:
                dt = datetime.fromtimestamp(value, tz=timezone.utc)
        elif isinstance(value, str):
            # Try parsing as ISO format
            # First try dateutil parser (handles all ISO formats including timezone offsets like +00:00)
            if HAS_DATEUTIL:
                try:
                    from dateutil.parser import parse
                    dt = parse(value)
                except (ValueError, TypeError):
                    dt = None
            else:
                dt = None
            
            # If dateutil not available or parsing failed, try standard formats
            if dt is None:
                formats = [
                    '%Y-%m-%d %H:%M:%S',
                    '%Y-%m-%d %H:%M:%S.%f',
                    '%Y-%m-%dT%H:%M:%S',
                    '%Y-%m-%dT%H:%M:%S.%f',
                    '%Y-%m-%dT%H:%M:%S%z',  # Handles +0000 or -0500 format
                    '%Y-%m-%dT%H:%M:%S.%f%z',  # Handles +0000 or -0500 format
                ]
                for fmt in formats:
                    try:
                        dt = datetime.strptime(value, fmt)
                        break
                    except ValueError:
                        continue
                
                # If still None, try to handle +00:00 format manually (strptime doesn't support this)
                if dt is None and ('+' in value or value.count('-') > 2):
                    try:
                        # Remove timezone offset and parse, then add it back
                        if '+' in value:
                            base, offset = value.rsplit('+', 1)
                            sign = 1
                        elif value.count('-') > 2:
                            # Find the last - which is likely the timezone separator
                            parts = value.rsplit('-', 2)
                            base = '-'.join(parts[:-2])
                            offset = '-' + parts[-2] + ':' + parts[-1]
                            sign = -1
                        else:
                            raise ValueError("Cannot parse timezone")
                        
                        # Parse base datetime
                        for fmt in ['%Y-%m-%dT%H:%M:%S', '%Y-%m-%dT%H:%M:%S.%f']:
                            try:
                                dt = datetime.strptime(base, fmt)
                                break
                            except ValueError:
                                continue
                        
                        if dt is not None:
                            # Parse timezone offset (HH:MM format)
                            offset_parts = offset.replace(':', '').replace('+', '').replace('-', '')
                            if len(offset_parts) == 4:
                                hours = int(offset_parts[:2])
                                minutes = int(offset_parts[2:])
                                tz_offset = timedelta(hours=hours * sign, minutes=minutes * sign)
                                dt = dt.replace(tzinfo=timezone(tz_offset))
                    except (ValueError, IndexError):
                        pass
                
                # Last resort: try to parse as simple date
                if dt is None:
                    try:
                        dt = datetime.strptime(value.split()[0], '%Y-%m-%d')
                    except (ValueError, IndexError):
                        raise ValueError(f"Could not parse timestamp: {value}")
            
            # If no timezone info, assume it's in SQLITE_TIMEZONE
            if dt.tzinfo is None:
                if HAS_DATEUTIL:
                    dt = dt.replace(tzinfo=tz.gettz(SQLITE_TIMEZONE))
                else:
                    dt = dt.replace(tzinfo=timezone.utc)
        elif isinstance(value, datetime):
            # Already a datetime object
            dt = value
            # If no timezone info, assume it's in SQLITE_TIMEZONE
            if dt.tzinfo is None:
                if HAS_DATEUTIL:
                    dt = dt.replace(tzinfo=tz.gettz(SQLITE_TIMEZONE))
                else:
                    dt = dt.replace(tzinfo=timezone.utc)
        else:
            # Unknown type, return as-is
            return value
        
        # Convert from SQLITE_TIMEZONE to POSTGRES_TIMEZONE
        # If timezones are the same, just return the value as-is (no conversion needed)
        if SQLITE_TIMEZONE == POSTGRES_TIMEZONE:
            # Same timezone - just return as naive datetime (no conversion)
            return dt.replace(tzinfo=None) if dt.tzinfo else dt
        
        if HAS_DATEUTIL:
            # Convert to UTC first
            dt_utc = dt.astimezone(tz.UTC)
            # Then convert to target timezone
            dt_target = dt_utc.astimezone(tz.gettz(POSTGRES_TIMEZONE))
            # Return as naive datetime (representing local time in target timezone)
            return dt_target.replace(tzinfo=None)
        else:
            # Without dateutil, we can't do proper timezone conversion
            # Just convert to UTC and return (user should install python-dateutil for proper conversion)
            dt_utc = dt.astimezone(timezone.utc)
            return dt_utc.replace(tzinfo=None)
        
    except Exception as e:
        print(f"    Warning: Failed to convert timestamp {field_name}={value} in {table_name}: {e}")
        return value  # Return original value if conversion fails

def migrate_table(source_cursor, pg_cursor, pg_conn, table_name, exclude_columns=None, is_postgres_source=False, row_filter=None):
    """Migrate a single table from SQLite or PostgreSQL to PostgreSQL.
    
    Args:
        source_cursor: SQLite or PostgreSQL database cursor (source)
        pg_cursor: PostgreSQL database cursor (target)
        pg_conn: PostgreSQL database connection (for counting rows)
        table_name: Name of the table to migrate
        exclude_columns: List of column names to exclude from migration (for deferred FKs)
        is_postgres_source: If True, source is PostgreSQL; if False, source is SQLite
        row_filter: Optional function(row, column_names) -> bool to filter rows before migration
    """
    # Get PostgreSQL table name (may be different from SQLite name)
    pg_table_name = TABLE_MAPPING.get(table_name, table_name)
    print(f"Migrating table: {table_name} -> {pg_table_name}...")
    
    # Get all rows from source
    if is_postgres_source:
        # For PostgreSQL, select columns explicitly to ensure correct order
        source_table_name = table_name
        # Get source columns in their natural order
        if hasattr(source_cursor, 'connection'):
            source_conn = source_cursor.connection
            with source_conn.cursor() as source_info_cursor:
                source_info_cursor.execute("""
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_schema = 'public' 
                    AND table_name = %s 
                    ORDER BY ordinal_position
                """, (source_table_name,))
                source_column_order = [row[0] for row in source_info_cursor.fetchall()]
        else:
            # Fallback: use target order
            pg_cursor.execute("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = %s 
                ORDER BY ordinal_position
            """, (pg_table_name,))
            source_column_order = [row[0] for row in pg_cursor.fetchall()]
        
        # Get target columns to know which ones to include
        pg_cursor.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = %s 
            ORDER BY ordinal_position
        """, (pg_table_name,))
        target_column_order = [row[0] for row in pg_cursor.fetchall()]
        
        # Select columns that exist in both, in TARGET order (so values match INSERT order)
        select_columns = [col for col in target_column_order if col in source_column_order]
        if not select_columns:
            print(f"  No matching columns found between source and target for {table_name}")
            return
        
        # Detect schema differences
        missing_in_source = set(target_column_order) - set(source_column_order)
        missing_in_target = set(source_column_order) - set(target_column_order)
        
        if missing_in_source:
            print(f"    Warning: Target has columns not in source (will use defaults/NULL): {', '.join(sorted(missing_in_source))}")
        if missing_in_target:
            print(f"    Info: Source has columns not in target (will be excluded): {', '.join(sorted(missing_in_target))}")
        
        # Check for required columns that are missing (non-nullable, no default)
        if missing_in_source:
            pg_cursor.execute("""
                SELECT column_name, is_nullable, column_default
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = %s 
                AND column_name = ANY(%s)
            """, (pg_table_name, list(missing_in_source)))
            missing_cols_info = {row[0]: (row[1] == 'YES', row[2]) for row in pg_cursor.fetchall()}
            
            required_missing = [col for col, (nullable, default) in missing_cols_info.items() 
                              if not nullable and default is None]
            if required_missing:
                print(f"    Error: Required columns missing in source (no default): {', '.join(required_missing)}")
                print(f"    Migration may fail for this table. Consider adding defaults or making columns nullable.")
        
        # Create a mapping from target column name to source column index for reordering
        source_col_to_index = {col: i for i, col in enumerate(source_column_order)}
        
        # Select in target order - this ensures values are in the right order for INSERT
        # But we need to verify the actual returned column order matches
        source_cursor.execute(f'SELECT {", ".join(select_columns)} FROM {source_table_name}')
        
        # Verify the returned column order matches what we selected
        returned_column_names = [desc[0] for desc in source_cursor.description]
        if returned_column_names != select_columns:
            # Columns returned in different order - this shouldn't happen but let's handle it
            print(f"    Warning: Column order mismatch. Selected: {select_columns[:3]}..., Returned: {returned_column_names[:3]}...")
            # Create a mapping to reorder values
            value_reorder_map = [returned_column_names.index(col) for col in select_columns]
            # We'll need to reorder rows later
            all_column_names = select_columns
        else:
            all_column_names = select_columns  # These are in target order (for INSERT)
            value_reorder_map = None
    else:
        source_cursor.execute(f'SELECT * FROM {table_name}')
        all_column_names = [description[0] for description in source_cursor.description]
    
    rows = source_cursor.fetchall()
    
    if not rows:
        print(f"  No data in {table_name}")
        return
    
    # Apply column name mapping if exists for this table
    column_mapping = COLUMN_MAPPING.get(table_name, {})
    mapped_column_names = [column_mapping.get(col, col) for col in all_column_names]
    
    # For PostgreSQL source, detect JSONB columns
    jsonb_column_indices = set()
    if is_postgres_source:
        # Query information_schema from the source database to find JSONB columns
        # We need to use the source connection, not the target
        if hasattr(source_cursor, 'connection'):
            source_conn = source_cursor.connection
            with source_conn.cursor() as source_info_cursor:
                source_info_cursor.execute("""
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_schema = 'public' 
                    AND table_name = %s 
                    AND data_type IN ('json', 'jsonb')
                """, (source_table_name,))
                jsonb_column_names = {row[0] for row in source_info_cursor.fetchall()}
        else:
            # Fallback: query target database (should have same schema)
            pg_cursor.execute("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = %s 
                AND data_type IN ('json', 'jsonb')
            """, (pg_table_name,))
            jsonb_column_names = {row[0] for row in pg_cursor.fetchall()}
        
        # Map JSONB column names to their indices in the source
        for i, col_name in enumerate(all_column_names):
            # For PostgreSQL source, column names should match directly (no mapping needed)
            if col_name in jsonb_column_names:
                jsonb_column_indices.add(i)
    
    # Combine excluded columns from both deferred FKs and schema differences
    all_excluded = set(exclude_columns or [])
    all_excluded.update(EXCLUDED_COLUMNS.get(table_name, []))
    
    # Filter out excluded columns
    if all_excluded:
        exclude_indices = set(i for i, col in enumerate(all_column_names) if col in all_excluded)
        column_names = [mapped_col for i, mapped_col in enumerate(mapped_column_names) if i not in exclude_indices]
        # Create mapping from original index to filtered column name
        col_index_to_name = {i: mapped_col for i, mapped_col in enumerate(mapped_column_names) if i not in exclude_indices}
    else:
        exclude_indices = set()
        column_names = mapped_column_names
        col_index_to_name = {i: mapped_col for i, mapped_col in enumerate(mapped_column_names)}
    
    # Convert values (INTEGER booleans to BOOLEAN) and exclude deferred FK columns
    converted_rows = []
    skip_ids = SKIP_IDS.get(table_name, set())
    
    # Find primary key column index for this table (to check if row should be skipped)
    pk_column_index = None
    if skip_ids:
        # Try to find common primary key column names
        for pk_col in ['profile_id', 'event_id', 'image_id', 'group_id', 'moment_id', 'album_id', 'face_id', 'upload_id', 'access_request_id', 'token_id', 'notification_id', 'feedback_id', 'usage_id', 'id']:
            if pk_col in all_column_names:
                pk_column_index = all_column_names.index(pk_col)
                break
    
    for row in rows:
        # Skip rows that should be excluded (e.g., already inserted by initial schema)
        if pk_column_index is not None and row[pk_column_index] in skip_ids:
            continue  # Skip this row
        
        # Apply row filter if provided
        if row_filter is not None and not row_filter(row, all_column_names):
            continue  # Skip this row
        
        converted_row = []
        for i, value in enumerate(row):
            if i not in exclude_indices:
                col_name = col_index_to_name[i]
                # For PostgreSQL source, values are already in correct format
                if is_postgres_source:
                    # Handle JSONB columns - convert dict/list to Json() for psycopg2
                    # Check both by index and by column name (fallback if detection failed)
                    is_jsonb_col = (i in jsonb_column_indices or 
                                   col_name.lower() in ['data', 'metadata', 'config', 'settings', 'preferences'])
                    
                    if is_jsonb_col:
                        # This is a JSONB column - handle accordingly
                        # JSONB can store: dict, list, str, int, float, bool, None
                        if value is None:
                            converted_value = None
                        elif isinstance(value, (dict, list)):
                            converted_value = Json(value)
                        elif isinstance(value, str):
                            # Try to parse as JSON string first
                            try:
                                parsed = json.loads(value)
                                converted_value = Json(parsed)
                            except (json.JSONDecodeError, TypeError):
                                # Not valid JSON, but it's a JSONB column - wrap as string JSON
                                converted_value = Json(value)
                        elif isinstance(value, (int, float, bool)):
                            # JSONB can store primitives directly - wrap in Json()
                            converted_value = Json(value)
                        else:
                            # Unknown type in JSONB column - try to convert to JSON
                            try:
                                converted_value = Json(value)
                            except (TypeError, ValueError):
                                # Non-JSON value in JSONB column - this is an error
                                # This might indicate a column order mismatch
                                raise ValueError(
                                    f"Column '{col_name}' is JSONB but got {type(value).__name__} value: {value}. "
                                    f"This might indicate a column order mismatch. "
                                    f"Column index: {i}, Column name: {col_name}, "
                                    f"All columns: {all_column_names[:i+1]}, "
                                    f"Row values (first 3): {row[:3] if len(row) > 3 else row}"
                                )
                    elif isinstance(value, (dict, list)) and value is not None:
                        # Safety: if we have a dict/list but didn't detect it as JSONB, 
                        # check if column name suggests it might be JSONB
                        if 'json' in col_name.lower() or col_name.lower() in ['data', 'metadata', 'config']:
                            converted_value = Json(value)
                        else:
                            # Unknown dict/list - log warning but try to convert
                            print(f"    Warning: Column {col_name} has dict/list value but not detected as JSONB, attempting conversion")
                            converted_value = Json(value)
                    else:
                        converted_value = value
                else:
                    # First convert boolean, then timestamp (timestamp conversion handles non-timestamp values)
                    converted_value = convert_boolean_value(value, col_name, table_name)
                    converted_value = convert_timestamp_value(converted_value, col_name, table_name)
                converted_row.append(converted_value)
        converted_rows.append(tuple(converted_row))
    
    # Insert into PostgreSQL
    if column_names:
        placeholders = ', '.join(['%s'] * len(column_names))
        columns = ', '.join(column_names)
        # Use OVERRIDING SYSTEM VALUE for identity columns if needed
        if pg_table_name in IDENTITY_COLUMN_TABLES:
            identity_col = IDENTITY_COLUMN_TABLES[pg_table_name]
            if identity_col in column_names:
                # Use OVERRIDING SYSTEM VALUE to allow inserting into identity columns
                # PostgreSQL syntax: INSERT INTO table_name (cols) OVERRIDING SYSTEM VALUE VALUES (...)
                # OVERRIDING SYSTEM VALUE comes after the column list, before VALUES
                insert_sql = f'INSERT INTO {pg_table_name} ({columns}) OVERRIDING SYSTEM VALUE VALUES ({placeholders})'
            else:
                insert_sql = f'INSERT INTO {pg_table_name} ({columns}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'
        else:
            # Use ON CONFLICT DO NOTHING to skip duplicates gracefully
            insert_sql = f'INSERT INTO {pg_table_name} ({columns}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'
        
        try:
            # Get count before insert
            pg_cursor.execute(f'SELECT COUNT(*) FROM {pg_table_name}')
            count_before = pg_cursor.fetchone()[0]
            
            
            # For identity columns, we can't use ON CONFLICT, so handle conflicts by catching errors
            if pg_table_name in IDENTITY_COLUMN_TABLES:
                identity_col = IDENTITY_COLUMN_TABLES[pg_table_name]
                if identity_col in column_names:
                    # Insert row by row to handle conflicts gracefully
                    inserted_count = 0
                    for row in converted_rows:
                        try:
                            pg_cursor.execute(insert_sql, row)
                            inserted_count += 1
                        except psycopg2.IntegrityError as e:
                            # Skip duplicates - this can happen when migrating from PostgreSQL
                            # if rows were already inserted by migrations
                            # IntegrityError is the base class for UniqueViolation
                            pass
                        except Exception as e:
                            # Log other errors but continue
                            print(f"    Warning: Failed to insert row in {pg_table_name}: {e}")
                            pass
                    pg_conn.commit()
                else:
                    # No identity column in this insert, use batch
                    execute_batch(
                        pg_cursor,
                        insert_sql,
                        converted_rows,
                        page_size=100
                    )
                    pg_conn.commit()
            else:
                # Execute the batch insert
                execute_batch(
                    pg_cursor,
                    insert_sql,
                    converted_rows,
                    page_size=100
                )
                pg_conn.commit()  # Commit the batch
            
            # If this table has an identity column, reset the sequence to the max value
            if pg_table_name in IDENTITY_COLUMN_TABLES:
                identity_col = IDENTITY_COLUMN_TABLES[pg_table_name]
                if identity_col in column_names:
                    # Get the max value of the identity column
                    pg_cursor.execute(f'SELECT COALESCE(MAX({identity_col}), 0) FROM {pg_table_name}')
                    max_id = pg_cursor.fetchone()[0]
                    # Find the actual sequence name for this identity column
                    pg_cursor.execute("""
                        SELECT pg_get_serial_sequence(%s, %s)
                    """, (pg_table_name, identity_col))
                    sequence_result = pg_cursor.fetchone()
                    if sequence_result and sequence_result[0]:
                        sequence_name = sequence_result[0]  # Use full qualified name (schema.sequence)
                        # Reset the sequence to the max value (true means it's been used, so next value will be max_id + 1)
                        pg_cursor.execute(f"SELECT setval('{sequence_name}', {max_id}, true)")
                        pg_conn.commit()
            
            # Get count after insert to calculate how many were actually inserted
            pg_cursor.execute(f'SELECT COUNT(*) FROM {pg_table_name}')
            count_after = pg_cursor.fetchone()[0]
            rows_inserted = count_after - count_before
            rows_skipped = len(converted_rows) - rows_inserted
            
            excluded_info = f" (excluding {', '.join(exclude_columns)})" if exclude_columns else ""
            if rows_skipped > 0:
                print(f"  Migrated {rows_inserted} rows, skipped {rows_skipped} duplicates{excluded_info}")
            else:
                print(f"  Migrated {rows_inserted} rows{excluded_info}")
        except Exception as e:
            print(f"  Error migrating {table_name}: {e}")
            raise
    else:
        print(f"  No columns to migrate (all excluded)")

def update_deferred_fk_columns(source_cursor, pg_cursor, table_name, fk_column, primary_key_column, is_postgres_source=False):
    """Update deferred foreign key column after referenced table is migrated.
    
    Args:
        source_cursor: SQLite or PostgreSQL database cursor (source)
        pg_cursor: PostgreSQL database cursor (target)
        table_name: Name of the table to update
        fk_column: Name of the foreign key column to update
        primary_key_column: Name of the primary key column for matching rows
        is_postgres_source: If True, source is PostgreSQL; if False, source is SQLite
    """
    # Get PostgreSQL table name (may be different from SQLite name)
    pg_table_name = TABLE_MAPPING.get(table_name, table_name)
    print(f"  Updating {pg_table_name}.{fk_column}...")
    
    # Get all rows with their FK values from source
    source_cursor.execute(f'SELECT {primary_key_column}, {fk_column} FROM {table_name}')
    rows = source_cursor.fetchall()
    
    if not rows:
        return
    
    # Update each row in PostgreSQL
    updated_count = 0
    for pk_value, fk_value in rows:
        if fk_value is not None:
            update_sql = f'UPDATE {pg_table_name} SET {fk_column} = %s WHERE {primary_key_column} = %s'
            pg_cursor.execute(update_sql, (fk_value, pk_value))
            updated_count += 1
    
    if updated_count > 0:
        print(f"    Updated {updated_count} rows")

def migrate_data_from_postgres(backup_db_name):
    """Migrate data from PostgreSQL backup database to PostgreSQL."""
    print("Connecting to PostgreSQL backup database...")
    backup_conn = get_postgres_conn(backup_db_name)
    backup_cursor = backup_conn.cursor()
    
    print("Connecting to PostgreSQL target database...")
    pg_conn = get_postgres_conn(DB_NAME)
    pg_cursor = pg_conn.cursor()
    
    try:
        # Get all table names from PostgreSQL backup
        backup_cursor.execute("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        """)
        tables = [row[0] for row in backup_cursor.fetchall()]
        
        # Reverse TABLE_MAPPING to get PostgreSQL table names from SQLite names
        reverse_table_mapping = {v: k for k, v in TABLE_MAPPING.items()}
        
        # Convert PostgreSQL table names to SQLite names if needed (for compatibility with migration logic)
        # For PostgreSQL->PostgreSQL migration, we use the same table names
        migration_order = [
            # Base tables first (no FK dependencies)
            # 'default_preferences',  # Skipped - created by migrations
            'rekognition_usaged',
            
            # Tables that reference each other (circular) - create without FKs first
            'events',  # Created first, then profiles can reference it
            'profiles',  # Can reference events.restricted_to_event
            
            # Dependent on profiles and events
            'settings',
            'profiles_preferences',  # Will be filtered to only include preferences in default_preferences
            'refresh_tokens',
            'notifications',
            'feedbacks',
            
            # Junction table for events_profiles
            'events_profiles',
            
            # Dependent on events, created before images/groups that need them
            'groups',  # May need events.unassociated_group_id (deferred)
            'moments',  # Needs events, representative_image deferred
            'albums',  # Needs events, representative_image deferred
            
            # Uploads (needs events, profiles) - can be migrated before images
            'uploads',
            
            # Dependent on events and other tables
            'images',  # Needs events, moments (FK OK), uploads (FK OK now)
            
            # Dependent on images and groups
            'faces',  # Needs images, groups (FKs OK)
            
            # Junction tables (use PostgreSQL table names)
            'albums_images',  # Needs albums, images
            'profiles_images',  # PostgreSQL name for events_profiles_images
            'profiles_groups',  # PostgreSQL name for events_profiles_groups
            'profiles_albums',  # PostgreSQL name for events_profiles_albums
            
            # Access requests (needs events, profiles, groups)
            'access_requests',
            'access_requests_groups',  # Needs access_requests, groups
        ]
        
        # Primary key columns for each table (used for updating deferred FKs)
        primary_keys = {
            'events': 'event_id',
            'profiles': 'profile_id',
            'groups': 'group_id',
            'moments': 'moment_id',
            'albums': 'album_id',
            'images': 'image_id',
            'faces': 'face_id',
        }
        
        # Step 1: Migrate all tables, excluding deferred FK columns
        print("\nStep 1: Migrating tables (excluding deferred FK columns)...")
        
        # Get valid default preferences for filtering profiles_preferences
        pg_cursor.execute("""
            SELECT preference_group, preference_key 
            FROM default_preferences
        """)
        valid_preferences = set(pg_cursor.fetchall())
        
        for table_name in migration_order:
            # Check if table exists in backup (use PostgreSQL table name)
            pg_table_name = TABLE_MAPPING.get(table_name, table_name)
            if pg_table_name in tables:
                # For deferred FK columns, use the original table name (SQLite name) to look up columns
                deferred_cols = DEFERRED_FK_COLUMNS.get(table_name, [])
                
                # Special handling for profiles_preferences: filter to only include valid preferences
                row_filter = None
                if pg_table_name == 'profiles_preferences':
                    def filter_profiles_preferences(row, column_names):
                        # Find indices of preference_group and preference_key columns
                        try:
                            group_idx = column_names.index('preference_group')
                            key_idx = column_names.index('preference_key')
                            preference_pair = (row[group_idx], row[key_idx])
                            return preference_pair in valid_preferences
                        except (ValueError, IndexError):
                            # If columns not found, include the row (shouldn't happen)
                            return True
                    row_filter = filter_profiles_preferences
                
                migrate_table(backup_cursor, pg_cursor, pg_conn, pg_table_name, exclude_columns=deferred_cols, is_postgres_source=True, row_filter=row_filter)
                pg_conn.commit()
                
                # After migrating profiles_preferences, fill in missing preferences for all profiles
                if pg_table_name == 'profiles_preferences':
                    print("\n  Filling missing preferences for all profiles...")
                    # Get all default preferences
                    pg_cursor.execute("""
                        SELECT preference_group, preference_key, value
                        FROM default_preferences
                    """)
                    default_prefs = pg_cursor.fetchall()
                    
                    for preference_group, preference_key, default_value in default_prefs:
                        # Insert missing preferences for all profiles
                        pg_cursor.execute("""
                            INSERT INTO profiles_preferences (
                                profile_id,
                                preference_group,
                                preference_key,
                                preference_value
                            )
                            SELECT profile_id, %s, %s, %s
                            FROM profiles
                            ON CONFLICT (profile_id, preference_group, preference_key) DO NOTHING
                        """, (preference_group, preference_key, default_value))
                    
                    pg_conn.commit()
                    print("  Missing preferences filled")
                
                # After migrating groups, replace trigger-created Unassociated groups with backup IDs
                if pg_table_name == 'groups':
                    print("\n  Replacing trigger-created Unassociated groups with backup IDs...")
                    backup_cursor.execute("""
                        SELECT event_id, group_id, label 
                        FROM groups 
                        WHERE label = 'Unassociated'
                    """)
                    backup_unassociated_groups = backup_cursor.fetchall()
                    
                    for event_id, backup_group_id, label in backup_unassociated_groups:
                        # Check if trigger-created group exists
                        pg_cursor.execute("""
                            SELECT group_id FROM groups 
                            WHERE event_id = %s AND label = 'Unassociated'
                        """, (event_id,))
                        trigger_group = pg_cursor.fetchone()
                        
                        if trigger_group and trigger_group[0] != backup_group_id:
                            # Set transaction context to allow deletion of default group
                            pg_cursor.execute("""
                                SELECT set_transaction_context('temp_event_in_deletion', %s)
                            """, (str(event_id),))
                            
                            # Delete trigger-created group
                            pg_cursor.execute("""
                                DELETE FROM groups WHERE group_id = %s AND event_id = %s
                            """, (trigger_group[0], event_id))
                            
                            # Insert backup group (if not already exists from migration)
                            pg_cursor.execute("""
                                INSERT INTO groups (event_id, group_id, label, representative_face)
                                SELECT %s, %s, %s, NULL
                                WHERE NOT EXISTS (SELECT 1 FROM groups WHERE group_id = %s)
                            """, (event_id, backup_group_id, label, backup_group_id))
                            # Update events to reference backup ID
                            pg_cursor.execute("""
                                UPDATE events SET unassociated_group_id = %s WHERE event_id = %s
                            """, (backup_group_id, event_id))
                    
                    pg_conn.commit()
                    print("  Unassociated groups updated")
                
                # After migrating albums, replace trigger-created Archive/Favorites albums with backup IDs
                if pg_table_name == 'albums':
                    print("\n  Replacing trigger-created Archive/Favorites albums with backup IDs...")
                    backup_cursor.execute("""
                        SELECT event_id, archive_album_id, favorites_album_id 
                        FROM events
                    """)
                    events_data = backup_cursor.fetchall()
                    
                    for event_id, backup_archive_id, backup_favorites_id in events_data:
                        # Handle archive album
                        if backup_archive_id:
                            pg_cursor.execute("""
                                SELECT archive_album_id FROM events WHERE event_id = %s
                            """, (event_id,))
                            trigger_archive = pg_cursor.fetchone()
                            
                            if trigger_archive and trigger_archive[0] != backup_archive_id:
                                # Set transaction context to allow deletion of default album
                                pg_cursor.execute("""
                                    SELECT set_transaction_context('temp_event_in_deletion', %s)
                                """, (str(event_id),))
                                
                                # Delete trigger-created album
                                pg_cursor.execute("""
                                    DELETE FROM albums WHERE album_id = %s AND event_id = %s
                                """, (trigger_archive[0], event_id))
                                
                                # Insert backup album (if not already exists from migration)
                                pg_cursor.execute("""
                                    INSERT INTO albums (event_id, album_id, label, description, representative_image)
                                    SELECT %s, %s, 'Archive', NULL, NULL
                                    WHERE NOT EXISTS (SELECT 1 FROM albums WHERE album_id = %s)
                                """, (event_id, backup_archive_id, backup_archive_id))
                                # Update events to reference backup ID
                                pg_cursor.execute("""
                                    UPDATE events SET archive_album_id = %s WHERE event_id = %s
                                """, (backup_archive_id, event_id))
                        
                        # Handle favorites album
                        if backup_favorites_id:
                            pg_cursor.execute("""
                                SELECT favorites_album_id FROM events WHERE event_id = %s
                            """, (event_id,))
                            trigger_favorites = pg_cursor.fetchone()
                            
                            if trigger_favorites and trigger_favorites[0] != backup_favorites_id:
                                # Set transaction context to allow deletion of default album
                                pg_cursor.execute("""
                                    SELECT set_transaction_context('temp_event_in_deletion', %s)
                                """, (str(event_id),))
                                
                                # Delete trigger-created album
                                pg_cursor.execute("""
                                    DELETE FROM albums WHERE album_id = %s AND event_id = %s
                                """, (trigger_favorites[0], event_id))
                                
                                # Insert backup album (if not already exists from migration)
                                pg_cursor.execute("""
                                    INSERT INTO albums (event_id, album_id, label, description, representative_image)
                                    SELECT %s, %s, 'Favorites', NULL, NULL
                                    WHERE NOT EXISTS (SELECT 1 FROM albums WHERE album_id = %s)
                                """, (event_id, backup_favorites_id, backup_favorites_id))
                                # Update events to reference backup ID
                                pg_cursor.execute("""
                                    UPDATE events SET favorites_album_id = %s WHERE event_id = %s
                                """, (backup_favorites_id, event_id))
                    
                    pg_conn.commit()
                    print("  Archive/Favorites albums updated")
        
        # Step 2: Update deferred FK columns after referenced tables are migrated
        print("\nStep 2: Updating deferred foreign key columns...")
        
        # Update events.representative_image after images are migrated
        if 'images' in tables:
            update_deferred_fk_columns(backup_cursor, pg_cursor, 'events', 'representative_image', 'event_id', is_postgres_source=True)
            pg_conn.commit()
        
        # Update events.archive_album_id and favorites_album_id after albums are migrated
        if 'albums' in tables:
            update_deferred_fk_columns(backup_cursor, pg_cursor, 'events', 'archive_album_id', 'event_id', is_postgres_source=True)
            update_deferred_fk_columns(backup_cursor, pg_cursor, 'events', 'favorites_album_id', 'event_id', is_postgres_source=True)
            pg_conn.commit()
        
        # Update events.unassociated_group_id after groups are migrated
        if 'groups' in tables:
            update_deferred_fk_columns(backup_cursor, pg_cursor, 'events', 'unassociated_group_id', 'event_id', is_postgres_source=True)
            pg_conn.commit()
        
        # Update moments.representative_image after images are migrated
        if 'moments' in tables and 'images' in tables:
            update_deferred_fk_columns(backup_cursor, pg_cursor, 'moments', 'representative_image', 'moment_id', is_postgres_source=True)
            pg_conn.commit()
        
        # Update albums.representative_image after images are migrated
        if 'albums' in tables and 'images' in tables:
            update_deferred_fk_columns(backup_cursor, pg_cursor, 'albums', 'representative_image', 'album_id', is_postgres_source=True)
            pg_conn.commit()
        
        # Update groups.representative_face after faces are migrated
        if 'groups' in tables and 'faces' in tables:
            update_deferred_fk_columns(backup_cursor, pg_cursor, 'groups', 'representative_face', 'group_id', is_postgres_source=True)
            pg_conn.commit()
        
        print("\nData migration complete!")
        
        # Analyze database after migration
        print("\nAnalyzing database...")
        try:
            pg_cursor.execute('ANALYZE;')
            pg_conn.commit()
            print("Database analysis complete!")
        except Exception as e:
            print(f"Warning: Database analysis failed: {e}")
        
    finally:
        backup_cursor.close()
        backup_conn.close()
        pg_cursor.close()
        pg_conn.close()

def migrate_data():
    """Migrate data from SQLite to PostgreSQL."""
    if not os.path.exists(SQLITE_DB_PATH):
        print(f"SQLite database not found at {SQLITE_DB_PATH}")
        print("Skipping data migration...")
        return
    
    print("Connecting to SQLite database...")
    sqlite_conn = sqlite3.connect(SQLITE_DB_PATH)
    sqlite_cursor = sqlite_conn.cursor()
    
    print("Connecting to PostgreSQL database...")
    pg_conn = get_postgres_conn(DB_NAME)
    pg_cursor = pg_conn.cursor()
    
    try:
        # Get all table names from SQLite
        sqlite_cursor.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='table' 
            AND name NOT LIKE 'sqlite_%'
            ORDER BY name
        """)
        tables = [row[0] for row in sqlite_cursor.fetchall()]
        
        # Migration order respects foreign key dependencies
        # Based on test.py: creation_order with FK dependency handling
        # For circular dependencies (profiles <-> events), we handle them carefully
        migration_order = [
            # Base tables first (no FK dependencies)
            # 'default_preferences',  # Skipped - created by migrations
            'rekognition_usaged',
            
            # Tables that reference each other (circular) - create without FKs first
            'events',  # Created first, then profiles can reference it
            'profiles',  # Can reference events.restricted_to_event
            
            # Dependent on profiles and events
            'settings',
            'profiles_preferences',  # Will be filtered to only include preferences in default_preferences
            'refresh_tokens',
            'notifications',
            'feedbacks',
            
            # Junction table for events_profiles
            'events_profiles',
            
            # Dependent on events, created before images/groups that need them
            'groups',  # May need events.unassociated_group_id (deferred)
            'moments',  # Needs events, representative_image deferred
            'albums',  # Needs events, representative_image deferred
            
            # Uploads (needs events, profiles) - can be migrated before images
            'uploads',
            
            # Dependent on events and other tables
            'images',  # Needs events, moments (FK OK), uploads (FK OK now)
            
            # Dependent on images and groups
            'faces',  # Needs images, groups (FKs OK)
            
            # Junction tables
            'albums_images',  # Needs albums, images
            'events_profiles_images',  # Needs events_profiles, images
            'events_profiles_groups',  # Needs events_profiles, groups
            'events_profiles_albums',  # Needs events_profiles, albums
            
            # Access requests (needs events, profiles, groups)
            'access_requests',
            'access_requests_groups',  # Needs access_requests, groups
        ]
        
        # Primary key columns for each table (used for updating deferred FKs)
        primary_keys = {
            'events': 'event_id',
            'profiles': 'profile_id',
            'groups': 'group_id',
            'moments': 'moment_id',
            'albums': 'album_id',
            'images': 'image_id',
            'faces': 'face_id',
        }
        
        # Step 1: Migrate all tables, excluding deferred FK columns
        print("\nStep 1: Migrating tables (excluding deferred FK columns)...")
        
        # Get valid default preferences for filtering profiles_preferences
        pg_cursor.execute("""
            SELECT preference_group, preference_key 
            FROM default_preferences
        """)
        valid_preferences = set(pg_cursor.fetchall())
        
        for table_name in migration_order:
            if table_name in tables:
                deferred_cols = DEFERRED_FK_COLUMNS.get(table_name, [])
                
                # Special handling for profiles_preferences: filter to only include valid preferences
                row_filter = None
                if table_name == 'profiles_preferences':
                    def filter_profiles_preferences(row, column_names):
                        # Find indices of preference_group and preference_key columns
                        try:
                            group_idx = column_names.index('preference_group')
                            key_idx = column_names.index('preference_key')
                            preference_pair = (row[group_idx], row[key_idx])
                            return preference_pair in valid_preferences
                        except (ValueError, IndexError):
                            # If columns not found, include the row (shouldn't happen)
                            return True
                    row_filter = filter_profiles_preferences
                
                migrate_table(sqlite_cursor, pg_cursor, pg_conn, table_name, exclude_columns=deferred_cols, is_postgres_source=False, row_filter=row_filter)
                pg_conn.commit()
                
                # After migrating profiles_preferences, fill in missing preferences for all profiles
                if table_name == 'profiles_preferences':
                    print("\n  Filling missing preferences for all profiles...")
                    # Get all default preferences
                    pg_cursor.execute("""
                        SELECT preference_group, preference_key, value
                        FROM default_preferences
                    """)
                    default_prefs = pg_cursor.fetchall()
                    
                    for preference_group, preference_key, default_value in default_prefs:
                        # Insert missing preferences for all profiles
                        pg_cursor.execute("""
                            INSERT INTO profiles_preferences (
                                profile_id,
                                preference_group,
                                preference_key,
                                preference_value
                            )
                            SELECT profile_id, %s, %s, %s
                            FROM profiles
                            ON CONFLICT (profile_id, preference_group, preference_key) DO NOTHING
                        """, (preference_group, preference_key, default_value))
                    
                    pg_conn.commit()
                    print("  Missing preferences filled")
                
                # After migrating groups, replace trigger-created Unassociated groups with SQLite IDs
                if table_name == 'groups':
                    print("\n  Replacing trigger-created Unassociated groups with SQLite IDs...")
                    sqlite_cursor.execute("""
                        SELECT event_id, group_id, label 
                        FROM groups 
                        WHERE label = 'Unassociated'
                    """)
                    sqlite_unassociated_groups = sqlite_cursor.fetchall()
                    
                    for event_id, sqlite_group_id, label in sqlite_unassociated_groups:
                        # Check if trigger-created group exists
                        pg_cursor.execute("""
                            SELECT group_id FROM groups 
                            WHERE event_id = %s AND label = 'Unassociated'
                        """, (event_id,))
                        trigger_group = pg_cursor.fetchone()
                        
                        if trigger_group and trigger_group[0] != sqlite_group_id:
                            # Set transaction context to allow deletion of default group
                            pg_cursor.execute("""
                                SELECT set_transaction_context('temp_event_in_deletion', %s)
                            """, (str(event_id),))
                            
                            # Delete trigger-created group
                            pg_cursor.execute("""
                                DELETE FROM groups WHERE group_id = %s AND event_id = %s
                            """, (trigger_group[0], event_id))
                            
                            # Insert SQLite group (if not already exists from migration)
                            pg_cursor.execute("""
                                INSERT INTO groups (event_id, group_id, label, representative_face)
                                SELECT %s, %s, %s, NULL
                                WHERE NOT EXISTS (SELECT 1 FROM groups WHERE group_id = %s)
                            """, (event_id, sqlite_group_id, label, sqlite_group_id))
                            # Update events to reference SQLite ID
                            pg_cursor.execute("""
                                UPDATE events SET unassociated_group_id = %s WHERE event_id = %s
                            """, (sqlite_group_id, event_id))
                    
                    pg_conn.commit()
                    print("  Unassociated groups updated")
                
                # After migrating albums, replace trigger-created Archive/Favorites albums with SQLite IDs
                if table_name == 'albums':
                    print("\n  Replacing trigger-created Archive/Favorites albums with SQLite IDs...")
                    sqlite_cursor.execute("""
                        SELECT event_id, archive_album_id, favorites_album_id 
                        FROM events
                    """)
                    events_data = sqlite_cursor.fetchall()
                    
                    for event_id, sqlite_archive_id, sqlite_favorites_id in events_data:
                        # Handle archive album
                        if sqlite_archive_id:
                            pg_cursor.execute("""
                                SELECT archive_album_id FROM events WHERE event_id = %s
                            """, (event_id,))
                            trigger_archive = pg_cursor.fetchone()
                            
                            if trigger_archive and trigger_archive[0] != sqlite_archive_id:
                                # Set transaction context to allow deletion of default album
                                pg_cursor.execute("""
                                    SELECT set_transaction_context('temp_event_in_deletion', %s)
                                """, (str(event_id),))
                                
                                # Delete trigger-created album
                                pg_cursor.execute("""
                                    DELETE FROM albums WHERE album_id = %s AND event_id = %s
                                """, (trigger_archive[0], event_id))
                                
                                # Insert SQLite album (if not already exists from migration)
                                pg_cursor.execute("""
                                    INSERT INTO albums (event_id, album_id, label, description, representative_image)
                                    SELECT %s, %s, 'Archive', NULL, NULL
                                    WHERE NOT EXISTS (SELECT 1 FROM albums WHERE album_id = %s)
                                """, (event_id, sqlite_archive_id, sqlite_archive_id))
                                # Update events to reference SQLite ID
                                pg_cursor.execute("""
                                    UPDATE events SET archive_album_id = %s WHERE event_id = %s
                                """, (sqlite_archive_id, event_id))
                        
                        # Handle favorites album
                        if sqlite_favorites_id:
                            pg_cursor.execute("""
                                SELECT favorites_album_id FROM events WHERE event_id = %s
                            """, (event_id,))
                            trigger_favorites = pg_cursor.fetchone()
                            
                            if trigger_favorites and trigger_favorites[0] != sqlite_favorites_id:
                                # Set transaction context to allow deletion of default album
                                pg_cursor.execute("""
                                    SELECT set_transaction_context('temp_event_in_deletion', %s)
                                """, (str(event_id),))
                                
                                # Delete trigger-created album
                                pg_cursor.execute("""
                                    DELETE FROM albums WHERE album_id = %s AND event_id = %s
                                """, (trigger_favorites[0], event_id))
                                
                                # Insert SQLite album (if not already exists from migration)
                                pg_cursor.execute("""
                                    INSERT INTO albums (event_id, album_id, label, description, representative_image)
                                    SELECT %s, %s, 'Favorites', NULL, NULL
                                    WHERE NOT EXISTS (SELECT 1 FROM albums WHERE album_id = %s)
                                """, (event_id, sqlite_favorites_id, sqlite_favorites_id))
                                # Update events to reference SQLite ID
                                pg_cursor.execute("""
                                    UPDATE events SET favorites_album_id = %s WHERE event_id = %s
                                """, (sqlite_favorites_id, event_id))
                    
                    pg_conn.commit()
                    print("  Archive/Favorites albums updated")
        
        # Step 2: Update deferred FK columns after referenced tables are migrated
        print("\nStep 2: Updating deferred foreign key columns...")
        
        # Update events.representative_image after images are migrated
        if 'events' in tables and 'images' in tables:
            update_deferred_fk_columns(sqlite_cursor, pg_cursor, 'events', 'representative_image', 'event_id', is_postgres_source=False)
            pg_conn.commit()
        
        # Update events.archive_album_id and favorites_album_id after albums are migrated
        if 'events' in tables and 'albums' in tables:
            update_deferred_fk_columns(sqlite_cursor, pg_cursor, 'events', 'archive_album_id', 'event_id', is_postgres_source=False)
            update_deferred_fk_columns(sqlite_cursor, pg_cursor, 'events', 'favorites_album_id', 'event_id', is_postgres_source=False)
            pg_conn.commit()
        
        # Update events.unassociated_group_id after groups are migrated
        if 'events' in tables and 'groups' in tables:
            update_deferred_fk_columns(sqlite_cursor, pg_cursor, 'events', 'unassociated_group_id', 'event_id', is_postgres_source=False)
            pg_conn.commit()
        
        # Update moments.representative_image after images are migrated
        if 'moments' in tables and 'images' in tables:
            update_deferred_fk_columns(sqlite_cursor, pg_cursor, 'moments', 'representative_image', 'moment_id', is_postgres_source=False)
            pg_conn.commit()
        
        # Update albums.representative_image after images are migrated
        if 'albums' in tables and 'images' in tables:
            update_deferred_fk_columns(sqlite_cursor, pg_cursor, 'albums', 'representative_image', 'album_id', is_postgres_source=False)
            pg_conn.commit()
        
        # Update groups.representative_face after faces are migrated
        if 'groups' in tables and 'faces' in tables:
            update_deferred_fk_columns(sqlite_cursor, pg_cursor, 'groups', 'representative_face', 'group_id', is_postgres_source=False)
            pg_conn.commit()
        
        print("\nData migration complete!")
        
        # Analyze database after migration
        print("\nAnalyzing database...")
        try:
            pg_cursor.execute('ANALYZE;')
            pg_conn.commit()
            print("Database analysis complete!")
        except Exception as e:
            print(f"Warning: Database analysis failed: {e}")
        
    finally:
        sqlite_cursor.close()
        sqlite_conn.close()
        pg_cursor.close()
        pg_conn.close()

def main():
    """Main migration script."""
    # ========================================
    # CONFIGURATION: Set default migration source
    # Change these to set defaults for debugging (VS Code debugger, etc.)
    # Can be overridden with --from-sqlite, --from-postgres, or --from-backup command-line flags
    # ========================================
    DEFAULT_USE_SQLITE = False  # Set to True to default to SQLite, False for PostgreSQL
    DEFAULT_USE_BACKUP = False  # Set to True to default to backup database, False otherwise
    
    parser = argparse.ArgumentParser(description='Reset PostgreSQL database and migrate data')
    parser.add_argument('--from-sqlite', action='store_true',
                        help='Migrate from SQLite instead of existing PostgreSQL database (overrides default)')
    parser.add_argument('--from-postgres', action='store_true',
                        help='Migrate from existing PostgreSQL database (overrides default)')
    parser.add_argument('--from-backup', action='store_true',
                        help='Migrate from existing backup database (finds most recent backup)')
    args = parser.parse_args()
    
    # Determine migration source: command-line flag overrides default
    use_sqlite = DEFAULT_USE_SQLITE
    use_backup = DEFAULT_USE_BACKUP
    if args.from_backup:
        use_backup = True
        use_sqlite = False
    elif args.from_sqlite:
        use_backup = False
        use_sqlite = True
    elif args.from_postgres:
        use_backup = False
        use_sqlite = False
    
    print("=" * 60)
    print("PostgreSQL Database Reset and Migration Script")
    print("=" * 60)
    if use_backup:
        print("Migration source: PostgreSQL Backup Database")
    else:
        print(f"Migration source: {'SQLite' if use_sqlite else 'PostgreSQL'}")
    print()
    
    backup_db_name = None
    backup_was_existing = False  # Track if we're using an existing backup
    try:
        # Step 0: Get backup database (create new or use existing)
        if use_backup:
            # Find existing backup databases
            existing_backups = find_existing_backup_databases()
            if not existing_backups:
                print("Error: No existing backup databases found!")
                print(f"Looking for databases matching pattern: {DB_NAME}_backup_*")
                sys.exit(1)
            
            # Use the most recent backup
            backup_db_name, timestamp = existing_backups[0]
            backup_was_existing = True
            backup_time = datetime.fromtimestamp(timestamp)
            print(f"Using existing backup database: {backup_db_name}")
            print(f"Backup created at: {backup_time.strftime('%Y-%m-%d %H:%M:%S')}")
            print(f"Found {len(existing_backups)} backup database(s) total")
            if len(existing_backups) > 1:
                print("  (Using most recent backup)")
            print()
        elif not use_sqlite:
            # Create new backup
            backup_db_name = backup_postgres_database()
            print()
        
        # Step 1: Reset database
        reset_database()
        print()
        
        # Step 2: Run migrations
        run_migrations()
        print()
        
        # Step 3: Migrate data
        if use_sqlite:
            migrate_data()
        else:
            if backup_db_name:
                migrate_data_from_postgres(backup_db_name)
            else:
                print("Error: Backup database not available!")
                sys.exit(1)
        print()
        
        print("=" * 60)
        print("Migration complete!")
        print("=" * 60)
        
        # Only cleanup backup database if migration succeeded and it was a newly created backup
        # (Don't cleanup existing backups that were explicitly requested with --from-backup)
        if backup_db_name and not backup_was_existing:
            print()
            cleanup_backup_database(backup_db_name)
        elif backup_was_existing:
            print()
            print(f"Note: Backup database {backup_db_name} was preserved (use --from-backup to restore from it)")
        
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        if backup_db_name:
            if backup_was_existing:
                print(f"\nNote: Backup database {backup_db_name} is still available for recovery")
                print("      Run the script again with --from-backup to restore from it")
            else:
                print(f"\nNote: Backup database {backup_db_name} was preserved due to error")
                print("      Run the script again with --from-backup to restore from it")
        sys.exit(1)

if __name__ == '__main__':
    main()

