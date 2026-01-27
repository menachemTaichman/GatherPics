"""
Processing queue for permission cache refresh. Worker listens for NOTIFY and processes
event_id by calling refresh_all_eff(event_id). ON CONFLICT (event_id) DO NOTHING debounces.
"""

from yoyo import step

__depends__ = {'0005_eff_cache_tables'}

steps = [
    step(
        """
        CREATE TABLE IF NOT EXISTS processing_queue (
            event_id UUID PRIMARY KEY,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """,
        "DROP TABLE IF EXISTS processing_queue;",
    ),
]
