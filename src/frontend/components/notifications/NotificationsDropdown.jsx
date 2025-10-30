import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, RefreshCw, Trash2, ChevronDown } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { notificationsAPI } from '../../utils/apiService';
import { useDataStore } from '../../utils/dataManager';
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
  const [unreadOnOpen, setUnreadOnOpen] = useState(new Set());
  // Subscribe to stable slices only to avoid unnecessary re-renders
  const entities = useDataStore((s) => s.entities);
  const setScope = useDataStore((s) => s.setScope);
  const removeScope = useDataStore((s) => s.removeScope);

  const notificationsMap = entities?.my_notifications || {};
  const notifications = useMemo(() => {
    return Object.values(notificationsMap).sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
  }, [notificationsMap]);

  // Guard to run loading logic only once per open instance
  const loadedOnceRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      loadedOnceRef.current = false;
      // Remove scope when closing dropdown
      try { removeScope && removeScope({ entity: 'all', id: 'my_notifications' }); } catch {}
      return;
    }
    if (loadedOnceRef.current) return;
    loadedOnceRef.current = true;
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        // Ensure notifications upserts are allowed by scopes (once per open)
        setScope({ entity: 'all', id: 'my_notifications' });
        await notificationsAPI.getMy();
        // Mark all as read when opening
        try { await notificationsAPI.markAllRead(); } catch {}
        const unreadNow = new Set(Object.values(useDataStore.getState().entities?.my_notifications || {})
          .filter(n => !n.read)
          .map(n => String(n.id)));
        setUnreadOnOpen(unreadNow);
        // Do not mark-all-read or refetch counts; counts now come from current_profile
      } catch (e) {
        // ignore
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [isOpen, eventUrl, setScope]);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      // Keep scope and reload notifications; counts handled elsewhere
      setScope({ entity: 'all', id: 'my_notifications' });
      await notificationsAPI.getMy();
      try { await notificationsAPI.markAllRead(); } catch {}
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
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
        <button
          onClick={handleRefresh}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600"
          title="Refresh"
        >
          <RefreshCw className={"w-4 h-4 " + (loading ? 'animate-spin' : '')} />
        </button>
      </div>
      {notifications.length === 0 ? (
        <div className="p-3 text-sm text-gray-500">No notifications</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {notifications.map((n) => {
            const wasUnread = unreadOnOpen.has(String(n.id));
            return (
              <li key={n.id} className={"flex items-start gap-2 p-3 " + (wasUnread ? 'bg-blue-50' : '')}>
                <button
                  className="flex-1 text-left"
                  onClick={() => {
                    openFromNotification(n, { eventUrl, navigate, isManager: !!permissions.isProfilesManager });
                    onClose && onClose();
                  }}
                >
                  <div className="text-sm text-gray-900 line-clamp-2">{n.message}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {formatDateTime(n.created_at)}
                  </div>
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


