"""
Email service infrastructure.

Provides an abstraction layer for sending emails that works in both
development (prints emails) and production (uses AWS SES).

Usage:
    # Simple usage with convenience function
    from src.core.services.email import send_email
    
    send_email(
        to='user@example.com',
        subject='Welcome!',
        body_text='Welcome to our service',
        body_html='<h1>Welcome</h1><p>Welcome to our service</p>'
    )
    
    # Advanced usage with service instance
    from src.core.services.email import get_email_service, EmailMessage
    
    service = get_email_service()
    message = EmailMessage(
        to=['user1@example.com', 'user2@example.com'],
        subject='Notification',
        body_html='<p>Your notification</p>',
        cc=['manager@example.com']
    )
    result = service.send_email(message)

Environment Variables:
    - ENVIRONMENT: Set to 'PRODUCTION' for AWS SES, defaults to 'DEVELOPMENT'
    - EMAIL_FROM: Default sender email address (required in production)
    - AWS_ACCESS_KEY_ID: AWS access key (required in production)
    - AWS_SECRET_ACCESS_KEY: AWS secret key (required in production)
    - AWS_REGION: AWS region (defaults to 'us-east-1')
"""
import os
import traceback
from abc import ABC, abstractmethod
from typing import List, Optional
from dataclasses import dataclass

# Load environment variables from .env file if it exists (development only)
# In production (AWS), environment variables are already set
if os.path.exists('.env'):
    from dotenv import load_dotenv
    load_dotenv()


@dataclass
class EmailMessage:
    """Represents an email message."""
    to: str | List[str]
    subject: str
    body_text: Optional[str] = None
    body_html: Optional[str] = None
    from_email: Optional[str] = None
    reply_to: Optional[str] = None
    cc: Optional[List[str]] = None
    bcc: Optional[List[str]] = None


class EmailService(ABC):
    """Abstract base class for email services."""
    
    @abstractmethod
    def send_email(self, message: EmailMessage) -> dict:
        """
        Send an email message.
        
        Args:
            message: EmailMessage object containing email details
            
        Returns:
            dict: Response containing status and message_id (if applicable)
            
        Raises:
            Exception: If email sending fails
        """
        pass


class DevEmailService(EmailService):
    """Development email service that prints emails instead of sending them."""
    
    def __init__(self):
        self.default_from = os.getenv('EMAIL_FROM', 'noreply@example.com')
    
    def send_email(self, message: EmailMessage) -> dict:
        """
        Print email details to console instead of sending.
        
        Args:
            message: EmailMessage object containing email details
            
        Returns:
            dict: Response with status 'printed' and a message_id
        """
        from_email = message.from_email or self.default_from
        
        # Format recipients
        to_list = message.to if isinstance(message.to, list) else [message.to]
        recipients = ', '.join(to_list)
        
        # Build email details string
        email_details = [
            "=" * 80,
            "EMAIL (DEV MODE - NOT SENT)",
            "=" * 80,
            f"From: {from_email}",
            f"To: {recipients}",
        ]
        
        if message.reply_to:
            email_details.append(f"Reply-To: {message.reply_to}")
        if message.cc:
            email_details.append(f"CC: {', '.join(message.cc)}")
        if message.bcc:
            email_details.append(f"BCC: {', '.join(message.bcc)}")
        
        email_details.extend([
            f"Subject: {message.subject}",
            "-" * 80,
        ])
        
        if message.body_html:
            email_details.append("Body (HTML):")
            email_details.append(message.body_html)
        elif message.body_text:
            email_details.append("Body (Text):")
            email_details.append(message.body_text)
        else:
            email_details.append("Body: (empty)")
        
        email_details.append("=" * 80)
        
        # Print to console
        print("\n".join(email_details))
        
        return {
            'status': 'printed',
            'message_id': f'dev-{hash(str(message))}',
            'from': from_email,
            'to': recipients
        }


class ProdEmailService(EmailService):
    """Production email service using AWS SES."""
    
    def __init__(self):
        # Load AWS credentials from environment
        aws_access_key_id = os.getenv('AWS_ACCESS_KEY_ID')
        aws_secret_access_key = os.getenv('AWS_SECRET_ACCESS_KEY')
        aws_region = os.getenv('AWS_REGION', 'us-east-1')
        
        if not aws_access_key_id or not aws_secret_access_key:
            raise ValueError(
                "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set "
                "for production email service"
            )
        
        import boto3
        self.ses_client = boto3.client(
            'ses',
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
            region_name=aws_region
        )
        
        self.default_from = os.getenv('EMAIL_FROM')
        if not self.default_from:
            raise ValueError(
                "EMAIL_FROM environment variable must be set "
                "for production email service"
            )
    
    def send_email(self, message: EmailMessage) -> dict:
        """
        Send email using AWS SES.
        
        Args:
            message: EmailMessage object containing email details
            
        Returns:
            dict: Response containing status and message_id from SES
            
        Raises:
            Exception: If email sending fails
        """
        from_email = message.from_email or self.default_from
        
        # Prepare destination
        to_addresses = message.to if isinstance(message.to, list) else [message.to]
        destination = {'ToAddresses': to_addresses}
        
        if message.cc:
            destination['CcAddresses'] = message.cc
        if message.bcc:
            destination['BccAddresses'] = message.bcc
        
        # Prepare message body
        body = {}
        if message.body_html:
            body['Html'] = {'Data': message.body_html, 'Charset': 'UTF-8'}
        if message.body_text:
            body['Text'] = {'Data': message.body_text, 'Charset': 'UTF-8'}
        
        if not body:
            raise ValueError("Email must have either body_text or body_html")
        
        # Prepare email parameters
        email_params = {
            'Source': from_email,
            'Destination': destination,
            'Message': {
                'Subject': {'Data': message.subject, 'Charset': 'UTF-8'},
                'Body': body
            }
        }
        
        if message.reply_to:
            email_params['ReplyToAddresses'] = [message.reply_to]
        
        # Send email via SES
        response = self.ses_client.send_email(**email_params)
        
        return {
            'status': 'sent',
            'message_id': response['MessageId'],
            'from': from_email,
            'to': ', '.join(to_addresses)
        }


def get_email_service() -> EmailService:
    """
    Factory function to get the appropriate email service based on environment.
    
    Returns:
        EmailService: DevEmailService in development, ProdEmailService in production
    """
    environment = os.getenv('ENVIRONMENT', 'DEVELOPMENT')
    
    if environment == 'PRODUCTION':
        return ProdEmailService()
    else:
        return DevEmailService()


# Convenience function for easy usage
def send_email(
    to: str | List[str],
    subject: str,
    body_text: Optional[str] = None,
    body_html: Optional[str] = None,
    from_email: Optional[str] = None,
    reply_to: Optional[str] = None,
    cc: Optional[List[str]] = None,
    bcc: Optional[List[str]] = None
) -> dict:
    """
    Convenience function to send an email.
    
    Errors are automatically logged to the database and do not raise exceptions.
    
    Args:
        to: Recipient email address(es)
        subject: Email subject
        body_text: Plain text body (optional if body_html is provided)
        body_html: HTML body (optional if body_text is provided)
        from_email: Sender email (uses EMAIL_FROM env var if not provided)
        reply_to: Reply-to email address
        cc: CC recipients
        bcc: BCC recipients
        
    Returns:
        dict: Response containing status and message_id, or None if sending failed
        
    Example:
        >>> send_email(
        ...     to='user@example.com',
        ...     subject='Welcome!',
        ...     body_text='Welcome to our service',
        ...     body_html='<h1>Welcome to our service</h1>'
        ... )
    """
    message = EmailMessage(
        to=to,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        from_email=from_email,
        reply_to=reply_to,
        cc=cc,
        bcc=bcc
    )
    
    try:
        service = get_email_service()
        return service.send_email(message)
    except Exception as e:
        # Log error to database but don't raise exception
        try:
            from src.core.errors import log_error
            log_error(
                error_message=f"Failed to send email: {str(e)}",
                error_type="EmailError",
                traceback_str=traceback.format_exc()
            )
        except Exception as log_error_exception:
            # If logging itself fails, just print
            print(f"Failed to send email and log error: {str(e)} (logging error: {str(log_error_exception)})")
        
        return None

