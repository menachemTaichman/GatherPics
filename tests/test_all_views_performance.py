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
        'settings_ctx',
        'settings_ext',
        'rekognition_usaged_ctx',
        'rekognition_usaged_ext',
        'profiles_ctx',
        'profiles_ext',
        'my_preferences',
        'my_notifications_ctx',
        'my_notifications_ext',
        'feedbacks_details',
        'my_feedbacks_ctx',
        'my_feedbacks_ext',
        'feedbacks_ctx',
        'feedbacks_ext',
        'images_default_albums',
        'groups_images',
        'albums_images_actual',
        'uploads_moments',
        'uploads_groups',
        'uploads_faces',
        'images_def',
        'groups_def',
        'albums_def',
        'images_eff',
        'faces_eff',
        'groups_eff',
        'moments_eff',
        'albums_eff',
        'events_ctx',
        'images_ctx',
        'faces_ctx',
        'groups_ctx',
        'groups_images_ctx',
        'moments_ctx',
        'albums_ctx',
        'albums_images_ctx',
        'albums_images_actual_ctx',
        'uploads_ctx',
        'uploads_groups_ctx',
        'uploads_moments_ctx',
        'uploads_faces_ctx',
        'my_access_requests_ctx',
        'my_access_requests_groups_ctx',
        'access_requests_groups_ctx',
        'access_requests_ctx',
        'events_profiles_ctx',
        'profiles_images_ctx',
        'profiles_groups_ctx',
        'profiles_albums_ctx',
        'access_requests_details',
        'images_ext',
        'faces_ext',
        'groups_ext',
        'moments_ext',
        'albums_ext',
        'uploads_ext',
        'uploads_groups_ext',
        'uploads_faces_ext',
        'uploads_moments_ext',
        'my_access_requests_ext',
        'my_access_requests_groups_ext',
        'access_requests_ext',
        'access_requests_groups_ext',
        'events_profiles_ext',
        'profiles_images_ext',
        'profiles_groups_ext',
        'profiles_albums_ext',
        'events_ext',
        'groups_to_access_requests_ctx',
        'current_profile_events',
        'current_profile',
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

def test_view(db: DB, view_name: str, analyze_plan: bool = False, timeout_seconds: float = None):
    """Test a single view and return results.
    
    Args:
        db: Database instance
        view_name: Name of the view to test
        analyze_plan: Whether to analyze query plan
        timeout_seconds: Timeout in seconds (None = no timeout)
    """
    print(f"Testing: {view_name}...")
    timed_out = False
    original_timeout = None
    elapsed_time = None
    
    try:
        # Set statement timeout if specified
        if timeout_seconds is not None:
            try:
                # Get current timeout setting
                timeout_query = db.execute_query(
                    "SHOW statement_timeout;",
                    return_format=ReturnFormat.LIST_TUPLES
                )
                if timeout_query:
                    original_timeout = timeout_query[0][0]
                
                # Set timeout (convert to milliseconds for PostgreSQL)
                timeout_ms = int(timeout_seconds * 1000)
                db.execute_query(f"SET statement_timeout = '{timeout_ms}ms';")
            except Exception as e:
                print(f"Warning: Could not set timeout: {str(e)}")
        
        with Timeit(view_name) as timer:
            result = db.execute_query(
                f'SELECT * FROM {view_name};', 
                return_format=ReturnFormat.LIST_DICTS
            )
            row_count = len(result)
        
        # Get elapsed time after context manager exits
        elapsed_time = timer.elapsed
        
        # Restore original timeout if it was set
        if timeout_seconds is not None and original_timeout:
            try:
                db.execute_query(f"SET statement_timeout = '{original_timeout}';")
            except:
                pass
        
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
            'time': elapsed_time,
            'rows': row_count,
            'error': None,
            'plan': plan_info,
            'timed_out': False
        }
    except Exception as e:
        error_msg = str(e)
        timed_out = 'timeout' in error_msg.lower() or 'canceling statement' in error_msg.lower()
        
        # Get elapsed time if timer was used (timer.elapsed is set in __exit__)
        try:
            if 'timer' in locals() and hasattr(timer, 'elapsed'):
                elapsed_time = timer.elapsed
        except:
            pass
        
        # Restore original timeout if it was set
        if timeout_seconds is not None and original_timeout:
            try:
                db.execute_query(f"SET statement_timeout = '{original_timeout}';")
            except:
                pass
        
        # If timed out, get the query plan
        plan_info = None
        if timed_out:
            try:
                print(f"  Query timed out after {timeout_seconds}s, getting query plan...")
                plan_result = db.execute_query(
                    f'EXPLAIN (ANALYZE, BUFFERS, VERBOSE) SELECT * FROM {view_name};',
                    return_format=ReturnFormat.LIST_TUPLES
                )
                if plan_result:
                    plan_info = '\n'.join([row[0] for row in plan_result])
            except Exception as plan_error:
                plan_info = f"Error getting plan after timeout: {str(plan_error)}"
        
        return {
            'view': view_name,
            'time': elapsed_time,
            'rows': None,
            'error': error_msg,
            'plan': plan_info,
            'timed_out': timed_out
        }

def main(event_id: str = None, profile_id: str = None, output_file: str = None, timeout_seconds: float = None, stop_on_timeout: bool = False):
    """Main function to test all views performance.
    
    Args:
        event_id: Event ID to test (defaults to hardcoded value)
        profile_id: Profile ID to use (defaults to hardcoded value)
        output_file: Path to output file (defaults to timestamped filename)
        timeout_seconds: Timeout in seconds for each query (None = no timeout)
        stop_on_timeout: If True, stop testing after first query that times out (default: False)
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
        if timeout_seconds is not None:
            print(f"Query timeout: {timeout_seconds}s")
        if stop_on_timeout:
            print(f"Stop on timeout: Enabled (will stop after first slow query)")
        print()
        
        # Get all views
        print("Fetching all views from database...")
        views = get_all_views(db)
        print(f"Found {len(views)} views\n")
        
        # Test each view
        results = []
        stopped_early = False
        plans_already_printed = set()  # Track views whose plans were already printed
        for view in views:
            result = test_view(db, view, timeout_seconds=timeout_seconds)
            results.append(result)
            
            if result['error']:
                if result.get('timed_out'):
                    print(f"⏱️  {result['view']}: TIMEOUT after {timeout_seconds}s - {result['error']}")
                    if result['plan']:
                        print(f"\nQuery Plan for {result['view']}:")
                        print("-" * 80)
                        print(result['plan'])
                        print("-" * 80)
                        plans_already_printed.add(result['view'])  # Mark as already printed
                    
                    # Stop testing if stop_on_timeout is enabled
                    if stop_on_timeout:
                        print(f"\n{'='*80}")
                        print(f"STOPPING TEST: Query timed out and stop_on_timeout is enabled")
                        print(f"{'='*80}\n")
                        stopped_early = True
                        break
                else:
                    print(f"[ERROR] {result['view']}: ERROR - {result['error']}")
            else:
                print(f"[OK] {result['view']}: {result['time']:.4f}s ({result['rows']} rows)")
                
                # Check if query exceeded timeout threshold (even if it completed)
                if stop_on_timeout and timeout_seconds is not None and result['time'] is not None and result['time'] > timeout_seconds:
                    print(f"\n[WARNING] Query exceeded timeout threshold ({timeout_seconds}s) but completed in {result['time']:.4f}s")
                    # Get query plan for this slow query
                    try:
                        print(f"  Getting query plan for {result['view']}...")
                        plan_result = db.execute_query(
                            f'EXPLAIN (ANALYZE, BUFFERS, VERBOSE) SELECT * FROM {result["view"]};',
                            return_format=ReturnFormat.LIST_TUPLES
                        )
                        if plan_result:
                            plan_text = '\n'.join([row[0] for row in plan_result])
                            print(f"\nQuery Plan for {result['view']}:")
                            print("-" * 80)
                            print(plan_text)
                            print("-" * 80)
                            plans_already_printed.add(result['view'])
                    except Exception as plan_error:
                        print(f"  Error getting plan: {str(plan_error)}")
                    
                    print(f"\n{'='*80}")
                    print(f"STOPPING TEST: Query exceeded timeout threshold and stop_on_timeout is enabled")
                    print(f"{'='*80}\n")
                    stopped_early = True
                    break
            print('--------------------------------')
        
        # Analyze slow views with query plans
        successful = [r for r in results if r['error'] is None]
        slow_views = [r for r in successful if r['time'] > 0.1]  # Views taking > 100ms
        slow_views.sort(key=lambda x: x['time'], reverse=True)
        
        if slow_views:
            print("\n" + "="*80)
            print("ANALYZING SLOW VIEWS (Query Plans)")
            print("="*80)
            
            for result in slow_views[:20]:  # Top 20 slowest
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
        
        if stopped_early:
            print(f"\n⚠ Testing stopped early after encountering a timeout")
            print(f"   Tested {len(results)} of {len(views)} views\n")
        
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
            print("SLOWEST VIEWS (Top 20):")
            print("-"*80)
            for i, result in enumerate(sorted_results[:20], 1):
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
            timed_out_views = [r for r in failed if r.get('timed_out')]
            other_failed = [r for r in failed if not r.get('timed_out')]
            
            if timed_out_views:
                print(f"\n⏱️  Timed out queries: {len(timed_out_views)}")
                for result in timed_out_views:
                    print(f"  {result['view']}: Timed out after {timeout_seconds}s")
                    # Only show plan if it wasn't already printed during the test
                    if result.get('plan') and result['view'] not in plans_already_printed:
                        print(f"    Query Plan:")
                        for line in result['plan'].split('\n')[:20]:  # Show first 20 lines
                            print(f"      {line}")
                        if len(result['plan'].split('\n')) > 20:
                            print(f"      ... ({len(result['plan'].split('\n')) - 20} more lines)")
            
            if other_failed:
                print(f"\n[ERROR] Failed queries: {len(other_failed)}")
                for result in other_failed:
                    print(f"  {result['view']}: {result['error']}")
        
        print("\n" + "="*80)
    
    # Print output file location to actual stdout
    print(f"\nOutput saved to: {output_file}")
    
    return results

if __name__ == '__main__':
    # Allow event_id, profile_id, output_file, timeout_seconds, and stop_on_timeout to be passed as command line arguments
    event_id_arg = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].lower() != 'none' else None
    profile_id_arg = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2].lower() != 'none' else None
    output_file_arg = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3].lower() != 'none' else None
    timeout_arg = float(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] and sys.argv[4].lower() != 'none' else None
    stop_on_timeout_arg = sys.argv[5].lower() in ('1', 'true', 'yes', 'y') if len(sys.argv) > 5 and sys.argv[5] else False
    results = main(event_id_arg, profile_id_arg, output_file_arg, timeout_arg, stop_on_timeout_arg)

