import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUp, ArrowDown, Filter } from 'lucide-react';

function formatDateTime(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return dateString;
  }
}

function EditPhotosModal({ open, onClose, moment, momentPhotosMap, onRefreshPhotos, onSave, moments }) {
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [allImagesWithTimestamps, setAllImagesWithTimestamps] = useState([]);
  const [photosInPeriod, setPhotosInPeriod] = useState([]);
  const [sortOrder, setSortOrder] = useState('asc');
  const [filterType, setFilterType] = useState('all'); // 'all', 'in-moment', 'not-in-moment', 'in-period'
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && moment) {
      // Get current photos for this moment
      const currentPhotos = (momentPhotosMap[moment.id] || []).map(p => p.name);
      setSelectedPhotos(new Set(currentPhotos));
      fetchPhotosInPeriod();
    }
  }, [open, moment, momentPhotosMap]);

  // Fetch all images with timestamps after photosInPeriod is loaded
  useEffect(() => {
    if (open && moment) {
      fetchAllImagesWithTimestamps();
    }
  }, [open, moment, photosInPeriod, momentPhotosMap]);

  useEffect(() => {
    if (open) {
      setError('');
    }
  }, [open]);



  const fetchAllImagesWithTimestamps = async () => {
    try {
      const response = await fetch('/api/images.json');
      const data = await response.json();
      const allImages = data.images || [];
      const imagesWithTimestamps = [];
      
      for (const img of allImages) {
        let date_taken = null;
        
        // First try to get timestamp from momentPhotosMap (assigned photos)
        for (const momentId in momentPhotosMap) {
          const momentPhotos = momentPhotosMap[momentId] || [];
          const foundPhoto = momentPhotos.find(p => p.name === img.name);
          if (foundPhoto && foundPhoto.date_taken) {
            date_taken = foundPhoto.date_taken;
            break;
          }
        }
        
        // If not found in momentPhotosMap, try to get from photosInPeriod
        if (!date_taken && photosInPeriod.length > 0) {
          const periodPhoto = photosInPeriod.find(p => p.name === img.name);
          if (periodPhoto && periodPhoto.date_taken) {
            date_taken = periodPhoto.date_taken;
          }
        }
        
        imagesWithTimestamps.push({
          name: img.name,
          date_taken: date_taken
        });
      }
      
      setAllImagesWithTimestamps(imagesWithTimestamps);
    } catch (error) {
      setAllImagesWithTimestamps([]);
    }
  };

  const fetchPhotosInPeriod = async () => {
    if (!moment) return;
    try {
      const response = await fetch(`/api/moments/${moment.id}/photos-in-period`);
      if (response.ok) {
        const data = await response.json();
        setPhotosInPeriod(data.photos || []);
      } else {
        setPhotosInPeriod([]);
      }
    } catch (error) {
      setPhotosInPeriod([]);
    }
  };

  const handleSavePhotos = async () => {
    try {
      setError('');
      const updatedMoment = {
        ...moment,
        photos: Array.from(selectedPhotos)
      };
      const response = await fetch(`/api/moments/${moment.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedMoment)
      });
      if (!response.ok) {
        throw new Error('Failed to save photo changes');
      }
      const result = await response.json();
      if (typeof onSave === 'function') {
        await onSave(result.moment); // Pass the updated moment
      }
      if (onRefreshPhotos) {
        onRefreshPhotos();
      }
      setError(''); // Clear error after successful save
      onClose();
    } catch (error) {
      setError('Failed to save photo changes. Please try again.');
      console.error('Error saving photo changes:', error);
    }
  };

  const handleClose = () => {
    setError('');
    onClose();
  };

  const togglePhoto = (photoName) => {
    setSelectedPhotos(prev => {
      const next = new Set(prev);
      if (next.has(photoName)) {
        next.delete(photoName);
      } else {
        next.add(photoName);
      }
      return next;
    });
  };

  const toggleSortOrder = () => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  const selectAllFiltered = () => {
    const filteredImages = getFilteredAndSortedImages();
    const filteredPhotoNames = filteredImages.map(img => img.name);
    setSelectedPhotos(prev => {
      const next = new Set(prev);
      filteredPhotoNames.forEach(name => next.add(name));
      return next;
    });
  };

  // Use moments array to get the title for a moment ID
  const getPhotoMomentInfo = (photoName) => {
    for (const momentId in momentPhotosMap) {
      const momentPhotos = momentPhotosMap[momentId] || [];
      const foundPhoto = momentPhotos.find(p => p.name === photoName);
      if (foundPhoto) {
        const momentObj = moments.find(m => m.id === momentId);
        return {
          momentId: momentId,
          title: momentObj ? momentObj.title : momentId,
          isCurrentMoment: moment && momentId === moment.id
        };
      }
    }
    return null;
  };

  const isPhotoInPeriod = (photoName) => {
    return photosInPeriod.some(p => p.name === photoName);
  };

  const getFilteredAndSortedImages = () => {
    let filteredImages = allImagesWithTimestamps;
    if (filterType === 'in-moment') {
      filteredImages = filteredImages.filter(img => 
        (momentPhotosMap[moment?.id] || []).some(p => p.name === img.name)
      );
    } else if (filterType === 'not-in-moment') {
      filteredImages = filteredImages.filter(img => 
        !(momentPhotosMap[moment?.id] || []).some(p => p.name === img.name)
      );
    } else if (filterType === 'in-period') {
      filteredImages = photosInPeriod;
    }
    
    // Sort by date_taken, with photos without timestamps sorted by filename
    filteredImages.sort((a, b) => {
      const hasDateA = !!a.date_taken;
      const hasDateB = !!b.date_taken;
      
      // If both have dates, sort by date
      if (hasDateA && hasDateB) {
        const dateA = new Date(a.date_taken);
        const dateB = new Date(b.date_taken);
        return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
      }
      
      // If only one has a date, prioritize the one with date
      if (hasDateA && !hasDateB) return sortOrder === 'asc' ? -1 : 1;
      if (!hasDateA && hasDateB) return sortOrder === 'asc' ? 1 : -1;
      
      // If neither has a date, sort by filename
      return sortOrder === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
    });
    
    return filteredImages;
  };

  if (!open || !moment) return null;

  return (
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
        className="bg-white rounded-lg shadow-lg w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold">Edit Photos: {moment.title}</h3>
            <div className="flex space-x-2">
              <button onClick={handleSavePhotos} className="btn-primary">Save Changes</button>
              <button onClick={handleClose} className="btn-secondary">Cancel</button>
            </div>
          </div>
          {error && (
            <div className="mt-2 text-red-600 text-sm">{error}</div>
          )}
          {/* Filter and Sort Controls */}
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center space-x-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Filter:</span>
              <button
                onClick={() => setFilterType('all')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  filterType === 'all' 
                    ? 'bg-primary-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterType('in-moment')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  filterType === 'in-moment' 
                    ? 'bg-primary-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                In Moment
              </button>
              <button
                onClick={() => setFilterType('not-in-moment')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  filterType === 'not-in-moment' 
                    ? 'bg-primary-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Not in Moment
              </button>
              <button
                onClick={() => setFilterType('in-period')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  filterType === 'in-period' 
                    ? 'bg-primary-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                In Period
              </button>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={selectAllFiltered}
                className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
              >
                Select All
              </button>
              <span className="text-sm font-medium text-gray-700">Sort:</span>
              <button
                onClick={toggleSortOrder}
                className="p-2 text-gray-600 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                title={`Sort ${sortOrder === 'asc' ? 'Descending' : 'Ascending'}`}
              >
                {sortOrder === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {getFilteredAndSortedImages().map((photo) => {
              const isSelected = selectedPhotos.has(photo.name);
              const momentInfo = getPhotoMomentInfo(photo.name);
              const isInPeriod = isPhotoInPeriod(photo.name);
              return (
                <div
                  key={photo.name}
                  onClick={() => togglePhoto(photo.name)}
                  className={`relative cursor-pointer border rounded-lg overflow-hidden hover:border-primary-500 transition-colors ${
                    isSelected ? 'border-primary-500 ring-2 ring-primary-200' : 
                    isInPeriod && !momentInfo ? 'border-red-500 ring-2 ring-red-200' : ''
                  }`}
                >
                  <img
                    src={`/images/${photo.name}`}
                    alt={photo.name}
                    className="w-full h-24 object-cover"
                  />
                  <div className="p-2 text-xs text-gray-600 truncate">
                    {photo.date_taken ? formatDateTime(photo.date_taken) : photo.name}
                  </div>
                  {momentInfo && (
                    <div className={`absolute top-2 right-2 text-white text-xs px-1 py-0.5 rounded ${
                      momentInfo.isCurrentMoment ? 'bg-green-500' : 'bg-red-500'
                    }`}>
                      {momentInfo.title}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default EditPhotosModal; 