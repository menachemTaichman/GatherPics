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
  UserX
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

  const handleGroupClick = (groupId) => {
    if (selectedGroups.includes(groupId)) {
      // Remove from filter
      const newSelected = selectedGroups.filter(id => id !== groupId);
      onFilterChange(newSelected);
    } else {
      // Add to filter
      const newSelected = [...selectedGroups, groupId];
      onFilterChange(newSelected);
    }
  };

  const getGroupDisplayName = (group) => {
    return group.label || `Person ${group.groupID}`;
  };

  const getGroupTooltip = (group) => {
    const name = getGroupDisplayName(group);
    const sharedImages = group.shared_images || 0;
    return `${name} (${sharedImages} shared images)`;
  };

  if (!isVisible) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="bg-gray-50 border-b border-gray-200 px-8 py-4"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          <Filter className="w-4 h-4 text-gray-600" />
          <span className="text-sm font-medium text-gray-700">Filter by Groups</span>
          
          {/* Filter Mode Toggle */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => onModeChange('and')}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                filterMode === 'and' 
                  ? 'bg-primary-100 text-primary-700 border border-primary-200' 
                  : 'hover:bg-gray-200 text-gray-600'
              }`}
              title="AND mode - Images must contain faces from ALL selected groups"
            >
              <UserCheck className="w-3 h-3" />
              <span className="ml-1">AND</span>
            </button>
            <button
              onClick={() => onModeChange('or')}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                filterMode === 'or' 
                  ? 'bg-primary-100 text-primary-700 border border-primary-200' 
                  : 'hover:bg-gray-200 text-gray-600'
              }`}
              title="OR mode - Images must contain faces from AT LEAST ONE selected group"
            >
              <Users className="w-3 h-3" />
              <span className="ml-1">OR</span>
            </button>
          </div>

          {/* Only Selected Checkbox */}
          <label className="flex items-center space-x-1 cursor-pointer">
            <input
              type="checkbox"
              checked={onlySelected}
              onChange={(e) => onOnlySelectedChange(e.target.checked)}
              className="w-3 h-3 text-primary-600 rounded focus:ring-primary-500"
            />
            <span className="text-xs text-gray-600">Only selected groups</span>
          </label>
        </div>

        <div className="flex items-center space-x-2">
          {selectedGroups.length > 0 && (
            <button
              onClick={onReset}
              className="flex items-center space-x-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded transition-colors"
              title="Clear filter"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* Groups Row */}
      <div className="flex items-center space-x-3 overflow-x-auto pb-2">
        {/* Main Group (always selected) */}
        <div className="flex-shrink-0">
          <div className="relative group">
            <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-primary-500 bg-primary-100 flex items-center justify-center">
                                    {group.face_representative ? (
                <img
                  src={`${import.meta.env.VITE_API_BASE || 'http://localhost:5000'}/api/events/75cb6635-879d-4386-b023-366444dc0fb2/faces/${group.face_representative}.webp`}
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
            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
              {getGroupDisplayName(group)} (main)
            </div>
          </div>
        </div>

        {/* Related Groups */}
        <AnimatePresence>
          {relatedGroups.map((relatedGroup) => (
            <motion.div
              key={relatedGroup.groupID}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="flex-shrink-0"
            >
              <div 
                className={`relative group cursor-pointer transition-all duration-200 ${
                  selectedGroups.includes(relatedGroup.groupID) 
                    ? 'ring-2 ring-primary-500 ring-offset-2' 
                    : 'hover:ring-2 hover:ring-gray-300 hover:ring-offset-2'
                }`}
                onClick={() => handleGroupClick(relatedGroup.groupID)}
                onMouseEnter={() => setHoveredGroup(relatedGroup.groupID)}
                onMouseLeave={() => setHoveredGroup(null)}
              >
                <div className={`w-8 h-8 rounded-full overflow-hidden border-2 ${
                  selectedGroups.includes(relatedGroup.groupID)
                    ? 'border-primary-500 bg-primary-100'
                    : 'border-gray-300 bg-gray-100'
                } flex items-center justify-center`}>
                                        {relatedGroup.face_representative ? (
                    <img
                      src={`${import.meta.env.VITE_API_BASE || 'http://localhost:5000'}/api/events/75cb6635-879d-4386-b023-366444dc0fb2/faces/${relatedGroup.face_representative}.webp`}
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
                
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  {getGroupTooltip(relatedGroup)}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Filter Status */}
      {selectedGroups.length > 0 && (
        <div className="mt-2 text-xs text-gray-500">
          Filtering by {selectedGroups.length} additional group{selectedGroups.length !== 1 ? 's' : ''} 
          ({filterMode.toUpperCase()} mode{onlySelected ? ', only selected groups' : ''})
        </div>
      )}
    </motion.div>
  );
} 