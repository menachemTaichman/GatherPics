import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, User, Image, Edit, Check } from 'lucide-react';

export default function EditGroupModal({ group, onClose, onSave }) {
  const [formData, setFormData] = useState({
    label: group.label || `Person_${group.groupID}`,
    face_representive: group.face_representive
  });
  const [loading, setLoading] = useState(false);
  const [cropMappings, setCropMappings] = useState({});
  const [cropsLoading, setCropsLoading] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState('');

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
        const response = await fetch(`${API_BASE}/api/groups/${group.groupID}/crops`);
        if (response.ok) {
          const data = await response.json();
          setCropMappings(data.crop_mapping || {});
        } else {
          console.error('Failed to fetch crop mappings');
        }
      } catch (error) {
        console.error('Error fetching crop mappings:', error);
      } finally {
        setCropsLoading(false);
      }
    };

    fetchCropMappings();
  }, [group.groupID, API_BASE]);

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
    
    try {
      await onSave(formData);
      
      // Update the URL to reflect the new group name if it changed
      if (formData.label !== group.label) {
        const newUrl = `/${encodeURIComponent(formData.label)}`;
        window.history.replaceState(null, '', newUrl);
      }
    } catch (error) {
      console.error('Error saving group:', error);
      alert('Failed to save changes. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleNameEdit = () => {
    setEditingName(formData.label);
    setIsEditingName(true);
  };

  const handleNameSave = () => {
    if (editingName.trim()) {
      setFormData(prev => ({ ...prev, label: editingName.trim() }));
    }
    setIsEditingName(false);
  };

  const handleNameCancel = () => {
    setIsEditingName(false);
  };

  const getRepresentativeImageSrc = () => {
    if (!formData.face_representive) return PLACEHOLDER_DATA_URL;
    
    // Always use faces endpoint for representative images
    return `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${formData.face_representive}.webp`;
  };

  return (
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
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.stopPropagation();
                          handleNameSave();
                        } else if (e.key === 'Escape') {
                          e.stopPropagation();
                          handleNameCancel();
                        }
                      }}
                      className="text-xl font-semibold text-gray-900 bg-transparent border-b-2 border-primary-500 focus:outline-none w-[150px]"
                      autoFocus
                    />
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
                      {formData.label}
                    </h2>
                    <button
                      onClick={handleNameEdit}
                      className="p-1 hover:bg-gray-100 rounded transition-colors"
                      title="Edit group name"
                    >
                      <Edit className="w-4 h-4 text-gray-500" />
                    </button>
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
                          onClick={() => setFormData(prev => ({ ...prev, face_representive: faceId || imageId }))}
                          className={`relative rounded-lg overflow-hidden border-2 transition-colors ${
                            formData.face_representive === (faceId || imageId)
                              ? 'border-primary-500'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
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
                          {formData.face_representive === (faceId || imageId) && (
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
  );
} 