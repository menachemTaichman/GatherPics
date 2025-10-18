
class Forbidden(Exception):
    """Exception raised for forbidden access."""
    pass

class DBConstant(Exception):
    """Exception raised for database constant error."""
    pass

class DatabaseError(Exception):
    """General database error."""
    pass
