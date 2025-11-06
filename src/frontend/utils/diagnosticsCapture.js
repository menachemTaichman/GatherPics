/**
 * Diagnostics Capture Utility
 * Captures console logs and network activity for feedback system
 */

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
            this.consoleLogs.push({
              type: method,
              message: args.map(arg => {
                try {
                  return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
                } catch (e) {
                  return String(arg);
                }
              }).join(' '),
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
    this.originalFetch = window.fetch;
    
    window.fetch = async (...args) => {
      const startTime = Date.now();
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || 'unknown';
      const method = args[1]?.method || 'GET';
      
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
              
              this.networkErrors.push({
                ...logEntry,
                responseBody,
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
        url = u;
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
                
                self.networkErrors.push({
                  ...logEntry,
                  responseBody,
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

