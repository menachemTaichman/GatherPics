from botocore.endpoint_provider import TreeRule
from src.core.models.event import Event
from src.core.models.events_manager import EventsManager
from src.core.db import ReturnFormat
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
profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"
event = Event(event_id, profile_id=profile_id, include_archived=True)

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

def print_group_representative_face(group_id):
    group = event.groups_model.get(group_id)
    if group:
        print(f"Group {group_id} representative_face: {group.get('representative_face')}")
    else:
        print(f"Group {group_id} not found.")

def update_date_taken(image_ids: list):
    for image in image_ids:
        image_id = image['imageID']
        image_path = os.path.join(event.original_dir, f"{image_id}.jpg")
        date_taken = extract_all_metadata(image_path)['date_taken'] 
        event.images_model.edit(image_id, {'date_taken': date_taken})

def show_face_from_image(image_path, face_bbox):
    import matplotlib.pyplot as plt
    image = PILImage.open(image_path)
    face_pil = crop_image(image, face_bbox, padding_width_percent=0, padding_height_percent=0)
    plt.imshow(face_pil)
    plt.show()

def copy_moments_to_database():
    import json
    
    # Load the old moments data
    with open('old/core/data/moments.json', 'r', encoding='utf-8') as f:
        old_moments_data = json.load(f)
    
    # Extract the moments array
    old_moments = old_moments_data.get('moments', [])
    
    print(f"Found {len(old_moments)} moments to copy")
    
    for old_moment in old_moments:
        # Map old fields to new format
        label = old_moment.get('title', '')
        description = old_moment.get('description', '')
        start = old_moment.get('start_datetime', '').replace('T', ' ')
        end = old_moment.get('end_datetime', '').replace('T', ' ')
        
        # Map old image filenames to new image IDs
        old_images = old_moment.get('images', [])
        image_ids = []
        
        for image_filename in old_images:
            image_record = event.db.get_one('images', {'label': image_filename})
            if image_record:
                image_ids.append(image_record['imageID'])
        
        # Create the moment in the new database
        moment_data = event.moments_model.add(
            label=label,
            description=description,
            start=start,
            end=end,
            image_IDs=image_ids
        )
        
        print(f"Created moment: {label} with {len(image_ids)} images")
    
    print(f"Copy complete! Copied {len(old_moments)} moments")

def clear_moments_images():
    moments = event.moments_model.list()
    for moment in moments:
        images = event.moments_model.get_images(moment['momentID'])
        for image in images:
            event.moments_model.remove_image_from_moment(moment['momentID'], image)

def drop_views_triggers_and_indexes():
    db = event.db

    # get all views, triggers and indexes from the db itseilf, drop them, import them again
    views = db.execute_query('SELECT name FROM sqlite_master WHERE type="view"')
    triggers = db.execute_query('SELECT name FROM sqlite_master WHERE type="trigger"')
    indexes = db.execute_query('SELECT name FROM sqlite_master WHERE type="index" AND name NOT LIKE "sqlite_autoindex%"')

    for view in views:
        try:
            db.execute_query(f'DROP VIEW {view[0]}')
        except Exception as e:
            print(f'Error dropping view {view[0]}: {e}')

    for trigger in triggers:
        try:
            db.execute_query(f'DROP TRIGGER {trigger[0]}')
        except Exception as e:
            print(f'Error dropping trigger {trigger[0]}: {e}')

    for index in indexes:
        try:
            db.execute_query(f'DROP INDEX {index[0]}')
        except Exception as e:
            print(f'Error dropping index {index[0]}: {e}')

def create_views_triggers_and_indexes():
    from src.core.db import INDEXES, VIEWS, TRIGGERS
    db = event.db

    # import them again
    for view_name, view_query in VIEWS.items():
        db.execute_query('CREATE VIEW if not exists ' + view_name + ' as ' + view_query)

    for trigger_name, trigger_query in TRIGGERS.items():
        db.execute_query(trigger_query)

    for index in INDEXES:
        db.execute_query('CREATE INDEX if not exists ' + index)

def recreate_views_triggers_and_indexes():
    drop_views_triggers_and_indexes()
    create_views_triggers_and_indexes()

def recreate_tables_with_data(db):
    from src.core.db import TABLES
    db.execute_query("ALTER TABLE images RENAME TO images_old")
    db.execute_query("ALTER TABLE moments RENAME TO moments_old")

    # 2️⃣ צור את הטבלאות החדשות לפי ההגדרות שלך
    db.execute_query(f"CREATE TABLE images ({TABLES['images']})")
    db.execute_query(f"CREATE TABLE moments ({TABLES['moments']})")

    # 3️⃣ העתק את כל הנתונים ממומנטים בלי representative_image
    db.execute_query("""
    INSERT INTO moments(moment_id, label, description, start, end)
    SELECT moment_id, label, description, start, end FROM moments_old
    """)

    # 4️⃣ העתק את כל הנתונים מ‑images
    db.execute_query("""
    INSERT INTO images(image_id, label, date_taken, file_size, width, height, moment_id)
    SELECT image_id, label, date_taken, file_size, width, height, moment_id FROM images_old
    """)

    # 5️⃣ עכשיו העתק representative_image של moments
    db.execute_query("""
    UPDATE moments
    SET representative_image = (
        SELECT representative_image
        FROM moments_old
        WHERE moments_old.moment_id = moments.moment_id
    )
    """)

    # 6️⃣ מחק את הטבלאות הישנות
    db.execute_query("DROP TABLE images_old")
    db.execute_query("DROP TABLE moments_old")



    creation_order = [
        'groups',       # אין תלות
    #    'moments',      # תלוי ב-images, אבל ניצור אחרי כדי שתוכלו להשלים images קודם
    #    'images',       # תלוי ב-moments, אבל נוצר קודם
        'albums',
        'profiles',
        'faces',        # תלוי ב-groups, images
        'albums_images',# תלוי ב-albums, images
        'profile_images',# תלוי ב-profiles, images
        'profile_albums' # תלוי ב-profiles, albums
    ]
    db.execute_query('PRAGMA foreign_keys = OFF;')
    for table_name in creation_order:
        ddl = TABLES[table_name]
        print(f"Processing table '{table_name}'...")

        temp_table = f"{table_name}_new"
        db.execute_query(f"DROP TABLE IF EXISTS {temp_table}")
        db.execute_query(f"CREATE TABLE {temp_table} ({ddl})")

        # קבלת עמודות מהטבלה הישנה הנכונה
        cols = [row[1] for row in db.execute_query(f"PRAGMA table_info({table_name});", return_format=ReturnFormat.LIST_TUPLES)]
        cols_str = ', '.join(cols)

        # העתקת נתונים מהטבלה הישנה לטבלה החדשה
        db.execute_query(f"INSERT INTO {temp_table}({cols_str}) SELECT {cols_str} FROM {table_name}")

        db.execute_query(f"DROP TABLE {table_name}")
        db.execute_query(f"ALTER TABLE {temp_table} RENAME TO {table_name}")

        print(f"  ✅ Table '{table_name}' recreated with data")

    db.execute_query('PRAGMA foreign_keys = ON;')

def test_gets_methods(entities_tables: list, ids: dict, relations: list):
    for table in entities_tables:
        result = event.models_manager.get_entities(table)
        print('get_entities, all, from ', table)
        print(result)
        print('--------------------------------')
        id = ids[table][0]
        result = event.models_manager.get_entities(table, id)
        print('get_entities, one, from ', table, id)
        print(result)
        print('--------------------------------')
        result = event.models_manager.get_entities(table, ids[table])
        print('get_entities, many, from ', table, ids[table])
        print(result)
        print('--------------------------------')

    for parent, child in relations:
        id = ids[parent][0]
        result = event.models_manager.get_childs(parent, id, child)
        print(f'get_childs, {parent}.{child} of {id}')
        print(result)
        print('--------------------------------')

def test_edit_methods():
    # groups.faces
    source_group_id = '275d589e-9673-49d1-bc93-aa427dcada15'
    target_group_id = '7a81acd3-98ee-40c8-aa66-71b60b34bda8'
    if False:
        source_group_id, target_group_id = target_group_id, source_group_id
    face_ids = ['c61090e9-80bd-428e-8885-0f583a74703d']
    result = event.models_manager.add_faces_to_group(face_ids=face_ids, target_group_id=target_group_id, source_group_id=source_group_id)
    print(result)
    print('--------------------------------')
    # # moments.images
    # moment_id = '98ff7b08-bdbe-4b15-9637-290e24a58a7c'
    # image_ids = ['778a6e66-04bd-4a36-b769-527ddb7da4bc']
    # result = event.models_manager.edit_childs('moments', moment_id, 'images', image_ids, add=True)
    # print(result)
    # print('--------------------------------')
    # # albums.images
    # album_id = '0aeef84e-0a30-4193-b555-55c5ae672765'
    # image_ids = ['778a6e66-04bd-4a36-b769-527ddb7da4bc']
    # result = event.models_manager.edit_childs('albums', album_id, 'images', image_ids, add=True)
    # print(result)
    # print('--------------------------------')

recreate_views_triggers_and_indexes()

entities_tables = ['images', 'groups', 'moments', 'albums']
relations = [
    ('images', 'albums'),
    ('images', 'faces'),
    ('groups', 'images'),
    ('moments', 'images'),
    ('albums', 'images'),
]

ids = {
    'images': ['778a6e66-04bd-4a36-b769-527ddb7da4bc'], # noga dances
    'faces': ['c61090e9-80bd-428e-8885-0f583a74703d'], # noga face from the above image
    'groups': ['8f965866-ec14-4b61-95d8-79bae649dad4','275d589e-9673-49d1-bc93-aa427dcada15'], # noga, menachem
    'moments': ['98ff7b08-bdbe-4b15-9637-290e24a58a7c'], # סיור כלה
    'albums': ['0aeef84e-0a30-4193-b555-55c5ae672765'], # archive album
    'profiles': ['89cb4967-0eba-48af-99cc-5e87407fb639'],
}

# source_group_id = '8f965866-ec14-4b61-95d8-79bae649dad4'
# target_group_id = '275d589e-9673-49d1-bc93-aa427dcada15'
# result = event.models_manager.get_filtered_images(
#     group_ids=[source_group_id, target_group_id], mode='or', only=True
# )
# print(result)
# print('--------------------------------')