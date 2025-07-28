import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ZoomIn, ZoomOut, RotateCw, Download, Edit, User, ArrowLeft, ArrowRight, Eye, EyeOff, Clock, Minus, Plus } from 'lucide-react';
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
  const [zoomInputValue, setZoomInputValue] = useState();
  const [editIndexValue, setEditIndexValue] = useState();
  const [isEditingIndex, setIsEditingIndex] = useState(false);
  const imageRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Prevent background scroll when modal is open
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, []);

  // Circular navigation
  const handleNavigate = (direction, index) => {
    if (!onNavigate) return;
    if (direction === 'prev') {
      if (currentIndex === 0) {
        onNavigate('jump', totalPhotos - 1);
      } else {
        onNavigate('prev');
      }
    } else if (direction === 'next') {
      if (currentIndex === totalPhotos - 1) {
        onNavigate('jump', 0);
      } else {
        onNavigate('next');
      }
    } else if (direction === 'jump' && typeof index === 'number') {
      onNavigate('jump', index);
    }
  };

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
      // Reset image loaded state when photo changes
      setImageLoaded(false);
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

  const handleZoomIn = () => {
    const currentPercent = Math.round(zoom * 100);
    const next25 = Math.ceil((currentPercent + 1) / 25) * 25;
    const add25 = currentPercent + 25;
    const newPercent = Math.min(300, Math.min(add25, next25));
    setZoom(newPercent / 100);
  };
  const handleZoomOut = () => {
    const currentPercent = Math.round(zoom * 100);
    const prev25 = Math.floor((currentPercent - 1) / 25) * 25;
    const subtract25 = currentPercent - 25;
    const newPercent = Math.max(50, Math.max(subtract25, prev25));
    setZoom(newPercent / 100);
  };
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);
  const handleReset = () => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/events/${FIXED_EVENT_ID}/display/${photoMeta.name}.webp`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = photoMeta.name.replace(/\.[^.]+$/, '.webp');
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading photo:', error);
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
    // Navigate to the face group page using the group label
    navigate(`/group/${encodeURIComponent(face.group_label)}`);
    onClose(); // Close the photo viewer
  };

  const handleJumpToMoment = () => {
    if (momentInfo && onJumpToMoment) {
      onJumpToMoment(momentInfo);
      onClose(); // Close the photo viewer
    }
  };

  // Debug function to log face data
  const debugFaceData = () => {
    console.log('=== DEBUG RECTANGLES INVESTIGATION ===');
    
    // Image size info
    if (imageRef.current) {
      const imgRect = imageRef.current.getBoundingClientRect();
      console.log('IMAGE SIZE INFO:', {
        displayWidth: imgRect.width,
        displayHeight: imgRect.height,
        naturalWidth: imageRef.current.naturalWidth,
        naturalHeight: imageRef.current.naturalHeight
      });
    }
    
    // Mode info
    console.log('MODE INFO:', {
      zoom: zoom,
      rotation: rotation,
      pan: pan,
      showRectangles: showRectangles
    });
    
    // Faces bbox info
    console.log('FACES BBOX INFO:');
    faces.forEach((face, index) => {
      console.log(`Face ${index} (${face.group_label}):`, {
        face_id: face.face_id,
        group_id: face.group_id,
        original_coords: face.face_coords,
        percentages: {
          left: `${face.face_coords.Left * 100}%`,
          top: `${face.face_coords.Top * 100}%`,
          width: `${face.face_coords.Width * 100}%`,
          height: `${face.face_coords.Height * 100}%`
        }
      });
    });
    
    // Rectangles bboxes info
    console.log('RECTANGLES BBOXES INFO:');
    faces.forEach((face, index) => {
      const style = getFaceRectangleStyle(face);
      console.log(`Rectangle ${index} (${face.group_label}):`, {
        calculated_style: style,
        css_properties: {
          left: style.left,
          top: style.top,
          width: style.width,
          height: style.height
        }
      });
    });
    
    console.log('=== END DEBUG ===');
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
    // Prevent dragging when clicking on face rectangles
    if (e.target.closest('[data-face-rectangle]')) {
      return;
    }
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
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

  // Fixed face rectangle style calculation - now much simpler since rectangles are inside transformed container
  const getFaceRectangleStyle = (face) => {
    return {
      left: `${face.face_coords.Left * 100}%`,
      top: `${face.face_coords.Top * 100}%`,
      width: `${face.face_coords.Width * 100}%`,
      height: `${face.face_coords.Height * 100}%`,
    };
  };

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
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-gray-500">
                    {isEditingIndex ? (
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={editIndexValue !== undefined ? editIndexValue : currentIndex + 1}
                        onChange={e => setEditIndexValue(e.target.value.replace(/[^0-9]/g, ''))}
                        onBlur={e => {
                          let val = parseInt(e.target.value, 10);
                          if (isNaN(val)) val = currentIndex + 1;
                          val = Math.max(1, Math.min(totalPhotos, val));
                          handleNavigate('jump', val - 1);
                          setIsEditingIndex(false);
                          setEditIndexValue(undefined);
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.target.blur();
                          } else if (e.key === 'Escape') {
                            setIsEditingIndex(false);
                            setEditIndexValue(undefined);
                          }
                        }}
                        className="w-12 text-center border-b border-gray-300 focus:outline-none focus:border-primary-500 bg-transparent"
                        style={{width: '3rem'}}
                        autoFocus
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:underline w-12 inline-block text-center"
                        style={{width: '3rem'}}
                        title="Jump to photo"
                        onClick={() => setIsEditingIndex(true)}
                      >
                        {currentIndex + 1}
                      </span>
                    )} / {totalPhotos}
                  </span>
                  <button
                    onClick={() => handleNavigate('next')}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
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
                    transition: isDragging ? 'none' : 'transform 0.2s ease-out',
                    width: '100%',
                    height: '100%',
                    transformOrigin: 'center center', // Ensure rotation happens from center
                  }}
                >
                  <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                    <img
                      src={photoInfo?.urls?.display ? `${API_BASE}${photoInfo.urls.display}` : `${API_BASE}/api/events/${FIXED_EVENT_ID}/display/${photoMeta.name}.webp`}
                      alt={photoMeta.name}
                      className="max-w-full max-h-full object-contain select-none"
                      draggable={false}
                      loading="lazy"
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = PLACEHOLDER_DATA_URL;
                      }}
                      ref={imageRef}
                      onLoad={() => setImageLoaded(true)}
                      style={{display: 'block', width: '100%', height: '100%'}}
                    />
                    
                    {/* Face rectangles - now inside the transformed container */}
                    {showRectangles && faces.map((face, index) => {
                      let borderColor, bgColor, labelBgColor;
                      if (selectedFaceIndex === index) {
                        borderColor = 'border-red-500';
                        bgColor = 'bg-red-500';
                        labelBgColor = 'bg-red-500';
                      } else if (face.group_id === currentGroupId) {
                        borderColor = 'border-green-500';
                        bgColor = 'bg-green-500';
                        labelBgColor = 'bg-green-500';
                      } else {
                        borderColor = 'border-blue-500';
                        bgColor = 'bg-blue-500';
                        labelBgColor = 'bg-blue-500';
                      }
                      return (
                        <div
                          key={index}
                          data-face-rectangle="true" // Marker to prevent dragging conflicts
                          className={`absolute border-2 ${borderColor} ${bgColor} bg-opacity-20 cursor-pointer hover:bg-opacity-30 transition-colors`}
                          style={{
                            ...getFaceRectangleStyle(face),
                            pointerEvents: 'auto',
                          }}
                          title={`${face.group_label}`}
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent triggering drag
                            handleFaceClick(index);
                          }}
                        >
                          <div className={`absolute -top-6 left-0 ${labelBgColor} text-white text-xs px-2 py-1 rounded whitespace-nowrap`}>
                            {face.group_label}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </div>

            {/* Sidebar */}
            <div className="w-80 bg-white border-l border-gray-200 photo-viewer-sidebar">
              {/* Controls */}
              <div className="p-3 border-b border-gray-200 photo-viewer-controls">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">Controls</h3>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={debugFaceData}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-xs bg-yellow-100 hover:bg-yellow-200"
                      title="Debug face data"
                    >
                      🐛 Debug
                    </button>
                    <button
                      onClick={handleReset}
                      className="text-sm text-primary-600 hover:text-primary-700"
                    >
                      Reset
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleZoomOut}
                      className="p-1 hover:bg-gray-200 rounded transition-colors"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={zoomInputValue !== undefined ? zoomInputValue : Math.round(zoom * 100)}
                      onChange={e => setZoomInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                      onBlur={e => {
                        let val = parseInt(e.target.value, 10);
                        if (isNaN(val)) val = 100;
                        val = Math.max(50, Math.min(300, val));
                        setZoom(val / 100);
                        setZoomInputValue(undefined);
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.target.blur();
                        } else if (e.key === 'Escape') {
                          setZoomInputValue(undefined);
                        }
                      }}
                      className="text-sm font-medium text-gray-700 w-12 text-center bg-transparent border-b border-gray-300 focus:outline-none focus:border-primary-500"
                      style={{width: '3rem'}}
                    />
                    <button
                      onClick={handleZoomIn}
                      className="p-1 hover:bg-gray-200 rounded transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex flex-row gap-x-2">
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
                          setSelectedFaceIndex(null);
                        }
                        setShowRectangles(v => !v);
                      }}
                      className="flex items-center justify-center space-x-1 p-2 px-4 w-[110px] hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      {showRectangles ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      <span className="text-xs whitespace-nowrap">{showRectangles ? 'Hide' : 'Show'} Tags</span>
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
                    <div><span className="font-semibold">Original size:</span> {(() => {
                      const size = photoInfo?.file_size;
                      if (!size) return 'Unknown';
                      if (size >= 1024 * 1024 * 1024) return (size / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
                      if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
                      return (size / 1024).toFixed(1) + ' KB';
                    })()}</div>
                    <div><span className="font-semibold">Original resolution:</span> {photoInfo?.width && photoInfo?.height ? `${photoInfo.width} x ${photoInfo.height}` : 'Unknown'}</div>
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
                                ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${face.group_representative}.webp`
                                : PLACEHOLDER_DATA_URL
                            }
                            alt={face.group_label}
                            className="w-12 h-12 object-cover rounded-full"
                            loading="lazy"
                            onError={(e) => {
                              e.target.onerror = null;
                              e.target.src = PLACEHOLDER_DATA_URL;
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