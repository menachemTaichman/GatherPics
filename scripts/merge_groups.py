import json
import os
import sys

# Add the current directory to Python path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.core.face_cluster import FaceClusterAWS

def load_config():
    """Load AWS configuration"""
    with open('config/aws_config.json') as f:
        return json.load(f)

def merge_groups_manually(group_id_1, group_id_2):
    """
    Manually merge two groups. This function can be used for manual group management.
    
    Args:
        group_id_1 (int): The target group ID (this group will be kept)
        group_id_2 (int): The source group ID (this group will be removed)
    """
    config = load_config()
    clusterer = FaceClusterAWS(config)
    
    # Load existing data using the new method
    clusterer.load_data()
    
    # Perform the merge
    success = clusterer.merge_groups(group_id_1, group_id_2)
    
    if success:
        # Save the updated data
        clusterer.save_json()
        print(f"✅ Successfully merged group {group_id_2} into {group_id_1}")
        return True
    else:
        print(f"❌ Failed to merge groups {group_id_1} and {group_id_2}")
        return False

def list_groups():
    """List all groups with their face counts"""
    config = load_config()
    clusterer = FaceClusterAWS(config)
    clusterer.load_data()
    
    groups_summary = clusterer.list_groups_summary()
    
    if groups_summary:
        print("Current groups:")
        print("=" * 50)
        for group in groups_summary:
            print(f"Group {group['groupID']}: {group['name']} - {group['face_count']} faces")
            print(f"  Representative: {group['representative_faceID']} from {group['representative_imageID']}")
            print()
    else:
        print("No groups found.")

def main():
    import sys
    
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python scripts/merge_groups.py list                    # List all groups")
        print("  python scripts/merge_groups.py merge <group1> <group2> # Merge two groups")
        return
    
    command = sys.argv[1]
    
    if command == "list":
        list_groups()
    elif command == "merge":
        if len(sys.argv) != 4:
            print("Usage: python scripts/merge_groups.py merge <group1> <group2>")
            return
        
        try:
            group1 = int(sys.argv[2])
            group2 = int(sys.argv[3])
            merge_groups_manually(group1, group2)
        except ValueError:
            print("Group IDs must be integers")
    else:
        print(f"Unknown command: {command}")

if __name__ == '__main__':
    main() 