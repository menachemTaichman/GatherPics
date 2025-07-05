import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  ArrowLeft, 
  Download, 
  Edit, 
  Trash2, 
  User, 
  Image, 
  Grid, 
  List,
  Search,
  Filter,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Minus,
  Plus
} from 'lucide-react';
import EditGroupModal from './EditGroupModal';
import DeleteConfirmModal from './DeleteConfirmModal';
import PhotoViewer from './PhotoViewer';

export default function FaceDetail({ groups, onUpdateGroup, onDeleteGroup }) {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
  const [searchTerm, setSearchTerm] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [photoViewer, setPhotoViewer] = useState({ show: false, photo: null, index: 0 });
  const [photoClasses, setPhotoClasses] = useState({});
  const [sortedPhotos, setSortedPhotos] = useState([]);
  const [sortBy, setSortBy] = useState('date'); // 'date' or 'name'
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' or 'desc'
  const [loading, setLoading] = useState(false);
  const [photoSize, setPhotoSize] = useState(1); // 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3

  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';
  const PLACEHOLDER_DATA_URL =
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';

  useEffect(() => {
    const foundGroup = groups.find(g => g.id.toString() === groupId);
    if (foundGroup) {
      setGroup(foundGroup);
    } else {
      navigate('/');
    }
  }, [groupId, groups, navigate]);

  // Fetch sorted photos from backend
  useEffect(() => {
    if (group && group.id !== undefined && group.id !== null) {
      fetchSortedPhotos();
    }
  }, [group, sortBy, sortOrder]);

  const fetchSortedPhotos = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${API_BASE}/api/groups/${group.id}/photos?sort_by=${sortBy}&sort_order=${sortOrder}`
      );
      
      if (response.ok) {
        const data = await response.json();
        setSortedPhotos(data.photos || []);
      } else {
        console.error('Failed to fetch sorted photos');
        setSortedPhotos(group.image_ids?.map(id => ({ photo_id: id, date_taken: null, formatted_date: null })) || []);
      }
    } catch (error) {
      console.error('Error fetching sorted photos:', error);
      setSortedPhotos(group.image_ids?.map(id => ({ photo_id: id, date_taken: null, formatted_date: null })) || []);
    } finally {
      setLoading(false);
    }
  };

  const filteredPhotos = sortedPhotos.filter(photo =>
    photo.photo_id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleImageLoad = (photoId, e) => {
    const img = e.target;
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    
    // Determine image class based on aspect ratio
    let imageClass = 'square';
    if (aspectRatio > 1.2) {
      imageClass = 'landscape';
    } else if (aspectRatio < 0.8) {
      imageClass = 'portrait';
    }
    
    setPhotoClasses(prev => ({
      ...prev,
      [photoId]: imageClass
    }));
  };

  const toggleSortOrder = () => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Unknown';
      
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch (error) {
      return 'Unknown';
    }
  };

  const handleDownloadGroup = async () => {
    try {
      const response = await fetch(`/api/groups/${group.id}/download`);
      
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
      a.download = `${group.label || `Person_${group.id}`}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading group:', error);
      alert(`Failed to download photos: ${error.message}. Please try again.`);
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedPhotos.size === 0) return;
    
    try {
      const response = await fetch(`/api/groups/${group.id}/download-selected`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoIds: Array.from(selectedPhotos) })
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
      a.download = `${group.label || `Person_${group.id}`}_selected.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading selected photos:', error);
      alert(`Failed to download photos: ${error.message}. Please try again.`);
    }
  };

  const togglePhotoSelection = (photoId) => {
    const newSelected = new Set(selectedPhotos);
    if (newSelected.has(photoId)) {
      newSelected.delete(photoId);
    } else {
      newSelected.add(photoId);
    }
    setSelectedPhotos(newSelected);
  };

  const selectAllPhotos = () => {
    setSelectedPhotos(new Set(filteredPhotos.map(p => p.photo_id)));
  };

  const clearSelection = () => {
    setSelectedPhotos(new Set());
  };

  const openPhotoViewer = (photoId, index) => {
    setPhotoViewer({
      show: true,
      photo: photoId,
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
      newIndex = Math.min(currentIndex + 1, filteredPhotos.length - 1);
    } else {
      newIndex = Math.max(currentIndex - 1, 0);
    }
    
    setPhotoViewer({
      show: true,
      photo: filteredPhotos[newIndex].photo_id,
      index: newIndex
    });
  };

  if (!group) {
    return <div>Loading...</div>;
  }

  return (
    <div className="w-full px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center">
          <div className="flex items-center space-x-4">
            <Link
              to="/"
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </Link>
            <div className="flex items-center space-x-4">
              <div className="w-16 h-16 rounded-lg overflow-hidden border border-gray-200">
                <img
                  src={group.representative_crop
                    ? `${API_BASE}/crops/${group.representative_crop}`
                    : `${API_BASE}/images/${group.representative}`}
                  alt={group.label || `Person ${group.id}`}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    if (e.target.src.includes('/crops/') && group.representative) {
                      e.target.onerror = () => { e.target.src = PLACEHOLDER_DATA_URL; };
                      e.target.src = `${API_BASE}/images/${group.representative}`;
                    } else {
                      e.target.src = PLACEHOLDER_DATA_URL;
                    }
                  }}
                />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  {group.label || `Person ${group.id}`}
                </h1>
                <p className="text-gray-600">
                  {filteredPhotos.length} of {group.image_ids?.length || 0} photos
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3 min-w-max ml-auto">
            <button
              onClick={() => setShowEditModal(true)}
              className="btn-secondary flex items-center space-x-2"
            >
              <Edit className="w-4 h-4" />
              <span>Edit</span>
            </button>
            <button
              onClick={handleDownloadGroup}
              className="btn-primary flex items-center space-x-2"
            >
              <Download className="w-4 h-4" />
              <span>Download All</span>
            </button>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 flex items-center space-x-2"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search photos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent w-64"
            />
          </div>
          
          {/* Sort Controls */}
          <div className="flex items-center space-x-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
            >
              <option value="date">Sort by Date</option>
              <option value="name">Sort by Name</option>
            </select>
            
            <button
              onClick={toggleSortOrder}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center space-x-1"
              title={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
            >
              {sortOrder === 'asc' ? (
                <ArrowUp className="w-4 h-4" />
              ) : (
                <ArrowDown className="w-4 h-4" />
              )}
            </button>
          </div>
          
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

          {/* Size Control - Only show in grid mode */}
          {viewMode === 'grid' && (
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
          )}
        </div>

        {selectedPhotos.size > 0 && (
          <div className="flex items-center space-x-3">
            <span className="text-sm text-gray-600">
              {selectedPhotos.size} selected
            </span>
            <button
              onClick={handleDownloadSelected}
              className="btn-primary flex items-center space-x-2"
            >
              <Download className="w-4 h-4" />
              <span>Download Selected</span>
            </button>
            <button
              onClick={clearSelection}
              className="btn-secondary"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Selection Controls */}
      {filteredPhotos.length > 0 && (
        <div className="mb-4 flex items-center space-x-3">
          <button
            onClick={selectAllPhotos}
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
          >
            Select All
          </button>
          {selectedPhotos.size > 0 && (
            <button
              onClick={clearSelection}
              className="text-sm text-gray-600 hover:text-gray-700"
            >
              Clear Selection
            </button>
          )}
        </div>
      )}

      {/* Photos Grid/List */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="text-gray-500 mt-2">Loading photos...</p>
        </div>
      ) : filteredPhotos.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-12"
        >
          <Image className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchTerm ? 'No photos found' : 'No photos in this group'}
          </h3>
          <p className="text-gray-500">
            {searchTerm ? 'Try adjusting your search terms' : 'This face group is empty'}
          </p>
        </motion.div>
      ) : (
        <motion.div
        className={`w-full ${viewMode === 'grid' ? `photo-gallery-grid size-${Math.round(photoSize * 100).toString().padStart(3, '0')}` : 'space-y-4 max-w-3xl mx-auto block'}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {filteredPhotos.map((photo, index) => (
            <motion.div
              key={photo.photo_id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              className={viewMode === 'grid' ? `photo-card ${photoClasses[photo.photo_id] || 'square'}` : 'flex items-center justify-between space-x-4 p-4 bg-white rounded-lg border border-gray-200 w-full'}
            >
              {viewMode === 'grid' ? (
                <div className="relative group cursor-pointer h-full" onClick={() => openPhotoViewer(photo.photo_id, index)}>
                  <input
                    type="checkbox"
                    checked={selectedPhotos.has(photo.photo_id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      togglePhotoSelection(photo.photo_id);
                    }}
                    onClick={e => e.stopPropagation()}
                    className="absolute top-2 left-2 z-10 w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500"
                  />
                  <img
                    src={`${API_BASE}/images/${photo.photo_id}`}
                    alt={`Photo ${index + 1}`}
                    className="w-full h-full object-cover rounded-lg"
                    onLoad={(e) => handleImageLoad(photo.photo_id, e)}
                    onError={(e) => {
                      e.target.onerror = () => { e.target.src = PLACEHOLDER_DATA_URL; };
                      e.target.src = PLACEHOLDER_DATA_URL;
                    }}
                  />
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 flex items-center justify-center rounded-lg">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-white">
                      <Image className="w-8 h-8 mx-auto mb-1" />
                      <span className="text-sm">Click to view</span>
                    </div>
                  </div>
                  {/* Date overlay */}
                  {photo.formatted_date && (
                    <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
                      {formatDate(photo.formatted_date)}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <input
                    type="checkbox"
                    checked={selectedPhotos.has(photo.photo_id)}
                    onChange={(e) => {
                      togglePhotoSelection(photo.photo_id);
                    }}
                    onClick={e => e.stopPropagation()}
                    className="w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500"
                  />
                  <img
                    src={`${API_BASE}/images/${photo.photo_id}`}
                    alt={`Photo ${index + 1}`}
                    className="w-20 h-20 object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => openPhotoViewer(photo.photo_id, index)}
                    onError={(e) => {
                      e.target.onerror = () => { e.target.src = PLACEHOLDER_DATA_URL; };
                      e.target.src = PLACEHOLDER_DATA_URL;
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900">{photo.photo_id}</p>
                    <p className="text-sm text-gray-500">
                      {photo.formatted_date ? formatDate(photo.formatted_date) : 'Unknown date'}
                    </p>
                  </div>
                </>
              )}
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Modals */}
      {showEditModal && (
        <EditGroupModal
          group={group}
          onClose={() => setShowEditModal(false)}
          onSave={async (updates) => {
            await onUpdateGroup(group.id, updates);
            setGroup(prev => ({ ...prev, ...updates }));
            setShowEditModal(false);
          }}
        />
      )}

      {showDeleteModal && (
        <DeleteConfirmModal
          group={group}
          onClose={() => setShowDeleteModal(false)}
          onConfirm={async () => {
            await onDeleteGroup(group.id);
            navigate('/');
          }}
        />
      )}

      {/* Photo Viewer */}
      {photoViewer.show && (
        <PhotoViewer
          photo={photoViewer.photo}
          onClose={closePhotoViewer}
          onNavigate={navigatePhoto}
          totalPhotos={filteredPhotos.length}
          currentIndex={photoViewer.index}
          currentGroupId={group.id}
        />
      )}
    </div>
  );
} 