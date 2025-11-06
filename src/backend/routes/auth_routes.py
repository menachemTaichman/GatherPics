from flask import Blueprint, jsonify, request, make_response
from flask_jwt_extended import (
    create_access_token,
    set_access_cookies,
    unset_jwt_cookies,
)
from datetime import timedelta, datetime, timezone
import secrets
import traceback

from src.backend.helpers import get_event, get_general_models

auth_bp = Blueprint('auth', __name__, url_prefix='/api')

def create_refresh_token_for_profile(profile_id: str, expires_days: int = 30):
    """Create and store a refresh token for a profile."""
    general_models = get_general_models()
    refresh_token_db = secrets.token_urlsafe(32)
    
    # Set refresh token expiry
    expires_at = datetime.now(timezone.utc) + timedelta(days=expires_days)
    
    # Get request metadata
    user_agent = request.headers.get('User-Agent', '')
    ip_address = request.remote_addr
    
    # Store refresh token in database
    general_models.create_refresh_token(
        profile_id=profile_id,
        token=refresh_token_db,
        expires_at=expires_at.isoformat(),
        user_agent=user_agent,
        ip_address=ip_address
    )
    
    return refresh_token_db, expires_at

def create_auth_response(access_token: str, profile_id: str, expires_days: int = 30):
    """Create authentication response with access token and refresh token cookie."""
    
    # Create refresh token using shared method
    refresh_token_db, expires_at = create_refresh_token_for_profile(profile_id, expires_days)
    
    # Create response
    response = make_response(jsonify({
        "access_token": access_token,
        "profile_id": profile_id
    }))
    
    # Set access token as cookie for image requests
    set_access_cookies(response, access_token)
    
    # Set refresh token as httpOnly cookie
    response.set_cookie(
        'refresh_token',
        refresh_token_db,
        httponly=True,
        secure=False,  # True in production
        samesite='Lax',
        max_age=expires_days * 24 * 60 * 60  # Convert days to seconds
    )
    
    return response

@auth_bp.route("/auth/login", methods=["POST"])
def login():
    """Authenticate user and issue access + refresh tokens."""
    data = request.json or {}
    label = data.get('label', '').strip()
    password = data.get('password', '')
    
    if not label:
        return jsonify({"error": "Profile label is required"}), 400
    
    try:
        general_models = get_general_models()
        
        # Authenticate profile
        profile_id = general_models.authenticate_profile(label, password)
        if not profile_id:
            return jsonify({"error": "Invalid credentials"}), 401
        
        # Get profile details
        # Create access token
        access_token = create_access_token(identity=profile_id)
        
        # Create authentication response
        return create_auth_response(access_token, profile_id, expires_days=30)
        
    except Exception as e:
        print(f"Login error: {e}")
        traceback.print_exc()
        return jsonify({"error": "Authentication failed"}), 500

@auth_bp.route("/auth/refresh", methods=["POST"])
def refresh():
    """Exchange refresh token for new access token."""
    refresh_token = request.cookies.get('refresh_token')
    
    if not refresh_token:
        return jsonify({"error": "Refresh token not found"}), 401
    
    try:
        general_models = get_general_models()
        
        # Validate refresh token
        profile_id = general_models.validate_refresh_token(refresh_token)
        
        if not profile_id:
            return jsonify({"error": "Invalid or expired refresh token"}), 401
        
        # Create new access token
        access_token = create_access_token(identity=profile_id)
        
        # Create response and set access token cookie
        response = make_response(jsonify({
            "access_token": access_token
        }))
        
        set_access_cookies(response, access_token)
        
        return response
        
    except Exception as e:
        print(f"Refresh error: {e}")
        traceback.print_exc()
        return jsonify({"error": "Token refresh failed"}), 500

@auth_bp.route("/auth/logout", methods=["POST"])
def logout():
    """Logout user and revoke refresh token."""
    refresh_token = request.cookies.get('refresh_token')
    
    if refresh_token:
        try:
            general_models = get_general_models()
            general_models.revoke_refresh_token(refresh_token)
        except Exception as e:
            print(f"Logout error: {e}")
    
    response = make_response(jsonify({"message": "Logout successful"}))
    
    # Clear JWT cookies (access token)
    unset_jwt_cookies(response)
    
    # Clear refresh token cookie
    response.set_cookie(
        'refresh_token',
        '',
        httponly=True,
        secure=False,
        samesite='Lax',
        max_age=0
    )
    
    return response

@auth_bp.route("/events/<event_id>/public-access/<public_code>", methods=["POST"])
def authenticate_public_access(event_id, public_code):
    """Authenticate using public access code and return refresh token."""
    try:
        event = get_event(event_id, public_code=public_code)

        profile_id = event.profile_context['profile_id']
        
        # Create access token
        access_token = create_access_token(identity=profile_id, expires_delta=timedelta(hours=1))
        
        return create_auth_response(access_token, profile_id)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

