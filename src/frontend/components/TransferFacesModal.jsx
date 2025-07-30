import { useState, useEffect } from 'react';
import { X, AlertTriangle, User, Plus, Users, Search, ArrowUpDown } from 'lucide-react';
import { groupsAPI, handleAPIError } from '../utils/apiService';

export default function TransferFacesModal({ 
  isOpen, 
  onClose, 
  groups, 
  currentGroup,
  selectedFaces,
  onTransferComplete
}) {
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [nameConflict, setNameConflict] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name'); // 'name' or 'count'
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' or 'desc'

  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';
  const FIXED_EVENT_ID = "75cb6635-879d-4386-b023-366444dc0fb2";
  const PLACEHOLDER_DATA_URL = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="80" fill="%239ca3af">?</text></svg>';

  // Load sorting preferences from localStorage
  useEffect(() => {
    const savedSortBy = localStorage.getItem('transferModal_sortBy');
    const savedSortOrder = localStorage.getItem('transferModal_sortOrder');
    if (savedSortBy) setSortBy(savedSortBy);
    if (savedSortOrder) setSortOrder(savedSortOrder);
  }, []);

  // Save sorting preferences to localStorage
  useEffect(() => {
    localStorage.setItem('transferModal_sortBy', sortBy);
    localStorage.setItem('transferModal_sortOrder', sortOrder);
  }, [sortBy, sortOrder]);

  // Filter out current group from available groups
  const availableGroups = groups.filter(g => g.groupID !== currentGroup?.groupID);

  // Filter and sort groups
  const filteredAndSortedGroups = availableGroups
    .filter(group => {
      const label = group.label || `Person ${group.groupID}`;
      return label.toLowerCase().includes(searchTerm.toLowerCase());
    })
    .sort((a, b) => {
      let aValue, bValue;
      
      if (sortBy === 'name') {
        aValue = a.label || `Person ${a.groupID}`;
        bValue = b.label || `Person ${b.groupID}`;
      } else {
        aValue = a.image_ids?.length || 0;
        bValue = b.image_ids?.length || 0;
      }
      
      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

  useEffect(() => {
    if (isOpen) {
      setSelectedGroupId('');
      setNewGroupName('');
      setError('');
      setNameConflict(false);
      setSearchTerm('');
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;
      
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter') {
        handleTransfer();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedGroupId, newGroupName, nameConflict]);

  const checkNameConflict = async (name) => {
    if (!name.trim()) {
      setNameConflict(false);
      return;
    }

    try {
      const result = await groupsAPI.checkName(name);
      setNameConflict(result.conflict);
    } catch (error) {
      console.error('Error checking name conflict:', error);
      setNameConflict(false);
    }
  };

  const handleNewGroupNameChange = (e) => {
    const name = e.target.value;
    setNewGroupName(name);
    checkNameConflict(name);
  };

  const handleTransfer = async () => {
    if (!selectedFaces || selectedFaces.length === 0) {
      setError('No faces selected for transfer');
      return;
    }

    if (!selectedGroupId && !newGroupName.trim()) {
      setError('Please select a target group or enter a new group name');
      return;
    }

    if (nameConflict) {
      setError('Group name already exists. Please choose a different name.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      console.log('TransferFacesModal - selectedFaces:', selectedFaces);
      console.log('TransferFacesModal - currentGroup:', currentGroup);
      console.log('TransferFacesModal - selectedGroupId:', selectedGroupId);
      console.log('TransferFacesModal - newGroupName:', newGroupName);
      
      const result = await groupsAPI.transferFaces(
        currentGroup.groupID,
        selectedFaces, // Already an array from getSelectedFaceIds()
        selectedGroupId || null,
        newGroupName.trim() || null
      );

      // The API service interceptor will automatically handle the state updates
      onTransferComplete(result);
      onClose();
    } catch (error) {
      const errorInfo = handleAPIError(error, 'Failed to transfer faces');
      setError(errorInfo.message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSortOrder = () => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Transfer {selectedFaces.size} Face{selectedFaces.size !== 1 ? 's' : ''}
              </h2>
              <p className="text-sm text-gray-500">
                Choose destination group or create new one
              </p>
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
          {/* Search and Sort Controls */}
          <div className="mb-4 flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search groups..."
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
                <option value="count">Sort by Photo Count</option>
              </select>
              <button
                onClick={toggleSortOrder}
                className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                title={sortOrder === 'asc' ? 'Sort Descending' : 'Sort Ascending'}
              >
                <ArrowUpDown className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Groups Grid */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Select existing group:</h3>
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 max-h-64 overflow-y-auto">
              {filteredAndSortedGroups.map((group) => (
                <div
                  key={group.groupID}
                  className={`p-2 border border-transparent rounded-lg cursor-pointer transition-colors ${
                    selectedGroupId === group.groupID
                      ? 'border-orange-500 bg-orange-50'
                      : 'hover:border-gray-300'
                  }`}
                  onClick={() => {
                    setSelectedGroupId(group.groupID);
                    setNewGroupName(''); // Clear new group name when selecting existing
                  }}
                >
                  <div className="flex flex-col items-center space-y-1">
                    {/* Representative Photo - Circular and previous size */}
                    <div className="w-12 h-12 rounded-full overflow-hidden border border-gray-200">
                      <img
                        src={group.face_representive
                          ? `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${group.face_representive}.webp`
                          : PLACEHOLDER_DATA_URL}
                        alt={group.label || `Person ${group.groupID}`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = PLACEHOLDER_DATA_URL;
                        }}
                      />
                    </div>
                    <div className="text-center">
                      <p className="font-medium text-gray-900 text-xs truncate w-full">
                        {group.label || `Person ${group.groupID}`}
                      </p>
                      <p className="text-xs text-gray-500">
                        {group.image_ids?.length || 0} photos
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
          </div>

          {/* New Group Creation */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Or create new group:</h3>
            <div className="relative">
              <input
                type="text"
                value={newGroupName}
                onChange={handleNewGroupNameChange}
                placeholder="Enter new group name..."
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent ${
                  nameConflict ? 'border-red-500' : 'border-gray-300'
                }`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleTransfer();
                  }
                }}
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