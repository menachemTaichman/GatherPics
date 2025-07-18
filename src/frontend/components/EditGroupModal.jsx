import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, User, Image } from 'lucide-react';

export default function EditGroupModal({ group, onClose, onSave }) {
  const [formData, setFormData] = useState({
    label: group.label || `Person_${group.groupID}`,
    face_representive: group.face_representive
  });
  const [loading, setLoading] = useState(false);
  const [cropMappings, setCropMappings] = useState({});
  const [cropsLoading, setCropsLoading] = useState(true);

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
          // Create mapping from face_id to face_id for crops
          const cropMapping = {};
          data.face_ids.forEach(faceId => {
            cropMapping[faceId] = faceId; // face_id is the filename
          });
          setCropMappings(cropMapping);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      await onSave(formData);
    } catch (error) {
      console.error('Error saving group:', error);
      alert('Failed to save changes. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="modal-overlay" onClick={onClose}>
        <motion.div
          className="modal-content"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                <User className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  Edit Face Group
                </h2>
                <p className="text-sm text-gray-500">
                  Update the name and representative photo
                </p>
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
            <div className="space-y-6">
              {/* Current Representative Photo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Current Representative Photo
                </label>
                <div className="w-32 h-32 rounded-lg overflow-hidden border border-gray-200">
                  <img
                    src={group.face_representive
                      ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/display/${group.face_representive}.jpg`
                      : PLACEHOLDER_DATA_URL}
                    alt="Representative"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.src = PLACEHOLDER_DATA_URL;
                    }}
                  />
                </div>
              </div>

              {/* Name Input */}
              <div>
                <label htmlFor="label" className="block text-sm font-medium text-gray-700 mb-2">
                  Group Name
                </label>
                <input
                  type="text"
                  id="label"
                  value={formData.label}
                  onChange={(e) => setFormData(prev => ({ ...prev, label: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Enter group name..."
                  required
                />
              </div>

              {/* Representative Photo Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Select Representative Photo
                </label>
                {cropsLoading ? (
                  <div className="grid grid-cols-4 gap-3 max-h-48 overflow-y-auto">
                    {group.face_IDs?.map((faceId, index) => (
                      <div key={faceId} className="w-full h-20 bg-gray-200 rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-3 max-h-48 overflow-y-auto">
                    {group.face_IDs?.map((faceId, index) => {
                      const imageSrc = `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${faceId}.jpg`;
                      
                      return (
                        <button
                          key={faceId}
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, face_representive: faceId }))}
                          className={`relative rounded-lg overflow-hidden border-2 transition-colors ${
                            formData.face_representive === faceId
                              ? 'border-primary-500'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <img
                            src={imageSrc}
                            alt={`Face ${index + 1}`}
                            className="w-full h-20 object-cover"
                            onError={(e) => {
                              e.target.src = PLACEHOLDER_DATA_URL;
                            }}
                          />
                          {formData.face_representive === faceId && (
                            <div className="absolute inset-0 bg-primary-500 bg-opacity-20 flex items-center justify-center">
                              <div className="w-6 h-6 bg-primary-500 rounded-full flex items-center justify-center">
                                <Image className="w-3 h-3 text-white" />
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