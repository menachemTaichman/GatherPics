import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, Eye, Trash2, Edit2, Save, RotateCcw, ArrowUp, ArrowDown } from 'lucide-react';
import { useModalFocus } from '../utils/useModalFocus';
import { useModalManager } from '../utils/modalManager';
import { uploadsAPI } from '../utils/apiService';
import { useToast } from '../utils/ToastContext';
import { useUploadsList } from '../utils/dataManager';
import { useApplyScopes } from '../utils/storeUtils';
import { sortUploads } from '../utils/sorting';
import { getPreference, setPreference } from '../utils/settings';
import { formatErrorMessage } from '../utils/errorHandler';
import ConfirmDelete from './ConfirmDelete';
import UploadDetail from './UploadDetail';

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

export default function UploadsGallery({ isOpen, onClose, eventUrl, urlHelpers }) {
  const [sortBy, setSortBy] = useState(() => getPreference('UploadsGallery.sortBy', 'started_at'));
  const [sortDir, setSortDir] = useState(() => getPreference('UploadsGallery.sortDir', 'desc'));
  const [editingNotes, setEditingNotes] = useState(null);
  const [notesValue, setNotesValue] = useState('');
  const [deleteUpload, setDeleteUpload] = useState(null);
  const [viewingUpload, setViewingUpload] = useState(null);
  
  const { showToast } = useToast();
  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'uploads-gallery';

  useApplyScopes(isOpen ? [{ entity: 'all', id: 'uploads' }] : []);

  useEffect(() => {
    if (isOpen) {
      registerModal({ 
        id: modalId, 
        type: 'popup',
        allowOutsideScroll: true,
        scopes: [{ entity: 'all', id: 'uploads' }]
      });
      
      const handleAuthLogout = () => {
        onClose();
      };
      window.addEventListener('auth:logout', handleAuthLogout);
      
      return () => {
        unregisterModal(modalId);
        window.removeEventListener('auth:logout', handleAuthLogout);
      };
    }
  }, [isOpen, registerModal, unregisterModal]);

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId: modalId,
    modalType: 'popup',
    allowOutsideScroll: true
  });

  const storeUploads = useUploadsList();

  useEffect(() => {
    if (isOpen && eventUrl) {
      fetchUploads();
    }
  }, [isOpen, eventUrl]);

  const fetchUploads = async () => {
    try {
      await uploadsAPI.getAll(eventUrl);
    } catch (error) {
      console.error('Failed to fetch uploads:', error);
      showToast(formatErrorMessage('fetch uploads', error), 'error');
    }
  };

  const sortedUploads = useMemo(() => {
    return sortUploads(storeUploads, sortBy, sortDir);
  }, [storeUploads, sortBy, sortDir]);

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

  return (
    <>
      <AnimatePresence>
        {isOpen && !viewingUpload && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <motion.div
              ref={modalRef}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                    <Upload className="w-5 h-5 text-primary-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">Uploads History</h2>
                    <p className="text-sm text-gray-500">View all your uploads</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {sortedUploads.length === 0 ? (
                  <div className="text-center py-12">
                    <Upload className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">No uploads yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-200">
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
                                  onClick={() => setViewingUpload(upload.id)}
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
                )}
                
                {/* Note about data changes */}
                <div className="mt-4 text-xs text-gray-500 italic text-center">
                  Note: Data may have changed since these uploads were created
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                <div className="flex justify-end">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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

      {/* Upload Detail Modal */}
      {viewingUpload && (
        <UploadDetail
          uploadId={viewingUpload}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
          onClose={() => setViewingUpload(null)}
        />
      )}
    </>
  );
}

