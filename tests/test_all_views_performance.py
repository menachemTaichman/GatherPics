"""
Test all database views for performance.
Iterates over all actual existing views and measures query time.
"""

from contextlib import nullcontext
from src.core.services.event import Event
from src.core.database.db import DB, ReturnFormat
import time
import os
from datetime import datetime
import sys

def get_event_and_db(event_id: str = None, profile_id: str = None):
    """Get event and db instances. If not provided, use defaults."""
    if event_id is None:
        event_id = '75cb6635-879d-4386-b023-366444dc0fb2'
    if profile_id is None:
        profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"
    event = Event(event_id, profile_id=profile_id)
    return event, event.models.db

# Default values for backward compatibility
event_id = '75cb6635-879d-4386-b023-366444dc0fb2'
profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"
event, db = get_event_and_db(event_id, profile_id)

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

class Tee:
    """Write to both stdout and a file."""
    def __init__(self, file_path: str):
        self.file = open(file_path, 'w', encoding='utf-8')
        self.stdout = sys.stdout
    
    def write(self, text: str):
        self.stdout.write(text)
        self.file.write(text)
        self.file.flush()
    
    def flush(self):
        self.stdout.flush()
        self.file.flush()
    
    def close(self):
        self.file.close()
    
    def __enter__(self):
        sys.stdout = self
        return self
    
    def __exit__(self, exc_type, exc_value, traceback):
        sys.stdout = self.stdout
        self.close()

def get_views_in_order():
    """Get views in the order they are created in migrations/0003_views.py.
    This ensures dependencies are tested before dependents."""
    return [
        'accessible_settings',
        'accessible_rekognition_usaged',
        'albums_accessibility_base',
        'groups_accessibility_base',
        'images_accessibility_base',
        'images_accessibility',
        'faces_accessibility',
        'groups_accessibility',
        'groups_images',
        'groups_to_request_access',
        'moments_accessibility',
        'albums_accessibility',
        'accessible_events',
        'accessible_profiles',
        'my_preferences',
        'my_notifications',
        'accessible_my_notifications',
        'accessible_notifications',
        'feedbacks_details',
        'my_feedbacks',
        'accessible_my_feedbacks',
        'accessible_feedbacks',
        'current_profile_events',
        'current_groups_to_request_access',
        'current_profile',
        'accessible_events_profiles',
        'accessible_events_profiles_images',
        'accessible_events_profiles_groups',
        'accessible_events_profiles_albums',
        'accessible_images',
        'accessible_faces',
        'accessible_groups_images',
        'accessible_groups',
        'accessible_moments',
        'albums_images_actual',
        'accessible_albums_images',
        'accessible_albums_images_actual',
        'accessible_albums',
        'uploads_details',
        'accessible_uploads',
        'uploads_groups',
        'accessible_uploads_groups',
        'uploads_moments',
        'accessible_uploads_moments',
        'uploads_faces',
        'accessible_uploads_faces',
        'access_requests_groups_details',
        'access_requests_details',
        'my_access_requests',
        'accessible_my_access_requests',
        'my_access_requests_groups',
        'accessible_my_access_requests_groups',
        'accessible_access_requests',
        'accessible_access_requests_groups',
        'current_event_profile',
    ]

def get_all_views(db: DB):
    """Get all views from the database, ordered by creation order."""
    # Get the ordered list of views
    ordered_views = get_views_in_order()
    
    # Get all views from database
    query = """
        SELECT table_name 
        FROM information_schema.views 
        WHERE table_schema = 'public'
        ORDER BY table_name;
    """
    result = db.execute_query(query, return_format=ReturnFormat.LIST_TUPLES)
    all_views = [row[0] for row in result]
    
    # Sort: first ordered views (in order), then any remaining views alphabetically
    ordered_set = set(ordered_views)
    ordered_found = [v for v in ordered_views if v in all_views]
    remaining = sorted([v for v in all_views if v not in ordered_set])
    
    return ordered_found + remaining

def test_view(db: DB, view_name: str, analyze_plan: bool = False):
    """Test a single view and return results."""
    print(f"Testing: {view_name}...")
    try:
        with Timeit(view_name) as timer:
            result = db.execute_query(
                f'SELECT * FROM {view_name};', 
                return_format=ReturnFormat.LIST_DICTS
            )
            row_count = len(result)
        
        plan_info = None
        if analyze_plan:
            try:
                plan_result = db.execute_query(
                    f'EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) SELECT * FROM {view_name};',
                    return_format=ReturnFormat.LIST_DICTS
                )
                if plan_result:
                    plan_info = plan_result[0].get('QUERY PLAN', '')
            except Exception as e:
                plan_info = f"Error getting plan: {str(e)}"
        
        return {
            'view': view_name,
            'time': timer.elapsed,
            'rows': row_count,
            'error': None,
            'plan': plan_info
        }
    except Exception as e:
        return {
            'view': view_name,
            'time': None,
            'rows': None,
            'error': str(e),
            'plan': None
        }

def main(event_id: str = None, profile_id: str = None, output_file: str = None):
    """Main function to test all views performance.
    
    Args:
        event_id: Event ID to test (defaults to hardcoded value)
        profile_id: Profile ID to use (defaults to hardcoded value)
        output_file: Path to output file (defaults to timestamped filename)
    """
    # Create output filename if not provided
    if output_file is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = f"tests/view_performance_{timestamp}.txt"
    
    # Ensure output directory exists
    os.makedirs(os.path.dirname(output_file) if os.path.dirname(output_file) else '.', exist_ok=True)
    
    event, db = get_event_and_db(event_id, profile_id)
    
    # Use Tee to write to both console and file
    with Tee(output_file):
        print(f"Event ID: {event.event_id}")
        print(f"Profile ID: {db.profile_context.get('profile_id', profile_id)}")
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
        
        # Analyze slow views with query plans
        successful = [r for r in results if r['error'] is None]
        slow_views = [r for r in successful if r['time'] > 0.1]  # Views taking > 100ms
        slow_views.sort(key=lambda x: x['time'], reverse=True)
        
        if slow_views:
            print("\n" + "="*80)
            print("ANALYZING SLOW VIEWS (Query Plans)")
            print("="*80)
            
            for result in slow_views[:10]:  # Top 10 slowest
                print(f"\n{'='*80}")
                print(f"VIEW: {result['view']}")
                print(f"Time: {result['time']:.4f}s | Rows: {result['rows']}")
                print('='*80)
                
                try:
                    plan_result = db.execute_query(
                        f'EXPLAIN (ANALYZE, BUFFERS, VERBOSE) SELECT * FROM {result["view"]};',
                        return_format=ReturnFormat.LIST_TUPLES
                    )
                    if plan_result:
                        for row in plan_result:
                            print(row[0])
                    else:
                        print("No plan available")
                except Exception as e:
                    print(f"Error getting plan: {str(e)}")
                print()
        
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
    
    # Print output file location to actual stdout
    print(f"\nOutput saved to: {output_file}")
    
    return results

if __name__ == '__main__':
    # Allow event_id and profile_id to be passed as command line arguments
    event_id_arg = sys.argv[1] if len(sys.argv) > 1 else None
    profile_id_arg = sys.argv[2] if len(sys.argv) > 2 else None
    output_file_arg = sys.argv[3] if len(sys.argv) > 3 else None
    results = main(event_id_arg, profile_id_arg, output_file_arg)

