# Gather Pics - Professional Photo Gallery Platform

A modern, AI-powered photo gallery platform designed for professional photographers and photography businesses. Built with React, Flask, PostgreSQL, and AWS Rekognition to automatically organize event photos through intelligent face recognition.

## ✨ Features

### 🤖 Smart Face Recognition
- **AWS Rekognition Integration**: Automatically detects and identifies faces in uploaded photos
- **Person Grouping**: Organizes photos by individual, making specific guests easy to find
- **Smart Discovery**: Helps clients and guests find themselves and their loved ones effortlessly

### 🔒 Advanced Permission System
- **Granular Access Control**: Customize permissions at photo, album, and person levels
- **Identity Privacy**: Manage identity visibility independently of photo access
- **Database-Level Enforcement**: All permissions enforced strictly at the database level
- **Access Requests**: Allow guests to request access to specific people or content

### 📸 Event Management
- **Multiple Events**: Handle unlimited events and clients from a single dashboard
- **Flexible Organization**: Organize by Albums, Time-based Moments, or Face Groups
- **Timeline View**: Browse photos chronologically with moment-based organization
- **People View**: Browse and manage all detected faces across events

### 👥 Client Collaboration
- **Photo Selection**: Let event owners review and select their top picks
- **Custom Albums**: Give clients the freedom to create their own collections
- **Easy Downloads**: Simple, high-quality download options
- **Feedback System**: Built-in feedback and bug reporting system

### 🎨 Modern UI/UX
- **Responsive Design**: Works beautifully on desktop, tablet, and mobile
- **Internationalization**: Multi-language support (English, Hebrew)
- **Smooth Animations**: Beautiful transitions powered by Framer Motion
- **Accessibility**: WCAG 2.1 Level AA compliant with keyboard navigation and screen reader support

## 🚀 Quick Start

### Prerequisites
- Node.js (v18 or higher)
- Python (v3.11 or higher)
- PostgreSQL (v15 or higher)
- AWS Account with Rekognition access (for face recognition features)
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd face-recognition-website
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration:
   # - Database credentials
   # - AWS credentials
   # - JWT secret key
   # - Other environment-specific settings
   ```

3. **Install frontend dependencies**
   ```bash
   npm install
   ```

4. **Install backend dependencies**
   ```bash
   pip install -r requirements.txt
   ```

5. **Set up the database**
   ```bash
   # Using Docker Compose (recommended)
   docker-compose up -d db
   
   # Or use your own PostgreSQL instance
   # Then run migrations
   yoyo apply --database postgresql://user:pass@localhost/dbname ./migrations
   ```

### Running the Application

#### Option 1: Docker Compose (Recommended)
```bash
docker-compose up
```

#### Option 2: Development Mode

For local development, you'll run the backend, frontend, and worker locally, but use Docker for database and Redis.

1. **Start development services** (database and Redis only)
   ```bash
   docker-compose -f docker-compose.dev.yml up -d
   ```
   This starts:
   - PostgreSQL database on port 5432
   - Redis on port 6379

   **Note:** The worker is commented out in `docker-compose.dev.yml` by default. Run it locally instead (see step 4).

2. **Set up your `.env` file** - Make sure it includes:
   ```env
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_DB=0
   ```
   This is needed because your local backend/worker will connect to Redis running in Docker.

3. **Start the backend server** (in a new terminal)
   ```bash
   python -m src.backend.app
   ```
   The backend will run on http://localhost:5000

4. **Start the Celery worker** (in a new terminal) - **REQUIRED for image uploads**
   ```bash
   celery -A src.backend.celery_worker.celery worker --loglevel=info --concurrency=2
   ```
   This processes uploaded images (face detection, resizing, etc.). Without it, images will upload but won't be processed.

5. **Start the frontend server** (in a new terminal)
   ```bash
   npm run dev
   ```
   The frontend will run on http://localhost:5173

6. **Open your browser**
   Navigate to http://localhost:5173 to see the application

**Important:** All three processes (backend, worker, frontend) must be running for full functionality. The worker is especially critical for image processing.

#### Option 3: Production Build with Docker
```bash
docker build -t gather-pics .
docker run -p 5000:5000 gather-pics
```

## 📁 Project Structure

```
face-recognition-website/
├── src/
│   ├── backend/
│   │   ├── app.py                 # Flask application entry point
│   │   ├── routes/                # API route modules
│   │   │   ├── auth_routes.py     # Authentication endpoints
│   │   │   ├── event_routes.py   # Event management
│   │   │   ├── image_routes.py   # Image operations
│   │   │   ├── group_routes.py   # Face group management
│   │   │   ├── album_routes.py   # Album operations
│   │   │   ├── moment_routes.py  # Moment/timeline operations
│   │   │   ├── profile_routes.py # User profiles
│   │   │   ├── upload_routes.py  # File uploads
│   │   │   ├── request_routes.py # Access requests
│   │   │   ├── notification_routes.py
│   │   │   ├── feedback_routes.py
│   │   │   └── settings_routes.py
│   │   ├── middleware/            # Custom middleware
│   │   ├── helpers.py             # Utility functions
│   │   ├── validators.py          # Input validation
│   │   └── error_handlers.py      # Error handling
│   ├── frontend/
│   │   ├── components/            # React components
│   │   ├── pages/                 # Page components
│   │   │   ├── HomePage.jsx
│   │   │   ├── EventHomePage.jsx
│   │   │   ├── albums/
│   │   │   ├── groups/
│   │   │   ├── moments/
│   │   │   ├── dashboard/
│   │   │   └── ...
│   │   ├── config/                # App configuration
│   │   │   └── appConfig.js       # App name and settings
│   │   ├── contexts/              # React contexts
│   │   ├── hooks/                 # Custom React hooks
│   │   ├── utils/                 # Utility functions
│   │   ├── locales/               # i18n translations
│   │   ├── styles/                # Additional styles
│   │   ├── main.jsx               # Application entry point
│   │   ├── index.css              # Global styles
│   │   └── i18n.js                # i18n configuration
│   └── core/                      # Shared core modules
├── migrations/                    # Database migrations
├── public/                        # Static assets
│   └── content/                   # Markdown content (about, terms, etc.)
├── tests/                         # Test files
├── data/                          # Data files
├── docker-compose.yml             # Docker Compose configuration
├── Dockerfile                     # Production Docker image
├── package.json                   # Frontend dependencies
├── requirements.txt               # Backend dependencies
├── vite.config.js                 # Vite configuration
├── tailwind.config.js             # Tailwind CSS configuration
└── README.md
```

## 🔧 Technology Stack

### Frontend
- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **React Router** - Client-side routing
- **Zustand** - State management
- **Tailwind CSS** - Styling
- **Framer Motion** - Animations
- **i18next** - Internationalization
- **Axios** - HTTP client
- **PhotoSwipe** - Image viewer
- **Lucide React** - Icons

### Backend
- **Flask** - Web framework
- **PostgreSQL** - Database
- **AWS Rekognition** - Face recognition
- **Cloudflare R2 (S3-compatible)** - File storage (via boto3)
- **JWT** - Authentication (flask-jwt-extended)
- **Yoyo Migrations** - Database migrations
- **Pillow/Pillow-SIMD** - Image processing
- **Pydantic** - Data validation

### Infrastructure
- **Docker** - Containerization
- **Docker Compose** - Multi-container orchestration

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `POST /api/auth/refresh` - Refresh JWT token

### Events
- `GET /api/events` - List all events
- `GET /api/events/<id>` - Get event details
- `POST /api/events` - Create new event
- `PUT /api/events/<id>` - Update event
- `DELETE /api/events/<id>` - Delete event

### Images
- `GET /api/images` - List images (with filters)
- `GET /api/images/<id>` - Get image details
- `POST /api/images` - Upload images
- `PUT /api/images/<id>` - Update image
- `DELETE /api/images/<id>` - Delete image

### Groups (Face Groups)
- `GET /api/groups` - List face groups
- `GET /api/groups/<id>` - Get group details
- `PUT /api/groups/<id>` - Update group (name, permissions)
- `DELETE /api/groups/<id>` - Delete group

### Albums
- `GET /api/albums` - List albums
- `GET /api/albums/<id>` - Get album details
- `POST /api/albums` - Create album
- `PUT /api/albums/<id>` - Update album
- `DELETE /api/albums/<id>` - Delete album

### Moments
- `GET /api/moments` - List moments
- `GET /api/moments/<id>` - Get moment details
- `POST /api/moments` - Create moment
- `PUT /api/moments/<id>` - Update moment

### Profiles
- `GET /api/profiles` - List profiles
- `GET /api/profiles/me` - Get current user profile
- `PUT /api/profiles/me` - Update profile

### Uploads
- `GET /api/uploads` - List uploads
- `GET /api/uploads/<id>` - Get upload status
- `POST /api/uploads` - Create upload session

### Access Requests
- `GET /api/requests` - List access requests
- `POST /api/requests` - Create access request
- `PUT /api/requests/<id>` - Update request (approve/reject)
- `DELETE /api/requests/<id>` - Delete request

### Files & Downloads
- `GET /api/files/<path>` - Serve files
- `GET /api/download/<type>` - Download files (ZIP)

## 🎯 Usage Guide

### For Photographers

1. **Create an Event**
   - Navigate to Dashboard
   - Create a new event
   - Configure event settings and permissions

2. **Upload Photos**
   - Use the upload interface to add photos
   - Photos are automatically processed for face recognition
   - Wait for processing to complete

3. **Organize Content**
   - Review automatically detected faces in People view
   - Create custom albums for specific collections
   - Organize by moments for timeline-based viewing

4. **Manage Permissions**
   - Set permissions at event, album, or person level
   - Review and approve access requests from clients
   - Control identity visibility independently

5. **Share with Clients**
   - Share event URLs with clients
   - Clients can browse, create albums, and request access
   - Enable downloads for selected content

### For Clients/Guests

1. **Browse Events**
   - Access shared event URLs
   - Browse photos in Timeline, Albums, or People views

2. **Find Yourself**
   - Use People view to find your face group
   - Request access if needed
   - View all photos you appear in

3. **Create Collections**
   - Create custom albums
   - Select favorite photos
   - Download your photos

## 🛠️ Development

### Frontend Development
```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # Run ESLint
```

### Backend Development
```bash
# Run Flask in development mode
python -m src.backend.app

# Run with auto-reload (using Flask's debug mode)
export FLASK_ENV=development
python -m src.backend.app
```

### Database Migrations
```bash
# Apply migrations
yoyo apply --database <connection-string> ./migrations

# Rollback last migration
yoyo rollback --database <connection-string> ./migrations
```

### Testing
```bash
# Run backend tests
pytest tests/

# Run specific test file
pytest tests/test.py
```

## 🔐 Environment Variables

Create a `.env` file in the root directory with:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gather_pics
DB_USER=postgres
DB_PASSWORD=your_password

# Redis (for Celery task queue)
# Use 'localhost' if running worker locally, 'redis' if worker is in Docker
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

# AWS (Rekognition/SES)
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1

# R2 object storage (S3-compatible)
USE_R2=true  # Dev only: Set to 'true' to enable R2 storage in development (not needed in production)
R2_ACCESS_KEY_ID=your_r2_key
R2_SECRET_ACCESS_KEY=your_r2_secret
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=your-bucket-name
R2_REGION=auto  # Optional: region for R2 (default: auto)
S3_BASE_PREFIX=optional/prefix  # Optional: prefix for all files

# JWT
JWT_SECRET_KEY=your-secret-key-change-in-production

# Flask
ENVIRONMENT=DEVELOPMENT  # or PRODUCTION
FLASK_HOST=0.0.0.0
FLASK_PORT=5000

# Frontend
VITE_API_URL=http://localhost:5000
```

## 🐳 Docker

### Development
```bash
docker-compose up -d db    # Start only database
docker-compose up          # Start all services
```

### Production
```bash
docker build -t gather-pics .
docker run -p 5000:5000 --env-file .env gather-pics
```

## 📝 License

This project is licensed under the MIT License.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Contact

For questions or support, contact: [support@gatherpics.com](mailto:support@gatherpics.com)

---

**Built with ❤️ for professional photographers**
