import { useState, useEffect, useMemo } from 'react';
import { groupsAPI } from '../utils/apiService';
import { useDataStore } from '../utils/dataManager';
import { useModalManager } from '../utils/modalManager';
import { useApplyScopes, getRepresentativeUrl } from '../utils/storeUtils';
import { getImageCount } from '../utils/settings';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../utils/authContext';
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
import { ImageComponent } from '../utils/useImage.jsx';

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
  urlHelpers: injectedUrlHelpers
}) {
  const { isAuthenticated } = useAuth();
  const [hoveredGroup, setHoveredGroup] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [isLoadingRelatedGroups, setIsLoadingRelatedGroups] = useState(false);
  const urlHelpers = injectedUrlHelpers;
  const [selectedGroups, setSelectedGroups] = useState(initialSelectedGroups || []); // excludes currentGroupId
  const groups = useDataStore(state => state.entities?.groups || {});
  const { registerModal, unregisterModal } = useModalManager();
  const PANEL_ID = 'groups-filter-panel';
  
  // Create placeholder groups when not authenticated
  const placeholderRelatedGroups = useMemo(() => {
    if (isAuthenticated) return [];
    return Array.from({ length: 4 }, (_, i) => ({
      id: `placeholder-related-${i}`,
      label: '',
      isPlaceholder: true
    }));
  }, [isAuthenticated]);

  const fetchRelatedGroups = async () => {
    if (!isAuthenticated) return; // skip when not authenticated
    if (!isVisible) return; // fetch only when panel is open
    if (!imageIds.length) return;
    
    setIsLoadingRelatedGroups(true);
    try {
      const selectedParam = [currentGroupId, ...selectedGroups].filter(Boolean).join(',');
      const params = {
        image_ids: imageIds.join(','),
        selected_groups: selectedParam
      };
      const data = await groupsAPI.getRelated(eventUrl, params);
      
        // Store related groups in session storage (replace any existing value)
        sessionStorage.setItem('groupDetail_filteredRelatedGroups', JSON.stringify(data.related_group_ids || []));
        
        // Insert related groups locally into store (no broadcast), regardless of scopes
        const store = useDataStore.getState();
        store.applyChanges([
          { type: 'INSERT', entity: 'groups', items: data.related_groups, broadcast: false, ignoreScope: true }
        ], { broadcast: false, ignoreScope: true });

        const after = useDataStore.getState().entities?.groups || {};
        const relatedList = Object.values(data.related_groups).map(it => after?.[it.id]).filter(Boolean);
        onRelatedGroupsUpdate?.(relatedList);
    } catch (error) {
      console.error('Error fetching related groups:', error);
    } finally {
      setIsLoadingRelatedGroups(false);
    }
  };

  const handleGroupClick = (groupId) => {
    if (groupId === currentGroupId) return; // lock current
    const newSelectedGroups = selectedGroups.includes(groupId)
      ? selectedGroups.filter((id) => id !== groupId)
      : [...selectedGroups, groupId];
    setSelectedGroups(newSelectedGroups);
    onSelectedGroupsChange?.(newSelectedGroups);
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

  // Keep internal selection in sync if parent persisted selection changes (without emitting back)
  useEffect(() => {
    setSelectedGroups(initialSelectedGroups || []);
  }, [initialSelectedGroups]);

  // Avoid loops: memoize last request signature
  const lastReqRef = useState({ current: '' })[0];

  // Fetch related groups when filter opens and store in session storage
  useEffect(() => {
    if (isVisible) {
      try { registerModal({ id: PANEL_ID, type: 'panel', scopes: [{ entity: 'all', id: 'groups' }] }); } catch {}
      try { useApplyScopes([{ entity: 'all', id: 'groups' }]); } catch {}
      
      // Fetch related groups when filter opens and store in session storage
      const selectedParam = [currentGroupId, ...selectedGroups].filter(Boolean).join(',');
      const signature = `${isVisible}|${eventUrl}|${selectedParam}|${imageIds.join(',')}`;
      if (signature === lastReqRef.current) return;
      lastReqRef.current = signature;
      fetchRelatedGroups();
    }
    return () => {
      if (!isVisible) {
        try { unregisterModal(PANEL_ID); } catch {}
      }
    };
  }, [selectedGroups, imageIds, currentGroupId, eventUrl, isVisible, registerModal, unregisterModal]);

  // Reset handler: clear selection (current remains locked implicitly)
  const handleReset = () => {
    setSelectedGroups([]);
    onSelectedGroupsChange?.([]);
    // Clear session storage
    sessionStorage.removeItem('groupDetail_filteredRelatedGroups');
    // Trigger a fresh fetch of related groups
    fetchRelatedGroups();
    onReset?.();
  };

  // Build display list: selected first (in order), then related groups from session storage (keep order, no dups). Exclude currentGroupId from this row (it's shown as main group)
  const displayGroups = useMemo(() => {
    // Return placeholders when not authenticated
    if (!isAuthenticated) return placeholderRelatedGroups;
    
    const seen = new Set((selectedGroups || []).map(v => String(v)));
    const groupMap = new Map(Object.values(groups || {}).map(g => [String(g.id || g.group_id), g]));
    
    // Get related group IDs from session storage
    let sessionRelatedGroupIds = [];
    try {
      const stored = sessionStorage.getItem('groupDetail_filteredRelatedGroups');
      if (stored) {
        sessionRelatedGroupIds = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Error reading related groups from session storage:', error);
    }
    
    const currentIdStr = currentGroupId != null ? String(currentGroupId) : null;
    
    // Get selected groups objects (filter out groups with 0 images)
    const selectedObjs = (selectedGroups || [])
      .filter(id => String(id) !== currentIdStr)
      .map(id => groupMap.get(String(id)) || { id, label: `Person ${id}` })
      .filter(group => {
        const imageCount = getImageCount(group);
        return imageCount > 0;
      });
    
    // Get remaining related groups (not selected, filter out groups with 0 images)
    const tail = sessionRelatedGroupIds
      .filter(id => {
        const gid = String(id);
        return !seen.has(gid) && gid !== currentIdStr;
      })
      .map(id => groupMap.get(String(id)) || { id, label: `Person ${id}` })
      .filter(group => {
        const imageCount = getImageCount(group);
        return imageCount > 0;
      });
    
    return [...selectedObjs, ...tail];
  }, [selectedGroups, currentGroupId, groups, isAuthenticated, placeholderRelatedGroups]);

  const getGroupDisplayName = (group) => {
    if (!group) return 'Person';
    const id = group.id || group.group_id || '';
    return group.label || `Person ${id}`;
  };

  const showResetButton = selectedGroups.length > 0 || onlySelected || filterMode !== 'and';

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
            <span className="text-sm font-medium text-gray-700">Filter by Persons</span>
            
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
                      : selectedGroups.includes(groupId)
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
        {selectedGroups.length > 0 && (
          <div className="mt-2 text-xs text-gray-500">
            Filtering by {selectedGroups.length} additional group{selectedGroups.length !== 1 ? 's' : ''} ({filterMode.toUpperCase()} mode{onlySelected ? ', only selected groups' : ''})
          </div>
        )}
        </motion.div>
      </AnimatePresence>
    </>
  );
} 