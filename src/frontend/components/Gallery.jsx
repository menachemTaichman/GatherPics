import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, Filter, Download, Edit, Trash2, User, Minus, Plus, Users, ArrowUp, ArrowDown } from 'lucide-react';
import FaceCard from './FaceCard';
import EditGroupModal from './EditGroupModal';
import DeleteConfirmModal from './DeleteConfirmModal';
import MergeGroupsModal from './MergeGroupsModal';
import { sortGroups } from '../utils/sorting';
import { useSetting } from '../utils/useSettings';

export default function Gallery({ groups, onUpdateGroup, onDeleteGroup, onMergeComplete }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [sortBy, setSortBy] = useSetting('gallery_sortBy', 'name');
  const [sortOrder, setSortOrder] = useSetting('gallery_sortOrder', 'desc');
  const [cardSize, setCardSize] = useSetting('gallery_cardSize', 1.0);
  const [cardSizeInputValue, setCardSizeInputValue] = useState();

  const filteredAndSortedGroups = useMemo(() => {
    let filtered = groups.filter(group => 
      group.label?.toLowerCase().includes(searchTerm.toLowerCase()) ||
              group.groupID.toString().includes(searchTerm)
    );

    // Sort groups using global utility
    return sortGroups(filtered, sortBy, sortOrder);
  }, [groups, searchTerm, sortBy, sortOrder]);

  const handleEditGroup = (group) => {
    setSelectedGroup(group);
    setShowEditModal(true);
  };

  const handleDeleteGroup = (group) => {
    setSelectedGroup(group);
    setShowDeleteModal(true);
  };

  const handleMergeGroups = () => {
    setShowMergeModal(true);
  };

  const handleAddGroupToBucket = async (group) => {
    // TODO: Implement add to bucket functionality
    alert(`Add ${group.label || `Person_${group.groupID}`} to bucket functionality will be implemented later`);
  };

  return (
    <div className="w-full px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Face Gallery
            </h1>
            <p className="text-gray-600">
              {filteredAndSortedGroups.length} of {groups.length} face groups
            </p>
          </div>
          
          <div className="flex items-center space-x-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                id="search-faces"
                name="search-faces"
                placeholder="Search faces..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent w-64"
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="appearance-none pl-3 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                >
                  <option value="name">Sort by Name</option>
                  <option value="count">Sort by Count</option>
                  <option value="date">Sort by Date</option>
                </select>
                <Filter className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />
              </div>
              
              <button
                onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center space-x-1"
                title={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
              >
                {sortOrder === 'asc' ? (
                  <ArrowUp className="w-4 h-4" />
                ) : (
                  <ArrowDown className="w-4 h-4" />
                )}
              </button>
            </div>

            <button
              onClick={handleMergeGroups}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2"
            >
              <Users className="w-4 h-4" />
              <span>Merge Groups</span>
            </button>

            {/* Size Control */}
            <div className="flex items-center space-x-2 bg-gray-50 rounded-lg px-3 py-2">
              <button
                onClick={() => {
                  const currentPercent = Math.round(cardSize * 100);
                  const next25 = Math.ceil(currentPercent / 25) * 25;
                  const prev25 = Math.floor((currentPercent - 1) / 25) * 25;
                  const subtract25 = currentPercent - 25;
                  const newPercent = Math.max(75, Math.max(subtract25, prev25));
                  setCardSize(newPercent / 100);
                }}
                disabled={cardSize <= 0.75}
                className="p-1 hover:bg-gray-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Minus className="w-4 h-4" />
              </button>
              <input
                type="text"
                id="card-size-input"
                name="card-size-input"
                inputMode="numeric"
                pattern="[0-9]*"
                value={cardSizeInputValue !== undefined ? cardSizeInputValue : Math.round(cardSize * 100)}
                onChange={e => setCardSizeInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={e => {
                  let val = parseInt(e.target.value, 10);
                  if (isNaN(val)) val = Math.round(cardSize * 100);
                  val = Math.max(75, Math.min(175, val));
                  setCardSize(val / 100);
                  setCardSizeInputValue(undefined);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.target.blur();
                  } else if (e.key === 'Escape') {
                    setCardSizeInputValue(undefined);
                  }
                }}
                className="text-sm font-medium text-gray-700 w-12 text-center bg-transparent border-b border-gray-300 focus:outline-none focus:border-primary-500"
                style={{width: '3rem'}}
              />
              <button
                onClick={() => {
                  const currentPercent = Math.round(cardSize * 100);
                  const next25 = Math.ceil((currentPercent + 1) / 25) * 25;
                  const add25 = currentPercent + 25;
                  const newPercent = Math.min(175, Math.min(add25, next25));
                  setCardSize(newPercent / 100);
                }}
                disabled={cardSize >= 1.75}
                className="p-1 hover:bg-gray-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Gallery Grid */}
      {filteredAndSortedGroups.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-12"
        >
          <User className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchTerm ? 'No faces found' : 'No face groups yet'}
          </h3>
          <p className="text-gray-500">
            {searchTerm 
              ? 'Try adjusting your search terms' 
              : 'Upload some photos to get started'
            }
          </p>
        </motion.div>
      ) : (
        <motion.div 
          className={`gallery-grid size-${Math.round(cardSize * 100).toString().padStart(3, '0')}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {filteredAndSortedGroups.map((group, index) => (
            <motion.div
              key={group.groupID}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
            >
              <FaceCard
                group={group}
                cardSize={cardSize}
                onEdit={() => handleEditGroup(group)}
                onDelete={() => handleDeleteGroup(group)}
                onDownload={() => handleAddGroupToBucket(group)}
              />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Modals */}
      {showEditModal && selectedGroup && (
        <EditGroupModal
          group={selectedGroup}
          onClose={() => {
            setShowEditModal(false);
            setSelectedGroup(null);
          }}
          onSave={async (updates) => {
            await onUpdateGroup(selectedGroup.groupID, updates);
            setShowEditModal(false);
            setSelectedGroup(null);
          }}
        />
      )}

      {showDeleteModal && selectedGroup && (
        <DeleteConfirmModal
          group={selectedGroup}
          onClose={() => {
            setShowDeleteModal(false);
            setSelectedGroup(null);
          }}
          onConfirm={async () => {
            await onDeleteGroup(selectedGroup.groupID);
            setShowDeleteModal(false);
            setSelectedGroup(null);
          }}
        />
      )}

      {showMergeModal && (
        <MergeGroupsModal
          groups={groups}
          onClose={() => setShowMergeModal(false)}
          onMergeComplete={onMergeComplete}
        />
      )}
    </div>
  );
} 