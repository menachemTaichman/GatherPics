import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useParams, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { User } from 'lucide-react';
import { Header } from './layout';
import { GroupsGalleryPage, GroupDetailPage } from '../pages/groups';
import { AlbumsGalleryPage, AlbumDetailPage } from '../pages/albums';
import { MomentsPage } from '../pages/moments';
import { UploadsGalleryPage, UploadDetailPage } from '../pages/uploads';
import RequestsGalleryPage from '../pages/requests/RequestsGalleryPage';
import { FeedbacksGalleryPage } from '../pages/feedbacks';
import { DashboardPage } from '../pages/dashboard';
import { LoadingSpinner, Toast } from './common';
import { LoginModal } from './auth';
import { useDataStore } from '../utils/dataManager';
import { groupsAPI, profilesAPI } from '../utils/apiService';
import { useEventUrls } from '../hooks/useEventUrls';
import jwtService from '../utils/jwtService';
import { initializePreferences } from '../utils/settings';
import { ToastProvider, useToast } from '../contexts/ToastContext';
import { AuthProvider, useAuth } from '../contexts/authContext';
import { setCurrentProfile, getCurrentProfile } from '../utils/profileService';
import RequestFormModal from './requests/RequestFormModal.jsx';
import { RequestDetailModal } from './requests';
import { requestsAPI, feedbacksAPI } from '../utils/apiService';
import { FeedbackDetailModal, FeedbackFormModal } from './feedbacks';
import diagnosticsCapture from '../utils/diagnosticsCapture';

// Cache for events list to prevent duplicate requests
let eventsCache = null;
let eventsFetchPromise = null;

// Component to display home page with event selection
function HomePage() {
  const [events, setEvents] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const { requireAuth, isAuthenticated, showLoginModal, loginError, login, closeLoginModal } = useAuth();

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

  const handleEventClick = (e, eventUrl, eventData) => {
    e.preventDefault();
    
    if (isAuthenticated) {
      // User is authenticated, navigate immediately
      navigate(`/${eventUrl}`, { 
        state: { eventData } 
      });
    } else {
      // Not authenticated, show login modal and set pending navigation
      requireAuth(() => {
        navigate(`/${eventUrl}`, { 
          state: { eventData } 
        });
      });
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
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Error</h1>
          <p className="text-gray-600 mb-4">{error}</p>
        </div>
      </div>
    );
  }

  if (Object.keys(events).length === 0) {
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
    <>
      <Header />
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
              {Object.entries(events).map(([event_id, event]) => (
                <a
                  key={event_id}
                  href={`/${event.url}`}
                  onClick={(e) => handleEventClick(e, event.url, { ...event, id: event_id, event_id })}
                  className="block bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden group cursor-pointer"
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
                      Browse People
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Login Modal */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={closeLoginModal}
        onLogin={login}
        error={loginError}
      />
    </>
  );
}

// Wrapper component to extract eventUrl from params and pass it to AppContent
function AppContentWrapper() {
  const params = useParams();
  const eventUrl = params.eventUrl;
  
  return <AppContent eventUrl={eventUrl} />;
}

// Public access page component
function PublicAccessPage() {
  const { eventUrl, publicCode } = useParams();
  const navigate = useNavigate();
  const { loginWithPublicCode } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const authenticate = async () => {
      try {
        const result = await loginWithPublicCode(eventUrl, publicCode);
        if (result.success) {
          // Redirect to the event page
          navigate(`/${eventUrl}`);
        } else {
          setError(result.error);
          setLoading(false);
        }
      } catch (err) {
        setError('Authentication failed');
        setLoading(false);
      }
    };

    authenticate();
  }, [eventUrl, publicCode, loginWithPublicCode, navigate]);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <button 
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  return null; // Will redirect on success
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
    deleteGroup
  } = useDataStore();
  
  const { toast, showToast } = useToast();
  const [loading, setLocalLoading] = useState(true);
  const { isAuthenticated, isLoading: authLoading, showLoginModal, loginError, login, closeLoginModal, openLoginModal } = useAuth();
  const [openMyRequestId, setOpenMyRequestId] = useState(null);
  const [openManagerRequest, setOpenManagerRequest] = useState({ id: null, data: null });
  const [openFeedbackId, setOpenFeedbackId] = useState(null);
  const [openMyFeedback, setOpenMyFeedback] = useState({ id: null, data: null });

  // Auto-show login modal when on protected route and not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      // We're on a protected route (inside AppContent) and not authenticated
      openLoginModal();
    }
  }, [isAuthenticated, authLoading, openLoginModal]);

  // Fetch current profile when authenticated
  // Fetch and update current profile with event-specific data when entering an event
  useEffect(() => {
    async function fetchCurrentProfile() {
      if (!isAuthenticated || !eventUrl) return;
      
      try {
        // Fetch current profile with event-specific data
        await profilesAPI.getCurrentProfile(eventUrl);
        // currentProfile updated via changes in response interceptor
      } catch (error) {
        console.error('Failed to fetch current profile for event:', error);
      }
    }

    fetchCurrentProfile();
  }, [isAuthenticated, eventUrl]);

  // Listen for my-requests:open to show RequestFormModal
  useEffect(() => {
    const handler = (ev) => {
      const rid = ev?.detail?.requestId;
      if (rid) setOpenMyRequestId(rid);
    };
    window.addEventListener('my-requests:open', handler);
    return () => window.removeEventListener('my-requests:open', handler);
  }, []);

  // Listen for requests:open-detail (manager) to show RequestDetailModal globally
  useEffect(() => {
    const handler = async (ev) => {
      const rid = ev?.detail?.requestId;
      if (!rid || !eventUrl) return;
      try {
        const res = await requestsAPI.getById(rid, eventUrl);
        const items = res?.changes?.[0]?.items || [];
        const req = items[0] || { id: rid, access_request_id: rid };
        setOpenManagerRequest({ id: rid, data: req });
      } catch {
        setOpenManagerRequest({ id: rid, data: { id: rid, access_request_id: rid } });
      }
    };
    window.addEventListener('requests:open-detail', handler);
    return () => window.removeEventListener('requests:open-detail', handler);
  }, [eventUrl]);

  // Listen for feedback:open-detail to show FeedbackDetailModal globally
  useEffect(() => {
    const handler = (ev) => {
      const fid = ev?.detail?.feedbackId;
      if (!fid) return;
      setOpenFeedbackId(fid);
    };
    window.addEventListener('feedback:open-detail', handler);
    return () => window.removeEventListener('feedback:open-detail', handler);
  }, []);

  // Listen for my-feedback:open to show FeedbackFormModal globally
  useEffect(() => {
    const handler = async (ev) => {
      const fid = ev?.detail?.feedbackId;
      if (!fid) return;
      try {
        const res = await feedbacksAPI.getMyFeedbackById(fid);
        const items = res?.changes?.[0]?.items || [];
        const feedback = items[0] || { id: fid, feedback_id: fid };
        setOpenMyFeedback({ id: fid, data: feedback });
      } catch {
        setOpenMyFeedback({ id: fid, data: { id: fid, feedback_id: fid } });
      }
    };
    window.addEventListener('my-feedback:open', handler);
    return () => window.removeEventListener('my-feedback:open', handler);
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
    } else if (pathAfterEvent.startsWith('/people')) {
      const parts = pathAfterEvent.split('/').filter(Boolean);
      if (parts.length >= 2) {
        // people/:group_name
        const groupLabelEncoded = parts.slice(1).join('/');
        const groupLabel = decodeURIComponent(groupLabelEncoded);
        nextTitle = `${eventName} - person: ${groupLabel}`;
      } else {
        // people
        nextTitle = `${eventName} - people`;
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

  if (urlLoading || authLoading) {
    return (
      <>
        <LoadingSpinner />
        <LoginModal
          isOpen={showLoginModal}
          onClose={closeLoginModal}
          onLogin={login}
          error={loginError}
        />
      </>
    );
  }

  if (urlError) {
    return (
      <>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="text-red-500 text-6xl mb-4">⚠️</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Event Error</h1>
            <p className="text-gray-600 mb-4">{urlError}</p>
          </div>
        </div>
        <LoginModal
          isOpen={showLoginModal}
          onClose={closeLoginModal}
          onLogin={login}
          error={loginError}
        />
      </>
    );
  }

  if (error) {
    return (
      <>
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
        <LoginModal
          isOpen={showLoginModal}
          onClose={closeLoginModal}
          onLogin={login}
          error={loginError}
        />
      </>
    );
  }

  return (
    <>
      <Header />
      <AnimatePresence mode="wait">
        <Routes>
          <Route 
            path="people/:group_name" 
            element={
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <GroupDetailPage 
                  eventUrl={eventUrl}
                  urlHelpers={urlHelpers}
                  groups={groups}
                  onUpdateGroup={updateGroupHandler}
                  onDeleteGroup={deleteGroupHandler}
                  onRefreshGroups={refreshGroups}
                />
              </motion.div>
            } 
          />
          <Route 
            path="people" 
            element={
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <GroupsGalleryPage 
                  eventUrl={eventUrl}
                  urlHelpers={urlHelpers}
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
                <AlbumDetailPage urlHelpers={urlHelpers} />
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
                <AlbumsGalleryPage eventUrl={eventUrl} urlHelpers={urlHelpers} />
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
                <MomentsPage eventUrl={eventUrl} urlHelpers={urlHelpers} />
              </motion.div>
            }
          />
          <Route
            path="uploads/:uploadId"
            element={
              <UploadDetailPage eventUrl={eventUrl} urlHelpers={urlHelpers} />
            }
          />
          <Route
            path="uploads"
            element={
              <UploadsGalleryPage eventUrl={eventUrl} urlHelpers={urlHelpers} />
            }
          />
          <Route
            path="requests"
            element={
              <RequestsGalleryPage eventUrl={eventUrl} urlHelpers={urlHelpers} />
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
                    to={`/${eventUrl}/people`}
                    className="inline-flex items-center px-6 py-3 bg-primary-500 text-white font-medium rounded-lg hover:bg-primary-600 transition-colors"
                  >
                    <User className="w-5 h-5 mr-2" />
                    Browse People
                  </Link>
                </div>
              </motion.div>
            } 
          />
        </Routes>
      </AnimatePresence>

      {/* Login Modal */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={closeLoginModal}
        onLogin={login}
        error={loginError}
      />

      {/* Toast Notification */}
      <Toast toast={toast} />
      {openMyRequestId && (
        <RequestFormModal
          isOpen={!!openMyRequestId}
          onClose={() => setOpenMyRequestId(null)}
          request={{ id: openMyRequestId }}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
        />
      )}
      {openManagerRequest.id && (
        <RequestDetailModal
          isOpen={!!openManagerRequest.id}
          onClose={() => setOpenManagerRequest({ id: null, data: null })}
          request={openManagerRequest.data}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
        />
      )}
      {openFeedbackId && (
        <FeedbackDetailModal
          isOpen={!!openFeedbackId}
          onClose={() => setOpenFeedbackId(null)}
          feedbackId={openFeedbackId}
        />
      )}
      {openMyFeedback.id && (
        <FeedbackFormModal
          isOpen={!!openMyFeedback.id}
          onClose={() => setOpenMyFeedback({ id: null, data: null })}
          feedback={openMyFeedback.data}
        />
      )}
    </>
  );
}

export default function App() {
  // Initialize preferences and diagnostics capture at startup
  useEffect(() => {
    initializePreferences();
    
    // Start capturing diagnostics globally for feedback system
    diagnosticsCapture.startCapture();
    
    // Cleanup on unmount
    return () => {
      diagnosticsCapture.stopCapture();
    };
  }, []);

  return (
    <AuthProvider>
      <ToastProvider>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <div className="min-h-screen bg-gray-50">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/dashboard/feedbacks" element={<FeedbacksGalleryPage />} />
              <Route path="/:eventUrl/public-access/:publicCode" element={<PublicAccessPage />} />
              <Route path="/:eventUrl/*" element={<AppContentWrapper />} />
            </Routes>
          </div>
        </Router>
      </ToastProvider>
    </AuthProvider>
  );
}



