import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import Header from './Header';
import Gallery from './Gallery';
import FaceDetail from './FaceDetail';
import LoadingSpinner from './LoadingSpinner';
import Moments from './Moments';

export default function App() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/groups');
      setGroups(response.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching groups:', err);
      setError('Failed to load face groups. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const updateGroup = async (groupId, updates) => {
    try {
      const response = await axios.put(`/api/groups/${groupId}`, updates);
      setGroups(prev => prev.map(group => 
        group.groupID === groupId ? { ...group, ...response.data } : group
      ));
      return response.data;
    } catch (err) {
      console.error('Error updating group:', err);
      throw err;
    }
  };

  const deleteGroup = async (groupId) => {
    try {
      await axios.delete(`/api/groups/${groupId}`);
      setGroups(prev => prev.filter(group => group.groupID !== groupId));
    } catch (err) {
      console.error('Error deleting group:', err);
      throw err;
    }
  };

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'success' });
    }, 3000);
  };

  const refreshGroups = async () => {
    await fetchGroups();
  };

  const updateGroupsAfterTransfer = (result) => {
    setGroups(prev => {
      const newGroups = [...prev];
      
      // Find source and target groups
      const sourceGroupIndex = newGroups.findIndex(g => g.groupID === result.old_group_id);
      const targetGroupIndex = newGroups.findIndex(g => g.groupID === result.target_group_id);
      
      // Update source group if it exists and wasn't deleted
      if (sourceGroupIndex !== -1 && !result.old_group_deleted) {
        const sourceGroup = { ...newGroups[sourceGroupIndex] };
        
        // Update photo count by subtracting transferred photos
        if (result.transferred_photos) {
          const currentCount = sourceGroup.photo_count || sourceGroup.photoCount || sourceGroup.image_ids?.length || 0;
          sourceGroup.photo_count = Math.max(0, currentCount - result.transferred_photos.length);
          // Also update photoCount if it exists (for backward compatibility)
          if (sourceGroup.photoCount !== undefined) {
            sourceGroup.photoCount = sourceGroup.photo_count;
          }
          // Update image_ids if it exists
          if (sourceGroup.image_ids) {
            sourceGroup.image_ids = sourceGroup.image_ids.filter(id => 
              !result.transferred_photos.includes(id)
            );
          }
        }
        
        // Note: The backend handles updating the representative face automatically
        // We don't need to clear it here as the refresh will get the updated data
        
        newGroups[sourceGroupIndex] = sourceGroup;
      }
      
      // Remove source group if it was deleted
      if (result.old_group_deleted && sourceGroupIndex !== -1) {
        newGroups.splice(sourceGroupIndex, 1);
      }
      
      // Update target group if it exists
      if (targetGroupIndex !== -1) {
        const targetGroup = { ...newGroups[targetGroupIndex] };
        
        // Update photo count by adding transferred photos
        if (result.transferred_photos) {
          const currentCount = targetGroup.photo_count || targetGroup.photoCount || targetGroup.image_ids?.length || 0;
          targetGroup.photo_count = currentCount + result.transferred_photos.length;
          // Also update photoCount if it exists (for backward compatibility)
          if (targetGroup.photoCount !== undefined) {
            targetGroup.photoCount = targetGroup.photo_count;
          }
          // Update image_ids if it exists
          if (targetGroup.image_ids) {
            targetGroup.image_ids = [...targetGroup.image_ids, ...result.transferred_photos];
          } else {
            targetGroup.image_ids = [...result.transferred_photos];
          }
        }
        
        // Update representative face if the target group didn't have one
        if (!targetGroup.face_representive && result.transferred_faces && result.transferred_faces.length > 0) {
          // Use the first transferred face as representative (backend should have set the best one)
          targetGroup.face_representive = result.transferred_faces[0];
        }
        
        newGroups[targetGroupIndex] = targetGroup;
      }
      
      // Add new group if it was created
      if (result.new_group_name && targetGroupIndex === -1) {
        const newGroup = {
          groupID: result.target_group_id,
          label: result.new_group_name,
          photo_count: result.transferred_photos ? result.transferred_photos.length : 0,
          photoCount: result.transferred_photos ? result.transferred_photos.length : 0, // For backward compatibility
          image_ids: result.transferred_photos || [], // For FaceCard display
          face_representive: result.transferred_faces && result.transferred_faces.length > 0 ? result.transferred_faces[0] : '',
          // Add other required fields with default values
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        newGroups.push(newGroup);
      }
      
      return newGroups;
    });
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Oops!</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <button 
            onClick={fetchGroups}
            className="btn-primary"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="min-h-screen bg-gray-50">
        <Header />
        <AnimatePresence mode="wait">
          <Routes>
            <Route 
              path="/" 
              element={
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <Gallery 
                    groups={groups}
                    onUpdateGroup={updateGroup}
                    onDeleteGroup={deleteGroup}
                    onRefreshGroups={refreshGroups}
                  />
                </motion.div>
              } 
            />
            <Route 
              path="/group/:group_name" 
              element={
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <FaceDetail 
                    groups={groups}
                    onUpdateGroup={updateGroup}
                    onDeleteGroup={deleteGroup}
                    showToast={showToast}
                    onRefreshGroups={refreshGroups}
                    onUpdateGroupsAfterTransfer={updateGroupsAfterTransfer}
                  />
                </motion.div>
              } 
            />
            <Route
              path="/moments"
              element={
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <Moments />
                </motion.div>
              }
            />
          </Routes>
        </AnimatePresence>

        {/* Toast Notification */}
        <AnimatePresence>
          {toast.show && (
            <motion.div
              initial={{ opacity: 0, y: -50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -50, scale: 0.9 }}
              className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-6 py-3 rounded-lg shadow-lg text-white font-medium ${
                toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
              }`}
            >
              {toast.message}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Router>
  );
}
