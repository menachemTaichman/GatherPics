import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, RefreshCw, Trash2, ChevronDown, Check, CheckCheck } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { notificationsAPI } from '../../utils/apiService';
import { useDataStore, useMyNotificationsList } from '../../utils/dataManager';
import { useToast } from '../../contexts/ToastContext';
import { openFromNotification } from '../../utils/notificationNavigator';
import { usePermissions } from '../../hooks/usePermissions';

export default function NotificationsDropdown({ buttonRef, isOpen, onClose }) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const params = useParams();
  const eventUrl = params.eventUrl;
  const permissions = usePermissions();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const addScope = useDataStore((s) => s.addScope);
  const removeScope = useDataStore((s) => s.removeScope);

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
      showToast('Failed to mark all as read', 'error');
    }
  };

  const handleDeleteAll = async () => {
    try {
      await notificationsAPI.deleteAll();
      showToast('All notifications deleted', 'success');
    } catch (e) {
      showToast('Failed to delete all notifications', 'error');
    }
  };

  const handleToggleRead = async (id, currentReadState) => {
    try {
      const newReadState = currentReadState ? 0 : 1;
      await notificationsAPI.markRead(id, newReadState);
    } catch (e) {
      showToast('Failed to update notification', 'error');
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
      showToast('Failed to delete notification', 'error');
    }
  };

  const getDropdownPosition = () => {
    if (!buttonRef) return {};
    const rect = buttonRef.getBoundingClientRect();
    return {
      position: 'fixed',
      left: `${rect.right}px`,
      top: `${rect.bottom}px`,
      transform: 'translate(-100%, 0)',
      zIndex: 10000,
    };
  };

  const renderDropdownContent = () => (
    <div className="w-80 max-h-96 overflow-auto bg-white border border-gray-200 rounded-md shadow-lg">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <Bell className="w-4 h-4" />
          <span>Notifications</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleMarkAllRead}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600"
            title="Mark all as read"
            disabled={notifications.length === 0}
          >
            <CheckCheck className="w-4 h-4" />
          </button>
          <button
            onClick={handleDeleteAll}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600"
            title="Delete all"
            disabled={notifications.length === 0}
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleRefresh}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600"
            title="Refresh"
          >
            <RefreshCw className={"w-4 h-4 " + (refreshing ? 'animate-spin' : '')} />
          </button>
        </div>
      </div>
      {notifications.length === 0 ? (
        <div className="p-3 text-sm text-gray-500">No notifications</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {notifications.map((n) => {
            const isUnread = !n.read;
            return (
              <li key={n.id} className={"flex items-start gap-2 p-3 " + (isUnread ? 'bg-blue-50' : '')}>
                <button
                  className="flex-1 text-left"
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
                    {formatDateTime(n.created_at)}
                  </div>
                </button>
                <button
                  onClick={() => handleToggleRead(n.id, n.read)}
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500"
                  title={isUnread ? "Mark as read" : "Mark as unread"}
                >
                  {isUnread ? <Check className="w-4 h-4" /> : <CheckCheck className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => handleDelete(n.id)}
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return isOpen && buttonRef ? createPortal(
    <div style={getDropdownPosition()} onClick={(e) => e.stopPropagation()}>
      {renderDropdownContent()}
    </div>,
    document.body
  ) : null;
}

function formatDateTime(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
    });
  } catch {
    return dateString;
  }
}


