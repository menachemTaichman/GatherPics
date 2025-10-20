"""
Core configuration settings.
Single source of truth for paths and constants shared across the core module.
"""
import os

# Root directory for all event data and databases
DATA_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../data'))

