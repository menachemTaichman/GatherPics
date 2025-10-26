import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Mail, Phone, FileText, Users, CheckCircle, XCircle, Clock, AlertCircle, Save } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { useToast } from '../../contexts/ToastContext';
import { requestsAPI, imagesAPI } from '../../utils/apiService';
import { useGroupsList } from '../../utils/dataManager';
import { getRepresentativeUrl } from '../../utils/storeUtils';
import { formatErrorMessage } from '../../utils/errorHandler';
import { usePermissions } from '../../hooks/usePermissions';

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

function getGroupStatus(groupData) {
  if (groupData.approved === true) {
    return { status: 'approved', color: 'green', icon: CheckCircle };
  } else if (groupData.approved === false) {
    return { status: 'denied', color: 'red', icon: XCircle };
  } else {
    return { status: 'pending', color: 'blue', icon: Clock };
  }
}

export default function RequestDetailModal({ 
  isOpen, 
  onClose, 
  request,
  eventUrl,
  urlHelpers
}) {
  const [loading, setLoading] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState(new Set());
  const [closeRequest, setCloseRequest] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [actionType, setActionType] = useState(''); // 'approve' or 'deny'
  
  const { showToast } = useToast();
  const permissions = usePermissions();
  const allGroups = useGroupsList();
  
  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'request-detail-modal';

  const requestId = request?.access_request_id || request?.id;

  // Fetch request details when modal opens
  useEffect(() => {
    if (isOpen && requestId) {
      setLoading(true);
      const fetchRequestDetails = async () => {
        try {
          await requestsAPI.getById(requestId, eventUrl);
        } catch (error) {
          console.error('Failed to fetch request details:', error);
        } finally {
          setLoading(false);
        }
      };
      fetchRequestDetails();
    }
  }, [isOpen, requestId, eventUrl]);

  // Register modal when opened (this also applies scopes, so no need for useApplyScopes)
  useEffect(() => {
    if (isOpen) {
      registerModal({ 
        id: modalId, 
        type: 'popup',
        allowOutsideScroll: true,
        scopes: requestId ? [{ entity: 'access_request', id: requestId }] : []
      });
      
      return () => {
        unregisterModal(modalId);
      };
    }
  }, [isOpen, registerModal, unregisterModal, requestId]);

  // Initialize form data
  useEffect(() => {
    if (isOpen && request) {
      setProfileName(request.applicant_name || '');
      setSelectedGroups(new Set());
      setCloseRequest(false);
      setActionType('');
    }
  }, [isOpen, request]);

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId: modalId,
    modalType: 'popup',
    allowOutsideScroll: true,
    enableFocusTrapping: true
  });

  const handleGroupToggle = (groupId) => {
    setSelectedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  };

  const handleApproveAll = () => {
    if (!request?.groups) return;
    
    const pendingGroups = Object.keys(request.groups).filter(
      groupId => request.groups[groupId].approved === null
    );
    setSelectedGroups(new Set(pendingGroups));
    setActionType('approve');
  };

  const handleDenyAll = () => {
    if (!request?.groups) return;
    
    const pendingGroups = Object.keys(request.groups).filter(
      groupId => request.groups[groupId].approved === null
    );
    setSelectedGroups(new Set(pendingGroups));
    setActionType('deny');
  };

  const handleApproveSelected = () => {
    setActionType('approve');
  };

  const handleDenySelected = () => {
    setActionType('deny');
  };

  const handleSubmit = async () => {
    if (selectedGroups.size === 0) {
      showToast('Please select at least one group', 'error');
      return;
    }

    if (actionType === 'approve' && !request.applicant_profile_id && !profileName.trim()) {
      showToast('Profile name is required for new profiles', 'error');
      return;
    }

    setLoading(true);
    
    try {
      const groupIds = Array.from(selectedGroups);
      const requestId = request.access_request_id || request.id;
      
      if (actionType === 'approve') {
        await requestsAPI.approve(
          requestId,
          groupIds,
          closeRequest,
          null,
          profileName.trim() || null,
          eventUrl
        );
        showToast('Request approved successfully', 'success');
      } else if (actionType === 'deny') {
        await requestsAPI.deny(
          requestId,
          groupIds,
          closeRequest,
          null,
          eventUrl
        );
        showToast('Request denied successfully', 'success');
      }
      
      onClose();
    } catch (error) {
      console.error('Failed to process request:', error);
      showToast(formatErrorMessage('process request', error), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
    }
  };

  if (!isOpen || !request) return null;

  const pendingGroups = request.groups ? Object.keys(request.groups).filter(
    groupId => request.groups[groupId].approved === null
  ) : [];

  const canApprove = permissions.isProfilesManager && pendingGroups.length > 0;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={handleClose}>
      <motion.div
        ref={modalRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Request Details</h2>
              <p className="text-sm text-gray-500">Review and process access request</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Request Information */}
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Request Information</h3>
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <User className="w-5 h-5 text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{request.applicant_name}</p>
                      <p className="text-xs text-gray-500">Applicant Name</p>
                    </div>
                  </div>
                  
                  {request.applicant_email && (
                    <div className="flex items-center space-x-3">
                      <Mail className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{request.applicant_email}</p>
                        <p className="text-xs text-gray-500">Email Address</p>
                      </div>
                    </div>
                  )}
                  
                  {request.applicant_phone && (
                    <div className="flex items-center space-x-3">
                      <Phone className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{request.applicant_phone}</p>
                        <p className="text-xs text-gray-500">Phone Number</p>
                      </div>
                    </div>
                  )}
                  
                  <div className="flex items-center space-x-3">
                    <Clock className="w-5 h-5 text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{formatDateTime(request.requested_at)}</p>
                      <p className="text-xs text-gray-500">Requested At</p>
                    </div>
                  </div>
                  
                  {request.details && (
                    <div className="flex items-start space-x-3">
                      <FileText className="w-5 h-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{request.details}</p>
                        <p className="text-xs text-gray-500">Details</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Profile Name for New Profiles */}
              {!request.applicant_profile_id && (
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">New Profile</h3>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Profile Name *
                    </label>
                    <input
                      type="text"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter profile name"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      This will be the name of the new profile created when approved
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Groups Selection */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">Groups</h3>
                {canApprove && (
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleApproveAll}
                      className="px-3 py-1.5 bg-green-100 text-green-700 text-sm rounded-lg hover:bg-green-200 transition-colors font-medium"
                    >
                      Approve All
                    </button>
                    <button
                      onClick={handleDenyAll}
                      className="px-3 py-1.5 bg-red-100 text-red-700 text-sm rounded-lg hover:bg-red-200 transition-colors font-medium"
                    >
                      Deny All
                    </button>
                  </div>
                )}
              </div>
              
              <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-lg">
                {request.groups && Object.keys(request.groups).length > 0 ? (
                  <div className="divide-y divide-gray-200">
                    {Object.entries(request.groups).map(([groupId, groupData]) => {
                      const group = allGroups.find(g => g.group_id === groupId);
                      const statusInfo = getGroupStatus(groupData);
                      const StatusIcon = statusInfo.icon;
                      const isPending = groupData.approved === null;
                      const isSelected = selectedGroups.has(groupId);
                      const isAccessible = group?.is_accessible !== false;
                      
                      return (
                        <label
                          key={groupId || `request-group-${index}`}
                          className={`flex items-center space-x-3 p-3 hover:bg-gray-50 cursor-pointer ${
                            !isAccessible ? 'opacity-50' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleGroupToggle(groupId)}
                            disabled={!isPending || !isAccessible || !canApprove}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50"
                          />
                          <div className="flex items-center space-x-3 flex-1">
                            {group?.representative_face && group?.id ? (
                              <img
                                src={`${getRepresentativeUrl(urlHelpers, 'groups', group.id)}?v=${group.representative_face}`}
                                alt={group.label}
                                className="w-8 h-8 rounded-full object-cover"
                              />
                            ) : (
                              <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                                <User className="w-4 h-4 text-gray-500" />
                              </div>
                            )}
                            <div className="flex-1">
                              <div className="flex items-center space-x-2">
                                <p className="text-sm font-medium text-gray-900">{group?.label || 'Unknown'}</p>
                                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                  statusInfo.color === 'blue' ? 'bg-blue-100 text-blue-700' :
                                  statusInfo.color === 'green' ? 'bg-green-100 text-green-700' :
                                  statusInfo.color === 'red' ? 'bg-red-100 text-red-700' :
                                  'bg-yellow-100 text-yellow-700'
                                }`}>
                                  {statusInfo.status}
                                </span>
                                {!isAccessible && (
                                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
                                    Not accessible
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500">
                                {group?.images_count || 0} image{(group?.images_count || 0) !== 1 ? 's' : ''}
                              </p>
                            </div>
                          </div>
                          <StatusIcon className={`w-5 h-5 ${
                            statusInfo.color === 'blue' ? 'text-blue-600' :
                            statusInfo.color === 'green' ? 'text-green-600' :
                            statusInfo.color === 'red' ? 'text-red-600' :
                            'text-yellow-600'
                          }`} />
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-4 text-center text-gray-500">
                    <Users className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm">No groups in this request</p>
                  </div>
                )}
              </div>
              
              <p className="text-xs text-gray-500">
                Selected {selectedGroups.size} group{selectedGroups.size !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={closeRequest}
                  onChange={(e) => setCloseRequest(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Close request (deny remaining groups)</span>
              </label>
            </div>
            
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={handleClose}
                disabled={loading}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              
              {canApprove && (
                <>
                  <button
                    onClick={handleDenySelected}
                    disabled={loading || selectedGroups.size === 0}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 flex items-center space-x-2"
                  >
                    {loading && actionType === 'deny' && (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    )}
                    <XCircle className="w-4 h-4" />
                    <span>Deny Selected</span>
                  </button>
                  
                  <button
                    onClick={handleApproveSelected}
                    disabled={loading || selectedGroups.size === 0}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium disabled:opacity-50 flex items-center space-x-2"
                  >
                    {loading && actionType === 'approve' && (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    )}
                    <CheckCircle className="w-4 h-4" />
                    <span>Approve Selected</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
