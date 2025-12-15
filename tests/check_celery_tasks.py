#!/usr/bin/env python3
"""
Script to check for tasks in progress or waiting in Redis-Celery queue.
Shows active, reserved, and scheduled tasks.
"""

import os
import sys
from datetime import datetime

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Load environment variables
if os.path.exists('.env'):
    from dotenv import load_dotenv
    load_dotenv()

from src.backend.celery_worker import celery


def format_timestamp(ts):
    """Format timestamp for display."""
    if ts:
        try:
            return datetime.fromtimestamp(ts).strftime('%Y-%m-%d %H:%M:%S')
        except:
            return str(ts)
    return 'N/A'


def check_celery_tasks():
    """Check for tasks in progress or waiting in Celery queue."""
    print("=" * 80)
    print("Celery Task Queue Status")
    print("=" * 80)
    print()
    
    # Get Celery inspect object
    inspect = celery.control.inspect()
    
    # Check active tasks (tasks currently being executed)
    print("📊 ACTIVE TASKS (Currently Executing):")
    print("-" * 80)
    active = inspect.active()
    if active:
        total_active = 0
        for worker, tasks in active.items():
            print(f"\n  Worker: {worker}")
            for task in tasks:
                total_active += 1
                print(f"    • Task ID: {task.get('id', 'N/A')}")
                print(f"      Name: {task.get('name', 'N/A')}")
                print(f"      Args: {task.get('args', [])}")
                print(f"      Started: {format_timestamp(task.get('time_start', None))}")
                print(f"      Worker PID: {task.get('worker_pid', 'N/A')}")
        print(f"\n  Total Active Tasks: {total_active}")
    else:
        print("  No active tasks")
    print()
    
    # Check reserved tasks (tasks waiting to be executed)
    print("⏳ RESERVED TASKS (Waiting in Queue):")
    print("-" * 80)
    reserved = inspect.reserved()
    if reserved:
        total_reserved = 0
        for worker, tasks in reserved.items():
            print(f"\n  Worker: {worker}")
            for task in tasks:
                total_reserved += 1
                print(f"    • Task ID: {task.get('id', 'N/A')}")
                print(f"      Name: {task.get('name', 'N/A')}")
                print(f"      Args: {task.get('args', [])}")
        print(f"\n  Total Reserved Tasks: {total_reserved}")
    else:
        print("  No reserved tasks")
    print()
    
    # Check scheduled tasks (tasks scheduled for future execution)
    print("📅 SCHEDULED TASKS (Scheduled for Future):")
    print("-" * 80)
    scheduled = inspect.scheduled()
    if scheduled:
        total_scheduled = 0
        for worker, tasks in scheduled.items():
            print(f"\n  Worker: {worker}")
            for task in tasks:
                total_scheduled += 1
                print(f"    • Task ID: {task.get('request', {}).get('id', 'N/A')}")
                print(f"      Name: {task.get('request', {}).get('task', 'N/A')}")
                print(f"      ETA: {format_timestamp(task.get('eta', None))}")
        print(f"\n  Total Scheduled Tasks: {total_scheduled}")
    else:
        print("  No scheduled tasks")
    print()
    
    # Check registered tasks
    print("📋 REGISTERED TASKS:")
    print("-" * 80)
    registered = inspect.registered()
    if registered:
        for worker, tasks in registered.items():
            print(f"\n  Worker: {worker}")
            print(f"    Registered task names: {', '.join(sorted(tasks))}")
    else:
        print("  No workers found or unable to connect")
    print()
    
    # Summary
    print("=" * 80)
    print("SUMMARY:")
    print("-" * 80)
    total_active = sum(len(tasks) for tasks in active.values()) if active else 0
    total_reserved = sum(len(tasks) for tasks in reserved.values()) if reserved else 0
    total_scheduled = sum(len(tasks) for tasks in scheduled.values()) if scheduled else 0
    
    print(f"  Active Tasks:    {total_active}")
    print(f"  Reserved Tasks:  {total_reserved}")
    print(f"  Scheduled Tasks: {total_scheduled}")
    print(f"  Total Pending:   {total_active + total_reserved + total_scheduled}")
    print("=" * 80)
    
    if total_active + total_reserved + total_scheduled == 0:
        print("\n✅ No tasks in progress or waiting!")
    else:
        print(f"\n⚠️  Found {total_active + total_reserved + total_scheduled} task(s) in queue")


if __name__ == '__main__':
    try:
        check_celery_tasks()
    except Exception as e:
        print(f"❌ Error checking Celery tasks: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

