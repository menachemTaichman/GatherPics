/**
 * Diagnostics Capture Utility
 * Captures console logs and network activity for feedback system
 */

/**
 * Sanitize sensitive data (emails and passwords) from text or objects
 * @param {string|object} data - The data to sanitize
 * @returns {string|object} Sanitized data
 */
function sanitizeSensitiveData(data) {
  if (!data) return data;
  
  // If it's a string, sanitize it directly
  if (typeof data === 'string') {
    // Pattern to match email addresses
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    
    // Pattern to match password fields in various formats
    // Pattern 1: JSON format with quotes: "password":"value" (most common in axios errors)
    // Pattern 2: Generic key-value: password:value or password="value"
    // Pattern 3: Space-separated: password value
    const passwordPatterns = [
      /(["']password["']\s*:\s*["'])([^"']+)(["'])/gi,  // JSON: "password":"value"
      /(["']?password["']?\s*[:=]\s*["']?)([^"'\s,}]+)(["']?)/gi,  // Generic: password:value or password="value"
      /(password\s+)([^\s,}]+)/gi,  // Space-separated: password value
    ];
    
    let sanitized = data;
    
    // Replace emails
    sanitized = sanitized.replace(emailPattern, '[REDACTED_EMAIL]');
    
    // Replace passwords
    passwordPatterns.forEach(pattern => {
      sanitized = sanitized.replace(pattern, (match, prefix, value, suffix) => {
        return prefix + '[REDACTED_PASSWORD]' + (suffix || '');
      });
    });
    
    return sanitized;
  }
  
  // If it's an object, recursively sanitize
  if (typeof data === 'object') {
    if (Array.isArray(data)) {
      return data.map(item => sanitizeSensitiveData(item));
    }
    
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      // Skip password fields entirely or redact their values
      if (key.toLowerCase().includes('password')) {
        sanitized[key] = '[REDACTED_PASSWORD]';
      } else if (key === 'data' && typeof value === 'string') {
        // Special handling for axios config.data which might be a JSON string
        try {
          const parsed = JSON.parse(value);
          const sanitizedParsed = sanitizeSensitiveData(parsed);
          sanitized[key] = JSON.stringify(sanitizedParsed);
        } catch (e) {
          // If not JSON, just sanitize as string
          sanitized[key] = sanitizeSensitiveData(value);
        }
      } else if (typeof value === 'string') {
        sanitized[key] = sanitizeSensitiveData(value);
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = sanitizeSensitiveData(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
  
  return data;
}

class DiagnosticsCapture {
  constructor() {
    this.consoleLogs = [];
    this.networkLogs = [];
    this.networkErrors = []; // Separate storage for network errors
    this.maxConsoleLogs = 100; // Keep last 100 console entries
    this.maxNetworkLogs = 50;  // Keep last 50 network requests
    this.maxNetworkErrors = 30; // Keep last 30 network errors
    this.isCapturing = false;
    this.originalConsole = {};
    this.originalFetch = null;
    this.originalXHR = null;
  }

  /**
   * Start capturing diagnostics
   */
  startCapture() {
    if (this.isCapturing) return;
    this.isCapturing = true;
    this.consoleLogs = [];
    this.networkLogs = [];
    this.networkErrors = [];
    
    this._interceptConsole();
    this._interceptNetwork();
    this._interceptXHR();
  }

  /**
   * Stop capturing diagnostics
   */
  stopCapture() {
    if (!this.isCapturing) return;
    this.isCapturing = false;
    
    this._restoreConsole();
    this._restoreNetwork();
    this._restoreXHR();
  }

  /**
   * Get captured diagnostics
   */
  getDiagnostics() {
    return {
      console_logs: this.consoleLogs.slice(-this.maxConsoleLogs),
      network_logs: this.networkLogs.slice(-this.maxNetworkLogs),
      network_errors: this.networkErrors.slice(-this.maxNetworkErrors),
      browser_info: this._getBrowserInfo()
    };
  }

  /**
   * Clear all captured data
   */
  clear() {
    this.consoleLogs = [];
    this.networkLogs = [];
    this.networkErrors = [];
  }

  /**
   * Intercept console methods
   */
  _interceptConsole() {
    const methods = ['log', 'info', 'warn', 'error', 'debug'];
    
    methods.forEach(method => {
      this.originalConsole[method] = console[method];
      console[method] = (...args) => {
        // Call original console method
        this.originalConsole[method](...args);
        
        // Capture the log
        if (this.isCapturing) {
          try {
            const message = args.map(arg => {
              try {
                // First sanitize the object if it's an object, then stringify, then sanitize the string as backup
                let sanitizedArg = sanitizeSensitiveData(arg);
                const serialized = typeof sanitizedArg === 'object' ? JSON.stringify(sanitizedArg, null, 2) : String(sanitizedArg);
                // Sanitize the stringified version as well (catches any passwords in JSON format)
                return sanitizeSensitiveData(serialized);
              } catch (e) {
                // If stringification fails, just sanitize the string representation
                return sanitizeSensitiveData(String(arg));
              }
            }).join(' ');
            
            this.consoleLogs.push({
              type: method,
              message,
              timestamp: new Date().toISOString()
            });
            
            // Keep only last N entries
            if (this.consoleLogs.length > this.maxConsoleLogs * 2) {
              this.consoleLogs = this.consoleLogs.slice(-this.maxConsoleLogs);
            }
          } catch (e) {
            // Silently fail if capturing fails
          }
        }
      };
    });
  }

  /**
   * Restore original console methods
   */
  _restoreConsole() {
    Object.keys(this.originalConsole).forEach(method => {
      console[method] = this.originalConsole[method];
    });
    this.originalConsole = {};
  }

  /**
   * Intercept network requests (fetch API)
   */
  _interceptNetwork() {
    this.originalFetch = window.fetch.bind(window);
    
    window.fetch = async (...args) => {
      const startTime = Date.now();
      let url = typeof args[0] === 'string' ? args[0] : args[0]?.url || 'unknown';
      const method = args[1]?.method || 'GET';
      
      // Sanitize URL in case it contains sensitive data
      url = sanitizeSensitiveData(url);
      
      try {
        const response = await this.originalFetch(...args);
        const duration = Date.now() - startTime;
        
        if (this.isCapturing) {
          const logEntry = {
            url,
            method,
            status: response.status,
            statusText: response.statusText,
            duration,
            timestamp: new Date().toISOString(),
            success: response.ok,
            type: 'fetch'
          };
          
          this.networkLogs.push(logEntry);
          
          // If it's an error response (4xx or 5xx), capture more details
          if (!response.ok) {
            const clonedResponse = response.clone();
            try {
              const contentType = response.headers.get('content-type');
              let responseBody = null;
              
              if (contentType && contentType.includes('application/json')) {
                responseBody = await clonedResponse.json();
              } else {
                responseBody = await clonedResponse.text();
              }
              
              // Sanitize response body before storing
              const sanitizedResponseBody = sanitizeSensitiveData(responseBody);
              
              this.networkErrors.push({
                ...logEntry,
                responseBody: sanitizedResponseBody,
                headers: Object.fromEntries(response.headers.entries())
              });
              
              // Keep only last N error entries
              if (this.networkErrors.length > this.maxNetworkErrors * 2) {
                this.networkErrors = this.networkErrors.slice(-this.maxNetworkErrors);
              }
            } catch (e) {
              // If we can't read the response body, just log without it
              this.networkErrors.push(logEntry);
            }
          }
          
          // Keep only last N entries
          if (this.networkLogs.length > this.maxNetworkLogs * 2) {
            this.networkLogs = this.networkLogs.slice(-this.maxNetworkLogs);
          }
        }
        
        return response;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        if (this.isCapturing) {
          const errorEntry = {
            url,
            method,
            status: 0,
            duration,
            timestamp: new Date().toISOString(),
            success: false,
            error: error.message,
            type: 'fetch'
          };
          
          this.networkLogs.push(errorEntry);
          this.networkErrors.push(errorEntry);
          
          // Keep only last N error entries
          if (this.networkErrors.length > this.maxNetworkErrors * 2) {
            this.networkErrors = this.networkErrors.slice(-this.maxNetworkErrors);
          }
        }
        
        throw error;
      }
    };
  }

  /**
   * Restore original fetch
   */
  _restoreNetwork() {
    if (this.originalFetch) {
      window.fetch = this.originalFetch;
      this.originalFetch = null;
    }
  }

  /**
   * Intercept XMLHttpRequest
   */
  _interceptXHR() {
    this.originalXHR = window.XMLHttpRequest;
    const self = this;
    
    window.XMLHttpRequest = function() {
      const xhr = new self.originalXHR();
      const originalOpen = xhr.open;
      const originalSend = xhr.send;
      
      let method = '';
      let url = '';
      let startTime = 0;
      
      // Intercept open to capture method and URL
      xhr.open = function(m, u, ...args) {
        method = m;
        url = sanitizeSensitiveData(u);  // Sanitize URL in case it contains sensitive data
        return originalOpen.apply(this, [m, u, ...args]);
      };
      
      // Intercept send to capture request/response
      xhr.send = function(...args) {
        startTime = Date.now();
        
        // Add load event listener
        xhr.addEventListener('load', function() {
          const duration = Date.now() - startTime;
          
          if (self.isCapturing) {
            const logEntry = {
              url,
              method,
              status: xhr.status,
              statusText: xhr.statusText,
              duration,
              timestamp: new Date().toISOString(),
              success: xhr.status >= 200 && xhr.status < 300,
              type: 'xhr'
            };
            
            self.networkLogs.push(logEntry);
            
            // If it's an error response (4xx or 5xx), capture more details
            if (xhr.status >= 400) {
              try {
                let responseBody = xhr.responseText;
                try {
                  // Try to parse as JSON
                  responseBody = JSON.parse(xhr.responseText);
                } catch (e) {
                  // Keep as text if not JSON
                }
                
                // Sanitize response body before storing
                const sanitizedResponseBody = sanitizeSensitiveData(responseBody);
                
                self.networkErrors.push({
                  ...logEntry,
                  responseBody: sanitizedResponseBody,
                  responseType: xhr.responseType || 'text'
                });
                
                // Keep only last N error entries
                if (self.networkErrors.length > self.maxNetworkErrors * 2) {
                  self.networkErrors = self.networkErrors.slice(-self.maxNetworkErrors);
                }
              } catch (e) {
                // If we can't read the response, just log without it
                self.networkErrors.push(logEntry);
              }
            }
            
            // Keep only last N entries
            if (self.networkLogs.length > self.maxNetworkLogs * 2) {
              self.networkLogs = self.networkLogs.slice(-self.maxNetworkLogs);
            }
          }
        });
        
        // Add error event listener
        xhr.addEventListener('error', function() {
          const duration = Date.now() - startTime;
          
          if (self.isCapturing) {
            const errorEntry = {
              url,
              method,
              status: 0,
              duration,
              timestamp: new Date().toISOString(),
              success: false,
              error: 'Network request failed',
              type: 'xhr'
            };
            
            self.networkLogs.push(errorEntry);
            self.networkErrors.push(errorEntry);
            
            // Keep only last N error entries
            if (self.networkErrors.length > self.maxNetworkErrors * 2) {
              self.networkErrors = self.networkErrors.slice(-self.maxNetworkErrors);
            }
          }
        });
        
        // Add timeout event listener
        xhr.addEventListener('timeout', function() {
          const duration = Date.now() - startTime;
          
          if (self.isCapturing) {
            const errorEntry = {
              url,
              method,
              status: 0,
              duration,
              timestamp: new Date().toISOString(),
              success: false,
              error: 'Request timeout',
              type: 'xhr'
            };
            
            self.networkLogs.push(errorEntry);
            self.networkErrors.push(errorEntry);
            
            // Keep only last N error entries
            if (self.networkErrors.length > self.maxNetworkErrors * 2) {
              self.networkErrors = self.networkErrors.slice(-self.maxNetworkErrors);
            }
          }
        });
        
        return originalSend.apply(this, args);
      };
      
      return xhr;
    };
  }

  /**
   * Restore original XMLHttpRequest
   */
  _restoreXHR() {
    if (this.originalXHR) {
      window.XMLHttpRequest = this.originalXHR;
      this.originalXHR = null;
    }
  }

  /**
   * Get browser information
   */
  _getBrowserInfo() {
    const nav = navigator;
    return {
      userAgent: nav.userAgent,
      language: nav.language,
      platform: nav.platform,
      cookieEnabled: nav.cookieEnabled,
      onLine: nav.onLine,
      connection: nav.connection ? {
        effectiveType: nav.connection.effectiveType,
        downlink: nav.connection.downlink,
        rtt: nav.connection.rtt,
        saveData: nav.connection.saveData
      } : null,
      screen: {
        width: screen.width,
        height: screen.height,
        colorDepth: screen.colorDepth
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      memory: performance?.memory ? {
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        usedJSHeapSize: performance.memory.usedJSHeapSize
      } : null
    };
  }
}

// Create singleton instance
const diagnosticsCapture = new DiagnosticsCapture();

export default diagnosticsCapture;

