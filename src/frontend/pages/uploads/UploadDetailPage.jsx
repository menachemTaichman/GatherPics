import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
import { Upload, Image as ImageIcon, Users, Clock, ArrowUp, ArrowDown, ChevronDown, ChevronUp, ArrowLeft, Square, CheckSquare, Edit2, Save, RotateCcw, Minus, Plus, User, AlertCircle, Key } from 'lucide-react';
import { uploadsAPI, groupsAPI, momentsAPI } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { useUploadById, useDataStore } from '../../utils/dataManager';
import { useApplyScopes, useChilds, useEventId } from '../../utils/storeUtils';
import { sortImages } from '../../utils/sorting';
import { getPreference, setPreference } from '../../utils/settings';
import { usePreference } from '../../hooks/useSettings';
import { formatErrorMessage } from '../../utils/errorHandler';
import { SingleImageTile, ImageViewer } from '../../components/images';
import { FloatingSelectionControls } from '../../components/layout';
import { ManageAccessModal } from '../../components/profiles';
import { MoveToMomentModal } from '../../components/moments';
import { TransferFacesModal } from '../../components/groups';
import { ImageComponent } from '../../hooks/useImage.jsx';
import useImageSelection from '../../hooks/useImageSelection';
import useImageViewerController from '../../hooks/useImageViewerController.js';
import { shallow } from 'zustand/shallow';
import { useAuth } from '../../contexts/authContext';
import { useAuthRefresh } from '../../hooks/useAuthRefresh';
import { usePermissions } from '../../hooks/usePermissions';

import { formatDateTimeLocale, calculateDuration, formatDuration } from '../../utils/dateUtils';

export default function UploadDetail({ eventUrl, urlHelpers }) {
  const params = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  const uploadId = params.uploadId;
  const eventId = useEventId(eventUrl);
  const { isAuthenticated } = useAuth();
  
  const [mode, setMode] = useState(() => getPreference('UploadDetail.mode', 'images'));
  const sortDir = usePreference('UploadDetail.sortDir', 'asc');
  const setSortDir = (value) => setPreference('UploadDetail.sortDir', value);
  const selectionMode = usePreference('general.select', false);
  const setSelectionMode = (value) => setPreference('general.select', value);
  const imageSize = usePreference('general.size', 1.0);
  const setImageSize = (value) => setPreference('general.size', value);
  const [imageSizeInputValue, setImageSizeInputValue] = useState();
  const [expandedGroup, setExpandedGroup] = useState(null); // Single group ID
  const [expandedMoment, setExpandedMoment] = useState(null); // Single moment ID
  const [imageClasses, setImageClasses] = useState({});
  const imageClassesRef = useRef(imageClasses);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');
  const [editingGroupLabel, setEditingGroupLabel] = useState(null);
  const [groupLabelValue, setGroupLabelValue] = useState('');
  const [showManageAccessModal, setShowManageAccessModal] = useState(false);
  const [manageAccessEntity, setManageAccessEntity] = useState({ type: null, ids: [] });
  const [showMoveToMomentModal, setShowMoveToMomentModal] = useState(false);
  const [showTransferFacesModal, setShowTransferFacesModal] = useState(false);
  const [selectedFacesForTransfer, setSelectedFacesForTransfer] = useState([]);
  
  const permissions = usePermissions();
  
  const { showToast } = useToast();
  
  useEffect(() => { imageClassesRef.current = imageClasses; }, [imageClasses]);

  // Refs for arrow key navigation (separate for each mode)
  const imageTileRefs = useRef([]);
  const groupFaceTileRefs = useRef({}); // Map of groupId -> ref array
  const momentImageTileRefs = useRef({}); // Map of momentId -> ref array

  // Base scopes: upload and its related entities
  const baseScopes = useMemo(() => [
    { entity: 'upload', id: String(uploadId), eventId },
  ], [uploadId, eventId]);

  // Dynamic scopes for expanded group and moment
  const dynamicScopes = useMemo(() => {
    const scopes = [];
    if (expandedGroup) {
      scopes.push({ entity: 'group', id: String(expandedGroup), eventId });
    }
    if (expandedMoment) {
      scopes.push({ entity: 'moment', id: String(expandedMoment), eventId });
    }
    return scopes;
  }, [expandedGroup, expandedMoment, eventId]);

  // Combine base and dynamic scopes
  const allScopes = useMemo(() => [...baseScopes, ...dynamicScopes], [baseScopes, dynamicScopes]);
  
  useApplyScopes(allScopes);

  const storeUpload = useUploadById(eventId, uploadId);

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
    setPreference('UploadDetail.mode', newMode);
  };

  const toggleSortDir = () => {
    const newDir = sortDir === 'asc' ? 'desc' : 'asc';
    setSortDir(newDir);
  };

  const toggleGroup = (groupId) => {
    if (expandedGroup === groupId) {
      setExpandedGroup(null);
      // Clear group selection when closing
      clearGroupSelection();
    } else {
      setExpandedGroup(groupId);
    }
  };

  const toggleMoment = (momentId) => {
    if (expandedMoment === momentId) {
      setExpandedMoment(null);
      // Clear moment selection when closing
      clearMomentSelection();
    } else {
      setExpandedMoment(momentId);
    }
  };

  // Get upload groups and moments from relations using stable hooks
  const rawUploadGroups = useChilds(eventId, 'uploads', uploadId, 'groups', { sortBy: 'name', sortOrder: 'asc' });
  const rawUploadMoments = useChilds(eventId, 'uploads', uploadId, 'moments', { sortBy: 'label', sortOrder: 'asc' });
  
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
  const storeUploadImages = useChilds(eventId, 'uploads', uploadId, 'images', { 
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
  
  // Separate selection states for each mode
  const {
    selectedKeys: selectedImagesInImagesMode,
    toggleKey: toggleSelectedImageInImagesMode,
    clear: clearImagesSelection,
    selectAll: selectAllImagesInImagesMode,
  } = useImageSelection({
    items: uploadImages,
    getKey: (img) => img?.id,
    enableRange: true,
  });

  const {
    selectedKeys: selectedImagesInGroupsMode,
    toggleKey: toggleSelectedImageInGroupsMode,
    clear: clearGroupSelection,
    selectAll: selectAllImagesInGroupsMode,
  } = useImageSelection({
    items: uploadImages,
    getKey: (img) => img?.id,
    enableRange: true,
  });

  const {
    selectedKeys: selectedImagesInMomentsMode,
    toggleKey: toggleSelectedImageInMomentsMode,
    clear: clearMomentSelection,
    selectAll: selectAllImagesInMomentsMode,
  } = useImageSelection({
    items: uploadImages,
    getKey: (img) => img?.id,
    enableRange: true,
  });

  // Current selection based on mode
  const currentSelection = mode === 'images' ? selectedImagesInImagesMode : 
                          mode === 'groups' ? selectedImagesInGroupsMode :
                          selectedImagesInMomentsMode;
  
  const toggleCurrentSelection = mode === 'images' ? toggleSelectedImageInImagesMode :
                                 mode === 'groups' ? toggleSelectedImageInGroupsMode :
                                 toggleSelectedImageInMomentsMode;
  
  const clearCurrentSelection = mode === 'images' ? clearImagesSelection :
                                mode === 'groups' ? clearGroupSelection :
                                clearMomentSelection;
  
  const selectAllCurrent = mode === 'images' ? selectAllImagesInImagesMode :
                           mode === 'groups' ? selectAllImagesInGroupsMode :
                           selectAllImagesInMomentsMode;
  
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
      await groupsAPI.getById(groupId, eventUrl);
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

  // Fetch data for expanded group/moment
  useEffect(() => {
    if (mode === 'groups' && expandedGroup) {
      fetchGroupData(expandedGroup);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, expandedGroup]);

  useEffect(() => {
    if (mode === 'moments' && expandedMoment) {
      fetchMomentData(expandedMoment);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, expandedMoment]);

  // Open image viewer for main photos tab
  const openImageViewerInUpload = (imageId, index) => {
    openViewer({ index, parent: uploadId, entity: 'upload', sortBy: 'date', sortOrder: sortDir });
  };

  // Open image viewer for a group (showing only images from this upload)
  const openImageViewerInGroup = (groupId, faceId) => {
    const faces = getGroupFacesInUpload(groupId);
    const imageIds = faces.map(f => f.image_id);
    const face = entities?.[eventId]?.faces?.[faceId];
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
    toggleCurrentSelection(imageId, event);
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
      showToast(t('uploadDetail.notesUpdated'), 'success');
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

  const handleEditGroupLabel = (groupId, currentLabel) => {
    setEditingGroupLabel(groupId);
    setGroupLabelValue(currentLabel || '');
  };

  const handleSaveGroupLabel = async (groupId) => {
    try {
      await groupsAPI.update(groupId, { label: groupLabelValue }, eventUrl);
      showToast(t('uploadDetail.personLabelUpdated'), 'success');
      setEditingGroupLabel(null);
    } catch (error) {
      console.error('Failed to update group label:', error);
      showToast(formatErrorMessage('update person label', error), 'error');
    }
  };

  const handleCancelEditGroupLabel = () => {
    setEditingGroupLabel(null);
    setGroupLabelValue('');
  };

  const handleManageGroupAccess = (groupId) => {
    setManageAccessEntity({ type: 'group', ids: [groupId] });
    setShowManageAccessModal(true);
  };

  const handleSetFaceAsRep = async (groupId, faceId) => {
    try {
      await groupsAPI.update(groupId, { representative_face: faceId }, eventUrl);
      showToast(t('uploadDetail.representativeFaceUpdated'), 'success');
    } catch (error) {
      console.error('Failed to set representative:', error);
      showToast(formatErrorMessage('set representative', error), 'error');
    }
  };

  const handleSetMomentImageAsRep = async (momentId, imageId) => {
    try {
      await momentsAPI.update(momentId, { representative_image: imageId }, eventUrl);
      showToast(t('uploadDetail.representativeImageUpdated'), 'success');
    } catch (error) {
      console.error('Failed to set representative:', error);
      showToast(formatErrorMessage('set representative', error), 'error');
    }
  };

  const handleMoveToMomentComplete = (result) => {
    setShowMoveToMomentModal(false);
    clearCurrentSelection();
  };

  const handleTransferFacesComplete = (result) => {
    setShowTransferFacesModal(false);
    setSelectedFacesForTransfer([]);
    clearCurrentSelection();
  };

  const handleTransferFacesClick = () => {
    const faces = getSelectedFacesForTransfer();
    setSelectedFacesForTransfer(faces);
    setShowTransferFacesModal(true);
  };

  const getSelectedFacesForTransfer = () => {
    if (mode !== 'groups' || !expandedGroup) return [];
    
    const groupEntity = entities?.[eventId]?.groups?.[expandedGroup];
    const selectedFaces = [];
    
    // currentSelection contains face IDs in groups mode
    for (const faceId of currentSelection) {
      const face = entities?.[eventId]?.faces?.[faceId];
      if (!face) continue;
      selectedFaces.push({
        id: faceId,
        face_id: faceId,
        image_id: face.image_id,
        group_id: expandedGroup,
        face_width: face?.face_width || 0,
        face_height: face?.face_height || 0,
        face_left: face?.face_left || 0,
        face_top: face?.face_top || 0,
        group_label: groupEntity?.label || ''
      });
    }
    return selectedFaces;
  };
  
  // Update refs array when uploadImages changes (for images mode)
  useEffect(() => {
    if (mode === 'images') {
      imageTileRefs.current = imageTileRefs.current.slice(0, uploadImages.length);
    }
  }, [uploadImages.length, mode]);

  // Subscribe to entities to make component reactive
  const entities = useDataStore((state) => state.entities, shallow);

  // Helper to get faces of a group filtered by this upload
  const getGroupFacesInUpload = useCallback((groupId) => {
    const group = entities?.[eventId]?.groups?.[groupId];
    if (!group) return [];
    
    const facesSet = group.faces;
    if (!facesSet || !(facesSet instanceof Set)) return [];
    
    const facesMap = entities?.[eventId]?.faces || {};
    const imagesMap = entities?.[eventId]?.images || {};
    
    return Array.from(facesSet)
      .map(faceId => facesMap[faceId])
      .filter(face => {
        if (!face) return false;
        const image = imagesMap[face.image_id];
        return image && String(image.upload_id) === String(uploadId);
      });
  }, [entities, uploadId, eventId]);

  // Helper to get images of a moment filtered by this upload
  const getMomentImagesInUpload = useCallback((momentId) => {
    const moment = entities?.[eventId]?.moments?.[momentId];
    if (!moment) return [];
    
    const imagesSet = moment.images;
    if (!imagesSet || !(imagesSet instanceof Set)) return [];
    
    const imagesMap = entities?.[eventId]?.images || {};
    
    return Array.from(imagesSet)
      .map(imageId => imagesMap[imageId])
      .filter(image => image && String(image.upload_id) === String(uploadId))
      .sort((a, b) => new Date(a.date_taken || 0) - new Date(b.date_taken || 0));
  }, [entities, uploadId, eventId]);

  // Handle keyboard shortcuts and arrow key navigation
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Don't handle shortcuts if user is typing in an input field
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return;
      }
      
      // Arrow key navigation for images
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        const currentElement = document.activeElement;
        let currentIndex = -1;
        let refsArray = [];
        let itemsArray = [];
        
        // Determine which refs array to use based on mode
        if (mode === 'images') {
          currentIndex = imageTileRefs.current.findIndex(ref => ref === currentElement);
          refsArray = imageTileRefs.current;
          itemsArray = uploadImages;
        } else if (mode === 'groups') {
          // Find which group the current element belongs to
          const groupContainer = currentElement.closest('[data-group-id]');
          if (groupContainer) {
            const groupId = groupContainer.getAttribute('data-group-id');
            const groupFaces = getGroupFacesInUpload(groupId);
            const groupRefs = groupFaceTileRefs.current[groupId] || [];
            currentIndex = groupRefs.findIndex(ref => ref === currentElement);
            refsArray = groupRefs;
            itemsArray = groupFaces;
          }
        } else if (mode === 'moments') {
          // Find which moment the current element belongs to
          const momentContainer = currentElement.closest('[data-moment-id]');
          if (momentContainer) {
            const momentId = momentContainer.getAttribute('data-moment-id');
            const momentImages = getMomentImagesInUpload(momentId);
            const momentRefs = momentImageTileRefs.current[momentId] || [];
            currentIndex = momentRefs.findIndex(ref => ref === currentElement);
            refsArray = momentRefs;
            itemsArray = momentImages;
          }
        }
        
        if (currentIndex === -1 || refsArray.length === 0) return;
        
        // Calculate grid dimensions (approximate based on viewport)
        const gridContainer = currentElement.closest('.photo-gallery-grid');
        if (!gridContainer) return;
        
        const containerRect = gridContainer.getBoundingClientRect();
        const itemRect = currentElement.getBoundingClientRect();
        
        // Estimate columns based on container width and item width
        const itemWidth = itemRect.width;
        const containerWidth = containerRect.width;
        const estimatedCols = Math.floor(containerWidth / itemWidth) || 1;
        
        let nextIndex = currentIndex;
        
        switch (event.key) {
          case 'ArrowRight':
            nextIndex = Math.min(currentIndex + 1, itemsArray.length - 1);
            break;
          case 'ArrowLeft':
            nextIndex = Math.max(currentIndex - 1, 0);
            break;
          case 'ArrowDown':
            nextIndex = Math.min(currentIndex + estimatedCols, itemsArray.length - 1);
            break;
          case 'ArrowUp':
            nextIndex = Math.max(currentIndex - estimatedCols, 0);
            break;
        }
        
        if (nextIndex !== currentIndex && refsArray[nextIndex]) {
          event.preventDefault();
          refsArray[nextIndex].focus();
        }
        return;
      }
      
      // Ctrl+A or Cmd+A for select all
      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        if (uploadImages.length > 0) {
          selectAllCurrent();
        }
      }
      // Escape to clear selection
      if (event.key === 'Escape') {
        clearCurrentSelection();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [uploadImages, mode, selectAllCurrent, clearCurrentSelection, getGroupFacesInUpload, getMomentImagesInUpload]);

  const getGroupRepUrl = (groupId) => {
    const group = useDataStore.getState().entities?.[eventId]?.groups?.[groupId];
    if (!group || group.isPlaceholder || !urlHelpers?.getRepresentativeUrl) return null;
    return `${urlHelpers.getRepresentativeUrl('groups', groupId)}?v=${group.representative_face || 'none'}`;
  };

  const getMomentRepUrl = (momentId) => {
    const moment = useDataStore.getState().entities?.[eventId]?.moments?.[momentId];
    if (!moment || moment.isPlaceholder || !urlHelpers?.getRepresentativeUrl) return null;
    return `${urlHelpers.getRepresentativeUrl('moments', momentId)}?v=${moment.representative_image || 'none'}`;
  };

  const shouldLetBrowserHandle = (e) => {
    // Allow default for modifier/middle/double click so new tab/window works
    return e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button === 1 || (e.detail && e.detail > 1);
  };

  // Calculate completion duration
  const completionDuration = useMemo(() => {
    if (!upload?.started_at || !upload?.completed_at) return null;
    const duration = calculateDuration(upload.started_at, upload.completed_at);
    return duration !== null ? formatDuration(duration) : null;
  }, [upload?.started_at, upload?.completed_at]);

  return (
    <div className="w-full overflow-x-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="h-[4rem]"></div>
      {/* Sticky Header */}
      <div className="sticky top-[4rem] z-30 bg-white border-b border-gray-200 px-4 sm:px-8 py-2 sm:py-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-shrink-0">
            <Link
              to={`/${eventUrl}/uploads`}
              className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
              title={t('uploadDetail.backToUploads')}
              aria-label={t('uploadDetail.backToUploads')}
            >
              <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
            </Link>
            <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
              <div className="w-10 h-10 sm:w-16 sm:h-16 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Upload className="w-5 h-5 sm:w-7 sm:h-7 text-primary-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <div className="flex-1 min-w-0">
                    <h1 className="text-xl sm:text-3xl font-bold text-gray-900 truncate">{t('uploadDetail.uploadDetails')}</h1>
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs sm:text-sm text-gray-600 mt-1">
                      <span className="text-xs">{upload?.started_at ? formatDateTimeLocale(upload.started_at) : 'Loading...'}</span>
                      {upload && upload.profile_label && (
                        <>
                          <span className="text-gray-400">•</span>
                          <span className="text-xs truncate">{upload.profile_label}</span>
                        </>
                      )}
                      {upload && upload.status && (
                        <>
                          <span className="text-gray-400">•</span>
                          <span className={`text-xs ${
                            upload.status === 'completed' ? 'text-green-600' : upload.status === 'failed' ? 'text-red-600' : 'text-yellow-600'
                          }`}>{upload.status}</span>
                          {completionDuration && (
                            <>
                              <span className="text-gray-400">•</span>
                              <span className="text-xs text-gray-600">
                                {t('uploadDetail.completedIn')} {completionDuration}
                              </span>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                      {upload && upload.errors && Array.isArray(upload.errors) && upload.errors.length > 0 && (
                    <div className="relative group flex-shrink-0">
                      <div className="flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 bg-red-50 border border-red-200 rounded-lg cursor-pointer hover:bg-red-100 transition-colors">
                        <AlertCircle className="w-3 h-3 sm:w-4 sm:h-4 text-red-600" />
                        <span className="text-xs font-medium text-red-600">
                          {upload.errors.length} {upload.errors.length === 1 ? t('uploadDetail.error') : t('uploadDetail.errorsPlural')}
                        </span>
                      </div>
                      <div className="absolute right-0 top-full mt-2 w-64 sm:w-96 bg-white border border-red-200 rounded-lg shadow-lg p-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                        <div className="text-xs font-semibold text-red-700 mb-2">{t('uploadDetail.uploadErrors')}:</div>
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

        {/* Controls Row with Tabs */}
        <div className="mt-3 sm:mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0">
          {/* Tabs */}
            <div className="flex items-center divide-x divide-gray-200 overflow-x-auto">
            <div className="flex gap-0.5 sm:gap-1 px-2 sm:px-4">
              <button
                onClick={() => handleModeChange('images')}
                className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 border-b-2 transition-colors whitespace-nowrap ${
                  mode === 'images'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <ImageIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="font-medium text-xs sm:text-sm">{t('uploadDetail.photos')}</span>
                <span className="font-medium text-xs sm:text-sm">({uploadImages.length})</span>
              </button>
              <button
                onClick={() => handleModeChange('groups')}
                className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 border-b-2 transition-colors whitespace-nowrap ${
                  mode === 'groups'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <Users className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="font-medium text-xs sm:text-sm">{t('uploadDetail.people')}</span>
                <span className="font-medium text-xs sm:text-sm">({uploadGroups.length})</span>
              </button>
              <button
                onClick={() => handleModeChange('moments')}
                className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 border-b-2 transition-colors whitespace-nowrap ${
                  mode === 'moments'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <Clock className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="font-medium text-xs sm:text-sm">{t('uploadDetail.moments')}</span>
                <span className="font-medium text-xs sm:text-sm">({uploadMoments.length})</span>
              </button>
            </div>
          </div>

            {/* Controls */}
            {(mode === 'images' || mode === 'groups' || mode === 'moments') && (
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                <div className="flex items-center gap-2 sm:gap-3">
                  {/* Sort */}
                  <button
                    onClick={toggleSortDir}
                    className="w-7 h-7 sm:w-8 sm:h-8 border border-transparent rounded-md transition-colors hover:bg-gray-100 flex items-center justify-center"
                    title={sortDir === 'asc' ? t('uploadDetail.sortAscending') : t('uploadDetail.sortDescending')}
                    aria-label={sortDir === 'asc' ? t('uploadDetail.sortAscending') : t('uploadDetail.sortDescending')}
                  >
                    {sortDir === 'asc' ? <ArrowUp className="w-3 h-3 sm:w-4 sm:h-4" /> : <ArrowDown className="w-3 h-3 sm:w-4 sm:h-4" />}
                  </button>

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
                    className="w-7 h-7 sm:w-8 sm:h-8 border border-transparent rounded-md transition-colors hover:bg-gray-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    title={t('uploadDetail.decreaseSize')}
                    aria-label={t('uploadDetail.decreaseSize')}
                  >
                    <Minus className="w-3 h-3 sm:w-4 sm:h-4" />
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
                    className="text-xs sm:text-sm font-medium text-gray-700 w-10 sm:w-12 text-center bg-transparent border-b border-gray-300 focus:outline-none focus:border-primary-500"
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
                    className="w-7 h-7 sm:w-8 sm:h-8 border border-transparent rounded-md transition-colors hover:bg-gray-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    title={t('uploadDetail.increaseSize')}
                    aria-label={t('uploadDetail.increaseSize')}
                  >
                    <Plus className="w-3 h-3 sm:w-4 sm:h-4" />
                  </button>
                </div>

                {/* Selection Mode */}
                {uploadImages.length > 0 && (
                  <div className="flex items-center gap-2 sm:gap-3">
                    <button
                      onClick={() => setSelectionMode(!selectionMode)}
                      className={`w-7 h-7 sm:w-8 sm:h-8 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                        selectionMode 
                          ? 'bg-primary-100 text-primary-700 hover:bg-primary-200' 
                          : 'hover:bg-gray-100 text-gray-700'
                      }`}
                      title={selectionMode ? t('uploadDetail.cancelSelectionMode') : t('uploadDetail.showCheckboxes')}
                      aria-label={selectionMode ? t('uploadDetail.cancelSelectionMode') : t('uploadDetail.showCheckboxes')}
                    >
                      {selectionMode ? <CheckSquare className="w-3 h-3 sm:w-4 sm:h-4" /> : <Square className="w-3 h-3 sm:w-4 sm:h-4" />}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Notes field */}
          {upload && (
            <div className="mt-2 sm:mt-3 px-0 sm:px-4 text-xs sm:text-sm">
              {editingNotes ? (
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">{t('uploadDetail.notes')}:</span>
                  <input
                    type="text"
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    dir={isRTL ? 'rtl' : 'ltr'}
                    className="flex-1 border rounded px-2 py-1 text-sm"
                    placeholder={t('uploadDetail.addNotes')}
                    autoFocus
                  />
                  <button
                    onClick={handleSaveNotes}
                    className="p-1 hover:bg-green-100 rounded transition-colors"
                    title={t('uploadDetail.save')}
                    aria-label={t('uploadDetail.save')}
                  >
                    <Save className="w-4 h-4 text-green-600" />
                  </button>
                  <button
                    onClick={handleCancelEditNotes}
                    className="p-1 hover:bg-red-100 rounded transition-colors"
                    title={t('uploadDetail.cancel')}
                    aria-label={t('uploadDetail.cancel')}
                  >
                    <RotateCcw className="w-4 h-4 text-red-600" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">{t('uploadDetail.notes')}:</span>
                  <span className="text-gray-900">{upload.notes || <span className="text-gray-400 italic">{t('uploadDetail.noNotes')}</span>}</span>
                  <button
                    onClick={handleEditNotes}
                    className="p-1 hover:bg-blue-100 rounded transition-colors"
                    title={t('uploadDetail.editNotes')}
                    aria-label={t('uploadDetail.editNotes')}
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
      <div className="px-4 sm:px-8 py-4 sm:py-8 overflow-x-auto">
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
                  <p className="text-gray-500">{t('uploadDetail.noImagesInThisUpload')}</p>
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
                                        ref={(el) => {
                                          if (el && imageTileRefs.current[index] !== el) {
                                            imageTileRefs.current[index] = el;
                                          }
                                        }}
                                        image={img}
                                        aspectClass={imageClasses[img.id] || 'square'}
                                        imageFit="cover"
                                        thumbSrc={img.isPlaceholder ? null : (urlHelpers?.getThumbnailUrl?.(img.id))}
                                        selectionMode={selectionMode}
                                        isSelected={currentSelection.has(img.id)}
                                        onToggleSelect={(e) => toggleImageSelection(img.id, e)}
                                        onOpen={() => openImageViewerInUpload(img.id, index)}
                                        onImageLoad={(e) => handleImageLoad(img.id, e)}
                                        eventUrl={eventUrl}
                                        urlHelpers={urlHelpers}
                                        showFavoriteButton={false}
                                        showArchiveButton={false}
                                        photoIndex={index}
                                        contextType="Upload"
                                        contextLabel={upload?.profile_label || uploadId}
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
                  <p className="text-gray-500">{t('uploadDetail.noGroupsInThisUpload')}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {uploadGroups.map((group) => {
                    const isExpanded = expandedGroup === group.id;
                    const groupFaces = isExpanded ? getGroupFacesInUpload(group.id) : [];
                    const groupEntity = entities?.[eventId]?.groups?.[group.id];
                    const isRepresentative = (faceId) => groupEntity?.representative_face === faceId;

                    const uploadGroupRelation = upload?.groups?.[group.id];
                    const totalFacesCount = uploadGroupRelation?.faces_count || groupEntity?.faces_count || 0;
                    const uploadFacesCount = uploadGroupRelation?.upload_faces_count || 0;

                    return (
                      <div key={group.id} className="border rounded-lg overflow-hidden" data-group-id={group.id}>
                        <div
                          className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
                          onClick={() => {
                            toggleGroup(group.id);
                            if (!isExpanded) {
                              fetchGroupData(group.id);
                            }
                          }}
                        >
                          <div className="flex items-center gap-3 flex-1">
                            {ImageComponent(getGroupRepUrl(group.id), {
                              width: 48,
                              height: 48,
                              className: 'w-12 h-12 object-cover rounded-full',
                              alt: group.label,
                              iconType: 'person'
                            })}
                            <div className="flex-1">
                              {editingGroupLabel === group.id ? (
                                <div 
                                  className="flex items-center space-x-2" 
                                  onClick={(e) => e.stopPropagation()}
                                  onBlur={(e) => {
                                    // Only save if focus moved outside this element
                                    if (!e.currentTarget.contains(e.relatedTarget)) {
                                      handleSaveGroupLabel(group.id);
                                    }
                                  }}
                                >
                                  <input
                                    type="text"
                                    value={groupLabelValue}
                                    onChange={(e) => setGroupLabelValue(e.target.value)}
                                    className="flex-1 border-b-2 border-primary-500 bg-transparent px-2 py-1 text-base font-medium focus:outline-none"
                                    placeholder="Person name..."
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleSaveGroupLabel(group.id);
                                      } else if (e.key === 'Escape') {
                                        handleCancelEditGroupLabel();
                                      }
                                    }}
                                  />
                                </div>
                              ) : (
                                <div>
                                  <h4 
                                    className={`font-medium text-gray-900 inline-block ${
                                      permissions.canEdit ? 'cursor-pointer hover:text-primary-600 transition-colors' : ''
                                    }`}
                                    onClick={permissions.canEdit ? ((e) => {
                                      e.stopPropagation();
                                      handleEditGroupLabel(group.id, group.label);
                                    }) : undefined}
                                  >
                                    {group.label}
                                  </h4>
                                  <p className="text-sm text-gray-600">
                                    {totalFacesCount} {totalFacesCount === 1 ? t('uploadDetail.face') : t('uploadDetail.facesPlural')}, {uploadFacesCount} {t('uploadDetail.inThisUpload')}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {permissions.isProfilesManager && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleManageGroupAccess(group.id);
                                }}
                                className="w-8 h-8 rounded-md hover:bg-blue-100 text-blue-600 flex items-center justify-center transition-colors"
                                title={t('uploadDetail.manageProfileAccess')}
                                aria-label={t('uploadDetail.manageProfileAccess')}
                              >
                                <Key className="w-4 h-4" />
                              </button>
                            )}
                            <a
                              href={`/${eventUrl}/people/${encodeURIComponent(group.label)}`}
                              onClick={(e) => {
                                if (shouldLetBrowserHandle(e)) return; // Let browser handle
                                e.stopPropagation();
                                e.preventDefault();
                                const groupFaces = getGroupFacesInUpload(group.id);
                                const imageIds = groupFaces.map(f => f.image_id);
                                navigate(`/${eventUrl}/people/${encodeURIComponent(group.label)}`, {
                                  state: { highlightImages: imageIds }
                                });
                              }}
                              className="w-8 h-8 rounded-md hover:bg-gray-100 text-gray-600 flex items-center justify-center transition-colors"
                              title={t('uploadDetail.goToPersonPage')}
                              aria-label={t('uploadDetail.goToPersonPage')}
                            >
                              <User className="w-4 h-4" />
                            </a>
                            <div>
                              {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                            </div>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-gray-200">
                            <div className="p-4">
                              {groupFaces.length === 0 ? (
                                <p className="text-gray-500 text-sm text-center py-4">{t('uploadDetail.noFacesFromThisUpload')}</p>
                              ) : (
                                <div 
                                  className="photo-gallery-grid"
                                  style={{
                                    gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(100, 266 * imageSize * 0.75)}px, 1fr))`,
                                    gridAutoRows: `${Math.max(100, 266 * imageSize * 0.75)}px`
                                  }}
                                >
                                  {groupFaces.map((face, faceIndex) => {
                                    const img = entities?.[eventId]?.images?.[face.image_id];
                                    if (!img) return null;
                                    const isRep = isRepresentative(face.id);
                                    return (
                                      <div
                                        key={face.id}
                                        className={`photo-card ${imageClasses[face.image_id] || 'square'}`}
                                      >
                                        <SingleImageTile
                                          ref={(el) => {
                                            if (!groupFaceTileRefs.current[group.id]) {
                                              groupFaceTileRefs.current[group.id] = [];
                                            }
                                            if (el && groupFaceTileRefs.current[group.id][faceIndex] !== el) {
                                              groupFaceTileRefs.current[group.id][faceIndex] = el;
                                            }
                                          }}
                                          image={img}
                                          aspectClass={imageClasses[img.id] || 'square'}
                                          imageFit="cover"
                                          thumbSrc={img.isPlaceholder ? null : (urlHelpers?.getFaceCropUrl?.(face.id))}
                                          selectionMode={selectionMode}
                                          isSelected={currentSelection.has(face.id)}
                                          onToggleSelect={(e) => toggleImageSelection(face.id, e)}
                                          onOpen={() => openImageViewerInGroup(group.id, face.id)}
                                          onImageLoad={(e) => handleImageLoad(img.id, e)}
                                          eventUrl={eventUrl}
                                          urlHelpers={urlHelpers}
                                          showFavoriteButton={false}
                                          showArchiveButton={false}
                                          showCropBadge={false}
                                          showRepresentativeButton={true}
                                          isRepresentative={isRep}
                                          photoIndex={faceIndex}
                                          contextType="Person"
                                          contextLabel={groupEntity?.label || group.label}
                                          onSetRepresentative={() => handleSetFaceAsRep(group.id, face.id)}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
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
                  <p className="text-gray-500">{t('uploadDetail.noMomentsInThisUpload')}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {uploadMoments.map((moment) => {
                    const isExpanded = expandedMoment === moment.id;
                    const momentImages = isExpanded ? getMomentImagesInUpload(moment.id) : [];
                    const momentEntity = entities?.[eventId]?.moments?.[moment.id];
                    const isRepresentative = (imageId) => momentEntity?.representative_image === imageId;

                    const uploadMomentRelation = upload?.moments?.[moment.id];
                    const totalImagesCount = uploadMomentRelation?.images_count || momentEntity?.images_count || 0;
                    const uploadImagesCount = uploadMomentRelation?.upload_images_count || 0;

                    return (
                      <div key={moment.id} className="border rounded-lg overflow-hidden" data-moment-id={moment.id}>
                        <div
                          onClick={() => {
                            toggleMoment(moment.id);
                            if (!isExpanded) {
                              fetchMomentData(moment.id);
                            }
                          }}
                          className="flex items-center justify-between p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-center gap-3 flex-1">
                            {ImageComponent(getMomentRepUrl(moment.id), {
                              width: 48,
                              height: 48,
                              className: 'w-12 h-12 object-cover rounded-lg',
                              alt: moment.label
                            })}
                            <div>
                              <h4 className="font-medium text-gray-900">{moment.label}</h4>
                              <p className="text-sm text-gray-600">
                                {totalImagesCount} {totalImagesCount === 1 ? t('uploadDetail.photo') : t('uploadDetail.photosPlural')}, {uploadImagesCount} {t('uploadDetail.inThisUpload')}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <a
                              href={`/${eventUrl}/timeline?moment=${encodeURIComponent(moment.label)}`}
                              onClick={(e) => {
                                if (shouldLetBrowserHandle(e)) return; // Let browser handle
                                e.stopPropagation();
                                e.preventDefault();
                                const momentImages = getMomentImagesInUpload(moment.id);
                                const imageIds = momentImages.map(img => img.id);
                                navigate(`/${eventUrl}/timeline?moment=${encodeURIComponent(moment.label)}`, {
                                  state: { 
                                    highlightImages: imageIds,
                                    highlightMoment: moment.label
                                  }
                                });
                              }}
                              className="w-8 h-8 rounded-md hover:bg-gray-100 text-gray-600 flex items-center justify-center transition-colors"
                              title={t('uploadDetail.goToMoment')}
                              aria-label={t('uploadDetail.goToMoment')}
                            >
                              <Clock className="w-4 h-4" />
                            </a>
                            {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-gray-200">
                            <div className="p-4">
                              {momentImages.length === 0 ? (
                                <p className="text-gray-500 text-sm text-center py-4">{t('uploadDetail.noImagesFromThisUpload')}</p>
                              ) : (
                                <div 
                                  className="photo-gallery-grid"
                                  style={{
                                    gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(100, 266 * imageSize * 0.75)}px, 1fr))`,
                                    gridAutoRows: `${Math.max(100, 266 * imageSize * 0.75)}px`
                                  }}
                                >
                                  {momentImages.map((img, imgIndex) => {
                                    const isRep = isRepresentative(img.id);
                                    return (
                                      <div
                                        key={img.id}
                                        className={`photo-card ${imageClasses[img.id] || 'square'}`}
                                      >
                                        <SingleImageTile
                                          ref={(el) => {
                                            if (!momentImageTileRefs.current[moment.id]) {
                                              momentImageTileRefs.current[moment.id] = [];
                                            }
                                            if (el && momentImageTileRefs.current[moment.id][imgIndex] !== el) {
                                              momentImageTileRefs.current[moment.id][imgIndex] = el;
                                            }
                                          }}
                                          image={img}
                                          aspectClass={imageClasses[img.id] || 'square'}
                                          imageFit="cover"
                                          thumbSrc={img.isPlaceholder ? null : (urlHelpers?.getThumbnailUrl?.(img.id))}
                                          selectionMode={selectionMode}
                                          isSelected={currentSelection.has(img.id)}
                                          onToggleSelect={(e) => toggleImageSelection(img.id, e)}
                                          onOpen={() => openImageViewerInMoment(moment.id, img.id)}
                                          onImageLoad={(e) => handleImageLoad(img.id, e)}
                                          eventUrl={eventUrl}
                                          urlHelpers={urlHelpers}
                                          showFavoriteButton={false}
                                          showArchiveButton={false}
                                          photoIndex={imgIndex}
                                          contextType="Moment"
                                          contextLabel={moment?.label || moment?.name}
                                          showRepresentativeButton={true}
                                          isRepresentative={isRep}
                                          onSetRepresentative={() => handleSetMomentImageAsRep(moment.id, img.id)}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
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
          {t('uploadDetail.dataMayHaveChanged')}
        </div>
      </div>

      {/* Floating Selection Controls - using component for all modes */}
      {mode === 'images' && (
        <FloatingSelectionControls
          selectedCount={currentSelection.size}
          totalCount={uploadImages.length}
          selectedImages={currentSelection}
          onSelectAll={selectAllCurrent}
          onClearSelection={clearCurrentSelection}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
          placeholderDataUrl={null}
          showTransferFaces={false}
          showRemoveFromMoment={false}
          showMoveToMoment={true}
          showArchive={false}
          showFavorites={false}
          showBucket={false}
          showAlbum={false}
          showDelete={true}
          showManageAccess={true}
          showSetRepresentative={false}
          selectionMode={selectionMode}
          entity="upload"
          entityId={uploadId}
          onMoveToMoment={() => setShowMoveToMomentModal(true)}
        />
      )}
      
      {mode === 'groups' && (
        <FloatingSelectionControls
          selectedCount={currentSelection.size}
          totalCount={uploadImages.length}
          selectedImages={currentSelection}
          onSelectAll={selectAllCurrent}
          onClearSelection={clearCurrentSelection}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
          placeholderDataUrl={null}
          showTransferFaces={true}
          showRemoveFromMoment={false}
          showMoveToMoment={false}
          showArchive={false}
          showFavorites={false}
          showBucket={false}
          showAlbum={false}
          showDelete={false}
          showManageAccess={false}
          showSetRepresentative={false}
          selectionMode={selectionMode}
          entity="upload"
          entityId={uploadId}
          onTransferFaces={handleTransferFacesClick}
        />
      )}
      
      {mode === 'moments' && (
        <FloatingSelectionControls
          selectedCount={currentSelection.size}
          totalCount={uploadImages.length}
          selectedImages={currentSelection}
          onSelectAll={selectAllCurrent}
          onClearSelection={clearCurrentSelection}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
          placeholderDataUrl={null}
          showTransferFaces={false}
          showRemoveFromMoment={false}
          showMoveToMoment={true}
          showArchive={false}
          showFavorites={false}
          showBucket={false}
          showAlbum={false}
          showDelete={false}
          showManageAccess={false}
          showSetRepresentative={false}
          selectionMode={selectionMode}
          entity="upload"
          entityId={uploadId}
          onMoveToMoment={() => setShowMoveToMomentModal(true)}
        />
      )}

      {/* Image Viewer */}
      {viewerOpen && (
        <ImageViewer {...viewerProps} />
      )}

      {/* Manage Access Modal */}
      <ManageAccessModal
        isOpen={showManageAccessModal}
        onClose={() => setShowManageAccessModal(false)}
        entityType={manageAccessEntity.type}
        entityIds={manageAccessEntity.ids}
        eventUrl={eventUrl}
      />

      {/* Move to Moment Modal */}
      {showMoveToMomentModal && (
        <MoveToMomentModal
          isOpen={showMoveToMomentModal}
          onClose={() => setShowMoveToMomentModal(false)}
          selectedImages={currentSelection}
          onMoveComplete={handleMoveToMomentComplete}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
        />
      )}

      {/* Transfer Faces Modal */}
      {showTransferFacesModal && (
        <TransferFacesModal
          isOpen={showTransferFacesModal}
          onClose={() => {
            setShowTransferFacesModal(false);
            setSelectedFacesForTransfer([]);
          }}
          currentGroup={expandedGroup ? entities?.[eventId]?.groups?.[expandedGroup] : null}
          selectedFaces={selectedFacesForTransfer}
          onTransferComplete={handleTransferFacesComplete}
          sourceGroupId={expandedGroup}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
        />
      )}
    </div>
  );
}




