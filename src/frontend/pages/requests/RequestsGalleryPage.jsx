import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileText, Eye, Trash2, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';
import { requestsAPI } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { useRequestsList } from '../../utils/dataManager';
import { useApplyScopes } from '../../utils/storeUtils';
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

  // Sort requests by requested_at descending (newest first)
  const sortedRequests = useMemo(() => {
    return [...currentRequests].sort((a, b) => {
      if (a.isPlaceholder || b.isPlaceholder) return 0;
      const dateA = new Date(a.requested_at || 0);
      const dateB = new Date(b.requested_at || 0);
      return dateB - dateA;
    });
  }, [currentRequests]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Access Requests</h1>
                <p className="text-sm text-gray-500">Manage group access requests</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => urlHelpers.navigateToGroups()}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
              >
                Back to Groups
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {sortedRequests.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Requests</h3>
            <p className="text-gray-500">No access requests have been submitted yet.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {sortedRequests.map((request, index) => {
              const statusInfo = getRequestStatus(request);
              const StatusIcon = statusInfo.icon;
              
              return (
                <motion.div
                  key={request.access_request_id || `request-${index}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
                >
                  <div className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                          statusInfo.color === 'blue' ? 'bg-blue-100' :
                          statusInfo.color === 'green' ? 'bg-green-100' :
                          statusInfo.color === 'red' ? 'bg-red-100' :
                          'bg-yellow-100'
                        }`}>
                          <StatusIcon className={`w-6 h-6 ${
                            statusInfo.color === 'blue' ? 'text-blue-600' :
                            statusInfo.color === 'green' ? 'text-green-600' :
                            statusInfo.color === 'red' ? 'text-red-600' :
                            'text-yellow-600'
                          }`} />
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h3 className="text-lg font-medium text-gray-900">
                              {request.applicant_name || 'Unknown'}
                            </h3>
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                              statusInfo.color === 'blue' ? 'bg-blue-100 text-blue-700' :
                              statusInfo.color === 'green' ? 'bg-green-100 text-green-700' :
                              statusInfo.color === 'red' ? 'bg-red-100 text-red-700' :
                              'bg-yellow-100 text-yellow-700'
                            }`}>
                              {statusInfo.status.charAt(0).toUpperCase() + statusInfo.status.slice(1)}
                            </span>
                          </div>
                          <div className="flex items-center space-x-4 text-sm text-gray-500">
                            <span>{formatDateTime(request.requested_at)}</span>
                            <span>•</span>
                            <span>
                              {request.groups_approved_count || 0} of {request.groups_count || 0} groups
                            </span>
                            {request.applicant_email && (
                              <>
                                <span>•</span>
                                <span>{request.applicant_email}</span>
                              </>
                            )}
                          </div>
                          {request.details && (
                            <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                              {request.details}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleViewRequest(request)}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="View details"
                        >
                          <Eye className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => handleDeleteRequest(request)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete request"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteRequest && (
        <ConfirmDelete
          isOpen={!!deleteRequest}
          onClose={() => setDeleteRequest(null)}
          onConfirm={handleConfirmDelete}
          title="Delete Request"
          message="Are you sure you want to delete this request"
          itemName={deleteRequest.applicant_name}
          confirmText="Delete"
          cancelText="Cancel"
          caption="This action cannot be undone."
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
    </div>
  );
}
