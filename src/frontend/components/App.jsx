import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useParams, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from './layout';
import { GroupsGalleryPage, GroupDetailPage } from '../pages/groups';
import { AlbumsGalleryPage, AlbumDetailPage } from '../pages/albums';
import { MomentsPage } from '../pages/moments';
import { UploadsGalleryPage, UploadDetailPage } from '../pages/uploads';
import RequestsGalleryPage from '../pages/requests/RequestsGalleryPage';
import { FeedbacksGalleryPage } from '../pages/feedbacks';
import { DashboardPage } from '../pages/dashboard';
import HomePage from '../pages/HomePage';
import EventHomePage from '../pages/EventHomePage';
import { LoadingSpinner, Toast } from './common';
import { LoginModal } from './auth';
import { useDataStore } from '../utils/dataManager';
import { groupsAPI, profilesAPI } from '../utils/apiService';
import { useEventUrls } from '../hooks/useEventUrls';
import { initializePreferences } from '../utils/settings';
import { ToastProvider, useToast } from '../contexts/ToastContext';
import { AuthProvider, useAuth } from '../contexts/authContext';
import { setCurrentProfile } from '../utils/profileService';
import RequestFormModal from './requests/RequestFormModal.jsx';
import { RequestDetailModal } from './requests';
import { requestsAPI, feedbacksAPI } from '../utils/apiService';
import { FeedbackDetailModal, FeedbackFormModal } from './feedbacks';
import diagnosticsCapture from '../utils/diagnosticsCapture';
import { APP_CONFIG } from '../config/appConfig';

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
        nextTitle = `${eventName} - Person: ${groupLabel}`;
      } else {
        // people
        nextTitle = `${eventName} - People`;
      }
    } else if (pathAfterEvent.startsWith('/timeline')) {
      const params = new URLSearchParams(location.search);
      const momentLabel = params.get('moment');
      const state = window.history.state;
      const source = state && typeof state === 'object' ? state.source : null;
      if (momentLabel && source !== 'scroll') {
        nextTitle = `${eventName} - Moment: ${decodeURIComponent(momentLabel)}`;
      } else {
        nextTitle = `${eventName} - Timeline`;
      }
    } else if (pathAfterEvent.startsWith('/albums')) {
      const parts = pathAfterEvent.split('/').filter(Boolean);
      if (parts.length >= 2) {
        // albums/:album_name
        const albumNameEncoded = parts.slice(1).join('/');
        const albumName = decodeURIComponent(albumNameEncoded);
        nextTitle = `${eventName} - Album: ${albumName}`;
      } else {
        // albums
        nextTitle = `${eventName} - Albums`;
      }
    } else if (pathAfterEvent.startsWith('/uploads')) {
      const parts = pathAfterEvent.split('/').filter(Boolean);
      if (parts.length >= 2) {
        // uploads/:uploadId
        const uploadId = parts[1];
        nextTitle = `${eventName} - Upload: ${uploadId}`;
      } else {
        // uploads
        nextTitle = `${eventName} - Uploads`;
      }
    } else if (pathAfterEvent.startsWith('/requests')) {
      nextTitle = `${eventName} - Requests`;
    }

    // Append app name to the title
    nextTitle = `${nextTitle} | ${APP_CONFIG.name}`;

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
            element={<EventHomePage eventUrl={eventUrl} eventData={eventData} />} 
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



