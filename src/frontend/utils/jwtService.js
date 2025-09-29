import axios from 'axios';
import { getPreference, setPreference } from './settings';

// API base URL - centralized configuration
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

class JWTService {
  constructor() {
    this.token = null;
    this.loadFromStorage();
  }

  // Load token and settings from localStorage
  loadFromStorage() {
    try {
      this.token = localStorage.getItem('jwt_token');
    } catch (error) {
      console.warn('Failed to load JWT from storage:', error);
    }
  }

  // Save token to localStorage
  saveToStorage() {
    try {
      if (this.token) {
        localStorage.setItem('jwt_token', this.token);
      } else {
        localStorage.removeItem('jwt_token');
      }
    } catch (error) {
      console.warn('Failed to save JWT to storage:', error);
    }
  }

  // Get a new JWT token
  async getToken() {
    try {
      // Use provided value or current setting      

      this.token = response.data.access_token;
      
      // Save to storage
      this.saveToStorage();
      
      return this.token;
    } catch (error) {
      console.error('Failed to get JWT token:', error);
      throw error;
    }
  }

  // Get current token, refreshing if needed
  async getCurrentToken() {
    if (!this.token) {
      await this.getToken();
    }
    return this.token;
  }

  // Get authorization header
  async getAuthHeader() {
    const token = await this.getCurrentToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  // Synchronous read of current token (does not trigger refresh)
  getTokenSync() {
    if (this.token) return this.token;
    try {
      const stored = localStorage.getItem('jwt_token');
      if (stored) {
        this.token = stored;
        return stored;
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  // Check if we have a valid token
  hasToken() {
    return !!this.token;
  }

  // Clear token (logout)
  clearToken() {
    this.token = null;
    this.saveToStorage();
  }

  // Logout and clear cookie
  async logout() {
    try {
      await axios.post(`${API_BASE}/logout`, {}, { withCredentials: true });
    } catch (_) {}
    this.clearToken();
  }

}

// Create singleton instance
const jwtService = new JWTService();

export default jwtService;
