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

function formatDateTime(dateString) {
  if (!dateString) return '';
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

function EditMomentsModal({ eventUrl, onSave, onDelete, momentImagesMap, onRefreshImages, onToast, onClose, urlHelpers: injectedUrlHelpers }) {
  const urlHelpers = injectedUrlHelpers;
  const eventId = useEventId(eventUrl);
  
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
      onToast('Cannot save: One or more moments have duplicate names.', 'error');
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
          await onSave({ ...momentData, moment_id: id || moment_id });
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
        await onSave({ ...momentData, moment_id: id || moment_id });
      }
    }
    
    handleClose();
  };

  const handleSaveMoment = async (moment) => {
    try {
      const momentId = moment.id || moment.moment_id;
      
      // Check for name conflict before saving
      if (nameConflicts.get(momentId)) {
        onToast('Cannot save: A moment with this name already exists.', 'error');
        return;
      }
      
      let savedMoment;
      if (String(moment.id || moment.moment_id).startsWith('temp-')) {
        const { id, moment_id, image_ids, images, ...momentData } = moment;
        const result = await momentsAPI.create(momentData, eventUrl);
        
        // Changes are automatically applied by apiService interceptor
        const createdMomentId = result.moment_id;
        
        // Wait for store to update
        await new Promise(resolve => setTimeout(resolve, 50));
        
        const store = useDataStore.getState();
        savedMoment = store.entities?.[eventId]?.moments?.[createdMomentId];
        
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
        }
      } else {
        const { id, moment_id, image_ids, images, ...momentData } = moment;
        await momentsAPI.update(id || moment_id, momentData, eventUrl);
        
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
          onToast('Moment created successfully.', 'success');
        } else {
          onToast('Moment updated successfully.', 'success');
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
        onToast('Moment deleted successfully.', 'success');
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

  const updateMoment = (moment_id, updates) => {
    setEditingMoments(prev => prev.map(m => (m.id || m.moment_id) === moment_id ? { ...m, ...updates, id: m.id || moment_id } : m));
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

  const handleEditImages = (moment) => {
    setEditingImagesForMoment(moment);
  };

  const addMoment = () => {
    const newMoment = {
      moment_id: `temp-${Date.now()}-${tempMomentCounter}`,
      label: 'New Moment',
      start: new Date().toISOString().slice(0, 16),
      end: new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 16),
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
        >
        <div className="p-6 border-b">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold">Edit Moments</h3>
            <div className="flex space-x-2">
              <button 
                onClick={addMoment} 
                className="w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center hover:bg-primary-100 text-primary-700"
                title="Add Moment"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button 
                onClick={handleClose} 
                className="w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center hover:bg-gray-100 text-gray-700"
                title="Close"
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
                  <div className="flex items-center space-x-3 flex-1">
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
                                onToast('Representative removed', 'success');
                              }
                            } catch (error) {
                              if (onToast) {
                                onToast(formatErrorMessage('remove representative', error), 'error');
                              }
                            }
                          }}
                          className="absolute -bottom-1 -right-1 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-md transition-colors"
                          title="Remove representative"
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
                          />
                          {nameConflicts.get(moment.id || moment.moment_id) && (
                            <div className="absolute top-full left-0 mt-1 flex items-center space-x-1 text-red-500 text-xs">
                              <AlertTriangle className="w-3 h-3" />
                              <span>Name already exists</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center space-x-2">
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
                            {moment.label || `Moment ${index + 1}`}
                          </div>
                          {nameConflicts.get(moment.id || moment.moment_id) && (
                            <AlertTriangle className="w-4 h-4 text-red-500" title="Name already exists" />
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center space-x-2">
                    {changedMoments.has(moment.id || moment.moment_id) && (
                      <>
                        <button 
                          onClick={() => handleSaveMoment(moment)}
                          disabled={nameConflicts.get(moment.id || moment.moment_id)}
                          className="w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center hover:bg-green-100 text-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={nameConflicts.get(moment.id || moment.moment_id) ? "Cannot save: Name already exists" : "Save Moment"}
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
                          title="Discard Changes"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setEditingImagesForMoment(moment)}
                      className="w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center hover:bg-primary-100 text-primary-700"
                      title="Edit photos"
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
                      title="Delete Moment"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                {/* Compact Details Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                    <textarea
                      moment_id={`moment-description-${moment.id || moment.moment_id}`}
                      name={`moment-description-${moment.id || moment.moment_id}`}
                      value={moment.description}
                      onChange={(e) => updateMoment(moment.id || moment.moment_id, { description: e.target.value })}
                      className="w-full border rounded px-2 py-1 text-sm resize-none"
                      rows="2"
                      placeholder="Add description..."
                    />
                  </div>
                  
                  <div className="flex space-x-2">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Start Time</label>
                      <input
                        type="datetime-local"
                        moment_id={`moment-start-${moment.id || moment.moment_id}`}
                        name={`moment-start-${moment.id || moment.moment_id}`}
                        value={moment.start_date}
                        onChange={(e) => updateMoment(moment.id || moment.moment_id, { start_date: e.target.value })}
                        className="w-full border rounded px-2 py-1 text-sm"
                      />
                      {moment.start_date && (
                        <div className="text-xs text-gray-500 mt-1">
                          {formatDateTime(moment.start_date)}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">End Time</label>
                      <input
                        type="datetime-local"
                        moment_id={`moment-end-${moment.id || moment.moment_id}`}
                        name={`moment-end-${moment.id || moment.moment_id}`}
                        value={moment.end_date}
                        onChange={(e) => updateMoment(moment.id || moment.moment_id, { end_date: e.target.value })}
                        className="w-full border rounded px-2 py-1 text-sm"
                      />
                      {moment.end_date && (
                        <div className="text-xs text-gray-500 mt-1">
                          {formatDateTime(moment.end_date)}
                        </div>
                      )}
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
          title="Delete Moment"
          message="Are you sure you want to delete"
          itemName={deletingMoment.label || 'this moment'}
          confirmText="Delete"
          cancelText="Cancel"
          imageUrl={
            !String(deletingMoment.id).startsWith('temp-') && deletingMoment.representative_image && urlHelpers?.getRepresentativeUrl
              ? `${urlHelpers.getRepresentativeUrl('moments', deletingMoment.id)}?v=${deletingMoment.representative_image}`
              : null
          }
          imageAlt={deletingMoment.label || 'Moment'}
          caption="Note: Images will not be deleted, only the moment."
        />
      )}
    </div>
    </AnimatePresence>
  );
}

export default EditMomentsModal;


