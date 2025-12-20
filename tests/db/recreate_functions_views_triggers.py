"""
Script to recreate all PostgreSQL functions, views, and triggers.
This script extracts SQL from migration files and executes them in order.

Can be used to recreate database objects in production or development databases.

Dry-run mode:
    When --dry-run is enabled, the script will extract and display all SQL statements
    that would be executed, but will NOT actually execute them against the database.
    This is useful for:
    - Previewing what changes will be made
    - Debugging SQL extraction issues
    - Verifying the script works without modifying the database
    - Testing the script before running on production

Usage:
    python recreate_functions_views_triggers.py                    # Use default database from .env
    python recreate_functions_views_triggers.py --database prod_db  # Use specific database
    python recreate_functions_views_triggers.py --dry-run            # Show SQL without executing
"""

import os
import sys
import re
import argparse
import psycopg2
from psycopg2 import sql
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Database configuration
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_USER = os.getenv('DB_USER', 'postgres')
DB_PASSWORD = os.getenv('DB_PASSWORD', '')
DEFAULT_DB_NAME = os.getenv('DB_NAME', 'photo_app_db')

# Path to migrations directory
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIGRATIONS_DIR = os.path.join(PROJECT_ROOT, 'migrations')


def extract_sql_from_step(step_content):
    """
    Extract SQL from a yoyo step.
    Steps are typically: step('''SQL''', '''ROLLBACK_SQL''')
    We want the first argument (forward SQL).
    """
    # Remove the step() wrapper and extract the first triple-quoted string
    # Match: step("""...""", """...""") or step("""...""")
    pattern = r'step\s*\(\s*"""(.*?)"""'
    match = re.search(pattern, step_content, re.DOTALL)
    if match:
        return match.group(1).strip()
    return None


def read_migration_file(filepath):
    """Read a migration file and extract all forward SQL statements."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Extract all step() calls - each step has forward SQL as first argument
    steps = []
    
    # Use regex to find all step( """...""" patterns
    # Pattern: step( followed by triple-quoted string (non-greedy)
    # We match the first triple-quoted string in each step() call
    pattern = r'step\s*\(\s*"""(.*?)"""'
    
    matches = re.finditer(pattern, content, re.DOTALL)
    for match in matches:
        sql_content = match.group(1).strip()
        if sql_content:
            steps.append(sql_content)
    
    return steps


def get_migration_files():
    """Get migration files in order: functions, views, triggers."""
    files = [
        os.path.join(MIGRATIONS_DIR, '0002_functions.py'),
        os.path.join(MIGRATIONS_DIR, '0003_views.py'),
        os.path.join(MIGRATIONS_DIR, '0004_triggers.py'),
    ]
    
    # Verify files exist
    for filepath in files:
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Migration file not found: {filepath}")
    
    return files


def split_sql_statements(sql_text):
    """
    Split SQL text into individual statements.
    Handles semicolons that might be inside function bodies with $$ delimiters.
    Uses a simpler approach: split by semicolon, but keep track of $$ blocks.
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
            tag_start = i
            while j < len(sql_text) and sql_text[j] != '$':
                j += 1
            if j < len(sql_text):
                dollar_tag = sql_text[i:j+1]  # Includes both $ signs
                in_dollar_quote = True
                current.append(dollar_tag)
                i = j + 1
                # Find closing tag
                while i < len(sql_text) - len(dollar_tag) + 1:
                    if sql_text[i:i+len(dollar_tag)] == dollar_tag:
                        current.append(dollar_tag)
                        in_dollar_quote = False
                        dollar_tag = None
                        i += len(dollar_tag)
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
                
                # Execute statement (can contain multiple SQL statements)
                cursor.execute(statement)
                print(f"✓ Executed statement block {i}/{len(statements)}")
            except Exception as e:
                print(f"\n✗ Error executing statement block {i}/{len(statements)}:")
                # Show first few lines of SQL for context
                sql_preview = '\n'.join(statement.split('\n')[:5])
                print(f"SQL preview:\n{sql_preview}...")
                print(f"Error: {e}")
                raise
        
        conn.commit()
        print(f"\n✓ Successfully executed {len(statements)} statement blocks")
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
        cursor.execute("""
            SELECT proname, pg_get_function_identity_arguments(oid) as args
            FROM pg_proc
            WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
            ORDER BY proname, args
        """)
        functions = cursor.fetchall()
        for (func_name, args) in functions:
            if args:
                cursor.execute(f"DROP FUNCTION IF EXISTS {func_name}({args}) CASCADE")
            else:
                cursor.execute(f"DROP FUNCTION IF EXISTS {func_name}() CASCADE")
        print(f"  Dropped {len(functions)} function(s)")
        
        conn.commit()
        print("✓ All existing objects dropped\n")
    except Exception as e:
        conn.rollback()
        print(f"✗ Error dropping objects: {e}")
        raise
    finally:
        cursor.close()


def recreate_all(database_name, dry_run=False, drop_first=True):
    """Recreate all functions, views, and triggers."""
    print("="*80)
    print("Recreating PostgreSQL Functions, Views, and Triggers")
    print("="*80)
    print(f"Database: {database_name}")
    print(f"Host: {DB_HOST}:{DB_PORT}")
    print(f"User: {DB_USER}")
    print(f"Mode: {'DRY RUN' if dry_run else 'EXECUTE'}")
    if drop_first:
        print("Drop existing objects: YES")
    print("="*80 + "\n")
    
    # Get migration files
    migration_files = get_migration_files()
    
    # Collect all SQL statements (each step is one statement block)
    all_statements = []
    
    for filepath in migration_files:
        filename = os.path.basename(filepath)
        print(f"Reading {filename}...")
        
        steps = read_migration_file(filepath)
        print(f"  Found {len(steps)} step(s)")
        
        for step_idx, step_sql in enumerate(steps, 1):
            # Each step's SQL is executed as a block (may contain multiple statements)
            if step_sql.strip():
                all_statements.append(step_sql)
                # Count approximate number of statements in this block
                stmt_count = step_sql.count(';') - step_sql.count('$$')  # Rough estimate
                print(f"    Step {step_idx}: ~{stmt_count} statement(s)")
    
    print(f"\nTotal SQL statement blocks to execute: {len(all_statements)}\n")
    
    if not all_statements:
        print("No SQL statements found. Exiting.")
        return
    
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
        sql = """
            rollback;
            begin;

            SELECT set_profile_context(
                'profile_id',
                '89cb4967-0eba-48af-99cc-5e87407fb639'
            );

            SELECT set_event_profile_context(
                'event_id',
                '73f1cf50-95ee-4832-97ef-83c0f50a82c0'
            );

            SELECT c.image_id, c.date_taken, c.width, c.height
            FROM images_ctx c
            INNER JOIN albums_images_ctx r ON c.image_id = r.image_id AND r.album_id = '9123a4f0-c06a-484c-8f69-b57018d46a53'
            WHERE 1=1;

            commit;
        """
        # result = execute_sql_statements(conn, [sql], dry_run=dry_run)
        # print(result)

        if drop_first:
            drop_all_objects(conn, dry_run=dry_run)
        
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
    # ========================================
    # CONFIGURATION: Set default behavior
    # Change these to set defaults for debugging (VS Code debugger, etc.)
    # Can be overridden with command-line flags
    # ========================================
    DEFAULT_DRY_RUN = False  # Set to True to default to dry-run mode
    DEFAULT_DATABASE = DEFAULT_DB_NAME  # Set to override default database name
    DEFAULT_USE_PORT_9000 = True  # Set to True to use port 9000 instead of 5432
    DEFAULT_DB_PORT = '9000' if DEFAULT_USE_PORT_9000 else '5432'
    DEFAULT_DROP_FIRST = True  # Set to False to skip dropping existing objects first
    
    parser = argparse.ArgumentParser(
        description='Recreate all PostgreSQL functions, views, and triggers'
    )
    parser.add_argument(
        '--database',
        type=str,
        default=DEFAULT_DATABASE,
        help=f'Database name (default: {DEFAULT_DATABASE})'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        default=DEFAULT_DRY_RUN,
        help='Show SQL statements without executing them (default: False, can be set in code for debugging)'
    )
    parser.add_argument(
        '--no-dry-run',
        action='store_false',
        dest='dry_run',
        help='Override default dry-run setting and actually execute SQL'
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
        help=f'Database port (overrides DB_PORT from .env, default from code: {DEFAULT_DB_PORT if DEFAULT_USE_PORT_9000 else "from .env"})'
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
        default=DEFAULT_DROP_FIRST,
        help='Drop all existing functions, views, and triggers before recreating (default: True)'
    )
    parser.add_argument(
        '--no-drop-first',
        action='store_false',
        dest='drop_first',
        help='Skip dropping existing objects (use CREATE OR REPLACE only)'
    )
    
    args = parser.parse_args()
    
    # Override environment variables if provided
    global DB_HOST, DB_PORT, DB_USER, DB_PASSWORD
    if args.host:
        DB_HOST = args.host
    if args.port:
        DB_PORT = args.port
    elif DEFAULT_USE_PORT_9000:
        # Use debug default port if not provided via command line
        DB_PORT = DEFAULT_DB_PORT
    if args.user:
        DB_USER = args.user
    if args.password:
        DB_PASSWORD = args.password
    
    # Confirm before executing on production-like databases
    # Compare against DEFAULT_DB_NAME (from .env) to detect non-default databases
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
        recreate_all(args.database, dry_run=args.dry_run, drop_first=args.drop_first)
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

