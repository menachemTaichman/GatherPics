import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, User, AlertCircle } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

export default function LoginModal({ isOpen, onClose, onLogin, error }) {
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const labelInputRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Check if user is on a protected page (not homepage)
  const isOnProtectedPage = location.pathname !== '/';

  // Auto-focus label input when modal opens
  useEffect(() => {
    if (isOpen && labelInputRef.current) {
      setTimeout(() => {
        labelInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Detect autofill and update state
  useEffect(() => {
    if (!isOpen) return;

    const checkAutofill = () => {
      const labelInput = document.getElementById('label');
      const passwordInput = document.getElementById('password');
      
      if (labelInput?.value && !label) {
        setLabel(labelInput.value);
      }
      if (passwordInput?.value && !password) {
        setPassword(passwordInput.value);
      }
    };

    // Check immediately and after a delay (browsers autofill at different times)
    const timers = [
      setTimeout(checkAutofill, 100),
      setTimeout(checkAutofill, 300),
      setTimeout(checkAutofill, 500)
    ];

    // Also listen for input events (some browsers fire this on autofill)
    const handleInput = (e) => {
      if (e.target.id === 'label') setLabel(e.target.value);
      if (e.target.id === 'password') setPassword(e.target.value);
    };

    document.getElementById('label')?.addEventListener('input', handleInput);
    document.getElementById('password')?.addEventListener('input', handleInput);

    return () => {
      timers.forEach(timer => clearTimeout(timer));
      document.getElementById('label')?.removeEventListener('input', handleInput);
      document.getElementById('password')?.removeEventListener('input', handleInput);
    };
  }, [isOpen, label, password]);

  // Handle escape key - only allow closing if not on protected page
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen && !isOnProtectedPage) {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isOnProtectedPage]);

  const handleClose = () => {
    // If on a protected page, redirect to homepage instead of just closing
    if (isOnProtectedPage) {
      navigate('/');
    }
    
    setLabel('');
    setPassword('');
    setIsLoading(false);
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!label.trim()) {
      return;
    }

    setIsLoading(true);
    
    try {
      const result = await onLogin(label.trim(), password);
      
      if (result.success) {
        // Success - modal will close via auth context
        setLabel('');
        setPassword('');
      }
    } catch (err) {
      // Error is handled by auth context
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop with blur */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
            onClick={!isOnProtectedPage ? handleClose : undefined}
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    {isOnProtectedPage ? 'Authentication Required' : 'Welcome Back'}
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {isOnProtectedPage 
                      ? 'You must sign in to view this page' 
                      : 'Sign in to access the gallery'}
                  </p>
                </div>
                {!isOnProtectedPage && (
                  <button
                    onClick={handleClose}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                {/* Error Message */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700"
                  >
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <p className="text-sm">{error}</p>
                  </motion.div>
                )}

                {/* Profile Label Input */}
                <div>
                  <label htmlFor="label" className="block text-sm font-medium text-gray-700 mb-2">
                    Profile Name
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      ref={labelInputRef}
                      id="label"
                      type="text"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="Enter your profile name"
                      autoComplete="username"
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                      required
                      disabled={isLoading}
                    />
                  </div>
                </div>

                {/* Password Input */}
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                      disabled={isLoading}
                    />
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isLoading || !label.trim()}
                  className="w-full py-3 px-4 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    'Sign In'
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

