import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import jwtService from './jwtService';
import { setCurrentProfile, getCurrentProfile } from './profileService';
import { initializePreferences } from './settings';
import { useModalStore } from './modalManager';
import { profilesAPI } from './apiService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const [pendingNavigation, setPendingNavigation] = useState(null);

  // Check if user is authenticated on mount
  useEffect(() => {
    const checkAuth = async () => {
      const hasToken = jwtService.hasToken();
      
      if (hasToken) {
        // Verify token is still valid by trying to refresh
        try {
          await jwtService.refresh();
          setIsAuthenticated(true);
          
          // Fetch current profile from API
          try {
            // Try to get event URL from current location path
            const pathParts = window.location.pathname.split('/').filter(Boolean);
            const eventUrl = pathParts[0] || null;
            
            const result = await profilesAPI.getCurrentProfile(eventUrl);
            if (result.profile) {
              setCurrentProfile(result.profile);
            }
          } catch (error) {
            console.error('Failed to fetch current profile:', error);
          }
          
          // Load preferences from API after successful authentication
          await initializePreferences(true);
        } catch (error) {
          // Token is invalid, clear it
          jwtService.clearToken();
          setCurrentProfile(null);
          setIsAuthenticated(false);
        }
      } else {
        setIsAuthenticated(false);
        setCurrentProfile(null);
        // Initialize with defaults when not authenticated
        await initializePreferences(false);
      }
      
      setIsLoading(false);
    };

    checkAuth();
  }, []);

  // Listen for auth:required events (triggered when API calls fail due to 401)
  useEffect(() => {
    const handleAuthRequired = () => {
      setIsAuthenticated(false);
      setShowLoginModal(true);
    };

    window.addEventListener('auth:required', handleAuthRequired);
    
    return () => {
      window.removeEventListener('auth:required', handleAuthRequired);
    };
  }, []);

  // Listen for auth events from other tabs
  useEffect(() => {
    const handleStorageChange = (e) => {
      // Listen for logout signal from other tabs
      if (e.key === 'auth:logout' && e.newValue) {
        // Clear token and profile in this tab
        jwtService.clearToken();
        setCurrentProfile(null);
        
        // Close all modals except ImageViewer and LoginModal
        try {
          const modalStore = useModalStore.getState();
          const modalsToClose = modalStore.stack.filter(id => 
            !id.startsWith('image-viewer-') && id !== 'login-modal'
          );
          modalsToClose.forEach(id => {
            try {
              modalStore.unregisterModal(id);
            } catch (e) {
              console.error('Failed to close modal:', id, e);
            }
          });
        } catch (e) {
          console.error('Failed to close modals on logout:', e);
        }
        
        // Sync logout to this tab
        setIsAuthenticated(false);
        setShowLoginModal(false);
        setPendingNavigation(null);
        window.dispatchEvent(new CustomEvent('auth:logout'));
      }
      
      // Listen for login signal from other tabs
      if (e.key === 'auth:login' && e.newValue) {
        // Token is already in localStorage (shared), fetch fresh profile with event context
        try {
          const pathParts = window.location.pathname.split('/').filter(Boolean);
          const eventUrl = pathParts[0] || null;
          
          profilesAPI.getCurrentProfile(eventUrl).then(result => {
            if (result.profile) {
              setCurrentProfile(result.profile);
            }
          }).catch(() => {
            // Fallback to cached profile
            const profile = getCurrentProfile();
            if (profile) {
              setCurrentProfile(profile);
            }
          });
        } catch (error) {
          // Fallback to cached profile
          const profile = getCurrentProfile();
          if (profile) {
            setCurrentProfile(profile);
          }
        }
        // Sync login to this tab
        setIsAuthenticated(true);
        setShowLoginModal(false);
        window.dispatchEvent(new CustomEvent('auth:login'));
        // Reload preferences from API
        initializePreferences(true).catch(console.error);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const login = useCallback(async (label, password) => {
    setLoginError(null);
    
    try {
      const result = await jwtService.login(label, password);
      
      // Store profile - fetch full profile with event context
      try {
        const pathParts = window.location.pathname.split('/').filter(Boolean);
        const eventUrl = pathParts[0] || null;
        
        const profileResult = await profilesAPI.getCurrentProfile(eventUrl);
        if (profileResult.profile) {
          setCurrentProfile(profileResult.profile);
        }
      } catch (error) {
        // Fallback to profile from login result
        if (result.profile) {
          setCurrentProfile(result.profile);
        }
      }
      
      setIsAuthenticated(true);
      setShowLoginModal(false);
      
      // Load preferences from API
      await initializePreferences(true);
      
      // Execute pending navigation if any
      if (pendingNavigation) {
        pendingNavigation();
        setPendingNavigation(null);
      }
      
      // Trigger data refetch event for components to listen to
      window.dispatchEvent(new CustomEvent('auth:login'));
      
      // Broadcast login to other tabs via localStorage
      try {
        localStorage.setItem('auth:login', Date.now().toString());
        // Remove immediately to allow future logins to trigger storage events
        setTimeout(() => localStorage.removeItem('auth:login'), 100);
      } catch (e) {
        console.error('Failed to broadcast login:', e);
      }
      
      return { success: true };
    } catch (error) {
      const errorMessage = error.response?.data?.error || 'Login failed';
      setLoginError(errorMessage);
      return { success: false, error: errorMessage };
    }
  }, [pendingNavigation]);

  const logout = useCallback(async () => {
    try {
      await jwtService.logout();
    } catch (error) {
      console.error('Logout error:', error);
    }
    
    setIsAuthenticated(false);
    setCurrentProfile(null);
    setShowLoginModal(false);
    setPendingNavigation(null);
    
    // Close all modals except ImageViewer (viewing modal) and LoginModal
    try {
      const modalStore = useModalStore.getState();
      const modalsToClose = modalStore.stack.filter(id => 
        !id.startsWith('image-viewer-') && id !== 'login-modal'
      );
      modalsToClose.forEach(id => {
        try {
          modalStore.unregisterModal(id);
        } catch (e) {
          console.error('Failed to close modal:', id, e);
        }
      });
    } catch (e) {
      console.error('Failed to close modals on logout:', e);
    }
    
    // Trigger logout event for components in this tab
    window.dispatchEvent(new CustomEvent('auth:logout'));
    
    // Broadcast logout to other tabs via localStorage
    try {
      localStorage.setItem('auth:logout', Date.now().toString());
      // Remove immediately to allow future logouts to trigger storage events
      setTimeout(() => localStorage.removeItem('auth:logout'), 100);
    } catch (e) {
      console.error('Failed to broadcast logout:', e);
    }
  }, []);

  const requireAuth = useCallback((callback) => {
    if (isAuthenticated) {
      callback();
    } else {
      setPendingNavigation(() => callback);
      setShowLoginModal(true);
    }
  }, [isAuthenticated]);

  const handleLoginModalClose = useCallback(() => {
    setShowLoginModal(false);
    setLoginError(null);
    setPendingNavigation(null);
  }, []);

  const value = {
    isAuthenticated,
    isLoading,
    showLoginModal,
    loginError,
    login,
    logout,
    requireAuth,
    openLoginModal: () => setShowLoginModal(true),
    closeLoginModal: handleLoginModalClose,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

