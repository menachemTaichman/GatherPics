import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ZoomIn, ZoomOut, RotateCw, Download, Edit, User, ArrowLeft, ArrowRight, Eye, EyeOff, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function PhotoViewer({ photo, onClose, onNavigate, totalPhotos, currentIndex, currentGroupId, onJumpToMoment }) {
  const navigate = useNavigate();
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [faces, setFaces] = useState([]);
  const [photoInfo, setPhotoInfo] = useState(null);
  const [momentInfo, setMomentInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';
  const FIXED_EVENT_ID = "75cb6635-879d-4386-b023-366444dc0fb2";
  const PLACEHOLDER_DATA_URL =
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';
  const [showRectangles, setShowRectangles] = useState(false);
  const [selectedFaceIndex, setSelectedFaceIndex] = useState(null);

  // Use the photo object directly since it comes from the API
  let photoMeta = photo;
  if (typeof photo === 'string') {
    photoMeta = { name: photo };
  }
  // Use the photo data directly
  const displayFilename = photoMeta.display_path || photoMeta.thumb_path || photoMeta.original_path || photoMeta.name;

  useEffect(() => {
    if (photo) {
      loadPhotoInfo();
      // Reset selected face when photo changes
      setSelectedFaceIndex(null);
    }
  }, [photo]);





  const loadPhotoInfo = async () => {
    try {
      setLoading(true);
      
      // Use the new complete photo endpoint instead of multiple calls
      const response = await axios.get(`${API_BASE}/api/photos/${encodeURIComponent(photoMeta.name)}/complete`);
      
      const photoData = response.data;
      setFaces(photoData.faces || []);
      setPhotoInfo(photoData);
      setMomentInfo(photoData.moment || null);
    } catch (error) {
      console.error('Error loading photo info:', error);
      setFaces([]);
      setPhotoInfo({ filename: photoMeta.name, faces_count: 0, groups: [] });
      setMomentInfo(null);
    } finally {
      setLoading(false);
    }
  };

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.5));
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);
  const handleReset = () => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/events/${FIXED_EVENT_ID}/display/${photoMeta.name}.jpg`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = photoMeta.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading photo:', error);
    }
  };

  const handleNavigate = (direction) => {
    if (onNavigate) {
      onNavigate(direction);
    }
  };

  const handleFaceClick = (index) => {
    // Turn on face tags if not already on
    if (!showRectangles) {
      setShowRectangles(true);
    }
    
    // If clicking on already selected face, deselect it
    if (selectedFaceIndex === index) {
      setSelectedFaceIndex(null);
    } else {
      setSelectedFaceIndex(index);
    }
  };

  const handleFaceNavigation = (face) => {
    // Navigate to the face group page
    navigate(`/group/${face.group_id}`);
    onClose(); // Close the photo viewer
  };

  const handleJumpToMoment = () => {
    if (momentInfo && onJumpToMoment) {
      onJumpToMoment(momentInfo);
      onClose(); // Close the photo viewer
    }
  };

  // Mouse wheel handler for zoom
  const handleWheel = (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom with Ctrl/Cmd + wheel
      const delta = e.deltaY > 0 ? -0.2 : 0.2;
      setZoom(prev => Math.max(0.5, Math.min(3, prev + delta)));
    } else {
      // Pan with wheel
      setPan(prev => ({
        x: prev.x - e.deltaX * 0.5,
        y: prev.y - e.deltaY * 0.5
      }));
    }
  };

  // Mouse handlers for dragging
  const handleMouseDown = (e) => {
    if (zoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e) => {
    if (isDragging && zoom > 1) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      switch (e.key) {
        case 'ArrowLeft':
          if (totalPhotos > 1 && currentIndex > 0) {
            handleNavigate('prev');
          }
          break;
        case 'ArrowRight':
          if (totalPhotos > 1 && currentIndex < totalPhotos - 1) {
            handleNavigate('next');
          }
          break;
        case 'Escape':
          onClose();
          break;
        case '+':
        case '=':
          handleZoomIn();
          break;
        case '-':
          handleZoomOut();
          break;
        case '0':
          handleReset();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [totalPhotos, currentIndex, onClose, handleNavigate]);

  return (
    <AnimatePresence>
      <div className="modal-overlay" onClick={onClose}>
        <motion.div
          className="modal-content max-w-7xl w-full photo-viewer-modal"
          style={{ 
            maxHeight: '92vh',
            height: '92vh'
          }}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white photo-viewer-header">
            <div className="flex items-center space-x-4">
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
              
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{photoInfo?.name || photoMeta.name}</h2>
                {photoInfo && (
                  <p className="text-sm text-gray-500">
                    {photoInfo.faces_count || 0} faces • {new Set(photoInfo.faces?.map(f => f.group_id) || []).size} groups
                  </p>
                )}
              </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center space-x-2">
              {totalPhotos > 1 && (
                <>
                  <button
                    onClick={() => handleNavigate('prev')}
                    disabled={currentIndex === 0}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-gray-500">
                    {currentIndex + 1} / {totalPhotos}
                  </span>
                  <button
                    onClick={() => handleNavigate('next')}
                    disabled={currentIndex === totalPhotos - 1}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex h-full overflow-hidden">
            {/* Photo Viewer */}
            <div 
              ref={containerRef}
              className="flex-1 flex items-center justify-center bg-gray-900 relative overflow-hidden cursor-grab active:cursor-grabbing"
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {loading ? (
                <div className="text-white">Loading...</div>
              ) : (
                <motion.div
                  className="relative"
                  style={{
                    transform: `scale(${zoom}) rotate(${rotation}deg) translate(${pan.x}px, ${pan.y}px)`,
                    transition: isDragging ? 'none' : 'transform 0.2s ease-out'
                  }}
                >
                  <img
                    src={photoInfo?.urls?.display ? `${API_BASE}${photoInfo.urls.display}` : `${API_BASE}/api/events/${FIXED_EVENT_ID}/display/${photoMeta.name}.jpg`}
                    alt={photoMeta.name}
                    className="max-w-full max-h-full object-contain select-none"
                    draggable={false}
                  />
                  
                  {/* Face Overlays */}
                  {showRectangles && faces.map((face, index) => {
                    let borderColor, bgColor, labelBgColor;
                    
                    if (selectedFaceIndex === index) {
                      // Selected face: red
                      borderColor = 'border-red-500';
                      bgColor = 'bg-red-500';
                      labelBgColor = 'bg-red-500';
                    } else if (face.group_id === currentGroupId) {
                      // Current face (belongs to current group): green
                      borderColor = 'border-green-500';
                      bgColor = 'bg-green-500';
                      labelBgColor = 'bg-green-500';
                    } else {
                      // Other faces: blue
                      borderColor = 'border-blue-500';
                      bgColor = 'bg-blue-500';
                      labelBgColor = 'bg-blue-500';
                    }
                    
                    return (
                      <div
                        key={index}
                        className={`absolute border-2 ${borderColor} ${bgColor} bg-opacity-20 cursor-pointer hover:bg-opacity-30 transition-colors`}
                        style={{
                          left: `${face.face_coords.Left * 100}%`,
                          top: `${face.face_coords.Top * 100}%`,
                          width: `${face.face_coords.Width * 100}%`,
                          height: `${face.face_coords.Height * 100}%`,
                          transform: `scale(${1/zoom})`
                        }}
                        title={`${face.group_label}`}
                        onClick={() => handleFaceClick(index)}
                      >
                        <div className={`absolute -top-6 left-0 ${labelBgColor} text-white text-xs px-2 py-1 rounded whitespace-nowrap`}>
                          {face.group_label}
                        </div>
                      </div>
                    );
                  })}
                </motion.div>
              )}
            </div>

            {/* Sidebar */}
            <div className="w-80 bg-white border-l border-gray-200 photo-viewer-sidebar">
              {/* Controls */}
              <div className="p-3 border-b border-gray-200 photo-viewer-controls">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">Controls</h3>
                  <button
                    onClick={handleReset}
                    className="text-sm text-primary-600 hover:text-primary-700"
                  >
                    Reset
                  </button>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleZoomOut}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-sm text-gray-600 min-w-[3rem] text-center">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      onClick={handleZoomIn}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={handleRotate}
                      className="flex items-center justify-center space-x-1 p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <RotateCw className="w-4 h-4" />
                      <span className="text-xs">Rotate</span>
                    </button>
                    <button
                      onClick={() => {
                        if (showRectangles) {
                          // When hiding tags, also deselect the face
                          setSelectedFaceIndex(null);
                        }
                        setShowRectangles(v => !v);
                      }}
                      className="flex items-center justify-center space-x-1 p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      {showRectangles ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      <span className="text-xs">{showRectangles ? 'Hide' : 'Show'} Tags</span>
                    </button>
                    <button
                      onClick={handleDownload}
                      className="flex items-center justify-center space-x-1 p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      <span className="text-xs">Download</span>
                    </button>
                  </div>
                </div>
                {/* Details Section */}
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <h4 className="text-xs font-medium text-gray-700 mb-1">Photo Details</h4>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    <div><span className="font-semibold">Name:</span> {photoInfo?.name || photoMeta.name}</div>
                    <div><span className="font-semibold">Date:</span> {photoInfo?.date_taken || 'Unknown'}</div>
                    <div><span className="font-semibold">Size:</span> {(() => {
                      const size = photoInfo?.file_size;
                      if (!size) return 'Unknown';
                      if (size >= 1024 * 1024 * 1024) return (size / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
                      if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
                      return (size / 1024).toFixed(1) + ' KB';
                    })()}</div>
                    <div><span className="font-semibold">Res:</span> {photoInfo?.width && photoInfo?.height ? `${photoInfo.width} x ${photoInfo.height}` : 'Unknown'}</div>
                  </div>
                  
                  {/* Moment Information */}
                  {momentInfo && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <h4 className="text-xs font-medium text-gray-700 mb-1">Moment</h4>
                      <div className="text-xs text-gray-500 space-y-0.5">
                        <div><span className="font-semibold">Title:</span> {momentInfo.title}</div>
                        {momentInfo.description && (
                          <div><span className="font-semibold">Description:</span> {momentInfo.description}</div>
                        )}
                        <div><span className="font-semibold">Time:</span> {momentInfo.start_datetime && momentInfo.end_datetime ? 
                          `${new Date(momentInfo.start_datetime).toLocaleTimeString()} - ${new Date(momentInfo.end_datetime).toLocaleTimeString()}` : 
                          'Unknown'
                        }</div>
                      </div>
                      <button
                        onClick={handleJumpToMoment}
                        className="mt-2 w-full text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-700 transition-colors flex items-center justify-center space-x-1"
                      >
                        <Clock className="w-3 h-3" />
                        <span>Jump to Moment</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Faces Info */}
              <div className="photo-viewer-faces p-4 flex flex-col flex-1 min-h-0 overflow-hidden">
                <h3 className="font-semibold text-gray-900 mb-4 flex-shrink-0">Faces in Photo</h3>
                
                <div 
                  className="faces-list-container overflow-y-auto flex-1"
                >
                  {faces.length === 0 ? (
                    <p className="text-gray-500 text-sm">No faces detected in this photo.</p>
                  ) : (
                    <div className="space-y-3">
                      {faces.map((face, index) => (
                        <div
                          key={index}
                          className={`flex items-center space-x-3 p-3 rounded-lg cursor-pointer transition-colors ${selectedFaceIndex === index ? 'bg-red-100' : 'bg-gray-50 hover:bg-blue-100'}`}
                          onClick={() => handleFaceClick(index)}
                        >
                          <img
                            src={
                              face.group_representative
                                ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${face.group_representative}.jpg`
                                : PLACEHOLDER_DATA_URL
                            }
                            alt={face.group_label}
                            className="w-12 h-12 object-cover rounded-full"
                            onError={(e) => {
                              if (face.group_representative && e.target.src.includes('/faces/')) {
                                e.target.onerror = () => { e.target.src = PLACEHOLDER_DATA_URL; };
                                e.target.src = PLACEHOLDER_DATA_URL;
                              } else {
                                e.target.src = PLACEHOLDER_DATA_URL;
                              }
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate">
                              {face.group_label}
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleFaceNavigation(face);
                            }}
                            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                            title="Go to group page"
                          >
                            <User className="w-4 h-4 text-gray-600" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
} 