import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Mail, Phone, FileText, Users, CheckCircle, XCircle, Search, ArrowUp, ArrowDown, AlertCircle, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { useToast } from '../../contexts/ToastContext';
import { requestsAPI, profilesAPI } from '../../utils/apiService';
import { useMyRequestById } from '../../utils/dataManager';
import { useApplyScopes, getRepresentativeUrl, useEventId } from '../../utils/storeUtils';
import { formatErrorMessage } from '../../utils/errorHandler';
import { getCurrentProfile } from '../../utils/profileService';
import { usePreference } from '../../hooks/useSettings';
import { setPreference } from '../../utils/settings';
import { toggleSortOrder } from '../../utils/sorting';
import { useImageComponent, ImageComponent } from '../../hooks/useImage.jsx';
import { API_BASE } from '../../utils/apiService';
import { formatDateTimeLocale } from '../../utils/dateUtils';

export default function RequestFormModal({ 
  isOpen, 
  onClose, 
  request = null, 
  eventUrl,
  urlHelpers
}) {
  const { t } = useTranslation();
  const { isRTL, startClass, me, ps, pe } = useRTL();
  const eventId = useEventId(eventUrl);
  
  // Helper function to get representative URL with fallback to local eventId
  const getRepUrl = useCallback((entity, parentId) => {
    if (!parentId) return null;
    
    // Try urlHelpers first
    if (urlHelpers?.getRepresentativeUrl) {
      const url = urlHelpers.getRepresentativeUrl(entity, parentId);
      if (url) return url;
    }
    
    // Fallback: use local eventId if available
    if (eventId) {
      return `${API_BASE}/api/events/${eventId}/${entity}/${parentId}/representative`;
    }
    
    return null;
  }, [urlHelpers, eventId]);
  
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
  const currentProfileId = currentProfile?.id || currentProfile?.profile_id;
  const currentProfileHasEmail = !!(currentProfile?.email);
  const [allGroups, setAllGroups] = useState([]);
  const currentProfileIsPublic = Boolean(currentProfile?.is_public);
  
  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'request-form-modal';

  // Tooltip state
  const [showNotesTooltip, setShowNotesTooltip] = useState(false);
  const [notesTooltipPos, setNotesTooltipPos] = useState({ left: 0, top: 0 });
  const notesIconRef = useRef(null);
  
  // Fetch groups to request access when modal opens
  useEffect(() => {
    if (isOpen) {
      const fetchGroups = async () => {
        setIsLoadingGroups(true);
        try {
          const response = await profilesAPI.getGroupsToRequestAccess(eventUrl);
          const groups = (response?.groups || []).map(group => {
            const mapped = {
              id: group.group_id,
              group_id: group.group_id,
              label: group.label,
              representative_face: group.rep_id || group.representative_face
            };
            return mapped;
          });
          setAllGroups(groups);
        } catch (error) {
          console.error('Failed to load groups:', error);
          showToast(formatErrorMessage('load groups', error), 'error');
        } finally {
          setIsLoadingGroups(false);
        }
      };
      fetchGroups();
    } else {
      // Reset groups when modal closes
      setAllGroups([]);
    }
  }, [isOpen, eventUrl, showToast]);

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
          { entity: 'my_access_request', id: currentRequestId, eventId }
        ]
      : []
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
      // Only include pending groups (not approved, not denied) in initial selection
      const allGroupIds = requestDataGroups ? Object.keys(requestDataGroups) : [];
      const pendingIds = allGroupIds.filter(groupId => {
        const groupData = requestDataGroups[groupId];
        const approved = groupData?.approved;
        return approved !== true && approved !== 1 && approved !== false && approved !== 0;
      });
      setFormData({
        requestType: 'own',
        applicant_name: requestDataApplicantName || '',
        applicant_email: requestDataApplicantEmail || '',
        applicant_phone: requestDataApplicantPhone || '',
        details: requestDataDetails || '',
        group_ids: pendingIds,
        applicant_profile_id: requestDataApplicantProfileId || (currentProfile?.id || currentProfile?.profile_id) || null,
        communication_consent: requestDataCommunicationConsent || false
      });
      setSelectedGroups(new Set(pendingIds));
      setInitialGroups(new Set(pendingIds)); // Store only pending groups for calculating diff
    } else {
      // Creating new request - automatically determine type based on profile
      const requestType = currentProfileIsPublic ? 'new' : 'own';
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
    const calculatedRequestType = requestData && requestDataId ? 'own' : (currentProfileIsPublic ? 'new' : 'own');
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
    currentProfileIsPublic,
    currentProfile?.label
  ]);

  // Custom keyboard handler integrated with modal focus manager
  const handleRequestModalKeys = (e) => {
    const targetTagName = e.target.tagName?.toLowerCase();
    
    // Handle button elements - prevent Enter from triggering toggle buttons, route to save instead
    if (targetTagName === 'button') {
      // Check if this is the save button using data attribute
      const isSaveButton = e.target.dataset?.isSaveButton === 'true';
      
      // Allow save button to work normally
      if (isSaveButton && e.key === 'Enter') {
        return false; // Let form submission handle it
      }
      // For other buttons (like toggles), prevent Enter from triggering them
      // Instead, trigger appropriate action based on step
      if ((e.key === 'Enter' || e.key === 'NumpadEnter') && !e.shiftKey) {
        if (currentStep === 1) {
          if (canProceedToGroups()) {
            e.preventDefault();
            e.stopPropagation();
            handleNextStep();
          }
          return true;
        }
        if (currentStep === 2) {
          if (selectedGroups.size > 0 && !loading && !isClosed && !isPublicSubmissionView) {
            e.preventDefault();
            e.stopPropagation();
            handleSubmit({ preventDefault: () => {} });
          }
          return true;
        }
        if (currentStep === 3) {
          e.preventDefault();
          e.stopPropagation();
          handleClose();
          return true;
        }
        return true;
      }
      // For ESC key, return false to let useModalFocus handle closing the modal
      if (e.key === 'Escape') {
        return false;
      }
      // For other keys on buttons, allow default behavior
      return true;
    }
    
    // Allow all normal input behavior for input, textarea, and select elements
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      // For Enter key, trigger appropriate action based on step
      if ((e.key === 'Enter' || e.key === 'NumpadEnter') && !e.shiftKey) {
        if (currentStep === 1) {
          if (canProceedToGroups()) {
            e.preventDefault();
            e.stopPropagation();
            handleNextStep();
          }
          return true;
        }
        if (currentStep === 2) {
          if (selectedGroups.size > 0 && !loading && !isClosed && !isPublicSubmissionView) {
            e.preventDefault();
            e.stopPropagation();
            handleSubmit(e);
          }
          return true;
        }
        if (currentStep === 3) {
          e.preventDefault();
          e.stopPropagation();
          handleClose();
          return true;
        }
        return true;
      }
      // For ESC key, return false to let useModalFocus handle closing the modal
      if (e.key === 'Escape') {
        return false;
      }
      // Return true to signal that we're handling this, preventing useModalFocus from stopping it
      return true;
    }
    
    return false; // Let default modal behavior handle it (ESC to close)
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
          showToast(t('requestForm.profileNameIsRequired'), 'error');
          return;
        }
        if (!formData.applicant_email.trim()) {
          showToast(t('requestForm.emailIsRequiredForNewProfiles'), 'error');
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
  
  // Create a set of denied group IDs for efficient lookup
  const deniedGroupIds = useMemo(() => {
    return new Set(deniedGroups.map(([groupId]) => String(groupId)));
  }, [deniedGroups]);

  // Filter and sort groups
  const filteredAndSortedGroups = useMemo(() => {
    return allGroups
      .filter(group => {
        // Exclude denied groups
        const groupIdStr = String(group.id || group.group_id);
        if (deniedGroupIds.has(groupIdStr)) {
          return false;
        }
        
        const label = group.label || `Person ${group.id}`;
        const matchesSearch = label.toLowerCase().includes(searchTerm.toLowerCase());
        
        return matchesSearch;
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
  }, [allGroups, searchTerm, sortOrder, deniedGroupIds]);
  
  // Sort approved and denied groups by label
  const sortByLabel = ([idA, groupDataA], [idB, groupDataB]) => {
    // Prefer label from request relation, fallback to allGroups
    const labelA = groupDataA?.label || allGroups.find(g => (g.id || g.group_id) === idA)?.label || '';
    const labelB = groupDataB?.label || allGroups.find(g => (g.id || g.group_id) === idB)?.label || '';
    return labelA.localeCompare(labelB);
  };
  approvedGroups.sort(sortByLabel);
  deniedGroups.sort(sortByLabel);
  
  // Calculate pending groups (not approved and not denied)
  const pendingGroupIds = useMemo(() => {
    if (!requestData?.groups) return new Set();
    return new Set(
      Object.entries(requestData.groups)
        .filter(([groupId, groupData]) => {
          const approved = groupData.approved;
          return approved !== true && approved !== 1 && approved !== false && approved !== 0;
        })
        .map(([groupId]) => String(groupId))
    );
  }, [requestData?.groups]);
  
  const getGroupDisplayName = (groupId) => {
    // Prefer label from request relation, fallback to allGroups
    const groupData = requestData?.groups?.[groupId];
    if (groupData?.label) {
      return groupData.label;
    }
    const group = allGroups.find(g => (g.id || g.group_id) === groupId);
    if (!group) return 'Unknown';
    const id = group.id || group.group_id || '';
    return group.label || `Person ${id}`;
  };
  
  const getGroupRepresentativeFace = (groupId) => {
    // Prefer representative_face from request relation, fallback to allGroups
    const groupData = requestData?.groups?.[groupId];
    if (groupData?.representative_face) {
      return groupData.representative_face;
    }
    const group = allGroups.find(g => (g.id || g.group_id) === groupId);
    return group?.representative_face || null;
  };

  // Detect if there are changes (only for edit mode)
  const hasChanges = useMemo(() => {
    if (!isEditing) return true; // Always allow creation
    
    // Check if groups have changed
    const selectedSet = new Set(Array.from(selectedGroups).map(id => String(id)));
    const initialSet = new Set(Array.from(initialGroups).map(id => String(id)));
    
    // Check if sets are different
    if (selectedSet.size !== initialSet.size) return true;
    for (const id of selectedSet) {
      if (!initialSet.has(id)) return true;
    }
    for (const id of initialSet) {
      if (!selectedSet.has(id)) return true;
    }
    
    // Check if form fields have changed
    if (formData.applicant_name.trim() !== (requestData?.applicant_name || '').trim()) return true;
    if (formData.applicant_email.trim() !== (requestData?.applicant_email || '').trim()) return true;
    if (formData.applicant_phone.trim() !== (requestData?.applicant_phone || '').trim()) return true;
    if (formData.details.trim() !== (requestData?.details || '').trim()) return true;
    if (formData.communication_consent !== (requestData?.communication_consent || false)) return true;
    
    return false;
  }, [isEditing, selectedGroups, initialGroups, formData, requestData]);

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
      showToast(t('requestForm.cannotModifyClosedRequests'), 'error');
      return;
    }
    
    // Validate groups selection
    // Allow removing all groups if there are closed (approved/denied) groups in the request
    const hasClosedGroups = approvedGroups.length > 0 || deniedGroups.length > 0;
    if (selectedGroups.size === 0 && (!isEditing || !hasClosedGroups)) {
      showToast(t('requestForm.pleaseSelectAtLeastOneGroup'), 'error');
      return;
    }
    
    // Validate required fields based on request type
    if (formData.requestType === 'new') {
      if (!formData.applicant_name.trim()) {
        showToast(t('requestForm.profileNameIsRequired'), 'error');
        return;
      }
      if (!formData.applicant_email.trim()) {
        showToast(t('requestForm.emailIsRequiredForNewProfiles'), 'error');
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
          showToast(t('requestForm.cannotUpdateRequestIdNotFound'), 'error');
          return;
        }
        
        // Calculate groups to add and remove
        const groupsToAdd = Array.from(selectedGroups).filter(id => !initialGroups.has(id));
        const groupsToRemove = Array.from(initialGroups).filter(id => !selectedGroups.has(id));
        
        submitData.groups_to_add = groupsToAdd;
        submitData.groups_to_remove = groupsToRemove;
        
        await requestsAPI.updateMyRequest(requestId, submitData, eventUrl);
        showToast(t('requestForm.requestUpdatedSuccessfully'), 'success');
      } else {
        // Create new request
        submitData.group_ids = Array.from(selectedGroups);
        const result = await requestsAPI.create(submitData, eventUrl);
        showToast(t('requestForm.requestCreatedSuccessfully'), 'success');

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
        dir={isRTL ? 'rtl' : 'ltr'}
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {request ? t('requestForm.editRequest') : t('requestForm.createRequest')}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                {formData.requestType === 'new' && (
                  <>
                    <div className={`w-2 h-2 rounded-full ${currentStep >= 1 ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
                    <span className="text-sm text-gray-600">{t('requestForm.profile')}</span>
                  </>
                )}
                <div className={`w-2 h-2 rounded-full ${currentStep >= 2 ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
                <span className="text-sm text-gray-600">{t('requestForm.groups')}</span>
                {currentStep >= 3 && (
                  <>
                    <div className={`w-2 h-2 rounded-full ${currentStep >= 3 ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
                    <span className="text-sm text-gray-600">{t('requestForm.submitted')}</span>
                  </>
                )}
              </div>
              {isClosed && requestData?.closed_at && (
                <div className="flex items-center gap-1 mt-1">
                  <Clock className="w-3 h-3 text-gray-400" />
                  <span className="text-xs text-gray-500">{t('requestForm.closed')}: {formatDateTimeLocale(requestData.closed_at)}</span>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
            title={t('requestForm.close')}
            aria-label={t('requestForm.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleFormSubmit} onKeyDown={handleKeyDown} className="flex-1 overflow-y-auto px-6 py-4">
          {currentStep === 3 ? (
            <div className="space-y-4">
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <div className="flex items-start gap-3 mb-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
                  <p className="text-sm text-gray-700">
                    {t('requestForm.informationNotAccessible')}
                  </p>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center">
                    <span className={`w-32 text-gray-500 ${me('2')}`}>{t('requestForm.requestId')}</span>
                    <span className="font-medium">{createdRequestId}</span>
                  </div>
                  <div className="flex items-start">
                    <span className={`w-32 text-gray-500 ${me('2')}`}>{t('requestForm.groups')}</span>
                    <div className="flex-1">
                      {isLoadingCreatedRequest ? (
                        <span className="text-gray-500">{t('requestForm.loading')}</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {(() => {
                            const groupsObj = (createdRequest?.groups) || Object.fromEntries(Array.from(selectedGroups).map(id => [String(id), { approved: null }]));
                            const ids = Object.keys(groupsObj);
                            if (ids.length === 0) return <span className="text-gray-500">—</span>;
                            return ids.map((gid) => {
                              // Prefer label from request relation, fallback to allGroups
                              const groupData = groupsObj[gid];
                              const label = groupData?.label || allGroups.find(g => String(g.id || g.group_id) === String(gid))?.label || `Person ${gid}`;
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
                    <span className={`w-32 text-gray-500 ${me('2')}`}>{t('requestForm.details')}</span>
                    <span className="whitespace-pre-line flex-1">{createdRequest?.details || formData.details || '—'}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
            {/* Step 1: Profile Details (only for new profile requests) */}
            {currentStep === 1 && (
              <>
                {/* Applicant Name - Only show for new profile requests */}
                {formData.requestType === 'new' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t('requestForm.profileName')} *
                    </label>
                    <input
                      type="text"
                      value={formData.applicant_name}
                      onChange={(e) => !(isClosed || isPublicSubmissionView) && handleInputChange('applicant_name', e.target.value)}
                      readOnly={isClosed || isPublicSubmissionView}
                      dir={isRTL ? 'rtl' : 'ltr'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 read-only:bg-gray-50 read-only:cursor-default"
                      placeholder={t('requestForm.enterProfileName')}
                      required
                    />
                  </div>
                )}

                {/* Email and Phone - Only show for new profile requests */}
                {formData.requestType === 'new' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <div className="flex items-center gap-1">
                          <Mail className="w-4 h-4" />
                          <span>{t('requestForm.email')} *</span>
                        </div>
                      </label>
                      <input
                        type="email"
                        value={formData.applicant_email}
                        onChange={(e) => !(isClosed || isPublicSubmissionView) && handleInputChange('applicant_email', e.target.value)}
                        readOnly={isClosed || isPublicSubmissionView}
                        dir="ltr"
                        className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 read-only:bg-gray-50 read-only:cursor-default ${isRTL ? '[&::placeholder]:[direction:rtl] [&::placeholder]:[text-align:right]' : ''}`}
                        placeholder={t('requestForm.enterEmailAddress')}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <div className="flex items-center gap-1">
                          <Phone className="w-4 h-4" />
                          <span>{t('requestForm.phone')}</span>
                        </div>
                      </label>
                      <input
                        type="tel"
                        value={formData.applicant_phone}
                        onChange={(e) => !(isClosed || isPublicSubmissionView) && handleInputChange('applicant_phone', e.target.value)}
                        readOnly={isClosed || isPublicSubmissionView}
                        dir="ltr"
                        className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 read-only:bg-gray-50 read-only:cursor-default ${isRTL ? '[&::placeholder]:[direction:rtl] [&::placeholder]:[text-align:right]' : ''}`}
                        placeholder={t('requestForm.enterPhoneNumber')}
                      />
                    </div>
                  </>
                )}

              </>
            )}

            {/* Step 2: Groups Selection + Details */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <div className="flex items-center gap-1">
                      <Users className="w-4 h-4" />
                      <span>{t('requestForm.selectGroups')} *</span>
                    </div>
                  </label>
                
                {/* Show approved/denied lists when closed, otherwise show selectable grid */}
                {(isClosed || isPublicSubmissionView) ? (
                  <div className="space-y-4">
                    {/* Approved Groups List */}
                    {approvedGroups.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <span>{t('requestForm.approved')}</span>
                        </h4>
                        <div className="flex items-center gap-3 overflow-x-auto pb-1">
                          {approvedGroups.map(([groupId, groupData]) => {
                            // Use data from request relation first, fallback to allGroups
                            const repFace = groupData?.representative_face || getGroupRepresentativeFace(groupId);
                            const groupIdForUrl = groupId;
                            return (
                              <div
                                key={groupId}
                                className="flex-shrink-0"
                                title={getGroupDisplayName(groupId)}
                              >
                                <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-green-500 bg-green-100 flex items-center justify-center">
                                  {ImageComponent(
                                    repFace && groupIdForUrl
                                      ? `${getRepUrl('groups', groupIdForUrl)}?v=${repFace || 'none'}`
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
                        <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <XCircle className="w-4 h-4 text-red-600" />
                          <span>{t('requestForm.denied')}</span>
                        </h4>
                        <div className="flex items-center gap-3 overflow-x-auto pb-1">
                          {deniedGroups.map(([groupId, groupData]) => {
                            // Use data from request relation first, fallback to allGroups
                            const repFace = groupData?.representative_face || getGroupRepresentativeFace(groupId);
                            const groupIdForUrl = groupId;
                            return (
                              <div
                                key={groupId}
                                className="flex-shrink-0"
                                title={getGroupDisplayName(groupId)}
                              >
                                <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-red-500 bg-red-100 flex items-center justify-center">
                                  {ImageComponent(
                                    repFace && groupIdForUrl
                                      ? `${getRepUrl('groups', groupIdForUrl)}?v=${repFace || 'none'}`
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
                        <p className="text-sm">{t('requestForm.noGroupsInRequest')}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Loading state */}
                    {isLoadingGroups && (
                      <div className="text-center py-8">
                        <div className="inline-flex items-center gap-2 text-gray-500">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                          <span>{t('requestForm.loadingGroups')}</span>
                        </div>
                      </div>
                    )}
                    
                    {/* Search and Sort Controls */}
                    {!isLoadingGroups && (
                  <>
                    <div className="mb-3 flex flex-col sm:flex-row gap-2">
                      {/* Search */}
                      <div className="relative flex-1">
                        <Search className={`absolute ${startClass('3')} top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400`} />
                        <input
                          type="text"
                          placeholder={t('requestForm.searchGroups')}
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          dir={isRTL ? 'rtl' : 'ltr'}
                          className={`w-full ${ps('10')} ${pe('4')} py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
                        />
                      </div>
                      
                      {/* Sort Controls */}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleToggleSortOrder}
                          className="w-8 h-8 border border-transparent rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center"
                          title={sortOrder === 'asc' ? t('requestForm.sortAscending') : t('requestForm.sortDescending')}
                          aria-label={sortOrder === 'asc' ? t('requestForm.sortAscending') : t('requestForm.sortDescending')}
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
                    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 max-h-52 overflow-y-auto border border-gray-200 rounded-lg p-3">
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
                            <div className="flex flex-col items-center gap-1">
                            {/* Representative image */}
                            <div className="w-12 h-12 rounded-full overflow-hidden border border-gray-200">
                              {(() => {
                                const groupIdForUrl = group.id || group.group_id;
                                const baseUrl = getRepUrl('groups', groupIdForUrl);
                                return group.representative_face && groupIdForUrl && baseUrl ? (
                                  <img
                                    src={`${baseUrl}?v=${group.representative_face}`}
                                    alt={group.label}
                                    className="w-full h-full object-cover rounded-full"
                                  />
                                ) : (
                                  <div className="w-full h-full bg-gray-200 rounded-full flex items-center justify-center">
                                    <User className="w-6 h-6 text-gray-500" />
                                  </div>
                                );
                              })()}
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
                          {searchTerm ? t('requestForm.noGroupsFound') : t('requestForm.noGroupsAvailable')}
                        </div>
                      )}
                    </div>
                    
                    <p className="text-xs text-gray-500 mt-2">
                      {selectableGroupsCount === 1 && isRTL ? (
                        // Hebrew singular: "נבחרה קבוצה אחת" (selected group one)
                        `${t('requestForm.selectedSingular')} ${t('requestForm.group')} ${t('requestForm.one')}`
                      ) : (
                        // Plural or English singular: "נבחרו 2 קבוצות" or "Selected 1 group"
                        `${selectableGroupsCount !== 1 ? t('requestForm.selectedPlural') : t('requestForm.selectedSingular')} ${selectableGroupsCount} ${selectableGroupsCount !== 1 ? t('requestForm.groupsPlural') : t('requestForm.group')}`
                      )}
                    </p>
                      </>
                    )}

                    {/* Approved and Denied Groups List - Show below grid for open requests */}
                    {(approvedGroups.length > 0 || deniedGroups.length > 0) && (
                      <div className="mt-3 space-y-3">
                        {/* Approved Groups List */}
                        {approvedGroups.length > 0 && (
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1.5">
                              <CheckCircle className="w-4 h-4 text-green-600" />
                              <span>{t('requestForm.approved')}</span>
                            </h4>
                            <div className="flex items-center gap-3 overflow-x-auto pb-1">
                              {approvedGroups.map(([groupId, groupData]) => {
                                // Use data from request relation first, fallback to allGroups
                                const repFace = groupData?.representative_face || getGroupRepresentativeFace(groupId);
                                const groupIdForUrl = groupId;
                                return (
                                  <div
                                    key={groupId}
                                    className="flex-shrink-0"
                                    title={getGroupDisplayName(groupId)}
                                  >
                                    <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-green-500 bg-green-100 flex items-center justify-center">
                                      {ImageComponent(
                                        repFace && groupIdForUrl
                                          ? `${getRepUrl('groups', groupIdForUrl)}?v=${repFace || 'none'}`
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
                            <h4 className="text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1.5">
                              <XCircle className="w-4 h-4 text-red-600" />
                              <span>{t('requestForm.denied')}</span>
                            </h4>
                            <div className="flex items-center gap-3 overflow-x-auto pb-1">
                              {deniedGroups.map(([groupId, groupData]) => {
                                // Use data from request relation first, fallback to allGroups
                                const repFace = groupData?.representative_face || getGroupRepresentativeFace(groupId);
                                const groupIdForUrl = groupId;
                                return (
                                  <div
                                    key={groupId}
                                    className="flex-shrink-0"
                                    title={getGroupDisplayName(groupId)}
                                  >
                                    <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-red-500 bg-red-100 flex items-center justify-center">
                                      {ImageComponent(
                                        repFace && groupIdForUrl
                                          ? `${getRepUrl('groups', groupIdForUrl)}?v=${repFace || 'none'}`
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
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <div className="flex items-center gap-1">
                      <FileText className="w-4 h-4" />
                      <span>{t('requestForm.details')}</span>
                    </div>
                  </label>
                  <textarea
                    value={formData.details}
                    onChange={(e) => !(isClosed || isPublicSubmissionView) && handleInputChange('details', e.target.value)}
                    readOnly={isClosed || isPublicSubmissionView}
                    onKeyDown={handleKeyDown}
                    rows={2}
                    dir={isRTL ? 'rtl' : 'ltr'}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 read-only:bg-gray-50 read-only:cursor-default"
                    placeholder={t('requestForm.additionalInformationAboutRequest')}
                  />
                </div>
                
                {/* Communication Consent - Show if new profile or current profile has email, but hide for public profiles */}
                {(formData.requestType === 'new' || currentProfileHasEmail) && !currentProfileIsPublic && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-900">
                          {t('requestForm.emailUpdatesConsent')}
                        </span>
                        <p className="text-xs text-gray-600 mt-0.5">
                          {t('requestForm.emailNotificationsDescription')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (isClosed || isPublicSubmissionView) return;
                          handleInputChange('communication_consent', !formData.communication_consent);
                        }}
                        disabled={isClosed || isPublicSubmissionView}
                        className={`w-10 h-6 rounded-full relative transition-colors ${formData.communication_consent ? 'bg-blue-600' : 'bg-gray-300'} ${(isClosed || isPublicSubmissionView) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                        aria-pressed={formData.communication_consent}
                      >
                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isRTL ? 'right-0.5' : 'left-0.5'} ${formData.communication_consent ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
                      </button>
                    </div>
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
                        title={t('requestForm.managerResponseNotes')}
                        aria-label={t('requestForm.managerResponseNotes')}
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
                      >{t('requestForm.managerResponseNotes')}</span>
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
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <div className="flex justify-between items-center">
            {/* Step Navigation */}
            <div className="flex items-center gap-3">
              {currentStep === 2 && formData.requestType === 'new' && (
                <button
                  type="button"
                  onClick={handlePrevStep}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {t('requestForm.backToProfile')}
                </button>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              {currentStep !== 3 && (
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={loading}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50"
                >
                  {t('requestForm.cancel')}
                </button>
              )}
              {currentStep === 3 && (
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  {t('requestForm.close')}
                </button>
              )}
              
              {currentStep === 1 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  disabled={!canProceedToGroups() || isClosed || isPublicSubmissionView}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('requestForm.nextSelectGroups')}
                </button>
              ) : (
                (currentStep === 2 && !isClosed && !isPublicSubmissionView) && (
                  <button
                    type="submit"
                    data-is-save-button="true"
                    onClick={handleSubmit}
                    disabled={loading || (!isEditing && selectedGroups.size === 0) || (isEditing && !hasChanges)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 flex items-center gap-2"
                  >
                    {loading && (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    )}
                    <span>{request ? t('requestForm.updateRequest') : t('requestForm.createRequest')}</span>
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
