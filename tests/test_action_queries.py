"""
Test file demonstrating the new secure action query methods.
This shows how to use the security system for UPDATE, DELETE, and INSERT operations.
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'src'))

from core.db import AppDB
from core.models.profile import Profiles
from core.models.group import Groups
from core.models.moment import Moments
from core.models.image import Images

def test_secure_actions():
    """Demonstrate secure action queries with permission and accessibility checks."""
    
    # Initialize database (replace with your actual database path)
    db_path = "../data/75cb6635-879d-4386-b023-366444dc0fb2/75cb6635-879d-4386-b023-366444dc0fb2.db"
    db = AppDB(db_path)
    
    # Set a profile ID for testing (replace with actual profile ID)
    test_profile_id = "test-profile-123"
    db.set_profile_id(test_profile_id)
    
    print("=== Secure Action Query Examples ===\n")
    
    # Example 1: Secure UPDATE - Update a group label
    print("1. Secure UPDATE - Updating group label:")
    success = db.secure_update(
        table='groups',
        where={'groupID': 'example-group-123'},
        fields={'label': 'New Group Label'}
    )
    print(f"   Result: {'SUCCESS' if success else 'FAILED (permission/access denied)'}\n")
    
    # Example 2: Secure DELETE - Delete a face
    print("2. Secure DELETE - Deleting a face:")
    success = db.secure_delete(
        table='faces',
        where={'faceID': 'example-face-123'}
    )
    print(f"   Result: {'SUCCESS' if success else 'FAILED (permission/access denied)'}\n")
    
    # Example 3: Secure INSERT - Insert a new group
    print("3. Secure INSERT - Creating a new group:")
    success = db.secure_insert(
        table='groups',
        data_list=[{
            'groupID': 'new-group-123',
            'label': 'New Group',
            'face_representative': None
        }]
    )
    print(f"   Result: {'SUCCESS' if success else 'FAILED (permission denied)'}\n")
    
    # Example 4: Secure INSERT - Insert a new image
    print("4. Secure INSERT - Adding a new image to a moment:")
    success = db.secure_insert(
        table='images',
        data_list=[{
            'imageID': 'new-image-123',
            'name': 'example.jpg',
            'date_taken': '2024-01-01',
            'file_size': 1024000,
            'width': 1920,
            'height': 1080,
            'momentID': 'example-moment-123'
        }]
    )
    print(f"   Result: {'SUCCESS' if success else 'FAILED (permission/access denied)'}\n")
    
    # Example 5: Using the main execute_action_query method
    print("5. Using execute_action_query directly:")
    success = db.secure_action_query(
        action_type='UPDATE',
        table='moments',
        where={'momentID': 'example-moment-123'},
        fields={'label': 'Updated Moment Label'}
    )
    print(f"   Result: {'SUCCESS' if success else 'FAILED (permission/access denied)'}\n")
    
    # Example 6: Using restricted query filters for custom operations
    print("6. Using restricted query filters for custom operations:")
    base_where = "imageID IN ('img1', 'img2', 'img3')"
    filter_clause, filter_params = db.get_restricted_query_filter('images', {'imageID': 'img1'})
    if filter_clause:
        final_where = f"({base_where}) AND ({filter_clause})"
        print(f"   Final WHERE: {final_where}")
        print(f"   This ensures only accessible images are operated on")
    else:
        print("   No restrictions needed for this table")
    print()
    
    print("=== Security Check Details ===")
    print("• Profile permissions are checked first (can_edit_groups, can_edit_moments, etc.)")
    print("• Record accessibility is verified using accessible views")
    print("• For images: uses accessible_images view")
    print("• For faces: uses accessible_faces view")
    print("• For albums: uses accessible_albums view")
    print("• For groups/moments: only permission checks (no accessibility restrictions)")
    print("• get_restricted_query_filter() provides EXISTS clauses for custom queries")
    print("• All operations return boolean success/failure status")

if __name__ == "__main__":
    test_secure_actions()
