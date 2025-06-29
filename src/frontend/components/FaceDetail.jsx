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
  Filter
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

  useEffect(() => {
    const foundGroup = groups.find(g => g.id.toString() === groupId);
    if (foundGroup) {
      setGroup(foundGroup);
    } else {
      navigate('/');
    }
  }, [groupId, groups, navigate]);

  const filteredPhotos = group?.image_ids?.filter(photoId =>
    photoId.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const handleDownloadGroup = async () => {
    try {
      console.log('Starting download for group:', group.id);
      const response = await fetch(`/api/groups/${group.id}/download`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
      const blob = await response.blob();
      console.log('Download blob received, size:', blob.size);
      
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
      console.log('Download completed successfully');
    } catch (error) {
      console.error('Error downloading group:', error);
      alert(`Failed to download photos: ${error.message}. Please try again.`);
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedPhotos.size === 0) return;
    
    try {
      console.log('Starting download for selected photos:', Array.from(selectedPhotos));
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
      console.log('Download blob received, size:', blob.size);
      
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
      console.log('Download completed successfully');
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
    setSelectedPhotos(new Set(filteredPhotos));
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
      photo: filteredPhotos[newIndex],
      index: newIndex
    });
  };

  if (!group) {
    return <div>Loading...</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
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
                  src={`/crops/${group.representative_crop || group.representative}`}
                  alt={group.label || `Person ${group.id}`}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.src = `/images/${group.representative}`;
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

          <div className="flex items-center space-x-3">
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
      {filteredPhotos.length === 0 ? (
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
          className={viewMode === 'grid' ? 'gallery-grid' : 'space-y-4'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {filteredPhotos.map((photoId, index) => (
            <motion.div
              key={photoId}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              className={viewMode === 'grid' ? '' : 'flex items-center space-x-4 p-4 bg-white rounded-lg border border-gray-200'}
            >
              {viewMode === 'grid' ? (
                <div className="relative group cursor-pointer" onClick={() => openPhotoViewer(photoId, index)}>
                  <input
                    type="checkbox"
                    checked={selectedPhotos.has(photoId)}
                    onChange={(e) => {
                      e.stopPropagation();
                      togglePhotoSelection(photoId);
                    }}
                    className="absolute top-2 left-2 z-10 w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500"
                  />
                  <img
                    src={`/images/${photoId}`}
                    alt={`Photo ${index + 1}`}
                    className="face-image"
                  />
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-white">
                      <Image className="w-8 h-8 mx-auto mb-1" />
                      <span className="text-sm">Click to view</span>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <input
                    type="checkbox"
                    checked={selectedPhotos.has(photoId)}
                    onChange={() => togglePhotoSelection(photoId)}
                    className="w-5 h-5 text-primary-600 bg-white rounded border-gray-300 focus:ring-primary-500"
                  />
                  <img
                    src={`/images/${photoId}`}
                    alt={`Photo ${index + 1}`}
                    className="w-20 h-20 object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => openPhotoViewer(photoId, index)}
                  />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{photoId}</p>
                    <p className="text-sm text-gray-500">Photo {index + 1}</p>
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
        />
      )}
    </div>
  );
} 