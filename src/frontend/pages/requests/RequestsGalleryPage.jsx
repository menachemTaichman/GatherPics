import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileText, Eye, Trash2, CheckCircle, XCircle, Clock, AlertCircle, ArrowUp, ArrowDown } from 'lucide-react';
import { requestsAPI } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { useRequestsList } from '../../utils/dataManager';
import { useApplyScopes } from '../../utils/storeUtils';
import { getPreference, setPreference } from '../../utils/settings';
import { formatErrorMessage } from '../../utils/errorHandler';
import { ConfirmDelete } from '../../components/modals';
import { RequestDetailModal } from '../../components/requests';
import { useAuth } from '../../contexts/authContext';
import { useAuthRefresh } from '../../hooks/useAuthRefresh';

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
  const [deleteRequest, setDeleteRequest] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [sortBy, setSortBy] = useState(() => getPreference('RequestsGallery.sortBy', 'requested_at'));
  const [sortDir, setSortDir] = useState(() => getPreference('RequestsGallery.sortDir', 'desc'));
  
  const navigate = useNavigate();
  const { showToast } = useToast();

  useApplyScopes([{ entity: 'all', id: 'access_requests' }]);

  const storeRequests = useRequestsList();

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

  const handleViewRequest = (request) => {
    setSelectedRequest(request);
    setShowDetailModal(true);
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

  const handleCloseDetailModal = () => {
    setShowDetailModal(false);
    setSelectedRequest(null);
  };

  // Listen for external open-detail events (from notifications)
  useEffect(() => {
    const handler = async (ev) => {
      const rid = ev?.detail?.requestId;
      if (!rid) return;
      try {
        const res = await requestsAPI.getById(rid, eventUrl);
        const items = res?.changes?.[0]?.items || [];
        const req = items[0] || { id: rid, access_request_id: rid };
        setSelectedRequest(req);
        setShowDetailModal(true);
      } catch {}
    };
    window.addEventListener('requests:open-detail', handler);
    return () => window.removeEventListener('requests:open-detail', handler);
  }, [eventUrl]);

  // Sorting similar to UploadsGallery
  const sortedRequests = useMemo(() => {
    if (!isAuthenticated) return currentRequests;

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
    return [...currentRequests].sort((a, b) => {
      const va = toValue(a, sortBy);
      const vb = toValue(b, sortBy);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [currentRequests, isAuthenticated, sortBy, sortDir]);

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

  const getSortIcon = (field) => {
    if (sortBy !== field) return null;
    return sortDir === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />;
  };

  return (
    <>
      <div className="w-full">
        {/* Sticky Header */}
        <div className="sticky top-16 z-30 bg-white border-b border-gray-200 px-8 py-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                Access Requests
              </h1>
              <p className="text-gray-600">
                {sortedRequests.length === 0 
                  ? 'No requests yet'
                  : `${sortedRequests.length} request${sortedRequests.length !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="px-8 py-8">
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
                                  onClick={() => handleViewRequest(request)}
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
                Note: Data may have changed since these requests were created
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

      {/* Request Detail Modal */}
      {showDetailModal && selectedRequest && (
        <RequestDetailModal
          isOpen={showDetailModal}
          onClose={handleCloseDetailModal}
          request={selectedRequest}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
        />
      )}
    </>
  );
}
