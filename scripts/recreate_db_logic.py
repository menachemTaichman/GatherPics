#!/usr/bin/env python3
"""
Script to recreate PostgreSQL functions, views, and triggers from static SQL files.
Reads SQL files from migrations/sql/ and executes them in order.

Usage:
    python scripts/recreate_db_logic.py                    # Use default database from .env
    python scripts/recreate_db_logic.py --database prod_db  # Use specific database
    python scripts/recreate_db_logic.py --dry-run            # Show SQL without executing
    python scripts/recreate_db_logic.py --drop-only          # Only drop objects, don't recreate
"""

import os
import sys
import argparse
import psycopg2
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Database configuration
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_USER = os.getenv('DB_USER', 'postgres')
DB_PASSWORD = os.getenv('DB_PASSWORD', '')
DEFAULT_DB_NAME = os.getenv('DB_NAME', 'photo_app_db')

# Path to SQL files
PROJECT_ROOT = Path(__file__).parent.parent
SQL_DIR = PROJECT_ROOT / 'migrations' / 'sql'

# SQL files in execution order
SQL_FILES = [
    'functions.sql',
    'views.sql',
    'triggers.sql',
]


def split_sql_statements(sql_text):
    """
    Split SQL text into individual statements.
    Handles semicolons that might be inside function bodies with $$ delimiters.
    """
    if not sql_text.strip():
        return []
    
    statements = []
    current = []
    in_dollar_quote = False
    dollar_tag = None
    
    i = 0
    while i < len(sql_text):
        # Check for dollar quote start: $tag$ or $$
        if not in_dollar_quote and sql_text[i] == '$':
            # Look ahead for dollar quote pattern
            j = i + 1
            while j < len(sql_text) and sql_text[j] != '$':
                j += 1
            if j < len(sql_text):
                dollar_tag = sql_text[i:j+1]  # Includes both $ signs
                in_dollar_quote = True
                current.append(dollar_tag)
                i = j + 1
                # Find closing tag
                tag_length = len(dollar_tag)
                while i < len(sql_text) - tag_length + 1:
                    if sql_text[i:i+tag_length] == dollar_tag:
                        current.append(dollar_tag)
                        in_dollar_quote = False
                        dollar_tag = None
                        i += tag_length
                        break
                    current.append(sql_text[i])
                    i += 1
                continue
        
        current.append(sql_text[i])
        
        # If semicolon and not in dollar quote, it's a statement separator
        if sql_text[i] == ';' and not in_dollar_quote:
            stmt = ''.join(current).strip()
            if stmt:
                statements.append(stmt)
            current = []
        
        i += 1
    
    # Add any remaining content
    if current:
        stmt = ''.join(current).strip()
        if stmt:
            statements.append(stmt)
    
    return statements


def execute_sql_statements(conn, statements, dry_run=False):
    """Execute SQL statements in a transaction."""
    if dry_run:
        print("\n" + "="*80)
        print("DRY RUN MODE - SQL statements that would be executed:")
        print("="*80 + "\n")
        for i, stmt in enumerate(statements, 1):
            print(f"-- Statement {i}")
            print(stmt)
            print("\n" + "-"*80 + "\n")
        return
    
    cursor = conn.cursor()
    try:
        for i, statement in enumerate(statements, 1):
            try:
                # Skip empty statements
                if not statement.strip():
                    continue
                
                # Execute statement
                cursor.execute(statement)
                if i % 10 == 0 or i == len(statements):
                    print(f"✓ Executed {i}/{len(statements)} statements")
            except Exception as e:
                print(f"\n✗ Error executing statement {i}/{len(statements)}:")
                # Show first few lines of SQL for context
                sql_preview = '\n'.join(statement.split('\n')[:5])
                print(f"SQL preview:\n{sql_preview}...")
                print(f"Error: {e}")
                raise
        
        conn.commit()
        print(f"\n✓ Successfully executed {len(statements)} statements")
    except Exception as e:
        conn.rollback()
        print(f"\n✗ Transaction rolled back due to error: {e}")
        raise
    finally:
        cursor.close()


def drop_all_objects(conn, dry_run=False):
    """Drop all functions, views, and triggers in the correct order."""
    if dry_run:
        print("\n[DRY RUN] Would drop all existing functions, views, and triggers first...")
        return
    
    cursor = conn.cursor()
    try:
        print("Dropping all existing triggers, views, and functions...")
        
        # Drop triggers first (they depend on functions and views)
        cursor.execute("""
            SELECT trigger_name, event_object_table, event_object_schema
            FROM information_schema.triggers
            WHERE event_object_schema = 'public'
            ORDER BY trigger_name
        """)
        triggers = cursor.fetchall()
        for trigger_name, table_name, schema in triggers:
            cursor.execute(f'DROP TRIGGER IF EXISTS {trigger_name} ON {schema}.{table_name} CASCADE')
        print(f"  Dropped {len(triggers)} trigger(s)")
        
        # Drop views (they may depend on functions and other views)
        cursor.execute("""
            SELECT table_name
            FROM information_schema.views
            WHERE table_schema = 'public'
            ORDER BY table_name
        """)
        views = cursor.fetchall()
        for (view_name,) in views:
            cursor.execute(f'DROP VIEW IF EXISTS {view_name} CASCADE')
        print(f"  Dropped {len(views)} view(s)")
        
        # Drop functions last (they may be used by triggers/views)
        # Get all functions with their signatures (handle overloaded functions)
        # Exclude functions that belong to extensions
        cursor.execute("""
            SELECT proname, pg_get_function_identity_arguments(oid) as args
            FROM pg_proc p
            WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
            AND NOT EXISTS (
                SELECT 1
                FROM pg_depend d
                JOIN pg_extension e ON d.refobjid = e.oid
                WHERE d.objid = p.oid
                AND d.deptype = 'e'
            )
            ORDER BY proname, args
        """)
        functions = cursor.fetchall()
        dropped_count = 0
        for (func_name, args) in functions:
            try:
                if args:
                    cursor.execute(f"DROP FUNCTION IF EXISTS {func_name}({args}) CASCADE")
                else:
                    cursor.execute(f"DROP FUNCTION IF EXISTS {func_name}() CASCADE")
                dropped_count += 1
            except Exception as e:
                # Log but continue - some functions might be protected or have dependencies
                print(f"  Warning: Could not drop function {func_name}({args or ''}): {e}")
        print(f"  Dropped {dropped_count} function(s)")
        
        conn.commit()
        print("✓ All existing objects dropped\n")
    except Exception as e:
        conn.rollback()
        print(f"✗ Error dropping objects: {e}")
        raise
    finally:
        cursor.close()


def read_sql_file(filepath):
    """Read SQL file and return content."""
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read()


def recreate_all(database_name, dry_run=False, drop_first=True, drop_only=False):
    """Recreate all functions, views, and triggers from static SQL files."""
    print("="*80)
    print("Recreating PostgreSQL Functions, Views, and Triggers")
    print("="*80)
    print(f"Database: {database_name}")
    print(f"Host: {DB_HOST}:{DB_PORT}")
    print(f"User: {DB_USER}")
    print(f"Mode: {'DRY RUN' if dry_run else 'EXECUTE'}")
    if drop_only:
        print("Action: DROP ONLY (will not recreate)")
    elif drop_first:
        print("Drop existing objects: YES")
    print("="*80 + "\n")
    
    # Verify SQL files exist
    sql_files = []
    for sql_filename in SQL_FILES:
        sql_file = SQL_DIR / sql_filename
        if not sql_file.exists():
            print(f"✗ Error: SQL file not found: {sql_file}")
            sys.exit(1)
        sql_files.append(sql_file)
    
    # Connect to database
    if not dry_run:
        print("Connecting to database...")
        try:
            conn = psycopg2.connect(
                host=DB_HOST,
                port=DB_PORT,
                user=DB_USER,
                password=DB_PASSWORD,
                database=database_name
            )
            conn.autocommit = False  # Use transactions
            print("✓ Connected to database\n")
        except Exception as e:
            print(f"✗ Failed to connect to database: {e}")
            sys.exit(1)
    else:
        conn = None
    
    try:
        # Drop all existing objects first if requested
        if drop_first or drop_only:
            drop_all_objects(conn, dry_run=dry_run)
        
        if drop_only:
            print("✓ Drop-only operation complete")
            return
        
        # Read and execute SQL files in order
        all_statements = []
        
        for sql_file in sql_files:
            filename = sql_file.name
            print(f"Reading {filename}...")
            
            sql_content = read_sql_file(sql_file)
            statements = split_sql_statements(sql_content)
            all_statements.extend(statements)
            print(f"  Found {len(statements)} statement(s)")
        
        print(f"\nTotal SQL statements to execute: {len(all_statements)}\n")
        
        if not all_statements:
            print("No SQL statements found. Exiting.")
            return
        
        # Execute all statements
        execute_sql_statements(conn, all_statements, dry_run=dry_run)
        
        if not dry_run:
            print("\n" + "="*80)
            print("✓ All functions, views, and triggers recreated successfully!")
            print("="*80)
    finally:
        if conn:
            conn.close()
            print("\nDatabase connection closed.")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Recreate all PostgreSQL functions, views, and triggers from static SQL files'
    )
    parser.add_argument(
        '--database',
        type=str,
        default=DEFAULT_DB_NAME,
        help=f'Database name (default: {DEFAULT_DB_NAME})'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show SQL statements without executing them'
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
    parser.add_argument(
        '--drop-first',
        action='store_true',
        default=True,
        help='Drop all existing functions, views, and triggers before recreating (default: True)'
    )
    parser.add_argument(
        '--no-drop-first',
        action='store_false',
        dest='drop_first',
        help='Skip dropping existing objects (use CREATE OR REPLACE only)'
    )
    parser.add_argument(
        '--drop-only',
        action='store_true',
        help='Only drop existing objects, do not recreate them'
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
    
    # Confirm before executing on production-like databases
    if not args.dry_run and args.database != DEFAULT_DB_NAME:
        response = input(
            f"\n⚠️  WARNING: You are about to modify database '{args.database}'.\n"
            f"This will recreate all functions, views, and triggers.\n"
            f"Continue? (yes/no): "
        )
        if response.lower() != 'yes':
            print("Aborted.")
            sys.exit(0)
    
    try:
        recreate_all(
            args.database,
            dry_run=args.dry_run,
            drop_first=args.drop_first,
            drop_only=args.drop_only
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

