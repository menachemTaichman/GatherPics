import { requestsAPI, getEventUrlById } from './apiService';

export async function openFromNotification(notification, { eventUrl, navigate, isManager = false }) {
  const type = notification.type || notification.notification_type || '';
  const data = parseData(notification.data);

  if ((type === 'access_request') && data?.access_request_id) {
    const targetEventId = data.event_id;
    const currentEventUrl = eventUrl || (window.location.pathname.split('/').filter(Boolean)[0] || null);
    let targetEventUrl = currentEventUrl;
    if (targetEventId) {
      const resolved = await getEventUrlById(String(targetEventId));
      if (resolved) targetEventUrl = resolved;
    }

    const gotoEventFirst = targetEventUrl && targetEventUrl !== currentEventUrl;
    const openActions = () => {
      if (isManager) {
        try {
          window.dispatchEvent(new CustomEvent('requests:open-detail', { detail: { requestId: data.access_request_id, eventUrl: targetEventUrl } }));
        } catch {}
      } else {
        try {
          window.dispatchEvent(new CustomEvent('my-requests:open', { detail: { requestId: data.access_request_id, eventUrl: targetEventUrl } }));
        } catch {}
      }
    };

    if (gotoEventFirst && navigate && typeof navigate === 'function') {
      navigate(`/${targetEventUrl}`);
      setTimeout(openActions, 150);
    } else {
      openActions();
    }
    return;
  }
}

function parseData(data) {
  if (!data) return null;
  if (typeof data === 'object') return data;
  try { return JSON.parse(data); } catch { return null; }
}


