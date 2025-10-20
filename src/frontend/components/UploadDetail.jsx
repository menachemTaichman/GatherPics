import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Image as ImageIcon, Users, Clock, ArrowUp, ArrowDown, ChevronDown, ChevronUp, ArrowLeft, Square, CheckSquare, Edit2, Save, RotateCcw, Minus, Plus, User, AlertCircle } from 'lucide-react';
import { uploadsAPI, groupsAPI, momentsAPI } from '../utils/apiService';
import { useToast } from '../utils/ToastContext';
import { useUploadById, useDataStore } from '../utils/dataManager';
import { useApplyScopes, useImagesForParent, useGroupsForUpload, useMomentsForUpload } from '../utils/storeUtils';
import { sortImages } from '../utils/sorting';
import { getPreference, setPreference } from '../utils/settings';
import { usePreference } from '../utils/useSettings';
import { formatErrorMessage } from '../utils/errorHandler';
import SingleImageTile from './SingleImageTile';
import ImageViewer from './ImageViewer';
import FloatingSelectionControls from './FloatingSelectionControls';
import { ImageComponent } from '../utils/useImage.jsx';
import useImageSelection from '../utils/useImageSelection';
import useImageViewerController from '../utils/useImageViewerController.js';
import { shallow } from 'zustand/shallow';
import { useAuth } from '../utils/authContext';
import { useAuthRefresh } from '../utils/useAuthRefresh';

function formatDateTime(dateString) {
  if (!dateString) return 'N/A';
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

export default function UploadDetail({ eventUrl, urlHelpers }) {
  const params = useParams();
  const navigate = useNavigate();
  const uploadId = params.uploadId;
  const { isAuthenticated } = useAuth();
  
  const [mode, setMode] = useState(() => getPreference('UploadsDetail.mode', 'images'));
  const sortDir = usePreference('UploadDetail.sortDir', 'asc');
  const setSortDir = (value) => setPreference('UploadDetail.sortDir', value);
  const selectionMode = usePreference('general.select', false);
  const setSelectionMode = (value) => setPreference('general.select', value);
  const imageSize = usePreference('general.size', 1.0);
  const setImageSize = (value) => setPreference('general.size', value);
  const [imageSizeInputValue, setImageSizeInputValue] = useState();
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [expandedMoments, setExpandedMoments] = useState(new Set());
  const [imageClasses, setImageClasses] = useState({});
  const imageClassesRef = useRef(imageClasses);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');
  
  const { showToast } = useToast();
  
  useEffect(() => { imageClassesRef.current = imageClasses; }, [imageClasses]);

  // Base scopes: upload and its related entities
  const baseScopes = useMemo(() => [
    { entity: 'upload', id: String(uploadId) },
  ], [uploadId]);

  // Dynamic scopes for expanded groups and moments
  const dynamicScopes = useMemo(() => {
    const scopes = [];
    expandedGroups.forEach(groupId => {
      scopes.push({ entity: 'group', id: String(groupId) });
    });
    expandedMoments.forEach(momentId => {
      scopes.push({ entity: 'moment', id: String(momentId) });
    });
    return scopes;
  }, [expandedGroups, expandedMoments]);

  // Combine base and dynamic scopes
  const allScopes = useMemo(() => [...baseScopes, ...dynamicScopes], [baseScopes, dynamicScopes]);
  
  useApplyScopes(allScopes);

  const storeUpload = useUploadById(uploadId);

  // Create placeholder upload when not authenticated
  const placeholderUpload = useMemo(() => ({
    id: uploadId,
    started_at: null,
    profile_label: '',
    status: '',
    notes: '',
    errors: [],
    isPlaceholder: true
  }), [uploadId]);

  // Use upload from store or placeholder when not authenticated
  const upload = isAuthenticated ? storeUpload : placeholderUpload;

  const fetchUploadDetails = useCallback(async () => {
    if (!uploadId || !eventUrl) return;
    try {
      await uploadsAPI.getById(uploadId, eventUrl);
    } catch (error) {
      console.error('Failed to fetch upload details:', error);
      showToast(formatErrorMessage('fetch upload details', error), 'error');
    }
  }, [uploadId, eventUrl, showToast]);

  useAuthRefresh(fetchUploadDetails, [uploadId, eventUrl]);

  const handleModeChange = (newMode) => {
    setMode(newMode);
    setPreference('UploadsDetail.mode', newMode);
  };

  const toggleSortDir = () => {
    const newDir = sortDir === 'asc' ? 'desc' : 'asc';
    setSortDir(newDir);
  };

  const toggleGroup = (groupId) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const toggleMoment = (momentId) => {
    setExpandedMoments(prev => {
      const next = new Set(prev);
      if (next.has(momentId)) {
        next.delete(momentId);
      } else {
        next.add(momentId);
      }
      return next;
    });
  };

  // Get upload groups and moments from relations using stable hooks
  const rawUploadGroups = useGroupsForUpload(uploadId);
  const rawUploadMoments = useMomentsForUpload(uploadId);
  
  // Create placeholder groups when not authenticated
  const placeholderGroups = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => ({
      id: `placeholder-group-${i}`,
      label: '',
      faces: new Set(),
      isPlaceholder: true
    }));
  }, []);

  // Create placeholder moments when not authenticated
  const placeholderMoments = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => ({
      id: `placeholder-moment-${i}`,
      label: '',
      images: new Set(),
      isPlaceholder: true
    }));
  }, []);
  
  // Sort groups by label
  const uploadGroups = useMemo(() => {
    // Use placeholders when not authenticated
    const groups = isAuthenticated ? rawUploadGroups : placeholderGroups;
    
    return [...groups].sort((a, b) => {
      const labelA = (a.label || '').toLowerCase();
      const labelB = (b.label || '').toLowerCase();
      if (sortDir === 'asc') {
        return labelA.localeCompare(labelB);
      } else {
        return labelB.localeCompare(labelA);
      }
    });
  }, [rawUploadGroups, placeholderGroups, sortDir, isAuthenticated]);
  
  // Sort moments by label (which contains time)
  const uploadMoments = useMemo(() => {
    // Use placeholders when not authenticated
    const moments = isAuthenticated ? rawUploadMoments : placeholderMoments;
    
    return [...moments].sort((a, b) => {
      const labelA = a.label || '';
      const labelB = b.label || '';
      if (sortDir === 'asc') {
        return labelA.localeCompare(labelB);
      } else {
        return labelB.localeCompare(labelA);
      }
    });
  }, [rawUploadMoments, placeholderMoments, sortDir, isAuthenticated]);

  // Get all images for upload
  const storeUploadImages = useImagesForParent({ 
    entity: 'upload', 
    parentId: uploadId, 
    includeArchived: true,
    sortBy: 'date',
    sortOrder: sortDir
  });

  // Create placeholder images when not authenticated
  const placeholderImages = useMemo(() => {
    return Array.from({ length: 24 }, (_, i) => ({
      id: `placeholder-image-${i}`,
      date_taken: null,
      isPlaceholder: true
    }));
  }, []);

  // Use images from store or placeholders when not authenticated
  const uploadImages = isAuthenticated ? storeUploadImages : placeholderImages;
  
  // Image selection
  const {
    selectedKeys: selectedImages,
    toggleKey: toggleSelectedImageKey,
    clear: clearSelection,
    selectAll: selectAllImages,
  } = useImageSelection({
    items: uploadImages,
    getKey: (img) => img?.id,
    enableRange: true,
  });
  
  // Image viewer controller
  const { isOpen: viewerOpen, open: openViewer, navigate: navigateViewer, viewerProps } = useImageViewerController({
    eventUrl,
    showToast,
    onTransferComplete: null,
    onJumpToMoment: null,
    defaultSortBy: 'date',
    defaultSortOrder: sortDir,
    urlHelpers,
    filteredIds: null,
  });

  // Fetch group data when group is expanded (scope already added by dynamic scopes)
  const fetchGroupData = useCallback(async (groupId) => {
    try {
      await groupsAPI.getWithFaces(groupId, eventUrl);
    } catch (error) {
      console.error('Failed to fetch group data:', error);
      showToast(formatErrorMessage('fetch group data', error), 'error');
    }
  }, [eventUrl, showToast]);

  // Fetch moment data when moment is expanded (scope already added by dynamic scopes)
  const fetchMomentData = useCallback(async (momentId) => {
    try {
      await momentsAPI.getById(momentId, eventUrl);
    } catch (error) {
      console.error('Failed to fetch moment data:', error);
      showToast(formatErrorMessage('fetch moment data', error), 'error');
    }
  }, [eventUrl, showToast]);

  // Fetch data for expanded groups/moments
  useEffect(() => {
    if (mode === 'groups') {
      expandedGroups.forEach(groupId => {
        fetchGroupData(groupId);
      });
    }
  }, [mode, expandedGroups, fetchGroupData]);

  useEffect(() => {
    if (mode === 'moments') {
      expandedMoments.forEach(momentId => {
        fetchMomentData(momentId);
      });
    }
  }, [mode, expandedMoments, fetchMomentData]);

  // Open image viewer for main photos tab
  const openImageViewerInUpload = (imageId, index) => {
    openViewer({ index, parent: uploadId, entity: 'upload', sortBy: 'date', sortOrder: sortDir });
  };

  // Open image viewer for a group (showing only images from this upload)
  const openImageViewerInGroup = (groupId, faceId) => {
    const faces = getGroupFacesInUpload(groupId);
    const imageIds = faces.map(f => f.image_id);
    const face = entities?.faces?.[faceId];
    if (!face) return;
    
    const index = imageIds.indexOf(face.image_id);
    if (index === -1) return;
    
    openViewer({ index, parent: groupId, entity: 'group', sortBy: 'date', sortOrder: 'asc', filterByUploadId: uploadId });
  };

  // Open image viewer for a moment (showing only images from this upload)
  const openImageViewerInMoment = (momentId, imageId) => {
    const images = getMomentImagesInUpload(momentId);
    const imageIds = images.map(img => img.id);
    const index = imageIds.indexOf(imageId);
    if (index === -1) return;
    
    openViewer({ index, parent: momentId, entity: 'moment', sortBy: 'date', sortOrder: 'asc', filterByUploadId: uploadId });
  };
  
  const toggleImageSelection = (imageId, event) => {
    toggleSelectedImageKey(imageId, event);
  };
  
  const handleImageLoad = (imageId, e) => {
    const img = e.target;
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    let imageClass = 'square';
    if (aspectRatio > 1.2) {
      imageClass = 'landscape';
    } else if (aspectRatio < 0.8) {
      imageClass = 'portrait';
    }
    
    const current = imageClassesRef.current?.[imageId];
    if (current === imageClass) return;
    
    setImageClasses(prev => {
      if (prev[imageId] === imageClass) return prev;
      return { ...prev, [imageId]: imageClass };
    });
  };
  
  const handleEditNotes = () => {
    setEditingNotes(true);
    setNotesValue(upload?.notes || '');
  };
  
  const handleSaveNotes = async () => {
    try {
      await uploadsAPI.update(uploadId, { notes: notesValue }, eventUrl);
      showToast('Notes updated', 'success');
      setEditingNotes(false);
    } catch (error) {
      console.error('Failed to update notes:', error);
      showToast(formatErrorMessage('update notes', error), 'error');
    }
  };
  
  const handleCancelEditNotes = () => {
    setEditingNotes(false);
    setNotesValue(upload?.notes || '');
  };
  
  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Don't handle shortcuts if user is typing in an input field
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return;
      }
      
      // Ctrl+A or Cmd+A for select all
      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        if (uploadImages.length > 0) {
          selectAllImages();
        }
      }
      // Escape to clear selection
      if (event.key === 'Escape') {
        clearSelection();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [uploadImages]);

  // Subscribe to entities to make component reactive
  const entities = useDataStore((state) => state.entities, shallow);

  // Helper to get faces of a group filtered by this upload
  const getGroupFacesInUpload = useCallback((groupId) => {
    const group = entities?.groups?.[groupId];
    if (!group) return [];
    
    const facesSet = group.faces;
    if (!facesSet || !(facesSet instanceof Set)) return [];
    
    const facesMap = entities?.faces || {};
    const imagesMap = entities?.images || {};
    
    return Array.from(facesSet)
      .map(faceId => facesMap[faceId])
      .filter(face => {
        if (!face) return false;
        const image = imagesMap[face.image_id];
        return image && String(image.upload_id) === String(uploadId);
      });
  }, [entities, uploadId]);

  // Helper to get images of a moment filtered by this upload
  const getMomentImagesInUpload = useCallback((momentId) => {
    const moment = entities?.moments?.[momentId];
    if (!moment) return [];
    
    const imagesSet = moment.images;
    if (!imagesSet || !(imagesSet instanceof Set)) return [];
    
    const imagesMap = entities?.images || {};
    
    return Array.from(imagesSet)
      .map(imageId => imagesMap[imageId])
      .filter(image => image && String(image.upload_id) === String(uploadId))
      .sort((a, b) => new Date(a.date_taken || 0) - new Date(b.date_taken || 0));
  }, [entities, uploadId]);

  const getGroupRepUrl = (groupId) => {
    const group = useDataStore.getState().entities?.groups?.[groupId];
    if (!group || group.isPlaceholder || !urlHelpers?.getRepresentativeUrl) return null;
    return `${urlHelpers.getRepresentativeUrl('groups', groupId)}?v=${group.representative_face || 'none'}`;
  };

  const getMomentRepUrl = (momentId) => {
    const moment = useDataStore.getState().entities?.moments?.[momentId];
    if (!moment || moment.isPlaceholder || !urlHelpers?.getRepresentativeUrl) return null;
    return `${urlHelpers.getRepresentativeUrl('moments', momentId)}?v=${moment.representative_image || 'none'}`;
  };

  return (
    <div className="w-full">
      {/* Sticky Header */}
      <div className="sticky top-16 z-30 bg-white border-b border-gray-200 px-8 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link
              to={`/${eventUrl}/uploads`}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Back to uploads"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </Link>
            <div className="flex items-center space-x-4">
              <div className="w-16 h-16 bg-primary-100 rounded-lg flex items-center justify-center">
                <Upload className="w-7 h-7 text-primary-600" />
              </div>
              <div>
                <div className="flex items-center space-x-3">
                  <div className="flex-1">
                    <h1 className="text-3xl font-bold text-gray-900">Upload Details</h1>
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-sm text-gray-600 mt-1">
                      <span className="text-xs">{upload?.started_at ? formatDateTime(upload.started_at) : 'Loading...'}</span>
                      {upload && upload.profile_label && (
                        <>
                          <span className="text-gray-400">•</span>
                          <span className="text-xs">{upload.profile_label}</span>
                        </>
                      )}
                      {upload && upload.status && (
                        <>
                          <span className="text-gray-400">•</span>
                          <span className={`text-xs ${
                            upload.status === 'completed' ? 'text-green-600' : upload.status === 'failed' ? 'text-red-600' : 'text-yellow-600'
                          }`}>{upload.status}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {upload && upload.errors && Array.isArray(upload.errors) && upload.errors.length > 0 && (
                    <div className="relative group">
                      <div className="flex items-center space-x-1 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg cursor-pointer hover:bg-red-100 transition-colors">
                        <AlertCircle className="w-4 h-4 text-red-600" />
                        <span className="text-xs font-medium text-red-600">
                          {upload.errors.length} {upload.errors.length === 1 ? 'Error' : 'Errors'}
                        </span>
                      </div>
                      <div className="absolute right-0 top-full mt-2 w-96 bg-white border border-red-200 rounded-lg shadow-lg p-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                        <div className="text-xs font-semibold text-red-700 mb-2">Upload Errors:</div>
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {upload.errors.map((error, idx) => (
                            <div key={idx} className="text-xs text-red-600 pl-2 border-l-2 border-red-300">
                              {error}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Controls Row with Tabs */}
        <div className="mt-4 flex items-center justify-between">
          {/* Tabs */}
          <div className="flex items-center divide-x divide-gray-200">
            <div className="flex space-x-1 px-4">
              <button
                onClick={() => handleModeChange('images')}
                className={`flex items-center space-x-2 px-3 py-2 border-b-2 transition-colors ${
                  mode === 'images'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <ImageIcon className="w-4 h-4" />
                <span className="font-medium">Photos</span>
                <span className="font-medium">({uploadImages.length})</span>
              </button>
              <button
                onClick={() => handleModeChange('groups')}
                className={`flex items-center space-x-2 px-3 py-2 border-b-2 transition-colors ${
                  mode === 'groups'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <Users className="w-4 h-4" />
                <span className="font-medium">People</span>
                <span className="font-medium">({uploadGroups.length})</span>
              </button>
              <button
                onClick={() => handleModeChange('moments')}
                className={`flex items-center space-x-2 px-3 py-2 border-b-2 transition-colors ${
                  mode === 'moments'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <Clock className="w-4 h-4" />
                <span className="font-medium">Moments</span>
                <span className="font-medium">({uploadMoments.length})</span>
              </button>
            </div>

            {/* Controls */}
            {(mode === 'images' || mode === 'groups' || mode === 'moments') && (
              <>
                <div className="flex items-center space-x-3 px-4">
                  {/* Sort */}
                  <button
                    onClick={toggleSortDir}
                    className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-100 flex items-center justify-center"
                    title={`Sort ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
                  >
                    {sortDir === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex items-center space-x-3 px-4">
                  {/* Zoom Controls */}
                  <button
                    onClick={() => {
                      const currentPercent = Math.round(imageSize * 100);
                      const next25 = Math.ceil(currentPercent / 25) * 25;
                      const prev25 = Math.floor((currentPercent - 1) / 25) * 25;
                      const subtract25 = currentPercent - 25;
                      const newPercent = Math.max(50, Math.max(subtract25, prev25));
                      setImageSize(newPercent / 100);
                    }}
                    disabled={imageSize <= 0.5}
                    className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Decrease size"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    type="text"
                    id="upload-detail-image-size"
                    name="upload-detail-image-size"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={imageSizeInputValue !== undefined ? imageSizeInputValue : Math.round(imageSize * 100)}
                    onChange={e => setImageSizeInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                    onBlur={e => {
                      let val = parseInt(e.target.value, 10);
                      if (isNaN(val)) val = Math.round(imageSize * 100);
                      val = Math.max(50, Math.min(300, val));
                      setImageSize(val / 100);
                      setImageSizeInputValue(undefined);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.target.blur();
                      } else if (e.key === 'Escape') {
                        setImageSizeInputValue(undefined);
                      }
                    }}
                    className="text-sm font-medium text-gray-700 w-12 text-center bg-transparent border-b border-gray-300 focus:outline-none focus:border-primary-500"
                    style={{width: '3rem'}}
                  />
                  <button
                    onClick={() => {
                      const currentPercent = Math.round(imageSize * 100);
                      const next25 = Math.ceil((currentPercent + 1) / 25) * 25;
                      const add25 = currentPercent + 25;
                      const newPercent = Math.min(300, Math.min(add25, next25));
                      setImageSize(newPercent / 100);
                    }}
                    disabled={imageSize >= 3}
                    className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Increase size"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {/* Selection Mode */}
                {uploadImages.length > 0 && (
                  <div className="flex items-center space-x-3 px-4">
                    <button
                      onClick={() => setSelectionMode(!selectionMode)}
                      className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                        selectionMode 
                          ? 'bg-primary-100 text-primary-700 hover:bg-primary-200' 
                          : 'hover:bg-gray-100 text-gray-700'
                      }`}
                      title={selectionMode ? 'Cancel selection mode' : 'Show checkboxes'}
                    >
                      {selectionMode ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Notes field */}
          {upload && (
            <div className="mt-3 px-4 text-sm">
              {editingNotes ? (
                <div className="flex items-center space-x-2">
                  <span className="text-gray-600">Notes:</span>
                  <input
                    type="text"
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    className="flex-1 border rounded px-2 py-1 text-sm"
                    placeholder="Add notes..."
                    autoFocus
                  />
                  <button
                    onClick={handleSaveNotes}
                    className="p-1 hover:bg-green-100 rounded transition-colors"
                    title="Save"
                  >
                    <Save className="w-4 h-4 text-green-600" />
                  </button>
                  <button
                    onClick={handleCancelEditNotes}
                    className="p-1 hover:bg-red-100 rounded transition-colors"
                    title="Cancel"
                  >
                    <RotateCcw className="w-4 h-4 text-red-600" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <span className="text-gray-600">Notes:</span>
                  <span className="text-gray-900">{upload.notes || <span className="text-gray-400 italic">No notes</span>}</span>
                  <button
                    onClick={handleEditNotes}
                    className="p-1 hover:bg-blue-100 rounded transition-colors"
                    title="Edit notes"
                  >
                    <Edit2 className="w-4 h-4 text-blue-600" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="px-8 py-8">
        <AnimatePresence mode="wait">
          {mode === 'images' && (
            <motion.div
              key="images"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {uploadImages.length === 0 ? (
                <div className="text-center py-12">
                  <ImageIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">No images in this upload</p>
                </div>
              ) : (
                <div 
                  className="photo-gallery-grid"
                  style={{
                    gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(100, 266 * imageSize * 0.75)}px, 1fr))`,
                    gridAutoRows: `${Math.max(100, 266 * imageSize * 0.75)}px`
                  }}
                >
                  {uploadImages.map((img, index) => (
                    <motion.div
                      key={img.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.15 }}
                      className={`photo-card ${imageClasses[img.id] || 'square'}`}
                    >
                      <SingleImageTile
                        image={img}
                        aspectClass={imageClasses[img.id] || 'square'}
                        imageFit="cover"
                        thumbSrc={img.isPlaceholder ? null : (urlHelpers?.getThumbnailUrl?.(img.id))}
                        selectionMode={selectionMode}
                        isSelected={selectedImages.has(img.id)}
                        onToggleSelect={(e) => toggleImageSelection(img.id, e)}
                        onOpen={() => openImageViewerInUpload(img.id, index)}
                        onImageLoad={(e) => handleImageLoad(img.id, e)}
                        eventUrl={eventUrl}
                        urlHelpers={urlHelpers}
                        showFavoriteButton={false}
                        showArchiveButton={false}
                      />
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {mode === 'groups' && (
            <motion.div
              key="groups"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {uploadGroups.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">No groups in this upload</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {uploadGroups.map((group) => {
                    const isExpanded = expandedGroups.has(group.id);
                    const groupFaces = isExpanded ? getGroupFacesInUpload(group.id) : [];

                    return (
                      <div key={group.id} className="border rounded-lg overflow-hidden">
                        <div
                          onClick={() => {
                            toggleGroup(group.id);
                            if (!isExpanded) {
                              fetchGroupData(group.id);
                            }
                          }}
                          className="flex items-center justify-between p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-center space-x-3">
                            {ImageComponent(getGroupRepUrl(group.id), {
                              width: 48,
                              height: 48,
                              className: 'w-12 h-12 object-cover rounded-full',
                              alt: group.label,
                              iconType: 'person'
                            })}
                            <div>
                              <h4 className="font-medium text-gray-900">{group.label}</h4>
                              <p className="text-xs text-gray-500">
                                {groupFaces.length} {groupFaces.length === 1 ? 'face' : 'faces'} in this upload
                              </p>
                            </div>
                          </div>
                          {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                        </div>

                        {isExpanded && (
                          <div className="p-4">
                            {groupFaces.length === 0 ? (
                              <p className="text-gray-500 text-sm text-center py-4">No faces from this upload</p>
                            ) : (
                              <div 
                                className="photo-gallery-grid"
                                style={{
                                  gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(100, 266 * imageSize * 0.75)}px, 1fr))`,
                                  gridAutoRows: `${Math.max(100, 266 * imageSize * 0.75)}px`
                                }}
                              >
                                {groupFaces.map((face) => {
                                  const img = entities?.images?.[face.image_id];
                                  if (!img) return null;
                                  return (
                                    <div
                                      key={face.id}
                                      className={`photo-card ${imageClasses[face.image_id] || 'square'}`}
                                    >
                                      <SingleImageTile
                                        image={img}
                                        aspectClass={imageClasses[img.id] || 'square'}
                                        imageFit="cover"
                                        thumbSrc={img.isPlaceholder ? null : (urlHelpers?.getFaceCropUrl?.(face.id))}
                                        selectionMode={selectionMode}
                                        isSelected={selectedImages.has(img.id)}
                                        onToggleSelect={(e) => toggleImageSelection(img.id, e)}
                                        onOpen={() => openImageViewerInGroup(group.id, face.id)}
                                        onImageLoad={(e) => handleImageLoad(img.id, e)}
                                        eventUrl={eventUrl}
                                        urlHelpers={urlHelpers}
                                        showFavoriteButton={false}
                                        showArchiveButton={false}
                                        showCropBadge={false}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {mode === 'moments' && (
            <motion.div
              key="moments"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {uploadMoments.length === 0 ? (
                <div className="text-center py-12">
                  <Clock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">No moments in this upload</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {uploadMoments.map((moment) => {
                    const isExpanded = expandedMoments.has(moment.id);
                    const momentImages = isExpanded ? getMomentImagesInUpload(moment.id) : [];

                    return (
                      <div key={moment.id} className="border rounded-lg overflow-hidden">
                        <div
                          onClick={() => {
                            toggleMoment(moment.id);
                            if (!isExpanded) {
                              fetchMomentData(moment.id);
                            }
                          }}
                          className="flex items-center justify-between p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-center space-x-3">
                            {ImageComponent(getMomentRepUrl(moment.id), {
                              width: 48,
                              height: 48,
                              className: 'w-12 h-12 object-cover rounded-lg',
                              alt: moment.label
                            })}
                            <div>
                              <h4 className="font-medium text-gray-900">{moment.label}</h4>
                              <p className="text-xs text-gray-500">
                                {momentImages.length} {momentImages.length === 1 ? 'photo' : 'photos'} in this upload
                              </p>
                            </div>
                          </div>
                          {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                        </div>

                        {isExpanded && (
                          <div className="p-4">
                            {momentImages.length === 0 ? (
                              <p className="text-gray-500 text-sm text-center py-4">No images from this upload</p>
                            ) : (
                              <div 
                                className="photo-gallery-grid"
                                style={{
                                  gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(100, 266 * imageSize * 0.75)}px, 1fr))`,
                                  gridAutoRows: `${Math.max(100, 266 * imageSize * 0.75)}px`
                                }}
                              >
                                {momentImages.map((img) => {
                                  return (
                                    <div
                                      key={img.id}
                                      className={`photo-card ${imageClasses[img.id] || 'square'}`}
                                    >
                                      <SingleImageTile
                                        image={img}
                                        aspectClass={imageClasses[img.id] || 'square'}
                                        imageFit="cover"
                                        thumbSrc={img.isPlaceholder ? null : (urlHelpers?.getThumbnailUrl?.(img.id))}
                                        selectionMode={selectionMode}
                                        isSelected={selectedImages.has(img.id)}
                                        onToggleSelect={(e) => toggleImageSelection(img.id, e)}
                                        onOpen={() => openImageViewerInMoment(moment.id, img.id)}
                                        onImageLoad={(e) => handleImageLoad(img.id, e)}
                                        eventUrl={eventUrl}
                                        urlHelpers={urlHelpers}
                                        showFavoriteButton={false}
                                        showArchiveButton={false}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Note about data changes */}
        <div className="mt-6 text-xs text-gray-500 italic text-center">
          Note: Data may have changed since this upload was created
        </div>
      </div>

      {/* Floating Selection Controls */}
      <FloatingSelectionControls
        selectedCount={selectedImages.size}
        totalCount={uploadImages.length}
        selectedImages={selectedImages}
        onSelectAll={selectAllImages}
        onClearSelection={clearSelection}
        eventUrl={eventUrl}
        urlHelpers={urlHelpers}
        placeholderDataUrl={null}
        showTransferFaces={false}
        showRemoveFromMoment={false}
        showMoveToMoment={false}
        showArchive={true}
        showFavorites={true}
        showBucket={true}
        showAlbum={true}
        selectionMode={selectionMode}
        entity="upload"
        entityId={uploadId}
      />

      {/* Image Viewer */}
      {viewerOpen && (
        <ImageViewer {...viewerProps} />
      )}
    </div>
  );
}

