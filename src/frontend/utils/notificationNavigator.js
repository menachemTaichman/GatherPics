import { requestsAPI, getEventUrlById } from './apiService';

export async function openFromNotification(notification, { eventUrl, navigate, isManager = false }) {
  const type = notification.type || notification.notification_type || '';
  let data = parseData(notification.data);
  // Fallback: if parseData returns null but notification.data exists, use it directly
  if (data === null && notification.data !== null && notification.data !== undefined) {
    data = notification.data;
  }

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
    let feedbackId;
    if (typeof data === 'number') {
      feedbackId = data;
    } else if (typeof data === 'string') {
      feedbackId = parseInt(data, 10);
    } else if (data && typeof data === 'object') {
      feedbackId = data.feedback_id;
    }
    
    // Ensure feedbackId is a valid number
    feedbackId = Number(feedbackId);
    if (feedbackId && !isNaN(feedbackId) && feedbackId > 0) {
      try {
        // Use setTimeout to ensure event listener is ready, and make event bubble
        setTimeout(() => {
          const event = new CustomEvent('feedback:open-detail', { 
            detail: { feedbackId },
            bubbles: true,
            cancelable: true
          });
          window.dispatchEvent(event);
        }, 0);
      } catch (e) {
        console.error('Error dispatching feedback event:', e);
      }
    }
    return;
  }

  if (type === 'my_feedback') {
    let feedbackId;
    if (typeof data === 'number') {
      feedbackId = data;
    } else if (typeof data === 'string') {
      feedbackId = parseInt(data, 10);
    } else if (data && typeof data === 'object') {
      feedbackId = data.feedback_id;
    }
    
    // Ensure feedbackId is a valid number
    feedbackId = Number(feedbackId);
    if (feedbackId && !isNaN(feedbackId) && feedbackId > 0) {
      try {
        // Use setTimeout to ensure event listener is ready, and make event bubble
        setTimeout(() => {
          const event = new CustomEvent('my-feedback:open', { 
            detail: { feedbackId },
            bubbles: true,
            cancelable: true
          });
          window.dispatchEvent(event);
        }, 0);
      } catch (e) {
        console.error('Error dispatching my-feedback event:', e);
      }
    }
    return;
  }
}

function parseData(data) {
  if (!data && data !== 0) return null;
  if (typeof data === 'object') return data;
  if (typeof data === 'number') return data;
  try { return JSON.parse(data); } catch { return data; }
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


