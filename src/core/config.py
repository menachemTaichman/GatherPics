"""
Core configuration settings.
Single source of truth for paths and constants shared across the core module.
"""
import os

# Root directory for all event data and databases
DATA_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../data'))

# AWS configuration file path
AWS_CONFIG_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../config/aws_config.json'))

# Frontend build directory path
DIST_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../dist'))

