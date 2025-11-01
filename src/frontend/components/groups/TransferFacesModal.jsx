import { useState, useEffect, useMemo } from 'react';
import { X, AlertTriangle, User, Plus, Users, Search, ArrowUp, ArrowDown } from 'lucide-react';
import { groupsAPI, handleAPIError } from '../../utils/apiService';
import { usePreference } from '../../hooks/useSettings';
import { setPreference, getImageCount } from '../../utils/settings';
import { toggleSortOrder } from '../../utils/sorting';
import { useDataStore, selectors as storeSelectors } from '../../utils/dataManager';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import { useModalStore } from '../../utils/modalManager';
import { useImageComponent, ImageComponent } from '../../hooks/useImage.jsx';
import { getRepresentativeUrl, useApplyScopes, useEventId } from '../../utils/storeUtils';

export default function TransferFacesModal({ 
  isOpen, 
  eventUrl,
  onClose, 
  currentGroup,
  selectedFaces,
  onTransferComplete,
  sourceGroupId,
  urlHelpers: injectedUrlHelpers,
  showCrops = false // Add showCrops prop to know current mode
}) {
  const { showToast } = useToast();
  const eventId = useEventId(eventUrl);
  const urlHelpers = injectedUrlHelpers;
  const navigate = useNavigate();
  const groups = useDataStore(state => storeSelectors.groupsAll(state, eventId));
  const MODAL_ID = 'transfer-faces-modal';
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [error, setError] = useState('');
  const [nameConflict, setNameConflict] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const sortBy = usePreference('GroupsGallery.sortBy', 'name');
  const setSortBy = (value) => setPreference('GroupsGallery.sortBy', value);
  const sortOrder = usePreference('GroupsGallery.sortDir', 'asc');
  const setSortOrder = (value) => setPreference('GroupsGallery.sortDir', value);



  
  // Custom keyboard handler for TransferFacesModal
  const handleTransferModalKeys = (e) => {
    if (e.key === 'Enter' && !isLoading && !nameConflict && (selectedGroupId || newGroupName.trim())) {
      handleTransfer();
      return true; // Mark as handled
    }
    return false; // Not handled
  };
  
  // Use modal focus hook
  const { modalRef } = useModalFocus(isOpen, onClose, {
    customKeyHandler: handleTransferModalKeys,
    modalType: 'popup',
    modalId: MODAL_ID
  });

  // Get all source groups from the selected faces
  const sourceGroups = useMemo(() => {
    const groupMap = new Map();
    selectedFaces.forEach(face => {
      const groupId = face.group_id;
      if (groupId && !groupMap.has(groupId)) {
        const group = groups.find(g => g.id === groupId);
        if (group) {
          groupMap.set(groupId, group);
        }
      }
    });
    return Array.from(groupMap.values());
  }, [selectedFaces, groups]);

  // Filter out source groups from available groups only when all faces come from a single group
  const availableGroups = groups.filter(g => {
    // Only exclude source groups if all faces come from the same group
    if (sourceGroups.length === 1) {
      return !sourceGroups.some(sg => sg.id === g.id);
    }
    // If faces come from multiple groups, don't exclude any groups
    return true;
  });

  // Filter and sort groups
  const filteredAndSortedGroups = availableGroups
    .filter(group => {
      const label = group.label || `Person ${group.id}`;
      return label.toLowerCase().includes(searchTerm.toLowerCase());
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
    // Remove duplicate groups by group_id to prevent React key conflicts
    .reduce((unique, group) => {
      if (!unique.some(g => g.id === group.id)) {
        unique.push(group);
      }
      return unique;
    }, []);

  // Apply scope for all groups
  useApplyScopes(isOpen ? [{ entity: 'all', id: 'groups', eventId }] : []);
  
  useEffect(() => {
    if (isOpen) {
      const { registerModal, unregisterModal } = useModalStore.getState();
      try {
        registerModal({ id: MODAL_ID, type: 'popup', allowOutsideScroll: true });
      } catch {}
      
      // Load groups with loading state
      const loadGroups = async () => {
        setIsLoadingGroups(true);
        try {
          await groupsAPI.getAll(eventUrl);
        } catch (error) {
          console.error('Failed to load groups:', error);
        } finally {
          setIsLoadingGroups(false);
        }
      };
      
      loadGroups();
      
      setSelectedGroupId('');
      setNewGroupName('');
      setError('');
      setNameConflict(false);
      setSearchTerm('');
      
      // Listen for logout to auto-close modal
      const handleAuthLogout = () => {
        onClose();
      };
      window.addEventListener('auth:logout', handleAuthLogout);
      
      return () => {
        try { unregisterModal(MODAL_ID); } catch {}
        window.removeEventListener('auth:logout', handleAuthLogout);
      };
    } else {
      // Clean up timeout when modal closes
      if (window.nameConflictTimeout) {
        clearTimeout(window.nameConflictTimeout);
        window.nameConflictTimeout = null;
      }
      setIsLoadingGroups(false);
    }
  }, [isOpen, eventUrl]);

  const checkNameConflict = async (name) => {
    if (!name.trim()) {
      setNameConflict(false);
      return;
    }

    try {
      const result = await groupsAPI.checkName(name, '', eventUrl);
      setNameConflict(result.conflict);
    } catch (error) {
      console.error('Error checking name conflict:', error);
      setNameConflict(false);
    }
  };

  const handleNewGroupNameChange = (e) => {
    const name = e.target.value;
    setNewGroupName(name);
    
    if (!handleNewGroupNameChange._t) handleNewGroupNameChange._t = null;
    if (handleNewGroupNameChange._t) clearTimeout(handleNewGroupNameChange._t);
    handleNewGroupNameChange._t = setTimeout(() => {
      checkNameConflict(name);
    }, 300);
  };

  const handleTransfer = async () => {
    if (isLoading) return; // Strictly prevent double submit
    setIsLoading(true); // Set immediately

    if (!selectedFaces || selectedFaces.length === 0) {
      setError('No faces selected for transfer');
      setIsLoading(false);
      return;
    }

    if (!selectedGroupId && !newGroupName.trim()) {
      setError('Please select a target person or enter a new person name');
      setIsLoading(false);
      return;
    }

    // Final name conflict guard (handles debounce/race conditions)
    if (!selectedGroupId && newGroupName.trim()) {
      try {
        const conflictCheck = await groupsAPI.checkName(newGroupName.trim(), '', eventUrl);
        if (conflictCheck.conflict) {
          setError('Person name already exists. Please choose a different name.');
          setIsLoading(false);
          return;
        }
      } catch (_) {
        // Ignore and let backend validation handle it
      }
    }

    setError('');

    try {
      // Extract face ids from face objects
      const faceIds = selectedFaces.map(face => face.id || face.face_id);
      
      const result = await groupsAPI.transferFaces(
        selectedGroupId || null,
        faceIds,
        eventUrl,
        newGroupName.trim() || undefined
      );

      // Store has already been updated by apiService interceptor
      // Trust the result and read from the updated store
      const transferredCount = result.len_added || selectedFaces.length;
      const imageText = transferredCount === 1 ? 'photo' : 'photos';
      const targetGroupId = result.target_group_id;
      
      // Get the target group from the freshly updated store
      const updatedGroups = storeSelectors.groupsAll(useDataStore.getState());
      const targetGroup = updatedGroups.find(g => g.id === targetGroupId);
      
      if (targetGroup) {
        // Show success toast with link to target group
        const link = `/${eventUrl}/people/${encodeURIComponent(targetGroup.label)}`;
        
        // Extract affected items for highlighting based on mode
        let highlightState;
        if (showCrops) {
          // In faces mode, highlight the transferred faces
          const faceIds = selectedFaces.map(f => f.face_id || f.id).filter(Boolean);
          highlightState = { highlightFaces: faceIds.slice(0, 10) };
        } else {
          // In images mode, highlight affected images
          const affectedImages = result.images_added || selectedFaces.map(f => f.image_id).filter(Boolean);
          highlightState = { highlightImages: affectedImages.slice(0, 10) };
        }
        
        showToast(
          <span>
            {transferredCount} {imageText} transferred to <a 
              href={link} 
              className="underline hover:text-gray-100" 
              onClick={(e) => {
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault();
                  navigate(link, {
                    state: highlightState
                  });
                }
              }}
            >{targetGroup.label}</a>
          </span>,
          'success'
        );
      } else {
        // Fallback if group not found in store (shouldn't happen)
        showToast(`${transferredCount} ${imageText} transferred`, 'success');
      }

      if (onTransferComplete) {
        onTransferComplete(result);
      }
      onClose();
    } catch (error) {
      const errorInfo = handleAPIError(error, 'Failed to transfer faces');
      // Surface clearer message for unique constraint
      if (String(errorInfo.message || '').toLowerCase().includes('unique')) {
        setError('A person with this name already exists. Please choose a different name or select the existing person.');
      } else {
        setError(errorInfo.message);
      }
    } finally {
      setIsLoading(false);
    }
  };



  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (window.nameConflictTimeout) {
        clearTimeout(window.nameConflictTimeout);
        window.nameConflictTimeout = null;
      }
    };
  }, []);

  const handleToggleSortOrder = () => {
    const newOrder = toggleSortOrder(sortOrder);
    setSortOrder(newOrder);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div ref={modalRef} className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[94vh] overflow-y-auto" tabIndex={-1}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-orange-600" />
            </div>
                         <div>
               <h2 className="text-xl font-semibold text-gray-900">
                 Transfer {selectedFaces.length} Face{selectedFaces.length !== 1 ? 's' : ''}
               </h2>
               <p className="text-sm text-gray-500">
                 Choose destination person or create new one
               </p>
               {selectedFaces.length > 0 && (
                 <div className="mt-2 text-xs text-gray-600">
                   From: {sourceGroups.length === 1 
                     ? sourceGroups[0]?.label || 'Unknown Person'
                     : `${sourceGroups.length} people (${sourceGroups.map(g => g.label || `Person ${g.id}`).join(', ')})`
                   }
                 </div>
               )}
             </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Loading state */}
          {isLoadingGroups && (
            <div className="text-center py-8">
              <div className="inline-flex items-center space-x-2 text-gray-500">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-600"></div>
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
                placeholder="Search people..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>
            
            {/* Sort Controls */}
            <div className="flex gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              >
                <option value="name">Sort by Name</option>
                <option value="count">Sort by Count</option>
              </select>
              <button
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
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Select existing person:</h3>
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 max-h-64 overflow-y-auto">
              {filteredAndSortedGroups.map((group) => (
                <div
                  key={group.id}
                  className={`p-2 border border-transparent rounded-lg cursor-pointer transition-colors ${
                    selectedGroupId === group.id
                      ? 'border-orange-500 bg-orange-50'
                      : 'hover:border-gray-300'
                  }`}
                  onClick={() => {
                    setSelectedGroupId(group.id);
                    setNewGroupName(''); // Clear new group name when selecting existing
                  }}
                >
                  <div className="flex flex-col items-center space-y-1">
                    {/* Representative image - Circular and previous size */}
                    <div className="w-12 h-12 rounded-full overflow-hidden border border-gray-200">
                      {ImageComponent(
                        `${getRepresentativeUrl(urlHelpers, 'groups', group.id)}?v=${group.representative_face || 'none'}`,
                        {
                          width: 48,
                          height: 48,
                          className: 'w-full h-full object-cover rounded-full',
                          alt: group.label || `Person ${group.id}`,
                          iconType: 'person'
                        }
                      )}
                    </div>
                    <div className="text-center">
                      <p className="font-medium text-gray-900 text-xs truncate w-full">
                        {group.label || `Person ${group.id}`}
                      </p>
                      <p className="text-xs text-gray-500">
                        {getImageCount(group)} images
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              {filteredAndSortedGroups.length === 0 && (
                <div className="col-span-full text-center py-8 text-gray-500">
                  {searchTerm ? 'No people found matching your search' : 'No people available'}
                </div>
              )}
            </div>
          </div>

          {/* New Group Creation */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Or create new person:</h3>
            <div className="relative">
              <input
                type="text"
                value={newGroupName}
                onChange={handleNewGroupNameChange}
                placeholder="Enter new person name..."
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent ${
                  nameConflict ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {nameConflict && (
                <div className="absolute top-full left-0 mt-1 flex items-center space-x-1 text-red-500 text-xs">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Name already exists</span>
                </div>
              )}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center space-x-2 text-red-600 text-sm mb-4">
              <AlertTriangle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium transition-colors"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={handleTransfer}
            disabled={isLoading || (!selectedGroupId && !newGroupName.trim()) || nameConflict}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Transferring...</span>
              </>
            ) : (
              <>
                <User className="w-4 h-4" />
                <span>Transfer</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
} 


