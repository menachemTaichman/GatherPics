from PIL import Image
import piexif
from datetime import datetime
import os

# Test one image
image_path = 'data/images/E-T 0010.jpg'
print(f"Testing image: {image_path}")
print(f"File exists: {os.path.exists(image_path)}")

if os.path.exists(image_path):
    with Image.open(image_path) as img:
        exif_data = img.info.get('exif')
        print(f"EXIF data exists: {bool(exif_data)}")
        
        if exif_data:
            try:
                exif_dict = piexif.load(exif_data)
                date_bytes = exif_dict['Exif'].get(piexif.ExifIFD.DateTimeOriginal)
                print(f"Date bytes: {date_bytes}")
                
                if date_bytes:
                    date_str = date_bytes.decode('utf-8')
                    print(f"Date string: {date_str}")
                    date_taken = datetime.strptime(date_str, '%Y:%m:%d %H:%M:%S')
                    print(f"Parsed date: {date_taken}")
                else:
                    print("No DateTimeOriginal found in EXIF")
            except Exception as e:
                print(f"Error parsing EXIF: {e}")
        else:
            print("No EXIF data found")
else:
    print("Image file not found") 