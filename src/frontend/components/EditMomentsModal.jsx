import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Pencil, Trash2, X, Image, List } from 'lucide-react';

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

function EditMomentsModal({ open, onClose, moments, images, onSave, onDelete, momentPhotosMap, onRefreshPhotos, onOpenEditPhotos }) {
  const [editingMoments, setEditingMoments] = useState([]);
  const [selectedMoment, setSelectedMoment] = useState(null);
  const [showPhotoSelector, setShowPhotoSelector] = useState(false);
  const [editingTitle, setEditingTitle] = useState(null);

  const [changedMoments, setChangedMoments] = useState(new Set());

  useEffect(() => {
    if (open) {
      // Sort moments by start_datetime, with moments without start time at the end
      const sortedMoments = [...moments].sort((a, b) => {
        if (!a.start_datetime && !b.start_datetime) return 0;
        if (!a.start_datetime) return 1;
        if (!b.start_datetime) return -1;
        return new Date(a.start_datetime) - new Date(b.start_datetime);
      });
      setEditingMoments(sortedMoments);
      
      // Reset changed moments tracking
      setChangedMoments(new Set());
    }
  }, [open, moments]);



  const handleSave = async () => {
    // Check if any moment was just created or updated with time range
    const momentsWithTimeRange = editingMoments.filter(m => 
      m.start_datetime && m.end_datetime && 
      (m.id.startsWith('temp-') || m.photos === undefined)
    );
    
    if (momentsWithTimeRange.length > 0) {
      // Save the moments first
      onSave(editingMoments);
      
      // Then auto-open edit photos for the first moment with time range
      const momentToEdit = momentsWithTimeRange[0];
      await handleEditPhotos(momentToEdit);
      
      // Don't close the modal yet, let the user edit photos
      return;
    }
    
    onSave(editingMoments);
    onClose();
  };

  const handleSaveMoment = async (moment) => {
    try {
      let savedMoment = moment;
      if (moment.id.startsWith('temp-')) {
        // Create new moment
        const { id, ...momentData } = moment;
        const response = await fetch('/api/moments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(momentData)
        });
        
        if (!response.ok) {
          throw new Error('Failed to create moment');
        }
        
        const result = await response.json();
        savedMoment = result.moment;
        // Update the local state with the saved moment
        setEditingMoments(prev => prev.map(m => 
          m.id === moment.id ? { ...savedMoment, id: savedMoment.id } : m
        ));
      } else {
        // Update existing moment
        const response = await fetch(`/api/moments/${moment.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(moment)
        });
        
        if (!response.ok) {
          throw new Error('Failed to update moment');
        }
      }
      
      // Clear the changed state for this moment
      setChangedMoments(prev => {
        const next = new Set(prev);
        next.delete(moment.id);
        return next;
      });
      
      // If moment has time range, open edit photos modal, but DO NOT call onSave yet
      if (savedMoment.start_datetime && savedMoment.end_datetime) {
        onOpenEditPhotos(savedMoment);
        // Do NOT call onSave here! (prevents jump)
      } else {
        // Only call onSave if not opening the photo modal
        if (onSave) onSave(editingMoments);
      }
    } catch (error) {
      console.error('Error saving moment:', error);
      alert('Failed to save moment. Please try again.');
    }
  };

  const handleDelete = (id) => {
    if (confirm('Are you sure you want to delete this moment?')) {
      // Only call onDelete if it's not a temporary ID
      if (!id.startsWith('temp-')) {
        onDelete(id);
      } else {
        // Remove from local state if it's a temporary moment
        setEditingMoments(prev => prev.filter(m => m.id !== id));
      }
    }
  };

  const updateMoment = (id, updates) => {
    setEditingMoments(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
    // Mark this moment as changed
    setChangedMoments(prev => new Set([...prev, id]));
  };

  const addMoment = () => {
    const newMoment = {
      id: `temp-${Date.now()}`,
      title: '',
      start_datetime: '',
      end_datetime: '',
      representative_photo: '',
      description: ''
    };
    setEditingMoments(prev => [...prev, newMoment]);
    // Mark the new moment as changed
    setChangedMoments(prev => new Set([...prev, newMoment.id]));
  };







  const handleTitleEdit = (momentId, newTitle) => {
    updateMoment(momentId, { title: newTitle });
    setEditingTitle(null);
  };

  const startTitleEdit = (momentId, currentTitle) => {
    setEditingTitle({ id: momentId, title: currentTitle });
  };



  if (!open) return null;

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 p-4"
    >
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-lg shadow-lg w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold">Edit Moments</h3>
            <div className="flex space-x-2">
              <button onClick={addMoment} className="btn-secondary">Add Moment</button>
              <button onClick={onClose} className="btn-secondary">Close</button>
            </div>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-3">
            {editingMoments.map((moment, index) => (
              <div key={moment.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3 flex-1">
                    {/* Representative Photo */}
                    <div className="relative">
                      {moment.representative_photo ? (
                        <div className="w-16 h-16 rounded-lg overflow-hidden border">
                          <img 
                            src={`/images/${moment.representative_photo}`}
                            alt="" 
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                              e.target.onerror = null;
                              e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';
                            }}
                          />
                        </div>
                      ) : (
                        <div className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center">
                          <Image className="w-6 h-6 text-gray-400" />
                        </div>
                      )}
                      <button
                        onClick={() => {
                          setSelectedMoment(moment);
                          setShowPhotoSelector(true);
                        }}
                        className="absolute -bottom-1 -right-1 w-7 h-7 bg-white border-2 border-gray-400 rounded-full flex items-center justify-center hover:bg-gray-50 hover:border-gray-600 transition-colors shadow-md"
                        title="Edit representative photo"
                      >
                        <Pencil className="w-4 h-4 text-gray-700" />
                      </button>
                    </div>

                    {/* Inline Editable Title */}
                    <div className="flex-1">
                      {editingTitle?.id === moment.id ? (
                        <input
                          type="text"
                          value={editingTitle.title}
                          onChange={(e) => setEditingTitle({ ...editingTitle, title: e.target.value })}
                          onBlur={() => handleTitleEdit(moment.id, editingTitle.title)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleTitleEdit(moment.id, editingTitle.title);
                            } else if (e.key === 'Escape') {
                              setEditingTitle(null);
                            }
                          }}
                          className="text-lg font-semibold border-b border-transparent hover:border-gray-300 focus:border-primary-500 focus:outline-none px-1 py-1 w-full"
                          autoFocus
                        />
                      ) : (
                        <div
                          onClick={() => startTitleEdit(moment.id, moment.title)}
                          className="text-lg font-semibold cursor-pointer hover:bg-gray-50 px-1 py-1 rounded transition-colors"
                        >
                          {moment.title || `Moment ${index + 1}`}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center space-x-2">
                    {changedMoments.has(moment.id) && (
                      <button 
                        onClick={() => handleSaveMoment(moment)}
                        className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                        title="Save Moment"
                      >
                        Save
                      </button>
                    )}
                    <button
                      onClick={() => onOpenEditPhotos(moment)}
                      className="p-2 text-gray-600 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                      title="Edit Photos"
                    >
                      <List className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleDelete(moment.id)}
                      className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
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
                      value={moment.description}
                      onChange={(e) => updateMoment(moment.id, { description: e.target.value })}
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
                        value={moment.start_datetime}
                        onChange={(e) => updateMoment(moment.id, { start_datetime: e.target.value })}
                        className="w-full border rounded px-2 py-1 text-sm"
                      />
                      {moment.start_datetime && (
                        <div className="text-xs text-gray-500 mt-1">
                          {formatDateTime(moment.start_datetime)}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">End Time</label>
                      <input
                        type="datetime-local"
                        value={moment.end_datetime}
                        onChange={(e) => updateMoment(moment.id, { end_datetime: e.target.value })}
                        className="w-full border rounded px-2 py-1 text-sm"
                      />
                      {moment.end_datetime && (
                        <div className="text-xs text-gray-500 mt-1">
                          {formatDateTime(moment.end_datetime)}
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

      {/* Photo Selector Modal */}
      {showPhotoSelector && selectedMoment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b">
              <div className="flex justify-between items-center">
                <h4 className="font-semibold">Select Representative Photo</h4>
                <div className="flex space-x-2">
                  {selectedMoment.representative_photo && (
                    <button
                      onClick={() => {
                        updateMoment(selectedMoment.id, { representative_photo: '' });
                        setShowPhotoSelector(false);
                      }}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1 rounded transition-colors"
                    >
                      Remove Photo
                    </button>
                  )}
                  <button onClick={() => setShowPhotoSelector(false)} className="text-gray-500 hover:text-gray-700">
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {(momentPhotosMap[selectedMoment.id] || []).map((img) => (
                  <div
                    key={img.name}
                    onClick={() => {
                      updateMoment(selectedMoment.id, { representative_photo: img.name });
                      setShowPhotoSelector(false);
                    }}
                    className="cursor-pointer border rounded-lg overflow-hidden hover:border-primary-500 transition-colors relative group"
                  >
                    <img
                      src={`/images/${img.name}`}
                      alt={img.name}
                      className="w-full h-24 object-cover"
                      loading="lazy"
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';
                      }}
                    />
                    <div className="p-2 text-xs text-gray-600 truncate">
                      {img.date_taken ? formatDateTime(img.date_taken) : img.name}
                    </div>
                    {selectedMoment.representative_photo === img.name && (
                      <div className="absolute top-2 right-2 bg-green-500 text-white text-xs px-1 py-0.5 rounded">
                        Current
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}


    </motion.div>
  );
}

export default EditMomentsModal; 