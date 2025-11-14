import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LayoutDashboard, LogIn } from 'lucide-react';
import { Header } from '../components/layout';
import { LoadingSpinner } from '../components/common';
import { LoginModal } from '../components/auth';
import { useAuth } from '../contexts/authContext';
import { getCurrentProfile } from '../utils/profileService';
import { APP_CONFIG } from '../config/appConfig';
import { useApplyScopes } from '../utils/storeUtils';
import { useEventsGeneralList } from '../utils/dataManager';
import { eventsAPI, API_BASE } from '../utils/apiService';
import { ImageComponent } from '../hooks/useImage.jsx';

function formatDateDDMMYYYY(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return dateString;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return dateString;
  }
}

export default function HomePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const { requireAuth, isAuthenticated, isLoading: authLoading, showLoginModal, loginError, login, closeLoginModal, openLoginModal } = useAuth();
  const currentProfile = getCurrentProfile();
  const eventsFromStore = useEventsGeneralList();

  useApplyScopes([{ entity: 'all', id: 'events', eventId: 'general' }]);

  // Trigger for refetching events (incremented when auth state changes)
  const [fetchTrigger, setFetchTrigger] = useState(0);

  useEffect(() => {
    // Set document title for home page
    document.title = APP_CONFIG.name;
  }, []);

  // Clear events cache and trigger refetch when auth state changes
  useEffect(() => {
    const handleAuthChange = () => {
      eventsCache = null;
      eventsFetchPromise = null;
      setFetchTrigger(prev => prev + 1);
    };

    window.addEventListener('auth:login', handleAuthChange);
    window.addEventListener('auth:logout', handleAuthChange);
    
    return () => {
      window.removeEventListener('auth:login', handleAuthChange);
      window.removeEventListener('auth:logout', handleAuthChange);
    };
  }, []);

  const eventsArray = useMemo(() => {
    if (!Array.isArray(eventsFromStore)) return [];
    return eventsFromStore.map((evt) => {
      const eventId = evt?.event_id || evt?.id;
      return { ...evt, event_id: eventId };
    });
  }, [eventsFromStore]);

  const hasEvents = eventsArray.length > 0;
  const hasEventsRef = useRef(hasEvents);
  const representativeCacheMapRef = useRef(new Map());

  const getEventRepresentativeThumbUrl = useCallback((event) => {
    const eventId = event?.event_id || event?.id;
    if (!eventId) return null;
    const imageKey = event?.representative_image ? String(event.representative_image) : 'none';
    const cacheMap = representativeCacheMapRef.current;
    const existing = cacheMap.get(eventId);
    let cacheBuster = existing?.cacheBuster ?? Date.now();
    if (!existing || existing.imageKey !== imageKey) {
      cacheBuster = Date.now();
      cacheMap.set(eventId, { imageKey, cacheBuster });
    }
    const cacheKey = `${imageKey}-${cacheBuster}`;
    return `${API_BASE}/api/events/${eventId}/representative/thumb?v=${encodeURIComponent(cacheKey)}`;
  }, []);

  useEffect(() => {
    if (authLoading) return;

    let cancelled = false;
    const hadEvents = hasEventsRef.current;
    if (!hadEvents) {
      setLoading(true);
    }
    setError(null);

    eventsAPI
      .list()
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load events');
        }
      })
      .finally(() => {
        if (!cancelled && !hadEvents) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, fetchTrigger]);

  useEffect(() => {
    hasEventsRef.current = hasEvents;
    if (hasEvents) {
      setLoading(false);
      setError(null);
    }
  }, [hasEvents]);

  const handleEventClick = (e, eventUrl, eventData) => {
    // Allow default behavior for modifier keys (Ctrl/Cmd/Shift for new tab/window)
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      return;
    }
    
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

  // Show loading while auth is initializing or events are loading
  if (authLoading || loading) {
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
  const hasDashboard = isAuthenticated && currentProfile?.has_dashboard;
  const showActionButtons = hasDashboard || !isAuthenticated;

  return (
    <>
      <Header />
      <div
        className="bg-gradient-to-b from-gray-50 to-white relative overflow-hidden"
        style={{ minHeight: 'calc(100vh - 4rem)' }}
      >
        {/* Subtle animated background accent */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <motion.div
            className="absolute top-0 right-0 w-96 h-96 bg-primary-100/30 rounded-full blur-3xl"
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.2, 0.3],
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: "easeInOut"
            }}
          />
          <motion.div
            className="absolute bottom-0 left-0 w-96 h-96 bg-purple-100/20 rounded-full blur-3xl"
            animate={{
              scale: [1, 1.3, 1],
              opacity: [0.2, 0.3, 0.2],
            }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: "easeInOut"
            }}
          />
        </div>

        <div
          className="container mx-auto px-4 py-20 relative z-10"
          style={{ minHeight: 'max(calc(100vh - 4rem - 10rem), 0px)' }}
        >
          {/* Hero Section */}
          <div className="text-center mb-16 max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <h1 className="text-5xl md:text-6xl font-semibold text-gray-900 mb-4 tracking-tight">
                {APP_CONFIG.name}
              </h1>
              
              <p className="text-xl text-gray-600 mb-4 leading-relaxed">
                {APP_CONFIG.description}
              </p>
              
              <p className="text-base text-gray-500 max-w-2xl mx-auto leading-relaxed">
                Create event collections, organize photos by moments, discover people with smart face recognition, 
                and share memories effortlessly with friends and family.
              </p>
            </motion.div>

            {/* Action Buttons */}
            {showActionButtons && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="flex flex-wrap gap-4 justify-center mt-8"
              >
                {hasDashboard && (
                  <Link
                    to="/dashboard"
                    className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white font-medium rounded-lg hover:from-primary-700 hover:to-primary-800 transition-all duration-200 shadow-md hover:shadow-lg"
                  >
                    <LayoutDashboard className="w-5 h-5 mr-2" />
                    Go to Dashboard
                  </Link>
                )}
                {!isAuthenticated && (
                  <button
                    onClick={openLoginModal}
                    className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white font-medium rounded-lg hover:from-primary-700 hover:to-primary-800 transition-all duration-200 shadow-md hover:shadow-lg"
                  >
                    <LogIn className="w-5 h-5 mr-2" />
                    Log In
                  </button>
                )}
              </motion.div>
            )}
          </div>

          {/* Events Section */}
          {hasEvents && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="max-w-[1100px] mx-auto"
            >
              <div className="text-center mb-10">
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                  Explore Events
                </h2>
                <p className="text-gray-600">
                  Select an event to view its photos and memories
                </p>
              </div>
              
              <div className="flex flex-wrap justify-center gap-5">
                {eventsArray.map((event, index) => {
                  const eventId = event.event_id || event.id;
                  if (!eventId) return null;
                  const thumbUrl = getEventRepresentativeThumbUrl(event);
                  return (
                  <motion.a
                    key={eventId}
                    href={`/${event.url}`}
                    onClick={(e) => handleEventClick(e, event.url, { ...event, id: eventId, event_id: eventId })}
                    className="group block h-full cursor-pointer w-full md:w-[calc(50%-0.625rem)] lg:w-[calc(50%-0.625rem)] xl:w-[calc(33.333%-1.333rem)]"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.4 + index * 0.05 }}
                    whileHover={{ y: -4 }}
                  >
                    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white transition-all duration-300 group-hover:border-primary-200 group-hover:shadow-lg">
                      <div className="relative h-48 w-full overflow-hidden bg-gradient-to-br from-gray-200 to-gray-100">
                        {ImageComponent(
                          thumbUrl,
                          {
                            width: 480,
                            height: 320,
                            className: 'h-full w-full object-cover transition-transform duration-500 group-hover:scale-105',
                            alt: event.name ? `${event.name} cover` : 'Event cover',
                            loading: 'lazy'
                          }
                        )}
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-black/15 to-transparent opacity-60 transition-opacity duration-500 group-hover:opacity-70" />
                      </div>
                      <div className="flex flex-1 flex-col p-6">
                        <div className="mb-3 flex items-center justify-between">
                          <h3 className="text-lg font-semibold text-gray-900 transition-colors group-hover:text-primary-600">
                            {event.name}
                          </h3>
                          <svg 
                            className="h-5 w-5 flex-shrink-0 text-gray-400 transition-all group-hover:text-primary-600 ml-2" 
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                        {event.date && (
                          <div className="mb-3 flex items-center text-sm text-gray-500">
                            <svg className="mr-2 h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            {formatDateDDMMYYYY(event.date)}
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.a>
                );
                })}
              </div>
            </motion.div>
          )}
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
