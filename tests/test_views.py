#!/usr/bin/env python3
"""
Test script for database views, indexes, and performance analysis.
This script tests the access control views and analyzes their performance.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.core.db import AppDB
import time
from src.core.models.event import Event


def test_views_functionality(db):
    """Test that the views are working correctly."""
    print("\n=== Testing Views Functionality ===")
    
    # Set a test profile ID
    test_profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"
    db.set_profile_id(test_profile_id)
    
    try:
        with db.get_connection() as conn:
            # Test accessible_images_helper view
            print("Testing accessible_images_helper view...")
            cursor = conn.execute("SELECT COUNT(*) FROM accessible_images_helper")
            count = cursor.fetchone()[0]
            print(f"✓ accessible_images_helper: {count} accessible images")
            
            # Test accessible_groups view
            print("Testing accessible_groups view...")
            cursor = conn.execute("SELECT COUNT(*) FROM accessible_groups")
            count = cursor.fetchone()[0]
            print(f"✓ accessible_groups: {count} accessible groups")
            
            # Test accessible_faces view
            print("Testing accessible_faces view...")
            cursor = conn.execute("SELECT COUNT(*) FROM accessible_faces")
            count = cursor.fetchone()[0]
            print(f"✓ accessible_faces: {count} accessible faces")
            
            # Test accessible_moments view
            print("Testing accessible_moments view...")
            cursor = conn.execute("SELECT COUNT(*) FROM accessible_moments")
            count = cursor.fetchone()[0]
            print(f"✓ accessible_moments: {count} accessible moments")
            
            # Test accessible_images view
            print("Testing accessible_images view...")
            cursor = conn.execute("SELECT COUNT(*) FROM accessible_images")
            count = cursor.fetchone()[0]
            print(f"✓ accessible_images: {count} accessible images")
            
        return True
        
    except Exception as e:
        print(f"✗ Error testing views: {e}")
        return False

def test_performance(db):
    """Test the performance of the views with EXPLAIN QUERY PLAN."""
    print("\n=== Testing Views Performance ===")
    
    # Set a test profile ID
    test_profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"
    db.set_profile_id(test_profile_id)
    
    try:
        with db.get_connection() as conn:
            views_to_test = [
                'accessible_images_helper',
                'accessible_groups', 
                'accessible_faces',
                'accessible_moments',
                'accessible_images'
            ]
            
            for view_name in views_to_test:
                print(f"\n--- {view_name} ---")
                
                # Get the query plan
                cursor = conn.execute(f"EXPLAIN QUERY PLAN SELECT * FROM {view_name}")
                plan = cursor.fetchall()
                
                print("Query Plan:")
                for step in plan:
                    print(f"  {step[3]}")
                
                # Test execution time
                start_time = time.time()
                cursor = conn.execute(f"SELECT COUNT(*) FROM {view_name}")
                count = cursor.fetchone()[0]
                execution_time = time.time() - start_time
                
                print(f"Execution time: {execution_time:.4f}s")
                print(f"Result count: {count}")
                
        return True
        
    except Exception as e:
        print(f"✗ Error testing performance: {e}")
        return False

def test_data_consistency(db):
    """Test that the views return consistent data compared to actual tables."""
    print("\n=== Testing Data Consistency ===")
    
    # Set a test profile ID
    test_profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"
    db.set_profile_id(test_profile_id)
    
    try:
        with db.get_connection() as conn:
            # Since we're in a profile with all_images = 1 and no restrictions,
            # all images should be accessible except those explicitly excluded in profile_images
            
            print("Testing accessible_images_helper consistency...")
            cursor = conn.execute("""
                SELECT COUNT(*) FROM accessible_images_helper
            """)
            accessible_count = cursor.fetchone()[0]
            
            cursor = conn.execute("""
                SELECT COUNT(*) FROM images
            """)
            total_images = cursor.fetchone()[0]
            
            cursor = conn.execute("""
                SELECT COUNT(*) FROM images i
                INNER JOIN profile_images pi ON i.imageID = pi.imageID
                WHERE pi.profileID = get_profile_id() AND pi.accessible = 0
            """)
            explicitly_excluded = cursor.fetchone()[0]
            
            expected_accessible = total_images - explicitly_excluded
            print(f"  Total images: {total_images}")
            print(f"  Explicitly excluded: {explicitly_excluded}")
            print(f"  Expected accessible: {expected_accessible}")
            print(f"  Actual accessible: {accessible_count}")
            
            if accessible_count == expected_accessible:
                print("✓ accessible_images_helper count matches expected")
            else:
                print(f"✗ accessible_images_helper count mismatch: expected {expected_accessible}, got {accessible_count}")
            
            print("\nTesting accessible_faces consistency...")
            cursor = conn.execute("""
                SELECT COUNT(*) FROM accessible_faces
            """)
            accessible_faces = cursor.fetchone()[0]
            
            cursor = conn.execute("""
                SELECT COUNT(*) FROM faces f
                WHERE EXISTS (
                    SELECT 1 FROM accessible_images_helper aih 
                    WHERE aih.imageID = f.imageID
                )
                OR EXISTS (
                    SELECT 1 FROM groups g
                    WHERE g.groupID = f.groupID 
                    AND g.representative_face = f.faceID
                    AND EXISTS (
                        SELECT 1 FROM accessible_images_helper aih2
                        WHERE aih2.imageID IN (
                            SELECT imageID FROM faces WHERE groupID = g.groupID
                        )
                    )
                )
            """)
            expected_faces = cursor.fetchone()[0]
            
            print(f"  Expected accessible faces: {expected_faces}")
            print(f"  Actual accessible faces: {accessible_faces}")
            
            if accessible_faces == expected_faces:
                print("✓ accessible_faces count matches expected")
            else:
                print(f"✗ accessible_faces count mismatch: expected {expected_faces}, got {accessible_faces}")
            
            print("\nTesting accessible_groups consistency...")
            cursor = conn.execute("""
                SELECT COUNT(*) FROM accessible_groups
            """)
            accessible_groups = cursor.fetchone()[0]
            
            cursor = conn.execute("""
                SELECT COUNT(*) FROM groups g
                WHERE NOT EXISTS (
                    SELECT 1 FROM faces WHERE faces.groupID = g.groupID
                )
                OR EXISTS (
                    SELECT 1 FROM faces f
                    INNER JOIN accessible_images_helper aih ON f.imageID = aih.imageID
                    WHERE f.groupID = g.groupID
                )
            """)
            expected_groups = cursor.fetchone()[0]
            
            print(f"  Expected accessible groups: {expected_groups}")
            print(f"  Actual accessible groups: {accessible_groups}")
            
            if accessible_groups == expected_groups:
                print("✓ accessible_groups count matches expected")
            else:
                print(f"✗ accessible_groups count mismatch: expected {expected_groups}, got {accessible_groups}")
                
        return True
        
    except Exception as e:
        print(f"✗ Error testing data consistency: {e}")
        return False

def test_custom_queries(db, query = None):
    """Test custom queries to find the right view logic."""
    print("\n=== Testing Custom Queries ===")
    
    # Set a test profile ID
    test_profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"
    db.set_profile_id(test_profile_id)
    
    try:
        with db.get_connection() as conn:
            print("Testing different view logic approaches...")

            if query is None:
                cursor = conn.execute("""
                    SELECT *
                    FROM profiles
                """)
            else:
                cursor = conn.execute(query)
            result = cursor.fetchall()
            # print the result as a table
            print(f"  {cursor.description}")
            print(f"  {result}")

        return True
        
    except Exception as e:
        print(f"✗ Error testing custom queries: {e}")
        return False

def test_profile_function(db):
    """Test that the get_profile_id() function is properly registered and working."""
    print("\n=== Testing Profile Function ===")
    
    try:
        with db.get_connection() as conn:
            # Test that the function is registered and returns the correct value
            print("Testing get_profile_id() function...")
            cursor = conn.execute("SELECT get_profile_id()")
            result = cursor.fetchone()[0]
            
            if result == test_profile_id:
                print(f"✓ get_profile_id() function working correctly: {result}")
            else:
                print(f"✗ get_profile_id() function returned wrong value: {result} (expected: {test_profile_id})")
                return False
            
            # Test that the function is used in the views
            print("Testing function usage in views...")
            cursor = conn.execute("SELECT COUNT(*) FROM accessible_images_helper")
            count = cursor.fetchone()[0]
            print(f"✓ accessible_images_helper view using get_profile_id(): {count} results")
            
        return True
        
    except Exception as e:
        print(f"✗ Error testing profile function: {e}")
        return False

def recreate_views_and_indexes(db):
    """Drop and recreate all database views and indexes using the VIEWS and INDEXES from db.py."""
    print("\n=== Recreating Database Views and Indexes ===")
    
    try:
        with db.get_connection() as conn:
            # Import the VIEWS and INDEXES from db.py
            from src.core.db import VIEWS, INDEXES
            
            # Drop existing views if they exist
            views_to_drop = conn.execute("SELECT name FROM sqlite_master WHERE type='view'").fetchall()
            views_to_drop = [view[0] for view in views_to_drop]
            
            print("Dropping existing views...")
            for view_name in views_to_drop:
                try:
                    conn.execute(f"DROP VIEW IF EXISTS {view_name}")
                    print(f"✓ Dropped view: {view_name}")
                except Exception as e:
                    print(f"  Note: Could not drop {view_name}: {e}")
            
            # Drop existing indexes if they exist
            indexes_to_drop = conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()
            indexes_to_drop = [index[0] for index in indexes_to_drop]

            print("\nDropping existing indexes...")
            for index_name in indexes_to_drop:
                # Extract index name from CREATE INDEX statement
                try:
                    conn.execute(f"DROP INDEX IF EXISTS {index_name}")
                    print(f"✓ Dropped index: {index_name}")
                except Exception as e:
                    print(f"  Note: Could not drop {index_name}: {e}")
            
            # Recreate the views using the VIEWS dictionary
            print("\nRecreating views...")
            
            for view_name, view_sql in VIEWS.items():
                try:
                    # Create the view with CREATE VIEW statement
                    create_sql = f"CREATE VIEW {view_name} AS {view_sql}"
                    conn.execute(create_sql)
                    print(f"✓ Created {view_name} view")
                except Exception as e:
                    print(f"✗ Error creating {view_name} view: {e}")
                    return False
            
            # Recreate the indexes using the INDEXES list
            print("\nRecreating indexes...")
            
            for index_sql in INDEXES:
                try:
                    conn.execute(f'CREATE INDEX IF NOT EXISTS {index_sql}')
                    # Extract index name for logging
                    index_name = index_sql.split(' ')[0]
                    print(f"✓ Created index: {index_name}")
                except Exception as e:
                    print(f"✗ Error creating index: {e}")
                    return False
            
            # Commit the changes
            conn.commit()
            print(f"\n✓ All {len(VIEWS)} views and {len(INDEXES)} indexes recreated successfully")
            
        return True
        
    except Exception as e:
        print(f"✗ Error recreating views and indexes: {e}")
        return False

def update_database_structure(db):
    """Update the database structure according to the new requirements."""
    print("\n=== Updating Database Structure ===")
    
    try:
        with db.get_connection() as conn:
            # remove is_manager column and add hierarchy_rank column
            profile_id = db.profile_context['profileID']
            # drop profiles table and recreate it with hierarchy_rank column            
            conn.execute("DROP TABLE IF EXISTS profiles")
            from src.core.db import TABLES
            profiles_table = TABLES['profiles']
            conn.execute(f'''CREATE TABLE IF NOT EXISTS profiles ({profiles_table})''')
            conn.commit()
            event_id = '75cb6635-879d-4386-b023-366444dc0fb2'
            event = Event(event_id)
            profiles = event._initialize_default_profiles()
            developer_profile = profiles[0]
            conn.execute(f"""
                UPDATE profiles SET profileID = '{profile_id}'
                WHERE profileID = '{developer_profile['profileID']}'
            """)
            conn.execute("ALTER TABLE profile_albums ADD COLUMN accessible BOOLEAN")
            conn.commit()
            print("✓ Profiles table recreated")

        return True
        
    except Exception as e:
        print(f"✗ Error updating database structure: {e}")
        return False

def main():
    """Run all tests."""
    print("Starting Database Views and Performance Tests\n")
    
    # Create one database connection
    event_id = '75cb6635-879d-4386-b023-366444dc0fb2'
    db_path = f'src/data/{event_id}/{event_id}.db'
    
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path}")
        return
    
    db = AppDB(db_path, '89cb4967-0eba-48af-99cc-5e87407fb639')

    test_custom_queries(db)

    # Test 3: Test views functionality
    if not test_views_functionality(db):
        print("Views functionality test failed.")
        return
    
    # Test 4: Test performance
    if not test_performance(db):
        print("Performance test failed.")
        return
    
    # Test 5: Test data consistency
    if not test_data_consistency(db):
        print("Data consistency test failed.")
        return
    
    print("\n=== All Tests Passed! ===")
    print("The views are working correctly and efficiently.")

if __name__ == "__main__":
    main()
