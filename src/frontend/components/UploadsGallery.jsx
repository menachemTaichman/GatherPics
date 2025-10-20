import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Upload, Eye, Trash2, Edit2, Save, RotateCcw, ArrowUp, ArrowDown, Plus } from 'lucide-react';
import { uploadsAPI, imagesAPI } from '../utils/apiService';
import { useToast } from '../utils/ToastContext';
import { useUploadsList } from '../utils/dataManager';
import { useApplyScopes } from '../utils/storeUtils';
import { sortUploads } from '../utils/sorting';
import { getPreference, setPreference } from '../utils/settings';
import { formatErrorMessage } from '../utils/errorHandler';
import ConfirmDelete from './ConfirmDelete';
import UploadImagesModal from './UploadImagesModal';
import { useAuth } from '../utils/authContext';
import { useAuthRefresh } from '../utils/useAuthRefresh';

function formatDateTime(dateString) {
  if (!dateString) return 'N/A';
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

export default function UploadsGallery({ eventUrl, urlHelpers }) {
  const { isAuthenticated } = useAuth();
  const [sortBy, setSortBy] = useState(() => getPreference('UploadsGallery.sortBy', 'started_at'));
  const [sortDir, setSortDir] = useState(() => getPreference('UploadsGallery.sortDir', 'desc'));
  const [editingNotes, setEditingNotes] = useState(null);
  const [notesValue, setNotesValue] = useState('');
  const [deleteUpload, setDeleteUpload] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadLimits, setUploadLimits] = useState(null);
  
  const navigate = useNavigate();
  const { showToast } = useToast();

  useApplyScopes([{ entity: 'all', id: 'uploads' }]);

  const storeUploads = useUploadsList();

  // Create placeholder uploads when not authenticated
  const placeholderUploads = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => ({
      id: `placeholder-${i}`,
      started_at: null,
      profile_label: '',
      images_count: 0,
      faces_count: 0,
      clusters_count: 0,
      status: '',
      notes: '',
      isPlaceholder: true
    }));
  }, []);

  // Use uploads from store or placeholders when not authenticated
  const currentUploads = isAuthenticated ? storeUploads : placeholderUploads;

  const fetchUploads = useCallback(async () => {
    if (!eventUrl) return;
    try {
      await uploadsAPI.getAll(eventUrl);
    } catch (error) {
      console.error('Failed to fetch uploads:', error);
      showToast(formatErrorMessage('fetch uploads', error), 'error');
    }
  }, [eventUrl, showToast]);

  const fetchUploadLimits = useCallback(async () => {
    if (!eventUrl) return;
    try {
      const limits = await imagesAPI.getUploadLimits(eventUrl);
      setUploadLimits(limits);
    } catch (error) {
      console.error('Failed to fetch upload limits:', error);
    }
  }, [eventUrl]);

  useAuthRefresh(fetchUploads, [eventUrl]);

  useEffect(() => {
    if (eventUrl && isAuthenticated) {
      fetchUploadLimits();
    }
  }, [eventUrl, isAuthenticated, fetchUploadLimits]);

  const sortedUploads = useMemo(() => {
    // Skip sorting for placeholders
    if (!isAuthenticated) return currentUploads;
    return sortUploads(currentUploads, sortBy, sortDir);
  }, [currentUploads, sortBy, sortDir, isAuthenticated]);

  const handleSort = (field) => {
    if (sortBy === field) {
      const newDir = sortDir === 'asc' ? 'desc' : 'asc';
      setSortDir(newDir);
      setPreference('UploadsGallery.sortDir', newDir);
    } else {
      setSortBy(field);
      setPreference('UploadsGallery.sortBy', field);
    }
  };

  const handleEditNotes = (upload) => {
    setEditingNotes(upload.id);
    setNotesValue(upload.notes || '');
  };

  const handleSaveNotes = async (uploadId) => {
    try {
      await uploadsAPI.update(uploadId, { notes: notesValue }, eventUrl);
      showToast('Notes updated', 'success');
      setEditingNotes(null);
      setNotesValue('');
    } catch (error) {
      console.error('Failed to update notes:', error);
      showToast(formatErrorMessage('update notes', error), 'error');
    }
  };

  const handleCancelEditNotes = () => {
    setEditingNotes(null);
    setNotesValue('');
  };

  const handleDeleteConfirm = async () => {
    if (!deleteUpload) return;
    
    try {
      await uploadsAPI.delete(deleteUpload.id, eventUrl);
      showToast('Upload deleted', 'success');
      setDeleteUpload(null);
    } catch (error) {
      console.error('Failed to delete upload:', error);
      showToast(formatErrorMessage('delete upload', error), 'error');
    }
  };

  const getSortIcon = (field) => {
    if (sortBy !== field) return null;
    return sortDir === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />;
  };

  const handleUploadComplete = async (result) => {
    // Refresh upload limits and uploads list after successful upload
    await fetchUploadLimits();
    await fetchUploads();
  };

  const handleUploadSuccess = (uploadId) => {
    // Navigate to the upload detail page
    navigate(`/${eventUrl}/uploads/${uploadId}`);
  };

  return (
    <>
      <div className="w-full">
        {/* Sticky Header */}
        <div className="sticky top-16 z-30 bg-white border-b border-gray-200 px-8 py-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                Uploads History
              </h1>
              <p className="text-gray-600">
                {sortedUploads.length === 0 
                  ? 'No uploads yet'
                  : `${sortedUploads.length} upload${sortedUploads.length !== 1 ? 's' : ''}`
                }
              </p>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="px-8 py-8">
          {sortedUploads.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12"
            >
              <Upload className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No uploads yet</h3>
              <p className="text-gray-500">
                Upload some photos to get started
              </p>
            </motion.div>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          ID
                        </th>
                        <th
                          onClick={() => handleSort('started_at')}
                          className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-50"
                        >
                          <div className="flex items-center space-x-1">
                            <span>Started</span>
                            {getSortIcon('started_at')}
                          </div>
                        </th>
                        <th
                          onClick={() => handleSort('profile_label')}
                          className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-50"
                        >
                          <div className="flex items-center space-x-1">
                            <span>Profile</span>
                            {getSortIcon('profile_label')}
                          </div>
                        </th>
                          <th
                            onClick={() => handleSort('images_count')}
                            className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-50"
                          >
                            <div className="flex items-center justify-center space-x-1">
                              <span>Images</span>
                              {getSortIcon('images_count')}
                            </div>
                          </th>
                          <th
                            onClick={() => handleSort('faces_count')}
                            className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-50"
                          >
                            <div className="flex items-center justify-center space-x-1">
                              <span>Faces</span>
                              {getSortIcon('faces_count')}
                            </div>
                          </th>
                          <th
                            onClick={() => handleSort('clusters_count')}
                            className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-50"
                          >
                            <div className="flex items-center justify-center space-x-1">
                              <span>Groups</span>
                              {getSortIcon('clusters_count')}
                            </div>
                          </th>
                          <th
                            onClick={() => handleSort('status')}
                            className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-50"
                          >
                            <div className="flex items-center space-x-1">
                              <span>Status</span>
                              {getSortIcon('status')}
                            </div>
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                            Notes
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-600 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {sortedUploads.map((upload) => (
                        <tr key={upload.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-xs text-gray-500 font-mono">
                            {upload.id}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {formatDateTime(upload.started_at)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {upload.profile_label || 'Unknown'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 text-center">
                            {upload.images_count || 0}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 text-center">
                            {upload.faces_count || 0}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 text-center">
                            {upload.clusters_count || 0}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                              upload.status === 'completed' 
                                ? 'bg-green-100 text-green-800' 
                                : upload.status === 'failed'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}>
                              {upload.status || 'unknown'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {editingNotes === upload.id ? (
                              <div className="flex items-center space-x-2">
                                <input
                                  type="text"
                                  value={notesValue}
                                  onChange={(e) => setNotesValue(e.target.value)}
                                  className="flex-1 border rounded px-2 py-1 text-sm"
                                  placeholder="Add notes..."
                                  autoFocus
                                />
                                <button
                                  onClick={() => handleSaveNotes(upload.id)}
                                  className="p-1 hover:bg-green-100 rounded transition-colors"
                                  title="Save"
                                >
                                  <Save className="w-4 h-4 text-green-600" />
                                </button>
                                <button
                                  onClick={handleCancelEditNotes}
                                  className="p-1 hover:bg-red-100 rounded transition-colors"
                                  title="Cancel"
                                >
                                  <RotateCcw className="w-4 h-4 text-red-600" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center space-x-2">
                                <span className="flex-1 truncate max-w-xs">
                                  {upload.notes || <span className="text-gray-400 italic">No notes</span>}
                                </span>
                                <button
                                  onClick={() => handleEditNotes(upload)}
                                  className="p-1 hover:bg-blue-100 rounded transition-colors opacity-0 group-hover:opacity-100"
                                  title="Edit notes"
                                >
                                  <Edit2 className="w-4 h-4 text-blue-600" />
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-right">
                            <div className="flex items-center justify-end space-x-2">
                              <button
                                onClick={() => navigate(`/${eventUrl}/uploads/${upload.id}`)}
                                className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                title="View upload"
                              >
                                <Eye className="w-4 h-4 text-blue-600" />
                              </button>
                              <button
                                onClick={() => setDeleteUpload(upload)}
                                className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                title="Delete upload"
                              >
                                <Trash2 className="w-4 h-4 text-red-600" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              
              {/* Note about data changes */}
              <div className="mt-4 text-xs text-gray-500 italic text-center">
                Note: Data may have changed since these uploads were created
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteUpload && (
        <ConfirmDelete
          isOpen={!!deleteUpload}
          onClose={() => setDeleteUpload(null)}
          onConfirm={handleDeleteConfirm}
          title="Delete Upload"
          message="Are you sure you want to delete this upload?"
          simpleMessage={true}
          confirmText="Delete"
          cancelText="Cancel"
          caption="This action cannot be undone. The upload record will be deleted, but the images will remain."
        />
      )}

      {/* Upload Images Modal */}
      {showUploadModal && (
        <UploadImagesModal
          isOpen={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          eventUrl={eventUrl}
          uploadLimits={uploadLimits}
          onUploadComplete={handleUploadComplete}
          onUploadSuccess={handleUploadSuccess}
        />
      )}

      {/* Floating Upload Button */}
      <div className="fixed bottom-8 right-8 z-40">
        <motion.button
          onClick={() => setShowUploadModal(true)}
          className="w-16 h-16 bg-gradient-to-br from-purple-500 via-blue-500 to-indigo-600 hover:from-purple-600 hover:via-blue-600 hover:to-indigo-700 text-white rounded-full shadow-lg hover:shadow-2xl transition-all duration-200 flex items-center justify-center group"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          title="Upload new photos"
        >
          <Plus className="w-8 h-8" />
        </motion.button>
      </div>
    </>
  );
}

