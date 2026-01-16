import { useState, useEffect, useMemo } from 'react';
import { X, AlertTriangle, Calendar, Plus, Clock, Search, ArrowUp, ArrowDown } from 'lucide-react';
import { momentsAPI, handleAPIError } from '../../utils/apiService';
import { usePreference } from '../../hooks/useSettings';
import { setPreference, getImageCount } from '../../utils/settings';
import { toggleSortOrder } from '../../utils/sorting';
import { useDataStore, selectors as storeSelectors } from '../../utils/dataManager';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import { useModalStore } from '../../utils/modalManager';
import { ImageComponent } from '../../hooks/useImage.jsx';
import { getRepresentativeUrl, useApplyScopes, useEventId } from '../../utils/storeUtils';
import { sortMoments } from '../../utils/sorting';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
import { LongPressHoverButton } from '../common';

export default function MoveToMomentModal({ 
  isOpen, 
  eventUrl,
  onClose, 
  selectedImages,
  onMoveComplete,
  sourceMomentId, // Deprecated: kept for backward compatibility but not used
  urlHelpers: injectedUrlHelpers
}) {
  const { showToast } = useToast();
  const eventId = useEventId(eventUrl);
  const urlHelpers = injectedUrlHelpers;
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isRTL, startClass, ps, pe } = useRTL();
  const allMoments = useDataStore(state => storeSelectors.momentsAll(state, eventId));
  const entities = useDataStore(state => state.entities?.[eventId]);
  const MODAL_ID = 'move-to-moment-modal';
  const [selectedMomentId, setSelectedMomentId] = useState('');
  const [newMomentName, setNewMomentName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMoments, setIsLoadingMoments] = useState(false);
  const [error, setError] = useState('');
  const [nameConflict, setNameConflict] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [removeFromCurrent, setRemoveFromCurrent] = useState(false);
  const sortBy = usePreference('Moments.sortBy', 'date');
  const setSortBy = (value) => setPreference('Moments.sortBy', value);
  const sortOrder = usePreference('Moments.sortDir', 'asc');
  const setSortOrder = (value) => setPreference('Moments.sortDir', value);

  // Get all source moments from the selected images
  const sourceMoments = useMemo(() => {
    const momentMap = new Map();
    const imageIds = Array.from(selectedImages);
    
    imageIds.forEach(imageId => {
      const image = entities?.images?.[imageId];
      const momentId = image?.moment_id;
      if (momentId && !momentMap.has(momentId)) {
        const moment = allMoments.find(m => m.id === momentId);
        if (moment) {
          momentMap.set(momentId, moment);
        }
      }
    });
    
    return Array.from(momentMap.values());
  }, [selectedImages, entities, allMoments]);

  // Determine if we should show the remove option
  // Show if any image has a moment (the remove operation clears moments from all selected images)
  const showRemoveOption = sourceMoments.length > 0;
  const hasMultipleMoments = sourceMoments.length > 1;

  // Custom keyboard handler for MoveToMomentModal
  const handleMoveModalKeys = (e) => {
    const targetTagName = e.target.tagName?.toLowerCase();
    
    // Handle button elements - prevent Enter from triggering toggle buttons, route to save instead
    if (targetTagName === 'button') {
      // Check if this is the save button using data attribute
      const isSaveButton = e.target.dataset?.isSaveButton === 'true';
      
      // Allow save button to work normally
      if (isSaveButton && e.key === 'Enter') {
        return false; // Let the button's onClick handle it
      }
      // For other buttons (like toggles), prevent Enter from triggering them
      // Instead, trigger move if conditions are met
      if (e.key === 'Enter' && !isLoading && !nameConflict && (selectedMomentId || newMomentName.trim() || removeFromCurrent)) {
        e.preventDefault();
        e.stopPropagation();
        handleMove();
        return true;
      }
      // For ESC key, return false to let useModalFocus handle closing the modal
      if (e.key === 'Escape') {
        return false;
      }
      // For other keys on buttons, allow default behavior
      return true;
    }
    
    // Allow all normal input behavior for input, textarea, and select elements
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      // For Enter key, trigger move if conditions are met
      if (e.key === 'Enter' && !isLoading && !nameConflict && (selectedMomentId || newMomentName.trim() || removeFromCurrent)) {
        e.preventDefault();
        e.stopPropagation();
        handleMove();
        return true;
      }
      // For ESC key, return false to let useModalFocus handle closing the modal
      if (e.key === 'Escape') {
        return false;
      }
      // Return true to signal that we're handling this, preventing useModalFocus from stopping it
      return true;
    }
    
    return false; // Let default modal behavior handle it (ESC to close)
  };
  
  // Use modal focus hook
  const { modalRef } = useModalFocus(isOpen, onClose, {
    customKeyHandler: handleMoveModalKeys,
    modalType: 'popup',
    modalId: MODAL_ID,
    allowOutsideScroll: true
  });

  // Filter out source moments from available moments
  const availableMoments = allMoments.filter(m => {
    // Exclude any moment that contains selected images
    return !sourceMoments.some(sm => sm.id === m.id);
  });

  // Filter and sort moments
  const filteredAndSortedMoments = availableMoments
    .filter(moment => {
      const label = moment.label || `Moment ${moment.id}`;
      return label.toLowerCase().includes(searchTerm.toLowerCase());
    })
    .sort((a, b) => {
      if (sortBy === 'date') {
        return sortMoments([a, b], sortOrder)[0] === a ? -1 : 1;
      } else {
        // Sort by name
        const aValue = a.label || `Moment ${a.id}`;
        const bValue = b.label || `Moment ${b.id}`;
        if (sortOrder === 'asc') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      }
    })
    // Remove duplicate moments by moment_id to prevent React key conflicts
    .reduce((unique, moment) => {
      if (!unique.some(m => m.id === moment.id)) {
        unique.push(moment);
      }
      return unique;
    }, []);

  // Apply scope for all moments
  useApplyScopes(isOpen ? [{ entity: 'all', id: 'moments', eventId }] : []);
  
  useEffect(() => {
    if (isOpen) {
      const { registerModal, unregisterModal } = useModalStore.getState();
      try {
        registerModal({ id: MODAL_ID, type: 'popup', allowOutsideScroll: true });
      } catch {}
      
      // Load moments with loading state
      const loadMoments = async () => {
        setIsLoadingMoments(true);
        try {
          await momentsAPI.getAll(eventUrl);
        } catch (error) {
          console.error('Failed to load moments:', error);
        } finally {
          setIsLoadingMoments(false);
        }
      };
      
      loadMoments();
      
      setSelectedMomentId('');
      setNewMomentName('');
      setError('');
      setNameConflict(false);
      setSearchTerm('');
      setRemoveFromCurrent(false);
      
      // Listen for logout to auto-close modal
      const handleAuthLogout = () => {
        onClose();
      };
      window.addEventListener('auth:logout', handleAuthLogout);
      
      return () => {
        try { unregisterModal(MODAL_ID); } catch {}
        window.removeEventListener('auth:logout', handleAuthLogout);
      };
    } else {
      // Clean up timeout when modal closes
      if (window.momentNameConflictTimeout) {
        clearTimeout(window.momentNameConflictTimeout);
        window.momentNameConflictTimeout = null;
      }
      setIsLoadingMoments(false);
    }
  }, [isOpen, eventUrl]);

  const checkNameConflict = async (name) => {
    if (!name.trim()) {
      setNameConflict(false);
      return;
    }

    try {
      // Check if moment name already exists
      const exists = allMoments.some(m => m.label === name.trim());
      setNameConflict(exists);
    } catch (error) {
      console.error('Error checking name conflict:', error);
      setNameConflict(false);
    }
  };

  const handleNewMomentNameChange = (e) => {
    const name = e.target.value;
    setNewMomentName(name);
    
    if (!handleNewMomentNameChange._t) handleNewMomentNameChange._t = null;
    if (handleNewMomentNameChange._t) clearTimeout(handleNewMomentNameChange._t);
    handleNewMomentNameChange._t = setTimeout(() => {
      checkNameConflict(name);
    }, 300);
  };

  const handleMove = async () => {
    if (isLoading) return; // Strictly prevent double submit
    setIsLoading(true); // Set immediately

    if (!selectedImages || selectedImages.length === 0) {
      setError(t('moveToMoment.noImagesSelected'));
      setIsLoading(false);
      return;
    }

    // If only removing from current moment (no target selected)
    if (removeFromCurrent && !selectedMomentId && !newMomentName.trim()) {
      if (sourceMoments.length === 0) {
        setError(t('moveToMoment.noMomentToRemoveFrom'));
        setIsLoading(false);
        return;
      }
      
      try {
        const imageIds = Array.from(selectedImages);
        
        // Remove from all moments (single API call)
        await momentsAPI.removeImages(imageIds, eventUrl);
        
        const removedCount = imageIds.length;
        const imageText = removedCount === 1 ? 'image' : 'images';
        const momentText = removedCount === 1 ? 'its moment' : 'their moments';
        
        showToast(
          <span>
            {removedCount} {imageText} removed from {momentText}
          </span>,
          'success'
        );
        
        if (onMoveComplete) {
          onMoveComplete({ imageIds, removed: true });
        }
        onClose();
        return;
      } catch (error) {
        const errorInfo = handleAPIError(error, 'Failed to remove images from moment');
        setError(errorInfo.message);
        setIsLoading(false);
        return;
      }
    }

    if (!selectedMomentId && !newMomentName.trim()) {
      setError(t('moveToMoment.selectTargetOrEnterName'));
      setIsLoading(false);
      return;
    }

    // Final name conflict guard (handles debounce/race conditions)
    if (!selectedMomentId && newMomentName.trim()) {
      const exists = allMoments.some(m => m.label === newMomentName.trim());
      if (exists) {
        setError(t('moveToMoment.momentNameExists'));
        setIsLoading(false);
        return;
      }
    }

    setError('');

    try {
      // Convert Set to Array if needed
      const imageIds = Array.from(selectedImages);
      
      // If removeFromCurrent is checked and we have source moments, remove from all moments first
      if (removeFromCurrent && sourceMoments.length > 0) {
        await momentsAPI.removeImages(imageIds, eventUrl);
      }
      
      let targetMomentId = selectedMomentId;
      let targetMomentLabel = '';
      let isNewMoment = false;

      // If creating a new moment, create it first
      if (!selectedMomentId && newMomentName.trim()) {
        // Calculate start/end dates from selected images
        const entities = useDataStore.getState().entities;
        const imageDates = imageIds
          .map(imageId => entities?.[eventId]?.images?.[imageId]?.date_taken)
          .filter(Boolean)
          .map(date => new Date(date))
          .filter(date => !isNaN(date.getTime()));
        
        const newMomentData = {
          label: newMomentName.trim(),
        };
        
        // Set start and end based on min/max dates from images
        if (imageDates.length > 0) {
          const minDate = new Date(Math.min(...imageDates));
          const maxDate = new Date(Math.max(...imageDates));
          // Format as "YYYY-MM-DD HH:mm" to match backend format
          const formatDateForBackend = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day} ${hours}:${minutes}`;
          };
          newMomentData.start_date = formatDateForBackend(minDate);
          newMomentData.end_date = formatDateForBackend(maxDate);
        }
        
        const createResult = await momentsAPI.create(newMomentData, eventUrl);
        targetMomentId = createResult.moment_id; // API returns moment_id, not id
        targetMomentLabel = newMomentName.trim();
        isNewMoment = true;
      } else {
        // Get the label of the selected moment
        const selectedMoment = allMoments.find(m => m.id === selectedMomentId);
        targetMomentLabel = selectedMoment?.label || '';
      }

      // Add images to the target moment
      const result = await momentsAPI.addImages(targetMomentId, imageIds, eventUrl);
      
      // Store has already been updated by apiService interceptor
      const addedCount = result.len_added || imageIds.length;
      const imageText = addedCount === 1 ? 'image' : 'images';
      
      // Get the target moment from the freshly updated store
      const updatedMoments = storeSelectors.momentsAll(useDataStore.getState(), eventId);
      const targetMoment = updatedMoments.find(m => m.id === targetMomentId);
      
      if (targetMoment) {
        const link = `/${eventUrl}/timeline?moment=${encodeURIComponent(targetMoment.label)}`;
        showToast(
          <span>
            {addedCount} {imageText} moved to {isNewMoment && 'new moment '}<a 
              href={link} 
              className="underline hover:text-gray-100" 
              onClick={(e) => {
                // Allow default for modifier keys and middle/right click
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button === 1 || (e.detail && e.detail > 1)) {
                  return; // Let browser handle
                }
                e.preventDefault();
                e.stopPropagation();
                navigate(link, {
                  state: {
                    highlightImages: imageIds.slice(0, 10),
                    highlightMoment: targetMoment.label
                  }
                });
              }}
            >{targetMoment.label}</a>
          </span>,
          'success'
        );
      } else {
        // Fallback if moment not found in store (shouldn't happen)
        showToast(`${addedCount} ${imageText} moved to ${isNewMoment ? 'new moment' : 'moment'}`, 'success');
      }

      if (onMoveComplete) {
        onMoveComplete({ imageIds, targetMomentId, targetMomentLabel, moved: removeFromCurrent });
      }
      onClose();
    } catch (error) {
      const errorInfo = handleAPIError(error, 'Failed to move images');
      setError(errorInfo.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (window.momentNameConflictTimeout) {
        clearTimeout(window.momentNameConflictTimeout);
        window.momentNameConflictTimeout = null;
      }
    };
  }, []);

  const handleToggleSortOrder = () => {
    const newOrder = toggleSortOrder(sortOrder);
    setSortOrder(newOrder);
  };

  const formatTime = (dateString) => {
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
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4" style={{ zIndex: 100010, pointerEvents: 'auto' }}>
      <div ref={modalRef} className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col" tabIndex={-1} dir={isRTL ? 'rtl' : 'ltr'} style={{ pointerEvents: 'auto' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <Clock className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {t('moveToMoment.move')} {Array.from(selectedImages).length} {Array.from(selectedImages).length !== 1 ? t('moveToMoment.photos') : t('moveToMoment.photo')}
              </h2>
              <p className="text-xs text-gray-500">
                {t('moveToMoment.chooseDestination')}
              </p>
              {Array.from(selectedImages).length > 0 && (
                <div className="mt-1 text-xs text-gray-600">
                  {t('moveToMoment.from')}: {sourceMoments.length === 0
                    ? t('moveToMoment.notInAnyMoment')
                    : sourceMoments.length === 1
                    ? sourceMoments[0]?.label || t('moveToMoment.unknownMoment')
                    : `${sourceMoments.length} ${t('moveToMoment.moments')} (${sourceMoments.map(m => m.label || `${t('moveToMoment.moment')} ${m.id}`).join(', ')})`
                  }
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-4 py-4">
          {/* Loading state */}
          {isLoadingMoments && (
            <div className="text-center py-8">
              <div className="inline-flex items-center gap-2 text-gray-500">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                <span>{t('moveToMoment.loadingMoments')}</span>
              </div>
            </div>
          )}
          
          {/* Search and Sort Controls */}
          {!isLoadingMoments && (
            <>
            <div className={`mb-3 flex flex-col sm:flex-row gap-2 ${removeFromCurrent ? 'opacity-50 pointer-events-none' : ''}`}>
            {/* Search */}
            <div className="relative flex-1">
              <Search className={`absolute ${startClass('3')} top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400`} />
              <input
                type="text"
                dir={isRTL ? 'rtl' : 'ltr'}
                placeholder={t('moveToMoment.searchMoments')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                disabled={removeFromCurrent}
                className={`w-full ${ps('10')} ${pe('4')} py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
              />
            </div>
            
            {/* Sort Controls */}
            <div className="flex gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                disabled={removeFromCurrent}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="date">{t('moveToMoment.sortByDate')}</option>
                <option value="name">{t('moveToMoment.sortByName')}</option>
              </select>
              <LongPressHoverButton
                onClick={handleToggleSortOrder}
                disabled={removeFromCurrent}
                className="w-8 h-8 border border-transparent rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center disabled:opacity-50"
                title={sortOrder === 'asc' ? t('moveToMoment.sortAscending') : t('moveToMoment.sortDescending')}
                aria-label={sortOrder === 'asc' ? t('moveToMoment.sortAscending') : t('moveToMoment.sortDescending')}
              >
                {sortOrder === 'asc' ? (
                  <ArrowUp className="w-4 h-4" />
                ) : (
                  <ArrowDown className="w-4 h-4" />
                )}
              </LongPressHoverButton>
            </div>
          </div>

          {/* Moments Grid */}
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">{t('moveToMoment.selectExistingMoment')}</h3>
            <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-56 overflow-y-auto ${removeFromCurrent ? 'opacity-50 pointer-events-none' : ''}`}>
              {filteredAndSortedMoments.map((moment) => (
                <div
                  key={moment.id}
                  className={`p-2.5 border border-transparent rounded-lg cursor-pointer transition-colors ${
                    selectedMomentId === moment.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'hover:border-gray-300'
                  }`}
                  onClick={() => {
                    setSelectedMomentId(moment.id);
                    setNewMomentName(''); // Clear new moment name when selecting existing
                  }}
                >
                  <div className="flex flex-col items-center space-y-2">
                    {/* Representative image */}
                    <div className="w-full h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg overflow-hidden flex items-center justify-center">
                      {ImageComponent(
                        urlHelpers?.getRepresentativeUrl ? `${urlHelpers.getRepresentativeUrl('moments', moment.id)}?v=${moment.representative_image || 'none'}` : null,
                        {
                          width: 200,
                          height: 80,
                          className: 'object-cover w-full h-full',
                          alt: moment.label
                        }
                      )}
                    </div>
                    <div className="text-center w-full">
                      <p className="font-medium text-gray-900 text-sm truncate">
                        {moment.label || `Moment ${moment.id}`}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatTime(moment.start_date)} - {formatTime(moment.end_date)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {getImageCount(moment)} images
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              {filteredAndSortedMoments.length === 0 && (
                <div className="col-span-full text-center py-8 text-gray-500">
                  {searchTerm ? t('moveToMoment.noMomentsFound') : t('moveToMoment.noMomentsAvailable')}
                </div>
              )}
            </div>
          </div>

          {/* New Moment Creation */}
          <div className={`mb-4 ${removeFromCurrent ? 'opacity-50 pointer-events-none' : ''}`}>
            <h3 className="text-sm font-medium text-gray-700 mb-3">{t('moveToMoment.orCreateNewMoment')}</h3>
            <div className="relative mb-1">
              <input
                type="text"
                dir={isRTL ? 'rtl' : 'ltr'}
                value={newMomentName}
                onChange={handleNewMomentNameChange}
                placeholder={t('moveToMoment.enterNewMomentName')}
                disabled={removeFromCurrent}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  nameConflict ? 'border-red-500' : 'border-gray-300'
                }`}
              />
            </div>
            {nameConflict && (
              <div className="flex items-center gap-1 text-red-500 text-xs mb-1">
                <AlertTriangle className="w-3 h-3" />
                <span>{t('moveToMoment.nameAlreadyExists')}</span>
              </div>
            )}
            <p className="text-xs text-gray-500">{t('moveToMoment.datesAutoDetected')}</p>
          </div>

          {/* Remove from current moment option - show if any image has a moment */}
          {showRemoveOption && (
            <div className="mb-6 flex items-center justify-between rounded-lg bg-white px-4 py-3">
              <div>
                <p className="font-medium text-gray-900">
                  {t('moveToMoment.removeFromCurrent')} {hasMultipleMoments ? t('moveToMoment.moments') : t('moveToMoment.moment')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const newValue = !removeFromCurrent;
                  setRemoveFromCurrent(newValue);
                  // Clear selections when enabling remove mode
                  if (newValue) {
                    setSelectedMomentId('');
                    setNewMomentName('');
                  }
                }}
                className={`w-10 h-6 rounded-full relative transition-colors ${removeFromCurrent ? 'bg-blue-600' : 'bg-gray-300'} cursor-pointer`}
                aria-pressed={removeFromCurrent}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isRTL ? 'right-0.5' : 'left-0.5'} ${removeFromCurrent ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
              </button>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm">
              <AlertTriangle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}
            </>
          )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-gray-200 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium transition-colors"
            disabled={isLoading}
          >
            {t('moveToMoment.cancel')}
          </button>
          <button
            type="button"
            data-is-save-button="true"
            onClick={handleMove}
            disabled={isLoading || (!selectedMomentId && !newMomentName.trim() && !removeFromCurrent) || nameConflict}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>
                  {removeFromCurrent && (selectedMomentId || newMomentName.trim()) ? t('moveToMoment.moving') : 
                   removeFromCurrent ? t('moveToMoment.removing') : 
                   t('moveToMoment.adding')}
                </span>
              </>
            ) : (
              <>
                <Calendar className="w-4 h-4" />
                <span>
                  {removeFromCurrent && (selectedMomentId || newMomentName.trim()) ? t('moveToMoment.move') : 
                   removeFromCurrent ? t('moveToMoment.remove') : 
                   t('moveToMoment.move')}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}




