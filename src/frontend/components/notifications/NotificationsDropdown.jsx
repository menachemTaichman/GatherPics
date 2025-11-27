import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, RefreshCw, Trash2, ChevronDown, Check, CheckCheck } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { notificationsAPI } from '../../utils/apiService';
import { useDataStore, useMyNotificationsList } from '../../utils/dataManager';
import { useToast } from '../../contexts/ToastContext';
import { openFromNotification } from '../../utils/notificationNavigator';
import { usePermissions } from '../../hooks/usePermissions';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { formatDateTimeLocale } from '../../utils/dateUtils';

export default function NotificationsDropdown({ buttonRef, isOpen, onClose }) {
  const { showToast } = useToast();
  const { t, i18n } = useTranslation();
  const [isRTL, setIsRTL] = useState(() => document.documentElement.dir === 'rtl');
  const navigate = useNavigate();
  
  // Update RTL state when language changes
  useEffect(() => {
    const updateDirection = () => {
      setIsRTL(document.documentElement.dir === 'rtl');
    };
    updateDirection();
    
    // Listen to language changes
    i18n.on('languageChanged', updateDirection);
    
    // Also watch for dir attribute changes
    const observer = new MutationObserver(updateDirection);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['dir']
    });
    
    return () => {
      i18n.off('languageChanged', updateDirection);
      observer.disconnect();
    };
  }, [i18n]);
  const params = useParams();
  const eventUrl = params.eventUrl;
  const permissions = usePermissions();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const addScope = useDataStore((s) => s.addScope);
  const removeScope = useDataStore((s) => s.removeScope);

  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'notifications-dropdown';

  // Register modal when opened, unregister when closed
  useEffect(() => {
    if (isOpen) {
      registerModal({ 
        id: modalId, 
        type: 'popup',
        allowOutsideScroll: true,
        scopes: []
      });
      
      return () => {
        unregisterModal(modalId);
      };
    }
  }, [isOpen, registerModal, unregisterModal, modalId]);

  const { modalRef } = useModalFocus(isOpen, onClose || (() => {}), {
    modalId: modalId,
    modalType: 'popup',
    allowOutsideScroll: true
  });

  const notificationsList = useMyNotificationsList();
  const notifications = useMemo(() => {
    return notificationsList.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
  }, [notificationsList]);

  const scopeConfigRef = useRef({ entity: 'all', id: 'my_notifications', eventId: 'general' });
  // Guard to run loading logic only once per open instance
  const loadedOnceRef = useRef(false);
  useEffect(() => {
    const scopeConfig = scopeConfigRef.current;
    if (!isOpen) {
      loadedOnceRef.current = false;
      return;
    }
    try { addScope && addScope(scopeConfig); } catch {}
    loadedOnceRef.current = false;
    return () => {
      loadedOnceRef.current = false;
      try { removeScope && removeScope(scopeConfig); } catch {}
    };
  }, [isOpen, addScope, removeScope]);

  useEffect(() => {
    if (!isOpen || loadedOnceRef.current) return;
    loadedOnceRef.current = true;
    const scopeConfig = scopeConfigRef.current;
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        await notificationsAPI.getMy();
      } catch (e) {
        // ignore
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [isOpen, eventUrl]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await notificationsAPI.getMy();
    } catch (e) {
      // ignore
    } finally {
      setRefreshing(false);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsAPI.markAllRead();
    } catch (e) {
      showToast(t('notifications.failedToMarkAllAsRead'), 'error');
    }
  };

  const handleDeleteAll = async () => {
    try {
      await notificationsAPI.deleteAll();
      showToast(t('notifications.allNotificationsDeleted'), 'success');
    } catch (e) {
      showToast(t('notifications.failedToDeleteAll'), 'error');
    }
  };

  const handleToggleRead = async (id, currentReadState) => {
    try {
      const newReadState = currentReadState ? 0 : 1;
      await notificationsAPI.markRead(id, newReadState);
    } catch (e) {
      showToast(t('notifications.failedToUpdate'), 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      const res = await notificationsAPI.delete(id);
      // If backend didn't return proper REMOVE ids list, apply client-side store change
      // Changes (REMOVE) are normalized by apiService interceptor; no manual store mutation needed
      try { void res; } catch {}
      // No counts refresh; rely on profile endpoint elsewhere
    } catch (e) {
      showToast(t('notifications.failedToDelete'), 'error');
    }
  };

  const getDropdownPosition = () => {
    if (!buttonRef) return {};
    const rect = buttonRef.getBoundingClientRect();
    const dropdownWidth = 320; // w-80 = 320px
    return {
      position: 'fixed',
      ...(isRTL 
        ? { right: `${window.innerWidth - rect.right}px` }
        : { left: `${rect.left}px` }
      ),
      top: `${rect.bottom}px`,
      zIndex: 10000,
    };
  };

  const renderDropdownContent = () => (
    <div className="w-80 max-h-96 overflow-auto bg-white border border-gray-200 rounded-md shadow-lg">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <div className={`flex items-center gap-2 text-sm text-gray-700 ${isRTL ? 'flex-row-reverse' : ''}`}>
          <Bell className="w-4 h-4" />
          <span>{t('notifications.notifications')}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleMarkAllRead}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600"
            title={t('notifications.markAllAsRead')}
            disabled={notifications.length === 0}
          >
            <CheckCheck className="w-4 h-4" />
          </button>
          <button
            onClick={handleDeleteAll}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600"
            title={t('notifications.deleteAll')}
            disabled={notifications.length === 0}
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleRefresh}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600"
            title={t('notifications.refresh')}
          >
            <RefreshCw className={"w-4 h-4 " + (refreshing ? 'animate-spin' : '')} />
          </button>
        </div>
      </div>
      {notifications.length === 0 ? (
        <div className={`p-3 text-sm text-gray-500 ${isRTL ? 'text-right' : 'text-left'}`}>{t('notifications.noNotifications')}</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {notifications.map((n) => {
            const isUnread = !n.read;
            return (
              <li key={n.id} className={`flex items-start gap-2 p-3 ${isUnread ? 'bg-blue-50' : ''}`}>
                <button
                  className={`flex-1 ${isRTL ? 'text-right' : 'text-left'}`}
                  onClick={async () => {
                    openFromNotification(n, { eventUrl, navigate, isManager: !!permissions.isProfilesManager });
                    // Mark as read when notification is clicked
                    if (!n.read) {
                      try {
                        await notificationsAPI.markRead(n.id, 1);
                      } catch (e) {
                        // Silently fail - not critical
                      }
                    }
                    onClose && onClose();
                  }}
                >
                  <div className="text-sm text-gray-900 line-clamp-2">{n.message}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {formatDateTimeLocale(n.created_at)}
                  </div>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggleRead(n.id, n.read)}
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500"
                    title={isUnread ? t('notifications.markAsRead') : t('notifications.markAsUnread')}
                  >
                    {isUnread ? <Check className="w-4 h-4" /> : <CheckCheck className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDelete(n.id)}
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500"
                    title={t('notifications.delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return isOpen && buttonRef ? createPortal(
    <div ref={modalRef} style={getDropdownPosition()} onClick={(e) => e.stopPropagation()}>
      {renderDropdownContent()}
    </div>,
    document.body
  ) : null;
}

