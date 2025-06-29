#!/usr/bin/env python3
"""
Script to generate face crops for all face groups
"""

import json
import os
import sys
from pathlib import Path

# Add the backend directory to the path
sys.path.append(str(Path(__file__).parent / 'src' / 'backend'))

from face_cropper import FaceCropper

def main():
    # Paths
    base_dir = Path(__file__).parent
    images_dir = base_dir / 'src' / 'data' / 'images'
    crops_dir = base_dir / 'src' / 'data' / 'crops'
    clusters_file = base_dir / 'src' / 'data' / 'clusters_faces.json'
    faces_output_file = base_dir / 'src' / 'data' / 'faces_output.json'
    
    print("🚀 Starting face crop generation...")
    print(f"Images directory: {images_dir}")
    print(f"Crops directory: {crops_dir}")
    
    # Create crops directory if it doesn't exist
    crops_dir.mkdir(exist_ok=True)
    
    # Load data
    try:
        with open(clusters_file, 'r', encoding='utf-8') as f:
            clusters_data = json.load(f)
        
        with open(faces_output_file, 'r', encoding='utf-8') as f:
            faces_data = json.load(f)
            
        print(f"✅ Loaded {len(clusters_data.get('clusters', []))} face groups")
        print(f"✅ Loaded face detection data for {len(faces_data)} images")
        
    except FileNotFoundError as e:
        print(f"❌ Error: {e}")
        return
    except json.JSONDecodeError as e:
        print(f"❌ Error parsing JSON: {e}")
        return
    
    # Initialize face cropper
    cropper = FaceCropper(str(images_dir), str(crops_dir))
    
    # Generate crops for each group
    clusters = clusters_data.get('clusters', [])
    total_crops = 0
    
    for i, cluster in enumerate(clusters):
        representative = cluster.get('representative')
        if not representative:
            print(f"⚠️  Group {cluster['id']}: No representative image")
            continue
        
        image_path = images_dir / representative
        if not image_path.exists():
            print(f"⚠️  Group {cluster['id']}: Representative image not found: {representative}")
            continue
        
        # Get face coordinates for this image
        faces = faces_data.get(representative, [])
        if not faces:
            print(f"⚠️  Group {cluster['id']}: No face detection data for {representative}")
            continue
        
        # Create crop using the first detected face
        crop_filename = cropper.create_representative_crop(str(image_path), faces[0])
        
        if crop_filename:
            cluster['representative_crop'] = crop_filename
            total_crops += 1
            print(f"✅ Group {cluster['id']}: Created crop {crop_filename}")
        else:
            print(f"❌ Group {cluster['id']}: Failed to create crop for {representative}")
    
    # Save updated clusters data
    try:
        with open(clusters_file, 'w', encoding='utf-8') as f:
            json.dump(clusters_data, f, indent=2, ensure_ascii=False)
        print(f"✅ Saved updated clusters data")
    except Exception as e:
        print(f"❌ Error saving clusters data: {e}")
    
    print(f"\n🎉 Face crop generation complete!")
    print(f"📊 Generated {total_crops} face crops out of {len(clusters)} groups")
    print(f"📁 Crops saved to: {crops_dir}")

if __name__ == "__main__":
    main() 