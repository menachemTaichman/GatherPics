import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ZoomIn, ZoomOut, RotateCw, Download, Edit, User, ArrowLeft, ArrowRight } from 'lucide-react';
import axios from 'axios';

export default function PhotoViewer({ photo, onClose, onNavigate, totalPhotos, currentIndex }) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [faces, setFaces] = useState([]);
  const [photoInfo, setPhotoInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  useEffect(() => {
    if (photo) {
      loadPhotoInfo();
    }
  }, [photo]);

  const loadPhotoInfo = async () => {
    try {
      setLoading(true);
      console.log('Loading photo info for:', photo);
      
      const [facesResponse, infoResponse] = await Promise.all([
        axios.get(`/api/photos/${encodeURIComponent(photo)}/faces`),
        axios.get(`/api/photos/${encodeURIComponent(photo)}/info`)
      ]);
      
      console.log('Faces response:', facesResponse.data);
      console.log('Info response:', infoResponse.data);
      
      setFaces(facesResponse.data.faces || []);
      setPhotoInfo(infoResponse.data);
    } catch (error) {
      console.error('Error loading photo info:', error);
      setFaces([]);
      setPhotoInfo({ filename: photo, faces_count: 0, groups: [] });
    } finally {
      setLoading(false);
    }
  };

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.5, 3));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.5, 0.5));
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);
  const handleReset = () => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(`/images/${photo}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = photo;
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
          className="modal-content max-w-7xl w-full h-full max-h-[95vh]"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
            <div className="flex items-center space-x-4">
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
              
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{photo}</h2>
                {photoInfo && (
                  <p className="text-sm text-gray-500">
                    {photoInfo.faces_count} faces • {photoInfo.groups.length} groups
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
          <div className="flex h-full">
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
                    src={`/images/${photo}`}
                    alt={photo}
                    className="max-w-full max-h-full object-contain select-none"
                    draggable={false}
                  />
                  
                  {/* Face Overlays */}
                  {faces.map((face, index) => (
                    <div
                      key={index}
                      className="absolute border-2 border-primary-500 bg-primary-500 bg-opacity-20 cursor-pointer hover:bg-opacity-30 transition-colors"
                      style={{
                        left: `${face.face_coords.Left * 100}%`,
                        top: `${face.face_coords.Top * 100}%`,
                        width: `${face.face_coords.Width * 100}%`,
                        height: `${face.face_coords.Height * 100}%`,
                        transform: `scale(${1/zoom})`
                      }}
                      title={`${face.group_label} (Group ${face.group_id})`}
                    >
                      <div className="absolute -top-6 left-0 bg-primary-500 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                        {face.group_label}
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}
            </div>

            {/* Sidebar */}
            <div className="w-80 bg-white border-l border-gray-200 flex flex-col">
              {/* Controls */}
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900">Controls</h3>
                  <button
                    onClick={handleReset}
                    className="text-sm text-primary-600 hover:text-primary-700"
                  >
                    Reset
                  </button>
                </div>
                
                <div className="space-y-3">
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
                  
                  <button
                    onClick={handleRotate}
                    className="w-full flex items-center justify-center space-x-2 p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <RotateCw className="w-4 h-4" />
                    <span className="text-sm">Rotate</span>
                  </button>
                  
                  <button
                    onClick={handleDownload}
                    className="w-full flex items-center justify-center space-x-2 p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span className="text-sm">Download</span>
                  </button>
                </div>

                {/* Keyboard shortcuts help */}
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <h4 className="text-xs font-medium text-gray-700 mb-2">Keyboard Shortcuts</h4>
                  <div className="text-xs text-gray-500 space-y-1">
                    <div>← → Navigate photos</div>
                    <div>+ - Zoom in/out</div>
                    <div>0 Reset view</div>
                    <div>Esc Close</div>
                    <div>Mouse wheel: Pan</div>
                    <div>Ctrl+wheel: Zoom</div>
                  </div>
                </div>
              </div>

              {/* Faces Info */}
              <div className="flex-1 p-4 overflow-y-auto">
                <h3 className="font-semibold text-gray-900 mb-4">Faces in Photo</h3>
                
                {faces.length === 0 ? (
                  <p className="text-gray-500 text-sm">No faces detected in this photo.</p>
                ) : (
                  <div className="space-y-3">
                    {faces.map((face, index) => (
                      <div
                        key={index}
                        className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg"
                      >
                        <img
                          src={`/crops/${face.group_representative}`}
                          alt={face.group_label}
                          className="w-12 h-12 object-cover rounded-lg"
                          onError={(e) => {
                            e.target.src = `/images/${face.group_representative}`;
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">
                            {face.group_label}
                          </p>
                          <p className="text-sm text-gray-500">
                            Group {face.group_id}
                          </p>
                        </div>
                        <button
                          className="p-1 hover:bg-gray-200 rounded transition-colors"
                          title="View group"
                        >
                          <User className="w-4 h-4 text-gray-500" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
} 