import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Header from './Header';
import Gallery from './Gallery';
import FaceDetail from './FaceDetail';
import LoadingSpinner from './LoadingSpinner';
import Moments from './Moments';
import { useDataStore, CHANGE_TYPES, handleDataChange } from '../utils/dataManager';
import { groupsAPI } from '../utils/apiService';

export default function App() {
  const { 
    groups, 
    setGroups, 
    setLoading, 
    setError, 
    error,
    updateGroup, 
    deleteGroup,
    transferFaces 
  } = useDataStore();
  
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [loading, setLocalLoading] = useState(true);

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      setLoading(true);
      setLocalLoading(true);
      const response = await groupsAPI.getAll();
      setGroups(response);
      setError(null);
    } catch (err) {
      console.error('Error fetching groups:', err);
      setError('Failed to load face groups. Please try again.');
    } finally {
      setLoading(false);
      setLocalLoading(false);
    }
  };

  const updateGroupHandler = async (groupId, updates) => {
    try {
      const response = await groupsAPI.update(groupId, updates);
      
      // Handle any change instructions from the backend
      if (response.changes) {
        response.changes.forEach(change => {
          handleDataChange(change.type, change.data);
        });
      } else {
        // Fallback to direct update if no change instructions
        updateGroup(groupId, response);
      }
      
      return response;
    } catch (err) {
      console.error('Error updating group:', err);
      throw err;
    }
  };

  const deleteGroupHandler = async (groupId) => {
    try {
      const response = await groupsAPI.delete(groupId);
      
      // Handle any change instructions from the backend
      if (response.changes) {
        response.changes.forEach(change => {
          handleDataChange(change.type, change.data);
        });
      } else {
        // Fallback to direct delete if no change instructions
        deleteGroup(groupId);
      }
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

  // The API service interceptor automatically handles transfer updates
  // No need for manual updateGroupsAfterTransfer function

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
                    onUpdateGroup={updateGroupHandler}
                    onDeleteGroup={deleteGroupHandler}
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
                    onUpdateGroup={updateGroupHandler}
                    onDeleteGroup={deleteGroupHandler}
                    showToast={showToast}
                    onRefreshGroups={refreshGroups}
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
