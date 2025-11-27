import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Upload, Eye, Trash2, Edit2, Save, RotateCcw, Plus } from 'lucide-react';
import { uploadsAPI } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { useUploadsList } from '../../utils/dataManager';
import { useApplyScopes, useEventId } from '../../utils/storeUtils';
import { sortUploads } from '../../utils/sorting';
import { getPreference, setPreference } from '../../utils/settings';
import { formatErrorMessage } from '../../utils/errorHandler';
import { ConfirmDelete } from '../../components/modals';
import { UploadFormModal } from '../../components/uploads';
import { useAuth } from '../../contexts/authContext';
import { useAuthRefresh } from '../../hooks/useAuthRefresh';
import { ScrollableTable } from '../../components/common';
import { formatDateTimeLocale } from '../../utils/dateUtils';

export default function UploadsGallery({ eventUrl, urlHelpers }) {
  const { isAuthenticated } = useAuth();
  const eventId = useEventId(eventUrl);
  const [sortBy, setSortBy] = useState(() => getPreference('UploadsGallery.sortBy', 'started_at'));
  const [sortDir, setSortDir] = useState(() => getPreference('UploadsGallery.sortDir', 'desc'));
  const [editingNotes, setEditingNotes] = useState(null);
  const [notesValue, setNotesValue] = useState('');
  const [deleteUpload, setDeleteUpload] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  
  const navigate = useNavigate();
  const { showToast } = useToast();

  useApplyScopes([{ entity: 'all', id: 'uploads', eventId }]);

  const storeUploads = useUploadsList(eventId);

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

  useAuthRefresh(fetchUploads, [eventUrl]);

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


  const handleUploadComplete = async (result) => {
    // Refresh uploads list after successful upload
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
        <div className="sticky top-[4rem] z-30 bg-white border-b border-gray-200 shadow-sm">
          <div className="w-full px-8 py-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                  <Upload className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Uploads History</h1>
                  <p className="text-sm text-gray-500">
                    {sortedUploads.length === 0 
                      ? 'No uploads yet'
                      : `${sortedUploads.length} upload${sortedUploads.length !== 1 ? 's' : ''}`
                    }
                  </p>
                </div>
              </div>
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
              <ScrollableTable
                columns={[
                  {
                    key: 'id',
                    label: 'ID',
                    align: 'left',
                    cellClassName: 'text-xs text-gray-500 font-mono',
                    renderCell: (upload) => upload.id,
                  },
                  {
                    key: 'started_at',
                    label: 'Started',
                    sortable: true,
                    align: 'left',
                    cellClassName: 'text-gray-900',
                    renderCell: (upload) => formatDateTimeLocale(upload.started_at),
                  },
                  {
                    key: 'profile_label',
                    label: 'Profile',
                    sortable: true,
                    align: 'left',
                    cellClassName: 'text-gray-700',
                    renderCell: (upload) => upload.profile_label || 'Unknown',
                  },
                  {
                    key: 'images_count',
                    label: 'Images',
                    sortable: true,
                    align: 'center',
                    cellClassName: 'text-gray-700',
                    renderCell: (upload) => upload.images_count || 0,
                  },
                  {
                    key: 'faces_count',
                    label: 'Faces',
                    sortable: true,
                    align: 'center',
                    cellClassName: 'text-gray-700',
                    renderCell: (upload) => upload.faces_count || 0,
                  },
                  {
                    key: 'clusters_count',
                    label: 'Groups',
                    sortable: true,
                    align: 'center',
                    cellClassName: 'text-gray-700',
                    renderCell: (upload) => upload.clusters_count || 0,
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    sortable: true,
                    align: 'left',
                    renderCell: (upload) => (
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                        upload.status === 'completed' 
                          ? 'bg-green-100 text-green-800' 
                          : upload.status === 'failed'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {upload.status || 'unknown'}
                      </span>
                    ),
                  },
                  {
                    key: 'notes',
                    label: 'Notes',
                    align: 'left',
                    cellClassName: 'text-gray-700',
                    renderCell: (upload) =>
                      editingNotes === upload.id ? (
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
                        <div className="flex items-center space-x-2 group">
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
                      ),
                  },
                  {
                    key: 'actions',
                    label: 'Actions',
                    align: 'right',
                    renderCell: (upload) => (
                      <div className="flex items-center justify-end space-x-2">
                        <Link
                          to={`/${eventUrl}/uploads/${upload.id}`}
                          className="p-2 hover:bg-blue-100 rounded-lg transition-colors inline-flex"
                          title="View upload"
                        >
                          <Eye className="w-4 h-4 text-blue-600" />
                        </Link>
                        <button
                          onClick={() => setDeleteUpload(upload)}
                          className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                          title="Delete upload"
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </button>
                      </div>
                    ),
                  },
                ]}
                data={sortedUploads}
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
                emptyState={{
                  icon: Upload,
                  title: 'No uploads yet',
                  message: 'Upload some photos to get started',
                }}
                getRowKey={(upload) => upload.id}
              />
              
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
        <UploadFormModal
          isOpen={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          eventUrl={eventUrl}
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




