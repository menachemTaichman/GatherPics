import axios from 'axios';

// API base URL - centralized configuration
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

class JWTService {
  constructor() {
    this.token = null;
    this.tokenExpiry = null;
    this.loadFromStorage();
    this._refreshPromise = null;
  }

  // Load token from localStorage
  loadFromStorage() {
    try {
      this.token = localStorage.getItem('jwt_token');
      const expiry = localStorage.getItem('jwt_token_expiry');
      this.tokenExpiry = expiry ? parseInt(expiry, 10) : null;
    } catch (error) {
      console.warn('Failed to load JWT from storage:', error);
    }
  }

  // Save token to localStorage
  saveToStorage() {
    try {
      if (this.token) {
        localStorage.setItem('jwt_token', this.token);
        if (this.tokenExpiry) {
          localStorage.setItem('jwt_token_expiry', this.tokenExpiry.toString());
        }
      } else {
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('jwt_token_expiry');
      }
    } catch (error) {
      console.warn('Failed to save JWT to storage:', error);
    }
  }

  // Calculate token expiry time (15 minutes from now)
  calculateExpiry() {
    return Date.now() + (15 * 60 * 1000); // 15 minutes in milliseconds
  }

  // Check if token is expired or will expire soon (within 1 minute)
  isTokenExpiringSoon() {
    if (!this.tokenExpiry) return true;
    const oneMinuteFromNow = Date.now() + (60 * 1000);
    return this.tokenExpiry <= oneMinuteFromNow;
  }

  // Login with credentials
  async login(label, password) {
    try {
      const response = await axios.post(`${API_BASE}/api/auth/login`, {
        label,
        password
      }, { withCredentials: true });

      this.token = response.data.access_token;
      this.tokenExpiry = this.calculateExpiry();
      this.saveToStorage();

      return {
        access_token: this.token,
        profile: response.data.profile
      };
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }

  // Refresh access token using refresh token cookie
  async refresh() {
    // Prevent multiple concurrent refresh requests
    if (this._refreshPromise) {
      return this._refreshPromise;
    }

    this._refreshPromise = (async () => {
      try {
        const response = await axios.post(`${API_BASE}/api/auth/refresh`, {}, { 
          withCredentials: true 
        });

        this.token = response.data.access_token;
        this.tokenExpiry = this.calculateExpiry();
        this.saveToStorage();

        return this.token;
      } catch (error) {
        // Only log in development
        if (import.meta.env.MODE !== 'production') {
          console.error('Token refresh failed:', error);
        }
        // Clear invalid token
        this.clearToken();
        throw error;
      } finally {
        this._refreshPromise = null;
      }
    })();

    return this._refreshPromise;
  }

  // Get current token, refreshing if needed
  async getCurrentToken() {
    if (!this.token) {
      throw new Error('No token available');
    }

    // Proactively refresh if token is expiring soon
    if (this.isTokenExpiringSoon()) {
      try {
        await this.refresh();
      } catch (error) {
        // If refresh fails, throw to trigger login
        throw error;
      }
    }

    return this.token;
  }

  // Get authorization header
  async getAuthHeader() {
    try {
      const token = await this.getCurrentToken();
      return { Authorization: `Bearer ${token}` };
    } catch (error) {
      return {};
    }
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

  // Check if we have a token
  hasToken() {
    return !!this.token || !!localStorage.getItem('jwt_token');
  }

  // Clear token
  clearToken() {
    this.token = null;
    this.tokenExpiry = null;
    this.saveToStorage();
  }

  // Logout and revoke refresh token
  async logout() {
    try {
      await axios.post(`${API_BASE}/api/auth/logout`, {}, { withCredentials: true });
    } catch (error) {
      console.error('Logout error:', error);
    }
    this.clearToken();
  }
}

// Create singleton instance
const jwtService = new JWTService();

export default jwtService;



