# Multi-stage build for Gather Pics
# Stage 1: Build frontend
FROM node:18-alpine AS frontend-builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Verify files exist and npm version, then install dependencies
RUN ls -la package*.json && npm --version && npm ci

# Copy frontend source
COPY vite.config.js ./
COPY tailwind.config.js ./
COPY postcss.config.js ./
COPY src/frontend ./src/frontend
COPY public ./public
COPY index.html ./

# Build frontend
RUN npm run build

# Stage 2: Python backend with built frontend
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    zlib1g-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libfreetype6-dev \
    liblcms2-dev \
    libwebp-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY src ./src
COPY migrations ./migrations

# Copy built frontend from previous stage
COPY --from=frontend-builder /app/dist ./dist

# Set environment variables for production
# Note: The following environment variables must be provided at runtime:
# - JWT_SECRET_KEY (required)
# - DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME (required for database)
# - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (if using AWS services)
# - AWS_REGION, S3_BUCKET_NAME (if using S3)
ENV S3_BUCKET=gather-pics-bucket
ENV ENVIRONMENT=PRODUCTION
ENV DIST_DIR=/app/dist
ENV FLASK_HOST=0.0.0.0
ENV FLASK_PORT=5000
ENV PYTHONUNBUFFERED=1

# Expose port
EXPOSE 5000

# Health check (optional - can be configured in ECS task definition)
# HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
#     CMD curl -f http://localhost:5000/ || exit 1

# Copy migration script
COPY migrate.sh ./migrate.sh
RUN chmod +x ./migrate.sh

# Run the application
# Increased timeout to handle long-running operations like image processing and ZIP downloads
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "--access-logfile", "-", "--error-logfile", "-", "--timeout", "120", "src.backend.app:app"]