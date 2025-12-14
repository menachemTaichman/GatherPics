"""
Singleton Redis client for tracking upload progress.
Uses Redis Sets and keys for atomic operations to track image processing state.
"""

import os
from typing import Optional
import redis
from redis.exceptions import ConnectionError, RedisError

# Load environment variables from .env file if it exists (development only)
if os.path.exists('.env'):
    from dotenv import load_dotenv
    load_dotenv()

# Get Redis connection parameters from environment
REDIS_HOST = os.getenv('REDIS_HOST', 'redis')
REDIS_PORT = int(os.getenv('REDIS_PORT', '6379'))
REDIS_DB = int(os.getenv('REDIS_DB', '0'))
REDIS_PASSWORD = os.getenv('REDIS_PASSWORD', None)

# Singleton Redis client instance
_redis_client: Optional[redis.Redis] = None


def get_redis_client() -> redis.Redis:
    """
    Get or create the singleton Redis client instance.
    
    Returns:
        redis.Redis: Redis client instance
        
    Raises:
        ConnectionError: If unable to connect to Redis
    """
    global _redis_client
    
    if _redis_client is None:
        try:
            _redis_client = redis.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                db=REDIS_DB,
                password=REDIS_PASSWORD,
                decode_responses=True,  # Automatically decode responses to strings
                socket_connect_timeout=5,
                socket_timeout=5,
                retry_on_timeout=True,
                health_check_interval=30
            )
            # Test connection
            _redis_client.ping()
        except (ConnectionError, RedisError) as e:
            raise ConnectionError(f"Failed to connect to Redis at {REDIS_HOST}:{REDIS_PORT}: {str(e)}")
    
    return _redis_client


def reset_redis_client() -> None:
    """
    Reset the singleton Redis client (useful for testing).
    """
    global _redis_client
    _redis_client = None

