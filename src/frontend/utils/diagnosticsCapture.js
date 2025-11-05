/**
 * Diagnostics Capture Utility
 * Captures console logs and network activity for feedback system
 */

class DiagnosticsCapture {
  constructor() {
    this.consoleLogs = [];
    this.networkLogs = [];
    this.maxConsoleLogs = 100; // Keep last 100 console entries
    this.maxNetworkLogs = 50;  // Keep last 50 network requests
    this.isCapturing = false;
    this.originalConsole = {};
    this.originalFetch = null;
  }

  /**
   * Start capturing diagnostics
   */
  startCapture() {
    if (this.isCapturing) return;
    this.isCapturing = true;
    this.consoleLogs = [];
    this.networkLogs = [];
    
    this._interceptConsole();
    this._interceptNetwork();
  }

  /**
   * Stop capturing diagnostics
   */
  stopCapture() {
    if (!this.isCapturing) return;
    this.isCapturing = false;
    
    this._restoreConsole();
    this._restoreNetwork();
  }

  /**
   * Get captured diagnostics
   */
  getDiagnostics() {
    return {
      console_logs: this.consoleLogs.slice(-this.maxConsoleLogs),
      network_logs: this.networkLogs.slice(-this.maxNetworkLogs),
      browser_info: this._getBrowserInfo()
    };
  }

  /**
   * Clear all captured data
   */
  clear() {
    this.consoleLogs = [];
    this.networkLogs = [];
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
          this.networkLogs.push({
            url,
            method,
            status: response.status,
            duration,
            timestamp: new Date().toISOString(),
            success: response.ok
          });
          
          // Keep only last N entries
          if (this.networkLogs.length > this.maxNetworkLogs * 2) {
            this.networkLogs = this.networkLogs.slice(-this.maxNetworkLogs);
          }
        }
        
        return response;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        if (this.isCapturing) {
          this.networkLogs.push({
            url,
            method,
            status: 0,
            duration,
            timestamp: new Date().toISOString(),
            success: false,
            error: error.message
          });
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

