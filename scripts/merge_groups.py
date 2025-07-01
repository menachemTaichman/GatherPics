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
    
    # Load existing data
    if os.path.exists(clusterer.groups_json_path):
        with open(clusterer.groups_json_path, 'r', encoding='utf-8') as f:
            clusterer.groups = json.load(f)['groups']
    
    if os.path.exists(clusterer.faces_json_path):
        with open(clusterer.faces_json_path, 'r', encoding='utf-8') as f:
            clusterer.faces = json.load(f)['faces']
    
    if os.path.exists(clusterer.images_json_path):
        with open(clusterer.images_json_path, 'r', encoding='utf-8') as f:
            clusterer.images = json.load(f)['images']
    
    # Find the maximum group ID to set the counter correctly
    if clusterer.groups:
        clusterer.group_id_counter = max(group['groupID'] for group in clusterer.groups) + 1
    
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
    
    if os.path.exists(clusterer.groups_json_path):
        with open(clusterer.groups_json_path, 'r', encoding='utf-8') as f:
            groups = json.load(f)['groups']
        
        print("Current groups:")
        print("=" * 50)
        for group in groups:
            print(f"Group {group['groupID']}: {group['name']} - {len(group['faceIDs'])} faces")
            print(f"  Representative: {group['representative_faceID']} from {group['representative_imageID']}")
            print()
    else:
        print("No groups file found.")

def find_duplicate_faces():
    """Find faces that appear in multiple groups"""
    config = load_config()
    clusterer = FaceClusterAWS(config)
    
    if not os.path.exists(clusterer.faces_json_path):
        print("No faces file found.")
        return
    
    with open(clusterer.faces_json_path, 'r', encoding='utf-8') as f:
        faces = json.load(f)['faces']
    
    # Build mapping of face_id to group_ids
    face_to_groups = {}
    for face in faces:
        face_id = face['faceID']
        group_id = face['groupID']
        if face_id not in face_to_groups:
            face_to_groups[face_id] = []
        face_to_groups[face_id].append(group_id)
    
    # Find duplicates
    duplicates = {face_id: groups for face_id, groups in face_to_groups.items() if len(groups) > 1}
    
    if duplicates:
        print("Faces that appear in multiple groups:")
        print("=" * 50)
        for face_id, groups in duplicates.items():
            print(f"Face {face_id} appears in groups: {groups}")
            
            # Show details for each occurrence
            for group_id in groups:
                face_info = next(f for f in faces if f['faceID'] == face_id and f['groupID'] == group_id)
                print(f"  - Group {group_id}: {face_info['imageID']} (crop: {face_info['crop_filename']})")
            print()
    else:
        print("✅ No duplicate faces found.")

def main():
    import sys
    
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python scripts/merge_groups.py list                    # List all groups")
        print("  python scripts/merge_groups.py duplicates              # Find duplicate faces")
        print("  python scripts/merge_groups.py merge <group1> <group2> # Merge two groups")
        return
    
    command = sys.argv[1]
    
    if command == "list":
        list_groups()
    elif command == "duplicates":
        find_duplicate_faces()
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