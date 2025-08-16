import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Image, Grid, List, Minus, Plus, Settings, Clock, Calendar, CheckCheck, X, ShoppingBag, Trash2, Move } from 'lucide-react';
import PhotoViewer from './PhotoViewer';
import EditMomentsModal from './EditMomentsModal';
import EditMomentPhotosModal from './EditMomentPhotosModal';
import { useLocation } from 'react-router-dom';
import { useSetting } from '../utils/useSettings';
import { useDataStore, CHANGE_TYPES, handleDataChange } from '../utils/dataManager';
import { momentsAPI, imagesAPI } from '../utils/apiService';
import MomentCard from './MomentCard';
import { useModalManager } from '../utils/modalManager';

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

export default function Moments() {
  const location = useLocation();
  const { 
    moments, 
    setMoments, 
    updateMoment, 
    deleteMoment, 
    addMoment,
    loading: storeLoading,
    error: storeError,
    setLoading: setStoreLoading,
    setError: setStoreError
  } = useDataStore();
  
  const [images, setImages] = useState([]);
  const [viewMode, setViewMode] = useSetting('moments_viewMode', 'grid');
  const [photoSize, setPhotoSize] = useSetting('moments_photoSize', 1.0);
  const [photoSizeInputValue, setPhotoSizeInputValue] = useState();
  const [momentPhotosMap, setMomentPhotosMap] = useState({});
  const [globalSelection, setGlobalSelection] = useState(new Set());
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [targetMoment, setTargetMoment] = useState(null);
  const [carouselVisible, setCarouselVisible] = useSetting('moments_carouselVisible', true);
  const [currentVisibleMoment, setCurrentVisibleMoment] = useState(null);
  const [photoViewer, setPhotoViewer] = useState({ show: false, photo: null, index: 0, photos: [] });
  const [editingPhotosForMoment, setEditingPhotosForMoment] = useState(null);

  const momentsRef = useRef({});
  const { register: registerModal } = useModalManager();

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
            currentMoment = moments.find(m => m.momentID === momentId);
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
      if (moment.momentID && !moment.momentID.startsWith('temp-')) {
        try {
          const result = await momentsAPI.getPhotos(moment.momentID);
          map[moment.momentID] = result.photos || [];
        } catch {
          map[moment.momentID] = [];
        }
      } else {
        map[moment.momentID] = [];
      }
    }
    setMomentPhotosMap(map);
  };

  useEffect(() => {
    if (moments.length > 0) fetchAllMomentPhotos();
  }, [moments]);

  const fetchMoments = async () => {
    try {
      setStoreLoading(true);
      const response = await momentsAPI.getAll();
      setMoments(response.moments || []);
      setStoreError(null);
    } catch (err) {
      setStoreError('Failed to load moments.');
    } finally {
      setStoreLoading(false);
    }
  };

  const fetchImages = async () => {
    try {
      const response = await imagesAPI.getAll();
      setImages(response.images || []);
    } catch (err) {
      console.error('Error fetching images:', err);
    }
  };

  useEffect(() => {
    // console.log("Moments in state:", moments); // DEBUG
  }, [moments]);

  const handleSaveMoments = async (updatedMoment) => {
    try {
      const response = await momentsAPI.update(updatedMoment.momentID, updatedMoment);
      
      // Handle any change instructions from the backend
      if (response.changes) {
        response.changes.forEach(change => {
          handleDataChange(change.type, change.data);
        });
      } else {
        // Fallback to direct update if no change instructions
        updateMoment(updatedMoment.momentID, response.moment || response);
      }
      
      // setShowEditModal(false); // This state is now managed by modalManager
    } catch (error) {
      console.error('Error saving moment:', error);
    }
  };

  const handleDeleteMoment = async (id) => {
    try {
      const response = await momentsAPI.delete(id);
      
      // Handle any change instructions from the backend
      if (response.changes) {
        response.changes.forEach(change => {
          handleDataChange(change.type, change.data);
        });
      } else {
        // Fallback to direct delete if no change instructions
        deleteMoment(id);
      }
    } catch (error) {
      console.error('Error deleting moment:', error);
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

  const handleGlobalAddToBucket = async () => {
    if (globalSelection.size === 0) return;
    
    // TODO: Implement add selected photos to bucket functionality
    alert(`Add ${globalSelection.size} selected photos to bucket functionality will be implemented later`);
  };

  const handleRemoveFromMoment = async () => {
    // This would require backend support to remove photos from moments
    alert('Remove from moment functionality would be implemented here');
  };

  const handleMoveToMoment = async () => {
    if (!targetMoment || globalSelection.size === 0) return;
    
    try {
      // This would require backend support to move photos between moments
      alert(`Moving ${globalSelection.size} photos to ${targetMoment.label}`);
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

  const openPhotoViewer = (photos, photo, index) => {
    setPhotoViewer({
      show: true,
      photo: photo,
      index: index,
      photos: photos
    });
  };

  const closePhotoViewer = () => {
    setPhotoViewer({ show: false, photo: null, index: 0, photos: [] });
  };

  const navigatePhoto = (direction, index) => {
    const currentIndex = photoViewer.index;
    let newIndex;
    if (direction === 'jump' && typeof index === 'number') {
      newIndex = index;
    } else if (direction === 'next') {
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
    const moment = moments.find(m => m.momentID === momentInfo.id);
    if (moment) {
      scrollToMoment(moment.momentID);
    }
  };

  const handleOpenEditPhotos = (moment) => {
    setEditingPhotosForMoment(moment);
    registerModal('edit-moment-photos-modal');
  };

  if (storeLoading) return <div className="p-8 text-center">Loading moments...</div>;
  if (storeError) return <div className="p-8 text-center text-red-500">{storeError}</div>;

  return (
    <div className="w-full bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-16 z-30 px-8 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-3xl font-bold text-gray-900">Timeline</h1>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => registerModal('edit-moments-modal')}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Edit moments"
            >
              <Settings className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Controls Row */}
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center divide-x divide-gray-200">
            {/* Group 1: View and Size Controls */}
            <div className="flex items-center space-x-3 px-4">
              <button
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-100 flex items-center justify-center"
                title={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
              >
                {viewMode === 'grid' ? <List className="w-4 h-4" /> : <Grid className="w-4 h-4" />}
              </button>

              {viewMode === 'grid' && (
                <>
                  <button
                    onClick={() => {
                      const currentPercent = Math.round(photoSize * 100);
                      const subtractValue = currentPercent > 100 ? 25 : 10;
                      const newPercent = Math.max(50, currentPercent - subtractValue);
                      setPhotoSize(newPercent / 100);
                    }}
                    disabled={photoSize <= 0.5}
                    className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Decrease size"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={photoSizeInputValue !== undefined ? photoSizeInputValue : Math.round(photoSize * 100)}
                    onChange={e => setPhotoSizeInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                    onBlur={e => {
                      let val = parseInt(e.target.value, 10);
                      if (isNaN(val)) val = Math.round(photoSize * 100);
                      val = Math.max(50, Math.min(300, val));
                      setPhotoSize(val / 100);
                      setPhotoSizeInputValue(undefined);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') e.target.blur();
                      else if (e.key === 'Escape') setPhotoSizeInputValue(undefined);
                    }}
                    className="text-sm font-medium text-gray-700 w-12 text-center bg-transparent border-b border-gray-300 focus:outline-none focus:border-primary-500"
                    style={{width: '3rem'}}
                  />
                  <button
                    onClick={() => {
                      const currentPercent = Math.round(photoSize * 100);
                      const addValue = currentPercent >= 100 ? 25 : 10;
                      const newPercent = Math.min(300, currentPercent + addValue);
                      setPhotoSize(newPercent / 100);
                    }}
                    disabled={photoSize >= 3}
                    className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Increase size"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>

            {/* Group 2: Selection Controls */}
            <div className="flex items-center space-x-3 px-4">
              <button
                onClick={selectAllPhotos}
                className="w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700"
                title="Select all photos"
              >
                <CheckCheck className="w-4 h-4" />
              </button>
              {globalSelection.size > 0 && (
                <button
                  onClick={clearGlobalSelection}
                  className="w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700"
                  title="Clear selection"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Group 3: Actions on Selection */}
            {globalSelection.size > 0 && (
              <div className="flex items-center space-x-3 px-4">
                <button
                  onClick={handleGlobalAddToBucket}
                  className="w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700"
                  title="Add selected photos to bucket"
                >
                  <ShoppingBag className="w-4 h-4" />
                </button>
                <button
                  onClick={handleRemoveFromMoment}
                  className="w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-red-100 text-red-700"
                  title="Remove selected photos from moment"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowMoveModal(true)}
                  className="w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center hover:bg-blue-100 text-blue-700"
                  title="Move selected photos to another moment"
                >
                  <Move className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center">
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
        </div>

        {/* Carousel - Now part of the header */}
        <AnimatePresence>
          {carouselVisible && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="overflow-hidden pt-4"
            >
              <div className="carousel-container flex space-x-4 overflow-x-auto pb-2">
                {moments.length === 0 && (
                  <div className="bg-gray-100 rounded-lg h-32 min-w-[200px] flex items-center justify-center text-gray-400">
                    No moments yet
                  </div>
                )}
                {moments.map(moment => (
                  <motion.div 
                    key={moment.momentID} 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="relative bg-white rounded-lg shadow flex-shrink-0 w-56 h-32 flex flex-col items-center justify-center p-3 border border-gray-100 cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => scrollToMoment(moment.momentID)}
                  >
                    <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded overflow-hidden flex items-center justify-center mb-2">
                      {moment.representative_photo ? (
                        <img src={moment.representative_photo} alt="" className="object-cover w-full h-full" loading="lazy" />
                      ) : (
                        <Image className="w-8 h-8 text-white" />
                      )}
                    </div>
                    <div className="text-center">
                      <div className="text-base font-semibold truncate max-w-[7rem]">{moment.label}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[7rem]">
                        {formatTimeOnly(moment.start)} - {formatTimeOnly(moment.end)}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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
                  <div className="text-base font-bold text-gray-900 mb-1 leading-tight">{currentVisibleMoment.label}</div>
                  <div className="text-xs text-gray-700 mb-1 font-medium">
                    {formatTimeOnly(currentVisibleMoment.start)} - {formatTimeOnly(currentVisibleMoment.end)}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDate(currentVisibleMoment.start)}
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
                <MomentCard
                  key={moment.momentID}
                  moment={moment}
                  photos={momentPhotosMap[moment.momentID] || []}
                  viewMode={viewMode}
                  photoSize={photoSize}
                  globalSelection={globalSelection}
                  onPhotoSelect={handlePhotoSelect}
                  onOpenPhotoViewer={openPhotoViewer}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <EditMomentsModal
        onSave={handleSaveMoments}
        onDelete={handleDeleteMoment}
        moments={moments}
        images={images}
        momentPhotosMap={momentPhotosMap}
        onRefreshPhotos={fetchAllMomentPhotos}
        onOpenEditPhotos={handleOpenEditPhotos}
      />

      <EditMomentPhotosModal
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
              value={targetMoment?.momentID || ''}
              onChange={(e) => setTargetMoment(moments.find(m => m.momentID === e.target.value))}
              className="w-full border rounded px-3 py-2 mb-4"
            >
              <option value="">Select a moment...</option>
              {moments.map(m => (
                <option key={m.momentID} value={m.momentID}>{m.label}</option>
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