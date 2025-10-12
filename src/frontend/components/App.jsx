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
import Toast from './Toast';
import { useDataStore } from '../utils/dataManager';
import { groupsAPI, authAPI } from '../utils/apiService';
import { useEventUrls } from '../utils/useEventUrls';
import jwtService from '../utils/jwtService';
import { initializePreferences } from '../utils/settings';
import { ToastProvider, useToast } from '../utils/ToastContext';

// Cache for events list to prevent duplicate requests
let eventsCache = null;
let eventsFetchPromise = null;

// Component to display home page with event selection
function HomePage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchEvents() {
      // Return cached data if available
      if (eventsCache) {
        setEvents(eventsCache);
        setLoading(false);
        return;
      }

      // If a fetch is already in progress, wait for it
      if (eventsFetchPromise) {
        try {
          const result = await eventsFetchPromise;
          if (isMounted) {
            setEvents(result);
            setLoading(false);
          }
        } catch (err) {
          if (isMounted) {
            setError('Failed to load events');
            setLoading(false);
          }
        }
        return;
      }

      // Start new fetch
      eventsFetchPromise = (async () => {
        try {
          const response = await fetch('/api/events');
          if (!response.ok) {
            throw new Error('Failed to fetch events');
          }
          const data = await response.json();
          eventsCache = data;
          return data;
        } catch (err) {
          throw err;
        } finally {
          eventsFetchPromise = null;
        }
      })();

      try {
        const result = await eventsFetchPromise;
        if (isMounted) {
          setEvents(result);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError('Failed to load events');
          setLoading(false);
        }
      }
    }

    fetchEvents();
    return () => { isMounted = false; };
  }, []);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Error</h1>
          <p className="text-gray-600 mb-4">{error}</p>
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-400 text-6xl mb-4">📅</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">No Events Found</h1>
          <p className="text-gray-600 mb-4">No events are currently available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            📸 Face Gallery
          </h1>
          <p className="text-xl text-gray-600">
            AI-Powered Face Recognition System
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6 text-center">
            Select an Event
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {events.map((event) => (
              <Link
                key={event.id}
                to={`/${event.url}`}
                state={{ eventData: event }}
                className="block bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden group"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-xl font-semibold text-gray-900 group-hover:text-primary-600 transition-colors">
                      {event.name}
                    </h3>
                    <svg 
                      className="w-6 h-6 text-gray-400 group-hover:text-primary-600 group-hover:translate-x-1 transition-all" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  {event.date && (
                    <p className="text-gray-500 text-sm mb-4 flex items-center">
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {event.date}
                    </p>
                  )}
                  <div className="flex items-center text-primary-600 font-medium text-sm group-hover:gap-2 transition-all">
                    <User className="w-4 h-4 mr-1" />
                    Browse Persons
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
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
  const { urlHelpers, eventData, loading: urlLoading, error: urlError } = useEventUrls(eventUrl);
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
  
  const { toast, showToast } = useToast();
  const [loading, setLocalLoading] = useState(true);
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

  // Get event name from eventData (resolved by useEventUrls)
  const eventName = eventData?.name || '';

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
      // Changes are automatically applied by apiService interceptor
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


  const refreshGroups = async () => {
    await fetchGroups();
  };

  // The API service interceptor automatically handles transfer updates
  // No need for manual updateGroupsAfterTransfer function

  if (urlLoading || !authInitialized) {
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
                <AlbumDetail />
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
      <Toast toast={toast} />
    </>
  );
}

export default function App() {
  // Initialize preferences at startup
  useEffect(() => {
    initializePreferences();
  }, []);

  return (
    <ToastProvider>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <div className="min-h-screen bg-gray-50">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/:eventUrl/*" element={<AppContentWrapper />} />
          </Routes>
        </div>
      </Router>
    </ToastProvider>
  );
}
