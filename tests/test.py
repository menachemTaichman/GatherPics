import os
import logging
from src.core.services.event import Event, ChildOperation
from src.core.utils.face_utils import FaceUtils
from src.core.database.db import DB, ReturnFormat
from src.core.models.general_models import GeneralModels
from src.core.storage.file_helper import get_file_helper
from src.core.services.email import send_email

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

event_id = '75cb6635-879d-4386-b023-366444dc0fb2'
dev_profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"
general_models = GeneralModels(profile_id=dev_profile_id)
event = Event(event_id, profile_id=dev_profile_id)
db = event.models.db
general_db = general_models.db

def test_gets_methods(entities_tables: list, ids: dict, relations: list):
    for table in entities_tables:
        result = event.models.get_entities(table)
        print('get_entities, all, from ', table)
        print(result)
        print('--------------------------------')
        id = ids[table][0]
        result = event.models.get_entities(table, id)
        print('get_entities, one, from ', table, id)
        print(result)
        print('--------------------------------')
        result = event.models.get_entities(table, ids[table])
        print('get_entities, many, from ', table, ids[table])
        print(result)
        print('--------------------------------')

    for parent, child in relations:
        id = ids[parent][0]
        result = event.models.get_childs(parent, id, child)
        print(f'get_childs, {parent}.{child} of {id}')
        print(result)
        print('--------------------------------')

def test_edit_methods():
    # # groups.faces
    # source_group_id = '275d589e-9673-49d1-bc93-aa427dcada15'
    # target_group_id = '7a81acd3-98ee-40c8-aa66-71b60b34bda8'
    # if False:
    #     source_group_id, target_group_id = target_group_id, source_group_id
    # face_ids = ['c61090e9-80bd-428e-8885-0f583a74703d']
    # result = event.models.add_faces_to_group(face_ids=face_ids, target_group_id=target_group_id, source_group_id=source_group_id)
    # print(result)
    # print('--------------------------------')
    # moments.images
    # moment_id = '98ff7b08-bdbe-4b15-9637-290e24a58a7c'
    # image_ids = ['778a6e66-04bd-4a36-b769-527ddb7da4bc']
    # result = event.models.edit_childs('moments', moment_id, 'images', image_ids, operation=ChildOperation.ADD)
    # print(result)
    # print('--------------------------------')
    # albums.images
    album_id = '0aeef84e-0a30-4193-b555-55c5ae672765'
    image_ids = ['778a6e66-04bd-4a36-b769-527ddb7da4bc']
    result = event.models.edit_childs('albums', album_id, 'images', image_ids, operation=ChildOperation.ADD)
    print(result)
    print('--------------------------------')

def test_faces_in_aws_and_db(event_id: str, test_prod: bool = False):
    """
    Test faces in AWS Rekognition and database.
    
    Args:
        event_id: The event/collection ID to test (defaults to the global event_id)
        test_prod: If True, use actual AWS Rekognition and production DB (port 9000)
    
    Returns:
        dict with comparison results
    """
    # Save original environment variables
    original_env = os.environ.get('ENVIRONMENT')
    original_db_port = os.environ.get('DB_PORT')
    
    try:
        if test_prod:
            # Set ENVIRONMENT to 'PRODUCTION' to force real Rekognition
            # (AWSRekognitionHelper checks if ENVIRONMENT == 'DEVELOPMENT' to use mock)
            os.environ['ENVIRONMENT'] = 'PRODUCTION'
            # Set DB_PORT to production port (9000)
            os.environ['DB_PORT'] = '9000'
            # Reset DB connection pool to use new port
            DB._connection_pool = None
        
        # Create FaceUtils with the event_id
        face_utils = FaceUtils(event_id)
        faces_in_aws = face_utils.rek_helper.get_face_ids()
        
        # Get faces from DB
        faces_in_db = None
        try:
            db = DB(event_id=event_id, profile_id=dev_profile_id)
            faces_in_db = db.execute_query('SELECT face_id FROM faces;', return_format=ReturnFormat.LIST_VALUES)
        except Exception as e:
            print(f"Warning: Could not query database for event {event_id}: {e}")
        
        # Compare results
        if faces_in_db is not None:
            faces_in_aws_but_not_in_db = [face for face in faces_in_aws if face not in faces_in_db]
            faces_in_db_but_not_in_aws = [face for face in faces_in_db if face not in faces_in_aws]
            return {
                'faces_in_aws_but_not_in_db': faces_in_aws_but_not_in_db,
                'faces_in_db_but_not_in_aws': faces_in_db_but_not_in_aws,
                'faces_in_aws_count': len(faces_in_aws),
                'faces_in_db_count': len(faces_in_db),
                'event_id': event_id
            }
        else:
            # No DB comparison, just return AWS faces
            return {
                'faces_in_aws': faces_in_aws,
                'faces_in_aws_count': len(faces_in_aws),
                'event_id': event_id,
                'note': 'No database comparison performed (event not in DB or DB query failed)'
            }
    finally:
        # Restore original environment variables
        if original_env is not None:
            os.environ['ENVIRONMENT'] = original_env
        elif 'ENVIRONMENT' in os.environ and test_prod:
            # If ENVIRONMENT wasn't originally set, remove it after we're done
            del os.environ['ENVIRONMENT']
        
        if original_db_port is not None:
            os.environ['DB_PORT'] = original_db_port
        elif 'DB_PORT' in os.environ and test_prod:
            # If DB_PORT wasn't originally set, remove it after we're done
            del os.environ['DB_PORT']
        
        # Reset DB connection pool to use original settings
        if test_prod:
            DB._connection_pool = None

def find_incomplete_images(event_id: str, test_prod: bool = False):
    """
    Test images and faces in database and file system in both directions.
    Tests all types: original, high_quality, display, thumb, and faces.
    
    Args:
        event_id: The event ID to test
        test_prod: If True, use production DB (port 9000) and production storage
    
    Returns:
        dict with comparison results for all image types
    """

    # Save original environment variables
    original_env = os.environ.get('ENVIRONMENT')
    original_db_port = os.environ.get('DB_PORT')
    
    try:
        if test_prod:
            # Set ENVIRONMENT to 'PRODUCTION' to use S3 storage
            os.environ['ENVIRONMENT'] = 'PRODUCTION'
            # Set DB_PORT to production port (9000)
            os.environ['DB_PORT'] = '9000'
            # Reset DB connection pool to use new port
            DB._connection_pool = None
            # Reset file_helper global instance to use new storage backend
            import src.core.storage.file_helper as file_helper_module
            file_helper_module._file_helper = None
        
        # Create Event instance with the event_id
        test_event = Event(event_id, profile_id=dev_profile_id)
        file_helper = get_file_helper()
        
        # Get data from database
        db = None
        images_in_db = None
        faces_in_db = None
        try:
            db = DB(event_id=event_id, profile_id=dev_profile_id)
            images_in_db = db.execute_query('SELECT image_id FROM images;', return_format=ReturnFormat.LIST_VALUES)
            faces_in_db = db.execute_query('SELECT face_id FROM faces;', return_format=ReturnFormat.LIST_VALUES)
        except Exception as e:
            print(f"Warning: Could not query database for event {event_id}: {e}")
        
        # Define image types to test
        image_types = [
            {'name': 'to_process', 'dir': test_event.to_process_dir, 'ext': '.jpg', 'table': 'images', 'id_field': 'image_id'},
            {'name': 'original', 'dir': test_event.original_dir, 'ext': '.jpg', 'table': 'images', 'id_field': 'image_id'},
            {'name': 'high_quality', 'dir': test_event.high_quality_dir, 'ext': '.jpg', 'table': 'images', 'id_field': 'image_id'},
            {'name': 'display', 'dir': test_event.display_dir, 'ext': '.webp', 'table': 'images', 'id_field': 'image_id'},
            {'name': 'thumb', 'dir': test_event.thumb_dir, 'ext': '.webp', 'table': 'images', 'id_field': 'image_id'},
        ]
        
        # Test faces separately
        faces_type = {'name': 'faces', 'dir': test_event.faces_dir, 'ext': '.webp', 'table': 'faces', 'id_field': 'face_id'}
        
        results = {
            'event_id': event_id,
            'images': {},
            'faces': {}
        }
        
        # Test each image type
        for img_type in image_types:
            type_name = img_type['name']
            dir_path = img_type['dir']
            file_ext = img_type['ext']
            
            # Test direction 1: DB to file system
            ids_in_db_but_not_in_fs = []
            if images_in_db is not None:
                for image_id in images_in_db:
                    file_path = f"{dir_path}/{image_id}{file_ext}"
                    if not file_helper.exists(file_path):
                        ids_in_db_but_not_in_fs.append(image_id)
            
            # Test direction 2: File system to DB
            files_in_fs = []
            try:
                files_in_fs = file_helper.list_files(dir_path, suffix=file_ext)
            except Exception as e:
                print(f"Warning: Could not list {type_name} files from file system for event {event_id}: {e}")
            
            # Extract IDs from file paths
            ids_in_fs = []
            for file_path in files_in_fs:
                # File path format: "event_id/{dir}/{id}.{ext}"
                filename = file_path.split('/')[-1]
                if filename.endswith(file_ext):
                    entity_id = filename[:-len(file_ext)]  # Remove extension
                    ids_in_fs.append(entity_id)
            
            # Check which IDs in file system are missing from DB
            ids_in_fs_but_not_in_db = []
            if images_in_db is not None:
                ids_in_fs_but_not_in_db = [entity_id for entity_id in ids_in_fs if entity_id not in images_in_db]
            else:
                # If we can't query DB, all FS IDs are potentially missing from DB
                ids_in_fs_but_not_in_db = ids_in_fs
            
            results['images'][type_name] = {
                'in_db_but_not_in_fs': ids_in_db_but_not_in_fs,
                'in_fs_but_not_in_db': ids_in_fs_but_not_in_db,
                'in_db_count': len(images_in_db) if images_in_db is not None else 0,
                'in_fs_count': len(ids_in_fs)
            }
        
        # Test faces
        type_name = faces_type['name']
        dir_path = faces_type['dir']
        file_ext = faces_type['ext']
        
        # Test direction 1: DB to file system
        faces_in_db_but_not_in_fs = []
        if faces_in_db is not None:
            for face_id in faces_in_db:
                file_path = f"{dir_path}/{face_id}{file_ext}"
                if not file_helper.exists(file_path):
                    faces_in_db_but_not_in_fs.append(face_id)
        
        # Test direction 2: File system to DB
        files_in_fs = []
        try:
            files_in_fs = file_helper.list_files(dir_path, suffix=file_ext)
        except Exception as e:
            print(f"Warning: Could not list {type_name} files from file system for event {event_id}: {e}")
        
        # Extract face IDs from file paths
        faces_in_fs = []
        for file_path in files_in_fs:
            filename = file_path.split('/')[-1]
            if filename.endswith(file_ext):
                face_id = filename[:-len(file_ext)]  # Remove extension
                faces_in_fs.append(face_id)
        
        # Check which faces in file system are missing from DB
        faces_in_fs_but_not_in_db = []
        if faces_in_db is not None:
            faces_in_fs_but_not_in_db = [face_id for face_id in faces_in_fs if face_id not in faces_in_db]
        else:
            # If we can't query DB, all FS faces are potentially missing from DB
            faces_in_fs_but_not_in_db = faces_in_fs
        
        results['faces'] = {
            'in_db_but_not_in_fs': faces_in_db_but_not_in_fs,
            'in_fs_but_not_in_db': faces_in_fs_but_not_in_db,
            'in_db_count': len(faces_in_db) if faces_in_db is not None else 0,
            'in_fs_count': len(faces_in_fs)
        }
        
        return results
    finally:
        # Restore original environment variables
        if original_env is not None:
            os.environ['ENVIRONMENT'] = original_env
        elif 'ENVIRONMENT' in os.environ and test_prod:
            # If ENVIRONMENT wasn't originally set, remove it after we're done
            del os.environ['ENVIRONMENT']
        
        if original_db_port is not None:
            os.environ['DB_PORT'] = original_db_port
        elif 'DB_PORT' in os.environ and test_prod:
            # If DB_PORT wasn't originally set, remove it after we're done
            del os.environ['DB_PORT']
        
        # Reset DB connection pool and file_helper to use original settings
        if test_prod:
            DB._connection_pool = None
            import src.core.storage.file_helper as file_helper_module
            file_helper_module._file_helper = None

def add_preference(preference_group: str, preference_key: str, value_type: str, value: any):
    query = f"""
        INSERT INTO default_preferences (
            preference_group,
            preference_key,
            value_type,
            value
        ) VALUES (%s, %s, %s, %s)
    """
    params = [preference_group, preference_key, value_type, value]
    db.execute_query(query, params)
    query = f"""
        INSERT INTO profiles_preferences (
            profile_id,
            preference_group,
            preference_key,
            preference_value
        )
        SELECT profile_id, %s, %s, %s
        FROM profiles
        ON CONFLICT (profile_id, preference_group, preference_key) DO NOTHING
    """
    params = [preference_group, preference_key, value]
    db.execute_query(query, params)

import time
class Timeit:
    def __init__(self, name: str):
        self.name = name
    
    def __enter__(self):
        self.start = time.time()
        return self
    
    def __exit__(self, exc_type, exc_value, traceback):
        self.end = time.time()
        self.elapsed = self.end - self.start
        print(f'{self.name} took {self.elapsed} seconds')
        return False


def test_timeit():

    event_id = '73f1cf50-95ee-4832-97ef-83c0f50a82c0'
    # create db instance
    with Timeit('create db instance'):
        db = DB(profile_id=dev_profile_id, event_id=event_id)

    # create event instance
    with Timeit('create event instance'):
        event = Event(event_id, profile_id=dev_profile_id)

    # create general models instance
    with Timeit('create general models instance'):
        general_models = GeneralModels(profile_id=dev_profile_id)

    with Timeit('get_childs'):
        result = event.models.get_childs('groups', '4573c4a0-ba12-4fa0-b3d8-db26be68221d', 'images')
        # print(result)

    with Timeit('get_image'):
        result = event.models.get_entities('images', 'affd55e9-6563-4a66-ac2c-5584dd9de888')

    print('--------------------------------')

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

# test_timeit()

def test_cluster_faces_task(event_id: str, profile_id: str, upload_id: int):

    event = Event(event_id, profile_id=profile_id)
    unassociated_group_id = event.models.get_entities('events', event_id, include_details=True).get('unassociated_group_id')
    query = f"""
        UPDATE faces
        SET group_id = %s
        FROM images
        WHERE faces.image_id = images.image_id AND images.event_id = %s;

        DELETE FROM groups
        WHERE event_id = %s AND group_id <> %s;
    """
    event.models.db.execute_query(query, (unassociated_group_id, event_id, event_id, unassociated_group_id))
    face_ids = event.models.get_ready_face_ids_in_upload(upload_id)
    event._cluster_faces(face_ids)

# # prod

# event = Event(event_id='b5c2cb37-f7bf-4223-92eb-eee4060eb553', profile_id=dev_profile_id)
# base_image_ids = event.models.get_childs('groups', '798b71cd-e53c-400d-8122-d3984cf043ed', 'images', return_ids=True)
# with Timeit('get_related_groups'):
#     result = event.models.get_related_groups(group_ids=['798b71cd-e53c-400d-8122-d3984cf043ed'], base_image_ids=base_image_ids)
# # print(result)
# print('--------------------------------')

# event_id = '73f1cf50-95ee-4832-97ef-83c0f50a82c0'
# event = Event(event_id, profile_id=dev_profile_id)

# result1 = event.models.get_entities('images')
# print(result1)
# print('--------------------------------')

# public_profile_id = '0b54fd8b-722e-4449-996d-2044553616ac'
# public_event = Event(event_id, profile_id=public_profile_id)
# result2 = public_event.models.get_entities('images')
# print(result2)
# print('--------------------------------')
# # event_id = '73f1cf50-95ee-4832-97ef-83c0f50a82c0'
# # image_id = 'e50d347e-154f-4b22-a2f7-d8be6fdce28b'
# # result = find_incomplete_images(event_id, test_prod=True)
# # print(result)
# # print('--------------------------------')
# # general_models.process_new_images(event_id=event_id)

# # result = test_faces_in_aws_and_db('8d06da7d-d6a4-490c-badc-91e23b75989c', test_prod=True)
# # print(result)
# # print('--------------------------------')