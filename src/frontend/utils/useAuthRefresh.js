import { useEffect } from 'react';
import { useAuth } from './authContext';

/**
 * Custom hook to handle data fetching on auth state changes
 * Automatically refetches data when user logs in, and provides cleanup on logout
 * 
 * @param {Function} fetchDataFn - Function to call to fetch data
 * @param {Array} dependencies - Additional dependencies for the effect
 * 
 * @example
 * useAuthRefresh(() => groupsAPI.getAll(eventUrl), [eventUrl]);
 */
export function useAuthRefresh(fetchDataFn, dependencies = []) {
  const { isAuthenticated } = useAuth();
  
  useEffect(() => {
    // Fetch data if authenticated
    if (isAuthenticated && typeof fetchDataFn === 'function') {
      fetchDataFn();
    }
    
    // Listen for login event
    const handleAuthLogin = () => {
      if (typeof fetchDataFn === 'function') {
        fetchDataFn();
      }
    };
    
    // Listen for logout event (data cleared automatically by store)
    const handleAuthLogout = () => {
      // Component will re-render with placeholder state
    };
    
    window.addEventListener('auth:login', handleAuthLogin);
    window.addEventListener('auth:logout', handleAuthLogout);
    
    return () => {
      window.removeEventListener('auth:login', handleAuthLogin);
      window.removeEventListener('auth:logout', handleAuthLogout);
    };
  }, [isAuthenticated, fetchDataFn, ...dependencies]);
}

