import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Mail, Phone, FileText, Users, CheckCircle, Search, ArrowUp, ArrowDown } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { useToast } from '../../contexts/ToastContext';
import { requestsAPI, groupsAPI } from '../../utils/apiService';
import { useGroupsList } from '../../utils/dataManager';
import { useApplyScopes, getRepresentativeUrl } from '../../utils/storeUtils';
import { formatErrorMessage } from '../../utils/errorHandler';
import { getCurrentProfile } from '../../utils/profileService';
import { usePreference } from '../../hooks/useSettings';
import { setPreference, getImageCount } from '../../utils/settings';
import { toggleSortOrder } from '../../utils/sorting';
import { useImageComponent, ImageComponent } from '../../hooks/useImage.jsx';

export default function RequestFormModal({ 
  isOpen, 
  onClose, 
  request = null, 
  eventUrl,
  urlHelpers
}) {
  const [formData, setFormData] = useState({
    requestType: 'own', // 'own' or 'new'
    applicant_name: '',
    applicant_email: '',
    applicant_phone: '',
    details: '',
    group_ids: []
  });
  const [loading, setLoading] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [currentStep, setCurrentStep] = useState(1); // 1 = details, 2 = groups
  const [lastSelectedIndex, setLastSelectedIndex] = useState(-1);
  
  // Sort preferences
  const sortBy = usePreference('GroupsGallery.sortBy', 'name');
  const setSortBy = (value) => setPreference('GroupsGallery.sortBy', value);
  const sortOrder = usePreference('GroupsGallery.sortDir', 'asc');
  const setSortOrder = (value) => setPreference('GroupsGallery.sortDir', value);
  
  const { showToast } = useToast();
  const currentProfile = useMemo(() => getCurrentProfile(), []);
  const allGroups = useGroupsList();
  
  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'request-form-modal';

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

  // Apply scopes for groups access and my_access_request
  const currentRequestId = request?.access_request_id;
  useApplyScopes(
    currentRequestId 
      ? [
          { entity: 'all', id: 'groups' },
          { entity: 'my_access_request', id: currentRequestId }
        ]
      : [{ entity: 'all', id: 'groups' }]
  );

  // Register modal when opened
  useEffect(() => {
    if (isOpen) {
      registerModal({ 
        id: modalId, 
        type: 'popup',
        allowOutsideScroll: true,
        scopes: [{ entity: 'all', id: 'groups' }]
      });
      
      return () => {
        unregisterModal(modalId);
      };
    }
  }, [isOpen, registerModal, unregisterModal]);

  // Initialize form data
  useEffect(() => {
    if (isOpen) {
      if (request) {
        // Editing existing request
        setFormData({
          requestType: request.applicant_profile_id ? 'own' : 'new',
          applicant_name: request.applicant_name || '',
          applicant_email: request.applicant_email || '',
          applicant_phone: request.applicant_phone || '',
          details: request.details || '',
          group_ids: request.groups ? Object.keys(request.groups) : []
        });
        setSelectedGroups(new Set(request.groups ? Object.keys(request.groups) : []));
      } else {
        // Creating new request
        setFormData({
          requestType: currentProfile?.is_public ? 'new' : 'own',
          applicant_name: currentProfile?.is_public ? '' : (currentProfile?.label || ''),
          applicant_email: '',
          applicant_phone: '',
          details: '',
          group_ids: [],
          applicant_profile_id: currentProfile?.is_public ? null : (currentProfile?.id || currentProfile?.profile_id)
        });
        setSelectedGroups(new Set());
      }
      setSearchTerm('');
      setCurrentStep(1); // Reset to step 1 when modal opens
    }
  }, [isOpen, request, currentProfile]);

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId: modalId,
    modalType: 'popup',
    allowOutsideScroll: true,
    enableFocusTrapping: true
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
        // Filter out groups that are not associated with the current profile
        // For now, show all groups - this can be customized based on business logic
        const label = group.label || `Person ${group.id}`;
        const matchesSearch = label.toLowerCase().includes(searchTerm.toLowerCase());
        
        // Filter out groups that are already associated with the current profile
        // This would need to be implemented based on your business logic
        // For now, we'll show all groups
        return matchesSearch;
      })
      .sort((a, b) => {
        let aValue, bValue;
        
        if (sortBy === 'name') {
          aValue = a.label || `Person ${a.id}`;
          bValue = b.label || `Person ${b.id}`;
        } else {
          aValue = getImageCount(a);
          bValue = getImageCount(b);
        }
        
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
  }, [allGroups, searchTerm, sortBy, sortOrder]);

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
    // Validate step 1 before proceeding
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


  const handlePrevStep = () => {
    setCurrentStep(1);
  };

  const canProceedToGroups = () => {
    if (formData.requestType === 'new') {
      return formData.applicant_name.trim() && formData.applicant_email.trim();
    }
    return true; // For "myself" requests, no required fields
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
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
    }
    

    setLoading(true);
    
    try {
      const submitData = {
        applicant_name: formData.applicant_name.trim(),
        applicant_email: formData.applicant_email.trim() || null,
        applicant_phone: formData.applicant_phone.trim() || null,
        details: formData.details.trim() || null,
        group_ids: Array.from(selectedGroups),
        applicant_profile_id: formData.requestType === 'own' ? formData.applicant_profile_id : null
      };

      if (request) {
        // Update existing request (using my-requests route)
        await requestsAPI.updateMyRequest(request.access_request_id, submitData, eventUrl);
        showToast('Request updated successfully', 'success');
      } else {
        // Create new request
        await requestsAPI.create(submitData, eventUrl);
        showToast('Request created successfully', 'success');
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
                <div className={`w-2 h-2 rounded-full ${currentStep >= 1 ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
                <span className="text-sm text-gray-600">Details</span>
                <div className={`w-2 h-2 rounded-full ${currentStep >= 2 ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
                <span className="text-sm text-gray-600">Groups</span>
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
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Step 1: Details */}
            {currentStep === 1 && (
              <>
                {/* Request Type - Only show for non-public profiles */}
                {!currentProfile?.is_public && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">Request Type</label>
                    <div className="space-y-2">
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="radio"
                          name="requestType"
                          value="own"
                          checked={formData.requestType === 'own'}
                          onChange={(e) => handleInputChange('requestType', e.target.value)}
                          className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                        />
                        <div className="flex items-center space-x-2">
                          <User className="w-4 h-4 text-gray-500" />
                          <span className="text-sm text-gray-700">For myself</span>
                        </div>
                      </label>
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="radio"
                          name="requestType"
                          value="new"
                          checked={formData.requestType === 'new'}
                          onChange={(e) => handleInputChange('requestType', e.target.value)}
                          className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                        />
                        <div className="flex items-center space-x-2">
                          <Users className="w-4 h-4 text-gray-500" />
                          <span className="text-sm text-gray-700">For new profile</span>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {/* Applicant Name - Only show for new profile requests */}
                {formData.requestType === 'new' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Profile Name *
                    </label>
                    <input
                      type="text"
                      value={formData.applicant_name}
                      onChange={(e) => handleInputChange('applicant_name', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                        onChange={(e) => handleInputChange('applicant_email', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                        onChange={(e) => handleInputChange('applicant_phone', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter phone number"
                      />
                    </div>
                  </>
                )}

                {/* Details */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <FileText className="w-4 h-4 inline mr-1" />
                    Details
                  </label>
                  <textarea
                    value={formData.details}
                    onChange={(e) => handleInputChange('details', e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Additional information about the request"
                  />
                </div>
              </>
            )}

            {/* Step 2: Groups Selection */}
            {currentStep === 2 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  <Users className="w-4 h-4 inline mr-1" />
                  Select Groups *
                </label>
                
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
                        <select
                          value={sortBy}
                          onChange={(e) => setSortBy(e.target.value)}
                          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="name">Sort by Name</option>
                          <option value="count">Sort by Count</option>
                        </select>
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
                      Selected {selectedGroups.size} group{selectedGroups.size !== 1 ? 's' : ''}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <div className="flex justify-between items-center">
            {/* Step Navigation */}
            <div className="flex items-center space-x-3">
              {currentStep === 2 && (
                <button
                  type="button"
                  onClick={handlePrevStep}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Back to Details
                </button>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={handleClose}
                disabled={loading}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              
              {currentStep === 1 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  disabled={!canProceedToGroups()}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next: Select Groups
                </button>
              ) : (
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
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
