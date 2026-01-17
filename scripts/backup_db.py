#!/usr/bin/env python3
"""
Script to backup the current database to a new database with timestamp.
Optionally drops the previous backup database after successful backup.

Usage:
    python scripts/backup_db.py                    # Backup current DB, keep previous backup
    python scripts/backup_db.py --drop-prev        # Backup current DB, drop previous backup
    python scripts/backup_db.py --database prod_db # Backup specific database
"""

import os
import sys
import argparse
import time
import psycopg2
from psycopg2 import errors as psycopg2_errors
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Database configuration
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_USER = os.getenv('DB_USER', 'postgres')
DB_PASSWORD = os.getenv('DB_PASSWORD', '')
DEFAULT_DB_NAME = os.getenv('DB_NAME', 'photo_app_db')


def get_postgres_conn(database='postgres'):
    """Get PostgreSQL connection."""
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=database
    )


def database_exists(conn, db_name):
    """Check if a database exists."""
    with conn.cursor() as cursor:
        cursor.execute("""
            SELECT 1 FROM pg_database WHERE datname = %s
        """, (db_name,))
        return cursor.fetchone() is not None


def list_backup_databases(conn, base_db_name):
    """List all backup databases for the given base database name."""
    with conn.cursor() as cursor:
        cursor.execute("""
            SELECT datname 
            FROM pg_database 
            WHERE datname LIKE %s
            ORDER BY datname DESC
        """, (f"{base_db_name}_backup_%",))
        return [row[0] for row in cursor.fetchall()]


def drop_database(conn, db_name, is_cleanup=False):
    """Drop a database."""
    # Terminate all connections to the database first
    conn.autocommit = True
    with conn.cursor() as cursor:
        # Terminate all connections to the target database
        cursor.execute("""
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = %s AND pid <> pg_backend_pid()
        """, (db_name,))
        
        # Drop the database
        cursor.execute(f'DROP DATABASE IF EXISTS "{db_name}"')
        if is_cleanup:
            print(f"  (Cleaned up partial backup database: {db_name})")
        else:
            print(f"✓ Dropped database: {db_name}")


def terminate_database_connections(conn, db_name):
    """Terminate all connections to a database except our own."""
    with conn.cursor() as cursor:
        cursor.execute("""
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = %s AND pid <> pg_backend_pid()
        """, (db_name,))
        terminated = cursor.rowcount
        if terminated > 0:
            print(f"  Terminated {terminated} active connection(s) to source database")


def create_backup_database(source_db, backup_db_name, dry_run=False):
    """Create a backup database by copying the source database using TEMPLATE."""
    if dry_run:
        print(f"[DRY RUN] Would create backup database: {backup_db_name}")
        print(f"[DRY RUN] Would copy data from: {source_db} using TEMPLATE")
        return
    
    print(f"Creating backup database: {backup_db_name}")
    
    admin_conn = get_postgres_conn('postgres')
    admin_conn.autocommit = True
    
    try:
        # Terminate all connections to the source database
        # (required for CREATE DATABASE ... WITH TEMPLATE)
        print("Terminating connections to source database...")
        terminate_database_connections(admin_conn, source_db)
        
        # Create the backup database using the source as a template
        print("Copying database using TEMPLATE (this may take a while for large databases)...")
        with admin_conn.cursor() as cursor:
            # Use CREATE DATABASE ... WITH TEMPLATE to copy the entire database
            # This copies schema, data, functions, views, triggers, etc.
            cursor.execute(f"""
                CREATE DATABASE "{backup_db_name}"
                WITH TEMPLATE "{source_db}"
                OWNER {DB_USER}
            """)
        
        print("✓ Database backup completed successfully")
        
    except psycopg2_errors.ObjectInUse as e:
        # Database is still in use
        error_msg = str(e)
        raise Exception(
            f"Failed to create backup: source database '{source_db}' is still in use.\n"
            f"Please ensure all connections to the database are closed.\n"
            f"Original error: {error_msg}"
        )
    except Exception as e:
        # Clean up on error
        try:
            if database_exists(admin_conn, backup_db_name):
                print("Backup failed, cleaning up...")
                drop_database(admin_conn, backup_db_name, is_cleanup=True)
        except:
            pass
        raise
    finally:
        admin_conn.close()


def backup_database(source_db, drop_prev=False, dry_run=False):
    """Backup the source database to a new timestamped database."""
    timestamp = int(time.time())
    backup_db_name = f"{source_db}_backup_{timestamp}"
    
    print("=" * 60)
    print("Database Backup")
    print("=" * 60)
    print(f"Source database: {source_db}")
    print(f"Backup database: {backup_db_name}")
    print(f"Host: {DB_HOST}:{DB_PORT}")
    print(f"User: {DB_USER}")
    print(f"Mode: {'DRY RUN' if dry_run else 'EXECUTE'}")
    if drop_prev:
        print("Drop previous backup: YES")
    print("=" * 60)
    print()
    
    # Connect to postgres database to check/create backup
    admin_conn = get_postgres_conn('postgres')
    admin_conn.autocommit = True
    
    try:
        # Verify source database exists
        if not database_exists(admin_conn, source_db):
            print(f"✗ Error: Source database '{source_db}' does not exist!")
            sys.exit(1)
        
        # Check if backup database already exists (unlikely but possible)
        if database_exists(admin_conn, backup_db_name):
            print(f"✗ Error: Backup database '{backup_db_name}' already exists!")
            sys.exit(1)
        
        # Find previous backup if we need to drop it
        previous_backup = None
        if drop_prev:
            backups = list_backup_databases(admin_conn, source_db)
            # Filter out the current backup we're creating
            backups = [b for b in backups if b != backup_db_name]
            if backups:
                previous_backup = backups[0]  # Most recent (sorted DESC)
                print(f"Found previous backup: {previous_backup}")
        
        admin_conn.close()
        
        # Create the backup
        create_backup_database(source_db, backup_db_name, dry_run=dry_run)
        
        # Drop previous backup if requested and backup was successful
        if drop_prev and previous_backup and not dry_run:
            print()
            print(f"Dropping previous backup: {previous_backup}")
            admin_conn = get_postgres_conn('postgres')
            admin_conn.autocommit = True
            try:
                drop_database(admin_conn, previous_backup)
            finally:
                admin_conn.close()
        
        print()
        print("=" * 60)
        print("✓ Backup completed successfully!")
        print("=" * 60)
        print(f"Backup database: {backup_db_name}")
        if drop_prev and previous_backup:
            print(f"Previous backup dropped: {previous_backup}")
        print()
        
    except Exception as e:
        print(f"\n✗ Error during backup: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Backup the current database to a timestamped backup database'
    )
    parser.add_argument(
        '--database',
        type=str,
        default=DEFAULT_DB_NAME,
        help=f'Source database name (default: {DEFAULT_DB_NAME})'
    )
    parser.add_argument(
        '--drop-prev',
        action='store_true',
        help='Drop the previous backup database after successful backup'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be done without executing'
    )
    parser.add_argument(
        '--host',
        type=str,
        default=None,
        help='Database host (overrides DB_HOST from .env)'
    )
    parser.add_argument(
        '--port',
        type=str,
        default=None,
        help='Database port (overrides DB_PORT from .env)'
    )
    parser.add_argument(
        '--user',
        type=str,
        default=None,
        help='Database user (overrides DB_USER from .env)'
    )
    parser.add_argument(
        '--password',
        type=str,
        default=None,
        help='Database password (overrides DB_PASSWORD from .env)'
    )
    
    args = parser.parse_args()
    
    # Override environment variables if provided
    global DB_HOST, DB_PORT, DB_USER, DB_PASSWORD
    if args.host:
        DB_HOST = args.host
    if args.port:
        DB_PORT = args.port
    if args.user:
        DB_USER = args.user
    if args.password:
        DB_PASSWORD = args.password
    
    try:
        backup_database(
            args.database,
            drop_prev=args.drop_prev,
            dry_run=args.dry_run
        )
    except KeyboardInterrupt:
        print("\n\nAborted by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
