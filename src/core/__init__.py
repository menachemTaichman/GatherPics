"""
Core module - Framework-agnostic business logic and data layer.

This module contains all domain models, database operations, business logic,
and utility functions. It is independent of any web framework and can be
used by Flask, CLI tools, background workers, or any other Python code.
"""

import os

# Load environment variables from .env file if it exists (development only)
# In production (AWS), environment variables are already set
if os.path.exists('.env'):
    from dotenv import load_dotenv
    load_dotenv()

from src.core.errors import Forbidden, DatabaseError, PolicyError

DATA_ROOT = os.getenv('DATA_ROOT', os.path.abspath(os.path.join(os.path.dirname(__file__), '../../data')))

__all__ = [
    'DATA_ROOT',
    'Forbidden',
    'DatabaseError', 
    'PolicyError',
]

