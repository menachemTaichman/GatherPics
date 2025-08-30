import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Trash2, X, Image, List, Save, RotateCcw, Plus, Clock } from 'lucide-react';
import { sortMoments } from '../utils/sorting';
import { momentsAPI, handleAPIError, optimisticUpdates, API_BASE } from '../utils/apiService';
import { useModalFocus } from '../utils/useModalFocus';
import { useEventUrls } from '../utils/useEventUrls';

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

function EditMomentsModal({ eventUrl, moments, images, onSave, onDelete, momentImagesMap, onRefreshImages, onToast, onClose }) {
  const { urlHelpers } = useEventUrls(eventUrl);
  
  // Inline SVG placeholder (gray background with a question mark)
  const PLACEHOLDER_DATA_URL =
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';

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
    const sortedMoments = sortMoments(moments, 'asc');
    setEditingMoments(sortedMoments);
    setChangedMoments(new Set());
  }, [moments]);

  const handleClose = () => {
    if (onClose) {
      onClose();
    }
  };

  const handleDiscard = () => {
    // Reset all changes and remove temporary moments
    const sortedMoments = sortMoments(moments, 'asc');
    setEditingMoments(sortedMoments);
    setChangedMoments(new Set());
  };

  const handleSave = async () => {
    // Only save moments that have been changed and are not temporary
    const momentsToSave = editingMoments.filter(m => 
      changedMoments.has(m.momentID) && !m.momentID.startsWith('temp-')
    );
    
    // Check if any moment was just created or updated with time range
    const momentsWithTimeRange = editingMoments.filter(m => 
      m.start && m.end && 
      (m.momentID.startsWith('temp-') || m.images === undefined)
    );
    
    if (momentsWithTimeRange.length > 0) {
      // Save the non-temporary moments first
      if (momentsToSave.length > 0) {
        for (const moment of momentsToSave) {
          // Filter out image-related fields before calling onSave
          const { momentID, image_IDs, images, ...momentData } = moment;
          await onSave({ ...momentData, momentID });
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
        const { momentID, image_IDs, images, image_ids, ...momentData } = moment;
        await onSave({ ...momentData, momentID });
      }
    }
    
    handleClose();
  };

  const handleSaveMoment = async (moment) => {
    try {
      let savedMoment;
      if (moment.momentID.startsWith('temp-')) {
        const { momentID, image_IDs, images, image_ids, ...momentData } = moment;
        // Create moment directly without optimistic updates to avoid duplicates
        const result = await momentsAPI.create(momentData, eventUrl);
        savedMoment = result.moment;
        
        // Replace the temporary moment with the saved one, preserving any additional fields
        setEditingMoments(prev => prev.map(m => 
          m.momentID === moment.momentID ? { ...moment, ...savedMoment, momentID: savedMoment.momentID } : m
        ));
      } else {
        // Update existing moment directly without optimistic updates to avoid conflicts
        // Filter out image-related fields that the backend doesn't expect
        const { momentID, image_IDs, images, ...momentData } = moment;
        const result = await momentsAPI.update(moment.momentID, momentData, eventUrl);
        savedMoment = result.moment;
        
        // Update the moment in editingMoments with the saved data, preserving existing fields
        setEditingMoments(prev => prev.map(m => 
          m.momentID === moment.momentID ? { ...moment, ...savedMoment } : m
        ));
      }
      
      // Remove from changed moments since it's now saved
      setChangedMoments(prev => {
        const next = new Set(prev);
        next.delete(moment.momentID);
        return next;
      });
      
      // Show success message
      if (onToast) {
        if (moment.momentID.startsWith('temp-')) {
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

  const handleDelete = async (id) => {
    try {
      // Call the parent's onDelete function
      if (onDelete) {
        await onDelete(id);
      }
      
      // Remove the moment from editingMoments
      setEditingMoments(prev => prev.filter(m => m.momentID !== id));
      
      // Remove from changedMoments if it was there
      setChangedMoments(prev => {
        const next = new Set(prev);
        next.delete(id);
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

  const updateMoment = (id, updates) => {
    setEditingMoments(prev => prev.map(m => m.momentID === id ? { ...m, ...updates } : m));
    // Mark this moment as changed
    setChangedMoments(prev => new Set([...prev, id]));
  };

  const handleEditImages = (moment) => {
    setEditingImagesForMoment(moment);
  };

  const addMoment = () => {
    const newMoment = {
      momentID: `temp-${Date.now()}-${tempMomentCounter}`,
      label: 'New Moment',
      start: new Date().toISOString().slice(0, 16),
      end: new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 16),
      description: ''
    };
    
    // Add to editing moments list (don't save to backend yet)
    setEditingMoments(prev => [...prev, newMoment]);
    setChangedMoments(prev => new Set([...prev, newMoment.momentID]));
    setTempMomentCounter(prev => prev + 1); // Increment counter for next temporary moment
    
    // Jump to the newly added moment by scrolling to it
    setTimeout(() => {
      const momentElement = document.querySelector(`[data-moment-id="${newMoment.momentID}"]`);
      if (momentElement) {
        momentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  const handleTitleEdit = (momentId, newTitle) => {
    updateMoment(momentId, { label: newTitle });
    setEditingTitle(null);
  };

  const startTitleEdit = (momentId, currentTitle) => {
    setEditingTitle({ id: momentId, title: currentTitle });
  };

  const getRepresentativeImagePath = (imageID) => {
    // Note: We need to resolve the event ID from eventUrl for the image URLs
    // For now, we'll use placeholders until we implement proper event ID resolution
    return PLACEHOLDER_DATA_URL;
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
            {editingMoments.filter(m => m && m.momentID).map((moment, index) => (
              <div key={moment.momentID} data-moment-id={moment.momentID} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3 flex-1">
                    {/* Representative image */}
                    <div className="relative">
                      {moment.representative_image && moment.representative_image.trim() !== '' ? (
                        <div className="w-16 h-16 rounded-lg overflow-hidden border">
                          <img 
                            src={moment.representative_image.startsWith('/api/') 
                              ? `${API_BASE}${moment.representative_image}` 
                              : urlHelpers && urlHelpers.getThumbnailUrl(moment.representative_image)}
                            alt="" 
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                              e.target.onerror = null;
                              e.target.style.display = 'none';
                              e.target.nextSibling.style.display = 'flex';
                            }}
                          />
                          <div className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center bg-gray-100" style={{display: 'none'}}>
                            <Image className="w-6 h-6 text-gray-400" />
                          </div>
                        </div>
                      ) : (
                        <div className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center">
                          <Image className="w-6 h-6 text-gray-400" />
                        </div>
                      )}
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
                      {editingTitle?.id === moment.momentID ? (
                        <input
                          type="text"
                          id={`edit-moment-title-${moment.momentID}`}
                          name={`edit-moment-title-${moment.momentID}`}
                          value={editingTitle.title}
                          onChange={(e) => setEditingTitle({ ...editingTitle, title: e.target.value })}
                          onBlur={() => handleTitleEdit(moment.momentID, editingTitle.title)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleTitleEdit(moment.momentID, editingTitle.title);
                            } else if (e.key === 'Escape') {
                              setEditingTitle(null);
                            }
                          }}
                          className="text-lg font-semibold border-b border-transparent hover:border-gray-300 focus:border-primary-500 focus:outline-none px-1 py-1 w-full"
                          autoFocus
                        />
                      ) : (
                        <div
                          onClick={() => startTitleEdit(moment.momentID, moment.label)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              startTitleEdit(moment.momentID, moment.label);
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
                    {changedMoments.has(moment.momentID) && (
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
                            if (moment.momentID.startsWith('temp-')) {
                              // Remove temporary moment completely
                              setEditingMoments(prev => prev.filter(m => m.momentID !== moment.momentID));
                              setChangedMoments(prev => {
                                const next = new Set(prev);
                                next.delete(moment.momentID);
                                return next;
                              });
                            } else {
                              // Reset to original for existing moment
                              const originalMoment = moments.find(m => m.momentID === moment.momentID);
                              if (originalMoment) {
                                setEditingMoments(prev => prev.map(m => 
                                  m.momentID === moment.momentID ? originalMoment : m
                                ));
                                setChangedMoments(prev => {
                                  const next = new Set(prev);
                                  next.delete(moment.momentID);
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
                      onClick={() => handleDelete(moment.momentID)}
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
                      id={`moment-description-${moment.momentID}`}
                      name={`moment-description-${moment.momentID}`}
                      value={moment.description}
                      onChange={(e) => updateMoment(moment.momentID, { description: e.target.value })}
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
                        id={`moment-start-${moment.momentID}`}
                        name={`moment-start-${moment.momentID}`}
                        value={moment.start}
                        onChange={(e) => updateMoment(moment.momentID, { start: e.target.value })}
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
                        id={`moment-end-${moment.momentID}`}
                        name={`moment-end-${moment.momentID}`}
                        value={moment.end}
                        onChange={(e) => updateMoment(moment.momentID, { end: e.target.value })}
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
          moments={moments}
          onClose={() => setEditingImagesForMoment(null)}
        />
      )}

      {/* Representative Image Modal */}
      <RepresentativeImageModal
        isOpen={showImageSelector}
        onClose={() => setShowImageSelector(false)}
        moment={selectedMoment}
        momentImagesMap={momentImagesMap}
        onImageSelect={(imageID) => {
          if (selectedMoment) {
            if (imageID === '') {
              // Remove representative image
              updateMoment(selectedMoment.momentID, { representative_image: '' });
            } else {
              // Store the representative image as a full API path, not just the image ID
              const representativeImagePath = getRepresentativeImagePath(imageID);
              updateMoment(selectedMoment.momentID, { representative_image: representativeImagePath });
            }
          }
        }}
      />
    </div>
    </AnimatePresence>
  );
}

export default EditMomentsModal;