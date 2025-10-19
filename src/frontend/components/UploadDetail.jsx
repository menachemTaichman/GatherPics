import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, Image as ImageIcon, Users, Clock, ArrowUp, ArrowDown, ChevronDown, ChevronUp } from 'lucide-react';
import { useModalFocus } from '../utils/useModalFocus';
import { useModalManager } from '../utils/modalManager';
import { uploadsAPI } from '../utils/apiService';
import { useToast } from '../utils/ToastContext';
import { useUploadById, useDataStore } from '../utils/dataManager';
import { useApplyScopes, useImagesForParent, useGroupsForUpload, useMomentsForUpload } from '../utils/storeUtils';
import { sortImages } from '../utils/sorting';
import { getPreference, setPreference } from '../utils/settings';
import { formatErrorMessage } from '../utils/errorHandler';
import SingleImageTile from './SingleImageTile';
import ImageViewer from './ImageViewer';
import { ImageComponent } from '../utils/useImage.jsx';

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

export default function UploadDetail({ uploadId, eventUrl, urlHelpers, onClose }) {
  const [mode, setMode] = useState(() => getPreference('UploadsDetail.mode', 'images'));
  const [sortDir, setSortDir] = useState(() => getPreference('UploadsDetail.sortDir', 'asc'));
  const [expandInUpload, setExpandInUpload] = useState(() => getPreference('UploadsDetail.groups_expand_in_upload', true));
  const [expandOthers, setExpandOthers] = useState(() => getPreference('UploadsDetail.groups_expand_others', false));
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [expandedMoments, setExpandedMoments] = useState(new Set());
  const [viewerState, setViewerState] = useState({ show: false, imageId: null, index: 0 });
  const [groupFacesCache, setGroupFacesCache] = useState({});
  const [momentImagesCache, setMomentImagesCache] = useState({});
  
  const { showToast } = useToast();
  const { registerModal, unregisterModal } = useModalManager();
  const modalId = `upload-detail-${uploadId}`;

  useApplyScopes([
    { entity: 'upload', id: String(uploadId) },
    { entity: 'all', id: 'faces' }  // Allow face upserts
  ]);

  useEffect(() => {
    registerModal({ 
      id: modalId, 
      type: 'popup',
      allowOutsideScroll: true,
      scopes: [{ entity: 'upload', id: String(uploadId) }]
    });
    
    const handleAuthLogout = () => {
      onClose();
    };
    window.addEventListener('auth:logout', handleAuthLogout);
    
    return () => {
      unregisterModal(modalId);
      window.removeEventListener('auth:logout', handleAuthLogout);
    };
  }, [uploadId, registerModal, unregisterModal]);

  const { modalRef } = useModalFocus(true, onClose, {
    modalId: modalId,
    modalType: 'popup',
    allowOutsideScroll: true
  });

  const upload = useUploadById(uploadId);

  useEffect(() => {
    if (uploadId && eventUrl) {
      fetchUploadDetails();
    }
  }, [uploadId, eventUrl]);

  const fetchUploadDetails = async () => {
    try {
      await uploadsAPI.getById(uploadId, eventUrl);
    } catch (error) {
      console.error('Failed to fetch upload details:', error);
      showToast(formatErrorMessage('fetch upload details', error), 'error');
    }
  };

  const handleModeChange = (newMode) => {
    setMode(newMode);
    setPreference('UploadsDetail.mode', newMode);
  };

  const toggleSortDir = () => {
    const newDir = sortDir === 'asc' ? 'desc' : 'asc';
    setSortDir(newDir);
    setPreference('UploadsDetail.sortDir', newDir);
  };

  const toggleExpandInUpload = () => {
    const newValue = !expandInUpload;
    setExpandInUpload(newValue);
    setPreference('UploadsDetail.groups_expand_in_upload', newValue);
  };

  const toggleExpandOthers = () => {
    const newValue = !expandOthers;
    setExpandOthers(newValue);
    setPreference('UploadsDetail.groups_expand_others', newValue);
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
  const uploadGroups = useGroupsForUpload(uploadId);
  const uploadMoments = useMomentsForUpload(uploadId);

  // Get all images for upload
  const uploadImages = useImagesForParent({ 
    entity: 'upload', 
    parentId: uploadId, 
    includeArchived: true,
    sortBy: 'date',
    sortOrder: sortDir
  });

  // Fetch group faces when group is expanded
  const fetchGroupFaces = async (groupId) => {
    if (groupFacesCache[groupId]) return;
    
    try {
      // Fetch both in_upload and not_in_upload faces
      const [inUploadData, notInUploadData] = await Promise.all([
        uploadsAPI.getGroupFacesInUpload(uploadId, groupId, eventUrl),
        uploadsAPI.getGroupFacesNotInUpload(uploadId, groupId, eventUrl)
      ]);
      
      setGroupFacesCache(prev => ({
        ...prev,
        [groupId]: {
          uploaded_ids: inUploadData.face_ids || [],
          other_ids: notInUploadData.face_ids || []
        }
      }));
    } catch (error) {
      console.error('Failed to fetch group faces:', error);
      showToast(formatErrorMessage('fetch group faces', error), 'error');
    }
  };

  // Fetch moment images when moment is expanded
  const fetchMomentImages = async (momentId) => {
    if (momentImagesCache[momentId]) return;
    
    try {
      const data = await uploadsAPI.getMomentImages(uploadId, momentId, eventUrl);
      setMomentImagesCache(prev => ({
        ...prev,
        [momentId]: {
          image_ids: data.image_ids || []
        }
      }));
    } catch (error) {
      console.error('Failed to fetch moment images:', error);
      showToast(formatErrorMessage('fetch moment images', error), 'error');
    }
  };

  useEffect(() => {
    if (mode === 'groups') {
      expandedGroups.forEach(groupId => {
        if (!groupFacesCache[groupId]) {
          fetchGroupFaces(groupId);
        }
      });
    }
  }, [mode, expandedGroups, uploadId]);

  useEffect(() => {
    if (mode === 'moments') {
      expandedMoments.forEach(momentId => {
        if (!momentImagesCache[momentId]) {
          fetchMomentImages(momentId);
        }
      });
    }
  }, [mode, expandedMoments, uploadId]);

  const openImageViewer = (imageId, isFromUpload = true) => {
    if (!isFromUpload) {
      // For images not from this upload (e.g., "other images" in groups),
      // show toast and don't open viewer
      showToast('This image is not part of this upload', 'info');
      return;
    }
    
    // Always find the correct index in uploadImages
    const actualIndex = uploadImages.findIndex(img => img.id === imageId);
    if (actualIndex >= 0) {
      setViewerState({ show: true, imageId, index: actualIndex });
    }
  };

  const closeImageViewer = () => {
    setViewerState({ show: false, imageId: null, index: 0 });
  };

  const handleNavigate = (direction, jumpIndex) => {
    const images = uploadImages;
    if (!images || images.length === 0) return;
    
    let newIndex = viewerState.index;
    
    if (direction === 'prev') {
      newIndex = viewerState.index - 1;
      if (newIndex < 0) newIndex = images.length - 1;
    } else if (direction === 'next') {
      newIndex = viewerState.index + 1;
      if (newIndex >= images.length) newIndex = 0;
    } else if (direction === 'jump' && typeof jumpIndex === 'number') {
      newIndex = Math.max(0, Math.min(jumpIndex, images.length - 1));
    }
    
    setViewerState({ show: true, imageId: images[newIndex]?.id, index: newIndex });
  };

  const getFacesByIds = (faceIds) => {
    const facesMap = useDataStore.getState().entities?.faces || {};
    return faceIds.map(id => facesMap[id]).filter(Boolean);
  };

  const getImagesByIds = (imageIds) => {
    const imagesMap = useDataStore.getState().entities?.images || {};
    return imageIds.map(id => imagesMap[id]).filter(Boolean);
  };

  const getGroupRepUrl = (groupId) => {
    const group = useDataStore.getState().entities?.groups?.[groupId];
    if (!group || !urlHelpers?.getRepresentativeUrl) return null;
    return `${urlHelpers.getRepresentativeUrl('groups', groupId)}?v=${group.representative_face || 'none'}`;
  };

  const getMomentRepUrl = (momentId) => {
    const moment = useDataStore.getState().entities?.moments?.[momentId];
    if (!moment || !urlHelpers?.getRepresentativeUrl) return null;
    return `${urlHelpers.getRepresentativeUrl('moments', momentId)}?v=${moment.representative_image || 'none'}`;
  };

  return (
    <>
      <AnimatePresence>
        {!viewerState.show && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <motion.div
              ref={modalRef}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                    <Upload className="w-5 h-5 text-primary-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">Upload Details</h2>
                    <p className="text-sm text-gray-500">
                      {upload?.started_at ? formatDateTime(upload.started_at) : 'Loading...'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Upload Info Summary */}
              {upload && (
                <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Profile:</span>
                      <span className="ml-2 font-medium text-gray-900">{upload.profile_label || 'Unknown'}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Images:</span>
                      <span className="ml-2 font-medium text-gray-900">{upload.images_count || 0}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Faces:</span>
                      <span className="ml-2 font-medium text-gray-900">{upload.faces_count || 0}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Groups:</span>
                      <span className="ml-2 font-medium text-gray-900">{upload.clusters_count || 0}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Moments:</span>
                      <span className="ml-2 font-medium text-gray-900">{upload.moments_count || 0}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Status:</span>
                      <span className={`ml-2 font-medium ${
                        upload.status === 'completed' ? 'text-green-600' : 'text-yellow-600'
                      }`}>{upload.status || 'unknown'}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Completed:</span>
                      <span className="ml-2 font-medium text-gray-900">
                        {upload.completed_at ? formatDateTime(upload.completed_at) : 'N/A'}
                      </span>
                    </div>
                    {upload.errors && (
                      <div className="col-span-2 md:col-span-4">
                        <span className="text-gray-600">Errors:</span>
                        <span className="ml-2 text-red-600 text-xs">{upload.errors}</span>
                      </div>
                    )}
                    {upload.notes && (
                      <div className="col-span-2 md:col-span-4">
                        <span className="text-gray-600">Notes:</span>
                        <span className="ml-2 text-gray-900">{upload.notes}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tabs */}
              <div className="border-b border-gray-200 px-6">
                <div className="flex space-x-1">
                  <button
                    onClick={() => handleModeChange('images')}
                    className={`flex items-center space-x-2 px-4 py-3 border-b-2 transition-colors ${
                      mode === 'images'
                        ? 'border-primary-500 text-primary-600'
                        : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <ImageIcon className="w-4 h-4" />
                    <span className="font-medium">Images</span>
                  </button>
                  <button
                    onClick={() => handleModeChange('groups')}
                    className={`flex items-center space-x-2 px-4 py-3 border-b-2 transition-colors ${
                      mode === 'groups'
                        ? 'border-primary-500 text-primary-600'
                        : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    <span className="font-medium">Groups</span>
                  </button>
                  <button
                    onClick={() => handleModeChange('moments')}
                    className={`flex items-center space-x-2 px-4 py-3 border-b-2 transition-colors ${
                      mode === 'moments'
                        ? 'border-primary-500 text-primary-600'
                        : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Clock className="w-4 h-4" />
                    <span className="font-medium">Moments</span>
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6">
                <AnimatePresence mode="wait">
                  {mode === 'images' && (
                    <motion.div
                      key="images"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Sort control */}
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-900">
                          All Images ({uploadImages.length})
                        </h3>
                        <button
                          onClick={toggleSortDir}
                          className="flex items-center space-x-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                        >
                          <span className="text-sm font-medium">Date</span>
                          {sortDir === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
                        </button>
                      </div>

                      {uploadImages.length === 0 ? (
                        <div className="text-center py-12">
                          <ImageIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                          <p className="text-gray-500">No images in this upload</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                          {uploadImages.map((img) => (
                            <SingleImageTile
                              key={img.id}
                              image={img}
                              thumbSrc={urlHelpers?.getThumbnailUrl?.(img.id)}
                              onOpen={() => openImageViewer(img.id)}
                              eventUrl={eventUrl}
                              urlHelpers={urlHelpers}
                              showFavoriteButton={false}
                              showArchiveButton={false}
                              showCheckbox={false}
                            />
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
                      className="space-y-4"
                    >
                      <h3 className="text-lg font-semibold text-gray-900">
                        Groups ({uploadGroups.length})
                      </h3>

                      {uploadGroups.length === 0 ? (
                        <div className="text-center py-12">
                          <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                          <p className="text-gray-500">No groups in this upload</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {uploadGroups.map((group) => {
                            const isExpanded = expandedGroups.has(group.id);
                            const cache = groupFacesCache[group.id];
                            const uploadedFaces = cache ? getFacesByIds(cache.uploaded_ids) : [];
                            const otherFaces = cache ? getFacesByIds(cache.other_ids) : [];

                            return (
                              <div key={group.id} className="border rounded-lg overflow-hidden">
                                <div
                                  onClick={() => {
                                    toggleGroup(group.id);
                                    if (!isExpanded) {
                                      fetchGroupFaces(group.id);
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
                                        {group.faces_count || 0} total faces
                                      </p>
                                    </div>
                                  </div>
                                  {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                                </div>

                                {isExpanded && cache && (
                                  <div className="p-4 space-y-4">
                                    {/* From this upload section */}
                                    {uploadedFaces.length > 0 && (
                                      <div>
                                        <button
                                          onClick={toggleExpandInUpload}
                                          className="flex items-center justify-between w-full mb-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                                        >
                                          <span>From this upload ({uploadedFaces.length})</span>
                                          {expandInUpload ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                        </button>
                                        {expandInUpload && (
                                          <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                                            {uploadedFaces.map((face) => (
                                              <div
                                                key={face.id}
                                                className="aspect-square cursor-pointer hover:opacity-80 transition-opacity"
                                                onClick={() => openImageViewer(face.image_id)}
                                              >
                                                {ImageComponent(urlHelpers?.getFaceCropUrl?.(face.id), {
                                                  width: 100,
                                                  height: 100,
                                                  className: 'w-full h-full object-cover rounded-lg',
                                                  alt: group.label,
                                                  iconType: 'person'
                                                })}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* Other faces section */}
                                    {otherFaces.length > 0 && (
                                      <div>
                                        <button
                                          onClick={toggleExpandOthers}
                                          className="flex items-center justify-between w-full mb-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                                        >
                                          <span>Other faces ({otherFaces.length})</span>
                                          {expandOthers ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                        </button>
                                        {expandOthers && (
                                          <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                                            {otherFaces.map((face) => (
                                              <div
                                                key={face.id}
                                                className="aspect-square cursor-pointer hover:opacity-80 transition-opacity"
                                                onClick={() => openImageViewer(face.image_id, false)}
                                              >
                                                {ImageComponent(urlHelpers?.getFaceCropUrl?.(face.id), {
                                                  width: 100,
                                                  height: 100,
                                                  className: 'w-full h-full object-cover rounded-lg',
                                                  alt: group.label,
                                                  iconType: 'person'
                                                })}
                                              </div>
                                            ))}
                                          </div>
                                        )}
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
                      className="space-y-4"
                    >
                      <h3 className="text-lg font-semibold text-gray-900">
                        Moments ({uploadMoments.length})
                      </h3>

                      {uploadMoments.length === 0 ? (
                        <div className="text-center py-12">
                          <Clock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                          <p className="text-gray-500">No moments in this upload</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {uploadMoments.map((moment) => {
                            const isExpanded = expandedMoments.has(moment.id);
                            const cache = momentImagesCache[moment.id];
                            const momentImages = cache ? getImagesByIds(cache.image_ids) : [];

                            return (
                              <div key={moment.id} className="border rounded-lg overflow-hidden">
                                <div
                                  onClick={() => {
                                    toggleMoment(moment.id);
                                    if (!isExpanded) {
                                      fetchMomentImages(moment.id);
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
                                        {cache ? momentImages.length : '...'} images from this upload
                                      </p>
                                    </div>
                                  </div>
                                  {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                                </div>

                                {isExpanded && cache && (
                                  <div className="p-4">
                                    {momentImages.length === 0 ? (
                                      <p className="text-gray-500 text-sm text-center py-4">No images from this upload</p>
                                    ) : (
                                      <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                                        {momentImages.map((img) => (
                                          <SingleImageTile
                                            key={img.id}
                                            image={img}
                                            thumbSrc={urlHelpers?.getThumbnailUrl?.(img.id)}
                                            onOpen={() => openImageViewer(img.id)}
                                            eventUrl={eventUrl}
                                            urlHelpers={urlHelpers}
                                            showFavoriteButton={false}
                                            showArchiveButton={false}
                                            showCheckbox={false}
                                          />
                                        ))}
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

              {/* Footer */}
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                <div className="flex justify-end">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Image Viewer */}
      {viewerState.show && viewerState.imageId && (
        <ImageViewer
          image={viewerState.imageId}
          eventUrl={eventUrl}
          onClose={closeImageViewer}
          onNavigate={handleNavigate}
          totalImages={uploadImages.length}
          currentIndex={viewerState.index}
          showToast={showToast}
          parent={uploadId}
          entity="upload"
          sortBy="date"
          sortOrder={sortDir}
          urlHelpers={urlHelpers}
        />
      )}
    </>
  );
}

