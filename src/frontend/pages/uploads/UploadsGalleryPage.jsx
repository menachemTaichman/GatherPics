import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
import { Upload, Trash2, Plus, ArrowLeft, ArrowRight } from 'lucide-react';
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
import { ScrollableTable, LongPressHoverButton } from '../../components/common';
import { formatDateTimeLocale } from '../../utils/dateUtils';

export default function UploadsGallery({ eventUrl, urlHelpers }) {
  const { isAuthenticated } = useAuth();
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  const eventId = useEventId(eventUrl);
  const [sortBy, setSortBy] = useState(() => getPreference('UploadsGallery.sortBy', 'started_at'));
  const [sortDir, setSortDir] = useState(() => getPreference('UploadsGallery.sortDir', 'desc'));
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
      groups_count: 0,
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

  // Ensure page starts at top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [eventUrl]);

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

  const handleDeleteConfirm = async () => {
    if (!deleteUpload) return;
    
    try {
      await uploadsAPI.delete(deleteUpload.id, eventUrl);
      showToast(t('uploadsGallery.uploadDeleted'), 'success');
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
      <div className={`${!eventUrl ? 'min-h-screen' : ''} bg-gray-50 overflow-x-hidden`} dir={isRTL ? 'rtl' : 'ltr'} style={{ margin: 0, padding: 0 }}>
        {eventUrl && <div className="h-[4rem]"></div>}
        {/* Sticky Header */}
        <div className={`sticky ${eventUrl ? 'top-[4rem]' : 'top-0'} z-30 bg-white border-b border-gray-200 shadow-sm`}>
          <div className="w-full px-4 sm:px-8 py-2 sm:py-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-3 sm:mb-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-shrink-0">
                {eventUrl && (
                  <Link
                    to={`/${eventUrl}`}
                    className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                    title={t('uploadsGallery.backToEvent')}
                    aria-label={t('uploadsGallery.backToEvent')}
                  >
                    {isRTL ? (
                      <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                    ) : (
                      <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                    )}
                  </Link>
                )}
                <div className="w-8 h-8 sm:w-12 sm:h-12 bg-purple-100 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0">
                  <Upload className="w-4 h-4 sm:w-6 sm:h-6 text-purple-600" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-2xl font-bold text-gray-900 truncate">{t('uploadsGallery.uploadsHistory')}</h1>
                  <p className="text-xs sm:text-sm text-gray-500 truncate">
                    {sortedUploads.length === 0 
                      ? t('uploadsGallery.noUploadsYet')
                      : `${sortedUploads.length} ${sortedUploads.length === 1 ? t('uploadsGallery.upload') : t('uploadsGallery.uploadsPlural')}`
                    }
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="px-4 sm:px-8 py-3 sm:py-8 overflow-x-auto">
          {sortedUploads.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12"
            >
              <Upload className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">{t('uploadsGallery.noUploadsYet')}</h3>
              <p className="text-gray-500">
                {t('uploadsGallery.uploadSomePhotosToGetStarted')}
              </p>
            </motion.div>
          ) : (
            <>
              <ScrollableTable
                style={{ maxHeight: 'calc(100vh - 20rem)' }}
                onRowClick={(upload) => {
                  navigate(`/${eventUrl}/uploads/${upload.id}`);
                }}
                columns={[
                  {
                    key: 'id',
                    label: t('uploadsGallery.id'),
                    align: 'left',
                    cellClassName: 'text-xs text-gray-500 font-mono',
                    renderCell: (upload) => upload.id,
                  },
                  {
                    key: 'started_at',
                    label: t('uploadsGallery.started'),
                    sortable: true,
                    align: 'left',
                    cellClassName: 'text-gray-900',
                    renderCell: (upload) => formatDateTimeLocale(upload.started_at),
                  },
                  {
                    key: 'profile_label',
                    label: t('uploadsGallery.profile'),
                    sortable: true,
                    align: 'left',
                    cellClassName: 'text-gray-700',
                    renderCell: (upload) => upload.profile_label || t('uploadsGallery.unknown'),
                  },
                  {
                    key: 'images_count',
                    label: t('uploadsGallery.images'),
                    sortable: true,
                    align: 'center',
                    cellClassName: 'text-gray-700',
                    renderCell: (upload) => upload.images_count || 0,
                  },
                  {
                    key: 'faces_count',
                    label: t('uploadsGallery.faces'),
                    sortable: true,
                    align: 'center',
                    cellClassName: 'text-gray-700',
                    renderCell: (upload) => upload.faces_count || 0,
                  },
                  {
                    key: 'groups_count',
                    label: t('uploadsGallery.groups'),
                    sortable: true,
                    align: 'center',
                    cellClassName: 'text-gray-700',
                    renderCell: (upload) => upload.groups_count || 0,
                  },
                  {
                    key: 'status',
                    label: t('uploadsGallery.status'),
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
                        {upload.status || t('uploadsGallery.unknown')}
                      </span>
                    ),
                  },
                  {
                    key: 'notes',
                    label: t('uploadsGallery.notes'),
                    align: 'left',
                    cellClassName: 'text-gray-700',
                    renderCell: (upload) => (
                      <span className="truncate max-w-xs">
                        {upload.notes || <span className="text-gray-400 italic">{t('uploadsGallery.noNotes')}</span>}
                      </span>
                    ),
                  },
                  {
                    key: 'actions',
                    label: t('uploadsGallery.actions'),
                    align: 'right',
                    renderCell: (upload) => (
                      <div className="flex items-center justify-end gap-2">
                        {upload.is_deletable !== false && (
                          <LongPressHoverButton
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteUpload(upload);
                            }}
                            className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                            title={t('uploadsGallery.deleteUpload')}
                            aria-label={t('uploadsGallery.deleteUpload')}
                          >
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </LongPressHoverButton>
                        )}
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
                  title: t('uploadsGallery.noUploadsYet'),
                  message: t('uploadsGallery.uploadSomePhotosToGetStarted'),
                }}
                getRowKey={(upload) => upload.id}
              />
              
              {/* Note about data changes */}
              <div className="mt-4 text-xs text-gray-500 italic text-center">
                {t('uploadsGallery.dataMayHaveChanged')}
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
          title={t('uploadsGallery.deleteUploadTitle')}
          message={t('uploadsGallery.deleteUploadMessage')}
          simpleMessage={true}
          confirmText={t('account.delete')}
          cancelText={t('account.cancel')}
          caption={t('uploadsGallery.deleteUploadCaption')}
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
      <div className="fixed bottom-4 right-4 sm:bottom-8 sm:right-8 z-40">
        <motion.button
          onClick={() => setShowUploadModal(true)}
          className="w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-purple-500 via-blue-500 to-indigo-600 hover:from-purple-600 hover:via-blue-600 hover:to-indigo-700 text-white rounded-full shadow-lg hover:shadow-2xl transition-all duration-200 flex items-center justify-center group"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          title={t('uploadsGallery.uploadNewPhotos')}
          aria-label={t('uploadsGallery.uploadNewPhotos')}
        >
          <Plus className="w-6 h-6 sm:w-8 sm:h-8" />
        </motion.button>
      </div>
    </>
  );
}




