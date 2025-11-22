"""
Development script to reset PostgreSQL database and migrate data from SQLite.
This script:
1. Connects to default 'postgres' database
2. Terminates all active connections to 'photo_app_db'
3. Drops and recreates 'photo_app_db'
4. Runs Yoyo migrations to create schema
5. Migrates data from SQLite to PostgreSQL

Usage: python migrating_script.py
"""

import os
import sys
import sqlite3
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv
from yoyo import read_migrations, get_backend
from src.core.config import DATA_ROOT

# Load environment variables
load_dotenv()

# Database configuration
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_USER = os.getenv('DB_USER', 'postgres')
DB_PASSWORD = os.getenv('DB_PASSWORD', '')
DB_NAME = os.getenv('DB_NAME', 'photo_app_db')
SQLITE_DB_PATH = os.path.join(DATA_ROOT, 'database.db')

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

def get_postgres_conn(database='postgres'):
    """Get PostgreSQL connection."""
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=database
    )

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
    print("Migrations complete!")

def convert_boolean_value(value, field_name, table_name):
    """Convert SQLite INTEGER boolean to PostgreSQL BOOLEAN."""
    if field_name in BOOLEAN_FIELDS.get(table_name, []):
        if value is None:
            return None
        return bool(value)  # Convert 0/1 to False/True
    return value

def migrate_table(sqlite_cursor, pg_cursor, table_name, exclude_columns=None):
    """Migrate a single table from SQLite to PostgreSQL.
    
    Args:
        sqlite_cursor: SQLite database cursor
        pg_cursor: PostgreSQL database cursor
        table_name: Name of the table to migrate
        exclude_columns: List of column names to exclude from migration (for deferred FKs)
    """
    print(f"Migrating table: {table_name}...")
    
    # Get all rows from SQLite
    sqlite_cursor.execute(f'SELECT * FROM {table_name}')
    rows = sqlite_cursor.fetchall()
    
    if not rows:
        print(f"  No data in {table_name}")
        return
    
    # Get column names
    all_column_names = [description[0] for description in sqlite_cursor.description]
    
    # Filter out excluded columns
    if exclude_columns:
        exclude_indices = set(i for i, col in enumerate(all_column_names) if col in exclude_columns)
        column_names = [col for i, col in enumerate(all_column_names) if i not in exclude_indices]
        # Create mapping from original index to filtered column name
        col_index_to_name = {i: col for i, col in enumerate(all_column_names) if i not in exclude_indices}
    else:
        exclude_indices = set()
        column_names = all_column_names
        col_index_to_name = {i: col for i, col in enumerate(all_column_names)}
    
    # Convert values (INTEGER booleans to BOOLEAN) and exclude deferred FK columns
    converted_rows = []
    for row in rows:
        converted_row = []
        for i, value in enumerate(row):
            if i not in exclude_indices:
                col_name = col_index_to_name[i]
                converted_value = convert_boolean_value(value, col_name, table_name)
                converted_row.append(converted_value)
        converted_rows.append(tuple(converted_row))
    
    # Insert into PostgreSQL
    if column_names:
        placeholders = ', '.join(['%s'] * len(column_names))
        columns = ', '.join(column_names)
        insert_sql = f'INSERT INTO {table_name} ({columns}) VALUES ({placeholders})'
        
        try:
            execute_values(
                pg_cursor,
                insert_sql,
                converted_rows,
                template=None,
                page_size=100
            )
            excluded_info = f" (excluding {', '.join(exclude_columns)})" if exclude_columns else ""
            print(f"  Migrated {len(converted_rows)} rows{excluded_info}")
        except Exception as e:
            print(f"  Error migrating {table_name}: {e}")
            raise
    else:
        print(f"  No columns to migrate (all excluded)")

def update_deferred_fk_columns(sqlite_cursor, pg_cursor, table_name, fk_column, primary_key_column):
    """Update deferred foreign key column after referenced table is migrated.
    
    Args:
        sqlite_cursor: SQLite database cursor
        pg_cursor: PostgreSQL database cursor
        table_name: Name of the table to update
        fk_column: Name of the foreign key column to update
        primary_key_column: Name of the primary key column for matching rows
    """
    print(f"  Updating {table_name}.{fk_column}...")
    
    # Get all rows with their FK values from SQLite
    sqlite_cursor.execute(f'SELECT {primary_key_column}, {fk_column} FROM {table_name}')
    rows = sqlite_cursor.fetchall()
    
    if not rows:
        return
    
    # Update each row in PostgreSQL
    updated_count = 0
    for pk_value, fk_value in rows:
        if fk_value is not None:
            update_sql = f'UPDATE {table_name} SET {fk_column} = %s WHERE {primary_key_column} = %s'
            pg_cursor.execute(update_sql, (fk_value, pk_value))
            updated_count += 1
    
    if updated_count > 0:
        print(f"    Updated {updated_count} rows")

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
            'default_preferences',
            'rekognition_usaged',
            
            # Tables that reference each other (circular) - create without FKs first
            'events',  # Created first, then profiles can reference it
            'profiles',  # Can reference events.restricted_to_event
            
            # Dependent on profiles and events
            'settings',
            'profiles_preferences',
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
        for table_name in migration_order:
            if table_name in tables:
                deferred_cols = DEFERRED_FK_COLUMNS.get(table_name, [])
                migrate_table(sqlite_cursor, pg_cursor, table_name, exclude_columns=deferred_cols)
                pg_conn.commit()
        
        # Step 2: Update deferred FK columns after referenced tables are migrated
        print("\nStep 2: Updating deferred foreign key columns...")
        
        # Update events.representative_image after images are migrated
        if 'events' in tables and 'images' in tables:
            update_deferred_fk_columns(sqlite_cursor, pg_cursor, 'events', 'representative_image', 'event_id')
            pg_conn.commit()
        
        # Update events.archive_album_id and favorites_album_id after albums are migrated
        if 'events' in tables and 'albums' in tables:
            update_deferred_fk_columns(sqlite_cursor, pg_cursor, 'events', 'archive_album_id', 'event_id')
            update_deferred_fk_columns(sqlite_cursor, pg_cursor, 'events', 'favorites_album_id', 'event_id')
            pg_conn.commit()
        
        # Update events.unassociated_group_id after groups are migrated
        if 'events' in tables and 'groups' in tables:
            update_deferred_fk_columns(sqlite_cursor, pg_cursor, 'events', 'unassociated_group_id', 'event_id')
            pg_conn.commit()
        
        # Update moments.representative_image after images are migrated
        if 'moments' in tables and 'images' in tables:
            update_deferred_fk_columns(sqlite_cursor, pg_cursor, 'moments', 'representative_image', 'moment_id')
            pg_conn.commit()
        
        # Update albums.representative_image after images are migrated
        if 'albums' in tables and 'images' in tables:
            update_deferred_fk_columns(sqlite_cursor, pg_cursor, 'albums', 'representative_image', 'album_id')
            pg_conn.commit()
        
        # Update groups.representative_face after faces are migrated
        if 'groups' in tables and 'faces' in tables:
            update_deferred_fk_columns(sqlite_cursor, pg_cursor, 'groups', 'representative_face', 'group_id')
            pg_conn.commit()
        
        print("\nData migration complete!")
        
    finally:
        sqlite_cursor.close()
        sqlite_conn.close()
        pg_cursor.close()
        pg_conn.close()

def main():
    """Main migration script."""
    print("=" * 60)
    print("PostgreSQL Database Reset and Migration Script")
    print("=" * 60)
    print()
    
    try:
        # Step 1: Reset database
        reset_database()
        print()
        
        # Step 2: Run migrations
        run_migrations()
        print()
        
        # Step 3: Migrate data
        migrate_data()
        print()
        
        print("=" * 60)
        print("Migration complete!")
        print("=" * 60)
        
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()

