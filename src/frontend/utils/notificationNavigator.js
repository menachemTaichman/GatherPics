import { requestsAPI, getEventUrlById } from './apiService';

export async function openFromNotification(notification, { eventUrl, navigate, isManager = false }) {
  const type = notification.type || notification.notification_type || '';
  const data = parseData(notification.data);

  if (type === 'access_request' && data?.access_request_id) {
    const requestId = data.access_request_id;
    const targetEventId = data.event_id;
    const currentEventUrl = eventUrl || (window.location.pathname.split('/').filter(Boolean)[0] || null);

    if (isManager) {
      await navigateAndDispatchRequest({
        requestId,
        targetEventId,
        currentEventUrl,
        navigate,
        dispatchEvent: (detail) => {
          try {
            window.dispatchEvent(new CustomEvent('requests:open-detail', { detail }));
          } catch {}
        }
      });
      return;
    }

    await navigateAndDispatchRequest({
      requestId,
      targetEventId,
      currentEventUrl,
      navigate,
      dispatchEvent: (detail) => {
        try {
          window.dispatchEvent(new CustomEvent('my-requests:open', { detail }));
        } catch {}
      }
    });
    return;
  }

  if (type === 'my_access_request' && data?.access_request_id) {
    const requestId = data.access_request_id;
    const targetEventId = data.event_id;
    const currentEventUrl = eventUrl || (window.location.pathname.split('/').filter(Boolean)[0] || null);

    await navigateAndDispatchRequest({
      requestId,
      targetEventId,
      currentEventUrl,
      navigate,
      dispatchEvent: (detail) => {
        try {
          window.dispatchEvent(new CustomEvent('my-requests:open', { detail }));
        } catch {}
      }
    });
    return;
  }

  if (type === 'feedback') {
    const feedbackId = typeof data === 'number' ? data : (typeof data === 'string' ? parseInt(data, 10) : data?.feedback_id);
    if (feedbackId) {
      try {
        window.dispatchEvent(new CustomEvent('feedback:open-detail', { detail: { feedbackId } }));
      } catch (e) {
        console.error('Error dispatching feedback event:', e);
      }
    }
    return;
  }

  if (type === 'my_feedback') {
    const feedbackId = typeof data === 'number' ? data : (typeof data === 'string' ? parseInt(data, 10) : data?.feedback_id);
    if (feedbackId) {
      try {
        window.dispatchEvent(new CustomEvent('my-feedback:open', { detail: { feedbackId } }));
      } catch (e) {
        console.error('Error dispatching my-feedback event:', e);
      }
    }
    return;
  }
}

function parseData(data) {
  if (!data) return null;
  if (typeof data === 'object') return data;
  try { return JSON.parse(data); } catch { return null; }
}

async function navigateAndDispatchRequest({ requestId, targetEventId, currentEventUrl, navigate, dispatchEvent }) {
  if (!requestId) return;

  let targetEventUrl = currentEventUrl;
  if (targetEventId) {
    const resolved = await getEventUrlById(String(targetEventId));
    if (resolved) targetEventUrl = resolved;
  }

  const gotoEventFirst = targetEventUrl && targetEventUrl !== currentEventUrl;
  const trigger = () => dispatchEvent({ requestId, eventUrl: targetEventUrl });

  if (gotoEventFirst && navigate && typeof navigate === 'function') {
    navigate(`/${targetEventUrl}`);
    setTimeout(trigger, 150);
  } else {
    trigger();
  }
}


