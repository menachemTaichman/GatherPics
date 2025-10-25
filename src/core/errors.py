
class Forbidden(Exception):
    """Exception raised for forbidden access."""
    pass

class DBPolicyError(Exception):
    """Exception raised for database policy error."""
    pass

class DatabaseError(Exception):
    """General database error."""
    pass
