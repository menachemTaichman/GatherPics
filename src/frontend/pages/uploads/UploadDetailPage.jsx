import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
import usePinchToZoom from '../../hooks/usePinchToZoom';
import { Upload, Image as ImageIcon, Users, Clock, ArrowUp, ArrowDown, ChevronDown, ChevronUp, ArrowLeft, Square, CheckSquare, Edit2, Save, RotateCcw, Minus, Plus, User, AlertCircle, Key, Info, Filter } from 'lucide-react';
import { uploadsAPI, groupsAPI, momentsAPI } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { useUploadById, useDataStore } from '../../utils/dataManager';
import { useApplyScopes, useChilds, useEventId } from '../../utils/storeUtils';
import { sortImages, sortGroups } from '../../utils/sorting';
import { getPreference, setPreference } from '../../utils/settings';
import { usePreference } from '../../hooks/useSettings';
import { formatErrorMessage } from '../../utils/errorHandler';
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react';
import { SingleImageTile, ImageViewer } from '../../components/images';
import AbsoluteMasonryGrid from '../../components/images/AbsoluteMasonryGrid';
import { FloatingSelectionControls } from '../../components/layout';
import { ManageAccessModal } from '../../components/profiles';
import { MoveToMomentModal } from '../../components/moments';
import { TransferFacesModal } from '../../components/groups';
import UploadFormModal from '../../components/uploads/UploadFormModal';
import { ImageComponent } from '../../hooks/useImage.jsx';
import useImageSelection from '../../hooks/useImageSelection';
import { LongPressHoverButton } from '../../components/common';
import useImageViewerController from '../../hooks/useImageViewerController.js';
import { useImageViewerGridSync } from '../../hooks/useImageViewerGridSync';
import { useFaceImageMapping } from '../../hooks/useFaceImageMapping';
import { shallow } from 'zustand/shallow';
import { useAuth } from '../../contexts/authContext';
import { useAuthRefresh } from '../../hooks/useAuthRefresh';
import { usePermissions } from '../../hooks/usePermissions';

import { formatDateTimeLocale, calculateDuration, formatDuration } from '../../utils/dateUtils';

export default function UploadDetail({ eventUrl, urlHelpers }) {
  const params = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isRTL, startClass, endClass, ps, pe } = useRTL();
  const uploadId = params.uploadId;
  const eventId = useEventId(eventUrl);
  const { isAuthenticated } = useAuth();
  
  const [mode, setMode] = useState(() => getPreference('UploadDetail.mode', 'images'));
  const sortDir = usePreference('UploadDetail.sortDir', 'asc');
  const setSortDir = (value) => setPreference('UploadDetail.sortDir', value);
  const groupsSortBy = usePreference('UploadDetail.groupsSortBy', 'name');
  const setGroupsSortBy = (value) => setPreference('UploadDetail.groupsSortBy', value);
  const selectionMode = usePreference('general.select', false);
  const setSelectionMode = (value) => setPreference('general.select', value);
  const imageSize = usePreference('general.size', 1.0);
  const setImageSize = (value) => setPreference('general.size', value);
  const [imageSizeInputValue, setImageSizeInputValue] = useState();
  
  // Mobile detection
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768; // md breakpoint
  });
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  // Pinch-to-zoom for mobile
  const setGridContainerRef = usePinchToZoom(imageSize, setImageSize);
  const [expandedGroup, setExpandedGroup] = useState(null); // Single group ID
  const [expandedMoment, setExpandedMoment] = useState(null); // Single moment ID
  const [imageClasses, setImageClasses] = useState({});
  const imageClassesRef = useRef(imageClasses);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');
  const [editingGroupLabel, setEditingGroupLabel] = useState(null);
  const [groupLabelValue, setGroupLabelValue] = useState('');
  const [editingMomentLabel, setEditingMomentLabel] = useState(null);
  const [momentLabelValue, setMomentLabelValue] = useState('');
  const [showManageAccessModal, setShowManageAccessModal] = useState(false);
  const [manageAccessEntity, setManageAccessEntity] = useState({ type: null, ids: [] });
  const [showMoveToMomentModal, setShowMoveToMomentModal] = useState(false);
  const [showTransferFacesModal, setShowTransferFacesModal] = useState(false);
  const [selectedFacesForTransfer, setSelectedFacesForTransfer] = useState([]);
  const [showUploadFormModal, setShowUploadFormModal] = useState(false);
  
  const permissions = usePermissions();
  
  const { showToast } = useToast();
  
  useEffect(() => { imageClassesRef.current = imageClasses; }, [imageClasses]);

  // Refs for arrow key navigation (separate for each mode)
  const imageTileRefs = useRef([]);
  const gridRef = useRef(null);
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
      // Clear refs when collapsing to avoid stale refs
      if (groupFaceTileRefs.current[groupId]) {
        groupFaceTileRefs.current[groupId] = [];
      }
    } else {
      setExpandedGroup(groupId);
    }
  };

  const toggleMoment = (momentId) => {
    if (expandedMoment === momentId) {
      setExpandedMoment(null);
      // Clear moment selection when closing
      clearMomentSelection();
      // Clear refs when collapsing to avoid stale refs
      if (momentImageTileRefs.current[momentId]) {
        momentImageTileRefs.current[momentId] = [];
      }
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
  
  // Sort groups by name or count (count = faces in this upload, from upload relation)
  const uploadGroups = useMemo(() => {
    // Use placeholders when not authenticated
    const groups = isAuthenticated ? rawUploadGroups : placeholderGroups;
    
    // Skip sorting for placeholders
    if (!isAuthenticated) return groups;
    
    if (groupsSortBy === 'count') {
      // Sort by faces in this upload (upload_faces_count from upload.groups[groupId])
      return [...groups].sort((a, b) => {
        const countA = upload?.groups?.[a.id]?.upload_faces_count ?? 0;
        const countB = upload?.groups?.[b.id]?.upload_faces_count ?? 0;
        const comparison = countA - countB;
        return sortDir === 'asc' ? comparison : -comparison;
      });
    }
    return sortGroups(groups, groupsSortBy, sortDir);
  }, [rawUploadGroups, placeholderGroups, groupsSortBy, sortDir, isAuthenticated, upload]);
  
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

  // Entities needed for group faces selection (before getGroupFacesInUpload is defined)
  const entitiesForSelection = useDataStore((state) => state.entities?.[eventId] || null);
  const groupFacesForSelection = useMemo(() => {
    if (mode !== 'groups' || !expandedGroup || !entitiesForSelection) return [];
    const group = entitiesForSelection.groups?.[expandedGroup];
    if (!group?.faces) return [];
    const facesMap = entitiesForSelection.faces || {};
    const imagesMap = entitiesForSelection.images || {};
    const faces = Array.from(group.faces)
      .map((faceId) => facesMap[faceId])
      .filter((face) => {
        if (!face) return false;
        const image = imagesMap[face.image_id];
        return image && String(image.upload_id) === String(uploadId);
      });
    return faces.sort((a, b) => {
      const imgA = imagesMap[a.image_id];
      const imgB = imagesMap[b.image_id];
      if (!imgA || !imgB) return 0;
      const dateA = imgA.date_taken ? new Date(imgA.date_taken).getTime() : 0;
      const dateB = imgB.date_taken ? new Date(imgB.date_taken).getTime() : 0;
      return sortDir === 'asc' ? dateA - dateB : dateB - dateA;
    });
  }, [mode, expandedGroup, entitiesForSelection, uploadId, sortDir]);

  const {
    selectedKeys: selectedImagesInGroupsMode,
    toggleKey: toggleSelectedImageInGroupsMode,
    clear: clearGroupSelection,
    selectAll: selectAllImagesInGroupsMode,
  } = useImageSelection({
    items: groupFacesForSelection,
    getKey: (face) => (face?.id != null ? String(face.id) : undefined),
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
  
  // Track which mode/section we're viewing for proper refocus
  const currentViewerContextRef = useRef({ mode: null, groupId: null, momentId: null });
  
  // Subscribe to entities early (needed for getRefsForImage)
  const entities = useDataStore((state) => state.entities, shallow);
  
  // Helper to get faces of a group filtered by this upload, sorted by image date
  const getGroupFacesInUpload = useCallback((groupId) => {
    const group = entities?.[eventId]?.groups?.[groupId];
    if (!group) return [];
    
    const facesSet = group.faces;
    if (!facesSet || !(facesSet instanceof Set)) return [];
    
    const facesMap = entities?.[eventId]?.faces || {};
    const imagesMap = entities?.[eventId]?.images || {};
    
    const faces = Array.from(facesSet)
      .map(faceId => facesMap[faceId])
      .filter(face => {
        if (!face) return false;
        const image = imagesMap[face.image_id];
        return image && String(image.upload_id) === String(uploadId);
      });
    
    // Sort faces by their image's date_taken (matching GroupDetailPage behavior)
    return faces.sort((a, b) => {
      const imgA = imagesMap[a.image_id];
      const imgB = imagesMap[b.image_id];
      
      if (!imgA || !imgB) return 0;
      
      const dateA = imgA.date_taken ? new Date(imgA.date_taken).getTime() : 0;
      const dateB = imgB.date_taken ? new Date(imgB.date_taken).getTime() : 0;
      
      // Use sortDir (asc/desc) for sorting
      if (sortDir === 'asc') {
        return dateA - dateB;
      } else {
        return dateB - dateA;
      }
    });
  }, [entities, uploadId, eventId, sortDir]);

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
  
  // Function to get refs for an image based on current context (for multi-grid support)
  const getRefsForImage = useCallback((imageId) => {
    if (!imageId) return null;
    
    // Normalize imageId to string for comparison
    const normalizedImageId = String(imageId);
    const context = currentViewerContextRef.current;
    
    // Check images mode (default fallback if context is not set)
    if (!context || context.mode === 'images' || !context.mode) {
      const imageIndex = uploadImages.findIndex(img => String(img.id) === normalizedImageId);
      if (imageIndex >= 0 && imageTileRefs.current && imageTileRefs.current[imageIndex]) {
        return { refs: imageTileRefs.current, index: imageIndex };
      }
    }
    
    // Check groups mode
    if (context && context.mode === 'groups' && context.groupId) {
      // Use the same helper function to ensure arrays match
      const groupFaces = getGroupFacesInUpload(context.groupId);
      
      // First, check if the ID is a faceId (for refocus after close)
      let faceIndex = groupFaces.findIndex(face => String(face.id) === normalizedImageId);
      
      // If not found as faceId, check if it's an imageId
      if (faceIndex === -1) {
        faceIndex = groupFaces.findIndex(face => String(face.image_id) === normalizedImageId);
      }
      
      if (faceIndex >= 0 && groupFaceTileRefs.current[context.groupId] && groupFaceTileRefs.current[context.groupId][faceIndex]) {
        return { refs: groupFaceTileRefs.current[context.groupId], index: faceIndex };
      }
    }
    
    // Check moments mode
    if (context && context.mode === 'moments' && context.momentId) {
      // Use the same helper function to ensure arrays match
      const momentImages = getMomentImagesInUpload(context.momentId);
      const imageIndex = momentImages.findIndex(img => String(img.id) === normalizedImageId);
      if (imageIndex >= 0 && momentImageTileRefs.current[context.momentId] && momentImageTileRefs.current[context.momentId][imageIndex]) {
        return { refs: momentImageTileRefs.current[context.momentId], index: imageIndex };
      }
    }
    
    // Fallback: try images mode even if context suggests otherwise (in case context was lost)
    if (context && context.mode !== 'images') {
      const imageIndex = uploadImages.findIndex(img => String(img.id) === normalizedImageId);
      if (imageIndex >= 0 && imageTileRefs.current && imageTileRefs.current[imageIndex]) {
        return { refs: imageTileRefs.current, index: imageIndex };
      }
    }
    
    return null;
  }, [uploadImages, imageTileRefs, entities, eventId, uploadId, getGroupFacesInUpload, getMomentImagesInUpload]);
  
  // Image viewer grid sync hook - combines grid scrolling, focus after close, and image highlight
  // Use uploadImages for the main images grid, but support multi-grid via getRefsForImage
  const { onImageChange: baseOnImageChange, highlightedIds, registerImageRef, setCurrentImageId } = useImageViewerGridSync({
    gridRef,
    sortedImages: uploadImages,
    imageTileRefs,
    viewerOpen,
    getRefsForImage
  });

  // Wrapper for onImageChange that handles face-to-image mapping in groups mode
  // When ImageViewer navigates, it sends imageId, but in groups mode we need to scroll to the face
  const onImageChange = useCallback((imageId, imageIndex) => {
    const context = currentViewerContextRef.current;
    
    // In groups mode, convert imageId to faceId and scroll to the face
    if (context && context.mode === 'groups' && context.groupId) {
      const groupFaces = getGroupFacesInUpload(context.groupId);
      
      // Find the face that belongs to this image
      const matchingFaces = groupFaces.filter(face => String(face.image_id) === String(imageId));
      
      if (matchingFaces.length > 0) {
        // Use the first matching face
        const faceToUse = matchingFaces[0];
        const faceId = faceToUse.id;
        
        // Find the index of this face in the groupFaces array
        const faceIndex = groupFaces.findIndex(f => String(f.id) === String(faceId));
        
        if (faceIndex >= 0) {
          // Track the faceId for refocus on close
          if (setCurrentImageId) {
            setCurrentImageId(faceId);
          }
          
          // Scroll to the face element using getRefsForImage
          // getRefsForImage expects imageId and will find the face by image_id
          // Use a small delay to ensure the element is rendered
          setTimeout(() => {
            const refs = getRefsForImage(imageId);
            if (refs && refs.refs && refs.refs[refs.index]) {
              const element = refs.refs[refs.index];
              
              // Find the scrollable container
              let scrollContainer = null;
              let parent = element.parentElement;
              while (parent && parent !== document.body) {
                const style = window.getComputedStyle(parent);
                if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                  scrollContainer = parent;
                  break;
                }
                parent = parent.parentElement;
              }
              
              if (scrollContainer) {
                const containerRect = scrollContainer.getBoundingClientRect();
                const elementRect = element.getBoundingClientRect();
                const currentScrollTop = scrollContainer.scrollTop;
                const elementTopInContent = (elementRect.top - containerRect.top) + currentScrollTop;
                const containerHeight = scrollContainer.clientHeight;
                const elementHeight = elementRect.height;
                const targetScroll = elementTopInContent - (containerHeight / 2) + (elementHeight / 2);
                const finalScroll = Math.max(0, Math.min(targetScroll, scrollContainer.scrollHeight - containerHeight));
                
                scrollContainer.scrollTo({ top: finalScroll, behavior: 'smooth' });
              } else {
                // Fallback to scrollIntoView
                element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
              }
            }
          }, 50);
          
          return;
        }
      }
    }
    
    // For images mode or moments mode, use imageId directly
    baseOnImageChange(imageId, imageIndex);
    if (setCurrentImageId) {
      setCurrentImageId(imageId);
    }
  }, [baseOnImageChange, setCurrentImageId, getGroupFacesInUpload, getRefsForImage]);

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
    // Track context for refocus
    currentViewerContextRef.current = { mode: 'images', groupId: null, momentId: null };
    setCurrentImageId(imageId);
    
    // Find the actual index in the sorted uploadImages list (matching viewer's sorting)
    const sortedImageIds = uploadImages.map(img => img.id);
    const actualIndex = sortedImageIds.indexOf(imageId);
    if (actualIndex === -1) {
      // Fallback to provided index if not found
      openViewer({ index, parent: uploadId, entity: 'upload', sortBy: 'date', sortOrder: sortDir });
    } else {
      openViewer({ index: actualIndex, parent: uploadId, entity: 'upload', sortBy: 'date', sortOrder: sortDir });
    }
  };

  // Open image viewer for a group (showing only images from this upload)
  // Viewer shows unique images; index must be into that list (same order as useChilds in ImageViewer)
  const openImageViewerInGroup = (groupId, faceId) => {
    // Track context for refocus
    currentViewerContextRef.current = { mode: 'groups', groupId, momentId: null };
    
    const faces = getGroupFacesInUpload(groupId);
    const face = entities?.[eventId]?.faces?.[faceId];
    if (!face) return;
    
    // Build unique image list in same order as viewer (first occurrence of each image)
    const uniqueImageIds = [];
    const seen = new Set();
    for (const f of faces) {
      if (!seen.has(f.image_id)) {
        seen.add(f.image_id);
        uniqueImageIds.push(f.image_id);
      }
    }
    const index = uniqueImageIds.indexOf(face.image_id);
    if (index === -1) return;
    
    setCurrentImageId(face.id);
    openViewer({ index, parent: groupId, entity: 'group', sortBy: 'date', sortOrder: sortDir, filterByUploadId: uploadId });
  };

  // Open image viewer for a moment (showing only images from this upload)
  const openImageViewerInMoment = (momentId, imageId) => {
    // Track context for refocus
    currentViewerContextRef.current = { mode: 'moments', groupId: null, momentId };
    
    const images = getMomentImagesInUpload(momentId);
    const imageIds = images.map(img => img.id);
    const index = imageIds.indexOf(imageId);
    if (index === -1) return;
    
    setCurrentImageId(imageId);
    openViewer({ index, parent: momentId, entity: 'moment', sortBy: 'date', sortOrder: 'asc', filterByUploadId: uploadId });
  };
  
  const toggleImageSelection = (imageId, event) => {
    toggleCurrentSelection(imageId, event);
  };

  // Swipe selection support (for all modes)
  const lastSwipedIdsRef = useRef(new Set());
  
  const handleSelectRange = useCallback((ids, isStart) => {
    // ids הוא מערך של כל הפריטים שנבחרו בטווח (כמו Shift)
    if (!ids || ids.length === 0) return;

    // Range selection is only used in images/moments grids (image IDs). In groups mode the face grid has no onSelectRange.
    const idsToUse = ids;

    // אם זו תחילת לחיצה ארוכה (checkbox)
    if (isStart) {
      setSelectionMode(true); // כניסה למצב בחירה
      // בוחרים את כל הפריטים בטווח
      idsToUse.forEach(id => {
        if (!currentSelection.has(id)) {
          toggleCurrentSelection(id);
        }
      });
      lastSwipedIdsRef.current = new Set(idsToUse);
      return;
    }

    // בזמן גרירה - עדכון הבחירה לכל הפריטים בטווח
    const currentIds = new Set(idsToUse);
    
    // הסרת פריטים שיצאו מהטווח
    lastSwipedIdsRef.current.forEach(id => {
      if (!currentIds.has(id)) {
        if (currentSelection.has(id)) {
          toggleCurrentSelection(id);
        }
      }
    });
    
    // הוספת פריטים חדשים שנכנסו לטווח
    currentIds.forEach(id => {
      if (!lastSwipedIdsRef.current.has(id)) {
        if (!currentSelection.has(id)) {
          toggleCurrentSelection(id);
        }
      }
    });
    
    lastSwipedIdsRef.current = currentIds;
  }, [toggleCurrentSelection, currentSelection, setSelectionMode, mode, expandedGroup, getGroupFacesInUpload]);
  
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

  const handleEditMomentLabel = (momentId, currentLabel) => {
    setEditingMomentLabel(momentId);
    setMomentLabelValue(currentLabel || '');
  };

  const handleSaveMomentLabel = async (momentId) => {
    try {
      await momentsAPI.update(momentId, { label: momentLabelValue }, eventUrl);
      showToast(t('uploadDetail.momentLabelUpdated'), 'success');
      setEditingMomentLabel(null);
    } catch (error) {
      console.error('Failed to update moment label:', error);
      showToast(formatErrorMessage('update moment label', error), 'error');
    }
  };

  const handleCancelEditMomentLabel = () => {
    setEditingMomentLabel(null);
    setMomentLabelValue('');
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
    <div className="w-full" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="h-[4rem]"></div>
      {/* Sticky Header */}
      <div className="sticky top-[4rem] z-30 bg-white border-b border-gray-200/50 px-4 sm:px-8 py-2 sm:py-4 shadow-sm">
        {/* Title Row - Mobile: includes controls in same row, Desktop: title only */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-shrink-0 flex-1 sm:flex-initial">
            <Link
              to={`/${eventUrl}/uploads`}
              className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
              title={t('uploadDetail.backToUploads')}
              aria-label={t('uploadDetail.backToUploads')}
            >
              <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
            </Link>
            <button
              onClick={() => setShowUploadFormModal(true)}
              className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
              title={t('uploadDetail.uploadDetails')}
              aria-label={t('uploadDetail.uploadDetails')}
            >
              <Info className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600" />
            </button>
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

          {/* Mobile: Controls in same row as title */}
          <div className="flex sm:hidden items-center gap-1.5 flex-wrap min-w-0">
            {/* Tabs */}
            <div className="flex items-center divide-x divide-gray-200 overflow-x-auto min-w-0">
              <div className="flex gap-0.5 px-1">
                <button
                  onClick={() => handleModeChange('images')}
                  className={`flex items-center gap-0.5 px-1.5 py-1 border-b-2 transition-colors whitespace-nowrap ${
                    mode === 'images'
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <ImageIcon className="w-3 h-3" />
                  <span className="font-medium text-xs">{t('uploadDetail.photos')}</span>
                  <span className="font-medium text-xs">({uploadImages.length})</span>
                </button>
                <button
                  onClick={() => handleModeChange('groups')}
                  className={`flex items-center gap-0.5 px-1.5 py-1 border-b-2 transition-colors whitespace-nowrap ${
                    mode === 'groups'
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Users className="w-3 h-3" />
                  <span className="font-medium text-xs">{t('uploadDetail.people')}</span>
                  <span className="font-medium text-xs">({uploadGroups.length})</span>
                </button>
                <button
                  onClick={() => handleModeChange('moments')}
                  className={`flex items-center gap-0.5 px-1.5 py-1 border-b-2 transition-colors whitespace-nowrap ${
                    mode === 'moments'
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Clock className="w-3 h-3" />
                  <span className="font-medium text-xs">{t('uploadDetail.moments')}</span>
                  <span className="font-medium text-xs">({uploadMoments.length})</span>
                </button>
              </div>
            </div>

            {/* Controls */}
            {(mode === 'images' || mode === 'groups' || mode === 'moments') && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {/* Sort By - Only show in groups mode */}
                {mode === 'groups' && (
                  <div className="relative">
                    <select
                      value={groupsSortBy}
                      onChange={(e) => setGroupsSortBy(e.target.value)}
                      dir={isRTL ? 'rtl' : 'ltr'}
                      className={`appearance-none ${ps('2')} ${pe('10')} py-1 text-xs border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white`}
                    >
                      <option value="name">{t('groupsGallery.sortByName')}</option>
                      <option value="count">{t('groupsGallery.sortByCount')}</option>
                    </select>
                    <Filter className={`absolute ${endClass('2')} top-1/2 transform -translate-y-1/2 text-gray-400 w-3 h-3 pointer-events-none`} />
                  </div>
                )}

                {/* Sort */}
                <LongPressHoverButton
                  onClick={toggleSortDir}
                  className="w-6 h-6 border border-transparent rounded-md transition-colors hover:bg-gray-100 flex items-center justify-center"
                  title={sortDir === 'asc' ? t('uploadDetail.sortAscending') : t('uploadDetail.sortDescending')}
                  aria-label={sortDir === 'asc' ? t('uploadDetail.sortAscending') : t('uploadDetail.sortDescending')}
                >
                  {sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                </LongPressHoverButton>

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
                  className="w-6 h-6 border border-transparent rounded-md transition-colors hover:bg-gray-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                  title={t('uploadDetail.decreaseSize')}
                  aria-label={t('uploadDetail.decreaseSize')}
                >
                  <Minus className="w-3 h-3" />
                </button>
                <input
                  type="text"
                  id="upload-detail-image-size-mobile"
                  name="upload-detail-image-size-mobile"
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
                  className="text-xs font-medium text-gray-700 w-8 text-center bg-transparent border-b border-gray-300 focus:outline-none focus:border-primary-500"
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
                  className="w-6 h-6 border border-transparent rounded-md transition-colors hover:bg-gray-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                  title={t('uploadDetail.increaseSize')}
                  aria-label={t('uploadDetail.increaseSize')}
                >
                  <Plus className="w-3 h-3" />
                </button>

                {/* Selection Mode */}
                {uploadImages.length > 0 && (
                  <button
                    onClick={() => setSelectionMode(!selectionMode)}
                    className={`w-6 h-6 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                      selectionMode 
                        ? 'bg-primary-100 text-primary-700 hover:bg-primary-200' 
                        : 'hover:bg-gray-100 text-gray-700'
                    }`}
                    title={selectionMode ? t('uploadDetail.cancelSelectionMode') : t('uploadDetail.showCheckboxes')}
                    aria-label={selectionMode ? t('uploadDetail.cancelSelectionMode') : t('uploadDetail.showCheckboxes')}
                  >
                    {selectionMode ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                  </button>
                )}
              </div>
            )}

            {/* Notes field - Mobile (compact) */}
            {upload && (
              <div className="flex items-center gap-1 text-xs min-w-0 flex-1">
                {editingNotes ? (
                  <div className="flex items-center gap-1 min-w-0 flex-1">
                    <span className="text-gray-600 whitespace-nowrap">{t('uploadDetail.notes')}:</span>
                    <input
                      type="text"
                      value={notesValue}
                      onChange={(e) => setNotesValue(e.target.value)}
                      dir={isRTL ? 'rtl' : 'ltr'}
                      className="flex-1 min-w-0 border rounded px-1 py-0.5 text-xs"
                      placeholder={t('uploadDetail.addNotes')}
                      autoFocus
                    />
                    <button
                      onClick={handleSaveNotes}
                      className="p-0.5 hover:bg-green-100 rounded transition-colors flex-shrink-0"
                      title={t('uploadDetail.save')}
                      aria-label={t('uploadDetail.save')}
                    >
                      <Save className="w-3 h-3 text-green-600" />
                    </button>
                    <button
                      onClick={handleCancelEditNotes}
                      className="p-0.5 hover:bg-red-100 rounded transition-colors flex-shrink-0"
                      title={t('uploadDetail.cancel')}
                      aria-label={t('uploadDetail.cancel')}
                    >
                      <RotateCcw className="w-3 h-3 text-red-600" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 min-w-0 flex-1">
                    <span className="text-gray-600 whitespace-nowrap">{t('uploadDetail.notes')}:</span>
                    <span className="text-gray-900 truncate min-w-0">{upload.notes || <span className="text-gray-400 italic">{t('uploadDetail.noNotes')}</span>}</span>
                    <button
                      onClick={handleEditNotes}
                      className="p-0.5 hover:bg-blue-100 rounded transition-colors flex-shrink-0"
                      title={t('uploadDetail.editNotes')}
                      aria-label={t('uploadDetail.editNotes')}
                    >
                      <Edit2 className="w-3 h-3 text-blue-600" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Controls Row with Tabs - Desktop: separate row */}
        <div className="hidden sm:flex mt-4 items-center justify-between">
          {/* Tabs */}
          <div className="flex items-center divide-x divide-gray-200">
            <div className="flex gap-1 px-4">
              <button
                onClick={() => handleModeChange('images')}
                className={`flex items-center gap-2 px-3 py-2 border-b-2 transition-colors ${
                  mode === 'images'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <ImageIcon className="w-4 h-4" />
                <span className="font-medium">{t('uploadDetail.photos')}</span>
                <span className="font-medium">({uploadImages.length})</span>
              </button>
              <button
                onClick={() => handleModeChange('groups')}
                className={`flex items-center gap-2 px-3 py-2 border-b-2 transition-colors ${
                  mode === 'groups'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <Users className="w-4 h-4" />
                <span className="font-medium">{t('uploadDetail.people')}</span>
                <span className="font-medium">({uploadGroups.length})</span>
              </button>
              <button
                onClick={() => handleModeChange('moments')}
                className={`flex items-center gap-2 px-3 py-2 border-b-2 transition-colors ${
                  mode === 'moments'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <Clock className="w-4 h-4" />
                <span className="font-medium">{t('uploadDetail.moments')}</span>
                <span className="font-medium">({uploadMoments.length})</span>
              </button>
            </div>

            {/* Controls */}
            {(mode === 'images' || mode === 'groups' || mode === 'moments') && (
              <>
                {/* Sort By - Only show in groups mode */}
                {mode === 'groups' && (
                  <div className="flex items-center gap-3 px-4">
                    <div className="relative">
                      <select
                        value={groupsSortBy}
                        onChange={(e) => setGroupsSortBy(e.target.value)}
                        dir={isRTL ? 'rtl' : 'ltr'}
                        className={`appearance-none ${ps('3')} ${pe('10')} py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white`}
                      >
                        <option value="name">{t('groupsGallery.sortByName')}</option>
                        <option value="count">{t('groupsGallery.sortByCount')}</option>
                      </select>
                      <Filter className={`absolute ${endClass('3')} top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none`} />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 px-4">
                  {/* Sort */}
                  <button
                    onClick={toggleSortDir}
                    className="w-8 h-8 border border-transparent rounded-md transition-colors hover:bg-gray-100 flex items-center justify-center"
                    title={sortDir === 'asc' ? t('uploadDetail.sortAscending') : t('uploadDetail.sortDescending')}
                    aria-label={sortDir === 'asc' ? t('uploadDetail.sortAscending') : t('uploadDetail.sortDescending')}
                  >
                    {sortDir === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex items-center gap-3 px-4">
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
                    title={t('uploadDetail.decreaseSize')}
                    aria-label={t('uploadDetail.decreaseSize')}
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
                    title={t('uploadDetail.increaseSize')}
                    aria-label={t('uploadDetail.increaseSize')}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {/* Selection Mode */}
                {uploadImages.length > 0 && (
                  <div className="flex items-center gap-3 px-4">
                    <button
                      onClick={() => setSelectionMode(!selectionMode)}
                      className={`w-8 h-8 border border-transparent rounded-md transition-colors flex items-center justify-center ${
                        selectionMode 
                          ? 'bg-primary-100 text-primary-700 hover:bg-primary-200' 
                          : 'hover:bg-gray-100 text-gray-700'
                      }`}
                      title={selectionMode ? t('uploadDetail.cancelSelectionMode') : t('uploadDetail.showCheckboxes')}
                      aria-label={selectionMode ? t('uploadDetail.cancelSelectionMode') : t('uploadDetail.showCheckboxes')}
                    >
                      {selectionMode ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Notes field - Desktop */}
          {upload && (
            <div className="mt-3 px-4 text-sm">
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
      <div className="px-4 sm:px-8 pt-0 pb-0 overflow-x-auto">
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
                <div className="w-full" style={{ height: `calc(100vh - ${isMobile ? '15rem' : '16rem'})`, marginTop: '1rem' }}>
                  <AbsoluteMasonryGrid
                    ref={gridRef}
                    items={uploadImages}
                    baseSize={Math.max(60, 266 * imageSize)}
                    imageClasses={imageClasses}
                    containerHeight="100%"
                    className="w-full"
                    onPinchRef={setGridContainerRef}
                    onSelectRange={handleSelectRange}
                    style={{
                      '--grid-scale': 1,
                      '--grid-z-index': 1,
                    }}
                    onItemRef={(img, index, el) => {
                      if (el) {
                        registerImageRef(img.id, el);
                        // Store ref for arrow key navigation - find actual index
                        const actualIndex = uploadImages.findIndex(uploadImg => uploadImg.id === img.id);
                        if (actualIndex !== -1 && imageTileRefs.current[actualIndex] !== el) {
                          imageTileRefs.current[actualIndex] = el;
                        }
                      }
                    }}
                    renderItem={(img, index, isPortrait, setRef, extraProps) => {
                      return (
                        <div
                          className={`photo-card ${imageClasses[img.id] || 'square'}`}
                          style={{ width: '100%', height: '100%' }}
                        >
                          <SingleImageTile
                            ref={setRef}
                            image={img}
                            aspectClass={imageClasses[img.id] || 'square'}
                            imageFit="cover"
                            thumbSrc={img.isPlaceholder ? null : (urlHelpers?.getThumbnailUrl?.(img.id))}
                            selectionMode={selectionMode}
                            isSelected={currentSelection.has(img.id)}
                            onToggleSelect={(e) => toggleImageSelection(img.id, e)}
                            startDrag={extraProps?.startDrag}
                            onOpen={() => openImageViewerInUpload(img.id, index)}
                            onImageLoad={(e) => handleImageLoad(img.id, e)}
                            eventUrl={eventUrl}
                            urlHelpers={urlHelpers}
                            isHighlighted={highlightedIds?.has(img.id)}
                            showFavoriteButton={false}
                            showArchiveButton={false}
                            photoIndex={index}
                            contextType="Upload"
                            contextLabel={upload?.profile_label || uploadId}
                          />
                        </div>
                      );
                    }}
                  />
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
                <OverlayScrollbarsComponent
                  element="div"
                  className="mt-2"
                  options={{
                    scrollbars: {
                      theme: isRTL ? 'os-theme-dark os-theme-dark-rtl' : 'os-theme-dark',
                      autoHide: 'never',
                      autoHideDelay: 0,
                      clickScroll: true,
                      dragScroll: true,
                      pointers: ['mouse', 'touch', 'pen'],
                      visibility: 'visible',
                      size: '10px',
                    },
                    overflow: { x: 'hidden', y: 'scroll' },
                  }}
                  style={{ maxHeight: isMobile ? 'calc(100vh - 15rem)' : 'calc(100vh - 16rem)', touchAction: 'pan-y' }}
                >
                  <div className="space-y-4 pr-2">
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
                                <OverlayScrollbarsComponent
                                  element="div"
                                  className="mt-2"
                                  options={{
                                    scrollbars: {
                                      theme: isRTL ? 'os-theme-dark os-theme-dark-rtl' : 'os-theme-dark',
                                      autoHide: 'never',
                                      autoHideDelay: 0,
                                      clickScroll: true,
                                      dragScroll: true,
                                      pointers: ['mouse', 'touch', 'pen'],
                                      visibility: 'visible',
                                      size: '10px',
                                    },
                                    overflow: { x: 'hidden', y: 'scroll' },
                                  }}
                                  style={{ height: '430px', touchAction: 'pan-y' }}
                                >
                                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 p-1">
                                    {groupFaces.map((face, faceIndex) => {
                                      const img = entities?.[eventId]?.images?.[face.image_id];
                                      if (!img) return null;
                                      const isRep = isRepresentative(face.id);
                                      return (
                                        <div
                                          key={face.id}
                                          ref={(el) => {
                                            if (!groupFaceTileRefs.current[group.id]) {
                                              groupFaceTileRefs.current[group.id] = [];
                                            }
                                            if (el && groupFaceTileRefs.current[group.id][faceIndex] !== el) {
                                              groupFaceTileRefs.current[group.id][faceIndex] = el;
                                            }
                                          }}
                                          className={`aspect-square ${imageClasses[face.image_id] || 'square'}`}
                                        >
                                          <SingleImageTile
                                            image={img}
                                            aspectClass={imageClasses[img.id] || 'square'}
                                            imageFit="cover"
                                            thumbSrc={img.isPlaceholder ? null : (urlHelpers?.getFaceCropUrl?.(face.id))}
                                            selectionMode={selectionMode}
                                            isSelected={currentSelection.has(String(face.id))}
                                            onToggleSelect={(e) => toggleImageSelection(String(face.id), e)}
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
                                </OverlayScrollbarsComponent>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </OverlayScrollbarsComponent>
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
                <OverlayScrollbarsComponent
                  element="div"
                  className="mt-2"
                  options={{
                    scrollbars: {
                      theme: isRTL ? 'os-theme-dark os-theme-dark-rtl' : 'os-theme-dark',
                      autoHide: 'never',
                      autoHideDelay: 0,
                      clickScroll: true,
                      dragScroll: true,
                      pointers: ['mouse', 'touch', 'pen'],
                      visibility: 'visible',
                      size: '10px',
                    },
                    overflow: { x: 'hidden', y: 'scroll' },
                  }}
                  style={{ maxHeight: isMobile ? 'calc(100vh - 15rem)' : 'calc(100vh - 16rem)', touchAction: 'pan-y' }}
                >
                  <div className="space-y-4 pr-2">
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
                            <div className="flex-1">
                              {editingMomentLabel === moment.id ? (
                                <div 
                                  className="flex items-center space-x-2" 
                                  onClick={(e) => e.stopPropagation()}
                                  onBlur={(e) => {
                                    // Only save if focus moved outside this element
                                    if (!e.currentTarget.contains(e.relatedTarget)) {
                                      handleSaveMomentLabel(moment.id);
                                    }
                                  }}
                                >
                                  <input
                                    type="text"
                                    value={momentLabelValue}
                                    onChange={(e) => setMomentLabelValue(e.target.value)}
                                    className="flex-1 border-b-2 border-primary-500 bg-transparent px-2 py-1 text-base font-medium focus:outline-none"
                                    placeholder="Moment name..."
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleSaveMomentLabel(moment.id);
                                      } else if (e.key === 'Escape') {
                                        handleCancelEditMomentLabel();
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
                                      handleEditMomentLabel(moment.id, moment.label);
                                    }) : undefined}
                                  >
                                    {moment.label}
                                  </h4>
                                  <p className="text-sm text-gray-600">
                                    {totalImagesCount} {totalImagesCount === 1 ? t('uploadDetail.photo') : t('uploadDetail.photosPlural')}, {uploadImagesCount} {t('uploadDetail.inThisUpload')}
                                  </p>
                                </div>
                              )}
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
                                <OverlayScrollbarsComponent
                                  element="div"
                                  className="mt-2"
                                  options={{
                                    scrollbars: {
                                      theme: isRTL ? 'os-theme-dark os-theme-dark-rtl' : 'os-theme-dark',
                                      autoHide: 'never',
                                      autoHideDelay: 0,
                                      clickScroll: true,
                                      dragScroll: true,
                                      pointers: ['mouse', 'touch', 'pen'],
                                      visibility: 'visible',
                                      size: '10px',
                                    },
                                    overflow: { x: 'hidden', y: 'scroll' },
                                  }}
                                  style={{ height: '430px', touchAction: 'pan-y' }}
                                >
                                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 p-1">
                                    {momentImages.map((img, imgIndex) => {
                                      const isRep = isRepresentative(img.id);
                                      return (
                                        <div
                                          key={img.id}
                                          ref={(el) => {
                                            if (!momentImageTileRefs.current[moment.id]) {
                                              momentImageTileRefs.current[moment.id] = [];
                                            }
                                            if (el && momentImageTileRefs.current[moment.id][imgIndex] !== el) {
                                              momentImageTileRefs.current[moment.id][imgIndex] = el;
                                            }
                                          }}
                                          className={`aspect-square ${imageClasses[img.id] || 'square'}`}
                                        >
                                          <SingleImageTile
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
                                </OverlayScrollbarsComponent>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </OverlayScrollbarsComponent>
              )}
            </motion.div>
          )}
        </AnimatePresence>
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
          showDelete={true}
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
        <ImageViewer {...viewerProps} onImageChange={onImageChange} />
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

      {/* Upload Form Modal */}
      <UploadFormModal
        isOpen={showUploadFormModal}
        onClose={() => setShowUploadFormModal(false)}
        eventUrl={eventUrl}
        existingUploadId={uploadId}
        onUploadComplete={fetchUploadDetails}
        onUploadSuccess={(newUploadId) => {
          if (newUploadId) {
            navigate(`/${eventUrl}/uploads/${newUploadId}`);
          }
        }}
      />
    </div>
  );
}




