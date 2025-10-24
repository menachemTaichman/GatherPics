import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { groupsAPI } from '../../utils/apiService';
import { useDataStore } from '../../utils/dataManager';
import { useModalManager } from '../../utils/modalManager';
import { getRepresentativeUrl } from '../../utils/storeUtils';
import { getImageCount } from '../../utils/settings';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../contexts/authContext';
import { 
  Filter, 
  X, 
  Eye, 
  EyeOff, 
  RefreshCw,
  Users,
  UserCheck,
  UserX,
  Plus,
  Minus
} from 'lucide-react';
import { ImageComponent } from '../../hooks/useImage.jsx';

export default function GroupsFilter({ 
  group,
  relatedGroups,
  filterMode,
  onlySelected,
  onModeChange,
  onOnlySelectedChange,
  onReset,
  isVisible,
  eventUrl,
  imageIds = [],
  onRelatedGroupsUpdate,
  currentGroupId,
  onSelectedGroupsChange,
  initialSelectedGroups = [],
  urlHelpers: injectedUrlHelpers,
  onPanelOpenedByUser,
  onFetchRelated // New prop to expose fetch_related function
}) {
  const { isAuthenticated } = useAuth();
  const [hoveredGroup, setHoveredGroup] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [isLoadingRelatedGroups, setIsLoadingRelatedGroups] = useState(false);
  const [sessionUpdateTrigger, setSessionUpdateTrigger] = useState(0);
  const urlHelpers = injectedUrlHelpers;
  const [selectedGroups, setSelectedGroups] = useState(
    Array.isArray(initialSelectedGroups)
      ? Array.from(new Set(initialSelectedGroups.map((g) => String(g))))
      : []
  ); // excludes currentGroupId
  const [isResetting, setIsResetting] = useState(false);
  const groups = useDataStore(state => state.entities?.groups || {});
  const entities = useDataStore(state => state.entities);
  const { registerModal, unregisterModal } = useModalManager();
  const PANEL_ID = 'groups-filter-panel';
  
  // Flag to prevent process_url from running when user is actively selecting
  const isUserSelectingRef = useRef(false);
  
  // Core methods implementation
  const current_selected = () => {
    return [currentGroupId, ...selectedGroups].filter(Boolean);
  };
  
  // Request deduplication to prevent duplicate API calls from React Strict Mode
  const activeRequestsRef = useRef(new Set());
  
  // Track if panel was opened by user action (not just mounted)
  const panelOpenedByUserRef = useRef(false);
  
  // Listen for panel opened by user callback
  useEffect(() => {
    if (onPanelOpenedByUser) {
      panelOpenedByUserRef.current = true;
    }
  }, [onPanelOpenedByUser]);

  // Expose fetch_related function to parent
  useEffect(() => {
    if (onFetchRelated) {
      onFetchRelated(fetch_related);
    }
  }, [onFetchRelated]);
  
  const fetch_related_with_groups = async (groupsToUse, imageIdsToUse = null) => {
    const safeImageIds = imageIdsToUse || (Array.isArray(imageIds) ? imageIds : []);
    
    if (!isAuthenticated || !isVisible || !safeImageIds.length) {
      return;
    }
    
    // Create request signature for deduplication
    const requestSignature = `${groupsToUse.join(',')}|${safeImageIds.join(',')}`;
    
    // Check if this exact request is already in progress
    if (activeRequestsRef.current.has(requestSignature)) {
      return;
    }
    
    // Mark request as active
    activeRequestsRef.current.add(requestSignature);
    
    setIsLoadingRelatedGroups(true);
    try {
      const selectedParam = groupsToUse.join(',');
      const params = {
        image_ids: safeImageIds.join(','),
        selected_groups: selectedParam
      };
      
      const data = await groupsAPI.getRelated(eventUrl, params);
      
      // Store related group IDs in session storage (override)
      const sessionData = JSON.stringify(data.related_group_ids || []);
      sessionStorage.setItem('groupDetail_filteredRelatedGroups', sessionData);
      setSessionUpdateTrigger(prev => prev + 1); // Trigger re-render
      
      // Apply changes to store (this will automatically update the store with the groups)
      const store = useDataStore.getState();
      if (data.changes && data.changes.length > 0) {
        store.applyChanges(data.changes, { broadcast: false, ignoreScope: true });
      }

      // Get the updated groups from store after applying changes
      const after = useDataStore.getState().entities?.groups || {};
      const relatedList = (data.related_group_ids || []).map(id => after[id]).filter(Boolean);
      
      onRelatedGroupsUpdate?.(relatedList);
    } catch (error) {
      console.error('Error fetching related groups:', error);
    } finally {
      // Remove request from active set
      activeRequestsRef.current.delete(requestSignature);
      setIsLoadingRelatedGroups(false);
    }
  };
  
  const fetch_related = async (imageIdsToUse = null) => {
    const currentSelected = current_selected();
    await fetch_related_with_groups(currentSelected, imageIdsToUse);
  };
  
  const select = async (groupId, fetchRelated = true) => {
    if (groupId === currentGroupId) {
      return; // ignore main group
    }
    
    const idStr = String(groupId);
    const isCurrentlySelected = selectedGroups.includes(idStr);
    
    if (isCurrentlySelected) {
      return;
    }
    
    // Set flag to prevent process_url and panel effect from interfering
    isUserSelectingRef.current = true;
    
    // Don't capture imageIds here - it will be stale due to timing
    // The parent will pass the correct filtered imageIds after state updates
    
    // Add to URL without processing
    const newSelectedGroups = [...selectedGroups, idStr];
    setSelectedGroups(newSelectedGroups);
    onSelectedGroupsChange?.(newSelectedGroups);
    
    // Add to scope and fetch data
    await fetchGroupData(groupId);
    
    // Don't fetch here - let parent handle it after updating filtered images
    if (fetchRelated) {
      // Parent will handle fetch_related after updating filtered images
    }
    
    // Clear flag after a short delay
    setTimeout(() => {
      isUserSelectingRef.current = false;
    }, 200);
  };
  
  const deselect = async (groupId = null) => {
    if (groupId === currentGroupId) {
      return;
    }
    
    if (groupId === null) {
      // Deselect all (except main)
      setSelectedGroups([]);
      onSelectedGroupsChange?.([]);
    } else {
      // Deselect specific group
      const idStr = String(groupId);
      const isCurrentlySelected = selectedGroups.includes(idStr);
      
      if (!isCurrentlySelected) {
        return;
      }
      
      const newSelectedGroups = selectedGroups.filter(id => id !== idStr);
      setSelectedGroups(newSelectedGroups);
      onSelectedGroupsChange?.(newSelectedGroups);
    }
    
    // Fetch related groups
    await fetch_related();
  };
  
  const process_url = async () => {
    // Skip if user is actively selecting
    if (isUserSelectingRef.current) {
      return;
    }
    
    if (!Array.isArray(initialSelectedGroups)) {
      return;
    }
    
    // Process each group from URL (if any)
    for (const groupId of initialSelectedGroups) {
      if (groupId !== currentGroupId) {
        await select(groupId, false); // Don't fetch related for each individual selection
      }
    }
    
    // Always fetch related groups after processing URL (regardless of filter params)
    await fetch_related();
  };
  
  // Stabilize modal functions to prevent infinite re-renders
  const stableRegisterModal = useCallback((modalData) => {
    try { registerModal(modalData); } catch {}
  }, [registerModal]);
  
  const stableUnregisterModal = useCallback((modalId) => {
    try { unregisterModal(modalId); } catch {}
  }, [unregisterModal]);
  
  
  // Create placeholder groups when not authenticated
  const placeholderRelatedGroups = useMemo(() => {
    if (isAuthenticated) return [];
    return Array.from({ length: 4 }, (_, i) => ({
      id: `placeholder-related-${i}`,
      label: '',
      isPlaceholder: true
    }));
  }, [isAuthenticated]);


  const handleGroupClick = async (groupId) => {
    if (groupId === currentGroupId) return; // lock main group from being deselected
    
    const idStr = String(groupId);
    const isCurrentlySelected = selectedGroups.includes(idStr);
    
    if (isCurrentlySelected) {
      await deselect(groupId);
    } else {
      await select(groupId, true);
    }
  };
  
  // Fetch group data for filtering
  const fetchGroupData = async (groupId) => {
    if (!groupId || !isAuthenticated) return;
    
    
    
    try {
      // Fetch the group data with filter=true to get scope instructions
      const response = await groupsAPI.getById(groupId, eventUrl, { filter: true });
      
      // Changes are automatically applied by the API interceptor
      // Just check if faces were loaded
      const store = useDataStore.getState();
      const groupAfter = store.entities?.groups?.[groupId];
      
    } catch (error) {
      console.error('❌ [GroupsFilter] Error fetching group data for filtering:', error);
    }
  };

  const handleMouseEnter = (groupId, event) => {
    setHoveredGroup(groupId);
    setTooltipPosition({ x: event.clientX, y: event.clientY });
  };

  const handleMouseMove = (event) => {
    if (hoveredGroup) {
      setTooltipPosition({ x: event.clientX, y: event.clientY });
    }
  };

  const handleMouseLeave = () => {
    setHoveredGroup(null);
  };

  // Global mouse tracking for tooltip positioning
  useEffect(() => {
    const handleGlobalMouseMove = (event) => {
      if (hoveredGroup) {
        setTooltipPosition({ x: event.clientX, y: event.clientY });
      }
    };

    if (hoveredGroup) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
    };
  }, [hoveredGroup]);


  // Fetch data for initially selected groups
  useEffect(() => {
    if (!isAuthenticated || !isVisible) return;
    
    const groupsToFetch = selectedGroups.filter(id => {
      const store = useDataStore.getState();
      const group = store.entities?.groups?.[id];
      // Check if group has faces loaded
      return group && (!group.faces || (group.faces instanceof Set && group.faces.size === 0));
    });
    
    if (groupsToFetch.length > 0) {
      Promise.all(
        groupsToFetch.map(groupId => fetchGroupData(groupId))
      ).catch(error => {
        console.error('❌ [GroupsFilter] Error fetching initial group data:', error);
      });
    }
  }, [selectedGroups, isAuthenticated, isVisible]);

  // Process URL on mount or when initialSelectedGroups changes
  useEffect(() => {
    if (isAuthenticated && isVisible) {
      process_url();
    }
  }, [initialSelectedGroups, isAuthenticated, isVisible]);

  // Manage filter panel visibility only - no fetching
  useEffect(() => {
    if (isVisible) {
      stableRegisterModal({ id: PANEL_ID, type: 'panel', scopes: [{ entity: 'all', id: 'groups' }] });
      // Scope for all:groups is managed by parent (GroupDetail) to avoid conditional hook usage
    }
    return () => {
      if (!isVisible) {
        stableUnregisterModal(PANEL_ID);
        // Reset the flag when panel closes
        panelOpenedByUserRef.current = false;
      }
    };
  }, [isVisible, stableRegisterModal, stableUnregisterModal]);

  // Reset handler: clear selection but keep main group selected
  const handleReset = () => {
    // Set reset flag to prevent sync override
    setIsResetting(true);
    
    // Call parent reset first to update filterGroups state
    onReset?.();
    
    // Deselect all groups (except main)
    deselect(null);
  };

  // Build display list: selected first (in order), then related groups from session storage (keep order, no dups). Exclude currentGroupId from this row (it's shown as main group)
  const displayGroups = useMemo(() => {
    // Return placeholders when not authenticated
    if (!isAuthenticated) {
      return placeholderRelatedGroups;
    }
    
    const seen = new Set((selectedGroups || []).map(v => String(v)));
    const groupMap = new Map(Object.values(groups || {}).map(g => [String(g.id || g.group_id), g]));
    
    // Get related group IDs from session storage - ALWAYS use this as the source
    let sessionRelatedGroupIds = [];
    try {
      const stored = sessionStorage.getItem('groupDetail_filteredRelatedGroups');
      if (stored) {
        sessionRelatedGroupIds = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Error reading session storage:', error);
    }
    
    const currentIdStr = currentGroupId != null ? String(currentGroupId) : null;
    
    // Get selected groups objects
    const selectedObjs = (selectedGroups || [])
      .filter(id => String(id) !== currentIdStr)
      .map(id => {
        const group = groupMap.get(String(id)) || { id, label: `Person ${id}` };
        return group;
      });
    
    // Get remaining related groups - ALWAYS use session storage data
    const tail = sessionRelatedGroupIds
      .filter(id => {
        const gid = String(id);
        const notSelected = !seen.has(gid);
        const notCurrent = gid !== currentIdStr;
        return notSelected && notCurrent;
      })
      .map(id => {
        const group = groupMap.get(String(id)) || { id, label: `Person ${id}` };
        return group;
      });
    
    const result = [...selectedObjs, ...tail];
    
    return result;
  }, [selectedGroups, currentGroupId, groups, isAuthenticated, placeholderRelatedGroups, entities, sessionUpdateTrigger]);

  const getGroupDisplayName = (group) => {
    if (!group) return 'Person';
    const id = group.id || group.group_id || '';
    return group.label || `Person ${id}`;
  };

  // Main group is always considered "selected" for filtering purposes
  // Reset button shows when there are additional groups or non-default settings
  const hasAdditionalGroups = selectedGroups.length > 0; // Any additional groups beyond the main group
  const showResetButton = hasAdditionalGroups || onlySelected || filterMode !== 'and';

  return (
    <>
      {/* Floating Tooltip */}
      <AnimatePresence>
        {hoveredGroup && (
          <motion.div 
            key={`tooltip-${hoveredGroup}`}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            className="fixed px-3 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg pointer-events-none whitespace-nowrap z-50"
            style={{
              left: `${tooltipPosition.x + 15}px`,
              top: `${tooltipPosition.y - 15}px`,
            }}
          >
            <div className="font-medium">
              {hoveredGroup === (group.id || group.group_id)
                ? getGroupDisplayName(group)
                : getGroupDisplayName(displayGroups.find(g => (g.id || g.group_id) === hoveredGroup))
              }
            </div>
            {/* Removed subtitle text for cleaner tooltip */}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        <motion.div
          key="groups-filter-content"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ 
            duration: 0.3, 
            ease: "easeInOut",
            height: { duration: 0.3, ease: "easeInOut" },
            opacity: { duration: 0.2, ease: "easeInOut" }
          }}
          className="px-5 py-4"
        >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <Filter className="w-4 h-4 text-gray-600" />
            <span className="text-sm font-medium text-gray-700">Filter by People</span>
            
            {/* Filter Mode Toggle - Single button with icon only */}
            <button
              onClick={() => onModeChange(filterMode === 'and' ? 'or' : 'and')}
              className="w-8 h-8 rounded-md transition-colors bg-gray-50 hover:bg-gray-100 flex items-center justify-center"
              title={`${filterMode === 'and' ? 'AND mode' : 'OR mode'} - Click to switch to ${filterMode === 'and' ? 'OR' : 'AND'} mode`}
            >
              {filterMode === 'and' ? (
                <UserCheck className="w-4 h-4 text-gray-700" />
              ) : (
                <Users className="w-4 h-4 text-gray-700" />
              )}
            </button>

            {/* Only Selected Checkbox - Box style button */}
            <button
              onClick={() => onOnlySelectedChange(!onlySelected)}
              className={`w-8 h-8 rounded-md transition-colors flex items-center justify-center ${
                onlySelected 
                  ? 'bg-primary-100 text-primary-700' 
                  : 'bg-gray-50 hover:bg-gray-100 text-gray-700'
              }`}
              title={onlySelected ? 'Show all groups' : 'Show only selected groups'}
            >
              <Eye className="w-4 h-4" />
            </button>

            {/* Reset Button - Now after the "only" button */}
            {showResetButton && (
              <button
                onClick={handleReset}
                className="w-8 h-8 rounded-md transition-colors bg-gray-50 hover:bg-gray-100 flex items-center justify-center"
                title="Reset all filters"
              >
                <RefreshCw className="w-4 h-4 text-gray-700" />
              </button>
            )}
          </div>
        </div>

        {/* Groups Row */}
        <div className="flex items-center space-x-3 overflow-x-auto pb-2">
          {/* Main Group (always selected) */}
            <div 
            key={`main-${group.id || group.group_id}`}
            className="flex-shrink-0 relative group"
            onMouseEnter={group.isPlaceholder ? undefined : (event) => handleMouseEnter(group.id || group.group_id, event)}
            onMouseLeave={group.isPlaceholder ? undefined : handleMouseLeave}
            onMouseMove={group.isPlaceholder ? undefined : handleMouseMove}
          >
            <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-primary-500 bg-primary-100 flex items-center justify-center">
              {ImageComponent(
                group.isPlaceholder ? null : `${getRepresentativeUrl(urlHelpers, 'groups', group.id)}?v=${group.representative_face || 'none'}`,
                {
                  width: 32,
                  height: 32,
                  className: 'w-full h-full object-cover',
                  alt: getGroupDisplayName(group),
                  iconType: 'person'
                }
              )}
            </div>
            {/* Enhanced Tooltip - Removed since we have floating tooltip */}
          </div>

          {/* Related Groups */}
          {displayGroups.map((relatedGroup, index) => {
            const groupId = relatedGroup.id || relatedGroup.group_id;
            const isPlaceholder = relatedGroup.isPlaceholder;
            return (
              <div
                key={groupId || `related-${index}`}
                className="flex-shrink-0 relative group"
                onMouseEnter={isPlaceholder ? undefined : (event) => handleMouseEnter(groupId, event)}
                onMouseLeave={isPlaceholder ? undefined : handleMouseLeave}
                onMouseMove={isPlaceholder ? undefined : handleMouseMove}
              >
                <div 
                  className={isPlaceholder ? '' : 'cursor-pointer'}
                  onClick={isPlaceholder ? undefined : () => handleGroupClick(groupId)}
                >
                  <div className={`w-8 h-8 rounded-full overflow-hidden border-2 flex items-center justify-center transition-all duration-200 ${
                    isPlaceholder 
                      ? 'border-gray-300 bg-gray-100'
                      : selectedGroups.includes(String(groupId))
                      ? 'border-primary-500 bg-primary-100 ring-2 ring-primary-500 ring-offset-2'
                      : 'border-gray-300 bg-gray-100 group-hover:ring-2 group-hover:ring-gray-300 group-hover:ring-offset-2'
                  }`}>
                    {ImageComponent(
                      isPlaceholder ? null : `${getRepresentativeUrl(urlHelpers, 'groups', groupId)}?v=${relatedGroup.representative_face || 'none'}`,
                      {
                        width: 32,
                        height: 32,
                        className: 'w-full h-full object-cover',
                        alt: getGroupDisplayName(relatedGroup),
                        iconType: 'person'
                      }
                    )}
                  </div>
                  
                  {/* Add/Remove Icon on Hover - hide for placeholders */}
                  {!isPlaceholder && (
                    <div 
                      className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 group-hover:bg-opacity-50 rounded-full transition-opacity duration-200 pointer-events-none"
                    >
                      {selectedGroups.includes(groupId) ? (
                        <Minus className="w-4 h-4 text-white opacity-0 group-hover:opacity-100" />
                      ) : (
                        <Plus className="w-4 h-4 text-white opacity-0 group-hover:opacity-100" />
                      )}
                    </div>
                  )}
                </div>

                {/* Enhanced Group Name Tooltip - Removed since we have floating tooltip */}
              </div>
            );
          })}
        </div>

        {/* Filter Status */}
        {(hasAdditionalGroups || onlySelected) && (
          <div className="mt-2 text-xs text-gray-500">
            {hasAdditionalGroups ? (
              <>Filtering by {selectedGroups.length + 1} group{(selectedGroups.length + 1) !== 1 ? 's' : ''} ({filterMode.toUpperCase()} mode{onlySelected ? ', only selected groups' : ''})</>
            ) : (
              <>Filtering by main group only ({filterMode.toUpperCase()} mode{onlySelected ? ', only selected groups' : ''})</>
            )}
          </div>
        )}
        </motion.div>
      </AnimatePresence>
    </>
  );
} 


