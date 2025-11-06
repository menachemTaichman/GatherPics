import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { User, LayoutDashboard, LogIn } from 'lucide-react';
import { Header } from '../components/layout';
import { LoadingSpinner } from '../components/common';
import { LoginModal } from '../components/auth';
import { useAuth } from '../contexts/authContext';
import { getCurrentProfile } from '../utils/profileService';
import jwtService from '../utils/jwtService';
import { APP_CONFIG } from '../config/appConfig';

// Cache for events list to prevent duplicate requests
let eventsCache = null;
let eventsFetchPromise = null;

export default function HomePage() {
  const [events, setEvents] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const { requireAuth, isAuthenticated, isLoading: authLoading, showLoginModal, loginError, login, closeLoginModal, openLoginModal } = useAuth();
  const currentProfile = getCurrentProfile();

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

  useEffect(() => {
    let isMounted = true;

    async function fetchEvents() {
      // Wait for auth to finish loading before fetching events
      if (authLoading) {
        return;
      }
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

      // Start new fetch - include auth headers if available
      eventsFetchPromise = (async () => {
        try {
          const token = jwtService.getTokenSync();
          const headers = token ? { Authorization: `Bearer ${token}` } : {};
          
          const response = await fetch('/api/events', {
            credentials: 'include',
            headers
          });
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
  }, [fetchTrigger, authLoading]);

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

  const hasEvents = Object.keys(events).length > 0;
  const hasDashboard = isAuthenticated && currentProfile?.has_dashboard;
  const showActionButtons = hasDashboard || !isAuthenticated;

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white relative overflow-hidden">
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

        <div className="container mx-auto px-4 py-20 relative z-10">
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
                  <button
                    onClick={() => navigate('/dashboard')}
                    className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white font-medium rounded-lg hover:from-primary-700 hover:to-primary-800 transition-all duration-200 shadow-md hover:shadow-lg"
                  >
                    <LayoutDashboard className="w-5 h-5 mr-2" />
                    Go to Dashboard
                  </button>
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
              className="max-w-5xl mx-auto"
            >
              <div className="text-center mb-10">
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                  Explore Events
                </h2>
                <p className="text-gray-600">
                  Select an event to view its photos and memories
                </p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {Object.entries(events).map(([event_id, event], index) => (
                  <motion.a
                    key={event_id}
                    href={`/${event.url}`}
                    onClick={(e) => handleEventClick(e, event.url, { ...event, id: event_id, event_id })}
                    className="block bg-white border border-gray-200 rounded-lg hover:border-primary-200 hover:shadow-lg transition-all duration-300 overflow-hidden group cursor-pointer"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.4 + index * 0.05 }}
                    whileHover={{ y: -4 }}
                  >
                    <div className="p-6">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="text-lg font-semibold text-gray-900 group-hover:text-primary-600 transition-colors">
                          {event.name}
                        </h3>
                        <svg 
                          className="w-5 h-5 text-gray-400 group-hover:text-primary-600 transition-all flex-shrink-0" 
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                      {event.date && (
                        <div className="flex items-center text-gray-500 text-sm mb-3">
                          <svg className="w-4 h-4 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          {event.date}
                        </div>
                      )}
                      <div className="flex items-center text-primary-600 text-sm">
                        <User className="w-4 h-4 mr-2" />
                        View Photos
                      </div>
                    </div>
                  </motion.a>
                ))}
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
