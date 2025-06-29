import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, Filter, Download, Edit, Trash2, User } from 'lucide-react';
import FaceCard from './FaceCard';
import EditGroupModal from './EditGroupModal';
import DeleteConfirmModal from './DeleteConfirmModal';

export default function Gallery({ groups, onUpdateGroup, onDeleteGroup }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [sortBy, setSortBy] = useState('name'); // 'name', 'count', 'date'

  const filteredAndSortedGroups = useMemo(() => {
    let filtered = groups.filter(group => 
      group.label?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      group.id.toString().includes(searchTerm)
    );

    // Sort groups
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (a.label || `Person_${a.id}`).localeCompare(b.label || `Person_${b.id}`);
        case 'count':
          return (b.image_ids?.length || 0) - (a.image_ids?.length || 0);
        case 'date':
          return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
        default:
          return 0;
      }
    });

    return filtered;
  }, [groups, searchTerm, sortBy]);

  const handleEditGroup = (group) => {
    setSelectedGroup(group);
    setShowEditModal(true);
  };

  const handleDeleteGroup = (group) => {
    setSelectedGroup(group);
    setShowDeleteModal(true);
  };

  const handleDownloadGroup = async (group) => {
    try {
      const response = await fetch(`/api/groups/${group.id}/download`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${group.label || `Person_${group.id}`}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading group:', error);
      alert('Failed to download photos. Please try again.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
                placeholder="Search faces..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent w-64"
              />
            </div>
            
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
          className="gallery-grid"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {filteredAndSortedGroups.map((group, index) => (
            <motion.div
              key={group.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
            >
              <FaceCard
                group={group}
                onEdit={() => handleEditGroup(group)}
                onDelete={() => handleDeleteGroup(group)}
                onDownload={() => handleDownloadGroup(group)}
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
            await onUpdateGroup(selectedGroup.id, updates);
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
            await onDeleteGroup(selectedGroup.id);
            setShowDeleteModal(false);
            setSelectedGroup(null);
          }}
        />
      )}
    </div>
  );
} 