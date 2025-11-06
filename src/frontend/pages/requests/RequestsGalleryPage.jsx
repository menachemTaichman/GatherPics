import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileText, Eye, Trash2, CheckCircle, XCircle, Clock, AlertCircle, ArrowUp, ArrowDown, Trash } from 'lucide-react';
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

  // Use requests from store or placeholders when not authenticated
  const currentRequests = isAuthenticated ? storeRequests : placeholderRequests;

  const handleViewRequest = (request, index) => {
    openViewer({
      index,
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
      showToast('Request deleted successfully', 'success');
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
      showToast(`Successfully deleted ${deletedCount} request${deletedCount !== 1 ? 's' : ''}`, 'success');
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

  const getSortIcon = (field) => {
    if (sortBy !== field) return null;
    return sortDir === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />;
  };

  return (
    <>
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-200">
          <div className="w-full px-8 py-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Access Requests</h1>
                  <p className="text-sm text-gray-500">
                    {isAuthenticated ? `${stats.total} total, ${stats.pending} pending` : 'Loading...'}
                  </p>
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleFilterChange('all')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filterStatus === 'all'
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  All ({stats.total})
                </button>
                <button
                  onClick={() => handleFilterChange('pending')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filterStatus === 'pending'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Pending ({stats.pending})
                </button>
                <button
                  onClick={() => handleFilterChange('approved')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filterStatus === 'approved'
                      ? 'bg-green-100 text-green-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Approved ({stats.approved})
                </button>
                <button
                  onClick={() => handleFilterChange('rejected')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filterStatus === 'rejected'
                      ? 'bg-red-100 text-red-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Rejected ({stats.rejected})
                </button>
                <button
                  onClick={() => handleFilterChange('mixed')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filterStatus === 'mixed'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Mixed ({stats.mixed})
                </button>
              </div>

              {/* Delete All Button */}
              {isAuthenticated && sortedRequests.length > 0 && (
                <button
                  onClick={handleDeleteAll}
                  className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
                  title="Delete all requests"
                >
                  <Trash className="w-4 h-4" />
                  <span>Delete All</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="w-full px-8 py-8">
          {sortedRequests.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12"
            >
              <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No requests yet</h3>
              <p className="text-gray-500">
                No access requests have been submitted yet.
              </p>
            </motion.div>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">ID</th>
                        <th
                          onClick={() => handleSort('requested_at')}
                          className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-50"
                        >
                          <div className="flex items-center space-x-1">
                            <span>Requested</span>
                            {getSortIcon('requested_at')}
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
                          onClick={() => handleSort('accessible_groups_count')}
                          className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-50"
                        >
                          <div className="flex items-center justify-center space-x-1">
                            <span>Groups</span>
                            {getSortIcon('accessible_groups_count')}
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
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Details</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-600 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {sortedRequests.map((request, idx) => {
                        const statusInfo = getRequestStatus(request);
                        const StatusIcon = statusInfo.icon;
                        return (
                          <tr key={request.access_request_id || `request-${idx}`} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-xs text-gray-500 font-mono">
                              {request.access_request_id || request.id || 'N/A'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900">
                              {formatDateTime(request.requested_at)}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700">
                              {request.profile_label || 'Unknown'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700 text-center">
                              <div className="inline-flex items-center gap-1">
                                {!!(request.approved_groups_count) && (
                                  <span
                                    title={`${request.approved_groups_count} approved groups`}
                                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"
                                  >
                                    {request.approved_groups_count} <span className="ml-1">✓</span>
                                  </span>
                                )}
                                {!!(request.rejected_groups_count) && (
                                  <span
                                    title={`${request.rejected_groups_count} denied groups`}
                                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800"
                                  >
                                    {request.rejected_groups_count} <span className="ml-1">✗</span>
                                  </span>
                                )}
                                {!!(request.pending_groups_count) && (
                                  <span
                                    title={`${request.pending_groups_count} pending groups`
                                    }
                                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
                                  >
                                    {request.pending_groups_count} <span className="ml-1">⏳</span>
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                                statusInfo.color === 'blue' ? 'bg-blue-100 text-blue-800' :
                                statusInfo.color === 'green' ? 'bg-green-100 text-green-800' :
                                statusInfo.color === 'red' ? 'bg-red-100 text-red-800' :
                                'bg-yellow-100 text-yellow-800'}`}
                              >
                                <StatusIcon className={`inline mr-1 w-4 h-4 align-text-bottom ${
                                  statusInfo.color === 'blue' ? 'text-blue-600' :
                                  statusInfo.color === 'green' ? 'text-green-600' :
                                  statusInfo.color === 'red' ? 'text-red-600' :
                                  'text-yellow-600'
                                }`} />
                                {statusInfo.status.charAt(0).toUpperCase() + statusInfo.status.slice(1)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate">
                              {request.details || <span className="text-gray-400 italic">No details</span>}
                            </td>
                            <td className="px-4 py-3 text-sm text-right">
                              <div className="flex items-center justify-end space-x-2">
                                <button
                                  onClick={() => handleViewRequest(request, idx)}
                                  className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                  title="View details"
                                >
                                  <Eye className="w-4 h-4 text-blue-600" />
                                </button>
                                <button
                                  onClick={() => handleDeleteRequest(request)}
                                  className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                  title="Delete request"
                                >
                                  <Trash2 className="w-4 h-4 text-red-600" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Note about data changes */}
              <div className="mt-4 text-xs text-gray-500 italic text-center">
                Note: Permissions may have changed since these requests were updated
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteRequest && (
        <ConfirmDelete
          isOpen={!!deleteRequest}
          onClose={() => setDeleteRequest(null)}
          onConfirm={handleConfirmDelete}
          title="Delete Request"
          message="Are you sure you want to delete this request?"
          simpleMessage={true}
          confirmText="Delete"
          cancelText="Cancel"
          caption="This action cannot be undone. The request record will be deleted."
        />
      )}

      {/* Delete All Confirmation Modal */}
      {deleteAll && (
        <ConfirmDelete
          isOpen={deleteAll}
          onClose={() => setDeleteAll(false)}
          onConfirm={handleConfirmDeleteAll}
          title="Delete All Requests"
          message={`Are you sure you want to delete all ${sortedRequests.length} request${sortedRequests.length !== 1 ? 's' : ''}?`}
          simpleMessage={true}
          confirmText="Delete All"
          cancelText="Cancel"
          caption="This action cannot be undone. All displayed requests will be permanently deleted."
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
