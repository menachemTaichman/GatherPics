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
  Plus,
  Crop
} from 'lucide-react';
import EditGroupModal from './EditGroupModal';
import DeleteConfirmModal from './DeleteConfirmModal';
import PhotoViewer from './PhotoViewer';
import { sortPhotos, toggleSortOrder } from '../utils/sorting';
import { useSetting } from '../utils/useSettings';

export default function FaceDetail({ groups, onUpdateGroup, onDeleteGroup }) {
  const { group_name } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [viewMode, setViewMode] = useSetting('faceDetail_viewMode', 'grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [photoViewer, setPhotoViewer] = useState({ show: false, photo: null, index: 0 });
  const [photoClasses, setPhotoClasses] = useState({});
  const [sortedPhotos, setSortedPhotos] = useState([]);
  const [sortBy, setSortBy] = useSetting('faceDetail_sortBy', 'date');
  const [sortOrder, setSortOrder] = useSetting('faceDetail_sortOrder', 'asc');
  const [loading, setLoading] = useState(false);
  const [photoSize, setPhotoSize] = useSetting('faceDetail_photoSize', 1.0);
  const [showCrops, setShowCrops] = useState(false);
  const [imageCrops, setImageCrops] = useState({});
  const [photoSizeInputValue, setPhotoSizeInputValue] = useState();

  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';
  const FIXED_EVENT_ID = "75cb6635-879d-4386-b023-366444dc0fb2";
  const PLACEHOLDER_DATA_URL =
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';

  useEffect(() => {
    const foundGroup = groups.find(g => g.label === group_name);
    if (foundGroup) {
      setGroup(foundGroup);
    } else {
      navigate('/');
    }
  }, [group_name, groups, navigate]);

  // Fetch sorted photos from backend
  useEffect(() => {
    if (group && group.groupID !== undefined && group.groupID !== null) {
      fetchSortedPhotos();
    }
  }, [group]); // Removed sortBy and sortOrder dependencies for frontend sorting

  // Fetch crop data when group changes
  useEffect(() => {
    if (group && group.groupID !== undefined && group.groupID !== null) {
      fetchGroupCrops();
    }
  }, [group]);

  const fetchGroupCrops = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/groups/${group.groupID}/crops`);
      if (response.ok) {
        const data = await response.json();
        setImageCrops(data.crop_mapping || {});
      } else {
        console.error('Failed to fetch group crops');
        setImageCrops({});
      }
    } catch (error) {
      console.error('Error fetching group crops:', error);
      setImageCrops({});
    }
  };

  const fetchSortedPhotos = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${API_BASE}/api/groups/${group.groupID}/photos-complete`
      );
      
      if (response.ok) {
        const data = await response.json();
        // Transform the complete photo data to match expected format
        const transformedPhotos = data.photos.map(photo => ({
          photo_id: photo.id,
          name: photo.name, // Use the name from backend
          date_taken: photo.date_taken,
          formatted_date: photo.date_taken,
          urls: photo.urls,
          faces: photo.faces,
          moment: photo.moment
        }));
        setSortedPhotos(transformedPhotos);
      } else {
        console.error('Failed to fetch sorted photos');
        setSortedPhotos(group.image_ids?.map(id => ({ photo_id: id, name: id, date_taken: null, formatted_date: null })) || []);
      }
    } catch (error) {
      console.error('Error fetching sorted photos:', error);
      setSortedPhotos(group.image_ids?.map(id => ({ photo_id: id, name: id, date_taken: null, formatted_date: null })) || []);
    } finally {
      setLoading(false);
    }
  };

  // Client-side sorting function using global utility
  const getSortedPhotos = () => {
    return sortPhotos(sortedPhotos, sortBy, sortOrder);
  };

  const filteredPhotos = getSortedPhotos().filter(photo =>
    photo.name.toLowerCase().includes(searchTerm.toLowerCase())
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

  const handleToggleSortOrder = () => {
    setSortOrder(prev => toggleSortOrder(prev));
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

  const handleAddGroupToBucket = async () => {
    // TODO: Implement add to bucket functionality
    alert('Add to bucket functionality will be implemented later');
  };

  const handleAddSelectedToBucket = async () => {
    if (selectedPhotos.size === 0) return;
    
    // TODO: Implement add selected to bucket functionality
    alert(`Add ${selectedPhotos.size} selected photos to bucket functionality will be implemented later`);
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
    // Use the photo data directly since it comes from the API
    const photoMeta = { name: photoId };
    setPhotoViewer({
      show: true,
      photo: photoMeta,
      index: index
    });
  };

  const closePhotoViewer = () => {
    setPhotoViewer({ show: false, photo: null, index: 0 });
  };

  const navigatePhoto = (direction, index) => {
    const currentIndex = photoViewer.index;
    let newIndex;
    if (direction === 'jump' && typeof index === 'number') {
      newIndex = index;
    } else if (direction === 'next') {
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

  const handleJumpToMoment = (momentInfo) => {
    // Navigate to the moments page and scroll to the specific moment
    navigate('/moments', { state: { scrollToMoment: momentInfo.id } });
  };

  if (!group) {
    return <div>Loading...</div>;
  }

  return (
    <div className="w-full">
      {/* Pinned Header */}
      <div className="sticky top-16 z-30 bg-white border-b border-gray-200 px-8 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link
              to="/"
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </Link>
            <div className="flex items-center space-x-4">
              <div className="w-16 h-16 rounded-full overflow-hidden border border-gray-200 shadow-lg">
                <img
                  src={group.face_representive
                    ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${group.face_representive}.webp`
                    : PLACEHOLDER_DATA_URL}
                  alt={group.label || `Person ${group.groupID}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = PLACEHOLDER_DATA_URL;
                  }}
                />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  {group.label || `Person ${group.groupID}`}
                </h1>
                <p className="text-gray-600">
                  {filteredPhotos.length} of {group.image_ids?.length || 0} photos
                  {showCrops && (
                    <span className="ml-2 text-primary-600 font-medium">
                      • Showing face crops
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3 min-w-max">
            <button
              onClick={() => setShowEditModal(true)}
              className="btn-secondary flex items-center space-x-2"
            >
              <Edit className="w-4 h-4" />
              <span>Edit</span>
            </button>
            <button
              onClick={handleAddGroupToBucket}
              className="btn-primary flex items-center space-x-2"
            >
              <Download className="w-4 h-4" />
              <span>Add All to Bucket</span>
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

        {/* Controls Row */}
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
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
                onClick={handleToggleSortOrder}
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
                  onClick={() => {
                    const currentPercent = Math.round(photoSize * 100);
                    const next25 = Math.ceil(currentPercent / 25) * 25;
                    const prev25 = Math.floor((currentPercent - 1) / 25) * 25;
                    const subtract25 = currentPercent - 25;
                    const newPercent = Math.max(50, Math.max(subtract25, prev25));
                    setPhotoSize(newPercent / 100);
                  }}
                  disabled={photoSize <= 0.5}
                  className="p-1 hover:bg-gray-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                    if (e.key === 'Enter') {
                      e.target.blur();
                    } else if (e.key === 'Escape') {
                      setPhotoSizeInputValue(undefined);
                    }
                  }}
                  className="text-sm font-medium text-gray-700 w-12 text-center bg-transparent border-b border-gray-300 focus:outline-none focus:border-primary-500"
                  style={{width: '3rem'}}
                />
                <button
                  onClick={() => {
                    const currentPercent = Math.round(photoSize * 100);
                    const next25 = Math.ceil((currentPercent + 1) / 25) * 25;
                    const add25 = currentPercent + 25;
                    const newPercent = Math.min(300, Math.min(add25, next25));
                    setPhotoSize(newPercent / 100);
                  }}
                  disabled={photoSize >= 3}
                  className="p-1 hover:bg-gray-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Crop Toggle */}
            <div className="flex items-center space-x-2 bg-gray-50 rounded-lg px-3 py-2">
              <button
                onClick={() => setShowCrops(!showCrops)}
                className={`flex items-center space-x-2 px-3 py-1 rounded-md transition-colors ${
                  showCrops 
                    ? 'bg-primary-100 text-primary-700 border border-primary-200' 
                    : 'hover:bg-gray-200 text-gray-700'
                }`}
                title={showCrops ? 'Show full images' : 'Show face crops'}
              >
                <Crop className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {showCrops ? 'Crops' : 'Full'}
                </span>
              </button>
              {showCrops && (
                <span className="text-xs text-gray-500 ml-1">
                  (face only)
                </span>
              )}
            </div>

            {/* Select All/Clear Buttons */}
            {filteredPhotos.length > 0 && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={selectAllPhotos}
                  disabled={selectedPhotos.size === filteredPhotos.length}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium px-3 py-2 hover:bg-primary-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  Select All
                </button>
                {selectedPhotos.size > 0 && (
                  <button
                    onClick={clearSelection}
                    className="text-sm text-gray-600 hover:text-gray-700 font-medium px-3 py-2 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>

          {selectedPhotos.size > 0 && (
            <div className="flex items-center space-x-3">
              <span className="text-sm text-gray-600">
                {selectedPhotos.size} selected
              </span>
              <button
                onClick={handleAddSelectedToBucket}
                className="btn-primary flex items-center space-x-2"
              >
                <Download className="w-4 h-4" />
                <span>Add Selected to Bucket</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="px-8 py-8">
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
            className={`w-full ${viewMode === 'grid' ? 'photo-gallery-grid' : 'space-y-4 max-w-3xl mx-auto block'}`}
            style={viewMode === 'grid' ? {
              gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(100, 266 * photoSize)}px, 1fr))`,
              gridAutoRows: `${Math.max(100, 266 * photoSize)}px`
            } : {}}
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
                      src={showCrops && imageCrops[photo.photo_id] 
                        ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${imageCrops[photo.photo_id]}.webp`
                        : `${API_BASE}/api/events/${FIXED_EVENT_ID}/display/${photo.photo_id}.webp`
                      }
                      alt={`Photo ${index + 1}`}
                      className="w-full h-full object-cover rounded-lg"
                      loading="lazy"
                      onLoad={(e) => handleImageLoad(photo.photo_id, e)}
                      onError={(e) => {
                        e.target.onerror = null;
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
                    {/* Crop indicator */}
                    {showCrops && imageCrops[photo.photo_id] && (
                      <div className="absolute top-2 right-2 bg-primary-600 text-white text-xs px-2 py-1 rounded">
                        Crop
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
                    <div className="relative">
                      <img
                        src={showCrops && imageCrops[photo.photo_id] 
                          ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${imageCrops[photo.photo_id]}.webp`
                          : `${API_BASE}/api/events/${FIXED_EVENT_ID}/display/${photo.photo_id}.webp`
                        }
                        alt={`Photo ${index + 1}`}
                        className="w-20 h-20 object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                        loading="lazy"
                        onClick={() => openPhotoViewer(photo.photo_id, index)}
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = PLACEHOLDER_DATA_URL;
                        }}
                      />
                      {/* Crop indicator for list view */}
                      {showCrops && imageCrops[photo.photo_id] && (
                        <div className="absolute -top-1 -right-1 bg-primary-600 text-white text-xs px-1 py-0.5 rounded-full">
                          C
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">{photo.name}</p>
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
      </div>

      {/* Modals */}
      {showEditModal && (
        <EditGroupModal
          group={group}
          onClose={() => setShowEditModal(false)}
          onSave={async (updates) => {
            await onUpdateGroup(group.groupID, updates);
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
            await onDeleteGroup(group.groupID);
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
          currentGroupId={group.groupID}
          onJumpToMoment={handleJumpToMoment}
        />
      )}
    </div>
  );
} 