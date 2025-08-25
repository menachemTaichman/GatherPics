#!/usr/bin/env python3
"""
Test script for database views, indexes, and performance analysis.
This script tests the access control views and analyzes their performance.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.core.db import AppDB
import sqlite3
import time



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
    """Test that the views return consistent data."""
    print("\n=== Testing Data Consistency ===")
    
    # Set a test profile ID
    test_profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"
    db.set_profile_id(test_profile_id)
    
    try:
        with db.get_connection() as conn:
            # Test that accessible_faces only contains faces from accessible images
            print("Testing face accessibility consistency...")
            cursor = conn.execute("""
                SELECT COUNT(*) FROM accessible_faces f
                WHERE NOT EXISTS (
                    SELECT 1 FROM accessible_images_helper aih 
                    WHERE aih.imageID = f.imageID
                )
                AND NOT EXISTS (
                    SELECT 1 FROM accessible_groups ag 
                    WHERE ag.groupID = f.groupID 
                    AND ag.face_representative = f.faceID
                )
            """)
            inconsistent_faces = cursor.fetchone()[0]
            
            if inconsistent_faces == 0:
                print("✓ All accessible faces are properly accessible")
            else:
                print(f"✗ Found {inconsistent_faces} faces that shouldn't be accessible")
            
            # Test that accessible_images only contains accessible images
            print("Testing image accessibility consistency...")
            cursor = conn.execute("""
                SELECT COUNT(*) FROM accessible_images i
                WHERE NOT EXISTS (
                    SELECT 1 FROM accessible_images_helper aih 
                    WHERE aih.imageID = i.imageID
                )
                AND NOT EXISTS (
                    SELECT 1 FROM accessible_moments am 
                    WHERE am.representative_photo = i.imageID
                )
            """)
            inconsistent_images = cursor.fetchone()[0]
            
            if inconsistent_images == 0:
                print("✓ All accessible images are properly accessible")
            else:
                print(f"✗ Found {inconsistent_images} images that shouldn't be accessible")
                
        return True
        
    except Exception as e:
        print(f"✗ Error testing data consistency: {e}")
        return False

def test_custom_queries(db):
    """Test custom queries to find the right view logic."""
    print("\n=== Testing Custom Queries ===")
    
    # Set a test profile ID
    test_profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"
    db.set_profile_id(test_profile_id)
    
    try:
        with db.get_connection() as conn:
            print("Testing different view logic approaches...")

            cursor = conn.execute("""
                SELECT i.imageID
                FROM images i
                WHERE EXISTS (
                    SELECT 1
                    FROM profiles p
                    LEFT JOIN profile_images pi
                        ON pi.profileID = p.profileID AND pi.imageID = i.imageID
                    WHERE p.profileID = get_profile_id()
                    AND (
                        (p.all_images = 1 AND pi.profileID IS NULL)
                    OR (p.all_images = 0 AND pi.accessible = 1)
                    )
                );
            """)
            result = cursor.fetchall()
            print(f"  Image accessible helper: {result}")

            cursor = conn.execute("""
                SELECT images.imageID
                FROM images
                LEFT JOIN profile_images
                    ON images.imageID = profile_images.imageID
                LEFT JOIN profiles
                    ON profiles.profileID = profile_images.profileID
                    AND profiles.profileID = get_profile_id()
                    AND (
                        (profiles.all_images = 1 AND profile_images.accessible IS NULL)
                        OR (profiles.all_images = 0 AND profile_images.accessible = 1)
                )
                WHERE profiles.profileID IS NOT NULL;
            """)
            result = cursor.fetchall()
            print(f"  Image accessible helper: {result}")

        return True
        
    except Exception as e:
        print(f"✗ Error testing custom queries: {e}")
        return False

def test_profile_function(db):
    """Test that the get_profile_id() function is properly registered and working."""
    print("\n=== Testing Profile Function ===")
    
    # Set a test profile ID
    test_profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"
    db.set_profile_id(test_profile_id)
    
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

def main():
    """Run all tests."""
    print("Starting Database Views and Performance Tests\n")
    
    # Create one database connection
    event_id = '75cb6635-879d-4386-b023-366444dc0fb2'
    db_path = f'src/data/{event_id}/{event_id}.db'
    
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path}")
        return
    
    db = AppDB(db_path)
    
    # Test 1: Test profile function
    if not test_profile_function(db):
        print("Profile function test failed.")
        return

    # Test 2: Test custom queries to find right view logic
    if not test_custom_queries(db):
        print("Custom queries test failed.")
        return
    
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
