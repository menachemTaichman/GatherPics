"""
Test all database views for performance.
Iterates over all actual existing views and measures query time.
"""

from contextlib import nullcontext
from src.core.services.event import Event
from src.core.database.db import DB, ReturnFormat
import time
import os

event_id = '75cb6635-879d-4386-b023-366444dc0fb2'
profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"
event = Event(event_id, profile_id=profile_id)
db = event.models.db

class Timeit:
    def __init__(self, name: str):
        self.name = name
    
    def __enter__(self):
        self.start = time.time()
        return self
    
    def __exit__(self, exc_type, exc_value, traceback):
        self.end = time.time()
        self.elapsed = self.end - self.start
        return False

def get_all_views(db: DB):
    """Get all views from the database."""
    query = """
        SELECT table_name 
        FROM information_schema.views 
        WHERE table_schema = 'public'
        ORDER BY table_name;
    """
    result = db.execute_query(query, return_format=ReturnFormat.LIST_TUPLES)
    return [row[0] for row in result]

def test_view(db: DB, view_name: str):
    """Test a single view and return results."""
    print(f"Testing: {view_name}...")
    try:
        with Timeit(view_name) as timer:
            result = db.execute_query(
                f'SELECT * FROM {view_name};', 
                return_format=ReturnFormat.LIST_DICTS
            )
            row_count = len(result)
        
        return {
            'view': view_name,
            'time': timer.elapsed,
            'rows': row_count,
            'error': None
        }
    except Exception as e:
        return {
            'view': view_name,
            'time': None,
            'rows': None,
            'error': str(e)
        }

def main():
    print("="*80)
    print("TESTING ALL DATABASE VIEWS PERFORMANCE")
    print("="*80)
    print(f"Event ID: {event_id}")
    print(f"Profile ID: {profile_id}")
    print()
    
    # Get all views
    print("Fetching all views from database...")
    views = get_all_views(db)
    print(f"Found {len(views)} views\n")
    
    # Test each view
    results = []
    for view in views:
        result = test_view(db, view)
        results.append(result)
        
        if result['error']:
            print(f"❌ {result['view']}: ERROR - {result['error']}")
        else:
            print(f"✓ {result['view']}: {result['time']:.4f}s ({result['rows']} rows)")
        print('--------------------------------')
    
    # Summary
    print("\n" + "="*80)
    print("PERFORMANCE SUMMARY")
    print("="*80)
    
    successful = [r for r in results if r['error'] is None]
    failed = [r for r in results if r['error'] is not None]
    
    if successful:
        total_time = sum(r['time'] for r in successful)
        avg_time = total_time / len(successful)
        max_time = max(r['time'] for r in successful)
        min_time = min(r['time'] for r in successful)
        
        print(f"\nSuccessful queries: {len(successful)}")
        print(f"Total time: {total_time:.4f}s")
        print(f"Average time: {avg_time:.4f}s")
        print(f"Fastest: {min_time:.4f}s")
        print(f"Slowest: {max_time:.4f}s")
        
        # Sort by time (slowest first)
        sorted_results = sorted(successful, key=lambda x: x['time'], reverse=True)
        
        print("\n" + "-"*80)
        print("SLOWEST VIEWS (Top 10):")
        print("-"*80)
        for i, result in enumerate(sorted_results[:10], 1):
            print(f"{i:2}. {result['view']:50} {result['time']:8.4f}s ({result['rows']:6} rows)")
        
        # Identify views that might need optimization (> 1 second)
        slow_views = [r for r in successful if r['time'] > 1.0]
        if slow_views:
            print("\n" + "-"*80)
            print(f"⚠ VIEWS TAKING > 1 SECOND ({len(slow_views)} views):")
            print("-"*80)
            for result in sorted(slow_views, key=lambda x: x['time'], reverse=True):
                print(f"  {result['view']:50} {result['time']:8.4f}s ({result['rows']:6} rows)")
    
    if failed:
        print(f"\n❌ Failed queries: {len(failed)}")
        for result in failed:
            print(f"  {result['view']}: {result['error']}")
    
    print("\n" + "="*80)
    
    return results

if __name__ == '__main__':
    main()

