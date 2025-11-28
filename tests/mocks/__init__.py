"""
Mock services for development and testing.

This package provides mock implementations of external services
to enable development and testing without requiring actual service connections.
"""

from .mock_rekognition import MockRekognitionClient, get_mock_rekognition_client
from .distribution import DistributionManager

__all__ = ['MockRekognitionClient', 'get_mock_rekognition_client', 'DistributionManager']
