# Face Gallery - AI-Powered Face Recognition Website

A beautiful, modern web application for managing and viewing face recognition results. Built with React, Flask, and powered by AI face recognition technology.

## ✨ Features

### 🖼️ Gallery View
- **Beautiful Grid Layout**: Responsive gallery showing all detected face groups
- **Search & Filter**: Find specific faces by name or ID
- **Sort Options**: Sort by name, photo count, or date
- **Hover Effects**: Smooth animations and interactive elements

### 👤 Face Group Management
- **Edit Names**: Change the name of any face group
- **Representative Photos**: Choose the best photo to represent each group
- **Delete Groups**: Remove unwanted face groups
- **Photo Count**: See how many photos are in each group

### 📸 Individual Face Views
- **Detailed View**: Click any face to see all photos in that group
- **Grid & List Views**: Toggle between different viewing modes
- **Photo Selection**: Select individual photos for bulk actions
- **Search Photos**: Find specific photos within a group

### 💾 Download Features
- **Download All**: Get all photos from the entire gallery
- **Group Downloads**: Download all photos from a specific face group
- **Selective Downloads**: Choose specific photos to download
- **ZIP Files**: All downloads come as organized ZIP files

### 🎨 Modern UI/UX
- **Responsive Design**: Works perfectly on desktop, tablet, and mobile
- **Smooth Animations**: Beautiful transitions and hover effects
- **Dark/Light Theme**: Clean, modern interface
- **Loading States**: Professional loading indicators

## 🚀 Quick Start

### Prerequisites
- Node.js (v16 or higher)
- Python (v3.8 or higher)
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd face-recognition-website
   ```

2. **Install frontend dependencies**
   ```bash
   npm install
   ```

3. **Install backend dependencies**
   ```bash
   pip install flask flask-cors
   ```

### Running the Application

#### Option 1: Use the provided script (Windows)
```bash
start-dev.bat
```

#### Option 2: Manual start

1. **Start the backend server**
   ```bash
   cd src/backend
   python app.py
   ```
   The backend will run on http://localhost:5000

2. **Start the frontend server** (in a new terminal)
   ```bash
   npm run dev
   ```
   The frontend will run on http://localhost:5173

3. **Open your browser**
   Navigate to http://localhost:5173 to see the application

## 📁 Project Structure

```
face-recognition-website/
├── src/
│   ├── backend/
│   │   └── app.py              # Flask API server
│   ├── frontend/
│   │   ├── components/
│   │   │   ├── App.jsx         # Main application component
│   │   │   ├── Gallery.jsx     # Gallery view component
│   │   │   ├── FaceDetail.jsx  # Individual face view
│   │   │   ├── Header.jsx      # Navigation header
│   │   │   ├── FaceCard.jsx    # Individual face card
│   │   │   ├── LoadingSpinner.jsx
│   │   │   ├── EditGroupModal.jsx
│   │   │   └── DeleteConfirmModal.jsx
│   │   ├── index.css           # Global styles
│   │   └── main.jsx            # Application entry point
│   └── data/
│       ├── events_managers.json
│       ├── events.json
├── package.json
├── requirements.txt
├── tailwind.config.js
├── vite.config.js
└── README.md
```

## 🔧 API Endpoints

### Groups
- `GET /api/groups` - Get all face groups
- `GET /api/groups/<id>` - Get specific face group
- `PUT /api/groups/<id>` - Update face group
- `DELETE /api/groups/<id>` - Delete face group

### Downloads
- `GET /api/download-all` - Download all photos
- `GET /api/groups/<id>/download` - Download group photos
- `POST /api/groups/<id>/download-selected` - Download selected photos

### Images
- `GET /api/images.json` - Get images metadata (backend endpoint for frontend compatibility)

## 🎯 Usage Guide

### Viewing the Gallery
1. Open the application in your browser
2. Browse through the face groups in the main gallery
3. Use the search bar to find specific faces
4. Sort the gallery by name, count, or date

### Managing Face Groups
1. **Edit a Group**: Click the three dots menu on any face card and select "Edit"
2. **Change Name**: Enter a new name for the face group
3. **Change Representative Photo**: Select a different photo from the group
4. **Delete Group**: Use the delete option (this cannot be undone)

### Viewing Individual Faces
1. Click on any face card to see all photos in that group
2. Switch between grid and list view using the toggle buttons
3. Search for specific photos within the group
4. Select photos using the checkboxes for bulk actions

### Downloading Photos
1. **Download All**: Use the "Download All" button in the header
2. **Download Group**: Use the download button on any face card or in the detail view
3. **Download Selected**: Select specific photos and use the "Download Selected" button

## 🛠️ Development

### Frontend Development
- Built with React 18 and Vite
- Styled with Tailwind CSS
- Uses Framer Motion for animations
- Lucide React for icons

### Backend Development
- Flask REST API
- CORS enabled for frontend communication
- File serving for images
- ZIP file generation for downloads

### Adding New Features
The application is designed to be modular and extensible:
- New components can be added to `src/frontend/components/`
- API endpoints can be added to `src/backend/app.py`
- Styles can be customized in `src/frontend/index.css`

## 🌟 Future Enhancements

- [ ] User authentication and accounts
- [ ] Cloud storage integration (AWS S3, Google Cloud)
- [ ] Advanced face recognition features
- [ ] Photo upload functionality
- [ ] Face tagging and labeling
- [ ] Export to various formats
- [ ] Mobile app version

## 📝 License

This project is licensed under the MIT License.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

**Enjoy exploring your face gallery! 🎉** 