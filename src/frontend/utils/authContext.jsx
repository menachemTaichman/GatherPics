import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import jwtService from './jwtService';
import { setCurrentProfile, getCurrentProfile } from './profileService';

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
        } catch (error) {
          // Token is invalid, clear it
          jwtService.clearToken();
          setIsAuthenticated(false);
        }
      } else {
        setIsAuthenticated(false);
      }
      
      setIsLoading(false);
    };

    checkAuth();
  }, []);

  const login = useCallback(async (label, password) => {
    setLoginError(null);
    
    try {
      const result = await jwtService.login(label, password);
      
      // Store profile
      if (result.profile) {
        setCurrentProfile(result.profile);
      }
      
      setIsAuthenticated(true);
      setShowLoginModal(false);
      
      // Execute pending navigation if any
      if (pendingNavigation) {
        pendingNavigation();
        setPendingNavigation(null);
      }
      
      // Refresh the page to reload all data with authentication
      window.location.reload();
      
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

