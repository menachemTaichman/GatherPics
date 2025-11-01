import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Mail, Phone, FileText, Users, CheckCircle, XCircle, Search, ArrowUp, ArrowDown, AlertCircle } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { useToast } from '../../contexts/ToastContext';
import { requestsAPI, groupsAPI } from '../../utils/apiService';
import { useGroupsList, useMyRequestById } from '../../utils/dataManager';
import { useApplyScopes, getRepresentativeUrl, useEventId } from '../../utils/storeUtils';
import { formatErrorMessage } from '../../utils/errorHandler';
import { getCurrentProfile } from '../../utils/profileService';
import { usePreference } from '../../hooks/useSettings';
import { setPreference } from '../../utils/settings';
import { toggleSortOrder } from '../../utils/sorting';
import { useImageComponent, ImageComponent } from '../../hooks/useImage.jsx';

export default function RequestFormModal({ 
  isOpen, 
  onClose, 
  request = null, 
  eventUrl,
  urlHelpers
}) {
  const eventId = useEventId(eventUrl);
  const [formData, setFormData] = useState({
    requestType: 'own', // 'own' or 'new'
    applicant_name: '',
    applicant_email: '',
    applicant_phone: '',
    details: '',
    group_ids: [],
    communication_consent: false
  });
  const [loading, setLoading] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [currentStep, setCurrentStep] = useState(1); // 1 = profile details (only for new), 2 = groups + details
  const [lastSelectedIndex, setLastSelectedIndex] = useState(-1);
  const [initialGroups, setInitialGroups] = useState(new Set()); // Track initial groups for edit mode
  
  // Sort preferences
  const sortOrder = usePreference('GroupsGallery.sortDir', 'asc');
  const setSortOrder = (value) => setPreference('GroupsGallery.sortDir', value);
  
  const { showToast } = useToast();
  const currentProfile = useMemo(() => getCurrentProfile(), []);
  const currentProfileHasEmail = useMemo(() => {
    try {
      const stored = localStorage.getItem('frw_currentProfile');
      if (stored) {
        const profile = JSON.parse(stored);
        return !!(profile?.email);
      }
    } catch (e) {
      console.error('Error reading current profile email:', e);
    }
    return false;
  }, []);
  const allGroups = useGroupsList(eventId);
  
  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'request-form-modal';

  // Tooltip state
  const [showNotesTooltip, setShowNotesTooltip] = useState(false);
  const [notesTooltipPos, setNotesTooltipPos] = useState({ left: 0, top: 0 });
  const notesIconRef = useRef(null);
  
  // Fetch groups data when modal opens
  useEffect(() => {
    if (isOpen) {
      const fetchGroups = async () => {
        setIsLoadingGroups(true);
        try {
          await groupsAPI.getAll(eventUrl);
        } catch (error) {
          console.error('Failed to load groups:', error);
        } finally {
          setIsLoadingGroups(false);
        }
      };
      fetchGroups();
    }
  }, [isOpen, eventUrl]);

  // State for loading request data
  const [isLoadingRequest, setIsLoadingRequest] = useState(false);
  // Public submission view state (after creating from a public profile)
  const [createdRequestId, setCreatedRequestId] = useState(null);
  const [createdRequest, setCreatedRequest] = useState(null);
  const [isLoadingCreatedRequest, setIsLoadingCreatedRequest] = useState(false);
  
  // Try both id and access_request_id (normalization might use either)
  const requestId = useMemo(() => 
    request ? (request?.id || request?.access_request_id) : null,
    [request?.id, request?.access_request_id]
  );
  
  // Get request from store (which is updated by API interceptor)
  const storeRequest = useMyRequestById(eventId, requestId);
  
  // Use store request if available (has full data), otherwise use request prop
  const requestData = storeRequest || request;
  
  // Apply scopes for groups access and my_access_request - stabilize the ID
  const currentRequestId = useMemo(() => 
    requestData ? (requestData?.id || requestData?.access_request_id) : null,
    [requestData?.id, requestData?.access_request_id]
  );
  const isEditing = !!(currentRequestId);
  
  useApplyScopes(
    currentRequestId && isEditing
      ? [
          { entity: 'all', id: 'groups', eventId },
          { entity: 'my_access_request', id: currentRequestId, eventId }
        ]
      : [{ entity: 'all', id: 'groups', eventId }]
  );

  // Fetch request data when editing
  useEffect(() => {
    if (!isOpen || !requestId) {
      return;
    }
    
    // Always fetch fresh data when modal opens for editing to ensure we have the latest data
    // The API interceptor will update the store, and useMyRequestById will reactively update
    const fetchRequestData = async () => {
      setIsLoadingRequest(true);
      try {
        await requestsAPI.getMyRequestById(requestId, eventUrl);
      } catch (error) {
        console.error('Failed to load request:', error);
        showToast(formatErrorMessage('load request', error), 'error');
      } finally {
        setIsLoadingRequest(false);
      }
    };
    fetchRequestData();
  }, [isOpen, requestId, eventUrl]);

  // Register modal when opened
  useEffect(() => {
    if (isOpen) {
      registerModal({ 
        id: modalId, 
        type: 'popup',
        allowOutsideScroll: true
      });
      
      return () => {
        unregisterModal(modalId);
      };
    }
  }, [isOpen, registerModal, unregisterModal]);

  // Stabilize request data fields for effect dependencies to avoid infinite loops
  const requestDataId = useMemo(() => requestData?.id || requestData?.access_request_id, [requestData?.id, requestData?.access_request_id]);
  // Stabilize groups object reference - only recreate if groups actually change
  const requestDataGroupsKeys = useMemo(() => {
    const groups = requestData?.groups;
    if (!groups) return null;
    return Object.keys(groups).sort().join(',');
  }, [requestData?.groups]);
  const requestDataGroups = requestData?.groups;
  const requestDataApplicantName = requestData?.applicant_name;
  const requestDataApplicantEmail = requestData?.applicant_email;
  const requestDataApplicantPhone = requestData?.applicant_phone;
  const requestDataDetails = requestData?.details;
  const requestDataApplicantProfileId = requestData?.applicant_profile_id;
  const requestDataCommunicationConsent = requestData?.communication_consent;
  
  // Stabilize storeRequest presence check
  const hasStoreRequest = !!storeRequest;

  // Initialize form data
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    
    // When editing, wait for store request to be loaded if still loading
    if (requestId && !hasStoreRequest && isLoadingRequest) {
      // Still loading, don't initialize yet
      return;
    }
    
    if (requestData && requestDataId) {
      // Editing existing request (my-requests) – treat as 'own' by default
      const groupIds = requestDataGroups ? Object.keys(requestDataGroups) : [];
      setFormData({
        requestType: 'own',
        applicant_name: requestDataApplicantName || '',
        applicant_email: requestDataApplicantEmail || '',
        applicant_phone: requestDataApplicantPhone || '',
        details: requestDataDetails || '',
        group_ids: groupIds,
        applicant_profile_id: requestDataApplicantProfileId || (currentProfile?.id || currentProfile?.profile_id) || null,
        communication_consent: requestDataCommunicationConsent || false
      });
      setSelectedGroups(new Set(groupIds));
      setInitialGroups(new Set(groupIds)); // Store initial groups for calculating diff
    } else {
      // Creating new request - automatically determine type based on profile
      const requestType = currentProfile?.is_public ? 'new' : 'own';
      setFormData({
        requestType: requestType,
        applicant_name: requestType === 'new' ? '' : (currentProfile?.label || ''),
        applicant_email: '',
        applicant_phone: '',
        details: '',
        group_ids: [],
        applicant_profile_id: requestType === 'own' ? (currentProfile?.id || currentProfile?.profile_id) : null,
        communication_consent: false
      });
      setSelectedGroups(new Set());
      setInitialGroups(new Set()); // No initial groups for new requests
    }
    setSearchTerm('');
    // For 'own' requests, go directly to groups step (step 2). For 'new', start at step 1
    const calculatedRequestType = requestData && requestDataId ? 'own' : (currentProfile?.is_public ? 'new' : 'own');
    setCurrentStep(calculatedRequestType === 'own' ? 2 : 1);
  }, [
    isOpen, 
    requestId,
    requestDataId,
    isLoadingRequest,
    hasStoreRequest,
    requestDataGroupsKeys,
    requestDataApplicantName,
    requestDataApplicantEmail,
    requestDataApplicantPhone,
    requestDataDetails,
    requestDataApplicantProfileId,
    requestDataCommunicationConsent,
    currentProfile?.id,
    currentProfile?.is_public,
    currentProfile?.label
  ]);

  // Custom keyboard handler integrated with modal focus manager
  const handleRequestModalKeys = (e) => {
    if ((e.key === 'Enter' || e.key === 'NumpadEnter') && !e.shiftKey) {
      if (currentStep === 1) {
        if (canProceedToGroups()) {
          handleNextStep();
        }
        return true;
      }
      if (currentStep === 2) {
        if (selectedGroups.size > 0 && !loading && !isClosed && !isPublicSubmissionView) {
          // Call submit logic directly
          handleSubmit({ preventDefault: () => {} });
        }
        return true;
      }
      if (currentStep === 3) {
        handleClose();
        return true;
      }
    }
    return false;
  };

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId: modalId,
    modalType: 'popup',
    allowOutsideScroll: true,
    enableFocusTrapping: true,
    customKeyHandler: handleRequestModalKeys
  });

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Filter and sort groups (filter out unassociated groups)
  const filteredAndSortedGroups = useMemo(() => {
    return allGroups
      .filter(group => {
        // Show only groups that are not accessible (is_accessible === false/0)
        const isNotAccessible = group.is_accessible === false || group.is_accessible === 0;
        
        // Filter out unassociated groups
        const isUnassociated = group.label && group.label.toLowerCase() === 'unassociated';
        
        const label = group.label || `Person ${group.id}`;
        const matchesSearch = label.toLowerCase().includes(searchTerm.toLowerCase());
        
        return isNotAccessible && !isUnassociated && matchesSearch;
      })
      .sort((a, b) => {
        // Only sort by name
        const aValue = a.label || `Person ${a.id}`;
        const bValue = b.label || `Person ${b.id}`;
        
        if (sortOrder === 'asc') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      })
      .reduce((unique, group) => {
        if (!unique.some(g => g.id === group.id)) {
          unique.push(group);
        }
        return unique;
      }, []);
  }, [allGroups, searchTerm, sortOrder]);

  const handleGroupToggle = (groupId, event) => {
    const groupIndex = filteredAndSortedGroups.findIndex(g => g.id === groupId);
    
    if (event?.shiftKey && lastSelectedIndex !== -1) {
      // Shift-click: select range
      const start = Math.min(lastSelectedIndex, groupIndex);
      const end = Math.max(lastSelectedIndex, groupIndex);
      
      setSelectedGroups(prev => {
        const newSet = new Set(prev);
        for (let i = start; i <= end; i++) {
          const group = filteredAndSortedGroups[i];
          if (group) {
            newSet.add(group.id);
          }
        }
        return newSet;
      });
    } else {
      // Regular click: toggle single group
      setSelectedGroups(prev => {
        const newSet = new Set(prev);
        if (newSet.has(groupId)) {
          newSet.delete(groupId);
        } else {
          newSet.add(groupId);
        }
        return newSet;
      });
      setLastSelectedIndex(groupIndex);
    }
  };

  const handleToggleSortOrder = () => {
    const newOrder = toggleSortOrder(sortOrder);
    setSortOrder(newOrder);
  };

  const handleNextStep = () => {
    // Validate step 1 before proceeding (only for 'new' request type)
    if (currentStep === 1) {
      if (formData.requestType === 'new') {
        if (!formData.applicant_name.trim()) {
          showToast('Profile name is required', 'error');
          return;
        }
        if (!formData.applicant_email.trim()) {
          showToast('Email is required for new profiles', 'error');
          return;
        }
      }
    }
    setCurrentStep(2);
  };
  
  // Handle Enter key
  const handleKeyDown = (e) => {
    // If in textarea and Shift+Enter, allow default (newline)
    if (e.target.tagName === 'TEXTAREA' && e.shiftKey) {
      return; // Allow default behavior for Shift+Enter in textarea
    }
    
    if ((e.key === 'Enter' || e.key === 'NumpadEnter') && !e.shiftKey) {
      e.preventDefault();
      if (currentStep === 1) {
        // On step 1, go to next step if valid
        handleNextStep();
      } else if (currentStep === 2) {
        // On step 2, submit if valid
        if (selectedGroups.size > 0 && !loading && !isClosed && !isPublicSubmissionView) {
          handleSubmit(e);
        }
      } else if (currentStep === 3) {
        // On submitted step, Enter closes modal
        handleClose();
      }
    }
  };

  // Route form submit by step to ensure Enter behaves correctly in all browsers
  const handleFormSubmit = (e) => {
    if (currentStep === 1) {
      e.preventDefault();
      handleNextStep();
      return;
    }
    if (currentStep === 2) {
      return handleSubmit(e);
    }
    if (currentStep === 3) {
      e.preventDefault();
      handleClose();
      return;
    }
  };


  const handlePrevStep = () => {
    setCurrentStep(1);
  };

  const canProceedToGroups = () => {
    if (formData.requestType === 'new') {
      return formData.applicant_name.trim() && formData.applicant_email.trim();
    }
    return true; // For "myself" requests, no required fields
  };

  // Check if request is closed (read-only mode)
  const isClosed = requestData ? (requestData?.status && requestData.status !== 'pending') : false;
  const isPublicSubmissionView = !!createdRequestId;
  
  // Split groups by status (always calculate for both open and closed requests)
  const groupEntries = requestData?.groups ? Object.entries(requestData.groups) : [];
  const approvedGroups = groupEntries.filter(([groupId, groupData]) => {
    const approved = groupData.approved;
    return approved === true || approved === 1;
  });
  const deniedGroups = groupEntries.filter(([groupId, groupData]) => {
    const approved = groupData.approved;
    return approved === false || approved === 0;
  });
  
  // Sort approved and denied groups by label
  const sortByLabel = ([idA], [idB]) => {
    const groupA = allGroups.find(g => (g.id || g.group_id) === idA);
    const groupB = allGroups.find(g => (g.id || g.group_id) === idB);
    const labelA = groupA?.label || '';
    const labelB = groupB?.label || '';
    return labelA.localeCompare(labelB);
  };
  approvedGroups.sort(sortByLabel);
  deniedGroups.sort(sortByLabel);
  
  const getGroupDisplayName = (groupId) => {
    const group = allGroups.find(g => (g.id || g.group_id) === groupId);
    if (!group) return 'Unknown';
    const id = group.id || group.group_id || '';
    return group.label || `Person ${id}`;
  };

  // Calculate count of selectable groups (excluding already approved/denied groups)
  const selectableGroupsCount = useMemo(() => {
    let count = 0;
    selectedGroups.forEach(groupId => {
      // Find matching group entry (handle both string and number IDs)
      const groupEntry = groupEntries.find(([id]) => {
        const entryId = String(id);
        const selectedId = String(groupId);
        return entryId === selectedId;
      });
      
      if (groupEntry) {
        const [, groupData] = groupEntry;
        const approved = groupData.approved;
        // Only count groups that haven't been processed yet (not approved and not denied)
        if (approved !== true && approved !== 1 && approved !== false && approved !== 0) {
          count++;
        }
      } else {
        // New group not yet in request data, count it
        count++;
      }
    });
    return count;
  }, [selectedGroups, groupEntries]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Prevent submission if closed
    if (isClosed) {
      showToast('Cannot modify closed requests', 'error');
      return;
    }
    
    // Validate groups selection
    if (selectedGroups.size === 0) {
      showToast('Please select at least one group', 'error');
      return;
    }
    
    // Validate required fields based on request type
    if (formData.requestType === 'new') {
      if (!formData.applicant_name.trim()) {
        showToast('Profile name is required', 'error');
        return;
      }
      if (!formData.applicant_email.trim()) {
        showToast('Email is required for new profiles', 'error');
        return;
      }
      if (!formData.communication_consent) {
        showToast('Communication consent is required for new profiles', 'error');
        return;
      }
    }
    

    setLoading(true);
    
    try {
      const submitData = {
        applicant_name: formData.applicant_name.trim(),
        applicant_email: formData.applicant_email.trim() || null,
        applicant_phone: formData.applicant_phone.trim() || null,
        details: formData.details.trim() || null,
        applicant_profile_id: formData.requestType === 'own' ? formData.applicant_profile_id : null,
        communication_consent: formData.communication_consent
      };

      if (request) {
        // Update existing request (using my-requests route)
        const requestId = request?.id || request?.access_request_id;
        if (!requestId) {
          showToast('Cannot update request: ID not found', 'error');
          return;
        }
        
        // Calculate groups to add and remove
        const groupsToAdd = Array.from(selectedGroups).filter(id => !initialGroups.has(id));
        const groupsToRemove = Array.from(initialGroups).filter(id => !selectedGroups.has(id));
        
        submitData.groups_to_add = groupsToAdd;
        submitData.groups_to_remove = groupsToRemove;
        
        await requestsAPI.updateMyRequest(requestId, submitData, eventUrl);
        showToast('Request updated successfully', 'success');
      } else {
        // Create new request
        submitData.group_ids = Array.from(selectedGroups);
        const result = await requestsAPI.create(submitData, eventUrl);
        showToast('Request created successfully', 'success');

        // If submitted from a public profile, keep modal open and show created request section
        if (formData.requestType === 'new') {
          const newId = result?.id || result?.access_request_id;
          if (newId) {
            setCreatedRequestId(newId);
            setCurrentStep(3);
            setIsLoadingCreatedRequest(true);
            try {
              const fresh = await requestsAPI.getMyRequestById(newId, eventUrl, { _t: Date.now() });
              setCreatedRequest(fresh?.request || fresh);
            } catch (err) {
              // Fallback to minimal data if fetch fails
              setCreatedRequest({ ...(result?.request || result), access_request_id: newId, id: newId, details: submitData.details, groups: Object.fromEntries(Array.from(selectedGroups).map(id => [String(id), { approved: null }])) });
            } finally {
              setIsLoadingCreatedRequest(false);
            }
          }
          return; // Do not close modal in public flow
        }
      }
      
      onClose();
    } catch (error) {
      console.error('Failed to save request:', error);
      showToast(formatErrorMessage('save request', error), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={handleClose}>
      <motion.div
        ref={modalRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {request ? 'Edit Request' : 'Create Request'}
              </h2>
              <div className="flex items-center space-x-2 mt-1">
                {formData.requestType === 'new' && (
                  <>
                    <div className={`w-2 h-2 rounded-full ${currentStep >= 1 ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
                    <span className="text-sm text-gray-600">Profile</span>
                  </>
                )}
                <div className={`w-2 h-2 rounded-full ${currentStep >= 2 ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
                <span className="text-sm text-gray-600">Groups</span>
                {currentStep >= 3 && (
                  <>
                    <div className={`w-2 h-2 rounded-full ${currentStep >= 3 ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
                    <span className="text-sm text-gray-600">Submitted</span>
                  </>
                )}
              </div>
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
        <form onSubmit={handleFormSubmit} onKeyDown={handleKeyDown} className="flex-1 overflow-y-auto p-6">
          {currentStep === 3 ? (
            <div className="space-y-4">
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <div className="flex items-start gap-3 mb-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
                  <p className="text-sm text-gray-700">
                    This information will not be accessible until the request is approved.
                  </p>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center">
                    <span className="w-32 text-gray-500">Request ID</span>
                    <span className="font-medium">{createdRequestId}</span>
                  </div>
                  <div className="flex items-start">
                    <span className="w-32 text-gray-500">Groups</span>
                    <div className="flex-1">
                      {isLoadingCreatedRequest ? (
                        <span className="text-gray-500">Loading…</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {(() => {
                            const groupsObj = (createdRequest?.groups) || Object.fromEntries(Array.from(selectedGroups).map(id => [String(id), { approved: null }]));
                            const ids = Object.keys(groupsObj);
                            if (ids.length === 0) return <span className="text-gray-500">None</span>;
                            return ids.map((gid) => {
                              const group = allGroups.find(g => String(g.id || g.group_id) === String(gid));
                              const label = group?.label || `Person ${gid}`;
                              return (
                                <span key={gid} className="px-2 py-1 text-xs rounded-full bg-gray-200 text-gray-800">{label}</span>
                              );
                            });
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start">
                    <span className="w-32 text-gray-500">Details</span>
                    <span className="whitespace-pre-line flex-1">{createdRequest?.details || formData.details || '—'}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
            {/* Step 1: Profile Details (only for new profile requests) */}
            {currentStep === 1 && (
              <>
                {/* Applicant Name - Only show for new profile requests */}
                {formData.requestType === 'new' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Profile Name *
                    </label>
                    <input
                      type="text"
                      value={formData.applicant_name}
                      onChange={(e) => !(isClosed || isPublicSubmissionView) && handleInputChange('applicant_name', e.target.value)}
                      readOnly={isClosed || isPublicSubmissionView}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 read-only:bg-gray-50 read-only:cursor-default"
                      placeholder="Enter profile name"
                      required
                    />
                  </div>
                )}

                {/* Email and Phone - Only show for new profile requests */}
                {formData.requestType === 'new' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <Mail className="w-4 h-4 inline mr-1" />
                        Email *
                      </label>
                      <input
                        type="email"
                        value={formData.applicant_email}
                        onChange={(e) => !(isClosed || isPublicSubmissionView) && handleInputChange('applicant_email', e.target.value)}
                        readOnly={isClosed || isPublicSubmissionView}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 read-only:bg-gray-50 read-only:cursor-default"
                        placeholder="Enter email address"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <Phone className="w-4 h-4 inline mr-1" />
                        Phone
                      </label>
                      <input
                        type="tel"
                        value={formData.applicant_phone}
                        onChange={(e) => !(isClosed || isPublicSubmissionView) && handleInputChange('applicant_phone', e.target.value)}
                        readOnly={isClosed || isPublicSubmissionView}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 read-only:bg-gray-50 read-only:cursor-default"
                        placeholder="Enter phone number"
                      />
                    </div>
                  </>
                )}

              </>
            )}

            {/* Step 2: Groups Selection + Details */}
            {currentStep === 2 && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    <Users className="w-4 h-4 inline mr-1" />
                    Select Groups *
                  </label>
                
                {/* Show approved/denied lists when closed, otherwise show selectable grid */}
                {(isClosed || isPublicSubmissionView) ? (
                  <div className="space-y-4">
                    {/* Approved Groups List */}
                    {approvedGroups.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center space-x-1.5">
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <span>Approved</span>
                        </h4>
                        <div className="flex items-center space-x-3 overflow-x-auto pb-1">
                          {approvedGroups.map(([groupId]) => {
                            const group = allGroups.find(g => (g.id || g.group_id) === groupId);
                            return (
                              <div
                                key={groupId}
                                className="flex-shrink-0"
                                title={getGroupDisplayName(groupId)}
                              >
                                <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-green-500 bg-green-100 flex items-center justify-center">
                                  {ImageComponent(
                                    group?.representative_face && group?.id 
                                      ? `${getRepresentativeUrl(urlHelpers, 'groups', group.id)}?v=${group.representative_face || 'none'}`
                                      : null,
                                    {
                                      width: 32,
                                      height: 32,
                                      className: 'w-full h-full object-cover',
                                      alt: getGroupDisplayName(groupId),
                                      iconType: 'person'
                                    }
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Denied Groups List */}
                    {deniedGroups.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center space-x-1.5">
                          <XCircle className="w-4 h-4 text-red-600" />
                          <span>Denied</span>
                        </h4>
                        <div className="flex items-center space-x-3 overflow-x-auto pb-1">
                          {deniedGroups.map(([groupId]) => {
                            const group = allGroups.find(g => (g.id || g.group_id) === groupId);
                            return (
                              <div
                                key={groupId}
                                className="flex-shrink-0"
                                title={getGroupDisplayName(groupId)}
                              >
                                <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-red-500 bg-red-100 flex items-center justify-center">
                                  {ImageComponent(
                                    group?.representative_face && group?.id 
                                      ? `${getRepresentativeUrl(urlHelpers, 'groups', group.id)}?v=${group.representative_face || 'none'}`
                                      : null,
                                    {
                                      width: 32,
                                      height: 32,
                                      className: 'w-full h-full object-cover',
                                      alt: getGroupDisplayName(groupId),
                                      iconType: 'person'
                                    }
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {approvedGroups.length === 0 && deniedGroups.length === 0 && (
                      <div className="text-center py-8 text-gray-500">
                        <Users className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                        <p className="text-sm">No groups in this request</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Loading state */}
                    {isLoadingGroups && (
                      <div className="text-center py-8">
                        <div className="inline-flex items-center space-x-2 text-gray-500">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                          <span>Loading groups...</span>
                        </div>
                      </div>
                    )}
                    
                    {/* Search and Sort Controls */}
                    {!isLoadingGroups && (
                  <>
                    <div className="mb-4 flex flex-col sm:flex-row gap-3">
                      {/* Search */}
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Search groups..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      
                      {/* Sort Controls */}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleToggleSortOrder}
                          className="w-8 h-8 border border-transparent rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center"
                          title={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
                        >
                          {sortOrder === 'asc' ? (
                            <ArrowUp className="w-4 h-4" />
                          ) : (
                            <ArrowDown className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Groups Grid */}
                    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-4">
                      {filteredAndSortedGroups.map((group) => (
                        <div
                          key={group.id || `group-${Math.random()}`}
                          className={`p-2 border border-transparent rounded-lg cursor-pointer transition-colors ${
                            selectedGroups.has(group.id)
                              ? 'border-blue-500 bg-blue-50'
                              : 'hover:border-gray-300'
                          }`}
                          onClick={(e) => handleGroupToggle(group.id, e)}
                        >
                          <div className="flex flex-col items-center space-y-1">
                            {/* Representative image */}
                            <div className="w-12 h-12 rounded-full overflow-hidden border border-gray-200">
                              {group.representative_face && group.id ? (
                                <img
                                  src={`${getRepresentativeUrl(urlHelpers, 'groups', group.id)}?v=${group.representative_face}`}
                                  alt={group.label}
                                  className="w-full h-full object-cover rounded-full"
                                />
                              ) : (
                                <div className="w-full h-full bg-gray-200 rounded-full flex items-center justify-center">
                                  <User className="w-6 h-6 text-gray-500" />
                                </div>
                              )}
                            </div>
                            <div className="text-center">
                              <p className="font-medium text-gray-900 text-xs truncate w-full">
                                {group.label || `Person ${group.id}`}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                      {filteredAndSortedGroups.length === 0 && (
                        <div className="col-span-full text-center py-8 text-gray-500">
                          {searchTerm ? 'No groups found matching your search' : 'No groups available'}
                        </div>
                      )}
                    </div>
                    
                    <p className="text-xs text-gray-500 mt-2">
                      Selected {selectableGroupsCount} group{selectableGroupsCount !== 1 ? 's' : ''}
                    </p>
                      </>
                    )}

                    {/* Approved and Denied Groups List - Show below grid for open requests */}
                    {(approvedGroups.length > 0 || deniedGroups.length > 0) && (
                      <div className="mt-4 space-y-4">
                        {/* Approved Groups List */}
                        {approvedGroups.length > 0 && (
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center space-x-1.5">
                              <CheckCircle className="w-4 h-4 text-green-600" />
                              <span>Approved</span>
                            </h4>
                            <div className="flex items-center space-x-3 overflow-x-auto pb-1">
                              {approvedGroups.map(([groupId]) => {
                                const group = allGroups.find(g => (g.id || g.group_id) === groupId);
                                return (
                                  <div
                                    key={groupId}
                                    className="flex-shrink-0"
                                    title={getGroupDisplayName(groupId)}
                                  >
                                    <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-green-500 bg-green-100 flex items-center justify-center">
                                      {ImageComponent(
                                        group?.representative_face && group?.id 
                                          ? `${getRepresentativeUrl(urlHelpers, 'groups', group.id)}?v=${group.representative_face || 'none'}`
                                          : null,
                                        {
                                          width: 32,
                                          height: 32,
                                          className: 'w-full h-full object-cover',
                                          alt: getGroupDisplayName(groupId),
                                          iconType: 'person'
                                        }
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Denied Groups List */}
                        {deniedGroups.length > 0 && (
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center space-x-1.5">
                              <XCircle className="w-4 h-4 text-red-600" />
                              <span>Denied</span>
                            </h4>
                            <div className="flex items-center space-x-3 overflow-x-auto pb-1">
                              {deniedGroups.map(([groupId]) => {
                                const group = allGroups.find(g => (g.id || g.group_id) === groupId);
                                return (
                                  <div
                                    key={groupId}
                                    className="flex-shrink-0"
                                    title={getGroupDisplayName(groupId)}
                                  >
                                    <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-red-500 bg-red-100 flex items-center justify-center">
                                      {ImageComponent(
                                        group?.representative_face && group?.id 
                                          ? `${getRepresentativeUrl(urlHelpers, 'groups', group.id)}?v=${group.representative_face || 'none'}`
                                          : null,
                                        {
                                          width: 32,
                                          height: 32,
                                          className: 'w-full h-full object-cover',
                                          alt: getGroupDisplayName(groupId),
                                          iconType: 'person'
                                        }
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
                </div>
                
                {/* Details field at bottom of groups step */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <FileText className="w-4 h-4 inline mr-1" />
                    Details
                  </label>
                  <textarea
                    value={formData.details}
                    onChange={(e) => !(isClosed || isPublicSubmissionView) && handleInputChange('details', e.target.value)}
                    readOnly={isClosed || isPublicSubmissionView}
                    onKeyDown={handleKeyDown}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 read-only:bg-gray-50 read-only:cursor-default"
                    placeholder="Additional information about the request"
                  />
                </div>
                
                {/* Communication Consent - Show if new profile or current profile has email */}
                {(formData.requestType === 'new' || currentProfileHasEmail) && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <label className="flex items-start space-x-3 cursor-pointer group">
                      <div className="flex items-center h-5">
                        <input
                          type="checkbox"
                          checked={formData.communication_consent}
                          onChange={(e) => !(isClosed || isPublicSubmissionView) && handleInputChange('communication_consent', e.target.checked)}
                          disabled={isClosed || isPublicSubmissionView}
                          className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </div>
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-900 group-hover:text-gray-700">
                          I consent to receive communications about this request {formData.requestType === 'new' ? '*' : ''}
                        </span>
                        <p className="text-xs text-gray-600 mt-1">
                          The event manager will use your email to notify you about the status of your access request.
                        </p>
                      </div>
                    </label>
                  </div>
                )}
                {Array.isArray(requestData?.closed_details) && requestData.closed_details.length > 0 && (
                  <div className="flex items-center gap-2 mt-3">
                    <span className="flex items-center gap-1 group relative text-xs font-semibold text-blue-700">
                      <AlertCircle
                        className="w-4 h-4 text-blue-500 cursor-pointer"
                        ref={notesIconRef}
                        onMouseEnter={e => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setNotesTooltipPos({
                            left: rect.left,
                            top: rect.bottom + 8
                          });
                          setShowNotesTooltip(true);
                        }}
                        onMouseLeave={() => setShowNotesTooltip(false)}
                      />
                      <span
                        onMouseEnter={e => {
                          if (notesIconRef.current) {
                            const rect = notesIconRef.current.getBoundingClientRect();
                            setNotesTooltipPos({ left: rect.left, top: rect.bottom + 8 });
                            setShowNotesTooltip(true);
                          }
                        }}
                        onMouseLeave={() => setShowNotesTooltip(false)}
                      >Manager Response Notes</span>
                      {showNotesTooltip &&
                        <span
                          className="fixed px-5 py-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg whitespace-pre-line min-w-[250px] max-w-[400px] text-left pointer-events-auto z-[10000]"
                          style={{ left: notesTooltipPos.left, top: notesTooltipPos.top }}
                        >
                          {requestData.closed_details.map((detail, idx) => `${idx + 1}. ${detail}`).join('\n')}
                        </span>
                      }
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <div className="flex justify-between items-center">
            {/* Step Navigation */}
            <div className="flex items-center space-x-3">
              {currentStep === 2 && formData.requestType === 'new' && (
                <button
                  type="button"
                  onClick={handlePrevStep}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Back to Profile
                </button>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center space-x-3">
              {currentStep !== 3 && (
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={loading}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
              {currentStep === 3 && (
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  Close
                </button>
              )}
              
              {currentStep === 1 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  disabled={!canProceedToGroups() || isClosed || isPublicSubmissionView}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next: Select Groups
                </button>
              ) : (
                (currentStep === 2 && !isClosed && !isPublicSubmissionView) && (
                  <button
                    type="submit"
                    onClick={handleSubmit}
                    disabled={loading || selectedGroups.size === 0}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 flex items-center space-x-2"
                  >
                    {loading && (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    )}
                    <span>{request ? 'Update Request' : 'Create Request'}</span>
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
