import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Image, Grid, List, Minus, Plus, Settings, Clock, Calendar } from 'lucide-react';
import PhotoViewer from './PhotoViewer';
import EditMomentsModal from './EditMomentsModal';
import EditMomentPhotosModal from './EditMomentPhotosModal';
import { useLocation } from 'react-router-dom';

function formatTimeOnly(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return dateString;
  }
}

function formatDate(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return dateString;
  }
}

function PhotoGrid({ momentId, viewMode, photoSize, onPhotoSelect, selectedPhotos, globalSelection, onOpenPhotoViewer }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [photoClasses, setPhotoClasses] = useState({});

  useEffect(() => {
    fetchPhotos();
  }, [momentId]);

  const fetchPhotos = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/moments/${momentId}/photos`);
      setPhotos(res.data.photos || []);
    } catch {
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  };

  const handleImageLoad = (photoName, e) => {
    const img = e.target;
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    
    let imageClass = 'square';
    if (aspectRatio > 1.2) {
      imageClass = 'landscape';
    } else if (aspectRatio < 0.8) {
      imageClass = 'portrait';
    }
    
    setPhotoClasses(prev => ({
      ...prev,
      [photoName]: imageClass
    }));
  };

  const togglePhotoSelection = (photoName) => {
    onPhotoSelect(photoName, momentId);
  };

  const openPhotoViewer = (photoName, index) => {
    onOpenPhotoViewer(photos, photoName, index);
  };

  if (loading) return <div className="py-4 text-gray-400">Loading photos...</div>;
  if (photos.length === 0) return <div className="py-4 text-gray-400">No photos in this moment.</div>;

  return (
    <div className="mt-4">
      {/* Photos Grid/List */}
      {viewMode === 'grid' ? (
        <div className={`photo-gallery-grid size-${Math.round(photoSize * 100).toString().padStart(3, '0')}`}>
          {photos.map((photo, index) => (
            <div
              key={photo.name}
              className={`photo-card ${photoClasses[photo.name] || 'square'}`}
            >
              <div className="relative group cursor-pointer h-full" onClick={() => openPhotoViewer(photo.name, index)}>
                <input
                  type="checkbox"
                  checked={globalSelection.has(`${momentId}:${photo.name}`)}
                  onChange={(e) => {
                    e.stopPropagation();
                    togglePhotoSelection(photo.name);
                  }}
                  onClick={e => e.stopPropagation()}
                  className="absolute top-2 left-2 z-10 w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500"
                />
                <img
                  src={`/images/${photo.name}`}
                  alt={`Photo ${index + 1}`}
                  className="w-full h-full object-cover rounded-lg"
                  onLoad={(e) => handleImageLoad(photo.name, e)}
                  onError={(e) => {
                    e.target.src = 'data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\"><rect width=\"100%\" height=\"100%\" fill=\"%23e5e7eb\"/><text x=\"50%\" y=\"50%\" text-anchor=\"middle\" dy=\".35em\" font-size=\"80\" fill=\"%239ca3af\">?</text></svg>';
                  }}
                />
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 flex items-center justify-center rounded-lg">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-white">
                    <Image className="w-8 h-8 mx-auto mb-1" />
                    <span className="text-sm">Click to view</span>
                  </div>
                </div>
                {/* Date overlay */}
                {photo.date_taken && (
                  <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
                    {formatTimeOnly(photo.date_taken)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4 max-w-3xl mx-auto block">
          {photos.map((photo, index) => (
            <div key={photo.name} className="flex items-center justify-between space-x-4 p-4 bg-white rounded-lg border border-gray-200 w-full">
              <input
                type="checkbox"
                checked={globalSelection.has(`${momentId}:${photo.name}`)}
                onChange={(e) => {
                  togglePhotoSelection(photo.name);
                }}
                onClick={e => e.stopPropagation()}
                className="w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500"
              />
              <div className="relative">
                <img
                  src={`/images/${photo.name}`}
                  alt={`Photo ${index + 1}`}
                  className="w-20 h-20 object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => openPhotoViewer(photo.name, index)}
                  onError={(e) => {
                    e.target.src = 'data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\"><rect width=\"100%\" height=\"100%\" fill=\"%23e5e7eb\"/><text x=\"50%\" y=\"50%\" text-anchor=\"middle\" dy=\".35em\" font-size=\"80\" fill=\"%239ca3af\">?</text></svg>';
                  }}
                />
              </div>
              <div className="flex-1">
                <div className="font-medium text-gray-900">{photo.name}</div>
                {photo.date_taken && (
                  <div className="text-sm text-gray-500">{formatTimeOnly(photo.date_taken)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

export default function Moments() {
  const location = useLocation();
  const [moments, setMoments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [images, setImages] = useState([]);
  const [viewMode, setViewMode] = useState('grid');
  const [photoSize, setPhotoSize] = useState(1);
  const [momentPhotosMap, setMomentPhotosMap] = useState({});
  const [globalSelection, setGlobalSelection] = useState(new Set());
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [targetMoment, setTargetMoment] = useState(null);
  const [carouselVisible, setCarouselVisible] = useState(true);
  const [currentVisibleMoment, setCurrentVisibleMoment] = useState(null);
  const [photoViewer, setPhotoViewer] = useState({ show: false, photo: null, index: 0, photos: [] });
  const [showEditPhotosModal, setShowEditPhotosModal] = useState(false);
  const [editingPhotosForMoment, setEditingPhotosForMoment] = useState(null);

  const momentsRef = useRef({});

  useEffect(() => {
    fetchMoments();
    fetchImages();
  }, []);

  // Handle navigation from Face Detail to scroll to specific moment
  useEffect(() => {
    if (location.state?.scrollToMoment && moments.length > 0) {
      const momentId = location.state.scrollToMoment;
      // Clear the state to prevent re-scrolling
      window.history.replaceState({}, document.title);
      
      // Wait a bit for the page to load, then scroll to the moment
      setTimeout(() => {
        scrollToMoment(momentId);
      }, 500);
    }
  }, [location.state, moments]);

  useEffect(() => {
    const handleScroll = () => {
      let currentMoment = null;
      
      // Find which moment is currently most visible
      Object.entries(momentsRef.current).forEach(([momentId, element]) => {
        if (element) {
          const rect = element.getBoundingClientRect();
          const headerHeight = 250; // Account for the main header with controls and carousel
          
          // If the moment is in the viewport
          if (rect.top <= headerHeight + 50 && rect.bottom >= headerHeight) {
            currentMoment = moments.find(m => m.id === momentId);
          }
        }
      });
      
      setCurrentVisibleMoment(currentMoment);
    };

    // Call once on mount to set initial state
    handleScroll();
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [moments]);

  const fetchAllMomentPhotos = async () => {
    const map = {};
    for (const moment of moments) {
      try {
        const res = await axios.get(`/api/moments/${moment.id}/photos`);
        map[moment.id] = res.data.photos || [];
      } catch {
        map[moment.id] = [];
      }
    }
    setMomentPhotosMap(map);
  };

  useEffect(() => {
    if (moments.length > 0) fetchAllMomentPhotos();
  }, [moments]);

  const fetchMoments = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/moments');
      setMoments(response.data.moments || []);
      setError(null);
    } catch (err) {
      setError('Failed to load moments.');
    } finally {
      setLoading(false);
    }
  };
  
  const fetchImages = async () => {
    try {
      const res = await axios.get('/api/images.json');
      setImages(res.data.images || []);
    } catch {
      setImages([]);
    }
  };

  const handleSaveMoments = async (updatedMoment) => {
    setMoments(prev => prev.map(m => m.id === updatedMoment.id ? updatedMoment : m));
  };

  const handleDeleteMoment = async (id) => {
    try {
      await axios.delete(`/api/moments/${id}`);
      fetchMoments();
    } catch (error) {
      alert('Failed to delete moment.');
    }
  };

  const handlePhotoSelect = (photoName, momentId) => {
    setGlobalSelection(prev => {
      const key = `${momentId}:${photoName}`;
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAllPhotos = () => {
    const allPhotos = new Set();
    Object.entries(momentPhotosMap).forEach(([momentId, photos]) => {
      photos.forEach(photo => {
        allPhotos.add(`${momentId}:${photo.name}`);
      });
    });
    setGlobalSelection(allPhotos);
  };

  const clearGlobalSelection = () => {
    setGlobalSelection(new Set());
  };

  const handleGlobalDownload = async () => {
    if (globalSelection.size === 0) return;
    
    try {
      const photoGroups = {};
      globalSelection.forEach(key => {
        const [momentId, photoName] = key.split(':');
        if (!photoGroups[momentId]) photoGroups[momentId] = [];
        photoGroups[momentId].push(photoName);
      });

      // Download each group separately
      for (const [momentId, photoNames] of Object.entries(photoGroups)) {
        const response = await fetch('/api/download-selected-moment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ momentId, photoNames })
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        
        const blob = await response.blob();
        
        if (blob.size === 0) {
          throw new Error('Downloaded file is empty');
        }
        
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `moment_${momentId}_photos.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Error downloading photos:', error);
      alert(`Failed to download photos: ${error.message}. Please try again.`);
    }
  };

  const handleRemoveFromMoment = async () => {
    // This would require backend support to remove photos from moments
    alert('Remove from moment functionality would be implemented here');
  };

  const handleMoveToMoment = async () => {
    if (!targetMoment || globalSelection.size === 0) return;
    
    try {
      // This would require backend support to move photos between moments
      alert(`Moving ${globalSelection.size} photos to ${targetMoment.title}`);
      setShowMoveModal(false);
      clearGlobalSelection();
    } catch (error) {
      alert('Failed to move photos');
    }
  };

  const scrollToMoment = (momentId) => {
    const element = momentsRef.current[momentId];
    if (element) {
      // Calculate the exact position we want to scroll to
      const stickyHeader = document.querySelector('.sticky.top-16');
      const carouselContainer = document.querySelector('.carousel-container');
      
      const headerHeight = stickyHeader ? stickyHeader.offsetHeight : 0;
      const carouselHeight = carouselContainer ? carouselContainer.offsetHeight : 0;
      const fixedAdjustment = -100; // Adjust this value: positive = scroll down more, negative = scroll up more
      const totalOffset = headerHeight + carouselHeight + 20 + fixedAdjustment; // Add 20px padding + manual adjustment
      
      // Get the element's position relative to the document
      const elementRect = element.getBoundingClientRect();
      const elementTop = elementRect.top + window.pageYOffset;
      
      // Calculate the target scroll position
      const targetScroll = elementTop - totalOffset;
      
      // Scroll to the calculated position
      window.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: 'smooth'
      });
    }
  };

  const openPhotoViewer = (photos, photoName, index) => {
    setPhotoViewer({
      show: true,
      photo: photoName,
      index: index,
      photos: photos
    });
  };

  const closePhotoViewer = () => {
    setPhotoViewer({ show: false, photo: null, index: 0, photos: [] });
  };

  const navigatePhoto = (direction) => {
    const currentIndex = photoViewer.index;
    let newIndex;
    
    if (direction === 'next') {
      newIndex = Math.min(currentIndex + 1, photoViewer.photos.length - 1);
    } else {
      newIndex = Math.max(currentIndex - 1, 0);
    }
    
    setPhotoViewer({
      show: true,
      photo: photoViewer.photos[newIndex].name,
      index: newIndex,
      photos: photoViewer.photos
    });
  };

  const handleJumpToMoment = (momentInfo) => {
    // Find the moment in our moments list and scroll to it
    const moment = moments.find(m => m.id === momentInfo.id);
    if (moment) {
      scrollToMoment(moment.id);
    }
  };

  const handleOpenEditPhotos = (moment) => {
    setEditingPhotosForMoment(moment);
    setShowEditPhotosModal(true);
  };

  if (loading) return <div className="p-8 text-center">Loading moments...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="w-full bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-16 z-30">
        <div className="px-4 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Timeline</h1>
              <p className="text-gray-600 mt-1">Your captured moments in time</p>
            </div>
            <div className="flex items-center space-x-3">
              {globalSelection.size > 0 && (
                <>
                  <motion.button 
                    initial={{ scale: 0.9 }}
                    animate={{ scale: 1 }}
                    onClick={handleGlobalDownload} 
                    className="btn-primary flex items-center space-x-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download ({globalSelection.size})</span>
                  </motion.button>
                  <button onClick={handleRemoveFromMoment} className="btn-secondary">
                    Remove from Moment
                  </button>
                  <button onClick={() => setShowMoveModal(true)} className="btn-secondary">
                    Move to Moment
                  </button>
                  <button onClick={clearGlobalSelection} className="btn-secondary">
                    Clear Selection
                  </button>
                </>
              )}
              <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowEditModal(true)} 
                className="btn-primary flex items-center space-x-2"
              >
                <Settings className="w-4 h-4" />
                <span>Edit Moments</span>
              </motion.button>
            </div>
          </div>
          
          {/* Controls */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-1 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded-md transition-colors ${
                    viewMode === 'grid' ? 'bg-white shadow-sm' : 'hover:bg-gray-200'
                  }`}
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded-md transition-colors ${
                    viewMode === 'list' ? 'bg-white shadow-sm' : 'hover:bg-gray-200'
                  }`}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center space-x-2 bg-gray-50 rounded-lg px-3 py-2">
                <button
                  onClick={() => setPhotoSize(prev => Math.max(0.5, prev - 0.25))}
                  disabled={photoSize <= 0.5}
                  className="p-1 hover:bg-gray-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="text-sm font-medium text-gray-700 min-w-[3rem] text-center">
                  {Math.round(photoSize * 100)}%
                </span>
                <button
                  onClick={() => setPhotoSize(prev => Math.min(3, prev + 0.25))}
                  disabled={photoSize >= 3}
                  className="p-1 hover:bg-gray-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <button onClick={selectAllPhotos} className="text-sm text-primary-600 hover:text-primary-700 font-medium">
                Select All Photos
              </button>
            </div>
            
            {/* Carousel Toggle Button */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setCarouselVisible(!carouselVisible)}
              className="flex items-center justify-center w-8 h-8 bg-white rounded-full shadow-md border border-gray-200 hover:shadow-lg transition-all duration-200 hover:bg-gray-50"
              title={carouselVisible ? "Hide carousel" : "Show carousel"}
            >
              {carouselVisible ? (
                <span className="text-gray-600 font-bold text-lg leading-none">↑</span>
              ) : (
                <span className="text-gray-600 font-bold text-lg leading-none">↓</span>
              )}
            </motion.button>
          </div>

          {/* Carousel */}
          <AnimatePresence>
            {carouselVisible && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="carousel-container flex space-x-4 overflow-x-auto pb-2">
                  {moments.length === 0 && (
                    <div className="bg-gray-100 rounded-lg h-32 min-w-[200px] flex items-center justify-center text-gray-400">
                      No moments yet
                    </div>
                  )}
                  {moments.map(moment => (
                    <motion.div 
                      key={moment.id} 
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="relative bg-white rounded-lg shadow flex-shrink-0 w-56 h-32 flex flex-col items-center justify-center p-3 border border-gray-100 cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => scrollToMoment(moment.id)}
                    >
                      <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded overflow-hidden flex items-center justify-center mb-2">
                        {moment.representative_photo ? (
                          <img src={`/images/${moment.representative_photo}`} alt="" className="object-cover w-full h-full" />
                        ) : (
                          <Image className="w-8 h-8 text-white" />
                        )}
                      </div>
                      <div className="text-center">
                        <div className="text-base font-semibold truncate max-w-[7rem]">{moment.title}</div>
                        <div className="text-xs text-gray-500 truncate max-w-[7rem]">
                          {formatTimeOnly(moment.start_datetime)} - {formatTimeOnly(moment.end_datetime)}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Timeline */}
      <div className="px-4 py-8">
        {moments.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-24 h-24 mx-auto bg-gray-200 rounded-full flex items-center justify-center mb-4">
              <Calendar className="w-12 h-12 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No moments yet</h3>
            <p className="text-gray-500">Create your first moment to start building your timeline.</p>
          </div>
        ) : (
          <div className="relative">
            {/* Fixed left sidebar for sticky info */}
            <div className="fixed left-4 top-100 w-64 z-50 bg-white p-4 rounded-lg shadow-lg border border-gray-200">
              {currentVisibleMoment ? (
                <>
                  <div className="text-base font-bold text-gray-900 mb-1 leading-tight">{currentVisibleMoment.title}</div>
                  <div className="text-xs text-gray-700 mb-1 font-medium">
                    {formatTimeOnly(currentVisibleMoment.start_datetime)} - {formatTimeOnly(currentVisibleMoment.end_datetime)}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDate(currentVisibleMoment.start_datetime)}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-base font-bold text-gray-900 mb-1 leading-tight">Timeline</div>
                  <div className="text-xs text-gray-500">Scroll to see moments</div>
                </>
              )}
            </div>
            
            {/* Timeline line */}
            <div className="absolute left-64 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-500 via-purple-500 to-pink-500"></div>
            
            {/* Timeline items */}
            <div className="space-y-12 ml-64">
              {moments.map((moment, index) => (
                <motion.div
                  key={moment.id}
                  initial={{ opacity: 0, x: -50 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="relative flex"
                  ref={el => momentsRef.current[moment.id] = el}
                >
                  {/* Timeline dot */}
                  <div className="relative flex-shrink-0">
                    <div className="w-4 h-4 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full border-4 border-white shadow-lg z-10 mt-6"></div>
                  </div>
                  
                  {/* Moment card */}
                  <div className="flex-1 pl-6">
                    <motion.div 
                      className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-100 hover:shadow-xl transition-shadow duration-300"
                      whileHover={{ y: -2 }}
                    >
                      {/* Header */}
                      <div className="p-6 border-b border-gray-100">
                        <div className="flex items-start space-x-4">
                          <div className="flex-shrink-0">
                            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg overflow-hidden flex items-center justify-center">
                              {moment.representative_photo ? (
                                <img 
                                  src={`/images/${moment.representative_photo}`} 
                                  alt="" 
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <Image className="w-8 h-8 text-white" />
                              )}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-xl font-bold text-gray-900 mb-1">{moment.title}</h3>
                            <div className="flex items-center space-x-4 text-sm text-gray-500">
                              <div className="flex items-center space-x-1">
                                <Clock className="w-4 h-4" />
                                <span>{formatTimeOnly(moment.start_datetime)} - {formatTimeOnly(moment.end_datetime)}</span>
                            </div>
                              <div className="flex items-center space-x-1">
                                <Calendar className="w-4 h-4" />
                                <span>{formatDate(moment.start_datetime)}</span>
                              </div>
                            </div>
                            {moment.description && (
                              <p className="text-gray-600 mt-2">{moment.description}</p>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {/* Photos */}
                      <div className="p-6">
                        <PhotoGrid 
                          momentId={moment.id} 
                          viewMode={viewMode} 
                          photoSize={photoSize}
                          onPhotoSelect={handlePhotoSelect}
                          selectedPhotos={new Set()}
                          globalSelection={globalSelection}
                          onOpenPhotoViewer={openPhotoViewer}
                        />
                      </div>
                    </motion.div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>

      <EditMomentsModal 
        open={showEditModal} 
        onClose={() => setShowEditModal(false)} 
        onSave={handleSaveMoments}
        onDelete={handleDeleteMoment}
        moments={moments}
        images={images}
        momentPhotosMap={momentPhotosMap}
        onRefreshPhotos={fetchAllMomentPhotos}
        onOpenEditPhotos={handleOpenEditPhotos}
      />

      <EditMomentPhotosModal
        open={showEditPhotosModal}
        onClose={() => setShowEditPhotosModal(false)}
        moment={editingPhotosForMoment}
        momentPhotosMap={momentPhotosMap}
        onRefreshPhotos={fetchAllMomentPhotos}
        onSave={handleSaveMoments}
        moments={moments}
      />

      {/* Move Modal */}
      {showMoveModal && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4"
        >
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-white rounded-lg shadow-lg w-full max-w-md p-6"
          >
            <h4 className="font-semibold mb-4">Move to Moment</h4>
            <select
              value={targetMoment?.id || ''}
              onChange={(e) => setTargetMoment(moments.find(m => m.id === e.target.value))}
              className="w-full border rounded px-3 py-2 mb-4"
            >
              <option value="">Select a moment...</option>
              {moments.map(m => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
            </select>
            <div className="flex justify-end space-x-2">
              <button onClick={() => setShowMoveModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleMoveToMoment} className="btn-primary">Move</button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* Photo Viewer */}
      {photoViewer.show && (
        <PhotoViewer
          photo={photoViewer.photo}
          onClose={closePhotoViewer}
          onNavigate={navigatePhoto}
          totalPhotos={photoViewer.photos.length}
          currentIndex={photoViewer.index}
          currentGroupId={null}
          onJumpToMoment={handleJumpToMoment}
        />
      )}
    </div>
  );
} 