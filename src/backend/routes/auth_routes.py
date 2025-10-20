from flask import Blueprint, jsonify, request, make_response
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    set_access_cookies,
    unset_jwt_cookies,
)
from datetime import timedelta, datetime, timezone
import secrets
import traceback

from src.core.models.general_models import GeneralModels

auth_bp = Blueprint('auth', __name__, url_prefix='/api')

@auth_bp.route("/events", methods=["GET"])
def get_events():
    """Get all available events."""
    try:
        general_models = GeneralModels()
        events = general_models.get_entities('events')
        return jsonify(events)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@auth_bp.route("/events/resolve", methods=["GET"])
def resolve_event_url():
    """Resolve an event URL to its ID and basic info."""
    event_url = request.args.get('url')
    if not event_url:
        return jsonify({"error": "URL parameter is required"}), 400
    
    try:
        general_models = GeneralModels()
        event = general_models.get_event_by_url(event_url)
        
        if event:
            return jsonify({'event': event})
        else:
            return jsonify({"error": f"Event not found: {event_url}"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@auth_bp.route("/auth/login", methods=["POST"])
def login():
    """Authenticate user and issue access + refresh tokens."""
    data = request.json or {}
    label = data.get('label', '').strip()
    password = data.get('password', '')
    
    if not label:
        return jsonify({"error": "Profile label is required"}), 400
    
    try:
        general_models = GeneralModels()
        
        # Authenticate profile
        profile_id = general_models.authenticate_profile(label, password)
        
        if not profile_id:
            return jsonify({"error": "Invalid credentials"}), 401
        
        # Get profile details
        profile = general_models.get_entities('profiles', profile_id)
        
        # Create tokens
        access_token = create_access_token(identity=profile_id)
        refresh_token_jwt = create_refresh_token(identity=profile_id)
        
        # Generate secure random token for database
        refresh_token_db = secrets.token_urlsafe(32)
        
        # Store refresh token in database
        expires_at = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        
        # Get request metadata
        user_agent = request.headers.get('User-Agent', '')
        ip_address = request.remote_addr
        
        general_models.create_refresh_token(
            profile_id=profile_id,
            token=refresh_token_db,
            expires_at=expires_at,
            user_agent=user_agent,
            ip_address=ip_address
        )
        
        # Create response
        response = make_response(jsonify({
            "access_token": access_token,
            "profile": profile
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
            max_age=30 * 24 * 60 * 60  # 30 days in seconds
        )
        
        return response
        
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
        general_models = GeneralModels()
        
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
            general_models = GeneralModels()
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

