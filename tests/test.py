from src.core.services.event import Event, ChildOperation
from src.core.utils.face_utils import FaceUtils
from src.core.database.db import DB, ReturnFormat
from src.core.models.general_models import GeneralModels
import os
import time

event_id = '75cb6635-879d-4386-b023-366444dc0fb2'
profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"
general_models = GeneralModels(profile_id=profile_id)
event = Event(event_id, profile_id=profile_id)
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

def test_faces_in_aws_and_db():
    if not event.face_utils:
        event.face_utils = FaceUtils(event_id)
    faces_in_aws = event.face_utils.rek_helper.get_face_ids()
    faces_in_db = event.models.db.execute_query('SELECT face_id FROM faces;', return_format=ReturnFormat.LIST_VALUES)
    faces_in_aws_but_not_in_db = [face for face in faces_in_aws if face not in faces_in_db]
    faces_in_db_but_not_in_aws = [face for face in faces_in_db if face not in faces_in_aws]
    return {
        'faces_in_aws_but_not_in_db': faces_in_aws_but_not_in_db,
        'faces_in_db_but_not_in_aws': faces_in_db_but_not_in_aws
    }

def find_incomplete_images():
    images = event.models.db.execute_query('SELECT image_id FROM images;', return_format=ReturnFormat.LIST_VALUES)
    incomplete_images = []
    for image in images:
        if not os.path.exists(os.path.join(event.original_dir, f"{image}.jpg")):
            incomplete_images.append(image)
    
    return incomplete_images

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

add_preference('SettingsPage', 'errorFilterType', 'str', '')
add_preference('SettingsPage', 'errorFilterPeriod', 'str', '')

result1 = db.execute_query('SELECT * FROM errors;', return_format=ReturnFormat.LIST_DICTS)
print(result1)
print('--------------------------------')

result2 = db.execute_query('SELECT * FROM feedbacks;', return_format=ReturnFormat.LIST_DICTS)
print(result2)
print('--------------------------------')


result = event.models.get_entities('groups')
print(result)
print('--------------------------------')

profile = general_models.get_current_profile(event_id)
print(profile)
print('--------------------------------')

# mm_profile_id = '10d60cb9-6aec-4540-b15e-6df187f19b3c'
# event_mm = Event(event_id, profile_id=mm_profile_id)
# other_profile = '3bba6f81-98e1-40ef-b0d2-e955f5040aa9'
# # other_profile = '1f5e7d6a-74f0-4e73-bfd9-da5fac6ca9e2'
# db.execute_query('UPDATE events_profiles SET all_images = TRUE, can_edit = TRUE WHERE profile_id = %s AND event_id = %s;', (other_profile, event_id))
# update = 'FALSE'
# result2 = event_mm.models.db.execute_query('SELECT profile_id, all_images, can_edit FROM events_profiles_ctx WHERE profile_id = %s;', (other_profile,))
# print('events_profiles_ctx')
# print(result2)
# print('--------------------------------')
# result3 = db.execute_query('SELECT profile_id, all_images, can_edit FROM events_profiles WHERE profile_id = %s;', (other_profile,))
# print('events_profiles before update')
# print(result3)
# print('--------------------------------')
# query4 = f"""
#     UPDATE events_profiles_ctx
#     SET all_images = %s
#     WHERE profile_id = %s
#     AND event_id = %s
# """
# params4 = [update, other_profile, event_id]
# result4 = event_mm.models.db.execute_query(query4, params4, return_format=ReturnFormat.LIST_TUPLES)
# print('update events_profiles_ctx directly')
# print(result4)
# print('--------------------------------')
# query5 = f"""
#     WITH child_ids AS (
#         SELECT DISTINCT unnest(%s::UUID[]) AS profile_id
#     )
#     UPDATE events_profiles_ctx AS r
#     SET can_edit = %s
#     FROM child_ids c
#     WHERE r.profile_id = c.profile_id
#     AND r.event_id = %s
#     RETURNING r.profile_id
# """
# params = [[other_profile], update, event_id]
# result5 = event_mm.models.db.execute_query(query5, params, return_format=ReturnFormat.LIST_VALUES)
# print('update events_profiles_ctx')
# print(result5)
# print('--------------------------------')
# # event.models.edit_childs('events', event_id, 'profiles', [other_profile], operation=ChildOperation.UPDATE, data={'all_images': True})
# result6 = db.execute_query('SELECT profile_id, all_images, can_edit FROM events_profiles WHERE profile_id = %s;', (other_profile,))
# print('events_profiles after update')
# print(result6)
# print('--------------------------------')
# result7 = event_mm.models.get_entities('profiles')
# print(result7)
# print('--------------------------------')