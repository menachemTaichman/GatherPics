"""
Comprehensive database views performance test.
Creates test data with specific distributions and tests all views.
"""

import unittest
import uuid
import random
from datetime import datetime, timedelta
import sys
import os

# Add parent directory to path to import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.core.models.general_models import GeneralModels
from src.core.services.event import Event
from src.core.models.event_models import EventModels
from src.core.database.db import DB, ReturnFormat
from tests.db.test_views_performance import main as test_views_performance


class TestDBPerformance(unittest.TestCase):
    """Test database views performance with comprehensive test data."""
    
    PROFILE_ID = "89cb4967-0eba-48af-99cc-5e87407fb639"  # Developer profile
    EVENT_ID_STR = "test-performance-views-event"  # Hardcoded event ID string for reuse
    # Generate deterministic UUID from string for database
    EVENT_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, EVENT_ID_STR))

    @classmethod
    def setUpClass(cls):
        """Set up the test event and generate data once for all tests."""
        print("\n" + "="*80)
        print("SETTING UP TEST EVENT AND GENERATING DATA")
        print("="*80)
        
        # Delete event if it exists (cleanup from previous runs)
        # Follow the exact process from trg_accessible_events_delete trigger:
        # 1. Set event context
        # 2. Check if another event is in deletion
        # 3. Set event_in_deletion
        # 4. Delete profiles where restricted_to_event = event_id
        # 5. Delete from events table
        # 6. Clear event_in_deletion
        gm = GeneralModels(profile_id=cls.PROFILE_ID)
        db = gm.db
        
        # Check if event exists and delete it following the trigger process
        try:
            existing = db.execute_query(
                "SELECT event_id FROM events WHERE event_id = %s",
                (cls.EVENT_ID,),
                return_format=ReturnFormat.VALUE
            )
            if existing:
                print(f"Found existing event: {cls.EVENT_ID}, deleting...")
                
                # Set event context by creating Event instance
                event = Event(cls.EVENT_ID, profile_id=cls.PROFILE_ID)
                
                # Follow the trigger process manually, but delete data in proper order
                with db.get_connection() as conn:
                    with conn.cursor() as cursor:
                        # Set profile and event context
                        cursor.execute("SELECT set_profile_context(%s, %s)", ('profile_id', str(cls.PROFILE_ID)))
                        cursor.execute("SELECT set_event_profile_context(%s, %s)", ('event_id', str(cls.EVENT_ID)))
                        conn.commit()
                        
                        # Check if another event is in deletion
                        cursor.execute("SELECT event_in_deletion FROM settings WHERE id = 1 LIMIT 1")
                        result = cursor.fetchone()
                        event_in_deletion = result[0] if result else None
                        if event_in_deletion:
                            print(f"Warning: Another event ({event_in_deletion}) is in deletion. Clearing it...")
                            cursor.execute("UPDATE settings SET event_in_deletion = NULL WHERE id = 1")
                            conn.commit()
                        
                        # Set event_in_deletion
                        cursor.execute("UPDATE settings SET event_in_deletion = %s WHERE id = 1", (cls.EVENT_ID,))
                        conn.commit()
                        
                        # Delete in proper order to avoid foreign key violations
                        # Delete junction tables first (before referenced tables)
                        
                        # Delete access_requests_groups (references access_requests and groups)
                        cursor.execute("""
                            DELETE FROM access_requests_groups 
                            WHERE access_request_id IN (
                                SELECT access_request_id FROM access_requests WHERE event_id = %s
                            )
                        """, (cls.EVENT_ID,))
                        print(f"  Deleted {cursor.rowcount} access_requests_groups")
                        
                        # Delete access_requests (references events)
                        cursor.execute("DELETE FROM access_requests WHERE event_id = %s", (cls.EVENT_ID,))
                        print(f"  Deleted {cursor.rowcount} access_requests")
                        
                        # Delete profiles_images (junction table - delete BEFORE images)
                        cursor.execute("""
                            DELETE FROM profiles_images 
                            WHERE image_id IN (
                                SELECT image_id FROM images WHERE event_id = %s
                            )
                        """, (cls.EVENT_ID,))
                        print(f"  Deleted {cursor.rowcount} profiles_images")
                        
                        # Delete profiles_groups (junction table - delete BEFORE groups)
                        cursor.execute("""
                            DELETE FROM profiles_groups 
                            WHERE group_id IN (
                                SELECT group_id FROM groups WHERE event_id = %s
                            )
                        """, (cls.EVENT_ID,))
                        print(f"  Deleted {cursor.rowcount} profiles_groups")
                        
                        # Delete profiles_albums (junction table - delete BEFORE albums)
                        cursor.execute("""
                            DELETE FROM profiles_albums 
                            WHERE album_id IN (
                                SELECT album_id FROM albums WHERE event_id = %s
                            )
                        """, (cls.EVENT_ID,))
                        print(f"  Deleted {cursor.rowcount} profiles_albums")
                        
                        # Delete albums_images (junction table - delete BEFORE albums and images)
                        cursor.execute("""
                            DELETE FROM albums_images 
                            WHERE album_id IN (
                                SELECT album_id FROM albums WHERE event_id = %s
                            )
                        """, (cls.EVENT_ID,))
                        print(f"  Deleted {cursor.rowcount} albums_images")
                        
                        # Delete faces (references images and groups)
                        cursor.execute("""
                            DELETE FROM faces 
                            WHERE image_id IN (
                                SELECT image_id FROM images WHERE event_id = %s
                            )
                        """, (cls.EVENT_ID,))
                        print(f"  Deleted {cursor.rowcount} faces")
                        
                        # Delete images (references events, moments, uploads)
                        cursor.execute("DELETE FROM images WHERE event_id = %s", (cls.EVENT_ID,))
                        print(f"  Deleted {cursor.rowcount} images")
                        
                        # Delete groups (references events)
                        cursor.execute("DELETE FROM groups WHERE event_id = %s", (cls.EVENT_ID,))
                        print(f"  Deleted {cursor.rowcount} groups")
                        
                        # Delete albums (references events)
                        cursor.execute("DELETE FROM albums WHERE event_id = %s", (cls.EVENT_ID,))
                        print(f"  Deleted {cursor.rowcount} albums")
                        
                        # Delete moments (references events)
                        cursor.execute("DELETE FROM moments WHERE event_id = %s", (cls.EVENT_ID,))
                        print(f"  Deleted {cursor.rowcount} moments")
                        
                        # Delete uploads (references events)
                        cursor.execute("DELETE FROM uploads WHERE event_id = %s", (cls.EVENT_ID,))
                        print(f"  Deleted {cursor.rowcount} uploads")
                        
                        # Delete events_profiles (references events and profiles)
                        cursor.execute("DELETE FROM events_profiles WHERE event_id = %s", (cls.EVENT_ID,))
                        print(f"  Deleted {cursor.rowcount} events_profiles")
                        
                        # Delete rekognition_usaged (references events)
                        cursor.execute("DELETE FROM rekognition_usaged WHERE event_id = %s", (cls.EVENT_ID,))
                        print(f"  Deleted {cursor.rowcount} rekognition_usaged")
                        
                        # Delete profiles where restricted_to_event = event_id
                        cursor.execute("DELETE FROM profiles WHERE restricted_to_event = %s", (cls.EVENT_ID,))
                        deleted_profiles = cursor.rowcount
                        if deleted_profiles > 0:
                            print(f"  Deleted {deleted_profiles} profiles restricted to event")
                        
                        # Delete from events table (last)
                        cursor.execute("DELETE FROM events WHERE event_id = %s", (cls.EVENT_ID,))
                        conn.commit()
                        
                        # Clear event_in_deletion
                        cursor.execute("UPDATE settings SET event_in_deletion = NULL WHERE id = 1")
                        conn.commit()
                
                # Also call Event.delete_event to clean up files and rekognition collection
                try:
                    Event.delete_event(cls.EVENT_ID)
                except Exception as e:
                    print(f"  Warning: Could not clean up event files: {e}")
                        
                print(f"Deleted existing event: {cls.EVENT_ID}")
        except Exception as e:
            # If something fails, try to clear event_in_deletion
            try:
                with db.get_connection() as conn:
                    with conn.cursor() as cursor:
                        cursor.execute("UPDATE settings SET event_in_deletion = NULL WHERE id = 1")
                        conn.commit()
            except:
                pass
            # Check if event still exists - if not, we're good
            try:
                still_exists = db.execute_query(
                    "SELECT event_id FROM events WHERE event_id = %s",
                    (cls.EVENT_ID,),
                    return_format=ReturnFormat.VALUE
                )
                if still_exists:
                    print(f"Warning: Event deletion may have failed: {e}")
            except:
                pass  # Event doesn't exist, that's fine
        
        # Create event with hardcoded event_id
        # Get max limits from settings to ensure valid values
        # Query settings table directly instead of using get_entities (which uses accessible_settings view)
        settings = db.execute_query(
            'SELECT * FROM settings WHERE id = 1',
            return_format=ReturnFormat.DICT
        )
        max_image_size = settings.get('image_size_limit_bytes', 13631488)  # Default ~13MB
        max_images_count = settings.get('images_count_limit', 6000)
        
        # Insert event directly into events table (bypassing accessible_events view)
        db.execute_query("""
            INSERT INTO events (event_id, name, url, date, is_public, images_count_limit, image_size_limit_bytes, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (event_id) DO UPDATE SET
                name = EXCLUDED.name,
                url = EXCLUDED.url,
                date = EXCLUDED.date,
                is_public = EXCLUDED.is_public,
                images_count_limit = EXCLUDED.images_count_limit,
                image_size_limit_bytes = EXCLUDED.image_size_limit_bytes
        """, (
            cls.EVENT_ID,
            f'Performance Test Event ({cls.EVENT_ID})',
            cls.EVENT_ID,
            datetime.now().isoformat(),
            False,
            min(10000, max_images_count),
            max_image_size,
            cls.PROFILE_ID
        ))
        
        # Manually create default albums, groups, and developer profile entry
        # (normally done by trg_ensure_defaults_in_event_insert trigger)
        
        # Get developer_id from settings
        developer_id = db.execute_query(
            'SELECT developer_id FROM settings WHERE id = 1',
            return_format=ReturnFormat.VALUE
        )
        if not developer_id:
            developer_id = cls.PROFILE_ID  # Fallback to test profile
        
        # Check if default albums/groups already exist, otherwise create them
        archive_album = db.execute_query(
            "SELECT album_id FROM albums WHERE event_id = %s AND label = 'Archive'",
            (cls.EVENT_ID,),
            return_format=ReturnFormat.DICT
        )
        if archive_album:
            archive_album_id = archive_album.get('album_id')
        else:
            archive_album_id = str(uuid.uuid4())
            db.execute_query("""
                INSERT INTO albums (event_id, album_id, label)
                VALUES (%s, %s, 'Archive')
            """, (cls.EVENT_ID, archive_album_id))
        
        favorites_album = db.execute_query(
            "SELECT album_id FROM albums WHERE event_id = %s AND label = 'Favorites'",
            (cls.EVENT_ID,),
            return_format=ReturnFormat.DICT
        )
        if favorites_album:
            favorites_album_id = favorites_album.get('album_id')
        else:
            favorites_album_id = str(uuid.uuid4())
            db.execute_query("""
                INSERT INTO albums (event_id, album_id, label)
                VALUES (%s, %s, 'Favorites')
            """, (cls.EVENT_ID, favorites_album_id))
        
        unassociated_group = db.execute_query(
            "SELECT group_id FROM groups WHERE event_id = %s AND label = 'Unassociated'",
            (cls.EVENT_ID,),
            return_format=ReturnFormat.DICT
        )
        if unassociated_group:
            unassociated_group_id = unassociated_group.get('group_id')
        else:
            unassociated_group_id = str(uuid.uuid4())
            db.execute_query("""
                INSERT INTO groups (event_id, group_id, label)
                VALUES (%s, %s, 'Unassociated')
            """, (cls.EVENT_ID, unassociated_group_id))
        
        # Update event with default IDs (after albums and groups are created)
        db.execute_query("""
            UPDATE events SET
                archive_album_id = %s,
                favorites_album_id = %s,
                unassociated_group_id = %s
            WHERE event_id = %s
        """, (archive_album_id, favorites_album_id, unassociated_group_id, cls.EVENT_ID))
        
        # Create events_profiles entry for developer
        db.execute_query("""
            INSERT INTO events_profiles (
                event_id, profile_id, can_manage_event, can_delete_event,
                can_upload_and_delete_images, can_edit, all_images, all_groups, all_albums
            )
            VALUES (%s, %s, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE)
            ON CONFLICT (event_id, profile_id) DO NOTHING
        """, (cls.EVENT_ID, developer_id))
        
        # Ensure we're using the hardcoded ID
        cls.event_id = cls.EVENT_ID
        
        # Initialize event models
        cls.event = Event(cls.event_id, profile_id=cls.PROFILE_ID)
        cls.models = cls.event.models
        
        print(f"Created event: {cls.event_id}")
        print("Generating test data...")
        
        # Generate data with same distributions as old test
        cls.generate_data()
        
        print("="*80)
        print("DATA GENERATION COMPLETE")
        print("="*80)
        print(f"Event ID: {cls.event_id}")
        print(f"Moments: {len(cls.moment_ids)}")
        print(f"Images: {len(cls.image_ids)}")
        print(f"Faces: {len(cls.face_ids)}")
        print(f"Groups: {len(cls.group_ids)}")
        print(f"Profiles: {len(cls.profiles)}")
        print(f"Albums: {len(cls.album_ids)}")
        print("="*80)
        
        # Analyze database after generating data
        print("\nAnalyzing database...")
        try:
            cls.models.db.execute_query('ANALYZE;')
            print("Database analysis complete!")
        except Exception as e:
            print(f"Warning: Database analysis failed: {e}")
        
        print("="*80 + "\n")

    @classmethod
    def tearDownClass(cls):
        """Keep event for reuse - no cleanup."""
        print("\n" + "="*80)
        print("TEST COMPLETE - EVENT KEPT FOR REUSE")
        print("="*80)
        print(f"Event ID: {cls.event_id}")
        print("Event will be reused in next test run (deleted and recreated)")
        print("="*80)

    @classmethod
    def generate_data(cls):
        """Generate all test data with specific distributions."""
        cls._generate_moments_and_images()
        cls._generate_groups()
        cls._generate_faces()
        cls._generate_profiles()
        cls._generate_albums()

    @classmethod
    def _generate_moments_and_images(cls):
        """Generate moments and images."""
        print("Generating moments and images...")
        
        # Generate 12 moments
        moments_data = []
        cls.moment_ids = []
        for i in range(12):
            moment_id = str(uuid.uuid4())
            cls.moment_ids.append(moment_id)
            moments_data.append({
                'moment_id': moment_id,
                'label': f'Wedding Moment {i+1}',
                'description': f'Description for moment {i+1}',
                'start_date': datetime.now() - timedelta(days=1),
                'end_date': datetime.now()
            })
        
        # Insert moments directly into moments table
        db = cls.models.db
        for moment in moments_data:
            db.execute_query("""
                INSERT INTO moments (moment_id, event_id, label, description, start_date, end_date)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                moment['moment_id'],
                cls.event_id,
                moment['label'],
                moment.get('description'),
                moment['start_date'],
                moment['end_date']
            ))
        
        # Generate 5000 images
        images_data = []
        cls.image_ids = []
        for i in range(5000):
            image_id = str(uuid.uuid4())
            cls.image_ids.append(image_id)
            images_data.append({
                'image_id': image_id,
                'label': f'image_{i}.jpg',
                'date_taken': datetime.now() - timedelta(hours=random.randint(0, 24)),
                'file_size': random.randint(100000, 5000000),
                'width': 1920,
                'height': 1080,
                'moment_id': random.choice(cls.moment_ids)
            })
        
        # Insert images directly in batches
        batch_size = 500
        for i in range(0, len(images_data), batch_size):
            batch = images_data[i:i+batch_size]
            row_placeholders = "(%s, %s, %s, %s, %s, %s, %s, %s)"
            value_placeholders = ", ".join([row_placeholders] * len(batch))
            sql = f"""
                INSERT INTO images (image_id, event_id, label, date_taken, file_size, width, height, moment_id)
                VALUES {value_placeholders}
            """
            all_values = []
            for img in batch:
                all_values.extend([
                    img['image_id'],
                    cls.event_id,
                    img['label'],
                    img['date_taken'],
                    img['file_size'],
                    img['width'],
                    img['height'],
                    img['moment_id']
                ])
            db.execute_query(sql, all_values)
        
        print(f"  Generated {len(cls.moment_ids)} moments and {len(cls.image_ids)} images")

    @classmethod
    def _generate_groups(cls):
        """Generate groups."""
        print("Generating groups...")
        
        groups_data = []
        cls.group_ids = []
        for i in range(300):
            group_id = str(uuid.uuid4())
            cls.group_ids.append(group_id)
            
            if i == 0:
                label = "Bride"
            elif i == 1:
                label = "Groom"
            elif 2 <= i < 12:
                label = f"Family {i-1}"
            else:
                label = f"Guest {i-11}"
            
            groups_data.append({
                'group_id': group_id,
                'label': label
            })
        
        # Insert groups directly in batches
        db = cls.models.db
        batch_size = 100
        for i in range(0, len(groups_data), batch_size):
            batch = groups_data[i:i+batch_size]
            row_placeholders = "(%s, %s, %s)"
            value_placeholders = ", ".join([row_placeholders] * len(batch))
            sql = f"INSERT INTO groups (group_id, event_id, label) VALUES {value_placeholders}"
            all_values = []
            for g in batch:
                all_values.extend([g['group_id'], cls.event_id, g['label']])
            db.execute_query(sql, all_values)
        
        print(f"  Generated {len(cls.group_ids)} groups")

    @classmethod
    def _generate_faces(cls):
        """Generate faces based on the specified distribution."""
        print("Generating faces...")
        
        # Generate faces data
        face_distribution = {
            1: 634,
            2: 386,
            4: 2165,
            8: 166,
            10: 854,
            20: 785
        }
        
        total_faces = sum(num_faces * num_images for num_faces, num_images in face_distribution.items())
        images_with_faces = random.sample(cls.image_ids, min(total_faces, len(cls.image_ids)))
        
        faces_data = []
        cls.face_ids = []
        image_idx = 0
        
        print(f"  Generating {total_faces} faces...")
        for num_faces, num_images in face_distribution.items():
            for _ in range(num_images):
                if image_idx < len(images_with_faces):
                    image_id = images_with_faces[image_idx]
                    # Assign faces to groups (distribute across groups)
                    for face_num in range(num_faces):
                        face_id = str(uuid.uuid4())
                        cls.face_ids.append(face_id)
                        # Distribute faces across groups
                        group_id = random.choice(cls.group_ids)
                        faces_data.append({
                            'face_id': face_id,
                            'image_id': image_id,
                            'group_id': group_id,
                            'face_width': random.uniform(0.05, 0.2),
                            'face_height': random.uniform(0.05, 0.2),
                            'face_left': random.uniform(0.0, 0.8),
                            'face_top': random.uniform(0.0, 0.8),
                            'file_size': random.randint(1000, 50000)
                        })
                    image_idx += 1
        
        # Insert faces directly into faces table (bypassing view/triggers for speed)
        print(f"  Inserting {len(faces_data)} faces directly into faces table...")
        db = cls.models.db
        fields = ['face_id', 'image_id', 'group_id', 'face_width', 'face_height', 'face_left', 'face_top', 'file_size']
        
        # Insert in batches for efficiency
        batch_size = 500
        batch_num = 0
        import time
        
        for i in range(0, len(faces_data), batch_size):
            batch_num += 1
            batch = faces_data[i:i+batch_size]
            print(f"    Batch {batch_num}: {len(batch)} faces...", end=' ', flush=True)
            start_time = time.time()
            
            # Direct insert into faces table
            row_placeholders = f"({', '.join(['%s'] * len(fields))})"
            value_placeholders = ", ".join([row_placeholders] * len(batch))
            sql = f"INSERT INTO faces ({', '.join(fields)}) VALUES {value_placeholders}"
            
            all_values = []
            for face in batch:
                all_values.extend([face[field] for field in fields])
            
            db.execute_query(sql, all_values)
            
            elapsed = time.time() - start_time
            print(f"OK ({elapsed:.2f}s)")
        
        print(f"  Generated {len(cls.face_ids)} faces total")

    @classmethod
    def _generate_profiles(cls):
        """Generate profiles with different access levels."""
        print("Generating profiles...")
        
        # Generate deterministic UUIDs for profile IDs
        profile_data = [
            {
                'profile_id_str': 'admin',
                'label': 'Admin',
                'email': 'admin@test.com',
                'password': 'password',
                'hierarchy_rank': 10,
                'can_create_events': True,
                'is_public': False
            },
            {
                'profile_id_str': 'couple',
                'label': 'Couple',
                'email': 'couple@test.com',
                'password': 'password',
                'hierarchy_rank': 5,
                'can_create_events': False,
                'is_public': False
            },
            {
                'profile_id_str': 'editor',
                'label': 'Editor',
                'email': 'editor@test.com',
                'password': 'password',
                'hierarchy_rank': 5,
                'can_create_events': False,
                'is_public': False
            },
            {
                'profile_id_str': 'guest',
                'label': 'Guest',
                'email': 'guest@test.com',
                'password': 'password',
                'hierarchy_rank': 1,
                'can_create_events': False,
                'is_public': False
            },
            {
                'profile_id_str': 'family',
                'label': 'Family',
                'email': 'family@test.com',
                'password': 'password',
                'hierarchy_rank': 1,
                'can_create_events': False,
                'is_public': False
            },
            {
                'profile_id_str': 'friends',
                'label': 'Friends',
                'email': 'friends@test.com',
                'password': 'password',
                'hierarchy_rank': 1,
                'can_create_events': False,
                'is_public': False
            },
            {
                'profile_id_str': 'no_access',
                'label': 'No Access',
                'email': 'noaccess@test.com',
                'password': 'password',
                'hierarchy_rank': 1,
                'can_create_events': False,
                'is_public': False
            }
        ]
        
        # Convert profile_id_str to UUID
        cls.profiles = []
        for p in profile_data:
            profile_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"test-profile-{p['profile_id_str']}"))
            cls.profiles.append({
                'profile_id': profile_id,
                'profile_id_str': p['profile_id_str'],  # Keep for reference
                'label': p['label'],
                'email': p['email'],
                'password': p['password'],
                'hierarchy_rank': p['hierarchy_rank'],
                'can_create_events': p['can_create_events'],
                'is_public': p['is_public']
            })
        
        # Create profiles - insert directly into profiles table if they don't exist
        db = cls.models.db
        for profile in cls.profiles:
            profile_id = profile['profile_id']
            # Check if profile exists
            existing = db.execute_query(
                "SELECT profile_id FROM profiles WHERE profile_id = %s",
                (profile_id,),
                return_format=ReturnFormat.VALUE
            )
            if not existing:
                # Insert directly into profiles table
                db.execute_query("""
                    INSERT INTO profiles (profile_id, label, email, password, hierarchy_rank, can_create_events, is_public)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    profile_id,
                    profile['label'],
                    profile.get('email'),
                    profile['password'],
                    profile['hierarchy_rank'],
                    profile.get('can_create_events', False),
                    profile.get('is_public', False)
                ))
        
        # Create events_profiles relationships - insert directly into events_profiles table
        db = cls.models.db
        for profile in cls.profiles:
            profile_id = profile['profile_id']
            profile_id_str = profile.get('profile_id_str', '')
            
            # Determine permissions based on profile
            if profile_id_str == 'admin':
                can_manage = True
                can_delete = True
                can_upload = True
                can_edit = True
                all_images = True
                all_groups = True
                all_albums = True
            elif profile_id_str in ['couple', 'editor']:
                can_manage = True
                can_delete = False
                can_upload = True
                can_edit = True
                all_images = True
                all_groups = True
                all_albums = True
            else:
                can_manage = False
                can_delete = False
                can_upload = False
                can_edit = False
                all_images = False
                all_groups = False
                all_albums = False
            
            # Insert events_profiles
            db.execute_query("""
                INSERT INTO events_profiles 
                (event_id, profile_id, can_manage_event, can_delete_event, can_upload_and_delete_images, can_edit, all_images, all_groups, all_albums)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (event_id, profile_id) DO UPDATE SET
                    can_manage_event = EXCLUDED.can_manage_event,
                    can_delete_event = EXCLUDED.can_delete_event,
                    can_upload_and_delete_images = EXCLUDED.can_upload_and_delete_images,
                    can_edit = EXCLUDED.can_edit,
                    all_images = EXCLUDED.all_images,
                    all_groups = EXCLUDED.all_groups,
                    all_albums = EXCLUDED.all_albums
            """, (
                cls.event_id, profile_id, can_manage, can_delete, can_upload, can_edit,
                all_images, all_groups, all_albums
            ))
            
            # For restricted profiles, add specific image access (batch insert)
            images_to_insert = []
            if profile_id_str == 'guest':
                # 50% of images
                images_to_insert = random.sample(cls.image_ids, int(len(cls.image_ids) * 0.5))
            elif profile_id_str == 'family':
                # 90% of images
                images_to_insert = random.sample(cls.image_ids, int(len(cls.image_ids) * 0.9))
            elif profile_id_str == 'friends':
                # 80% of images
                images_to_insert = random.sample(cls.image_ids, int(len(cls.image_ids) * 0.8))
            
            # Batch insert profiles_images (no event_id column)
            if images_to_insert:
                batch_size = 500
                for i in range(0, len(images_to_insert), batch_size):
                    batch = images_to_insert[i:i+batch_size]
                    row_placeholders = "(%s, %s)"
                    value_placeholders = ", ".join([row_placeholders] * len(batch))
                    sql = f"""
                        INSERT INTO profiles_images (profile_id, image_id)
                        VALUES {value_placeholders}
                        ON CONFLICT DO NOTHING
                    """
                    all_values = []
                    for image_id in batch:
                        all_values.extend([profile_id, image_id])
                    db.execute_query(sql, all_values)
        
        print(f"  Generated {len(cls.profiles)} profiles with access permissions")

    @classmethod
    def _generate_albums(cls):
        """Generate albums and add images to them."""
        print("Generating albums...")
        
        albums_data = []
        cls.album_ids = []
        for i in range(5):
            album_id = str(uuid.uuid4())
            cls.album_ids.append(album_id)
            albums_data.append({
                'album_id': album_id,
                'label': f'User Album {i+1}',
                'description': f'A collection of photos for album {i+1}.'
            })
        
        # Insert albums directly into albums table
        db = cls.models.db
        for album in albums_data:
            db.execute_query("""
                INSERT INTO albums (album_id, event_id, label, description)
                VALUES (%s, %s, %s, %s)
            """, (
                album['album_id'],
                cls.event_id,
                album['label'],
                album.get('description')
            ))
        
        # Add images to albums
        album_images = []
        for album_id in cls.album_ids:
            num_images = random.randint(20, 100)
            album_image_ids = random.sample(cls.image_ids, min(num_images, len(cls.image_ids)))
            for image_id in album_image_ids:
                album_images.append({
                    'album_id': album_id,
                    'image_id': image_id
                })
        
        # Insert album_images directly in batches
        if album_images:
            batch_size = 500
            for i in range(0, len(album_images), batch_size):
                batch = album_images[i:i+batch_size]
                row_placeholders = "(%s, %s)"
                value_placeholders = ", ".join([row_placeholders] * len(batch))
                sql = f"INSERT INTO albums_images (album_id, image_id) VALUES {value_placeholders} ON CONFLICT DO NOTHING"
                all_values = []
                for ai in batch:
                    all_values.extend([ai['album_id'], ai['image_id']])
                db.execute_query(sql, all_values)
        
        print(f"  Generated {len(cls.album_ids)} albums with {len(album_images)} image associations")

    def test_all_views_performance(self):
        """Test performance of all views."""
        print("\n" + "="*80)
        print("RUNNING COMPREHENSIVE VIEWS PERFORMANCE TEST")
        print("="*80)
        
        # Call the performance test with our event_id
        test_views_performance(self.event_id, self.PROFILE_ID)
        
        print("\n" + "="*80)
        print("VIEWS PERFORMANCE TEST COMPLETE")
        print("="*80)


if __name__ == '__main__':
    unittest.main()
