import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, Activity, Calendar, User, Wifi, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager, useModalStore } from '../../utils/modalManager';
import { useToast } from '../../contexts/ToastContext';
import { settingsAPI } from '../../utils/apiService';
import { formatErrorMessage } from '../../utils/errorHandler';
import { formatDateTimeLocale } from '../../utils/dateUtils';

export default function AuditLogDetailModal({ 
  isOpen, 
  onClose, 
  auditLogId,
  // Navigation props
  onNavigate = null,
  currentIndex = 0,
  totalLogs = 1,
  filteredLogs = []
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const { showToast } = useToast();
  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'audit-log-detail-modal';

  // Register modal
  useEffect(() => {
    if (isOpen) {
      registerModal({ id: modalId, type: 'popup', allowOutsideScroll: true });
      return () => unregisterModal(modalId);
    }
  }, [isOpen, registerModal, unregisterModal]);

  // Fetch settings to get audit log details when modal opens
  useEffect(() => {
    if (isOpen && auditLogId) {
      const fetchSettings = async () => {
        setLoading(true);
        try {
          const response = await settingsAPI.get();
          const auditLogsDict = response.settings?.audit_logs || {};
          const auditLog = auditLogsDict[auditLogId] || Object.values(auditLogsDict).find(log => log.audit_log_id === auditLogId);
          
          if (auditLog) {
            setSettings({ audit_logs: { [auditLogId]: auditLog } });
          }
        } catch (error) {
          console.error('Failed to load audit log:', error);
          showToast(formatErrorMessage('load audit log', error), 'error');
        } finally {
          setLoading(false);
        }
      };
      fetchSettings();
    }
  }, [isOpen, auditLogId, showToast]);

  // Get audit log from settings
  const auditLog = useMemo(() => {
    if (!settings?.audit_logs || !auditLogId) return null;
    const auditLogsDict = settings.audit_logs || {};
    return auditLogsDict[auditLogId] || Object.values(auditLogsDict).find(log => log.audit_log_id === auditLogId);
  }, [settings, auditLogId]);

  // Navigation handlers
  const handleNavigate = useCallback((direction) => {
    if (!onNavigate || totalLogs <= 1) return;
    
    if (direction === 'prev') {
      if (currentIndex === 0) {
        onNavigate('jump', totalLogs - 1);
      } else {
        onNavigate('prev');
      }
    } else if (direction === 'next') {
      if (currentIndex === totalLogs - 1) {
        onNavigate('jump', 0);
      } else {
        onNavigate('next');
      }
    }
  }, [onNavigate, currentIndex, totalLogs]);

  const { isTopModal } = useModalManager();

  // Check if this modal is the topmost modal
  const isTopmostModal = useCallback(() => {
    try {
      const { stack } = useModalStore.getState();
      if (stack.length === 0) return true;
      return isTopModal(modalId);
    } catch {
      return true;
    }
  }, [isTopModal, modalId]);

  // Custom keyboard handler
  const handleModalKeys = useCallback((e) => {
    const targetTagName = e.target.tagName?.toLowerCase();
    
    // ESC handling - only if this is the topmost modal
    if (e.key === 'Escape') {
      if (isTopmostModal() && !loading) {
        onClose();
        return true;
      }
      // If not topmost, don't handle it - let the topmost modal handle it
      return false;
    }
    
    // Arrow keys for navigation (except when in input fields)
    if (targetTagName !== 'input' && targetTagName !== 'textarea' && targetTagName !== 'select') {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleNavigate('prev');
        return true;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNavigate('next');
        return true;
      }
    }
    
    return false;
  }, [loading, onClose, handleNavigate, isTopmostModal]);

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId,
    modalType: 'popup',
    allowOutsideScroll: true,
    customKeyHandler: handleModalKeys
  });

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
        return { bg: 'bg-red-100', text: 'text-red-700', icon: 'text-red-600' };
      case 'warning':
        return { bg: 'bg-orange-100', text: 'text-orange-700', icon: 'text-orange-600' };
      case 'info':
        return { bg: 'bg-blue-100', text: 'text-blue-700', icon: 'text-blue-600' };
      default:
        return { bg: 'bg-gray-100', text: 'text-gray-700', icon: 'text-gray-600' };
    }
  };

  const formatAction = (action) => {
    if (!action) return '-';
    return action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const formatJSON = (obj) => {
    if (!obj || typeof obj !== 'object') return JSON.stringify(obj, null, 2);
    return JSON.stringify(obj, null, 2);
  };

  if (!isOpen || !auditLog) return null;

  const severityColors = getSeverityColor(auditLog.severity);

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 pointer-events-none">
      <motion.div
        ref={modalRef}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${severityColors.bg}`}>
              <Activity className={`w-5 h-5 ${severityColors.icon}`} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900 flex items-center space-x-2">
                <span>Audit Log #{auditLog.audit_log_id}</span>
                <span className={`px-2 py-1 text-xs rounded-full ${severityColors.bg} ${severityColors.text}`}>
                  {auditLog.severity?.charAt(0).toUpperCase() + auditLog.severity?.slice(1) || '-'}
                </span>
              </h2>
              <p className="text-sm text-gray-500">
                {formatDateTimeLocale(auditLog.timestamp)}
                {totalLogs > 1 && (
                  <span className="ml-2">• {currentIndex + 1} of {totalLogs}</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {/* Navigation buttons */}
            {totalLogs > 1 && onNavigate && (
              <>
                <button
                  onClick={() => handleNavigate('prev')}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                  title="Previous log (Left arrow)"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => handleNavigate('next')}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                  title="Next log (Right arrow)"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Action */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Action</h3>
            <p className="text-lg font-medium text-gray-900">{formatAction(auditLog.action)}</p>
          </div>

          {/* Actor Information */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Actor Information</h3>
            <div className="space-y-2">
              {auditLog.actor_profile_label && (
                <div className="flex items-center space-x-2 text-sm">
                  <User className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-600">Profile:</span>
                  <span className="text-gray-900 font-medium">{auditLog.actor_profile_label}</span>
                </div>
              )}
              {auditLog.actor_profile_id && (
                <div className="flex items-center space-x-2 text-sm">
                  <User className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-600">Profile ID:</span>
                  <span className="text-gray-900 font-mono text-xs">{auditLog.actor_profile_id}</span>
                </div>
              )}
              {auditLog.ip_address && (
                <div className="flex items-center space-x-2 text-sm">
                  <Wifi className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-600">IP Address:</span>
                  <span className="text-gray-900 font-mono">{auditLog.ip_address}</span>
                </div>
              )}
            </div>
          </div>

          {/* Details */}
          {auditLog.details && Object.keys(auditLog.details).length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="w-full flex items-center justify-between text-sm font-semibold text-gray-900 hover:text-primary-600 transition-colors"
              >
                <span>Details (JSON)</span>
                {showDetails ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              
              {showDetails && (
                <pre className="mt-4 p-3 bg-white rounded text-xs font-mono overflow-x-auto max-h-96 overflow-y-auto">
                  {formatJSON(auditLog.details)}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors font-medium"
            disabled={loading}
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}

