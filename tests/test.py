from contextlib import nullcontext
from src.core.services.event import Event, ChildOperation
from src.core.utils.face_utils import FaceUtils
from src.core.database.db import DB, ReturnFormat
from src.core.models.general_models import GeneralModels
from src.core.errors import DatabaseError
import os

event_id = '75cb6635-879d-4386-b023-366444dc0fb2'
profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"
general_models = GeneralModels(profile_id=profile_id)
event = Event(event_id, profile_id=profile_id)
db = event.models.db
general_db = general_models.db

def drop_views_triggers_and_indexes(db: DB):
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

def create_views_triggers_and_indexes(db: DB):

    # import them again
    for view_name, view_query in db.VIEWS().items():
        db.execute_query(f'CREATE VIEW IF NOT EXISTS {view_name} AS {view_query}')

    for trigger_name, trigger_query in db.TRIGGERS().items():
        db.execute_query(f'CREATE TRIGGER IF NOT EXISTS {trigger_name} {trigger_query}')

    for index_name, index_query in db.INDEXES().items():
        db.execute_query(f'CREATE INDEX IF NOT EXISTS {index_name} ON {index_query}')

def recreate_views_triggers_and_indexes(db: DB):
    drop_views_triggers_and_indexes(db)
    create_views_triggers_and_indexes(db)

def recreate_tables_with_data(db: DB):
    TABLES = db.TABLES()

    creation_order = []
    cyclic_pairs = []

    creation_order = [
        'events',
        'profiles',
        'events_profiles',
        'profiles_preferences',
        'refresh_tokens',
        'notifications',
        'feedbacks',
        'settings',
        'groups',
        'faces',
        'albums',
        'images',
        'moments',
        'albums_images',
        'events_profiles_images',
        'events_profiles_albums',
        'events_profiles_groups',
        'uploads',
        'access_requests',
        'access_requests_groups',
    ]

    # צמדים עם תלות הדדית: (טבלה ראשונה, טבלה שנייה, שם השדה הבעייתי בטבלה הראשונה)
    cyclic_pairs = [
        ('moments', 'images', 'representative_image'),
        ('groups', 'faces', 'representative_face')
    ]

    # ------------------------------------------------------

    drop_views_triggers_and_indexes(db)
    db.execute_query('PRAGMA foreign_keys = OFF;')

    # שלב 1️⃣ – גיבוי כל הטבלאות
    print("📦 גיבוי כל הטבלאות...")
    for table_name in creation_order:
        backup_table = f"{table_name}_backup"
        db.execute_query(f"DROP TABLE IF EXISTS {backup_table}")
        db.execute_query(f"CREATE TABLE {backup_table} AS SELECT * FROM {table_name}")
        print(f"  ✅ גובהה {table_name} → {backup_table}")

    # שלב 2️⃣ – יצירה מחדש של כל הטבלאות
    print("\n🧱 יצירת טבלאות חדשות...")
    for table_name in creation_order:
        ddl = TABLES[table_name]
        db.execute_query(f"DROP TABLE IF EXISTS {table_name}")
        db.execute_query(f"CREATE TABLE {table_name} ({ddl})")
        print(f"  ✅ נוצרה טבלה חדשה {table_name}")

    # עוזר כללי להעתקת נתונים בין טבלאות לפי עמודות משותפות
    def copy_common_columns(src, dst):
        old_cols = [r[1] for r in db.execute_query(f"PRAGMA table_info({src});", return_format=ReturnFormat.LIST_TUPLES)]
        new_cols = [r[1] for r in db.execute_query(f"PRAGMA table_info({dst});", return_format=ReturnFormat.LIST_TUPLES)]
        common = [c for c in old_cols if c in new_cols]
        if not common:
            print(f"  ⚠️ אין עמודות משותפות בין {src} ל-{dst}")
            return
        cols = ', '.join(common)
        db.execute_query(f"INSERT INTO {dst}({cols}) SELECT {cols} FROM {src}")

    # שלב 3️⃣ – שחזור נתונים (כולל טיפול בצמדים)
    print("\n📤 שחזור נתונים...")

    handled = set()
    for a, b, problematic in cyclic_pairs:
        print(f"  🔁 טיפול בצמד {a} ↔ {b} (שדה בעייתי: {problematic})")

        # העתקה של טבלה A בלי השדה הבעייתי
        old_cols = [r[1] for r in db.execute_query(f"PRAGMA table_info({a}_backup);", return_format=ReturnFormat.LIST_TUPLES)]
        new_cols = [r[1] for r in db.execute_query(f"PRAGMA table_info({a});", return_format=ReturnFormat.LIST_TUPLES)]
        common_cols = [c for c in old_cols if c in new_cols and c != problematic]
        if common_cols:
            cols = ', '.join(common_cols)
            db.execute_query(f"INSERT INTO {a}({cols}) SELECT {cols} FROM {a}_backup")
            print(f"    ✅ {a}: הועתקו כל השדות למעט {problematic}")

        # העתקה של טבלה B כרגיל
        copy_common_columns(f"{b}_backup", b)
        print(f"    ✅ {b}: הועתקו כל הנתונים")

        # עדכון שדה בעייתי אחרי שטבלת B קיימת
        db.execute_query(f"""
            UPDATE {a}
            SET {problematic} = (
                SELECT {problematic}
                FROM {a}_backup
                WHERE {a}_backup.rowid = {a}.rowid
            )
        """)
        print(f"    🔄 {a}: עודכן השדה {problematic}")

        handled |= {a, b}

    # שאר הטבלאות (שלא בצמדים)
    for table_name in creation_order:
        if table_name in handled:
            continue
        print(f"  🔁 משחזר {table_name}...")
        copy_common_columns(f"{table_name}_backup", table_name)

    # שלב 4️⃣ – מחיקת טבלאות הגיבוי
    print("\n🧹 מחיקת טבלאות הגיבוי...")
    for table_name in creation_order:
        db.execute_query(f"DROP TABLE IF EXISTS {table_name}_backup")
    db.execute_query('PRAGMA foreign_keys = ON;')
    create_views_triggers_and_indexes(db)

    print("\n🎉 סיום תהליך יצירה מחדש של כל הטבלאות עם טיפול אוטומטי בתלויות הדדיות")

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
        ) VALUES (?, ?, ?, ?)
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
        SELECT profile_id, ?, ?, ?
        FROM profiles
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


# recreate_views_triggers_and_indexes(db)
settings = general_models.db.execute_query('SELECT * FROM settings WHERE id = 1;', return_format=ReturnFormat.DICT)
print(settings)
print('--------------------------------')
test_event_id = '11abc257-f714-4667-be15-068f7df50b8c'
query1 = f"""
    UPDATE settings SET
        event_in_deletion = ?
    WHERE id = 1;
"""
params1 = [test_event_id]
query2 = f"""
    DELETE FROM profiles
    WHERE restricted_to_event = ?;
"""
params2 = [test_event_id]
query3 = f"""
    DELETE FROM events
    WHERE event_id = ?;
"""
params3 = [test_event_id]
query4 = f"""
    UPDATE settings SET
        event_in_deletion = NULL
    WHERE id = 1;
"""
params4 = []

tables = ['images', 'faces', 'groups', 'moments', 'albums', 'albums_images', 'uploads', 'access_requests', 'access_requests_groups', 'events_profiles', 'events_profiles_images', 'events_profiles_albums', 'events_profiles_groups']
for table in tables:
    keys = db.execute_query(f'PRAGMA foreign_key_list({table});', (), return_format=ReturnFormat.LIST_DICTS)
    print(table)
    for key in keys:
        print(f'    table: {key["table"]}, column: {key["from"]}, on delete: {key["on_delete"]}')
    print('--------------------------------')

general_models.db.execute_query(query1, params1)
general_models.db.execute_query(query2, params2)
general_models.db.execute_query(query3, params3)
general_models.db.execute_query(query4, params4)

unassociated_group_id = '31bbbe03-1bad-a823-e96c-c671c0a00d9a'
test_event = Event(test_event_id, profile_id=profile_id)

result = general_models.delete_event(test_event_id)
print(result)

# recreate_views_triggers_and_indexes(general_models.db)

guest_profile_id = '1f5e7d6a-74f0-4e73-bfd9-da5fac6ca9e2'
# db.execute_query(f"""
#     UPDATE events_profiles SET can_manage_event = 0, can_delete_event = 0, can_upload_and_delete_images = 0, can_edit = 0
#     WHERE profile_id = ?
# """, (guest_profile_id,))

db.execute_query(f"""
    UPDATE profiles SET can_create_events = 0 WHERE profile_id = ?
""", (guest_profile_id,))
test_event = '3ff77fb3-0205-4507-9da8-783f3e6c2394'
result = general_models.process_new_images(test_event)
print(result)
# album_id = '0aeef84e-0a30-4193-b555-55c5ae672765'
# other_profile_id = '10d60cb9-6aec-4540-b15e-6df187f19b3c'
# other_profile_id = '162f6184-00a8-47f7-9895-f1fd8cbc93c5'

# other_event = Event(event_id, profile_id=other_profile_id)
# other_event.models.edit('events', event_id, {'rekognition_calls_limit': 100})
# print(other_event.models.get_entities('events', event_id))
# print('--------------------------------')