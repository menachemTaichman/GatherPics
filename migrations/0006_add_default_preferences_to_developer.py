"""
Add default preferences to the developer profile.
Inserts all default preferences from default_preferences table into profiles_preferences for the developer profile.
"""

from yoyo import step

__depends__ = {'0005_add_events_profiles_conflict_handling'}

steps = [
    step(
        """
        -- Insert all default preferences into profiles_preferences for the developer profile
        INSERT INTO profiles_preferences (profile_id, preference_group, preference_key, preference_value)
        SELECT 
            '89cb4967-0eba-48af-99cc-5e87407fb639'::UUID,
            preference_group,
            preference_key,
            value
        FROM default_preferences
        ON CONFLICT (profile_id, preference_group, preference_key) DO NOTHING;
        """,
        """
        -- Remove all preferences from the developer profile
        DELETE FROM profiles_preferences 
        WHERE profile_id = '89cb4967-0eba-48af-99cc-5e87407fb639'::UUID;
        """
    ),
]

