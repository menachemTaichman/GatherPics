"""
Audit log constants for tracking security and notable activities.

Actions are categorized by severity:
- Critical: Security-sensitive actions requiring immediate attention
- Warning: Important actions that may require review
- Info: Routine activities for general tracking
"""

import logging
from enum import Enum
from src.core.errors import log_error
import traceback

class AuditSeverity(str, Enum):
    """Severity levels for audit log entries."""
    CRITICAL = 'critical'
    WARNING = 'warning'
    INFO = 'info'


class AuditAction(str, Enum):
    """Audit log actions categorized by severity."""
    
    # Critical actions - Security-sensitive
    PROFILE_CHANGED_PASSWORD = 'profile_changed_password'
    PROFILE_RESET_PASSWORD_COMPLETED = 'profile_reset_password_completed'
    PROFILE_REQUESTED_PASSWORD_RESET = 'profile_requested_password_reset'
    PROFILE_DELETED = 'profile_deleted'
    
    # Warning actions - Important changes
    EVENT_DELETED = 'event_deleted'
    IMAGE_DELETED = 'image_deleted'
    
    # Info actions - Routine activities
    PROFILE_CREATED = 'profile_created'
    EVENT_CREATED = 'event_created'
    UPLOAD_MADE = 'upload_made'


# Map actions to their severity levels
ACTION_SEVERITY_MAP = {
    # Critical
    AuditAction.PROFILE_CHANGED_PASSWORD: AuditSeverity.CRITICAL,
    AuditAction.PROFILE_RESET_PASSWORD_COMPLETED: AuditSeverity.CRITICAL,
    AuditAction.PROFILE_REQUESTED_PASSWORD_RESET: AuditSeverity.CRITICAL,
    AuditAction.PROFILE_DELETED: AuditSeverity.CRITICAL,
    
    # Warning
    AuditAction.EVENT_DELETED: AuditSeverity.WARNING,
    AuditAction.IMAGE_DELETED: AuditSeverity.WARNING,
    
    # Info
    AuditAction.PROFILE_CREATED: AuditSeverity.INFO,
    AuditAction.EVENT_CREATED: AuditSeverity.INFO,
    AuditAction.UPLOAD_MADE: AuditSeverity.INFO,
}


def get_severity_for_action(action: str | AuditAction) -> str:
    """Get the severity level for a given action.
    
    Args:
        action: The action string or AuditAction enum
        
    Returns:
        The severity level as a string
    """
    # Handle both string and enum inputs
    action_enum = action if isinstance(action, AuditAction) else AuditAction(action)
    return ACTION_SEVERITY_MAP.get(action_enum, AuditSeverity.INFO).value


def log_audit(
    action: str | AuditAction,
    actor_profile_id: str | None = None,
    severity: str | AuditSeverity | None = None,
    ip_address: str | None = None,
    details: dict | None = None
) -> int | None:
    """
    Core audit logging function that auto-detects Flask request context if available.
    
    If Flask request context is available, it will be used to fill in missing parameters
    (actor_profile_id from JWT, ip_address from request).
    
    Args:
        action: Audit action (AuditAction enum or string)
        actor_profile_id: Profile ID performing the action (auto-detected from JWT if None and Flask context available)
        severity: Severity level (auto-detected if None)
        ip_address: IP address (auto-detected from Flask request if None and Flask context available)
        details: Optional JSON details dict
        
    Returns:
        audit_log_id if successfully logged, None otherwise
    """
    # Try to get Flask request context if available
    try:
        from flask import request, has_request_context
        from flask_jwt_extended import get_jwt_identity
        
        if has_request_context():
            # Auto-detect IP address if not provided
            if ip_address is None and request:
                ip_address = request.remote_addr
            
            # Auto-detect actor_profile_id from JWT if not provided
            if actor_profile_id is None:
                try:
                    actor_profile_id = get_jwt_identity()
                except:
                    pass  # Not authenticated or no JWT
    except ImportError:
        # Flask not available, use provided values
        pass
    except Exception:
        # Context detection failed, use provided values
        pass
    
    # Convert action to string if it's an enum
    action_str = action.value if isinstance(action, AuditAction) else action
    
    # Auto-detect severity if not provided
    if severity is None:
        severity_str = get_severity_for_action(action)
    else:
        severity_str = severity.value if isinstance(severity, AuditSeverity) else severity
    
    try:
        from src.core.models.general_models import GeneralModels
        general_models = GeneralModels(profile_id=actor_profile_id)
        
        audit_data = {
            'action': action_str,
            'severity': severity_str,
            'actor_profile_id': actor_profile_id,
            'ip_address': ip_address,
            'details': details or {},
        }
        
        audit_log_id = general_models.add('audit_logs', audit_data)
        return audit_log_id
    except Exception as e:
        log_error(f"Failed to log audit event to database: {e}", error_type="AuditError", traceback_str=traceback.format_exc())
        return None

