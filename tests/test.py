from contextlib import nullcontext
from src.core.services.event import Event, ChildOperation
from src.core.utils.face_utils import FaceUtils
from src.core.database.db import DB, ReturnFormat
from src.core.models.general_models import GeneralModels
from src.core.errors import DatabaseError
import os
import time

event_id = '75cb6635-879d-4386-b023-366444dc0fb2'
profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"
general_models = GeneralModels(profile_id=profile_id)
event = Event(event_id, profile_id=profile_id)
db = event.models.db
general_db = general_models.db

def drop_views_triggers_and_indexes(db: DB):
    # get all views, triggers and indexes from the db itseilf, drop them, import them again
    views = db.execute_query("SELECT table_name FROM information_schema.views WHERE table_schema = 'public'")
    triggers = db.execute_query("SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = 'public'")
    indexes = db.execute_query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname NOT LIKE 'pg_%'")

    for view in views:
        try:
            view_name = view[0] if isinstance(view, tuple) else view
            db.execute_query(f'DROP VIEW IF EXISTS {view_name} CASCADE')
        except Exception as e:
            print(f'Error dropping view {view_name}: {e}')

    for trigger in triggers:
        try:
            trigger_name = trigger[0] if isinstance(trigger, tuple) else trigger
            # PostgreSQL requires table name for DROP TRIGGER
            # We'll need to get the table name from information_schema
            trigger_info = db.execute_query(f"SELECT event_object_table FROM information_schema.triggers WHERE trigger_name = '{trigger_name}' AND trigger_schema = 'public' LIMIT 1")
            if trigger_info:
                table_name = trigger_info[0][0] if isinstance(trigger_info[0], tuple) else trigger_info[0]
                db.execute_query(f'DROP TRIGGER IF EXISTS {trigger_name} ON {table_name} CASCADE')
        except Exception as e:
            print(f'Error dropping trigger {trigger_name}: {e}')

    for index in indexes:
        try:
            index_name = index[0] if isinstance(index, tuple) else index
            db.execute_query(f'DROP INDEX IF EXISTS {index_name} CASCADE')
        except Exception as e:
            print(f'Error dropping index {index_name}: {e}')

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
    # PostgreSQL doesn't support disabling foreign keys like SQLite
    # Foreign key constraints are always enforced, so we'll need to handle this differently
    # For now, we'll just comment this out as it's not directly translatable
    # db.execute_query('SET session_replication_role = replica;')  # Disable triggers temporarily

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
        old_cols = [r[0] for r in db.execute_query(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{src}' AND table_schema = 'public' ORDER BY ordinal_position;", return_format=ReturnFormat.LIST_TUPLES)]
        new_cols = [r[0] for r in db.execute_query(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{dst}' AND table_schema = 'public' ORDER BY ordinal_position;", return_format=ReturnFormat.LIST_TUPLES)]
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
        old_cols = [r[0] for r in db.execute_query(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{a}_backup' AND table_schema = 'public' ORDER BY ordinal_position;", return_format=ReturnFormat.LIST_TUPLES)]
        new_cols = [r[0] for r in db.execute_query(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{a}' AND table_schema = 'public' ORDER BY ordinal_position;", return_format=ReturnFormat.LIST_TUPLES)]
        common_cols = [c for c in old_cols if c in new_cols and c != problematic]
        if common_cols:
            cols = ', '.join(common_cols)
            db.execute_query(f"INSERT INTO {a}({cols}) SELECT {cols} FROM {a}_backup")
            print(f"    ✅ {a}: הועתקו כל השדות למעט {problematic}")

        # העתקה של טבלה B כרגיל
        copy_common_columns(f"{b}_backup", b)
        print(f"    ✅ {b}: הועתקו כל הנתונים")

        # עדכון שדה בעייתי אחרי שטבלת B קיימת
        # PostgreSQL doesn't have rowid, so we need to use the primary key
        # Get the primary key column name
        pk_col = db.execute_query(f"""
            SELECT column_name 
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
                ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_name = '{a}' 
                AND tc.constraint_type = 'PRIMARY KEY'
                AND tc.table_schema = 'public'
            LIMIT 1
        """, return_format=ReturnFormat.VALUE)
        if pk_col:
            db.execute_query(f"""
                UPDATE {a}
                SET {problematic} = (
                    SELECT {problematic}
                    FROM {a}_backup
                    WHERE {a}_backup.{pk_col} = {a}.{pk_col}
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
    # PostgreSQL doesn't support enabling foreign keys like SQLite
    # Foreign key constraints are always enforced
    # db.execute_query('SET session_replication_role = DEFAULT;')  # Re-enable triggers
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
        ) VALUES (%s, %s, %s, %s)
    """
    params = [preference_group, preference_key, value_type, value]
    db.execute_query(query, params)
    # query = f"""
    #     INSERT INTO profiles_preferences (
    #         profile_id,
    #         preference_group,
    #         preference_key,
    #         preference_value
    #     )
    #     SELECT profile_id, %s, %s, %s
    #     FROM profiles
    # """
    # params = [preference_group, preference_key, value]
    # db.execute_query(query, params)

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


event = general_models.get_entities('events', event_id)
event_instance = Event(event_id)
if not event:
    raise ValueError('Event not found')
representative_image = event['representative_image']
if not representative_image:
    raise ValueError('Representative image not found')
file_path = os.path.join(event_instance.display_dir, f'{representative_image}.webp')
if not os.path.exists(file_path):
    raise ValueError('File not found')


class Timeit:
    def __init__(self, name: str):
        self.name = name
    
    def __enter__(self):
        self.start = time.time()
    
    def __exit__(self, exc_type, exc_value, traceback):
        self.end = time.time()
        print(f'{self.name} took {self.end - self.start} seconds')


views = [
    'accessible_images',
    'accessible_faces',
    'accessible_albums',
    'accessible_moments',
    'accessible_groups',
    'accessible_groups_images',
    'accessible_albums_images',
    'accessible_uploads',

]

for view in views:
    with Timeit(view):
        result = event.models.db.execute_query(f'SELECT * FROM {view};', return_format=ReturnFormat.LIST_DICTS)
        print(len(result))
        print('--------------------------------')