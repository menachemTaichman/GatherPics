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
import { LongPressHoverButton } from '../common';

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
  // Preserve editingTitle state if a moment is being edited
  useEffect(() => {
    // Don't update if we're currently editing a title - preserve editing state
    if (editingTitle) {
      return;
    }
    
    setEditingMoments(prev => {
      const updated = prev.map(localMoment => {
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
      
      // Re-sort after updating (only if no moments are being edited)
      // If there are changed moments, we'll sort after they're saved
      if (changedMoments.size === 0) {
        return sortMoments(updated, 'asc');
      }
      
      return updated;
    });
    
    setInternalMoments(sortedStoreMoments);
  }, [storeMoments, sortedStoreMoments, changedMoments, editingTitle]);

  // Re-sort editingMoments when all changes are saved (changedMoments becomes empty)
  // This ensures moments are sorted after all individual saves complete
  const prevChangedMomentsSizeRef = useRef(changedMoments.size);
  useEffect(() => {
    const prevSize = prevChangedMomentsSizeRef.current;
    const currentSize = changedMoments.size;
    prevChangedMomentsSizeRef.current = currentSize;
    
    // If changedMoments went from non-empty to empty, re-sort
    if (prevSize > 0 && currentSize === 0 && editingMoments.length > 0) {
      const sorted = sortMoments(editingMoments, 'asc');
      // Only update if order actually changed
      const orderChanged = sorted.some((m, i) => {
        const current = editingMoments[i];
        return !current || (m.id || m.moment_id) !== (current.id || current.moment_id);
      });
      
      if (orderChanged) {
        setEditingMoments(sorted);
      }
    }
  }, [changedMoments.size, editingMoments]);

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
          // Replace the temporary moment with the saved one and re-sort
          setEditingMoments(prev => {
            const updated = prev.map(m => 
              (m.id || m.moment_id) === (moment.id || moment.moment_id) ? savedMoment : m
            );
            return sortMoments(updated, 'asc');
          });
          
          // Update internal moments snapshot
          setInternalMoments(prev => {
            const updated = prev.map(m =>
              (m.id || m.moment_id) === (moment.id || moment.moment_id) ? savedMoment : m
            );
            return sortMoments(updated, 'asc');
          });
          
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
          // Update with saved data from store and re-sort
          setEditingMoments(prev => {
            const updated = prev.map(m => 
              (m.id || m.moment_id) === (moment.id || moment.moment_id) ? savedMoment : m
            );
            return sortMoments(updated, 'asc');
          });
          
          // Update internal moments snapshot
          setInternalMoments(prev => {
            const updated = prev.map(m =>
              (m.id || m.moment_id) === (moment.id || moment.moment_id) ? savedMoment : m
            );
            return sortMoments(updated, 'asc');
          });
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
  // Also handles GMT format and other date formats from the store
  const convertToBackendFormat = (value) => {
    if (!value) return null;
    
    // Convert to string if needed
    const strValue = String(value).trim();
    if (!strValue) return null;
    
    // If already in backend format (YYYY-MM-DD HH:mm or YYYY-MM-DD HH:mm:ss), validate and return
    if (strValue.includes(' ') && !strValue.includes('T') && !strValue.includes('GMT')) {
      const backendMatch = strValue.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::\d{2})?/);
      if (backendMatch) {
        return `${backendMatch[1]} ${backendMatch[2]}`;
      }
    }
    
    // Convert from datetime-local format (YYYY-MM-DDTHH:mm) to backend format (YYYY-MM-DD HH:mm)
    if (strValue.includes('T') && !strValue.includes('GMT')) {
      const dtMatch = strValue.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
      if (dtMatch) {
        return `${dtMatch[1]} ${dtMatch[2]}`;
      }
      // Fallback: simple replace
      return strValue.replace('T', ' ').slice(0, 16);
    }
    
    // Handle GMT format or other formats using parseDatabaseTimestamp
    // This handles formats like "Sun, 08 Jun 2025 18:36:43 GMT" or "Sun, 08 Jun 2025"
    const date = parseDatabaseTimestamp(strValue);
    if (date && !Number.isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    }
    
    // If we can't parse it, return null (will be removed from the save payload)
    console.warn('Could not convert date to backend format:', strValue);
    return null;
  };

  // Convert backend format (YYYY-MM-DD HH:mm or GMT format) to datetime-local format (YYYY-MM-DDTHH:mm)
  const convertToInputFormat = (value) => {
    if (!value) return '';
    
    // If already in datetime-local format (has T and no GMT), return as is (truncate to HH:mm)
    if (value.includes('T') && !value.includes('GMT')) {
      // Extract just YYYY-MM-DDTHH:mm (datetime-local format)
      const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
      return match ? match[1] : value.slice(0, 16);
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
      // Match YYYY-MM-DD HH:mm or YYYY-MM-DD HH:mm:ss
      const match = value.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
      if (match) {
        return `${match[1]}T${match[2]}`;
      }
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
    // Keep date values in datetime-local format during editing (don't convert to backend format yet)
    // Only convert to backend format when saving
    const normalizedUpdates = { ...updates };
    
    // Store the raw datetime-local values as-is for editing
    // We'll convert to backend format only when saving
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
  // Normalize all date fields, omit if normalization fails
  const normalizeMomentForSave = (moment) => {
    const normalized = { ...moment };
    
    // Convert start/end to start_date/end_date if they exist
    if (normalized.start !== undefined) {
      const converted = convertToBackendFormat(normalized.start);
      if (converted) {
        normalized.start_date = converted;
      }
      delete normalized.start;
    }
    if (normalized.end !== undefined) {
      const converted = convertToBackendFormat(normalized.end);
      if (converted) {
        normalized.end_date = converted;
      }
      delete normalized.end;
    }
    
    // Normalize all start_date and end_date fields
    if (normalized.start_date !== undefined) {
      const converted = convertToBackendFormat(normalized.start_date);
      if (converted) {
        normalized.start_date = converted;
      } else {
        // Omit if normalization fails
        delete normalized.start_date;
      }
    }
    if (normalized.end_date !== undefined) {
      const converted = convertToBackendFormat(normalized.end_date);
      if (converted) {
        normalized.end_date = converted;
      } else {
        // Omit if normalization fails
        delete normalized.end_date;
      }
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
    // Normalize moment_id to string for consistent comparison
    const normalizedId = String(moment_id);
    setEditingTitle({ moment_id: normalizedId, title: currentTitle || '' });
  };

  // Ref for scroll container (used for programmatic scrolling)
  const scrollContainerRef = useRef(null);

  // Refs to store latest state values for keyboard handler
  const editingMomentsRef = useRef(editingMoments);
  const changedMomentsRef = useRef(changedMoments);
  const internalMomentsRef = useRef(internalMoments);
  const editingTitleRef = useRef(editingTitle);
  
  // Update refs when state changes
  useEffect(() => {
    editingMomentsRef.current = editingMoments;
  }, [editingMoments]);
  
  useEffect(() => {
    changedMomentsRef.current = changedMoments;
  }, [changedMoments]);
  
  useEffect(() => {
    internalMomentsRef.current = internalMoments;
  }, [internalMoments]);
  
  useEffect(() => {
    editingTitleRef.current = editingTitle;
  }, [editingTitle]);

  // Handle keyboard shortcuts: Enter to save, Escape to discard (for the moment being edited)
  useEffect(() => {
    const handleKeyDown = (e) => {
      const activeElement = document.activeElement;
      
      // Get latest values from refs
      const editingTitle = editingTitleRef.current;
      const editingMoments = editingMomentsRef.current;
      const changedMoments = changedMomentsRef.current;
      const internalMoments = internalMomentsRef.current;
      
      // Check if we're in the title input - handle it specially
      const isTitleInput = activeElement?.getAttribute('name')?.startsWith('edit-moment-title-') ||
                           activeElement?.getAttribute('moment_id')?.startsWith('edit-moment-title-');
      if (isTitleInput && editingTitle) {
        const momentIdMatch = activeElement?.getAttribute('name')?.match(/edit-moment-title-(.+)/) ||
                             activeElement?.getAttribute('moment_id')?.match(/edit-moment-title-(.+)/);
        if (momentIdMatch && momentIdMatch[1]) {
          const momentId = momentIdMatch[1];
          const focusedMoment = editingMoments.find(m => String(m.id || m.moment_id) === momentId);
          
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            // Update the title in local state and mark as changed
            updateMoment(momentId, { label: editingTitle.title });
            // Clear editing state
            setEditingTitle(null);
            // Get the updated moment (with the new label) and save it
            // We need to construct it from the current focusedMoment with the new label
            const updatedMoment = focusedMoment ? { ...focusedMoment, label: editingTitle.title } : null;
            if (updatedMoment) {
              // Use setTimeout to ensure state has updated
              setTimeout(() => {
                handleSaveMoment(updatedMoment);
              }, 0);
            }
            return;
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            // Reset to original label
            const originalMoment = internalMoments.find(m => String(m.id || m.moment_id) === momentId);
            if (originalMoment && originalMoment.label !== editingTitle.title) {
              setEditingMoments(prev => prev.map(m => 
                String(m.id || m.moment_id) === momentId 
                  ? { ...m, label: originalMoment.label }
                  : m
              ));
              setChangedMoments(prev => {
                const next = new Set(prev);
                next.delete(momentId);
                return next;
              });
            }
            setEditingTitle(null);
            return;
          }
        }
        // For other keys in title input, let it handle normally
        return;
      }
      
      // Find which moment the focused element belongs to
      let focusedMoment = null;
      if (activeElement) {
        const momentIdMatch = activeElement.getAttribute('moment_id') || activeElement.getAttribute('name') || '';
        const momentIdMatchResult = momentIdMatch.match(/moment-(?:start|end|description)-(.+)/);
        if (momentIdMatchResult) {
          const momentId = momentIdMatchResult[1];
          focusedMoment = editingMoments.find(m => (m.id || m.moment_id) === momentId);
        }
      }
      
      // If no focused moment, try to find first moment with changes
      if (!focusedMoment && changedMoments.size > 0) {
        const firstChangedId = Array.from(changedMoments)[0];
        focusedMoment = editingMoments.find(m => (m.id || m.moment_id) === firstChangedId);
      }
      
      if (e.key === 'Enter' && focusedMoment && changedMoments.has(focusedMoment.id || focusedMoment.moment_id)) {
        // Enter: Save the moment
        // In textarea, allow normal Enter for new lines, but Ctrl/Cmd+Enter saves
        if (activeElement?.tagName === 'TEXTAREA') {
          if (e.ctrlKey || e.metaKey) {
            // Ctrl+Enter or Cmd+Enter: Save
            e.preventDefault();
            e.stopPropagation();
            handleSaveMoment(focusedMoment);
          }
          // Otherwise, let Enter create a new line in textarea
        } else {
          // Not in textarea: Enter saves
          e.preventDefault();
          e.stopPropagation();
          handleSaveMoment(focusedMoment);
        }
      } else if (e.key === 'Escape' && focusedMoment && changedMoments.has(focusedMoment.id || focusedMoment.moment_id)) {
        // Escape: Discard changes for the moment (don't close modal)
        e.preventDefault();
        e.stopPropagation();
        const momentId = focusedMoment.id || focusedMoment.moment_id;
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
      }
    };
    
    // Attach to document to catch keyboard events regardless of focus
    document.addEventListener('keydown', handleKeyDown, true); // Use capture phase
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []); // Empty deps - only attach once, use refs for state

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <motion.div 
          ref={modalRef}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-white rounded-lg shadow-xl w-full max-w-3xl mx-2 sm:mx-4 max-h-[90vh] overflow-hidden flex flex-col"
          tabIndex={-1}
          dir={isRTL ? 'rtl' : 'ltr'}
        >
        <div className="p-4 sm:p-6 border-b">
          <div className="flex justify-between items-center gap-2">
            <h3 className="text-base sm:text-lg font-bold truncate">{t('moments.editMoments')}</h3>
            <div className="flex gap-2 flex-shrink-0">
              <LongPressHoverButton 
                onClick={addMoment} 
                className="w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center hover:bg-primary-100 text-primary-700"
                title={t('moments.addMoment')}
                aria-label={t('moments.addMoment')}
              >
                <Plus className="w-4 h-4" />
              </LongPressHoverButton>
              <LongPressHoverButton 
                onClick={handleClose} 
                className="w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700"
                title={t('moments.close')}
                aria-label={t('moments.close')}
              >
                <X className="w-4 h-4" />
              </LongPressHoverButton>
            </div>
          </div>
        </div>
        
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
          <div className="space-y-3">
      {editingMoments.filter(m => m && (m.id || m.moment_id)).map((moment, index) => (
              <div key={moment.id || moment.moment_id} data-moment-moment_id={moment.id || moment.moment_id} className="border rounded-lg p-3 sm:p-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                    {/* Representative image */}
                    <div className="relative flex-shrink-0">
                      <div className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-lg overflow-hidden border">
                        {ImageComponent(
                          !String(moment.id || moment.moment_id).startsWith('temp-') && urlHelpers?.getRepresentativeUrl 
                            ? `${urlHelpers.getRepresentativeUrl('moments', moment.id || moment.moment_id)}?v=${moment.representative_image || 'none'}` 
                            : null,
                          {
                            width: 64,
                            height: 64,
                            className: 'w-full h-full object-cover',
                            alt: '',
                            loading: 'eager'
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
                    <div className="flex-1 min-w-0">
                      {editingTitle?.moment_id === String(moment.id || moment.moment_id) ? (
                        <div className="relative">
                          <input
                            type="text"
                            moment_id={`edit-moment-title-${moment.id || moment.moment_id}`}
                            name={`edit-moment-title-${moment.id || moment.moment_id}`}
                            value={editingTitle.title}
                            onChange={(e) => setEditingTitle({ ...editingTitle, title: e.target.value })}
                            onBlur={() => handleTitleEdit(moment.id || moment.moment_id, editingTitle.title)}
                            className={`text-base sm:text-lg font-semibold border-b hover:border-gray-300 focus:outline-none px-1 py-1 w-full ${
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
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              startTitleEdit(moment.id || moment.moment_id, moment.label || '');
                            }}
                            className="text-base sm:text-lg font-semibold cursor-pointer hover:bg-gray-50 px-1 py-1 rounded transition-colors truncate text-left bg-transparent border-none m-0"
                          >
                            {moment.label || `${t('moments.newMoment')} ${index + 1}`}
                          </button>
                          {nameConflicts.get(moment.id || moment.moment_id) && (
                            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" title={t('moments.nameAlreadyExists')} />
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                    {(changedMoments.has(moment.id || moment.moment_id) || editingTitle?.moment_id === String(moment.id || moment.moment_id)) && (
                      <>
                        <button 
                          onClick={() => {
                            // If editing title, save it first
                            if (editingTitle?.moment_id === String(moment.id || moment.moment_id)) {
                              handleTitleEdit(moment.id || moment.moment_id, editingTitle.title);
                            }
                            handleSaveMoment(moment);
                          }}
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
                            // If editing title, cancel editing first
                            if (editingTitle?.moment_id === String(momentId)) {
                              setEditingTitle(null);
                            }
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
                      onClick={() => changedMoments.size > 0 ? null : setEditingImagesForMoment(moment)}
                      disabled={changedMoments.size > 0}
                      className={`w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center ${
                        changedMoments.size > 0
                          ? 'opacity-50 cursor-default text-gray-400'
                          : 'hover:bg-primary-100 text-primary-700'
                      }`}
                      title={changedMoments.size > 0 ? t('moments.saveOrDiscardBeforeEditingPhotos') : t('moments.editPhotos')}
                      aria-label={changedMoments.size > 0 ? t('moments.saveOrDiscardBeforeEditingPhotos') : t('moments.editPhotos')}
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
                      value={moment.description || ''}
                      onChange={(e) => updateMoment(moment.id || moment.moment_id, { description: e.target.value })}
                      className="w-full border rounded px-2 py-1 text-sm resize-none"
                      rows="2"
                      placeholder={t('moments.addDescription')}
                      dir={isRTL ? 'rtl' : 'ltr'}
                    />
                  </div>
                  
                  <div className="flex flex-col sm:flex-row gap-2 md:col-span-2">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">{t('moments.startTime')}</label>
                      <input
                        type="datetime-local"
                        moment_id={`moment-start-${moment.id || moment.moment_id}`}
                        name={`moment-start-${moment.id || moment.moment_id}`}
                        value={(() => {
                          // If moment has start_date in editing state, check if it's already in datetime-local format
                          const startValue = moment.start_date || moment.start;
                          if (!startValue) return '';
                          // If it's already in datetime-local format (from editing), use it directly
                          if (startValue.includes('T') && !startValue.includes('GMT')) {
                            return startValue.slice(0, 16);
                          }
                          // Otherwise convert from backend format
                          return convertToInputFormat(startValue);
                        })()}
                        onChange={(e) => {
                          // Store the datetime-local value directly (don't convert yet)
                          updateMoment(moment.id || moment.moment_id, { start_date: e.target.value });
                        }}
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
                        value={(() => {
                          // If moment has end_date in editing state, check if it's already in datetime-local format
                          const endValue = moment.end_date || moment.end;
                          if (!endValue) return '';
                          // If it's already in datetime-local format (from editing), use it directly
                          if (endValue.includes('T') && !endValue.includes('GMT')) {
                            return endValue.slice(0, 16);
                          }
                          // Otherwise convert from backend format
                          return convertToInputFormat(endValue);
                        })()}
                        onChange={(e) => {
                          // Store the datetime-local value directly (don't convert yet)
                          updateMoment(moment.id || moment.moment_id, { end_date: e.target.value });
                        }}
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


