"""
Background worker that listens for permission-affecting changes, dequeues event_ids
from processing_queue, and runs refresh_all_eff(event_id) for each.

Run from project root: python -m src.worker.permissions_refresh_worker
Uses DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, DB_PORT from env (and .env if present).
"""

import logging
import os
import select
import sys

import psycopg2
from psycopg2 import extensions

# Ensure project root is on path and load .env when run as __main__
if __name__ == "__main__":
    _root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    sys.path.insert(0, _root)
    if os.path.exists(os.path.join(_root, ".env")):
        from dotenv import load_dotenv
        load_dotenv(os.path.join(_root, ".env"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

CHANNEL = "permissions_channel"
POLL_TIMEOUT_SEC = 60

def get_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        database=os.getenv("DB_NAME", "photo_app_db"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", ""),
        port=os.getenv("DB_PORT", "5432"),
    )

def process_pending_tasks(conn):
    """Dequeue up to BATCH_SIZE event_ids and run refresh_all_eff(event_id) for each."""
    with conn.cursor() as cur:
        DEQUEUE_SQL = """
            WITH picked AS (
                SELECT event_id FROM processing_queue
                FOR UPDATE SKIP LOCKED
                LIMIT 50
            )
            DELETE FROM processing_queue
            WHERE event_id IN (SELECT event_id FROM picked)
            RETURNING event_id
        """
        cur.execute(DEQUEUE_SQL)
        rows = cur.fetchall()
    if not rows:
        return
    for (event_id,) in rows:
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT refresh_all_eff(%s)", (event_id,))
            logger.info("refreshed eff for event %s", event_id)
        except Exception as e:
            logger.exception("refresh_all_eff(%s) failed: %s", event_id, e)
            # Optionally re-queue: INSERT INTO processing_queue (event_id) VALUES (%s) ON CONFLICT DO NOTHING

def run_worker():
    conn = get_connection()
    conn.set_isolation_level(extensions.ISOLATION_LEVEL_AUTOCOMMIT)

    with conn.cursor() as cur:
        cur.execute(f"LISTEN {CHANNEL};")
    logger.info("Worker started. Listening on %s (timeout %ss).", CHANNEL, POLL_TIMEOUT_SEC)

    while True:
        process_pending_tasks(conn)
        ready, _, _ = select.select([conn], [], [], POLL_TIMEOUT_SEC)
        if ready:
            conn.poll()
            while conn.notifies:
                conn.notifies.pop(0)
                # payload ignored; treat as signal to process queue on next loop

if __name__ == "__main__":
    run_worker()
