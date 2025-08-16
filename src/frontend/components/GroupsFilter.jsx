const FIXED_EVENT_ID = "75cb6635-879d-4386-b023-366444dc0fb2";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

export default function GroupsFilter({ 
  group, 
  relatedGroups, 
  selectedGroups, 
  filterMode, 
  onlySelected,
  onFilterChange,
  onModeChange,
  onOnlySelectedChange,
  onReset,
  isVisible
}) {
  const [hoveredGroup, setHoveredGroup] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const handleGroupClick = (groupId) => {
    onFilterChange(
      selectedGroups.includes(groupId)
        ? selectedGroups.filter((id) => id !== groupId)
        
        : [...selectedGroups, groupId]
    );
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

  const getGroupDisplayName = (group) => {
    return group.label || `Person ${group.groupID}`;
  };

  const showResetButton = selectedGroups.length > 0 || onlySelected || filterMode !== 'and';

  return (
    <>
      {/* Floating Tooltip */}
      <AnimatePresence>
        {hoveredGroup && (
          <motion.div 
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
              {hoveredGroup === group.groupID 
                ? getGroupDisplayName(group)
                : getGroupDisplayName(relatedGroups.find(g => g.groupID === hoveredGroup))
              }
            </div>
            {/* Removed subtitle text for cleaner tooltip */}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ 
          duration: 0.3, 
          ease: "easeInOut",
          height: { duration: 0.3, ease: "easeInOut" },
          opacity: { duration: 0.2, ease: "easeInOut" }
        }}
        className="bg-white border-b border-gray-200 px-8 py-4"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <Filter className="w-4 h-4 text-gray-600" />
            <span className="text-sm font-medium text-gray-700">Filter by Groups</span>
            
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
          </div>

          <div className="flex items-center space-x-2">
            {showResetButton && (
              <button
                onClick={onReset}
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
            className="flex-shrink-0 relative group"
            onMouseEnter={(event) => handleMouseEnter(group.groupID, event)}
            onMouseLeave={handleMouseLeave}
            onMouseMove={handleMouseMove}
          >
            <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-primary-500 bg-primary-100 flex items-center justify-center">
              {group.face_representative ? (
                <img
                  src={`${import.meta.env.VITE_API_BASE || 'http://localhost:5000'}/api/events/${FIXED_EVENT_ID}/faces/${group.face_representative}.webp`}
                  alt={getGroupDisplayName(group)}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="16" fill="%239ca3af">?</text></svg>';
                  }}
                />
              ) : (
                <span className="text-xs text-primary-600 font-medium">?</span>
              )}
            </div>
            {/* Enhanced Tooltip - Removed since we have floating tooltip */}
          </div>

          {/* Related Groups */}
          {relatedGroups.map((relatedGroup) => (
            <div
              key={relatedGroup.groupID}
              className="flex-shrink-0 relative group"
              onMouseEnter={(event) => handleMouseEnter(relatedGroup.groupID, event)}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
            >
              <div 
                className="cursor-pointer"
                onClick={() => handleGroupClick(relatedGroup.groupID)}
              >
                <div className={`w-8 h-8 rounded-full overflow-hidden border-2 flex items-center justify-center transition-all duration-200 ${
                  selectedGroups.includes(relatedGroup.groupID)
                    ? 'border-primary-500 bg-primary-100 ring-2 ring-primary-500 ring-offset-2'
                    : 'border-gray-300 bg-gray-100 group-hover:ring-2 group-hover:ring-gray-300 group-hover:ring-offset-2'
                }`}>
                  {relatedGroup.face_representative ? (
                    <img
                      src={`${import.meta.env.VITE_API_BASE || 'http://localhost:5000'}/api/events/${FIXED_EVENT_ID}/faces/${relatedGroup.face_representative}.webp`}
                      alt={getGroupDisplayName(relatedGroup)}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="16" fill="%239ca3af">?</text></svg>';
                      }}
                    />
                  ) : (
                    <span className="text-xs text-gray-600 font-medium">?</span>
                  )}
                </div>
                
                {/* Add/Remove Icon on Hover */}
                <div 
                  className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 group-hover:bg-opacity-50 rounded-full transition-opacity duration-200 pointer-events-none"
                >
                  {selectedGroups.includes(relatedGroup.groupID) ? (
                    <Minus className="w-4 h-4 text-white opacity-0 group-hover:opacity-100" />
                  ) : (
                    <Plus className="w-4 h-4 text-white opacity-0 group-hover:opacity-100" />
                  )}
                </div>
              </div>

              {/* Enhanced Group Name Tooltip - Removed since we have floating tooltip */}
            </div>
          ))}
        </div>

        {/* Filter Status */}
        {selectedGroups.length > 0 && (
          <div className="mt-2 text-xs text-gray-500">
            Filtering by {selectedGroups.length} additional group{selectedGroups.length !== 1 ? 's' : ''} ({filterMode.toUpperCase()} mode{onlySelected ? ', only selected groups' : ''})
          </div>
        )}
      </motion.div>
    </>
  );
} 