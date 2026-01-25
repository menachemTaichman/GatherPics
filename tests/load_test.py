"""
Locust load testing script for face-recognition-website

Usage:
    # Default: Uses LOCUST_HOST from .env or environment variables
    # Override: Use --host flag to override
    
    # Run Locust (uses LOCUST_HOST from .env if available)
    locust -f tests/load_test.py
    
    # Override host via command line
    locust -f tests/load_test.py --host=https://gatherpics.com
    
    # With specific user count and spawn rate
    locust -f tests/load_test.py --users 100 --spawn-rate 10
"""

import os
import random
from locust import HttpUser, task, between, events
from locust.exception import StopUser

# Load environment variables from .env file if it exists
if os.path.exists('.env'):
    from dotenv import load_dotenv
    load_dotenv()


class WebsiteUser(HttpUser):
    """
    Simulates a user browsing the website.
    Typical flow: Login → Get Event → Get Profile → Browse Moments → Browse Groups → Browse Images
    """
    wait_time = between(1, 5)  # Wait 1-5 seconds between tasks
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Cache for discovered resources
        self.event_id = None
        self.image_ids = []
        self.group_ids = []
        self.moment_ids = []
    
    def _extract_event_ids(self, events_data):
        """Extract event IDs from events API response."""
        event_ids = []
        if "changes" in events_data:
            for change in events_data["changes"]:
                if change.get("entity") == "event" and "items" in change:
                    for item in change["items"]:
                        event_id = item.get("id") or item.get("event_id")
                        if event_id:
                            event_ids.append(event_id)
        return event_ids
    
    def _get_or_discover_event_id(self):
        """Get event ID from environment or discover from API."""
        if self.event_id:
            return self.event_id
        
        # Try to get from environment first
        env_event_id = os.getenv("TEST_EVENT_ID")
        if env_event_id:
            self.event_id = env_event_id
            return self.event_id
        
        # Otherwise, discover from API
        events_response = self.client.get("/api/events", name="Get Events (discover)")
        if events_response.status_code == 200:
            try:
                events_data = events_response.json()
                event_ids = self._extract_event_ids(events_data)
                if event_ids:
                    self.event_id = random.choice(event_ids)
                    return self.event_id
            except Exception:
                pass
        
        return None
    
    def on_start(self):
        """
        Called once when a user starts.
        Sets up authentication and performs login, then gets event and profile.
        """
        # Get credentials from environment or use defaults
        self.label = os.getenv("TEST_USER_LABEL", "test_user")
        self.password = os.getenv("TEST_USER_PASSWORD", "test_password")
        
        # Perform login
        login_response = self.client.post(
            "/api/auth/login",
            json={
                "label": self.label,
                "password": self.password
            },
            name="Login"
        )
        
        if login_response.status_code != 200:
            # If login fails, stop this user
            print(f"Login failed with status {login_response.status_code}: {login_response.text}")
            raise StopUser("Login failed")
        
        # Extract access token from response
        try:
            login_data = login_response.json()
            self.access_token = login_data.get("access_token")
            self.profile_id = login_data.get("profile_id")
            
            # Set Authorization header for subsequent requests
            if self.access_token:
                self.client.headers.update({
                    "Authorization": f"Bearer {self.access_token}"
                })
        except Exception as e:
            print(f"Failed to parse login response: {e}")
            raise StopUser("Failed to parse login response")
        
        # Store cookies from login (refresh token is set as httpOnly cookie)
        # Locust automatically handles cookies, so we don't need to do anything special
        
        # Get event (typical user flow: user gets URL for specific event)
        event_id = self._get_or_discover_event_id()
        if event_id:
            self.client.get(f"/api/events/{event_id}", name="Get Event")
            self.client.get(f"/api/profiles/current?event_id={event_id}", name="Get Current Profile")
    
    def on_stop(self):
        """
        Called when a user stops.
        Optionally logout (though for load testing, we might skip this).
        """
        # Uncomment if you want users to logout when stopping
        # self.client.post("/api/auth/logout", name="Logout")
        pass
    
    @task(3)
    def browse_moments_page(self):
        """
        Browse moments page - typical user flow.
        This simulates going to MomentsPage: get current profile, get moments, then get all images.
        """
        event_id = self._get_or_discover_event_id()
        if not event_id:
            return
        
        self.client.get(f"/api/profiles/current?event_id={event_id}", name="Get Current Profile")
        
        # Get moments (as MomentsPage does)
        moments_response = self.client.get(
            f"/api/events/{event_id}/moments",
            name="Get Moments (MomentsPage)"
        )
        
        if moments_response.status_code == 200:
            try:
                moments_data = moments_response.json()
                # Cache moment IDs
                if "changes" in moments_data:
                    for change in moments_data["changes"]:
                        if change.get("entity") == "moment" and "items" in change:
                            for item in change["items"]:
                                moment_id = item.get("id") or item.get("moment_id")
                                if moment_id and moment_id not in self.moment_ids:
                                    self.moment_ids.append(moment_id)
            except Exception:
                pass
            
            # Get all images for moments (as MomentsPage does - this is the key call)
            self.client.get(
                f"/api/events/{event_id}/moments/images",
                name="Get All Images (MomentsPage)"
            )
    
    @task(3)
    def get_all_images(self):
        """
        Get all images for an event - high frequency task.
        This is what MomentsPage calls to load all images.
        """
        event_id = self._get_or_discover_event_id()
        if not event_id:
            return
        
        # Get current profile with event context (called on almost every page)
        self.client.get(f"/api/profiles/current?event_id={event_id}", name="Get Current Profile")
        
        images_response = self.client.get(
            f"/api/events/{event_id}/images",
            name="Get All Images"
        )
        
        if images_response.status_code == 200:
            try:
                images_data = images_response.json()
                # Cache image IDs for later use
                if "changes" in images_data:
                    for change in images_data["changes"]:
                        if change.get("entity") == "image" and "items" in change:
                            for item in change["items"]:
                                image_id = item.get("id") or item.get("image_id")
                                if image_id and image_id not in self.image_ids:
                                    self.image_ids.append(image_id)
            except Exception:
                pass
    
    @task(2)
    def get_image(self):
        """
        Get a specific image - medium frequency task.
        Simulates clicking on an image to view details.
        """
        event_id = self._get_or_discover_event_id()
        if not event_id:
            return
        
        # Use cached image ID or fetch images first
        if not self.image_ids:
            images_response = self.client.get(
                f"/api/events/{event_id}/images",
                name="Get Images (for single image)"
            )
            if images_response.status_code == 200:
                try:
                    images_data = images_response.json()
                    if "changes" in images_data:
                        for change in images_data["changes"]:
                            if change.get("entity") == "image" and "items" in change:
                                for item in change["items"]:
                                    image_id = item.get("id") or item.get("image_id")
                                    if image_id and image_id not in self.image_ids:
                                        self.image_ids.append(image_id)
                except Exception:
                    pass
        
        # Get a random image
        if self.image_ids:
            image_id = random.choice(self.image_ids)
            self.client.get(
                f"/api/events/{event_id}/images/{image_id}",
                name="Get Image"
            )
    
    @task(2)
    def get_groups(self):
        """
        Get all groups for an event - medium frequency task.
        """
        event_id = self._get_or_discover_event_id()
        if not event_id:
            return
        
        # Get current profile with event context (called on almost every page)
        self.client.get(f"/api/profiles/current?event_id={event_id}", name="Get Current Profile")
        
        groups_response = self.client.get(
            f"/api/events/{event_id}/groups",
            name="Get Groups"
        )
        
        if groups_response.status_code == 200:
            try:
                groups_data = groups_response.json()
                # Cache group IDs for later use
                if "changes" in groups_data:
                    for change in groups_data["changes"]:
                        if change.get("entity") == "group" and "items" in change:
                            for item in change["items"]:
                                group_id = item.get("id") or item.get("group_id")
                                if group_id and group_id not in self.group_ids:
                                    self.group_ids.append(group_id)
            except Exception:
                pass
    
    @task(2)
    def get_group(self):
        """
        Get a specific group with its images and faces - medium frequency task.
        Simulates clicking on a group to view its details.
        """
        event_id = self._get_or_discover_event_id()
        if not event_id:
            return
        
        # Use cached group ID or fetch groups first
        if not self.group_ids:
            groups_response = self.client.get(
                f"/api/events/{event_id}/groups",
                name="Get Groups (for single group)"
            )
            if groups_response.status_code == 200:
                try:
                    groups_data = groups_response.json()
                    if "changes" in groups_data:
                        for change in groups_data["changes"]:
                            if change.get("entity") == "group" and "items" in change:
                                for item in change["items"]:
                                    group_id = item.get("id") or item.get("group_id")
                                    if group_id and group_id not in self.group_ids:
                                        self.group_ids.append(group_id)
                except Exception:
                    pass
        
        # Get a random group
        if self.group_ids:
            group_id = random.choice(self.group_ids)
            self.client.get(
                f"/api/events/{event_id}/groups/{group_id}",
                name="Get Group"
            )
    
    @task(1)
    def get_events(self):
        """Get list of events - lower frequency task"""
        self.client.get("/api/events", name="Get Events")
    
    @task(1)
    def get_event(self):
        """Get specific event details - lower frequency task"""
        event_id = self._get_or_discover_event_id()
        if event_id:
            self.client.get(f"/api/events/{event_id}", name="Get Event")
            # Get current profile with event context (called on almost every page)
            self.client.get(f"/api/profiles/current?event_id={event_id}", name="Get Current Profile")
    
    @task(1)
    def get_albums(self):
        """Get albums - lower frequency task"""
        event_id = self._get_or_discover_event_id()
        if event_id:
            self.client.get(
                f"/api/events/{event_id}/albums",
                name="Get Albums"
            )
    
    @task(1)
    def get_moments(self):
        """Get moments - lower frequency task"""
        event_id = self._get_or_discover_event_id()
        if event_id:
            self.client.get(
                f"/api/events/{event_id}/moments",
                name="Get Moments"
            )


# Set default host from environment if not provided via command line flag
@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    """Set host from environment (.env or env vars) if not set via --host flag"""
    if not environment.host or environment.host == '':
        env_host = os.getenv('LOCUST_HOST') or os.getenv('TEST_HOST')
        if env_host:
            environment.host = env_host
