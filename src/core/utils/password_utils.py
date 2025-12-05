"""
Password hashing and verification utilities.
Uses Werkzeug's secure password hashing functions.
"""
from werkzeug.security import generate_password_hash, check_password_hash


def hash_password(password: str) -> str:
    """Hash a password using Werkzeug's secure hashing algorithm.
    
    Args:
        password: Plain text password to hash
        
    Returns:
        Hashed password string
    """
    return generate_password_hash(password)


def verify_password(hashed_password: str, password: str) -> bool:
    """Verify a password against a hash.
    
    Args:
        hashed_password: The hashed password from the database
        password: Plain text password to verify
        
    Returns:
        True if password matches, False otherwise
    """
    if not hashed_password or not password:
        return False
    return check_password_hash(hashed_password, password)

