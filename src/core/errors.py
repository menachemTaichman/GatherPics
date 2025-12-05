import logging
import re
from typing import Optional


class Forbidden(Exception):
    """Exception raised for forbidden access."""
    pass

class PolicyError(Exception):
    """Exception raised for database policy error."""
    pass

class DatabaseError(Exception):
    """General database error."""
    pass


def sanitize_sensitive_data(text: str) -> str:
    """Remove sensitive information (emails and passwords) from error messages and tracebacks.
    
    This function is designed to never raise exceptions - if sanitization fails,
    it returns the original text to ensure error handlers always work.
    
    Args:
        text: The text to sanitize
        
    Returns:
        Sanitized text with sensitive data replaced with [REDACTED], or original text if sanitization fails
    """
    if not text:
        return text
    
    try:
        # Pattern to match email addresses
        email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
        
        # Replace emails
        text = re.sub(email_pattern, '[REDACTED_EMAIL]', text)
        
        # Pattern 1: Match password fields with quotes and separators like "password": "value" or password=value
        # This pattern has 3 groups: (prefix)(value)(suffix)
        pattern1 = r'(?i)(["\']?password["\']?\s*[:=]\s*["\']?)([^"\'\s,}]+)(["\']?)'
        text = re.sub(pattern1, r'\1[REDACTED_PASSWORD]\3', text)
        
        # Pattern 2: Match password followed by space and value like "password value"
        # This pattern has 2 groups: (prefix)(value)
        pattern2 = r'(?i)(password\s+)([^\s,}]+)'
        text = re.sub(pattern2, r'\1[REDACTED_PASSWORD]', text)
        
        return text
    except Exception as e:
        # If sanitization fails for any reason, log it but return original text
        # This ensures error handlers never crash due to sanitization issues
        logging.warning(f"Sanitization failed, returning original text: {e}")
        return text


def log_error(
    error_message: str,
    error_type: str,
    traceback_str: Optional[str] = None,
    profile_id: Optional[str] = None,
    event_id: Optional[str] = None,
    request_path: Optional[str] = None,
    request_method: Optional[str] = None,
    user_agent: Optional[str] = None,
    ip_address: Optional[str] = None,
    debug_mode: bool = False
) -> Optional[int]:
    """Log error to database errors table.
    
    Core logging function that works without Flask request context.
    All context parameters are optional and can be provided explicitly.
    
    Args:
        error_message: The error message to log
        error_type: Type of error (e.g., "EmailError", "DatabaseError")
        traceback_str: Optional traceback string
        profile_id: Optional profile ID associated with the error
        event_id: Optional event ID associated with the error
        request_path: Optional request path
        request_method: Optional HTTP method
        user_agent: Optional user agent string
        ip_address: Optional IP address
        debug_mode: Whether to log to application logs (default: False)
        
    Returns:
        error_id if successfully logged, None otherwise
    """
    # Sanitize sensitive data before logging
    sanitized_error_message = sanitize_sensitive_data(error_message)
    sanitized_traceback = sanitize_sensitive_data(traceback_str) if traceback_str else None
    
    # Log to application logs if debug mode is enabled
    if debug_mode:
        log_msg = f"[{error_type}] {sanitized_error_message}"
        if sanitized_traceback:
            log_msg += f"\n{sanitized_traceback}"
        logging.error(log_msg)
    
    # Save to database
    try:
        from src.core.models.general_models import GeneralModels
        general_models = GeneralModels()
        
        error_data = {
            'error_type': error_type,
            'error_message': sanitized_error_message[:10000] if len(sanitized_error_message) > 10000 else sanitized_error_message,  # Limit message length
            'traceback': sanitized_traceback[:50000] if sanitized_traceback and len(sanitized_traceback) > 50000 else sanitized_traceback,  # Limit traceback length
            'profile_id': profile_id,
            'event_id': event_id,
            'request_path': request_path[:500] if request_path and len(request_path) > 500 else request_path,
            'request_method': request_method,
            'user_agent': user_agent[:1000] if user_agent and len(user_agent) > 1000 else user_agent,
            'ip_address': ip_address,
        }
        
        error_id = general_models.add('errors', error_data)
        return error_id
    except Exception as e:
        logging.error(f"Failed to log error to database: {e}", exc_info=True)
        return None
