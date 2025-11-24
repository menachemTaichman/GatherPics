"""
Analyze slow database views and suggest optimizations.
"""

from src.core.services.event import Event
from src.core.database.db import DB, ReturnFormat
import json

event_id = '75cb6635-879d-4386-b023-366444dc0fb2'
profile_id = "89cb4967-0eba-48af-99cc-5e87407fb639"
event = Event(event_id, profile_id=profile_id)
db = event.models.db

def analyze_view_plan(db: DB, view_name: str):
    """Get simplified query plan for a view."""
    try:
        # Get EXPLAIN ANALYZE as JSON
        result = db.execute_query(
            f'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM {view_name};',
            return_format=ReturnFormat.LIST_DICTS
        )
        
        if not result or not result[0].get('QUERY PLAN'):
            return None
        
        plan_json = result[0]['QUERY PLAN']
        if isinstance(plan_json, str):
            plan_json = json.loads(plan_json)
        
        return plan_json[0] if plan_json else None
    except Exception as e:
        print(f"Error analyzing {view_name}: {e}")
        return None

def extract_slow_operations(plan, threshold_ms=100):
    """Extract operations that take longer than threshold."""
    slow_ops = []
    
    def traverse(node, depth=0):
        if not isinstance(node, dict):
            return
        
        # Check execution time
        if 'Actual Total Time' in node:
            time_ms = node['Actual Total Time'] * 1000
            if time_ms > threshold_ms:
                slow_ops.append({
                    'node_type': node.get('Node Type', 'Unknown'),
                    'time_ms': time_ms,
                    'rows': node.get('Actual Rows', 0),
                    'loops': node.get('Actual Loops', 1),
                    'relation': node.get('Relation Name', ''),
                    'operation': node.get('Operation', ''),
                    'depth': depth
                })
        
        # Recurse into children
        if 'Plans' in node:
            for child in node['Plans']:
                traverse(child, depth + 1)
    
    traverse(plan.get('Plan', {}))
    return slow_ops

def print_analysis(view_name, plan):
    """Print analysis of a view's query plan."""
    if not plan:
        print(f"Could not get plan for {view_name}")
        return
    
    execution_time = plan.get('Execution Time', 0)
    planning_time = plan.get('Planning Time', 0)
    
    print(f"\n{'='*80}")
    print(f"VIEW: {view_name}")
    print(f"{'='*80}")
    print(f"Execution Time: {execution_time:.2f} ms")
    print(f"Planning Time: {planning_time:.2f} ms")
    print(f"Total Time: {execution_time + planning_time:.2f} ms")
    
    slow_ops = extract_slow_operations(plan, threshold_ms=50)
    
    if slow_ops:
        print(f"\nSLOW OPERATIONS (>50ms):")
        print("-" * 80)
        slow_ops.sort(key=lambda x: x['time_ms'], reverse=True)
        for op in slow_ops[:10]:  # Top 10
            indent = "  " * op['depth']
            print(f"{indent}{op['node_type']}: {op['time_ms']:.2f}ms "
                  f"({op['rows']} rows, {op['loops']} loops)")
            if op['relation']:
                print(f"{indent}  Relation: {op['relation']}")
    else:
        print("\nNo operations taking >50ms individually")
    
    # Check for sequential scans
    def find_seq_scans(node, scans=[]):
        if not isinstance(node, dict):
            return scans
        if node.get('Node Type') == 'Seq Scan':
            scans.append({
                'relation': node.get('Relation Name', ''),
                'rows': node.get('Actual Rows', 0),
                'time': node.get('Actual Total Time', 0) * 1000
            })
        if 'Plans' in node:
            for child in node['Plans']:
                find_seq_scans(child, scans)
        return scans
    
    seq_scans = find_seq_scans(plan.get('Plan', {}))
    if seq_scans:
        print(f"\nSEQUENTIAL SCANS:")
        print("-" * 80)
        for scan in seq_scans:
            print(f"  {scan['relation']}: {scan['rows']} rows, {scan['time']:.2f}ms")

def main():
    slow_views = [
        'accessible_uploads_groups',
        'accessible_groups'
    ]
    
    print("="*80)
    print("ANALYZING SLOW VIEWS")
    print("="*80)
    
    for view_name in slow_views:
        plan = analyze_view_plan(db, view_name)
        print_analysis(view_name, plan)
    
    print("\n" + "="*80)
    print("ANALYSIS COMPLETE")
    print("="*80)

if __name__ == '__main__':
    main()

