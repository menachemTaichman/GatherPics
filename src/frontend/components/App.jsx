import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useParams, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { User } from 'lucide-react';
import Header from './Header';
import Gallery from './GroupsGallery';
import GroupDetail from './GroupDetail';
import AlbumsGallery from './AlbumsGallery';
import AlbumDetail from './AlbumDetail';
import LoadingSpinner from './LoadingSpinner';
import Moments from './Moments';
import { useDataStore } from '../utils/dataManager';
import { groupsAPI, authAPI } from '../utils/apiService';
import { getEventData } from '../utils/eventResolver';
import { useEventUrls } from '../utils/useEventUrls';
import jwtService from '../utils/jwtService';
import { initializePreferences } from '../utils/settings';

// Component to handle root redirect dynamically
function RootRedirect() {
  const [redirectUrl, setRedirectUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function getFirstEvent() {
      try {
        // Get the first available event
        const response = await fetch('/api/events');
        if (response.ok) {
          const events = await response.json();
          if (events.length > 0) {
            setRedirectUrl(`/${events[0].url}`);
          }
        }
      } catch (error) {
        console.error('Error fetching events:', error);
      } finally {
        setLoading(false);
      }
    }

    getFirstEvent();
  }, []);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (redirectUrl) {
    return <Navigate to={redirectUrl} replace />;
  }

  // Fallback if no events found
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="text-red-500 text-6xl mb-4">⚠️</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">No Events Found</h1>
        <p className="text-gray-600 mb-4">No events are currently available.</p>
      </div>
    </div>
  );
}

// Wrapper component to extract eventUrl from params and pass it to AppContent
function AppContentWrapper() {
  const params = useParams();
  const eventUrl = params.eventUrl;
  
  return <AppContent eventUrl={eventUrl} />;
}

// Main content component that receives eventUrl as a prop
function AppContent({ eventUrl }) {
  const location = useLocation();
  const { urlHelpers, loading: urlLoading, error: urlError } = useEventUrls(eventUrl);
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
  const [eventName, setEventName] = useState('');
  const [authInitialized, setAuthInitialized] = useState(false);

  // Initialize JWT authentication
  useEffect(() => {
    async function initializeAuth() {
      try {
        await jwtService.getToken();
        setAuthInitialized(true);
      } catch (error) {
        console.error('Failed to initialize JWT authentication:', error);
        // Still set as initialized to prevent infinite loading
        setAuthInitialized(true);
      }
    }

    initializeAuth();
  }, []);

  useEffect(() => {
    if (eventUrl && authInitialized) {
      fetchGroups();
    }
  }, [eventUrl, authInitialized]);

  // Load event name for document title
  useEffect(() => {
    let isMounted = true;
    async function loadEventName() {
      try {
        const event = await getEventData(eventUrl);
        if (isMounted) {
          setEventName(event?.name || '');
        }
      } catch (e) {
        if (isMounted) {
          setEventName('');
        }
      }
    }
    if (eventUrl) {
      loadEventName();
    }
    return () => { isMounted = false; };
  }, [eventUrl]);

  // Update document title on route/search changes
  useEffect(() => {
    if (!eventName || !eventUrl) return;

    const pathAfterEvent = location.pathname.startsWith(`/${eventUrl}`)
      ? location.pathname.slice(`/${eventUrl}`.length) || '/'
      : location.pathname;

    let nextTitle = eventName;

    if (pathAfterEvent === '/' || pathAfterEvent === '') {
      // Home: only event name
      nextTitle = eventName;
    } else if (pathAfterEvent.startsWith('/persons')) {
      const parts = pathAfterEvent.split('/').filter(Boolean);
      if (parts.length >= 2) {
        // persons/:group_name
        const groupLabelEncoded = parts.slice(1).join('/');
        const groupLabel = decodeURIComponent(groupLabelEncoded);
        nextTitle = `${eventName} - person: ${groupLabel}`;
      } else {
        // persons
        nextTitle = `${eventName} - persons`;
      }
    } else if (pathAfterEvent.startsWith('/timeline')) {
      const params = new URLSearchParams(location.search);
      const momentLabel = params.get('moment');
      const state = window.history.state;
      const source = state && typeof state === 'object' ? state.source : null;
      if (momentLabel && source !== 'scroll') {
        nextTitle = `${eventName} - moment: ${decodeURIComponent(momentLabel)}`;
      } else {
        nextTitle = `${eventName} - timeline`;
      }
    }

    if (document.title !== nextTitle) {
      document.title = nextTitle;
    }
  }, [location.pathname, location.search, eventName, eventUrl]);

  const fetchGroups = async () => {
    try {
      setLoading(true);
      setLocalLoading(true);
      const response = await groupsAPI.getAll(eventUrl);
      const store = useDataStore.getState();
      if (response.groups && response.groups.length) {
        store.applyChanges([{ type: 'UPSERT', entity: 'groups', items: response.groups }]);
      }
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
      const response = await groupsAPI.update(groupId, updates, eventUrl);
      
      // Interceptor applies changes; fall back to direct update if no changes provided
      if (!response.changes) updateGroup(groupId, response);
      
      return response;
    } catch (err) {
      console.error('Error updating group:', err);
      throw err;
    }
  };

  const deleteGroupHandler = async (groupId) => {
    try {
      const response = await groupsAPI.delete(groupId, eventUrl);
      
      // Interceptor applies changes; fall back to direct delete if no changes provided
      if (!response.changes) deleteGroup(groupId);
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

  if (loading || urlLoading || !authInitialized) {
    return <LoadingSpinner />;
  }

  if (urlError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Event Error</h1>
          <p className="text-gray-600 mb-4">{urlError}</p>
        </div>
      </div>
    );
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
    <>
      <Header />
      <AnimatePresence mode="wait">
        <Routes>
          <Route 
            path="persons/:group_name" 
            element={
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <GroupDetail 
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
            path="persons" 
            element={
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <Gallery 
                  eventUrl={eventUrl}
                  groups={groups}
                  onUpdateGroup={updateGroupHandler}
                  onDeleteGroup={deleteGroupHandler}
                  onRefreshGroups={refreshGroups}
                />
              </motion.div>
            } 
          />
          <Route 
            path="albums/:album_name" 
            element={
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <AlbumDetail showToast={showToast} />
              </motion.div>
            }
          />
          <Route 
            path="albums" 
            element={
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <AlbumsGallery eventUrl={eventUrl} />
              </motion.div>
            }
          />
          <Route
            path="timeline"
            element={
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <Moments eventUrl={eventUrl} />
              </motion.div>
            }
          />
          <Route 
            path="" 
            element={
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="min-h-screen bg-gray-50 flex items-center justify-center"
              >
                <div className="text-center">
                  <div className="text-primary-500 text-6xl mb-4">🏠</div>
                  <h1 className="text-3xl font-bold text-gray-900 mb-4">Welcome to Face Gallery</h1>
                  <p className="text-gray-600 mb-6 text-lg">AI-Powered Face Recognition System</p>
                  <Link 
                    to={`/${eventUrl}/persons`}
                    className="inline-flex items-center px-6 py-3 bg-primary-500 text-white font-medium rounded-lg hover:bg-primary-600 transition-colors"
                  >
                    <User className="w-5 h-5 mr-2" />
                    Browse Persons
                  </Link>
                </div>
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
    </>
  );
}

export default function App() {
  // Initialize preferences at startup
  useEffect(() => {
    initializePreferences();
  }, []);

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="min-h-screen bg-gray-50">
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/:eventUrl/*" element={<AppContentWrapper />} />
        </Routes>
      </div>
    </Router>
  );
}
