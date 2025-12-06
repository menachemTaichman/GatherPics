import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
import { FileText, Eye, Trash2, CheckCircle, XCircle, Clock, AlertCircle, Trash } from 'lucide-react';
import { requestsAPI } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { useRequestsList } from '../../utils/dataManager';
import { useApplyScopes, useEventId } from '../../utils/storeUtils';
import { getPreference, setPreference } from '../../utils/settings';
import { formatErrorMessage } from '../../utils/errorHandler';
import { ConfirmDelete } from '../../components/modals';
import { RequestDetailModal } from '../../components/requests';
import { useAuth } from '../../contexts/authContext';
import { useAuthRefresh } from '../../hooks/useAuthRefresh';
import useRequestViewerController from '../../hooks/useRequestViewerController';
import { ScrollableTable } from '../../components/common';
import { formatDateTimeLocale } from '../../utils/dateUtils';

function getRequestStatus(request) {
  const status = request.status || 'pending';
  
  const statusConfig = {
    pending: { status: 'pending', color: 'blue', icon: Clock },
    approved: { status: 'approved', color: 'green', icon: CheckCircle },
    rejected: { status: 'rejected', color: 'red', icon: XCircle },
    mixed: { status: 'mixed', color: 'yellow', icon: AlertCircle }
  };
  
  return statusConfig[status] || statusConfig.pending;
}

export default function RequestsGalleryPage({ eventUrl, urlHelpers }) {
  const { isAuthenticated } = useAuth();
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  const eventId = useEventId(eventUrl);
  const [deleteRequest, setDeleteRequest] = useState(null);
  const [deleteAll, setDeleteAll] = useState(false);
  const [sortBy, setSortBy] = useState(() => getPreference('RequestsGallery.sortBy', 'requested_at'));
  const [sortDir, setSortDir] = useState(() => getPreference('RequestsGallery.sortDir', 'desc'));
  const [filterStatus, setFilterStatus] = useState(() => getPreference('RequestsGallery.filterStatus', 'all'));
  
  const navigate = useNavigate();
  const { showToast } = useToast();
  
  // Initialize Request Viewer controller
  const { isOpen: viewerOpen, open: openViewer, viewerProps } = useRequestViewerController({
    showToast,
    defaultSortBy: sortBy,
    defaultSortOrder: sortDir,
    filterStatus: filterStatus,
  });

  useApplyScopes([{ entity: 'all', id: 'access_requests', eventId }]);

  const storeRequests = useRequestsList(eventId);

  // Create placeholder requests when not authenticated
  const placeholderRequests = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => ({
      access_request_id: `placeholder-${i}`,
      applicant_name: '',
      requested_at: null,
      groups_count: 0,
      groups_approved_count: 0,
      is_closed: false,
      isPlaceholder: true
    }));
  }, []);

  // Fetch requests data with auto-refresh on auth changes
  const loadRequests = useCallback(async () => {
    if (!eventUrl) return;
    try {
      await requestsAPI.getAll(eventUrl);
    } catch (e) {
      console.error('Failed to load requests', e);
    }
  }, [eventUrl]);
  
  useAuthRefresh(loadRequests, [eventUrl]);

  // Ensure page starts at top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [eventUrl]);

  // Use requests from store or placeholders when not authenticated
  const currentRequests = isAuthenticated ? storeRequests : placeholderRequests;

  const handleViewRequest = (request, index) => {
    // Find the index in the sorted array to ensure correct navigation
    const requestId = request.access_request_id || request.id;
    const actualIndex = sortedRequests.findIndex(r => (r.access_request_id || r.id) === requestId);
    const finalIndex = actualIndex >= 0 ? actualIndex : (index >= 0 ? index : 0);
    
    openViewer({
      index: finalIndex,
      sortBy,
      sortOrder: sortDir,
      filterStatus,
    });
  };

  const handleDeleteRequest = (request) => {
    setDeleteRequest(request);
  };

  const handleConfirmDelete = async () => {
    if (!deleteRequest) return;

    try {
      const requestId = deleteRequest.access_request_id || deleteRequest.id;
      await requestsAPI.delete(requestId, eventUrl);
      showToast(t('requestsGallery.requestDeletedSuccessfully'), 'success');
    } catch (error) {
      console.error('Failed to delete request:', error);
      showToast(formatErrorMessage('delete request', error), 'error');
    } finally {
      setDeleteRequest(null);
    }
  };

  const handleDeleteAll = () => {
    setDeleteAll(true);
  };

  const handleConfirmDeleteAll = async () => {
    try {
      const response = await requestsAPI.deleteAll(eventUrl);
      const deletedCount = response?.deleted_ids?.length || 0;
      showToast(`${t('requestsGallery.successfullyDeleted')} ${deletedCount} ${deletedCount === 1 ? t('requestsGallery.request') : t('requestsGallery.requests')}`, 'success');
    } catch (error) {
      console.error('Failed to delete requests:', error);
      showToast(formatErrorMessage('delete requests', error), 'error');
    } finally {
      setDeleteAll(false);
    }
  };

  // Filtering by status
  const filteredRequests = useMemo(() => {
    if (filterStatus === 'all') return currentRequests;
    if (filterStatus === 'pending') return currentRequests.filter(r => r.status === 'pending' || !r.status);
    if (filterStatus === 'approved') return currentRequests.filter(r => r.status === 'approved');
    if (filterStatus === 'rejected') return currentRequests.filter(r => r.status === 'rejected');
    if (filterStatus === 'mixed') return currentRequests.filter(r => r.status === 'mixed');
    return currentRequests;
  }, [currentRequests, filterStatus]);

  // Sorting similar to UploadsGallery
  const sortedRequests = useMemo(() => {
    if (!isAuthenticated) return filteredRequests;

    const toValue = (item, field) => {
      switch (field) {
        case 'requested_at':
          return item.requested_at ? new Date(item.requested_at).getTime() : 0;
        case 'profile_label':
          return (item.profile_label || '').toString().toLowerCase();
        case 'status':
          return (item.status || '').toString().toLowerCase();
        case 'approved_groups_count':
          return item.approved_groups_count || 0;
        case 'accessible_groups_count':
          return item.accessible_groups_count || 0;
        case 'rejected_groups_count':
          return item.rejected_groups_count || 0;
        case 'pending_groups_count':
          return item.pending_groups_count || 0;
        default:
          return item[field] ?? '';
      }
    };

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filteredRequests].sort((a, b) => {
      const va = toValue(a, sortBy);
      const vb = toValue(b, sortBy);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [filteredRequests, isAuthenticated, sortBy, sortDir]);

  // Listen for external open-detail events (from notifications)
  useEffect(() => {
    const handler = async (ev) => {
      const rid = ev?.detail?.requestId;
      if (!rid) return;
      try {
        const res = await requestsAPI.getById(rid, eventUrl);
        const items = res?.changes?.[0]?.items || [];
        const req = items[0] || { id: rid, access_request_id: rid };
        // Find the index of this request in the sorted list
        const index = sortedRequests.findIndex(r => 
          (r.access_request_id || r.id) === (req.access_request_id || req.id)
        );
        openViewer({
          index: index >= 0 ? index : 0,
          sortBy,
          sortOrder: sortDir,
          filterStatus,
        });
      } catch {}
    };
    window.addEventListener('requests:open-detail', handler);
    return () => window.removeEventListener('requests:open-detail', handler);
  }, [eventUrl, sortedRequests, sortBy, sortDir, filterStatus, openViewer]);

  const handleSort = (field) => {
    if (sortBy === field) {
      const newDir = sortDir === 'asc' ? 'desc' : 'asc';
      setSortDir(newDir);
      setPreference('RequestsGallery.sortDir', newDir);
    } else {
      setSortBy(field);
      setPreference('RequestsGallery.sortBy', field);
    }
  };

  const handleFilterChange = (status) => {
    setFilterStatus(status);
    setPreference('RequestsGallery.filterStatus', status);
  };

  // Stats
  const stats = useMemo(() => {
    if (!isAuthenticated) return { total: 0, pending: 0, approved: 0, rejected: 0, mixed: 0 };
    return {
      total: currentRequests.length,
      pending: currentRequests.filter(r => r.status === 'pending' || !r.status).length,
      approved: currentRequests.filter(r => r.status === 'approved').length,
      rejected: currentRequests.filter(r => r.status === 'rejected').length,
      mixed: currentRequests.filter(r => r.status === 'mixed').length
    };
  }, [currentRequests, isAuthenticated]);


  return (
    <>
      <div className={`${!eventUrl ? 'min-h-screen' : ''} bg-gray-50 overflow-x-hidden`} dir={isRTL ? 'rtl' : 'ltr'} style={{ margin: 0, padding: 0 }}>
        {eventUrl && <div className="h-[4rem]"></div>}
        {/* Header */}
        <div className={`sticky ${eventUrl ? 'top-[4rem]' : 'top-0'} z-30 bg-white border-b border-gray-200 shadow-sm`}>
          <div className="w-full px-4 sm:px-8 py-2 sm:py-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-3 sm:mb-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-shrink-0">
                <div className="w-8 h-8 sm:w-12 sm:h-12 bg-blue-100 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4 h-4 sm:w-6 sm:h-6 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-2xl font-bold text-gray-900 truncate">{t('requestsGallery.accessRequests')}</h1>
                  <p className="text-xs sm:text-sm text-gray-500 truncate">
                    {isAuthenticated ? `${stats.total} ${t('requestsGallery.total')}, ${stats.pending} ${t('requestsGallery.pending')}` : 'Loading...'}
                  </p>
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleFilterChange('all')}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                    filterStatus === 'all'
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {t('requestsGallery.all')} ({stats.total})
                </button>
                <button
                  onClick={() => handleFilterChange('pending')}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                    filterStatus === 'pending'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {t('requestsGallery.pending')} ({stats.pending})
                </button>
                <button
                  onClick={() => handleFilterChange('approved')}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                    filterStatus === 'approved'
                      ? 'bg-green-100 text-green-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {t('requestsGallery.approved')} ({stats.approved})
                </button>
                <button
                  onClick={() => handleFilterChange('rejected')}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                    filterStatus === 'rejected'
                      ? 'bg-red-100 text-red-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {t('requestsGallery.rejected')} ({stats.rejected})
                </button>
                <button
                  onClick={() => handleFilterChange('mixed')}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                    filterStatus === 'mixed'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {t('requestsGallery.mixed')} ({stats.mixed})
                </button>
              </div>

              {/* Delete All Button */}
              {isAuthenticated && sortedRequests.length > 0 && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={handleDeleteAll}
                    className="flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors"
                    title={t('requestsGallery.deleteAll')}
                    aria-label={t('requestsGallery.deleteAll')}
                  >
                    <Trash className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span>{t('requestsGallery.deleteAll')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="w-full px-4 sm:px-8 py-3 sm:py-8 overflow-x-auto">
          <ScrollableTable
            style={{ maxHeight: 'calc(100vh - 20rem)' }}
            onRowClick={handleViewRequest}
            columns={[
              {
                key: 'access_request_id',
                label: t('requestsGallery.id'),
                align: 'left',
                cellClassName: 'text-xs text-gray-500 font-mono',
                renderCell: (request) => request.access_request_id || request.id || 'N/A',
              },
              {
                key: 'requested_at',
                label: t('requestsGallery.requestedAt'),
                sortable: true,
                align: 'left',
                renderCell: (request) => formatDateTimeLocale(request.requested_at),
              },
              {
                key: 'closed_at',
                label: t('requestsGallery.closed'),
                sortable: true,
                align: 'left',
                renderCell: (request) => request.closed_at ? formatDateTimeLocale(request.closed_at) : <span className="text-gray-400">—</span>,
              },
              {
                key: 'profile_label',
                label: t('requestsGallery.profileLabel'),
                sortable: true,
                align: 'left',
                cellClassName: 'text-gray-700',
                renderCell: (request) => request.profile_label || t('requestsGallery.unknown'),
              },
              {
                key: 'accessible_groups_count',
                label: t('requestsGallery.groups'),
                sortable: true,
                align: 'center',
                cellClassName: 'text-gray-700',
                renderCell: (request) => (
                  <div className="inline-flex items-center gap-1">
                    {!!(request.approved_groups_count) && (
                      <span
                        title={`${request.approved_groups_count} ${t('requestsGallery.approvedGroups')}`}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"
                      >
                        {request.approved_groups_count} <span className={isRTL ? 'mr-1' : 'ml-1'}>✓</span>
                      </span>
                    )}
                    {!!(request.rejected_groups_count) && (
                      <span
                        title={`${request.rejected_groups_count} ${t('requestsGallery.deniedGroups')}`}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800"
                      >
                        {request.rejected_groups_count} <span className={isRTL ? 'mr-1' : 'ml-1'}>✗</span>
                      </span>
                    )}
                    {!!(request.pending_groups_count) && (
                      <span
                        title={`${request.pending_groups_count} ${t('requestsGallery.pendingGroups')}`}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
                      >
                        {request.pending_groups_count} <span className={isRTL ? 'mr-1' : 'ml-1'}>⏳</span>
                      </span>
                    )}
                  </div>
                ),
              },
              {
                key: 'status',
                label: t('requestsGallery.status'),
                sortable: true,
                align: 'left',
                renderCell: (request) => {
                  const statusInfo = getRequestStatus(request);
                  const StatusIcon = statusInfo.icon;
                  const statusText = statusInfo.status === 'pending' ? t('requestsGallery.pending') :
                                   statusInfo.status === 'approved' ? t('requestsGallery.approved') :
                                   statusInfo.status === 'rejected' ? t('requestsGallery.rejected') :
                                   t('requestsGallery.mixed');
                  return (
                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                      statusInfo.color === 'blue' ? 'bg-blue-100 text-blue-800' :
                      statusInfo.color === 'green' ? 'bg-green-100 text-green-800' :
                      statusInfo.color === 'red' ? 'bg-red-100 text-red-800' :
                      'bg-yellow-100 text-yellow-800'}`}
                    >
                      <StatusIcon className={`inline ${isRTL ? 'ml-1' : 'mr-1'} w-4 h-4 align-text-bottom ${
                        statusInfo.color === 'blue' ? 'text-blue-600' :
                        statusInfo.color === 'green' ? 'text-green-600' :
                        statusInfo.color === 'red' ? 'text-red-600' :
                        'text-yellow-600'
                      }`} />
                      {statusText}
                    </span>
                  );
                },
              },
              {
                key: 'details',
                label: t('requestsGallery.details'),
                align: 'left',
                cellClassName: 'text-gray-700 max-w-xs truncate',
                renderCell: (request) => request.details || <span className="text-gray-400 italic">{t('requestsGallery.noDetails')}</span>,
              },
              {
                key: 'actions',
                label: t('requestsGallery.actions'),
                align: 'right',
                renderCell: (request, idx) => (
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteRequest(request);
                      }}
                      className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                      title={t('requestsGallery.deleteRequest')}
                      aria-label={t('requestsGallery.deleteRequest')}
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </button>
                  </div>
                ),
              },
            ]}
            data={sortedRequests}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={handleSort}
            emptyState={{
              icon: FileText,
              title: t('requestsGallery.noRequestsYet'),
              message: t('requestsGallery.noAccessRequestsHaveBeenSubmittedYet'),
            }}
            getRowKey={(request, idx) => request.access_request_id || request.id || `request-${idx}`}
          />
          
          {/* Note about data changes */}
          {sortedRequests.length > 0 && (
            <div className="mt-4 text-xs text-gray-500 italic text-center">
              {t('requestsGallery.permissionsMayHaveChanged')}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteRequest && (
        <ConfirmDelete
          isOpen={!!deleteRequest}
          onClose={() => setDeleteRequest(null)}
          onConfirm={handleConfirmDelete}
          title={t('requestsGallery.deleteRequestTitle')}
          message={t('requestsGallery.deleteRequestMessage')}
          simpleMessage={true}
          confirmText={t('account.delete')}
          cancelText={t('account.cancel')}
          caption={t('requestsGallery.deleteRequestCaption')}
        />
      )}

      {/* Delete All Confirmation Modal */}
      {deleteAll && (
        <ConfirmDelete
          isOpen={deleteAll}
          onClose={() => setDeleteAll(false)}
          onConfirm={handleConfirmDeleteAll}
          title={t('requestsGallery.deleteAllTitle')}
          message={`${t('requestsGallery.deleteAllMessage')} ${sortedRequests.length} ${sortedRequests.length === 1 ? t('requestsGallery.request') : t('requestsGallery.requests')}?`}
          simpleMessage={true}
          confirmText={t('requestsGallery.deleteAll')}
          cancelText={t('account.cancel')}
          caption={t('requestsGallery.deleteAllCaption')}
        />
      )}

      {/* Request Detail Modal */}
      {viewerOpen && sortedRequests.length > 0 && (
        <RequestDetailModal
          {...viewerProps}
          request={sortedRequests[viewerProps.currentIndex]}
          totalRequests={sortedRequests.length}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
        />
      )}
    </>
  );
}
