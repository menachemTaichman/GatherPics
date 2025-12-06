import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Trash2, X, Image, List, Save, RotateCcw, Plus, Clock, AlertTriangle, Minus } from 'lucide-react';
import { sortMoments } from '../../utils/sorting';
import { momentsAPI, handleAPIError, optimisticUpdates, API_BASE } from '../../utils/apiService';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useDataStore, selectors as storeSelectors } from '../../utils/dataManager';
import { useImageComponent, ImageComponent } from '../../hooks/useImage.jsx';
import { useApplyScopes, useEventId } from '../../utils/storeUtils';
import { useModalStore } from '../../utils/modalManager';
import { formatErrorMessage } from '../../utils/errorHandler';

import { EditMomentImagesModal } from './';
import { ConfirmDelete } from '../modals';
import { formatDateTimeLocale, formatDateDDMMYYYY, parseDatabaseTimestamp } from '../../utils/dateUtils';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';

function EditMomentsModal({ eventUrl, onSave, onDelete, momentImagesMap, onRefreshImages, onToast, onClose, urlHelpers: injectedUrlHelpers }) {
  const urlHelpers = injectedUrlHelpers;
  const eventId = useEventId(eventUrl);
  const { t } = useTranslation();
  const { isRTL, startClass, endClass } = useRTL();
  
  const MODAL_ID = 'edit-moments-modal';
  
  // Subscribe to all moments from store (including archived and empty ones)
  const storeMoments = useDataStore(state => storeSelectors.momentsAll(state, eventId));
  
  // Sort moments for display
  const sortedStoreMoments = useMemo(() => {
    return sortMoments(storeMoments, 'asc');
  }, [storeMoments]);

  const [internalMoments, setInternalMoments] = useState([]);
  const [editingMoments, setEditingMoments] = useState([]);
  const [editingTitle, setEditingTitle] = useState(null);
  const [changedMoments, setChangedMoments] = useState(new Set());
  const [editingImagesForMoment, setEditingImagesForMoment] = useState(null);
  const [tempMomentCounter, setTempMomentCounter] = useState(0);
  const [nameConflicts, setNameConflicts] = useState(new Map()); // moment_id -> boolean
  const [deletingMoment, setDeletingMoment] = useState(null); // { id, label } for confirm modal

  // Update local state when store moments change (e.g., representative_image updated)
  useEffect(() => {
    setEditingMoments(prev => {
      return prev.map(localMoment => {
        const momentId = localMoment.id || localMoment.moment_id;
        // Skip temporary moments
        if (String(momentId).startsWith('temp-')) return localMoment;
        
        // Find the moment in the store
        const storeMoment = storeMoments.find(m => m.id === momentId);
        if (!storeMoment) return localMoment;
        
        // If this moment has been changed locally, keep local changes but update other fields
        if (changedMoments.has(momentId)) {
          // Only update fields that aren't being edited
          return {
            ...storeMoment,
            ...localMoment, // Local changes override
            representative_image: storeMoment.representative_image, // Always use store's representative
          };
        }
        
        // Not changed locally, use store version
        return storeMoment;
      });
    });
    
    setInternalMoments(sortedStoreMoments);
  }, [storeMoments, sortedStoreMoments, changedMoments]);

  // Use modal focus hook with proper modal manager integration
  const { modalRef } = useModalFocus(true, onClose, {
    allowOutsideScroll: true,
    modalType: 'popup',
    modalId: MODAL_ID
  });

  // Register modal with modal manager and initialize editing state
  useEffect(() => {
    if (!eventId) return; // Wait for eventId
    
    const { registerModal, unregisterModal } = useModalStore.getState();
    try {
      registerModal({ 
        id: MODAL_ID, 
        type: 'popup', 
        scopes: [{ entity: 'all', id: 'moments', eventId }], 
        allowOutsideScroll: true 
      });
    } catch {}
    
    setInternalMoments(sortedStoreMoments);
    setEditingMoments(sortedStoreMoments);
    setChangedMoments(new Set());
    
    // Listen for logout to auto-close modal
    const handleAuthLogout = () => {
      if (onClose) {
        onClose();
      }
    };
    window.addEventListener('auth:logout', handleAuthLogout);
    
      return () => {
      try { unregisterModal(MODAL_ID); } catch {}
      window.removeEventListener('auth:logout', handleAuthLogout);
      
      // Clear any pending name check timeouts
      if (updateMoment._timeouts) {
        Object.values(updateMoment._timeouts).forEach(timeout => clearTimeout(timeout));
        updateMoment._timeouts = {};
      }
    };
  }, [eventId]);

  const handleClose = () => {
    // Store current scroll position before closing
    const currentScroll = window.scrollY;
    
    if (onClose) {
      onClose();
    }
    
    // Restore scroll position after a short delay to prevent jumps
    requestAnimationFrame(() => {
      if (Math.abs(window.scrollY - currentScroll) > 5) {
        window.scrollTo({ top: currentScroll, behavior: 'instant' });
      }
    });
  };

  const handleDiscard = () => {
    // Reset all changes and remove temporary moments
    const sortedMoments = sortMoments(internalMoments, 'asc');
    setEditingMoments(sortedMoments);
    setChangedMoments(new Set());
    setNameConflicts(new Map());
  };

  const handleSave = async () => {
    // Check if any moments have name conflicts
    const hasConflicts = Array.from(changedMoments).some(momentId => nameConflicts.get(momentId));
    if (hasConflicts) {
      onToast(t('moments.cannotSaveDuplicateNames'), 'error');
      return;
    }
    
    // Only save moments that have been changed and are not temporary
      const momentsToSave = editingMoments.filter(m => 
      changedMoments.has(m.id || m.moment_id) && !(String(m.id || m.moment_id).startsWith('temp-'))
    );
    
    // Check if any moment was just created or updated with time range
      const momentsWithTimeRange = editingMoments.filter(m => 
      m.start_date && m.end_date && 
      ((String(m.id || m.moment_id).startsWith('temp-')) || m.images === undefined)
    );
    
      if (momentsWithTimeRange.length > 0) {
      // Save the non-temporary moments first
      if (momentsToSave.length > 0) {
        for (const moment of momentsToSave) {
          // Filter out image-related fields before calling onSave
          const { id, moment_id, image_ids, images, ...momentData } = moment;
          const normalizedData = normalizeMomentForSave(momentData);
          await onSave({ ...normalizedData, moment_id: id || moment_id });
        }
      }
      
      // Then auto-open edit images for the first moment with time range
      const momentToEdit = momentsWithTimeRange[0];
      await handleEditImages(momentToEdit);
      
      // Don't close the modal yet, let the user edit images
      return;
    }
    
    // Save all non-temporary changed moments
    if (momentsToSave.length > 0) {
      for (const moment of momentsToSave) {
        // Filter out image-related fields before calling onSave
        const { id, moment_id, images, image_ids, ...momentData } = moment;
        const normalizedData = normalizeMomentForSave(momentData);
        await onSave({ ...normalizedData, moment_id: id || moment_id });
      }
    }
    
    handleClose();
  };

  const handleSaveMoment = async (moment) => {
    try {
      const momentId = moment.id || moment.moment_id;
      
      // Check for name conflict before saving
      if (nameConflicts.get(momentId)) {
        onToast(t('moments.cannotSaveNameExists'), 'error');
        return;
      }
      
      let savedMoment;
      if (String(moment.id || moment.moment_id).startsWith('temp-')) {
        const { id, moment_id, image_ids, images, ...momentData } = moment;
        const normalizedData = normalizeMomentForSave(momentData);
        const result = await momentsAPI.create(normalizedData, eventUrl);
        
        // Changes are automatically applied by apiService interceptor
        const createdMomentId = result.moment_id;
        
        // Wait for store to update - poll up to 5 times with increasing delays
        let attempts = 0;
        while (attempts < 5) {
          await new Promise(resolve => setTimeout(resolve, 50 * (attempts + 1)));
          const store = useDataStore.getState();
          savedMoment = store.entities?.[eventId]?.moments?.[createdMomentId];
          if (savedMoment) break;
          attempts++;
        }
        
        // If still not found, try to get it from the response changes
        if (!savedMoment && result.changes) {
          const momentChange = result.changes.find(ch => ch.entity === 'moment' && ch.items && ch.items[createdMomentId]);
          if (momentChange && momentChange.items[createdMomentId]) {
            savedMoment = { id: createdMomentId, ...momentChange.items[createdMomentId] };
          }
        }
        
        if (savedMoment) {
          // Replace the temporary moment with the saved one
          setEditingMoments(prev => prev.map(m => 
            (m.id || m.moment_id) === (moment.id || moment.moment_id) ? savedMoment : m
          ));
          
          // Update internal moments snapshot
          setInternalMoments(prev => prev.map(m =>
            (m.id || m.moment_id) === (moment.id || moment.moment_id) ? savedMoment : m
          ));
          
          // Navigate to the newly created moment within the modal
          setTimeout(() => {
            if (!scrollContainerRef.current) return;
            const momentElement = scrollContainerRef.current.querySelector(`[data-moment-moment_id="${savedMoment.id}"]`);
            if (momentElement) {
              const containerRect = scrollContainerRef.current.getBoundingClientRect();
              const elementRect = momentElement.getBoundingClientRect();
              const scrollOffset = elementRect.top - containerRect.top - (containerRect.height / 2) + (elementRect.height / 2);
              scrollContainerRef.current.scrollBy({ top: scrollOffset, behavior: 'smooth' });
            }
          }, 100);
        } else {
          // If moment still not found, log error but don't fail - the store should update eventually
          console.warn('Created moment not found in store after creation:', createdMomentId);
        }
      } else {
        const { id, moment_id, image_ids, images, ...momentData } = moment;
        const normalizedData = normalizeMomentForSave(momentData);
        await momentsAPI.update(id || moment_id, normalizedData, eventUrl);
        
        // Changes are automatically applied by apiService interceptor
        await new Promise(resolve => setTimeout(resolve, 50));
        
        const store = useDataStore.getState();
        savedMoment = store.entities?.[eventId]?.moments?.[id || moment_id];
        
        if (savedMoment) {
          // Update with saved data from store
          setEditingMoments(prev => prev.map(m => 
            (m.id || m.moment_id) === (moment.id || moment.moment_id) ? savedMoment : m
          ));
          
          // Update internal moments snapshot
          setInternalMoments(prev => prev.map(m =>
            (m.id || m.moment_id) === (moment.id || moment.moment_id) ? savedMoment : m
          ));
        }
      }
      
      // Remove from changed moments since it's now saved
      setChangedMoments(prev => {
        const next = new Set(prev);
        next.delete(moment.id || moment.moment_id);
        return next;
      });
      
      // Clear name conflict for this moment
      setNameConflicts(prev => {
        const next = new Map(prev);
        next.delete(moment.id || moment.moment_id);
        return next;
      });
      
      if (onToast) {
        if (String(moment.id || moment.moment_id).startsWith('temp-')) {
          onToast(t('moments.momentCreated'), 'success');
        } else {
          onToast(t('moments.momentUpdated'), 'success');
        }
      }
      
      return savedMoment;
    } catch (error) {
      console.error('Error saving moment:', error);
      if (onToast) {
        onToast(formatErrorMessage('save moment', error), 'error');
      }
      throw error;
    }
  };

  const handleDeleteConfirm = async (moment_id) => {
    try {
      // Call the parent's onDelete function
      if (onDelete) {
        await onDelete(moment_id);
      }
      
      // Remove the moment from editingMoments
      setEditingMoments(prev => prev.filter(m => (m.id || m.moment_id) !== moment_id));
      
      // Remove from changedMoments if it was there
      setChangedMoments(prev => {
        const next = new Set(prev);
        next.delete(moment_id);
        return next;
      });
      
      // Clear name conflict for this moment
      setNameConflicts(prev => {
        const next = new Map(prev);
        next.delete(moment_id);
        return next;
      });
      
      // Show success message
      if (onToast) {
        onToast(t('moments.momentDeleted'), 'success');
      }
    } catch (error) {
      console.error('Error deleting moment:', error);
      if (onToast) {
        onToast(formatErrorMessage('delete moment', error), 'error');
      }
    }
  };

  const checkNameConflict = async (label, momentId) => {
    if (!label || !label.trim()) {
      setNameConflicts(prev => {
        const next = new Map(prev);
        next.delete(momentId);
        return next;
      });
      return;
    }

    try {
      // Exclude current moment from conflict check (for editing existing moments)
      const excludeId = String(momentId).startsWith('temp-') ? '' : momentId;
      const result = await momentsAPI.checkName(label.trim(), excludeId, eventUrl);
      setNameConflicts(prev => {
        const next = new Map(prev);
        next.set(momentId, result.conflict || false);
        return next;
      });
    } catch (error) {
      console.error('Error checking name conflict:', error);
      setNameConflicts(prev => {
        const next = new Map(prev);
        next.delete(momentId);
        return next;
      });
    }
  };

  // Convert datetime-local format (YYYY-MM-DDTHH:mm) to backend format (YYYY-MM-DD HH:mm)
  const convertToBackendFormat = (value) => {
    if (!value) return null;
    // If already in backend format (has space instead of T), return as is
    if (value.includes(' ')) return value;
    // Convert from datetime-local format (YYYY-MM-DDTHH:mm) to backend format (YYYY-MM-DD HH:mm)
    return value.replace('T', ' ');
  };

  // Convert backend format (YYYY-MM-DD HH:mm or GMT format) to datetime-local format (YYYY-MM-DDTHH:mm)
  const convertToInputFormat = (value) => {
    if (!value) return '';
    // If already in datetime-local format (has T), return as is
    if (value.includes('T') && !value.includes('GMT')) {
      return value.slice(0, 16);
    }
    
    // Parse GMT format or other backend formats using parseDatabaseTimestamp
    const date = parseDatabaseTimestamp(value);
    if (date && !Number.isNaN(date.getTime())) {
      // Convert to datetime-local format: YYYY-MM-DDTHH:mm
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    }
    
    // Fallback: try to convert from backend format (YYYY-MM-DD HH:mm) to datetime-local format
    if (value.includes(' ')) {
      return value.replace(' ', 'T').slice(0, 16);
    }
    
    return '';
  };

  // Format date for display in dd/mm/yyyy HH:mm format
  const formatDateForDisplay = (value) => {
    if (!value) return '';
    const date = parseDatabaseTimestamp(value);
    if (!date || Number.isNaN(date.getTime())) return value;
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  };

  const updateMoment = (moment_id, updates) => {
    // Convert datetime-local format to backend format for date fields
    const normalizedUpdates = { ...updates };
    if (normalizedUpdates.start_date !== undefined) {
      normalizedUpdates.start_date = convertToBackendFormat(normalizedUpdates.start_date);
    }
    if (normalizedUpdates.end_date !== undefined) {
      normalizedUpdates.end_date = convertToBackendFormat(normalizedUpdates.end_date);
    }
    
    setEditingMoments(prev => prev.map(m => {
      if ((m.id || m.moment_id) === moment_id) {
        const updated = { ...m, ...normalizedUpdates, id: m.id || m.moment_id };
        // Remove any start/end fields if they exist (should only have start_date/end_date)
        delete updated.start;
        delete updated.end;
        return updated;
      }
      return m;
    }));
    
    // Mark this moment as changed
    setChangedMoments(prev => new Set([...prev, moment_id]));
    
    // Check for name conflicts if label is being updated
    if (updates.label !== undefined) {
      // Debounce the name check
      if (updateMoment._timeouts) {
        clearTimeout(updateMoment._timeouts[moment_id]);
      } else {
        updateMoment._timeouts = {};
      }
      
      updateMoment._timeouts[moment_id] = setTimeout(() => {
        checkNameConflict(updates.label, moment_id);
      }, 300);
    }
  };

  // Normalize moment data before saving - convert start/end to start_date/end_date and format dates
  const normalizeMomentForSave = (moment) => {
    const normalized = { ...moment };
    
    // Convert start/end to start_date/end_date if they exist
    if (normalized.start !== undefined) {
      normalized.start_date = convertToBackendFormat(normalized.start);
      delete normalized.start;
    }
    if (normalized.end !== undefined) {
      normalized.end_date = convertToBackendFormat(normalized.end);
      delete normalized.end;
    }
    
    // Ensure start_date and end_date are in backend format
    if (normalized.start_date) {
      normalized.start_date = convertToBackendFormat(normalized.start_date);
    }
    if (normalized.end_date) {
      normalized.end_date = convertToBackendFormat(normalized.end_date);
    }
    
    return normalized;
  };

  const handleEditImages = (moment) => {
    setEditingImagesForMoment(moment);
  };

  const addMoment = () => {
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 3600 * 1000);
    
    const newMoment = {
      moment_id: `temp-${Date.now()}-${tempMomentCounter}`,
      label: t('moments.newMoment'),
      start_date: now.toISOString().slice(0, 16).replace('T', ' '),
      end_date: oneHourLater.toISOString().slice(0, 16).replace('T', ' '),
      description: ''
    };
    
    // Add to editing moments list (don't save to backend yet)
    setEditingMoments(prev => [...prev, newMoment]);
    setChangedMoments(prev => new Set([...prev, newMoment.moment_id]));
    setTempMomentCounter(prev => prev + 1); // Increment counter for next temporary moment
    
    // Jump to the newly added moment by scrolling within the modal
    setTimeout(() => {
      if (!scrollContainerRef.current) return;
      const momentElement = scrollContainerRef.current.querySelector(`[data-moment-moment_id="${newMoment.moment_id}"]`);
      if (momentElement) {
        const containerRect = scrollContainerRef.current.getBoundingClientRect();
        const elementRect = momentElement.getBoundingClientRect();
        const scrollOffset = elementRect.top - containerRect.top - (containerRect.height / 2) + (elementRect.height / 2);
        scrollContainerRef.current.scrollBy({ top: scrollOffset, behavior: 'smooth' });
      }
    }, 100);
  };

  const handleTitleEdit = (moment_id, newTitle) => {
    updateMoment(moment_id, { label: newTitle });
    setEditingTitle(null);
  };

  const startTitleEdit = (moment_id, currentTitle) => {
    setEditingTitle({ moment_id: moment_id, title: currentTitle });
  };

  // Ref for scroll container
  const scrollContainerRef = useRef(null);

  // Prevent scroll propagation to background when scrolling within modal
  const handleWheel = useCallback((e) => {
    const target = scrollContainerRef.current;
    if (!target) return;
    
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const height = target.clientHeight;
    const delta = e.deltaY;
    
    const isAtTop = scrollTop === 0;
    const isAtBottom = scrollTop + height >= scrollHeight - 1;
    
    if ((isAtTop && delta < 0) || (isAtBottom && delta > 0)) {
      // At boundary, prevent propagation to background
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  // Attach wheel event listener with passive: false
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheel);
      }
    };
  }, [handleWheel]);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <motion.div 
          ref={modalRef}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-white rounded-lg shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-hidden flex flex-col"
          tabIndex={-1}
          dir={isRTL ? 'rtl' : 'ltr'}
        >
        <div className="p-6 border-b">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold">{t('moments.editMoments')}</h3>
            <div className="flex gap-2">
              <button 
                onClick={addMoment} 
                className="w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center hover:bg-primary-100 text-primary-700"
                title={t('moments.addMoment')}
                aria-label={t('moments.addMoment')}
              >
                <Plus className="w-4 h-4" />
              </button>
              <button 
                onClick={handleClose} 
                className="w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700"
                title={t('moments.close')}
                aria-label={t('moments.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
        
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-6">
          <div className="space-y-3">
      {editingMoments.filter(m => m && (m.id || m.moment_id)).map((moment, index) => (
              <div key={moment.id || moment.moment_id} data-moment-moment_id={moment.id || moment.moment_id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3 flex-1">
                    {/* Representative image */}
                    <div className="relative">
                      <div className="w-16 h-16 rounded-lg overflow-hidden border">
                        {ImageComponent(
                          !String(moment.id || moment.moment_id).startsWith('temp-') && urlHelpers?.getRepresentativeUrl 
                            ? `${urlHelpers.getRepresentativeUrl('moments', moment.id || moment.moment_id)}?v=${moment.representative_image || 'none'}` 
                            : null,
                          {
                            width: 64,
                            height: 64,
                            className: 'w-full h-full object-cover',
                            alt: ''
                          }
                        )}
                      </div>
                      {moment.representative_image && !String(moment.id || moment.moment_id).startsWith('temp-') && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await momentsAPI.update(moment.id || moment.moment_id, { representative_image: null }, eventUrl);
                              if (onToast) {
                                onToast(t('moments.representativeRemoved'), 'success');
                              }
                            } catch (error) {
                              if (onToast) {
                                onToast(formatErrorMessage('remove representative', error), 'error');
                              }
                            }
                          }}
                          className={`absolute -bottom-1 ${endClass('1')} w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-md transition-colors`}
                          title={t('moments.representativeRemoved')}
                          aria-label={t('moments.representativeRemoved')}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Inline Editable Title */}
                    <div className="flex-1">
                      {editingTitle?.moment_id === (moment.id || moment.moment_id) ? (
                        <div className="relative">
                          <input
                            type="text"
                            moment_id={`edit-moment-title-${moment.id || moment.moment_id}`}
                            name={`edit-moment-title-${moment.id || moment.moment_id}`}
                            value={editingTitle.title}
                            onChange={(e) => setEditingTitle({ ...editingTitle, title: e.target.value })}
                            onBlur={() => handleTitleEdit(moment.id || moment.moment_id, editingTitle.title)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleTitleEdit(moment.id || moment.moment_id, editingTitle.title);
                              } else if (e.key === 'Escape') {
                                setEditingTitle(null);
                              }
                            }}
                            className={`text-lg font-semibold border-b hover:border-gray-300 focus:outline-none px-1 py-1 w-full ${
                              nameConflicts.get(moment.id || moment.moment_id) 
                                ? 'border-red-500 focus:border-red-500' 
                                : 'border-transparent focus:border-primary-500'
                            }`}
                            autoFocus
                            dir={isRTL ? 'rtl' : 'ltr'}
                          />
                          {nameConflicts.get(moment.id || moment.moment_id) && (
                            <div className={`absolute top-full ${startClass('0')} mt-1 flex items-center gap-1 text-red-500 text-xs`}>
                              <AlertTriangle className="w-3 h-3" />
                              <span>{t('moments.nameAlreadyExists')}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div
                            onClick={() => startTitleEdit(moment.id || moment.moment_id, moment.label)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                startTitleEdit(moment.moment_id, moment.label);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                            className="text-lg font-semibold cursor-pointer hover:bg-gray-50 px-1 py-1 rounded transition-colors"
                          >
                            {moment.label || `${t('moments.newMoment')} ${index + 1}`}
                          </div>
                          {nameConflicts.get(moment.id || moment.moment_id) && (
                            <AlertTriangle className="w-4 h-4 text-red-500" title={t('moments.nameAlreadyExists')} />
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2">
                    {changedMoments.has(moment.id || moment.moment_id) && (
                      <>
                        <button 
                          onClick={() => handleSaveMoment(moment)}
                          disabled={nameConflicts.get(moment.id || moment.moment_id)}
                          className="w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center hover:bg-green-100 text-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={nameConflicts.get(moment.id || moment.moment_id) ? t('moments.cannotSaveNameExists') : t('moments.saveMoment')}
                          aria-label={nameConflicts.get(moment.id || moment.moment_id) ? t('moments.cannotSaveNameExists') : t('moments.saveMoment')}
                        >
                          <Save className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => {
                            const momentId = moment.id || moment.moment_id;
                            if (String(momentId).startsWith('temp-')) {
                              // Remove temporary moment completely
                              setEditingMoments(prev => prev.filter(m => (m.id || m.moment_id) !== momentId));
                              setChangedMoments(prev => {
                                const next = new Set(prev);
                                next.delete(momentId);
                                return next;
                              });
                              setNameConflicts(prev => {
                                const next = new Map(prev);
                                next.delete(momentId);
                                return next;
                              });
                            } else {
                              // Reset to original for existing moment
                              const originalMoment = internalMoments.find(m => (m.id || m.moment_id) === momentId);
                              if (originalMoment) {
                                setEditingMoments(prev => prev.map(m => 
                                  (m.id || m.moment_id) === momentId ? originalMoment : m
                                ));
                                setChangedMoments(prev => {
                                  const next = new Set(prev);
                                  next.delete(momentId);
                                  return next;
                                });
                                setNameConflicts(prev => {
                                  const next = new Map(prev);
                                  next.delete(momentId);
                                  return next;
                                });
                              }
                            }
                          }}
                          className="w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center hover:bg-red-100 text-red-700"
                          title={t('moments.discardChanges')}
                          aria-label={t('moments.discardChanges')}
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setEditingImagesForMoment(moment)}
                      className="w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center hover:bg-primary-100 text-primary-700"
                      title={t('moments.editPhotos')}
                      aria-label={t('moments.editPhotos')}
                    >
                      <Image className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => setDeletingMoment({ 
                        id: moment.id || moment.moment_id, 
                        label: moment.label,
                        representative_image: moment.representative_image
                      })}
                      className="w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center hover:bg-red-100 text-red-700"
                      title={t('moments.deleteMoment')}
                      aria-label={t('moments.deleteMoment')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                {/* Compact Details Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('moments.description')}</label>
                    <textarea
                      moment_id={`moment-description-${moment.id || moment.moment_id}`}
                      name={`moment-description-${moment.id || moment.moment_id}`}
                      value={moment.description}
                      onChange={(e) => updateMoment(moment.id || moment.moment_id, { description: e.target.value })}
                      className="w-full border rounded px-2 py-1 text-sm resize-none"
                      rows="2"
                      placeholder={t('moments.addDescription')}
                      dir={isRTL ? 'rtl' : 'ltr'}
                    />
                  </div>
                  
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">{t('moments.startTime')}</label>
                      <input
                        type="datetime-local"
                        moment_id={`moment-start-${moment.id || moment.moment_id}`}
                        name={`moment-start-${moment.id || moment.moment_id}`}
                        value={convertToInputFormat(moment.start_date || moment.start)}
                        onChange={(e) => updateMoment(moment.id || moment.moment_id, { start_date: e.target.value })}
                        className="w-full border rounded px-2 py-1 text-sm"
                        dir="ltr"
                      />
                    </div>
                    
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">{t('moments.endTime')}</label>
                      <input
                        type="datetime-local"
                        moment_id={`moment-end-${moment.id || moment.moment_id}`}
                        name={`moment-end-${moment.id || moment.moment_id}`}
                        value={convertToInputFormat(moment.end_date || moment.end)}
                        onChange={(e) => updateMoment(moment.id || moment.moment_id, { end_date: e.target.value })}
                        className="w-full border rounded px-2 py-1 text-sm"
                        dir="ltr"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Edit Images Modal - Render as child modal */}
      {editingImagesForMoment && (
        <EditMomentImagesModal
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
          moment={editingImagesForMoment}
          momentImagesMap={momentImagesMap}
          onRefreshImages={onRefreshImages}
          onSave={onSave}
          moments={internalMoments}
          onToast={onToast}
          onClose={() => setEditingImagesForMoment(null)}
        />
      )}

      {/* Confirm Delete Modal */}
      {deletingMoment && (
        <ConfirmDelete
          isOpen={!!deletingMoment}
          onClose={() => setDeletingMoment(null)}
          onConfirm={() => handleDeleteConfirm(deletingMoment.id)}
          title={t('moments.deleteMoment')}
          message={t('moments.areYouSureDelete')}
          itemName={deletingMoment.label || t('moments.thisMoment')}
          confirmText={t('moments.delete')}
          cancelText={t('moments.cancel')}
          imageUrl={
            !String(deletingMoment.id).startsWith('temp-') && deletingMoment.representative_image && urlHelpers?.getRepresentativeUrl
              ? `${urlHelpers.getRepresentativeUrl('moments', deletingMoment.id)}?v=${deletingMoment.representative_image}`
              : null
          }
          imageAlt={deletingMoment.label || t('moments.newMoment')}
          caption={t('moments.noteImagesNotDeleted')}
        />
      )}
    </div>
    </AnimatePresence>
  );
}

export default EditMomentsModal;


