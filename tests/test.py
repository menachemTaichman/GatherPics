from src.core.models.event import Event
from src.core.models.events_manager import EventsManager
from src.core.image_utils import resize_image, crop_image, extract_all_metadata
import os
from PIL import Image as PILImage

"""
# 1. Create an EventsManager
event_manager = EventsManager.add(name='Test Manager')
print('Created EventsManager:', event_manager.get_info())

# 2. Create an Event belonging to the manager
event = Event.add(name='Test Event', events_manager=event_manager.id)
print('Created Event:', event.get_info())
"""
event_id = '75cb6635-879d-4386-b023-366444dc0fb2'
event = Event(event_id)
profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"

def reset_event(event: Event):
    images = event.images_model.list()
    for image in images:
        event.delete_image(image['imageID'])

    # event.db.execute_query('DELETE FROM faces;')
    event.db.execute_query('DELETE FROM groups;')
    # event.db.execute_query('DELETE FROM images;')
    event.db.execute_query('DELETE FROM moments;')

    event.face_utils.rek_helper.clear_collection()

    # 3. Process images if any are in the event's to_process directory
    result = event.process_new_images(verbose=True)
    print('Image processing result:', result)

def process_images(images):

    for image in images:
        
        original_path = os.path.join(event.original_dir, f"{image['imageID']}.jpg")
        original_pil = PILImage.open(original_path)
        
        """
        display_path = os.path.join(event.display_dir, f"{image['imageID']}.jpg")
        thumb_path = os.path.join(event.thumb_dir, f"{image['imageID']}.jpg")

        display_pil = resize_image(original_pil, 1080)
        display_pil.save(display_path)

        thumb_pil = resize_image(original_pil, 300)
        thumb_pil.save(thumb_path)
        """
        # display_path = os.path.join(event.display_dir, f"{image['imageID']}.jpg")
        # display_pil = PILImage.open(display_path)
        
        faces_in_image = event.images_model.get_faces(image['imageID'])

        for face in faces_in_image:
            bbox = event.faces_model.get(face)
            if not bbox:
                continue
            
            face_path = os.path.join(event.faces_dir, f"{face}.jpg")

            face_pil = crop_image(original_pil, bbox, padding_width_percent=0.1, padding_height_percent=0.0)
            face_pil.save(face_path)

def _extract_date_taken(image, verbose=True):
    from datetime import datetime
    date_taken = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        exif = image.getexif()
        if exif:
            # Try multiple EXIF date tags in order of preference
            date_tags = [36867, 306, 36868]  # DateTimeOriginal, DateTime, DateTimeDigitized
            for tag in date_tags:
                if tag in exif:
                    date_str = exif[tag]
                    if date_str and isinstance(date_str, str):
                        # EXIF dates are typically in format: "YYYY:MM:DD HH:MM:SS"
                        # Convert to our format: "YYYY-MM-DD HH:MM:SS"
                        if ':' in date_str and len(date_str) >= 19:
                            date_taken = date_str.replace(':', '-', 2)  # Replace first two colons
                            break
    except Exception as e:
        if verbose:
            print(f"  Warning: Could not extract EXIF date: {e}")
    return date_taken

def update_image_dates_from_onedrive(event: Event, onedrive_path: str, verbose: bool = True):
    """
    Update date_taken field for existing images by matching with files from OneDrive folder.
    Also updates the EXIF metadata in the actual files.
    
    Args:
        event: Event instance
        onedrive_path: Path to OneDrive folder containing original image files
        verbose: Whether to print progress messages
    """
    import os
    from PIL import Image as PILImage
    from PIL.ExifTags import TAGS
    import shutil
    
    def update_file_exif_date(file_path: str, date_taken: str, verbose: bool = False):
        """Update EXIF date in a file"""
        try:
            # Open the image
            img = PILImage.open(file_path)
            
            # Get existing EXIF data
            exif = img.getexif()
            if exif is None:
                exif = {}
            
            # Convert date format from "YYYY-MM-DD HH:MM:SS" to "YYYY:MM:DD HH:MM:SS"
            exif_date = date_taken.replace('-', ':', 2)
            
            # Update EXIF date tags
            exif[36867] = exif_date  # DateTimeOriginal
            exif[306] = exif_date    # DateTime
            exif[36868] = exif_date  # DateTimeDigitized
            
            # Save with updated EXIF
            img.save(file_path, 'JPEG', quality=95, exif=exif)
            img.close()
            
            if verbose:
                print(f"    Updated EXIF in: {os.path.basename(file_path)}")
            return True
        except Exception as e:
            if verbose:
                print(f"    Error updating EXIF in {os.path.basename(file_path)}: {e}")
            return False
    
    if verbose:
        print(f"Starting date update for event: {event.name}")
        print(f"Looking for files in: {onedrive_path}")
    
    # Get all images from the database
    images = event.images_model.list()
    if not images:
        if verbose:
            print("No images found in database")
        return
    
    if verbose:
        print(f"Found {len(images)} images in database")
    
    updated_count = 0
    not_found_count = 0
    
    for i, image in enumerate(images, 1):
        if verbose:
            print(f"Processing image {i}/{len(images)}: {image['name']}")
        
        # Look for the original file in OneDrive folder
        original_filename = image['name']
        onedrive_file_path = os.path.join(onedrive_path, original_filename)
        
        if not os.path.exists(onedrive_file_path):
            if verbose:
                print(f"  File not found in OneDrive: {original_filename}")
            not_found_count += 1
            continue
        
        try:
            # Open the original file from OneDrive and extract date
            onedrive_image = PILImage.open(onedrive_file_path)
            date_taken = _extract_date_taken(onedrive_image, verbose=False)
            onedrive_image.close()
            
            # Update the database
            event.images_model.edit(image['imageID'], {'date_taken': date_taken})
            
            if verbose:
                print(f"  Updated date_taken to: {date_taken}")
            
            # Update EXIF in all file versions
            image_id = image['imageID']
            files_updated = 0
            
            # Update original file
            original_path = os.path.join(event.original_dir, f"{image_id}.jpg")
            if os.path.exists(original_path):
                if update_file_exif_date(original_path, date_taken, verbose):
                    files_updated += 1
            
            # Update display file
            display_path = os.path.join(event.display_dir, f"{image_id}.jpg")
            if os.path.exists(display_path):
                if update_file_exif_date(display_path, date_taken, verbose):
                    files_updated += 1
            
            # Update thumbnail file
            thumb_path = os.path.join(event.thumb_dir, f"{image_id}.jpg")
            if os.path.exists(thumb_path):
                if update_file_exif_date(thumb_path, date_taken, verbose):
                    files_updated += 1
            
            # Update face files (if any)
            faces_in_image = event.images_model.get_faces(image_id)
            for face_id in faces_in_image:
                face_path = os.path.join(event.faces_dir, f"{face_id}.jpg")
                if os.path.exists(face_path):
                    if update_file_exif_date(face_path, date_taken, verbose):
                        files_updated += 1
            
            if verbose:
                print(f"    Updated EXIF in {files_updated} files")
            
            updated_count += 1
            
        except Exception as e:
            if verbose:
                print(f"  Error processing {original_filename}: {e}")
            not_found_count += 1
    
    if verbose:
        print(f"\nDate update complete!")
        print(f"  - Images updated: {updated_count}")
        print(f"  - Files not found: {not_found_count}")
        print(f"  - Total processed: {len(images)}")
    
    return {
        'updated': updated_count,
        'not_found': not_found_count,
        'total': len(images)
    }

def recrop_faces(image_ids: list):
    for image in image_ids:
        image_id = image['imageID']
        faces_in_image = event.images_model.get_faces(image_id)
        original_path = os.path.join(event.original_dir, f"{image_id}.jpg")
        original_pil = PILImage.open(original_path)
        for face in faces_in_image:
            bbox = event.faces_model.get(face)
            if not bbox:
                continue
            face_path = os.path.join(event.faces_dir, f"{face}.webp")
            face_pil = crop_image(original_pil, bbox, padding_width_percent=0.3, padding_height_percent=0.2)
            face_pil.save(face_path)

# event.process_new_images(verbose=True)

# reset_event(event)

# onedrive_path = r"C:\Users\metai\OneDrive\Pictures\חתונה\צלם"
# result = update_image_dates_from_onedrive(event, onedrive_path, verbose=True)
# print(result)

# images = event.images_model.list()
# print(images)

# process_images(images)

# reset_event(event)

def update_date_taken(image_ids: list):
    for image in image_ids:
        image_id = image['imageID']
        image_path = os.path.join(event.original_dir, f"{image_id}.jpg")
        date_taken = extract_all_metadata(image_path)['date_taken'] 
        event.images_model.edit(image_id, {'date_taken': date_taken})

face = event.faces_model.get('57b76b0d-db5f-49e3-87d2-8190cf484e89')
print(face)