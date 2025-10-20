"""
Core module - Framework-agnostic business logic and data layer.

This module contains all domain models, database operations, business logic,
and utility functions. It is independent of any web framework and can be
used by Flask, CLI tools, background workers, or any other Python code.
"""

from src.core.config import DATA_ROOT
from src.core.errors import Forbidden, DatabaseError, DBConstant

__all__ = [
    'DATA_ROOT',
    'Forbidden',
    'DatabaseError', 
    'DBConstant',
]

