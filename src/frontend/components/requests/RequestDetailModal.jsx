import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Mail, Phone, FileText, Users, CheckCircle, XCircle, Clock, AlertCircle, Check, Save, AlertTriangle } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { useToast } from '../../contexts/ToastContext';
import { requestsAPI, imagesAPI, profilesAPI } from '../../utils/apiService';
import { useGroupsList, useRequestById } from '../../utils/dataManager';
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
  const [groupActions, setGroupActions] = useState({}); // { groupId: 'approve' | 'deny' | null }
  const [closeRequest, setCloseRequest] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [nameConflict, setNameConflict] = useState(false);
  
  const { showToast } = useToast();
  const permissions = usePermissions();
  const allGroups = useGroupsList();
  const storeRequest = useRequestById(request?.access_request_id || request?.id);
  
  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'request-detail-modal';

  const requestId = request?.access_request_id || request?.id;
  
  // Use the request from the store (which has up-to-date relation data) if available, otherwise fall back to prop
  const requestData = storeRequest || request;

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

  // Check name conflict with debounce (similar to EditProfileModal)
  const checkNameConflict = async (label) => {
    if (!label || !label.trim()) {
      setNameConflict(false);
      return;
    }

    try {
      const result = await profilesAPI.checkName(label.trim(), null, eventUrl);
      setNameConflict(result.conflict || false);
    } catch (error) {
      console.error('Error checking name conflict:', error);
      setNameConflict(false);
    }
  };

  // Initialize form data and check name conflict if needed
  useEffect(() => {
    if (isOpen && requestData) {
      setProfileName(requestData.applicant_name || '');
      setGroupActions({});
      setCloseRequest(false);
      setNameConflict(false);
      
      // Check name conflict when modal opens (if applicant_profile_id is null and name exists)
      if (!requestData.applicant_profile_id && requestData.applicant_name) {
        checkNameConflict(requestData.applicant_name);
      }
    }
  }, [isOpen, requestData]);

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId: modalId,
    modalType: 'popup',
    allowOutsideScroll: true,
    enableFocusTrapping: true
  });

  const handleGroupAction = (groupId, action) => {
    setGroupActions(prev => {
      const newActions = { ...prev };
      if (newActions[groupId] === action) {
        delete newActions[groupId];
      } else {
        newActions[groupId] = action;
      }
      return newActions;
    });
  };

  const allPendingGroups = requestData?.groups ? Object.keys(requestData.groups).filter(
    groupId => requestData.groups[groupId].approved === null
  ) : [];

  const handleApproveAll = () => {
    // Same as handleApprovePending - they do the same thing
    handleApprovePending();
  };

  const handleDenyAll = () => {
    // Same as handleDenyPending - they do the same thing
    handleDenyPending();
  };

  const handleApprovePending = () => {
    if (!requestData?.groups) return;
    const actions = { ...groupActions };
    const allSelected = allPendingGroups.every(groupId => groupActions[groupId] === 'approve');
    
    if (allSelected) {
      // Cancel all
      allPendingGroups.forEach(groupId => {
        delete actions[groupId];
      });
    } else {
      // Set all to approve
      allPendingGroups.forEach(groupId => {
        actions[groupId] = 'approve';
      });
    }
    setGroupActions(actions);
  };

  const handleDenyPending = () => {
    if (!requestData?.groups) return;
    const actions = { ...groupActions };
    const allSelected = allPendingGroups.every(groupId => groupActions[groupId] === 'deny');
    
    if (allSelected) {
      // Cancel all
      allPendingGroups.forEach(groupId => {
        delete actions[groupId];
      });
    } else {
      // Set all to deny
      allPendingGroups.forEach(groupId => {
        actions[groupId] = 'deny';
      });
    }
    setGroupActions(actions);
  };

  const handleApproveNotSelected = () => {
    if (!requestData?.groups) return;
    const actions = { ...groupActions };
    // Get pending groups that don't have an action yet
    const notSelectedGroups = allPendingGroups.filter(groupId => !groupActions[groupId]);
    const allSelected = notSelectedGroups.length > 0 && notSelectedGroups.every(groupId => groupActions[groupId] === 'approve');
    
    if (allSelected && notSelectedGroups.length > 0) {
      // Cancel all
      allPendingGroups.forEach(groupId => {
        delete actions[groupId];
      });
    } else {
      // Set all not-selected to approve
      notSelectedGroups.forEach(groupId => {
        actions[groupId] = 'approve';
      });
    }
    setGroupActions(actions);
  };

  const handleDenyNotSelected = () => {
    if (!requestData?.groups) return;
    const actions = { ...groupActions };
    // Get pending groups that don't have an action yet
    const notSelectedGroups = allPendingGroups.filter(groupId => !groupActions[groupId]);
    const allSelected = notSelectedGroups.length > 0 && notSelectedGroups.every(groupId => groupActions[groupId] === 'deny');
    
    if (allSelected && notSelectedGroups.length > 0) {
      // Cancel all
      allPendingGroups.forEach(groupId => {
        delete actions[groupId];
      });
    } else {
      // Set all not-selected to deny
      notSelectedGroups.forEach(groupId => {
        actions[groupId] = 'deny';
      });
    }
    setGroupActions(actions);
  };

  const handleApplyChanges = async () => {
    const approvedGroups = Object.keys(groupActions).filter(id => groupActions[id] === 'approve');
    const deniedGroups = Object.keys(groupActions).filter(id => groupActions[id] === 'deny');
    
    if (approvedGroups.length === 0 && deniedGroups.length === 0) {
      showToast('Please select at least one action', 'error');
      return;
    }

    if (approvedGroups.length > 0 && !requestData.applicant_profile_id) {
      if (!profileName || !profileName.trim()) {
        showToast('Profile name is required for new profiles', 'error');
        return;
      }
      if (nameConflict) {
        showToast('Cannot save: Profile name already exists', 'error');
        return;
      }
    }

    setLoading(true);
    
    try {
      const requestId = request.access_request_id || request.id;
      
      if (approvedGroups.length > 0) {
        await requestsAPI.approve(
          requestId,
          approvedGroups,
          closeRequest,
          null,
          profileName.trim() || null,
          eventUrl
        );
      }
      
      if (deniedGroups.length > 0) {
        await requestsAPI.deny(
          requestId,
          deniedGroups,
          closeRequest,
          null,
          eventUrl
        );
      }
      
      showToast('Changes applied successfully', 'success');
      onClose();
    } catch (error) {
      console.error('Failed to apply changes:', error);
      showToast(formatErrorMessage('apply changes', error), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveRequest = async () => {
    const allPendingGroups = requestData?.groups ? Object.keys(requestData.groups).filter(
      groupId => requestData.groups[groupId].approved === null
    ) : [];
    
    if (allPendingGroups.length === 0) {
      showToast('No pending groups to approve', 'error');
      return;
    }

    if (!requestData.applicant_profile_id) {
      if (!profileName || !profileName.trim()) {
        showToast('Profile name is required for new profiles', 'error');
        return;
      }
      if (nameConflict) {
        showToast('Cannot save: Profile name already exists', 'error');
        return;
      }
    }

    setLoading(true);
    
    try {
      const requestId = request.access_request_id || request.id;
      await requestsAPI.approve(
        requestId,
        allPendingGroups,
        closeRequest,
        null,
        profileName.trim() || null,
        eventUrl
      );
      showToast('Request approved successfully', 'success');
      onClose();
    } catch (error) {
      console.error('Failed to approve request:', error);
      showToast(formatErrorMessage('approve request', error), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDenyRequest = async () => {
    const allPendingGroups = requestData?.groups ? Object.keys(requestData.groups).filter(
      groupId => requestData.groups[groupId].approved === null
    ) : [];
    
    if (allPendingGroups.length === 0) {
      showToast('No pending groups to deny', 'error');
      return;
    }

    setLoading(true);
    
    try {
      const requestId = request.access_request_id || request.id;
      await requestsAPI.deny(
        requestId,
        allPendingGroups,
        closeRequest,
        null,
        eventUrl
      );
      showToast('Request denied successfully', 'success');
      onClose();
    } catch (error) {
      console.error('Failed to deny request:', error);
      showToast(formatErrorMessage('deny request', error), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
    }
  };

  if (!isOpen || !requestData) return null;

  const pendingGroups = requestData.groups ? Object.keys(requestData.groups).filter(
    groupId => requestData.groups[groupId].approved === null
  ) : [];

  const canApprove = permissions.isProfilesManager && pendingGroups.length > 0;

  // Check state of all buttons
  const getAllPendingActionState = () => {
    if (!requestData?.groups) return null;
    const pendingGroups = Object.keys(requestData.groups).filter(
      groupId => requestData.groups[groupId].approved === null
    );
    if (pendingGroups.length === 0) return null;
    
    const actions = pendingGroups.map(id => groupActions[id]);
    const allApproved = actions.every(a => a === 'approve');
    const allDenied = actions.every(a => a === 'deny');
    
    if (allApproved) return 'approve';
    if (allDenied) return 'deny';
    if (actions.some(a => a === 'approve' || a === 'deny')) return 'mixed';
    return null;
  };

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
                      <p className="text-sm font-medium text-gray-900">{requestData.applicant_name}</p>
                      <p className="text-xs text-gray-500">Applicant Name</p>
                    </div>
                  </div>
                  
                  {requestData.applicant_email && (
                    <div className="flex items-center space-x-3">
                      <Mail className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{requestData.applicant_email}</p>
                        <p className="text-xs text-gray-500">Email Address</p>
                      </div>
                    </div>
                  )}
                  
                  {requestData.applicant_phone && (
                    <div className="flex items-center space-x-3">
                      <Phone className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{requestData.applicant_phone}</p>
                        <p className="text-xs text-gray-500">Phone Number</p>
                      </div>
                    </div>
                  )}
                  
                  <div className="flex items-center space-x-3">
                    <Clock className="w-5 h-5 text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{formatDateTime(requestData.requested_at)}</p>
                      <p className="text-xs text-gray-500">Requested At</p>
                    </div>
                  </div>
                  
                  {requestData.details && (
                    <div className="flex items-start space-x-3">
                      <FileText className="w-5 h-5 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{requestData.details}</p>
                        <p className="text-xs text-gray-500">Details</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Profile Name for New Profiles */}
              {!requestData.applicant_profile_id && (
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">New Profile</h3>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Profile Name *
                    </label>
                    <input
                      type="text"
                      value={profileName}
                      onChange={(e) => {
                        const value = e.target.value;
                        setProfileName(value);
                        if (!requestData.applicant_profile_id) {
                          // Debounce name conflict check
                          if (checkNameConflict._timeout) clearTimeout(checkNameConflict._timeout);
                          checkNameConflict._timeout = setTimeout(() => {
                            checkNameConflict(value);
                          }, 300);
                        }
                      }}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        nameConflict ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="Enter profile name"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      This will be the name of the new profile created when approved
                    </p>
                    {nameConflict && (
                      <div className="flex items-center space-x-1 text-red-500 text-xs mt-1">
                        <AlertTriangle className="w-3 h-3" />
                        <span>Name exists</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Groups Selection */}
            <div className="space-y-3">
              <h3 className="text-lg font-medium text-gray-900">Groups</h3>
              
              {canApprove && (
                <div className="space-y-0">
                  {/* "All pending" row */}
                  <div className="flex items-center px-3 py-1">
                    <div className="flex-1">
                      <span className="text-xs text-gray-500 font-medium">All pending:</span>
                    </div>
                    <div className="flex items-center space-x-2 flex-shrink-0">
                      {(() => {
                        const state = getAllPendingActionState();
                        return (
                          <>
                            {/* Spacer to align with status icon column in group rows */}
                            <div className="w-5 h-5" />
                            <button
                              onClick={handleApprovePending}
                              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
                                state === 'approve' 
                                  ? 'bg-green-600 text-white shadow-sm' 
                                  : state === 'mixed'
                                  ? 'bg-yellow-500 text-white shadow-sm'
                                  : 'bg-green-100 hover:bg-green-200 text-green-700'
                              }`}
                              title="Approve all pending"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={handleDenyPending}
                              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
                                state === 'deny' 
                                  ? 'bg-red-600 text-white shadow-sm' 
                                  : state === 'mixed'
                                  ? 'bg-yellow-500 text-white shadow-sm'
                                  : 'bg-red-100 hover:bg-red-200 text-red-700'
                              }`}
                              title="Deny all pending"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  
                  {/* "All not selected" row */}
                  <div className="flex items-center px-3 py-1">
                    <div className="flex-1">
                      <span className="text-xs text-gray-500 font-medium">All not selected:</span>
                    </div>
                    <div className="flex items-center space-x-2 flex-shrink-0">
                      {/* Spacer to align with status icon column in group rows */}
                      <div className="w-5 h-5" />
                      <button
                        onClick={handleApproveNotSelected}
                        className="w-8 h-8 flex items-center justify-center bg-green-100 hover:bg-green-200 rounded-lg transition-colors text-green-700"
                        title="Approve all not selected"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={handleDenyNotSelected}
                        className="w-8 h-8 flex items-center justify-center bg-red-100 hover:bg-red-200 rounded-lg transition-colors text-red-700"
                        title="Deny all not selected"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-lg">
                {requestData.groups && Object.keys(requestData.groups).length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {Object.entries(requestData.groups).sort(([idA, dataA], [idB, dataB]) => {
                      // Sort by status first: pending (null) = 0, approved (true) = 1, denied (false) = 2
                      const statusA = dataA.approved === null ? 0 : (dataA.approved ? 1 : 2);
                      const statusB = dataB.approved === null ? 0 : (dataB.approved ? 1 : 2);
                      
                      if (statusA !== statusB) {
                        return statusA - statusB;
                      }
                      
                      // Then sort by label
                      const groupA = allGroups.find(g => (g.id || g.group_id) === idA);
                      const groupB = allGroups.find(g => (g.id || g.group_id) === idB);
                      const labelA = groupA?.label || '';
                      const labelB = groupB?.label || '';
                      
                      return labelA.localeCompare(labelB);
                    }).map(([groupId, groupData]) => {
                      // Try to find group by ID (normalized) or by group_id (raw from backend)
                      const group = allGroups.find(g => (g.id || g.group_id) === groupId);
                      const statusInfo = getGroupStatus(groupData);
                      const StatusIcon = statusInfo.icon;
                      const isPending = groupData.approved === null;
                      const isAccessible = group?.is_accessible !== false;
                      const action = groupActions[groupId];
                      const isApproved = action === 'approve';
                      const isDenied = action === 'deny';
                      
                      return (
                        <div
                          key={groupId}
                          className={`flex items-center p-3 hover:bg-gray-50 ${
                            !isAccessible ? 'opacity-50' : ''
                          }`}
                        >
                          {/* Left: Avatar and info */}
                          <div className="flex items-center space-x-3 flex-1 min-w-0">
                            {group?.representative_face && group?.id ? (
                              <img
                                src={`${getRepresentativeUrl(urlHelpers, 'groups', group.id)}?v=${group.representative_face}`}
                                alt={group.label}
                                className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                              />
                            ) : (
                              <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0">
                                <User className="w-4 h-4 text-gray-500" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2">
                                <p className="text-sm font-medium text-gray-900 truncate">{group?.label || 'Unknown'}</p>
                                {!isAccessible && (
                                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 flex-shrink-0">
                                    Not accessible
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          
                          {/* Right: Status icon and buttons */}
                          <div className="flex items-center space-x-2 flex-shrink-0">
                            <StatusIcon className={`w-5 h-5 ${
                              statusInfo.color === 'blue' ? 'text-blue-600' :
                              statusInfo.color === 'green' ? 'text-green-600' :
                              statusInfo.color === 'red' ? 'text-red-600' :
                              'text-yellow-600'
                            }`} />
                            {canApprove && isPending && isAccessible && (
                              <>
                                <button
                                  onClick={() => handleGroupAction(groupId, 'approve')}
                                  className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
                                    isApproved 
                                      ? 'bg-green-600 text-white shadow-sm' 
                                      : 'bg-green-100 hover:bg-green-200 text-green-700'
                                  }`}
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleGroupAction(groupId, 'deny')}
                                  className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
                                    isDenied 
                                      ? 'bg-red-600 text-white shadow-sm' 
                                      : 'bg-red-100 hover:bg-red-200 text-red-700'
                                  }`}
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
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
              
              <div className="min-h-[20px]">
                <p className="text-xs text-gray-500">
                  {Object.keys(groupActions).length > 0 ? (
                    <span>
                      {Object.values(groupActions).filter(a => a === 'approve').length} approved, {' '}
                      {Object.values(groupActions).filter(a => a === 'deny').length} denied
                    </span>
                  ) : (
                    <span className="invisible">Placeholder</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <span className="text-sm text-gray-700">Close request:</span>
              <button
                onClick={() => setCloseRequest(!closeRequest)}
                className={`w-10 h-6 rounded-full relative transition-colors ${closeRequest ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 ${closeRequest ? 'left-5' : 'left-0.5'} w-5 h-5 bg-white rounded-full shadow transition-all`} />
              </button>
              <span className="text-xs text-gray-500">(deny remaining)</span>
            </div>
            
            <div className="flex items-center space-x-3">
              {canApprove && (
                <>
                  <button
                    onClick={handleApplyChanges}
                    disabled={loading || Object.keys(groupActions).length === 0}
                    className="w-10 h-10 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    title="Apply Changes"
                  >
                    {loading && (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    )}
                    {!loading && <Save className="w-5 h-5" />}
                  </button>
                  
                  <button
                    onClick={handleDenyRequest}
                    disabled={loading || pendingGroups.length === 0}
                    className="w-10 h-10 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    title="Deny Request"
                  >
                    {loading && (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    )}
                    {!loading && <XCircle className="w-5 h-5" />}
                  </button>
                  
                  <button
                    onClick={handleApproveRequest}
                    disabled={loading || pendingGroups.length === 0}
                    className="w-10 h-10 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    title="Approve Request"
                  >
                    {loading && (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    )}
                    {!loading && <CheckCircle className="w-5 h-5" />}
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
