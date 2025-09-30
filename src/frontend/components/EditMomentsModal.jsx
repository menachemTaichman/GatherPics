import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Trash2, X, Image, List, Save, RotateCcw, Plus, Clock } from 'lucide-react';
import { sortMoments } from '../utils/sorting';
import { momentsAPI, handleAPIError, optimisticUpdates, API_BASE } from '../utils/apiService';
import { useModalFocus } from '../utils/useModalFocus';
import { useEventUrls } from '../utils/useEventUrls';
import { useDataStore } from '../utils/dataManager';

import EditMomentImagesModal from './EditMomentImagesModal';
import RepresentativeImageModal from './RepresentativeImageModal';

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

function EditMomentsModal({ eventUrl, onSave, onDelete, momentImagesMap, onRefreshImages, onToast, onClose }) {
  const { urlHelpers } = useEventUrls(eventUrl);
  const storeMoments = useDataStore(state => Object.values(state.entities?.moments || {}));
  const sortedMoments = useMemo(() => {
    return sortMoments(storeMoments, 'asc');
  }, [storeMoments]);

  // Inline SVG placeholder (gray background with a question mark)
  const PLACEHOLDER_DATA_URL =
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';
  const [internalMoments, setInternalMoments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingMoments, setEditingMoments] = useState([]);
  const [selectedMoment, setSelectedMoment] = useState(null);
  const [showImageSelector, setShowImageSelector] = useState(false);
  const [editingTitle, setEditingTitle] = useState(null);
  const [changedMoments, setChangedMoments] = useState(new Set());
  const [editingImagesForMoment, setEditingImagesForMoment] = useState(null);
  const [tempMomentCounter, setTempMomentCounter] = useState(0);

  // Use modal focus hook
  const { modalRef } = useModalFocus(true, onClose, {
    allowOutsideScroll: true
  });

  useEffect(() => {
    fetchMomentsForEdit();
  }, []);

  const fetchMomentsForEdit = async () => {
    setIsLoading(true);
    try {
      // Always fetch all moments for editing, including empty and archived
      const response = await momentsAPI.getAll(eventUrl);
      
      // Changes are automatically applied by apiService interceptor
      
      const allFromStore = Object.values(useDataStore.getState().entities?.moments || {});
      const sortedMoments = sortMoments(allFromStore, 'asc');
      setInternalMoments(sortedMoments);
      setEditingMoments(sortedMoments);
      setChangedMoments(new Set());
    } catch (error) {
      console.error("Failed to fetch moments for editing:", error);
      onToast("Failed to load moments for editing.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (onClose) {
      onClose();
    }
  };

  const handleDiscard = () => {
    // Reset all changes and remove temporary moments
    const sortedMoments = sortMoments(internalMoments, 'asc');
    setEditingMoments(sortedMoments);
    setChangedMoments(new Set());
  };

  const handleSave = async () => {
    // Only save moments that have been changed and are not temporary
      const momentsToSave = editingMoments.filter(m => 
      changedMoments.has(m.id || m.moment_id) && !(String(m.id || m.moment_id).startsWith('temp-'))
    );
    
    // Check if any moment was just created or updated with time range
      const momentsWithTimeRange = editingMoments.filter(m => 
      m.start && m.end && 
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
      let savedMoment;
      if (String(moment.id || moment.moment_id).startsWith('temp-')) {
        const { id, moment_id, image_ids, images, ...momentData } = moment;
        // Create moment directly without optimistic updates to avoid duplicates
        const result = await momentsAPI.create(momentData, eventUrl);
        
        // Changes are automatically applied by apiService interceptor
        
        // Get the created moment from store using moment_id
        const createdMomentId = result.moment_id;
        const store = useDataStore.getState();
        savedMoment = store.entities?.moments?.[createdMomentId];
        
        if (savedMoment) {
          // Replace the temporary moment with the saved one, preserving any additional fields
          setEditingMoments(prev => prev.map(m => 
            (m.id || m.moment_id) === (moment.id || moment.moment_id) ? { ...moment, ...savedMoment, id: savedMoment.id, moment_id: savedMoment.id } : m
          ));
          
          // Navigate to the newly created moment in the sorted list
          setTimeout(() => {
            const momentElement = document.querySelector(`[data-moment-moment_id="${savedMoment.id}"]`);
            if (momentElement) {
              momentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 100);
        }
      } else {
        // Update existing moment directly without optimistic updates to avoid conflicts
        // Filter out image-related fields that the backend doesn't expect
        const { id, moment_id, image_ids, images, ...momentData } = moment;
        const result = await momentsAPI.update(id || moment_id, momentData, eventUrl);
        
        // Changes are automatically applied by apiService interceptor
        
        // Get the updated moment from store
        const store = useDataStore.getState();
        savedMoment = store.entities?.moments?.[id || moment_id];
        
        if (savedMoment) {
          // Update the moment in editingMoments with the saved data, preserving existing fields
          setEditingMoments(prev => prev.map(m => 
            (m.id || m.moment_id) === (moment.id || moment.moment_id) ? { ...moment, ...savedMoment } : m
          ));
        }
      }
      
      // Remove from changed moments since it's now saved
      setChangedMoments(prev => {
        const next = new Set(prev);
        next.delete(moment.id || moment.moment_id);
        return next;
      });
      
      // Show success message
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
      const errorInfo = handleAPIError(error, 'Failed to save moment');
      alert(errorInfo.message);
      throw error;
    }
  };

  const handleDelete = async (moment_id) => {
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
      
      // Show success message
      if (onToast) {
        onToast('Moment deleted successfully.', 'success');
      }
    } catch (error) {
      console.error('Error deleting moment:', error);
      const errorInfo = handleAPIError(error, 'Failed to delete moment');
      if (onToast) {
        onToast(errorInfo.message, 'error');
      } else {
        alert(errorInfo.message);
      }
    }
  };

  const updateMoment = (moment_id, updates) => {
    setEditingMoments(prev => prev.map(m => (m.id || m.moment_id) === moment_id ? { ...m, ...updates, id: m.id || moment_id } : m));
    // Mark this moment as changed
    setChangedMoments(prev => new Set([...prev, moment_id]));
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
    
    // Jump to the newly added moment by scrolling to it
    setTimeout(() => {
      const momentElement = document.querySelector(`[data-moment-moment_id="${newMoment.moment_id}"]`);
      if (momentElement) {
        momentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-3">
      {editingMoments.filter(m => m && (m.id || m.moment_id)).map((moment, index) => (
              <div key={moment.id || moment.moment_id} data-moment-moment_id={moment.id || moment.moment_id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3 flex-1">
                    {/* Representative image */}
                    <div className="relative">
                      <div className="w-16 h-16 rounded-lg overflow-hidden border">
                        <img 
                          src={urlHelpers?.getRepresentativeUrl ? urlHelpers.getRepresentativeUrl('moments', moment.moment_id) : ''}
                          alt="" 
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                        <div className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center bg-gray-100" style={{display: 'none'}}>
                          <Image className="w-6 h-6 text-gray-400" />
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedMoment(moment);
                          setShowImageSelector(true);
                        }}
                        className="absolute -bottom-1 -right-1 w-7 h-7 bg-white border-2 border-gray-400 rounded-full flex items-center justify-center hover:bg-gray-50 hover:border-gray-600 transition-colors shadow-md"
                        title="Edit representative photo"
                      >
                        <Pencil className="w-4 h-4 text-gray-700" />
                      </button>
                    </div>

                    {/* Inline Editable Title */}
                    <div className="flex-1">
                      {editingTitle?.moment_id === (moment.id || moment.moment_id) ? (
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
                          className="text-lg font-semibold border-b border-transparent hover:border-gray-300 focus:border-primary-500 focus:outline-none px-1 py-1 w-full"
                          autoFocus
                        />
                      ) : (
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
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center space-x-2">
                    {changedMoments.has(moment.id || moment.moment_id) && (
                      <>
                        <button 
                          onClick={() => handleSaveMoment(moment)}
                          className="w-8 h-8 border border-transparent rounded-lg transition-colors flex items-center justify-center hover:bg-green-100 text-green-700"
                          title="Save Moment"
                        >
                          <Save className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => {
                            if (moment.moment_id.startsWith('temp-')) {
                              // Remove temporary moment completely
                              setEditingMoments(prev => prev.filter(m => (m.id || m.moment_id) !== (moment.id || moment.moment_id)));
                              setChangedMoments(prev => {
                                const next = new Set(prev);
                                next.delete(moment.id || moment.moment_id);
                                return next;
                              });
                            } else {
                              // Reset to original for existing moment
                              const originalMoment = internalMoments.find(m => (m.id || m.moment_id) === (moment.id || moment.moment_id));
                              if (originalMoment) {
                                setEditingMoments(prev => prev.map(m => 
                                  (m.id || m.moment_id) === (moment.id || moment.moment_id) ? originalMoment : m
                                ));
                                setChangedMoments(prev => {
                                  const next = new Set(prev);
                                  next.delete(moment.id || moment.moment_id);
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
                      onClick={() => handleDelete(moment.id || moment.moment_id)}
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
                        value={moment.start}
                        onChange={(e) => updateMoment(moment.id || moment.moment_id, { start: e.target.value })}
                        className="w-full border rounded px-2 py-1 text-sm"
                      />
                      {moment.start && (
                        <div className="text-xs text-gray-500 mt-1">
                          {formatDateTime(moment.start)}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">End Time</label>
                      <input
                        type="datetime-local"
                        moment_id={`moment-end-${moment.id || moment.moment_id}`}
                        name={`moment-end-${moment.id || moment.moment_id}`}
                        value={moment.end}
                        onChange={(e) => updateMoment(moment.id || moment.moment_id, { end: e.target.value })}
                        className="w-full border rounded px-2 py-1 text-sm"
                      />
                      {moment.end && (
                        <div className="text-xs text-gray-500 mt-1">
                          {formatDateTime(moment.end)}
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
          moment={editingImagesForMoment}
          momentImagesMap={momentImagesMap}
          onRefreshImages={onRefreshImages}
          onSave={onSave}
          moments={internalMoments}
          onClose={() => setEditingImagesForMoment(null)}
        />
      )}

      {/* Representative Image Modal */}
      <RepresentativeImageModal
        isOpen={showImageSelector}
        onClose={() => setShowImageSelector(false)}
        moment={selectedMoment}
        momentImagesMap={momentImagesMap}
      />
    </div>
    </AnimatePresence>
  );
}

export default EditMomentsModal;