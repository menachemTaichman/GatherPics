import json
import os
from PIL import Image
import boto3
from src.core.face_detector import FaceDetectorAWS

def investigate_image(image_path):
    """Investigate face detection for a specific image"""
    
    # Load AWS config
    with open('config/aws_config.json') as f:
        config = json.load(f)
    
    detector = FaceDetectorAWS(config)
    
    print(f"Investigating face detection for: {image_path}")
    print("=" * 60)
    
    # Get image dimensions
    with Image.open(image_path) as img:
        width, height = img.size
        print(f"Image dimensions: {width}x{height}")
    
    # Detect faces
    face_details, image_bytes = detector.detect_faces(image_path)
    
    print(f"\nAWS Rekognition detected {len(face_details)} faces:")
    print("-" * 40)
    
    for i, face in enumerate(face_details):
        bounding_box = face['BoundingBox']
        confidence = face.get('Confidence', 'N/A')
        
        print(f"Face {i+1}:")
        print(f"  Confidence: {confidence}")
        print(f"  Bounding Box: Left={bounding_box['Left']:.4f}, Top={bounding_box['Top']:.4f}")
        print(f"  Size: Width={bounding_box['Width']:.4f}, Height={bounding_box['Height']:.4f}")
        print(f"  Area: {bounding_box['Width'] * bounding_box['Height']:.6f}")
        
        # Calculate absolute coordinates
        abs_left = int(bounding_box['Left'] * width)
        abs_top = int(bounding_box['Top'] * height)
        abs_width = int(bounding_box['Width'] * width)
        abs_height = int(bounding_box['Height'] * height)
        
        print(f"  Absolute: Left={abs_left}, Top={abs_top}, Width={abs_width}, Height={abs_height}")
        print()

def test_different_detection_parameters(image_path):
    """Test face detection with different parameters"""
    
    # Load AWS config
    with open('config/aws_config.json') as f:
        config = json.load(f)
    
    rekognition = boto3.client('rekognition',
                              aws_access_key_id=config['aws_access_key_id'],
                              aws_secret_access_key=config['aws_secret_access_key'],
                              region_name=config['region'])
    
    print("\nTesting different detection parameters:")
    print("=" * 60)
    
    # Read image
    with Image.open(image_path) as img:
        buffer = img.resize((3000, 2000), Image.Resampling.LANCZOS) if img.size[0] > 3000 or img.size[1] > 4000 else img
        img_buffer = buffer.tobytes() if hasattr(buffer, 'tobytes') else buffer
    
    # Test with different attributes
    attributes_options = [
        ['DEFAULT'],
        ['ALL'],
        ['DEFAULT', 'AGE_RANGE', 'BEARD', 'EMOTIONS', 'EYEGLASSES', 'EYES_OPEN', 'GENDER', 'MOUTH_OPEN', 'MUSTACHE', 'SMILE', 'SUNGLASSES']
    ]
    
    for i, attributes in enumerate(attributes_options):
        try:
            response = rekognition.detect_faces(
                Image={'Bytes': img_buffer},
                Attributes=attributes
            )
            print(f"Test {i+1} with attributes {attributes}: {len(response['FaceDetails'])} faces detected")
            
            for j, face in enumerate(response['FaceDetails']):
                confidence = face.get('Confidence', 'N/A')
                print(f"  Face {j+1} confidence: {confidence}")
        except Exception as e:
            print(f"Test {i+1} failed: {e}")

def check_duplicate_removal_logic(face_details):
    """Test the duplicate removal logic"""
    
    from scripts.face_processing import remove_duplicate_faces, calculate_iou
    
    print("\nTesting duplicate removal logic:")
    print("=" * 60)
    
    print(f"Original faces: {len(face_details)}")
    
    # Test with different IOU thresholds
    for threshold in [0.3, 0.4, 0.5, 0.6, 0.7]:
        filtered = remove_duplicate_faces(face_details, iou_threshold=threshold)
        print(f"IOU threshold {threshold}: {len(filtered)} faces remaining")
        
        if len(filtered) != len(face_details):
            print("  Duplicates were removed!")
            for i, face in enumerate(filtered):
                print(f"    Face {i+1}: Left={face['BoundingBox']['Left']:.4f}, Top={face['BoundingBox']['Top']:.4f}")
    
    # Check IOU between existing faces
    if len(face_details) >= 2:
        iou = calculate_iou(face_details[0]['BoundingBox'], face_details[1]['BoundingBox'])
        print(f"\nIOU between the two detected faces: {iou:.4f}")

def check_existing_faces():
    """Check what faces are currently recorded for img_004"""
    
    print("\nCurrent faces recorded for img_004 (E-T 0408.jpg):")
    print("=" * 60)
    
    with open('src/data/faces.json', 'r') as f:
        faces_data = json.load(f)
    
    img_004_faces = [face for face in faces_data['faces'] if face['imageID'] == 'img_004']
    
    for face in img_004_faces:
        print(f"Face ID: {face['faceID']}")
        print(f"Group ID: {face['groupID']}")
        print(f"Position: Left={face['left']:.4f}, Top={face['top']:.4f}")
        print(f"Size: Width={face['width']:.4f}, Height={face['height']:.4f}")
        print(f"Crop file: {face['crop_filename']}")
        print()

if __name__ == "__main__":
    image_path = "src/data/images/E-T 0408.jpg"
    
    if os.path.exists(image_path):
        investigate_image(image_path)
        test_different_detection_parameters(image_path)
        
        # Test duplicate removal logic
        with open('config/aws_config.json') as f:
            config = json.load(f)
        detector = FaceDetectorAWS(config)
        face_details, _ = detector.detect_faces(image_path)
        check_duplicate_removal_logic(face_details)
        
        check_existing_faces()
    else:
        print(f"Image not found: {image_path}") 