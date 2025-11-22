import unittest
import os
import shutil
import time
import random
import uuid
from datetime import datetime, timedelta

from src.core.database.base_db import BaseDB as DB

class TestDBPerformance(unittest.TestCase):
    DB_PATH = "tests/test_performance.db"
    DB_DIR = "tests/test_db_dir"
    PROFILE_ID = "test_profile"

    @classmethod
    def setUpClass(cls):
        """Set up the database and generate data once for all tests."""
        if os.path.exists(cls.DB_DIR):
            shutil.rmtree(cls.DB_DIR)
        
        cls.db_path = DB.create_new_db_in_dir(cls.DB_DIR, db_name="test_performance.db")
        cls.db = DB(cls.db_path)
        
        print("Setting up test database and generating data...")
        cls.generate_data()
        print("Data generation complete.")

    @classmethod
    def tearDownClass(cls):
        """Remove the test database."""
        if hasattr(cls, 'db'):
            # cls.db.close() # No close method in DB class
            pass
        if os.path.exists(cls.DB_DIR):
            shutil.rmtree(cls.DB_DIR)
        print(f"Test database directory {cls.DB_DIR} removed.")

    @classmethod
    def generate_data(cls):
        """Generates the test data."""
        cls._generate_moments_and_images()
        cls._generate_faces()
        cls._generate_groups()
        cls._generate_profiles()
        cls._generate_albums()
    
    @classmethod
    def _execute_many(cls, table_name, data_list):
        if not data_list:
            return
        keys = ', '.join(data_list[0].keys())
        placeholders = ', '.join(['?'] * len(data_list[0]))
        sql = f"INSERT INTO {table_name} ({keys}) VALUES ({placeholders})"
        with cls.db.get_connection() as conn:
            conn.executemany(sql, [tuple(d.values()) for d in data_list])
            conn.commit()

    @classmethod
    def _generate_moments_and_images(cls):
        """Generate moments and images."""
        print("Generating moments and images...")
        moments = []
        for i in range(12):
            moment = {
                "momentID": str(uuid.uuid4()),
                "label": f"Wedding Moment {i+1}",
                "description": f"Description for moment {i+1}",
                "start": (datetime.now() - timedelta(days=1)).isoformat(),
                "end": datetime.now().isoformat(),
                "representative_image": None
            }
            moments.append(moment)
        cls._execute_many('moments', moments)
        cls.moment_ids = [m['momentID'] for m in moments]

        images = []
        for i in range(5000):
            image = {
                "imageID": str(uuid.uuid4()),
                "label": f"image_{i}.jpg",
                "date_taken": (datetime.now() - timedelta(hours=random.randint(0, 24))).isoformat(),
                "file_size": random.randint(100000, 5000000),
                "width": 1920,
                "height": 1080,
                "momentID": random.choice(cls.moment_ids)
            }
            images.append(image)
        
        cls._execute_many('images', images)
        cls.image_ids = [img['imageID'] for img in images]
        print(f"Generated {len(moments)} moments and {len(images)} images.")

    @classmethod
    def _generate_faces(cls):
        """Generate faces based on the specified distribution."""
        print("Generating faces...")
        face_distribution = {
            1: 634, 2: 386, 4: 2165, 8: 166, 10: 854, 20: 785
        }
        
        images_with_faces = random.sample(cls.image_ids, sum(face_distribution.values()))
        
        faces = []
        image_idx = 0
        for num_faces, num_images in face_distribution.items():
            for _ in range(num_images):
                if image_idx < len(images_with_faces):
                    image_id = images_with_faces[image_idx]
                    for _ in range(num_faces):
                        face = {
                            "faceID": str(uuid.uuid4()),
                            "imageID": image_id,
                            "width": random.uniform(0.05, 0.2),
                            "height": random.uniform(0.05, 0.2),
                            "left": random.uniform(0.0, 0.8),
                            "top": random.uniform(0.0, 0.8),
                            "groupID": None
                        }
                        faces.append(face)
                    image_idx += 1
        
        cls._execute_many('faces', faces)
        cls.face_ids = [f['faceID'] for f in faces]
        print(f"Generated {len(faces)} faces.")

    @classmethod
    def _generate_groups(cls):
        """Generate groups and assign faces to them."""
        print("Generating groups...")
        groups = []
        for i in range(300):
            group_label = f"Group {i+1}"
            if i == 0:
                group_label = "Bride"
            elif i == 1:
                group_label = "Groom"
            elif 2 <= i < 12:
                group_label = f"Family {i-1}"
            else:
                group_label = f"Guest {i-11}"

            group = {
                "groupID": str(uuid.uuid4()),
                "label": group_label,
                "representative_face": None
            }
            groups.append(group)
        
        cls._execute_many('groups', groups)
        
        shuffled_faces = random.sample(cls.face_ids, len(cls.face_ids))
        
        updates_to_make = []
        
        total_faces = len(shuffled_faces)
        couple_faces_count = int(total_faces * 0.3)
        family_faces_count = int(total_faces * 0.4)
        
        face_idx = 0
        
        # Prepare Couple updates
        couple_faces_ids = shuffled_faces[face_idx:face_idx + couple_faces_count]
        bride_faces_count = int(len(couple_faces_ids) * 0.5)
        
        for i, face_id in enumerate(couple_faces_ids):
            group_id = groups[0]['groupID'] if i < bride_faces_count else groups[1]['groupID']
            updates_to_make.append((group_id, face_id))
        face_idx += couple_faces_count

        # Prepare Family updates
        family_faces_ids = shuffled_faces[face_idx:face_idx + family_faces_count]
        faces_per_family = len(family_faces_ids) // 10
        for i in range(10):
            group_id = groups[i+2]['groupID']
            start = i * faces_per_family
            end = start + faces_per_family
            for face_id in family_faces_ids[start:end]:
                updates_to_make.append((group_id, face_id))
        face_idx += family_faces_count

        # Prepare Guests updates
        guest_faces_ids = shuffled_faces[face_idx:]
        num_guest_groups = 288
        
        if guest_faces_ids and num_guest_groups > 0:
            avg_faces_per_guest = len(guest_faces_ids) / num_guest_groups
            guest_face_idx = 0
            for i in range(num_guest_groups):
                group_id = groups[i+12]['groupID']
                num_faces_for_guest = max(1, int(random.gauss(avg_faces_per_guest, avg_faces_per_guest/2)))
                
                end_idx = min(guest_face_idx + num_faces_for_guest, len(guest_faces_ids))
                for face_id in guest_faces_ids[guest_face_idx:end_idx]:
                     updates_to_make.append((group_id, face_id))
                guest_face_idx = end_idx
                if guest_face_idx >= len(guest_faces_ids):
                    break

        # Execute all updates in a single transaction
        with cls.db.get_connection() as conn:
            conn.executemany("UPDATE faces SET groupID = ? WHERE faceID = ?", updates_to_make)
            conn.commit()

        # Verification step
        null_groups_count = cls.db.execute_query("SELECT COUNT(*) FROM faces WHERE groupID IS NULL")[0][0]
        print(f"Faces with NULL groupID after update: {null_groups_count}")
        
        print(f"Generated {len(groups)} groups and assigned faces.")

    @classmethod
    def _generate_profiles(cls):
        """Generate profiles with different access levels."""
        print("Generating profiles...")
        cls.profiles = [
            {'profileID': 'admin', 'label': 'Admin', 'hierarchy_rank': 10, 'is_profiles_manager': 1, 'can_edit': 1, 'all_images': 1, 'all_albums': 1},
            {'profileID': 'couple', 'label': 'Couple', 'hierarchy_rank': 5, 'is_profiles_manager': 0, 'can_edit': 1, 'all_images': 1, 'all_albums': 1},
            {'profileID': 'editor', 'label': 'Editor', 'hierarchy_rank': 5, 'is_profiles_manager': 0, 'can_edit': 1, 'all_images': 1, 'all_albums': 1},
            {'profileID': 'guest', 'label': 'Guest', 'hierarchy_rank': 1, 'is_profiles_manager': 0, 'can_edit': 0, 'all_images': 0, 'all_albums': 0},
            {'profileID': 'family', 'label': 'Family', 'hierarchy_rank': 1, 'is_profiles_manager': 0, 'can_edit': 0, 'all_images': 0, 'all_albums': 0},
            {'profileID': 'friends', 'label': 'Friends', 'hierarchy_rank': 1, 'is_profiles_manager': 0, 'can_edit': 0, 'all_images': 0, 'all_albums': 0},
            {'profileID': 'no_access', 'label': 'No Access', 'hierarchy_rank': 1, 'is_profiles_manager': 0, 'can_edit': 0, 'all_images': 0, 'all_albums': 0}
        ]
        
        # Add password and save_preferences to all profiles
        for p in cls.profiles:
            p['password'] = 'password'
            p['save_preferences'] = 1

        cls._execute_many('profiles', cls.profiles)

        # Setup restricted access
        guest_images = random.sample(cls.image_ids, int(len(cls.image_ids) * 0.5))
        family_images = random.sample(cls.image_ids, int(len(cls.image_ids) * 0.9))
        friends_images = random.sample(cls.image_ids, int(len(cls.image_ids) * 0.8))

        profile_images_guest = [{'profileID': 'guest', 'imageID': img_id, 'accessible': 1} for img_id in guest_images]
        profile_images_family = [{'profileID': 'family', 'imageID': img_id, 'accessible': 1} for img_id in family_images]
        profile_images_friends = [{'profileID': 'friends', 'imageID': img_id, 'accessible': 1} for img_id in friends_images]
        
        # for no_access, we don't add any images to profile_images

        cls._execute_many('profile_images', profile_images_guest)
        cls._execute_many('profile_images', profile_images_family)
        cls._execute_many('profile_images', profile_images_friends)
        
        print(f"Generated {len(cls.profiles)} profiles.")

    @classmethod
    def _generate_albums(cls):
        """Generate albums and add images to them."""
        print("Generating albums...")
        albums = []
        for i in range(5):
            album = {
                "albumID": str(uuid.uuid4()),
                "label": f"User Album {i+1}",
                "description": f"A collection of photos for album {i+1}.",
                "representative_image": None
            }
            albums.append(album)
        
        cls._execute_many('albums', albums)

        album_images = []
        for album in albums:
            num_images = random.randint(20, 100)
            album_image_ids = random.sample(cls.image_ids, num_images)
            for image_id in album_image_ids:
                album_images.append({
                    "albumID": album['albumID'],
                    "imageID": image_id
                })
        
        cls._execute_many('album_images', album_images)
        print(f"Generated {len(albums)} albums with a total of {len(album_images)} image associations.")

    def test_data_consistency(self):
        """Test that views show correct data for each profile."""
        for profile in self.profiles:
            profile_id = profile['profileID']
            with self.subTest(profile=profile_id):
                self.db.set_profile_id(profile_id)

                # Images
                view_count = self.db.execute_query("SELECT COUNT(*) FROM accessible_images")[0][0]
                
                profile_details = self.db.get_one('profiles', {'profileID': profile_id}, bypass_access_control=True)
                if profile_details['all_images']:
                    # Should see all images except those explicitly denied
                    q = "SELECT COUNT(*) FROM images i LEFT JOIN profile_images pi ON i.imageID = pi.imageID AND pi.profileID = ? WHERE pi.accessible IS NULL OR pi.accessible = 1"
                    manual_count = self.db.execute_query(q, (profile_id,))[0][0]
                else:
                    # Should see only images explicitly allowed
                    q = "SELECT COUNT(*) FROM profile_images WHERE profileID = ? AND accessible = 1"
                    manual_count = self.db.execute_query(q, (profile_id,))[0][0]
                
                self.assertEqual(view_count, manual_count, f"Image count mismatch for profile {profile_id}")

                # Faces
                view_count = self.db.execute_query("SELECT COUNT(*) FROM accessible_faces")[0][0]
                q = """
                    SELECT COUNT(*) FROM faces f
                    JOIN accessible_images ai ON f.imageID = ai.imageID
                """
                manual_count = self.db.execute_query(q)[0][0]
                self.assertEqual(view_count, manual_count, f"Face count mismatch for profile {profile_id}")

    def _time_query(self, query, params=()):
        start_time = time.time()
        self.db.execute_query(query, params)
        end_time = time.time()
        return end_time - start_time

    def test_performance(self):
        """Test query performance for different profiles."""
        
        # --- Find good data for tests ---
        self.db.set_profile_id('admin') # Use admin for setup
        
        # Find a group with a decent number of faces
        test_group_id = self.db.execute_query("SELECT groupID FROM accessible_faces WHERE groupID IS NOT NULL GROUP BY groupID ORDER BY COUNT(*) DESC LIMIT 1")[0][0]
        
        # Find two groups with common images for filter tests
        common_groups_query = """
            SELECT f1.groupID, f2.groupID
            FROM accessible_faces f1
            JOIN accessible_faces f2 ON f1.imageID = f2.imageID AND f1.groupID < f2.groupID
            GROUP BY f1.groupID, f2.groupID
            ORDER BY COUNT(DISTINCT f1.imageID) DESC
            LIMIT 1;
        """
        result = self.db.execute_query(common_groups_query)
        group1_id, group2_id = result[0] if result else (None, None)
        
        # Find a moment with images for moving test
        source_moment_id = self.db.execute_query("SELECT momentID FROM images WHERE momentID IS NOT NULL LIMIT 1")[0][0]
        target_moment_id = self.db.execute_query(f"SELECT momentID FROM moments WHERE momentID != '{source_moment_id}' LIMIT 1")[0][0]
        images_to_move = [row[0] for row in self.db.execute_query(f"SELECT imageID FROM images WHERE momentID = '{source_moment_id}' LIMIT 10")]

        # --- Start Tests ---
        print("\n--- Performance Tests ---")
        
        # --- SELECT Performance ---
        print("\n--- SELECT Performance ---")
        for profile in self.profiles:
            profile_id = profile['profileID']
            self.db.set_profile_id(profile_id)
            print(f"\nTesting SELECT for profile: {profile_id}")

            # Query 1: Get all images for a specific group
            view_time = self._time_query(f"SELECT i.* FROM accessible_images i JOIN accessible_faces f ON i.imageID = f.imageID WHERE f.groupID = '{test_group_id}'")
            base_time = self._time_query(f"SELECT i.* FROM images i JOIN faces f ON i.imageID = f.imageID WHERE f.groupID = '{test_group_id}'")
            print(f"  Get images by group -> View: {view_time:.4f}s, Base: {base_time:.4f}s")
            
            # Query 2: Filter by two groups
            if group1_id and group2_id:
                view_time = self._time_query(f"SELECT imageID FROM accessible_faces WHERE groupID IN ('{group1_id}', '{group2_id}') GROUP BY imageID HAVING COUNT(DISTINCT groupID) = 2")
                base_time = self._time_query(f"SELECT imageID FROM faces WHERE groupID IN ('{group1_id}', '{group2_id}') GROUP BY imageID HAVING COUNT(DISTINCT groupID) = 2")
                print(f"  Filter by two groups -> View: {view_time:.4f}s, Base: {base_time:.4f}s")


        # --- ACTION Performance (View vs. Base Table) ---
        print("\n--- ACTION Performance ---")
        self.db.set_profile_id('admin') # Use admin with edit rights
        
        # Action 1: Regroup faces
        faces_to_update = self.db.execute_query(f"SELECT faceID FROM accessible_faces WHERE groupID = '{test_group_id}' LIMIT 10")
        face_ids_to_update = [f[0] for f in faces_to_update]
        new_group_id = self.db.execute_query("SELECT groupID FROM groups LIMIT 1")[0][0]
        
        start_time_view = time.time()
        self.db.execute_query(f"UPDATE accessible_faces SET groupID = '{new_group_id}' WHERE faceID IN ({','.join(['%s']*len(face_ids_to_update))})", face_ids_to_update)
        end_time_view = time.time()
        print(f"\n  Regroup 10 faces -> View: {end_time_view - start_time_view:.4f}s")

        start_time_base = time.time()
        self.db.execute_query(f"UPDATE faces SET groupID = '{new_group_id}' WHERE faceID IN ({','.join(['%s']*len(face_ids_to_update))})", face_ids_to_update)
        end_time_base = time.time()
        print(f"  Regroup 10 faces -> Base: {end_time_base - start_time_base:.4f}s")

        # Action 2: Move images to another moment
        start_time_view = time.time()
        self.db.execute_query(f"UPDATE accessible_images SET momentID = '{target_moment_id}' WHERE imageID IN ({','.join(['%s']*len(images_to_move))})", images_to_move)
        end_time_view = time.time()
        print(f"\n  Move 10 images -> View: {end_time_view - start_time_view:.4f}s")

        start_time_base = time.time()
        self.db.execute_query(f"UPDATE images SET momentID = '{target_moment_id}' WHERE imageID IN ({','.join(['%s']*len(images_to_move))})", images_to_move)
        end_time_base = time.time()
        print(f"  Move 10 images -> Base: {end_time_base - start_time_base:.4f}s")

        # Action 3: Edit profile permissions
        guest_profile_id = 'guest'
        # Find images the guest profile does NOT have access to, to avoid UNIQUE constraint errors
        images_for_guest = [row[0] for row in self.db.execute_query(f"""
            SELECT imageID from images 
            WHERE imageID NOT IN (SELECT imageID FROM profile_images WHERE profileID = '{guest_profile_id}')
            LIMIT 5
        """)]
        
        start_time_view = time.time()
        self.db.execute_query(f"INSERT INTO editable_profile_images (profileID, imageID, accessible) VALUES ('{guest_profile_id}', '{images_for_guest[0]}', 1)")
        end_time_view = time.time()
        print(f"\n  Add image permission -> View: {end_time_view - start_time_view:.4f}s")

        start_time_base = time.time()
        self.db.execute_query(f"INSERT INTO profile_images (profileID, imageID, accessible) VALUES ('{guest_profile_id}', '{images_for_guest[1]}', 1)")
        end_time_base = time.time()
        print(f"  Add image permission -> Base: {end_time_base - start_time_base:.4f}s")


if __name__ == '__main__':
    unittest.main()
