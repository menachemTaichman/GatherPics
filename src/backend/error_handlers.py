from flask import jsonify, request, current_app
from flask_jwt_extended import get_jwt_identity
from flask_jwt_extended.exceptions import JWTDecodeError, InvalidHeaderError, NoAuthorizationError
from pydantic import ValidationError
import traceback
import logging
import re

from src.core.errors import Forbidden, DatabaseError, PolicyError, sanitize_sensitive_data, log_error


def clean_postgres_error(error_message: str) -> str:
    """Remove CONTEXT and SQL statement details from PostgreSQL error messages."""
    if "\nCONTEXT:" in error_message:
        return error_message.split("\nCONTEXT:")[0].strip()
    return error_message


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
            error_id = log_error(str(error), "Forbidden", traceback_str)
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
            error_id = log_error(str(error), "DatabaseError", traceback_str)
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
            error_id = log_error(str(error), "PolicyError", traceback_str)
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
        error_id = log_error(error_msg, "JWTDecodeError", None)
        response = {"error": error_msg}
        if error_id:
            response["error_id"] = error_id
        return jsonify(response), 401

    @app.errorhandler(InvalidHeaderError)
    def handle_invalid_header_error(error):
        error_msg = "Invalid authorization header"
        error_id = log_error(error_msg, "InvalidHeaderError", None)
        response = {"error": error_msg}
        if error_id:
            response["error_id"] = error_id
        return jsonify(response), 401

    @app.errorhandler(NoAuthorizationError)
    def handle_no_authorization_error(error):
        error_msg = "Missing authorization token"
        error_id = log_error(error_msg, "NoAuthorizationError", None)
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
            error_id = log_error(str(error), "Exception", traceback_str)
            
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

