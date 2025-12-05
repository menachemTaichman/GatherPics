from flask import jsonify, request, current_app
from flask_jwt_extended import get_jwt_identity
from flask_jwt_extended.exceptions import JWTDecodeError, InvalidHeaderError, NoAuthorizationError
from pydantic import ValidationError
import traceback
import logging
import re

from src.core.errors import Forbidden, DatabaseError, PolicyError


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


def clean_postgres_error(error_message: str) -> str:
    """Remove CONTEXT and SQL statement details from PostgreSQL error messages."""
    if "\nCONTEXT:" in error_message:
        return error_message.split("\nCONTEXT:")[0].strip()
    return error_message


def log_error_to_db(error_message: str, error_type: str, traceback_str: str = None):
    """Log error to database errors table.
    
    In non-production mode, logs errors to application logs with full context.
    error_message should be the original error (with CONTEXT from PostgreSQL).
    
    Returns the error_id if successfully logged, None otherwise.
    """
    # Sanitize sensitive data before logging
    sanitized_error_message = sanitize_sensitive_data(error_message)
    sanitized_traceback = sanitize_sensitive_data(traceback_str) if traceback_str else None
    
    # Log to application logs in non-production mode
    if current_app.debug:
        log_msg = f"[{error_type}] {sanitized_error_message}"
        if sanitized_traceback:
            log_msg += f"\n{sanitized_traceback}"
        logging.error(log_msg)
    
    # Save to database
    try:
        from src.backend.helpers import get_general_models
        
        # Get request information
        request_path = request.path if request else None
        request_method = request.method if request else None
        user_agent = request.headers.get('User-Agent') if request else None
        ip_address = request.remote_addr if request else None
        
        # Extract event_id from request path if available
        # Pattern: /api/events/<event_id>/... or /events/<event_id>/...
        event_id = None
        if request_path:
            # Try to extract event_id from URL pattern like /api/events/<uuid>/...
            match = re.search(r'/events/([a-f0-9-]{36})', request_path)
            if match:
                event_id = match.group(1)
        
        # Get current profile ID if available
        profile_id = None
        try:
            profile_id = get_jwt_identity()
        except:
            pass  # Not authenticated or no JWT
        
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
        
        general_models = get_general_models()
        error_id = general_models.add('errors', error_data)
        return error_id
    except Exception as e:
        logging.error(f"Failed to log error to database: {e}", exc_info=True)
        return None


def register_error_handlers(app):
    """Register all error handlers with the Flask app."""
    
    # HTTP Status Code Error Handlers
    @app.errorhandler(400)
    def bad_request(error):
        error_msg = sanitize_sensitive_data(str(error))
        return jsonify({"error": "Bad Request", "message": error_msg}), 400

    @app.errorhandler(404)
    def not_found(error):
        """Handle 404 errors (route not found or invalid URL parameter type)."""
        # Check if this might be a parameter validation error
        # Flask returns 404 when URL parameter type conversion fails (e.g., invalid UUID or int)
        return jsonify({
            "error": "Not Found",
            "message": "The requested resource was not found. This may be due to an invalid ID format in the URL."
        }), 404

    @app.errorhandler(500)
    def internal_error(error):
        error_msg = sanitize_sensitive_data(str(error))
        trace_str = sanitize_sensitive_data(traceback.format_exc())
        return jsonify({"error": "Internal Server Error", "message": error_msg, "trace": trace_str}), 500

    @app.errorhandler(403)
    def forbidden(error):
        error_msg = sanitize_sensitive_data(str(error))
        return jsonify({"error": "Forbidden", "message": error_msg}), 403

    # Exception handlers for custom exceptions
    @app.errorhandler(Forbidden)
    def handle_forbidden(error):
        try:
            error_msg = clean_postgres_error(str(error))
            error_msg = sanitize_sensitive_data(error_msg)  # Sanitize before sending to frontend
            traceback_str = traceback.format_exc() if app.debug else None
            error_id = log_error_to_db(str(error), "Forbidden", traceback_str)
            response = {"error": error_msg}
            if error_id:
                response["error_id"] = error_id
            return jsonify(response), 403
        except Exception as e:
            # If error handler itself fails, return a safe generic response
            logging.error(f"Error handler failed: {e}", exc_info=True)
            return jsonify({"error": "Forbidden"}), 403

    @app.errorhandler(DatabaseError)
    def handle_database_error(error):
        try:
            error_msg = clean_postgres_error(str(error))
            error_msg = sanitize_sensitive_data(error_msg)  # Sanitize before sending to frontend
            traceback_str = traceback.format_exc() if app.debug else None
            error_id = log_error_to_db(str(error), "DatabaseError", traceback_str)
            # Show generic message in production, detailed error in debug mode
            if not app.debug:
                error_msg = "An internal database error occurred"
            response = {"error": error_msg}
            if error_id:
                response["error_id"] = error_id
            return jsonify(response), 500
        except Exception as e:
            # If error handler itself fails, return a safe generic response
            logging.error(f"Error handler failed: {e}", exc_info=True)
            return jsonify({"error": "An internal database error occurred"}), 500

    @app.errorhandler(PolicyError)
    def handle_db_policy_error(error):
        try:
            error_msg = clean_postgres_error(str(error))
            error_msg = sanitize_sensitive_data(error_msg)  # Sanitize before sending to frontend
            traceback_str = traceback.format_exc() if app.debug else None
            error_id = log_error_to_db(str(error), "PolicyError", traceback_str)
            response = {"error": error_msg}
            if error_id:
                response["error_id"] = error_id
            return jsonify(response), 400
        except Exception as e:
            # If error handler itself fails, return a safe generic response
            logging.error(f"Error handler failed: {e}", exc_info=True)
            return jsonify({"error": "Database policy error"}), 400

    # Pydantic Validation Error Handler
    @app.errorhandler(ValidationError)
    def handle_validation_error(error):
        """Handle Pydantic validation errors and return clean JSON response."""
        # Since get_input() validates one field at a time, we typically get one error
        error_list = error.errors()
        if not error_list:
            return jsonify({"error": "Fields Validation failed"}), 400
        
        # Handle first error (most common case)
        err = error_list[0]
        field = '.'.join(str(loc) for loc in err['loc'])
        message = err['msg']
        error_type = err['type']
        
        # If there are multiple errors, include them all
        details = {
            'field': field,
            'message': message,
            'type': error_type
        }
        
        if len(error_list) > 1:
            details['additional_errors'] = [
                {
                    'field': '.'.join(str(loc) for loc in e['loc']),
                    'message': e['msg'],
                    'type': e['type']
                }
                for e in error_list[1:]
            ]
        
        return jsonify({
            "error": "Fields Validation failed",
            "details": details
        }), 400

    # JWT Error Handlers
    @app.errorhandler(JWTDecodeError)
    def handle_jwt_decode_error(error):
        error_msg = "Invalid token"
        error_id = log_error_to_db(error_msg, "JWTDecodeError", None)
        response = {"error": error_msg}
        if error_id:
            response["error_id"] = error_id
        return jsonify(response), 401

    @app.errorhandler(InvalidHeaderError)
    def handle_invalid_header_error(error):
        error_msg = "Invalid authorization header"
        error_id = log_error_to_db(error_msg, "InvalidHeaderError", None)
        response = {"error": error_msg}
        if error_id:
            response["error_id"] = error_id
        return jsonify(response), 401

    @app.errorhandler(NoAuthorizationError)
    def handle_no_authorization_error(error):
        error_msg = "Missing authorization token"
        error_id = log_error_to_db(error_msg, "NoAuthorizationError", None)
        response = {"error": error_msg}
        if error_id:
            response["error_id"] = error_id
        return jsonify(response), 401

    # General Exception Handler - catches all unhandled exceptions
    @app.errorhandler(Exception)
    def handle_general_exception(error):
        """Catch-all exception handler for any unhandled exceptions."""
        try:
            # Log the full traceback for debugging
            logging.error(f"Unhandled exception: {error}", exc_info=True)
            
            # Get full traceback
            traceback_str = traceback.format_exc()
            error_id = log_error_to_db(str(error), "Exception", traceback_str)
            
            # Don't expose internal error details in production
            error_message = str(error) if app.debug else "An unexpected error occurred"
            error_message = sanitize_sensitive_data(error_message)  # Sanitize before sending to frontend
            
            response = {"error": error_message}
            if error_id:
                response["error_id"] = error_id
            
            return jsonify(response), 500
        except Exception as e:
            # Last resort: if even the general exception handler fails, return minimal safe response
            logging.critical(f"Critical: General exception handler failed: {e}", exc_info=True)
            return jsonify({"error": "An unexpected error occurred"}), 500

