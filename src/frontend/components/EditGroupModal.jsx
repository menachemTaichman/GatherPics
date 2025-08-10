import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, User, Image, Edit, Check, AlertTriangle } from 'lucide-react';
import { groupsAPI, handleAPIError } from '../utils/apiService';

export default function EditGroupModal({ group, onClose, onSave, onRefreshGroups, onNameConflict }) {
  const [formData, setFormData] = useState({
    label: group.label || '',
    face_representative: group.face_representative
  });
  const [loading, setLoading] = useState(false);
  const [cropMappings, setCropMappings] = useState({});
  const [cropsLoading, setCropsLoading] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState('');
  // Use original group data for header display until saved
  const [displayData, setDisplayData] = useState({
    label: group.label || '',
    face_representative: group.face_representative
  });

  // Simple conflict state for inline validation
  const [nameConflict, setNameConflict] = useState(null);
  
  // Track current selection state for visual feedback
  const currentSelectionRef = useRef(group.face_representative);
  const [currentSelection, setCurrentSelection] = useState(currentSelectionRef.current);
  
  // Update the ref when currentSelection changes
  useEffect(() => {
    currentSelectionRef.current = currentSelection;
  }, [currentSelection]);

  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';
  const FIXED_EVENT_ID = "75cb6635-879d-4386-b023-366444dc0fb2";

  // Inline SVG placeholder (gray background with a question mark)
  const PLACEHOLDER_DATA_URL =
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';

  const handleImageError = (e) => {
    e.target.src = PLACEHOLDER_DATA_URL; // Fallback image
  };

  // Fetch crop mappings for all images in the group
  useEffect(() => {
    const fetchCropMappings = async () => {
      try {
        setCropsLoading(true);
        const response = await groupsAPI.getCrops(group.groupID);
        setCropMappings(response.crops || {});
        
        // After loading crop mappings, check if we need to set a default representative
        // if none is currently selected
        if (!currentSelection && response.crops) {
          // Find the first image that has a face ID
          const firstFaceId = Object.values(response.crops).find(faceId => faceId);
          if (firstFaceId) {
            setCurrentSelection(firstFaceId);
            setFormData(prev => ({ ...prev, face_representative: firstFaceId }));
          }
        }
      } catch (error) {
        console.error('Error fetching crop mappings:', error);
        const errorInfo = handleAPIError(error, 'Failed to fetch crop mappings');
        console.error(errorInfo.message);
      } finally {
        setCropsLoading(false);
      }
    };

    fetchCropMappings();
  }, [group.groupID]);

  // Add keyboard event listeners for modal shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (isEditingName) {
        // When editing name, don't handle ESC/Enter at document level
        // Let the input field handle them
        return;
      } else {
        // When not editing name, ESC and Enter should behave like modal shortcuts
        if (e.key === 'Escape') {
          onClose();
        } else if (e.key === 'Enter') {
          handleSubmit(e);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isEditingName, onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    // Use the ref value to ensure we have the latest selection
    const dataToSave = {
      ...formData,
      face_representative: currentSelectionRef.current
    };
    
    try {
      const result = await onSave(dataToSave);
      
      // Update display data only after successful save
      setDisplayData({
        label: formData.label,
        face_representative: currentSelectionRef.current
      });
      
      onClose();
    } catch (error) {
      console.error('Error saving group:', error);
      const errorInfo = handleAPIError(error, 'Failed to save group');
      alert(errorInfo.message);
    } finally {
      setLoading(false);
    }
  };

  const handleNameEdit = () => {
    setEditingName(displayData.label);
    setIsEditingName(true);
    setNameConflict(null); // Clear any previous conflict
  };

  const handleNameSave = async () => {
    if (editingName.trim()) {
      try {
        // Check for conflicts first - call the API directly to avoid state timing issues
        const conflictResult = await groupsAPI.checkName(editingName.trim(), group.groupID);
        
        if (conflictResult.conflict) {
          // Close this modal and pass conflict data to parent (FaceDetail)
          onClose();
          if (onNameConflict) {
            onNameConflict(editingName.trim(), conflictResult.conflicting_group);
          }
          return;
        }
        
        // No conflict, proceed with update
        setFormData(prev => ({ ...prev, label: editingName.trim() }));
        // Update display data immediately for name changes since they're saved immediately
        setDisplayData(prev => ({ ...prev, label: editingName.trim() }));
        
        setIsEditingName(false);
        setNameConflict(null);
      } catch (error) {
        console.error('Error checking name conflict:', error);
        // On error, just save the name and let the backend handle validation
        setFormData(prev => ({ ...prev, label: editingName.trim() }));
        setDisplayData(prev => ({ ...prev, label: editingName.trim() }));
        setIsEditingName(false);
        setNameConflict(null);
      }
    } else {
      setIsEditingName(false);
      setNameConflict(null);
    }
  };

  const handleNameCancel = () => {
    setIsEditingName(false);
    setNameConflict(null); // Clear conflict on cancel
  };

  const getRepresentativeImageSrc = () => {
    // Use displayData for header image - only changes after saving
    const representativeId = displayData.face_representative;
    const imageUrl = representativeId ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${representativeId}.webp` : PLACEHOLDER_DATA_URL;
    return imageUrl;
  };

  return (
    <>
      <AnimatePresence>
        <div 
          className="modal-overlay" 
          onClick={onClose}
        >
          <motion.div
            className="modal-content"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 rounded-full overflow-hidden border border-gray-200 shadow-lg">
                  <img
                    key={displayData.face_representative}
                    src={getRepresentativeImageSrc()}
                    alt="Representative"
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = PLACEHOLDER_DATA_URL;
                    }}
                  />
                </div>
                <div className="flex items-center space-x-2">
                  {isEditingName ? (
                    <div className="flex items-center space-x-2">
                      <div className="relative">
                        <input
                          type="text"
                          id="edit-group-name"
                          name="edit-group-name"
                          value={editingName}
                          onChange={(e) => {
                            setEditingName(e.target.value);
                            // Simple inline conflict check
                            if (e.target.value.trim()) {
                              groupsAPI.checkName(e.target.value.trim(), group.groupID)
                                .then(result => {
                                  setNameConflict(result.conflict ? result.conflicting_group : null);
                                })
                                .catch(() => setNameConflict(null));
                            } else {
                              setNameConflict(null);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation();
                              handleNameSave();
                            } else if (e.key === 'Escape') {
                              e.stopPropagation();
                              handleNameCancel();
                            }
                          }}
                          className={`text-xl font-semibold text-gray-900 bg-transparent border-b-2 focus:outline-none w-[150px] ${
                            nameConflict ? 'border-red-500' : 'border-primary-500'
                          }`}
                          autoFocus
                        />
                        {nameConflict && (
                          <div className="absolute top-full left-0 mt-1 flex items-center space-x-1 text-red-500 text-xs">
                            <AlertTriangle className="w-3 h-3" />
                            <span>Name already exists</span>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={handleNameSave}
                        className="p-1 hover:bg-green-100 rounded transition-colors"
                      >
                        <Check className="w-4 h-4 text-green-600" />
                      </button>
                      <button
                        onClick={handleNameCancel}
                        className="p-1 hover:bg-red-100 rounded transition-colors"
                      >
                        <X className="w-4 h-4 text-red-600" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2">
                      <h2 
                        className="text-xl font-semibold text-gray-900 cursor-pointer hover:text-primary-600 transition-colors w-[150px]"
                        onClick={handleNameEdit}
                      >
                        {displayData.label}
                      </h2>
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

            {/* Content */}
            <form onSubmit={handleSubmit} className="p-6">
              <div className="space-y-4">
                {/* Representative Photo Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Select Representative Photo
                  </label>
                  {cropsLoading ? (
                    <div className="grid grid-cols-6 gap-2 max-h-48 overflow-y-auto">
                      {group.image_ids?.map((imageId, index) => (
                        <div key={imageId} className="w-full h-16 bg-gray-200 rounded-lg animate-pulse" />
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-6 gap-2 max-h-48 overflow-y-auto">
                      {group.image_ids?.map((imageId, index) => {
                        const faceId = cropMappings[imageId];
                        const imageSrc = faceId 
                          ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${faceId}.webp`
                          : `${API_BASE}/api/events/${FIXED_EVENT_ID}/display/${imageId}.webp`;
                        
                        return (
                          <button
                            key={imageId}
                            type="button"
                            onClick={() => {
                              // Only set representative if faceId exists
                              if (faceId) {
                                setCurrentSelection(faceId);
                                setFormData(prev => ({
                                  ...prev,
                                  face_representative: faceId
                                }));
                              }
                            }}
                            className={`relative rounded-lg overflow-hidden border-2 transition-colors ${
                              currentSelection === faceId
                                ? 'border-primary-500'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                            data-selected={currentSelection === faceId}
                            data-faceid={faceId}
                            data-currentselection={currentSelection}
                          >
                            <img
                              src={imageSrc}
                              alt={`Photo ${index + 1}`}
                              className="w-full h-16 object-cover"
                              loading="lazy"
                              onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = PLACEHOLDER_DATA_URL;
                              }}
                            />
                            {currentSelection === faceId && faceId && (
                              <div className="absolute inset-0 bg-primary-500 bg-opacity-20 flex items-center justify-center">
                                <div className="w-4 h-4 bg-primary-500 rounded-full flex items-center justify-center">
                                  <Image className="w-2 h-2 text-white" />
                                </div>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end space-x-3 pt-6 border-t border-gray-200">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary flex items-center space-x-2"
                  disabled={loading}
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{loading ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      </AnimatePresence>

    </>
  );
} 