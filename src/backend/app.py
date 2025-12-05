from flask import Flask, send_file, abort
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from datetime import timedelta
import os

# Load environment variables from .env file if it exists (development only)
# In production (AWS), environment variables are already set
if os.path.exists('.env'):
    from dotenv import load_dotenv
    load_dotenv()

DIST_DIR = os.getenv('DIST_DIR')
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
# Set debug mode from environment variable (defaults to True for development)
app.config['DEBUG'] = os.getenv('ENVIRONMENT', 'DEVELOPMENT') != 'PRODUCTION'
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

# Register error handlers
from src.backend.error_handlers import register_error_handlers
register_error_handlers(app)

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
    app.run(debug=app.config['DEBUG'])

