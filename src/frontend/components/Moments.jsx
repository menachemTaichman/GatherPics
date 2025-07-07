import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { Pencil, Trash2, Download, CheckSquare, Square, Image, Grid, List, Minus, Plus, X, ChevronLeft, ChevronRight, Settings, Edit3, Move, Plus as PlusIcon } from 'lucide-react';

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

function EditMomentsModal({ open, onClose, moments, images, onSave, onDelete, momentPhotosMap }) {
  const [editingMoments, setEditingMoments] = useState([]);
  const [selectedMoment, setSelectedMoment] = useState(null);
  const [showPhotoSelector, setShowPhotoSelector] = useState(false);
  const [showEditPhotos, setShowEditPhotos] = useState(false);
  const [editingPhotosForMoment, setEditingPhotosForMoment] = useState(null);
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());

  useEffect(() => {
    if (open) {
      setEditingMoments([...moments]);
    }
  }, [open, moments]);

  const handleSave = () => {
    onSave(editingMoments);
    onClose();
  };

  const handleDelete = (id) => {
    if (confirm('Are you sure you want to delete this moment?')) {
      onDelete(id);
    }
  };

  const updateMoment = (id, updates) => {
    setEditingMoments(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  };

  const addMoment = () => {
    const newMoment = {
      id: `temp-${Date.now()}`,
      title: '',
      start_datetime: '',
      end_datetime: '',
      representative_photo: '',
      description: ''
    };
    setEditingMoments(prev => [...prev, newMoment]);
  };

  const formatDateTime = (dateString) => {
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
  };

  const handleEditPhotos = (moment) => {
    setEditingPhotosForMoment(moment);
    setSelectedPhotos(new Set((momentPhotosMap[moment.id] || []).map(p => p.name)));
    setShowEditPhotos(true);
  };

  const handleSavePhotos = () => {
    // Handle saving the new photo selection
    console.log('Saving photo selection for moment:', editingPhotosForMoment.id, Array.from(selectedPhotos));
    setShowEditPhotos(false);
    setEditingPhotosForMoment(null);
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold">Edit Moments</h3>
            <div className="flex space-x-2">
              <button onClick={addMoment} className="btn-secondary">Add Moment</button>
              <button onClick={handleSave} className="btn-primary">Save All</button>
              <button onClick={onClose} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            {editingMoments.map((moment, index) => (
              <div key={moment.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start mb-4">
                  <h4 className="font-semibold">Moment {index + 1}</h4>
                  <div className="flex space-x-2">
                    <button 
                      onClick={() => handleEditPhotos(moment)}
                      className="btn-secondary flex items-center space-x-2"
                    >
                      <Pencil className="w-4 h-4" />
                      <span>Edit Photos</span>
                    </button>
                    <button 
                      onClick={() => handleDelete(moment.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Title</label>
                    <input
                      type="text"
                      value={moment.title}
                      onChange={(e) => updateMoment(moment.id, { title: e.target.value })}
                      className="w-full border rounded px-3 py-2"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">Description</label>
                    <textarea
                      value={moment.description}
                      onChange={(e) => updateMoment(moment.id, { description: e.target.value })}
                      className="w-full border rounded px-3 py-2"
                      rows="2"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">Start Time</label>
                    <input
                      type="datetime-local"
                      value={moment.start_datetime}
                      onChange={(e) => updateMoment(moment.id, { start_datetime: e.target.value })}
                      className="w-full border rounded px-3 py-2"
                    />
                    {moment.start_datetime && (
                      <div className="text-xs text-gray-500 mt-1">
                        {formatDateTime(moment.start_datetime)}
                      </div>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">End Time</label>
                    <input
                      type="datetime-local"
                      value={moment.end_datetime}
                      onChange={(e) => updateMoment(moment.id, { end_datetime: e.target.value })}
                      className="w-full border rounded px-3 py-2"
                    />
                    {moment.end_datetime && (
                      <div className="text-xs text-gray-500 mt-1">
                        {formatDateTime(moment.end_datetime)}
                      </div>
                    )}
                  </div>
                  
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium mb-1">Representative Photo</label>
                    <div className="flex items-center space-x-3">
                      {moment.representative_photo && (
                        <div className="w-16 h-16 rounded overflow-hidden border">
                          <img 
                            src={`/images/${moment.representative_photo}`} 
                            alt="" 
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      <button
                        onClick={() => {
                          setSelectedMoment(moment);
                          setShowPhotoSelector(true);
                        }}
                        className="btn-secondary"
                      >
                        {moment.representative_photo ? 'Change Photo' : 'Select Photo'}
                      </button>
                      {moment.representative_photo && (
                        <button
                          onClick={() => updateMoment(moment.id, { representative_photo: '' })}
                          className="text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Photo Selector Modal */}
      {showPhotoSelector && selectedMoment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b">
              <div className="flex justify-between items-center">
                <h4 className="font-semibold">Select Representative Photo</h4>
                <button onClick={() => setShowPhotoSelector(false)} className="text-gray-500 hover:text-gray-700">
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {(momentPhotosMap[selectedMoment.id] || []).map((img) => (
                  <div
                    key={img.name}
                    onClick={() => {
                      updateMoment(selectedMoment.id, { representative_photo: img.name });
                      setShowPhotoSelector(false);
                    }}
                    className="cursor-pointer border rounded-lg overflow-hidden hover:border-primary-500 transition-colors"
                  >
                    <img
                      src={`/images/${img.name}`}
                      alt={img.name}
                      className="w-full h-24 object-cover"
                    />
                    <div className="p-2 text-xs text-gray-600 truncate">
                      {img.name}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Photos Modal */}
      {showEditPhotos && editingPhotosForMoment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold">Edit Photos: {editingPhotosForMoment.title}</h3>
                <div className="flex space-x-2">
                  <button onClick={handleSavePhotos} className="btn-primary">Save Changes</button>
                  <button onClick={() => setShowEditPhotos(false)} className="btn-secondary">Cancel</button>
                </div>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {images.map((photo) => (
                  <div
                    key={photo.name}
                    onClick={() => togglePhoto(photo.name)}
                    className={`relative cursor-pointer border rounded-lg overflow-hidden hover:border-primary-500 transition-colors ${
                      selectedPhotos.has(photo.name) ? 'border-primary-500 ring-2 ring-primary-200' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedPhotos.has(photo.name)}
                      readOnly
                      className="absolute top-2 left-2 z-10 w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500"
                    />
                    <img
                      src={`/images/${photo.name}`}
                      alt={photo.name}
                      className="w-full h-24 object-cover"
                    />
                    <div className="p-2 text-xs text-gray-600 truncate">
                      {photo.name}
                    </div>
                    {(momentPhotosMap[editingPhotosForMoment.id] || []).some(p => p.name === photo.name) && (
                      <div className="absolute top-2 right-2 bg-green-500 text-white text-xs px-1 py-0.5 rounded">
                        In Moment
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PhotoGrid({ momentId, viewMode, photoSize, onPhotoSelect, selectedPhotos, globalSelection }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [photoViewer, setPhotoViewer] = useState({ show: false, photo: null, index: 0 });
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
    setPhotoViewer({
      show: true,
      photo: photoName,
      index: index
    });
  };

  const closePhotoViewer = () => {
    setPhotoViewer({ show: false, photo: null, index: 0 });
  };

  const navigatePhoto = (direction) => {
    const currentIndex = photoViewer.index;
    let newIndex;
    
    if (direction === 'next') {
      newIndex = Math.min(currentIndex + 1, photos.length - 1);
    } else {
      newIndex = Math.max(currentIndex - 1, 0);
    }
    
    setPhotoViewer({
      show: true,
      photo: photos[newIndex].name,
      index: newIndex
    });
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

      {/* Photo Viewer Modal */}
      {photoViewer.show && (
        <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
          <div className="relative max-w-4xl max-h-full">
            <button
              onClick={closePhotoViewer}
              className="absolute top-4 right-4 text-white hover:text-gray-300 z-10"
            >
              <X className="w-8 h-8" />
            </button>
            <img
              src={`/images/${photoViewer.photo}`}
              alt="Full size"
              className="max-w-full max-h-full object-contain"
            />
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-4">
              <button
                onClick={() => navigatePhoto('prev')}
                disabled={photoViewer.index === 0}
                className="text-white hover:text-gray-300 disabled:opacity-50"
              >
                <ChevronLeft className="w-8 h-8" />
              </button>
              <span className="text-white text-lg">
                {photoViewer.index + 1} / {photos.length}
              </span>
              <button
                onClick={() => navigatePhoto('next')}
                disabled={photoViewer.index === photos.length - 1}
                className="text-white hover:text-gray-300 disabled:opacity-50"
              >
                <ChevronRight className="w-8 h-8" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Moments() {
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

  const momentsRef = useRef({});

  useEffect(() => {
    fetchMoments();
    fetchImages();
  }, []);

  useEffect(() => {
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

  const handleSaveMoments = async (updatedMoments) => {
    try {
      for (const moment of updatedMoments) {
        if (moment.id.startsWith('temp-')) {
          const { id, ...momentData } = moment;
          await axios.post('/api/moments', momentData);
        } else {
          await axios.put(`/api/moments/${moment.id}`, moment);
        }
      }
      fetchMoments();
    } catch (error) {
      alert('Failed to save moments.');
    }
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
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (loading) return <div className="p-8 text-center">Loading moments...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="w-full">
      {/* Sticky Carousel */}
      <div className="sticky top-16 bg-gray-50 border-b border-gray-200 z-30">
        <div className="py-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">Moments</h2>
            <div className="flex items-center space-x-2">
              {globalSelection.size > 0 && (
                <>
                  <button onClick={handleGlobalDownload} className="btn-primary flex items-center space-x-2">
                    <Download className="w-4 h-4" />
                    <span>Download ({globalSelection.size})</span>
                  </button>
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
              <button onClick={() => setShowEditModal(true)} className="btn-primary flex items-center space-x-2">
                <Settings className="w-4 h-4" />
                <span>Edit Moments</span>
              </button>
            </div>
          </div>
          
          {/* Universal Controls */}
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
          </div>

          {/* Carousel */}
          <div className="flex space-x-4 overflow-x-auto pb-2">
            {moments.length === 0 && (
              <div className="bg-gray-100 rounded-lg h-32 min-w-[200px] flex items-center justify-center text-gray-400">
                No moments yet
              </div>
            )}
            {moments.map(moment => (
              <div 
                key={moment.id} 
                className="relative bg-white rounded-lg shadow flex-shrink-0 w-56 h-32 flex flex-col items-center justify-center p-3 border border-gray-100 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => scrollToMoment(moment.id)}
              >
                <div className="w-20 h-20 bg-gray-200 rounded overflow-hidden flex items-center justify-center mb-2">
                  {moment.representative_photo ? (
                    <img src={`/images/${moment.representative_photo}`} alt="" className="object-cover w-full h-full" />
                  ) : (
                    <span className="text-gray-400">No photo</span>
                  )}
                </div>
                <div className="text-center">
                  <div className="text-base font-semibold truncate max-w-[7rem]">{moment.title}</div>
                  <div className="text-xs text-gray-500 truncate max-w-[7rem]">
                    {formatTimeOnly(moment.start_datetime)} - {formatTimeOnly(moment.end_datetime)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Moments Content */}
      <div className="py-8">
        <div className="space-y-8">
          {moments.length === 0 && <div className="text-gray-500">No moments yet.</div>}
          {moments.map(moment => (
            <div 
              key={moment.id} 
              className="bg-white rounded-lg shadow p-6"
              ref={el => momentsRef.current[moment.id] = el}
            >
              <div className="flex items-center space-x-4 mb-2">
                <div className="w-16 h-16 bg-gray-200 rounded overflow-hidden flex items-center justify-center">
                  {moment.representative_photo ? (
                    <img src={`/images/${moment.representative_photo}`} alt="" className="object-cover w-full h-full" />
                  ) : (
                    <span className="text-gray-400">No photo</span>
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-lg font-semibold">{moment.title}</div>
                  <div className="text-sm text-gray-500">
                    {formatTimeOnly(moment.start_datetime)} - {formatTimeOnly(moment.end_datetime)}
                  </div>
                </div>
              </div>
              <div className="text-gray-600 mt-2">{moment.description}</div>
              {/* Photos for this moment */}
              <PhotoGrid 
                momentId={moment.id} 
                viewMode={viewMode} 
                photoSize={photoSize}
                onPhotoSelect={handlePhotoSelect}
                selectedPhotos={new Set()}
                globalSelection={globalSelection}
              />
            </div>
          ))}
        </div>
      </div>

      <EditMomentsModal 
        open={showEditModal} 
        onClose={() => setShowEditModal(false)} 
        onSave={handleSaveMoments}
        onDelete={handleDeleteMoment}
        moments={moments}
        images={images}
        momentPhotosMap={momentPhotosMap}
      />

      {/* Move Modal */}
      {showMoveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
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
          </div>
        </div>
      )}
    </div>
  );
} 