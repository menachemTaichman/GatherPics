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
        group.id === groupId ? { ...group, ...response.data } : group
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
      setGroups(prev => prev.filter(group => group.id !== groupId));
    } catch (err) {
      console.error('Error deleting group:', err);
      throw err;
    }
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
    <Router>
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
                  />
                </motion.div>
              } 
            />
            <Route 
              path="/face/:groupId" 
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
      </div>
    </Router>
  );
}
