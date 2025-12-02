from flask import Flask, jsonify, send_file, abort
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_jwt_extended.exceptions import JWTDecodeError, InvalidHeaderError, NoAuthorizationError
from datetime import timedelta
import traceback
import os
import logging

# Load environment variables from .env file if it exists (development only)
# In production (AWS), environment variables are already set
if os.path.exists('.env'):
    from dotenv import load_dotenv
    load_dotenv()

DIST_DIR = os.getenv('DIST_DIR', os.path.abspath(os.path.join(os.path.dirname(__file__), '../../dist')))
from src.core.errors import Forbidden, DatabaseError, DBPolicyError
from src.backend.routes import (
    auth_bp,
    image_bp,
    group_bp,
    moment_bp,
    album_bp,
    profile_bp,
    upload_bp,
    file_bp,
    request_bp,
    notification_bp,
    event_bp,
    feedback_bp,
    settings_bp,
)

app = Flask(__name__)
CORS(app, origins="*", supports_credentials=True)

# JWT Configuration
app.config['JWT_SECRET_KEY'] = 'your-secret-key-change-in-production'
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(minutes=15)
app.config['JWT_REFRESH_TOKEN_EXPIRES'] = timedelta(days=30)
app.config['JWT_TOKEN_LOCATION'] = ['headers', 'cookies']
app.config['JWT_COOKIE_SAMESITE'] = 'Lax'
app.config['JWT_COOKIE_SECURE'] = False  # True in production over HTTPS
app.config['JWT_COOKIE_CSRF_PROTECT'] = False  # Simplify for now
jwt = JWTManager(app)

# Register blueprints
app.register_blueprint(auth_bp)
app.register_blueprint(image_bp)
app.register_blueprint(group_bp)
app.register_blueprint(moment_bp)
app.register_blueprint(album_bp)
app.register_blueprint(profile_bp)
app.register_blueprint(upload_bp)
app.register_blueprint(file_bp)
app.register_blueprint(request_bp)
app.register_blueprint(notification_bp)
app.register_blueprint(event_bp)
app.register_blueprint(feedback_bp)
app.register_blueprint(settings_bp)

# Error Handlers
@app.errorhandler(400)
def bad_request(error):
    return jsonify({"error": "Bad Request", "message": str(error)}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not Found", "message": str(error)}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal Server Error", "message": str(error), "trace": traceback.format_exc()}), 500

@app.errorhandler(403)
def forbidden(error):
    return jsonify({"error": "Forbidden", "message": str(error)}), 403

# Exception handlers for custom exceptions
@app.errorhandler(Forbidden)
def handle_forbidden(error):
    return jsonify({"error": str(error)}), 403

@app.errorhandler(DatabaseError)
def handle_database_error(error):
    return jsonify({"error": str(error)}), 500

@app.errorhandler(DBPolicyError)
def handle_db_policy_error(error):
    return jsonify({"error": str(error)}), 400

# JWT Error Handlers
@app.errorhandler(JWTDecodeError)
def handle_jwt_decode_error(error):
    return jsonify({"error": "Invalid token"}), 401

@app.errorhandler(InvalidHeaderError)
def handle_invalid_header_error(error):
    return jsonify({"error": "Invalid authorization header"}), 401

@app.errorhandler(NoAuthorizationError)
def handle_no_authorization_error(error):
    return jsonify({"error": "Missing authorization token"}), 401

# General Exception Handler - catches all unhandled exceptions
@app.errorhandler(Exception)
def handle_general_exception(error):
    """Catch-all exception handler for any unhandled exceptions."""
    # Log the full traceback for debugging
    logging.error(f"Unhandled exception: {error}", exc_info=True)
    
    # Don't expose internal error details in production
    error_message = str(error) if app.debug else "An unexpected error occurred"
    
    return jsonify({"error": error_message}), 500

# Production build serving
@app.route('/assets/<path:filename>')
def serve_assets(filename):
    """Serve static assets from dist/assets/ folder"""
    return send_file(os.path.join(DIST_DIR, 'assets', filename))

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_production(path):
    """Serve the production build - catch-all for client-side routing"""
    if path.startswith('api/'):
        abort(404)
    
    file_path = os.path.join(DIST_DIR, path)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return send_file(file_path)
    
    return send_file(os.path.join(DIST_DIR, 'index.html'))

if __name__ == "__main__":
    app.run(debug=True)

