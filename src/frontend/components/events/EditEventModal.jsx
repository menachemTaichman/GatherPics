import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Save, AlertCircle, Image as ImageIcon, Users, Layers, Calendar, Settings, Minus } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { eventsAPI, API_BASE } from '../../utils/apiService';
import { formatErrorMessage } from '../../utils/errorHandler';
import { useEventGeneralById } from '../../utils/dataManager';
import { ImageComponent } from '../../hooks/useImage.jsx';
import { useEventId, useApplyScopes } from '../../utils/storeUtils';
import { useModalManager } from '../../utils/modalManager';
import { useModalFocus } from '../../hooks/useModalFocus';

const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})/;

function normalizeDateForInput(value) {
  if (!value) return '';
  const isoMatch = String(value).match(ISO_DATE_REGEX);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createEmptyEventDraft() {
  return {
    name: '',
    url: '',
    date: '',
    is_public: 0,
    images_count_limit: null,
    image_size_limit_bytes: null,
  };
}

export default function EditEventModal({
  eventUrl,
  isOpen,
  onClose,
  mode = 'edit',
  onSuccess,
  onToast,
}) {
  const isCreateMode = mode === 'create';
  const [isClient, setIsClient] = useState(false);
  const [eventDraft, setEventDraft] = useState(null);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventSaving, setEventSaving] = useState(false);
  const [eventError, setEventError] = useState('');
  const [nameConflict, setNameConflict] = useState(false);
  const [urlConflict, setUrlConflict] = useState(false);
  const [checkingName, setCheckingName] = useState(false);
  const [checkingUrl, setCheckingUrl] = useState(false);
  const [removingRepresentative, setRemovingRepresentative] = useState(false);
  const [coverCacheBuster, setCoverCacheBuster] = useState(() => Date.now());
  const eventId = useEventId(isCreateMode ? null : eventUrl);
  const baseEvent = useEventGeneralById(eventId);
  const { showToast } = useToast();
  const emitToast = useCallback(
    (message, type) => {
      const handler = onToast ?? showToast;
      handler?.(message, type);
    },
    [onToast, showToast]
  );
  const { registerModal, unregisterModal } = useModalManager();
  const modalIdRef = useRef(`event-settings-${isCreateMode ? 'create' : eventId || 'unknown'}`);
  const nameCheckTimeout = useRef();
  const urlCheckTimeout = useRef();
  const enterSubmitRef = useRef(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const scopes = useMemo(() => {
    const scoped = [];
    if (isOpen) {
      scoped.push({ entity: 'all', id: 'events', eventId: 'general' });
    }
    if (!isCreateMode && isOpen && eventId) {
      scoped.push({ entity: 'event', id: String(eventId), eventId: 'general' });
    }
    return scoped;
  }, [isCreateMode, isOpen, eventId]);

  useApplyScopes(scopes);

  useEffect(() => {
    if (!isOpen) return undefined;
    registerModal({
      id: modalIdRef.current,
      type: 'popup',
      allowOutsideScroll: true,
    });
    return () => unregisterModal(modalIdRef.current);
  }, [isOpen, registerModal, unregisterModal]);

  useEffect(() => {
    setCoverCacheBuster(Date.now());
  }, [baseEvent?.representative_image]);

  const representativeThumbUrl = useMemo(() => {
    if (!eventId || !baseEvent?.representative_image) return null;
    const imageKey = String(baseEvent.representative_image);
    const cacheKey = `${imageKey}-${coverCacheBuster}`;
    return `${API_BASE}/api/events/${eventId}/representative/thumb?v=${encodeURIComponent(cacheKey)}`;
  }, [eventId, baseEvent?.representative_image, coverCacheBuster]);

  const buildEventDraft = useCallback((evt) => {
    if (!evt) return null;
    return {
      name: evt.name || '',
      url: evt.url || '',
      date: normalizeDateForInput(evt.date),
      is_public: evt.is_public ?? 0,
      images_count_limit:
        evt.images_count_limit !== null && evt.images_count_limit !== undefined
          ? Number(evt.images_count_limit)
          : null,
      image_size_limit_bytes:
        evt.image_size_limit_bytes !== null && evt.image_size_limit_bytes !== undefined
          ? Number(evt.image_size_limit_bytes)
          : null,
    };
  }, []);

  const handleResetEventDraft = useCallback(() => {
    if (nameCheckTimeout.current) clearTimeout(nameCheckTimeout.current);
    if (urlCheckTimeout.current) clearTimeout(urlCheckTimeout.current);
    if (isCreateMode) {
      setEventDraft(createEmptyEventDraft());
    } else if (baseEvent) {
      setEventDraft(buildEventDraft(baseEvent));
    } else {
      setEventDraft(null);
    }
    setEventError('');
    setNameConflict(false);
    setUrlConflict(false);
  }, [baseEvent, buildEventDraft, isCreateMode]);

  const handleRemoveRepresentative = useCallback(async () => {
    if (isCreateMode || !eventUrl || !baseEvent?.representative_image || removingRepresentative) {
      return;
    }
    setRemovingRepresentative(true);
    try {
      await eventsAPI.update(eventUrl, { representative_image: null });
      setEventError('');
      emitToast('Event cover removed', 'success');
      setCoverCacheBuster(Date.now());
    } catch (error) {
      console.error('Failed to remove event representative image:', error);
      const message = formatErrorMessage('remove event cover', error);
      setEventError(message);
      emitToast(message, 'error');
    } finally {
      setRemovingRepresentative(false);
    }
  }, [baseEvent?.representative_image, emitToast, eventId, eventUrl, isCreateMode, removingRepresentative]);

  useEffect(() => {
    if (!isOpen) {
      handleResetEventDraft();
    } else if (isCreateMode) {
      handleResetEventDraft();
    }
  }, [isOpen, isCreateMode, handleResetEventDraft]);

  const fetchEventDetails = useCallback(async () => {
    if (!eventUrl || !isOpen || isCreateMode) return;
    setEventLoading(true);
    setEventError('');
    try {
      await eventsAPI.getById(eventUrl);
    } catch (error) {
      console.error('Failed to load event details:', error);
      setEventError(formatErrorMessage('load event details', error));
      setEventDraft(null);
      setNameConflict(false);
      setUrlConflict(false);
    } finally {
      setEventLoading(false);
    }
  }, [eventUrl, isOpen, isCreateMode]);

  useEffect(() => {
    if (!isOpen || !eventUrl || isCreateMode) return;
    fetchEventDetails();
  }, [isOpen, eventUrl, isCreateMode, fetchEventDetails]);

  useEffect(() => {
    if (isCreateMode) {
      return;
    }
    if (baseEvent) {
      setEventError('');
      setEventDraft(buildEventDraft(baseEvent));
      setNameConflict(false);
      setUrlConflict(false);
      setCheckingName(false);
      setCheckingUrl(false);
    } else {
      setEventDraft(null);
      setCheckingName(false);
      setCheckingUrl(false);
    }
  }, [isCreateMode, baseEvent, buildEventDraft]);

  useEffect(() => {
    return () => {
      if (nameCheckTimeout.current) clearTimeout(nameCheckTimeout.current);
      if (urlCheckTimeout.current) clearTimeout(urlCheckTimeout.current);
    };
  }, []);

  const hasEventChanges = useMemo(() => {
    if (!eventDraft) return false;
    const draftName = (eventDraft.name || '').trim();
    const draftUrl = (eventDraft.url || '').trim();
    if (isCreateMode) {
      return Boolean(draftName) && Boolean(draftUrl);
    }
    if (!baseEvent) return false;
    const originalName = (baseEvent.name || '').trim();
    const originalUrl = (baseEvent.url || '').trim();
    const draftDate = normalizeDateForInput(eventDraft.date);
    const originalDate = normalizeDateForInput(baseEvent.date);
    const draftPublic = Number(eventDraft.is_public ?? 0);
    const originalPublic = Number(baseEvent.is_public ?? 0);
    const draftImagesLimit = eventDraft.images_count_limit ?? null;
    const originalImagesLimit = baseEvent.images_count_limit ?? null;
    const draftSizeLimit = eventDraft.image_size_limit_bytes ?? null;
    const originalSizeLimit = baseEvent.image_size_limit_bytes ?? null;
    return (
      draftName !== originalName ||
      draftUrl !== originalUrl ||
      draftDate !== originalDate ||
      draftPublic !== originalPublic ||
      draftImagesLimit !== originalImagesLimit ||
      draftSizeLimit !== originalSizeLimit
    );
  }, [eventDraft, baseEvent, isCreateMode]);

  const checkEventNameConflict = useCallback(
    async (value) => {
      const trimmed = (value || '').trim();
      if (!trimmed) {
        setNameConflict(false);
        return;
      }
      const original = (baseEvent?.name || '').trim();
      if (!isCreateMode && trimmed === original) {
        setNameConflict(false);
        return;
      }
      const excludeId = baseEvent?.event_id || eventId || null;
      setCheckingName(true);
      try {
        const result = await eventsAPI.checkName(trimmed, excludeId);
        setNameConflict(Boolean(result?.conflict));
      } catch (error) {
        console.error('Failed to check event name:', error);
      } finally {
        setCheckingName(false);
      }
    },
    [baseEvent?.name, baseEvent?.event_id, eventId, isCreateMode]
  );

  const checkEventUrlConflict = useCallback(
    async (value) => {
      const trimmed = (value || '').trim();
      if (!trimmed) {
        setUrlConflict(false);
        return;
      }
      const original = (baseEvent?.url || '').trim();
      if (!isCreateMode && trimmed === original) {
        setUrlConflict(false);
        return;
      }
      const excludeId = baseEvent?.event_id || eventId || null;
      setCheckingUrl(true);
      try {
        const result = await eventsAPI.checkUrl(trimmed, excludeId);
        setUrlConflict(Boolean(result?.conflict));
      } catch (error) {
        console.error('Failed to check event URL:', error);
      } finally {
        setCheckingUrl(false);
      }
    },
    [baseEvent?.url, baseEvent?.event_id, eventId, isCreateMode]
  );

  const handleEventFieldChange = useCallback(
    (field, value) => {
      setEventDraft((prev) => {
        if (!prev) return prev;
        const nextValue = field === 'date' ? normalizeDateForInput(value) : value;
        return { ...prev, [field]: nextValue };
      });
      if (field === 'name') {
        const trimmed = (value || '').trim();
        const original = (baseEvent?.name || '').trim();
        if (!trimmed || trimmed === original) {
          setNameConflict(false);
        }
        if (nameCheckTimeout.current) clearTimeout(nameCheckTimeout.current);
        nameCheckTimeout.current = setTimeout(() => {
          checkEventNameConflict(value);
        }, 300);
      }
      if (field === 'url') {
        const trimmed = (value || '').trim();
        const original = (baseEvent?.url || '').trim();
        if (!trimmed || trimmed === original) {
          setUrlConflict(false);
        }
        if (urlCheckTimeout.current) clearTimeout(urlCheckTimeout.current);
        urlCheckTimeout.current = setTimeout(() => {
          checkEventUrlConflict(value);
        }, 300);
      }
    },
    [baseEvent?.name, baseEvent?.url, checkEventNameConflict, checkEventUrlConflict]
  );

  const handleEventToggle = useCallback(
    (field, checked) => {
      handleEventFieldChange(field, checked ? 1 : 0);
    },
    [handleEventFieldChange]
  );

  const handleEventLimitChange = useCallback((field, value) => {
    setEventDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [field]: value === '' || value === null ? null : Number(value),
      };
    });
  }, []);

  const handleEventSizeLimitMbChange = useCallback((value) => {
    setEventDraft((prev) => {
      if (!prev) return prev;
      if (value === '' || value === null) {
        return { ...prev, image_size_limit_bytes: null };
      }
      const numeric = Number(value);
      if (Number.isNaN(numeric) || numeric < 0) {
        return prev;
      }
      return { ...prev, image_size_limit_bytes: Math.round(numeric * 1024 * 1024) };
    });
  }, []);

  const handleEventSave = useCallback(async (source = 'ui') => {
    if (!eventDraft) return;
    const trimmedName = (eventDraft.name || '').trim();
    const trimmedUrl = (eventDraft.url || '').trim();
    if (!trimmedName) {
      setEventError('Event name cannot be empty');
      return;
    }
    if (!trimmedUrl) {
      setEventError('Event URL cannot be empty');
      return;
    }
    if (nameConflict || urlConflict) {
      setEventError('Resolve conflicts before saving');
      return;
    }
    if (!isCreateMode && !eventUrl) {
      setEventError('Event URL is missing');
      return;
    }
    setEventSaving(true);
    setEventError('');
    const previousUrl = baseEvent?.url;
    const payload = {
      name: trimmedName,
      url: trimmedUrl,
      date: eventDraft.date || null,
      is_public: eventDraft.is_public,
      images_count_limit: eventDraft.images_count_limit,
      image_size_limit_bytes: eventDraft.image_size_limit_bytes,
    };
    try {
      let response;
      if (isCreateMode) {
        response = await eventsAPI.create(payload);
        emitToast('Event created', 'success');
      } else {
        response = await eventsAPI.update(eventUrl, payload);
        const urlChanged = Boolean(previousUrl && trimmedUrl !== previousUrl);
        if (urlChanged) {
          emitToast('Event URL updated. Update your bookmarks to the new address.', 'info');
        }
        emitToast('Event settings updated', 'success');
      }
      const urlChanged = Boolean(previousUrl && trimmedUrl !== previousUrl);
      onSuccess?.({
        mode: isCreateMode ? 'create' : 'edit',
        payload,
        response,
        previousUrl: previousUrl ?? null,
        nextUrl: trimmedUrl,
        urlChanged,
      });
      onClose?.();
    } catch (error) {
      console.error('Failed to save event:', error);
      const actionLabel = isCreateMode ? 'create event' : 'update event';
      const message = formatErrorMessage(actionLabel, error);
      setEventError(message);
      emitToast(message, 'error');
    } finally {
      setEventSaving(false);
    }
  }, [
    eventDraft,
    eventUrl,
    nameConflict,
    urlConflict,
    isCreateMode,
    baseEvent?.url,
    emitToast,
    onClose,
    onSuccess,
  ]);

  const canSaveEvent = useMemo(
    () => hasEventChanges && !nameConflict && !urlConflict && !eventSaving,
    [hasEventChanges, nameConflict, urlConflict, eventSaving]
  );

  const handleModalKeys = useCallback(
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      if (e.key !== 'Enter' || e.shiftKey) return false;

      const tagName = e.target.tagName?.toLowerCase();
      const inputType = e.target.type?.toLowerCase?.();
      const isInteractiveInput =
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select';

      if (!isInteractiveInput) {
        return false;
      }

      if (tagName === 'input' && (inputType === 'checkbox' || inputType === 'radio')) {
        return false;
      }

      if (!canSaveEvent) {
        e.preventDefault();
        enterSubmitRef.current = false;
        return true;
      }

      enterSubmitRef.current = true;
      return false;
    },
    [canSaveEvent]
  );

  const handleFormSubmit = useCallback(
    (e) => {
      e.preventDefault();
      if (eventSaving) {
        enterSubmitRef.current = false;
        return;
      }
      if (!canSaveEvent) {
        enterSubmitRef.current = false;
        return;
      }
      const submitter = e.nativeEvent?.submitter;
      const source = enterSubmitRef.current
        ? 'enter-key'
        : submitter?.dataset?.submitSource || 'form-submit';
      enterSubmitRef.current = false;
      handleEventSave(source);
    },
    [canSaveEvent, eventSaving, handleEventSave]
  );

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId: modalIdRef.current,
    modalType: 'popup',
    allowOutsideScroll: true,
    customKeyHandler: handleModalKeys,
  });

  const modalTitle = isCreateMode ? 'Create Event' : 'Edit Event';
  const modalSubtitle = isCreateMode ? 'Set up a new event' : 'Update general event preferences';
  const primaryButtonLabel = isCreateMode ? 'Create Event' : 'Save Changes';
  const savingLabel = isCreateMode ? 'Creating...' : 'Saving...';

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={onClose}
        >
          <motion.form
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-2xl"
            onSubmit={handleFormSubmit}
            noValidate
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div className="flex items-center space-x-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
                  <Settings className="h-5 w-5" />
                </div>
                <div className="space-y-0.5">
                  <h2 className="text-xl font-semibold text-gray-900">{modalTitle}</h2>
                  <p className="text-sm text-gray-500">{modalSubtitle}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-0">
              {eventLoading ? (
                <div className="flex items-center justify-center py-8 text-sm text-gray-500">
                  <div className="mr-3 h-4 w-4 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                  Loading event settings...
                </div>
              ) : (
                <div className="space-y-6 pb-8">
                  {eventError && (
                    <div className="flex items-center space-x-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      <span>{eventError}</span>
                    </div>
                  )}
                  {eventDraft ? (
                    <>
                      <div className="space-y-6">
                        <div className="rounded-lg bg-gray-50 p-4">
                          <h3 className="text-sm font-semibold text-gray-700">Basics</h3>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs font-medium text-gray-600">
                                Event Name
                                <span className="ml-1 text-red-500">*</span>
                              </label>
                              <input
                                type="text"
                                value={eventDraft.name}
                                onChange={(e) => handleEventFieldChange('name', e.target.value)}
                                required
                                className={`w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:border-transparent ${
                                  nameConflict
                                    ? 'border-red-500 focus:ring-red-500'
                                    : 'border-gray-300 focus:ring-blue-500'
                                }`}
                                placeholder="Enter event name"
                              />
                              {checkingName ? (
                                <p className="mt-1 text-xs text-gray-500">Checking availability…</p>
                              ) : nameConflict ? (
                                <p className="mt-1 text-xs text-red-600">
                                  Name already in use by another event.
                                </p>
                              ) : null}
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-gray-600">
                                Event URL
                                <span className="ml-1 text-red-500">*</span>
                              </label>
                              <input
                                type="text"
                                value={eventDraft.url}
                                onChange={(e) => handleEventFieldChange('url', e.target.value)}
                                required
                                className={`w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:border-transparent ${
                                  urlConflict
                                    ? 'border-red-500 focus:ring-red-500'
                                    : 'border-gray-300 focus:ring-blue-500'
                                }`}
                                placeholder="friendly-event-slug"
                              />
                              {checkingUrl ? (
                                <p className="mt-1 text-xs text-gray-500">Checking availability…</p>
                              ) : urlConflict ? (
                                <p className="mt-1 text-xs text-red-600">
                                  URL already in use by another event.
                                </p>
                              ) : null}
                              {baseEvent?.url && eventDraft.url !== baseEvent.url && (
                                <p className="mt-1 text-xs text-amber-600">
                                  The event URL will change after saving.
                                </p>
                              )}
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-gray-600">
                                Event Date
                              </label>
                              <input
                                type="date"
                                value={eventDraft.date || ''}
                                onChange={(e) => handleEventFieldChange('date', e.target.value)}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                          <div className="mt-4 flex items-center justify-between rounded-lg bg-white px-4 py-3">
                            <div>
                              <p className="font-medium text-gray-900">Public Event</p>
                              <p className="text-sm text-gray-500">
                                Show it in the public events list
                              </p>
                            </div>
                            <label className="relative inline-flex cursor-pointer items-center">
                              <input
                                type="checkbox"
                                checked={eventDraft.is_public === 1}
                                onChange={(e) => handleEventToggle('is_public', e.target.checked)}
                                className="peer sr-only"
                              />
                              <div className="after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all peer h-6 w-11 rounded-full bg-gray-200 after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white" />
                            </label>
                          </div>
                          {!isCreateMode && (
                            <div className="mt-4 rounded-lg bg-white px-4 py-3">
                              <div className="flex items-start justify-between">
                                <div>
                                  <p className="font-medium text-gray-900">Cover Photo</p>
                                  <p className="text-sm text-gray-500">
                                    Displayed on the event homepage.
                                  </p>
                                </div>
                                {baseEvent?.representative_image ? (
                                  <div className="relative inline-block">
                                    <div className="h-24 w-24 overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-sm">
                                      {ImageComponent(representativeThumbUrl, {
                                        width: 96,
                                        height: 96,
                                        className: 'h-full w-full object-cover',
                                        alt: 'Event cover',
                                      })}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={handleRemoveRepresentative}
                                      disabled={removingRepresentative}
                                      className="absolute -bottom-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white shadow-md transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-70"
                                      title="Remove cover photo"
                                    >
                                      {removingRepresentative ? (
                                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                      ) : (
                                        <Minus className="h-4 w-4" />
                                      )}
                                    </button>
                                  </div>
                                ) : (
                                  <div className="h-24 w-24 overflow-hidden rounded-xl border border-dashed border-gray-300 bg-gray-50 text-gray-400">
                                    {ImageComponent(null, {
                                      width: 96,
                                      height: 96,
                                      className: 'h-full w-full object-cover rounded-xl bg-gray-100 text-gray-400',
                                      alt: 'Event cover placeholder',
                                    })}
                                  </div>
                                )}
                              </div>
                              {!baseEvent?.representative_image && (
                                <p className="mt-3 text-sm text-gray-500">
                                  Choose a photo from the timeline or albums to set an event cover.
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="rounded-lg bg-gray-50 p-4">
                          <h3 className="text-sm font-semibold text-gray-700">Limits</h3>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs font-medium text-gray-600">
                                Photo Count Limit
                              </label>
                              <input
                                type="number"
                                min={0}
                                value={eventDraft.images_count_limit ?? ''}
                                onChange={(e) => {
                                  const value =
                                    e.target.value === '' ? '' : Math.max(0, Number(e.target.value));
                                  handleEventLimitChange(
                                    'images_count_limit',
                                    value === '' ? null : value
                                  );
                                }}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                                placeholder="Unlimited"
                              />
                              <p className="mt-1 text-xs text-gray-500">
                                Leave empty for unlimited photos.
                              </p>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-gray-600">
                                Max Upload Size (MB)
                              </label>
                              <input
                                type="number"
                                min={0}
                                value={
                                  eventDraft.image_size_limit_bytes != null
                                    ? Math.round(eventDraft.image_size_limit_bytes / (1024 * 1024))
                                    : ''
                                }
                                onChange={(e) =>
                                  handleEventSizeLimitMbChange(
                                    e.target.value === '' ? '' : Math.max(0, Number(e.target.value))
                                  )
                                }
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                                placeholder="Unlimited"
                              />
                              <p className="mt-1 text-xs text-gray-500">
                                Leave empty for no size limit.
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                                <ImageIcon className="h-5 w-5 text-blue-500" />
                              </div>
                              <p className="text-sm font-medium text-gray-600">Photos</p>
                            </div>
                            <span className="text-base font-semibold text-blue-600">
                              {baseEvent?.images_count ?? 0}
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                                <Users className="h-5 w-5 text-blue-500" />
                              </div>
                              <p className="text-sm font-medium text-gray-600">Faces</p>
                            </div>
                            <span className="text-base font-semibold text-blue-600">
                              {baseEvent?.faces_count ?? 0}
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                                <Layers className="h-5 w-5 text-blue-500" />
                              </div>
                              <p className="text-sm font-medium text-gray-600">Albums</p>
                            </div>
                            <span className="text-base font-semibold text-blue-600">
                              {baseEvent?.albums_count ?? 0}
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                                <Calendar className="h-5 w-5 text-blue-500" />
                              </div>
                              <p className="text-sm font-medium text-gray-600">Moments</p>
                            </div>
                            <span className="text-base font-semibold text-blue-600">
                              {baseEvent?.moments_count ?? 0}
                            </span>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-lg bg-gray-50 py-8 text-center text-sm text-gray-500">
                      Event details are unavailable.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-gray-200 bg-gray-50 px-6 py-4">
              <button
                type="submit"
                disabled={!canSaveEvent}
                data-submit-source="primary-button"
                className="flex items-center space-x-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {eventSaving ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>{savingLabel}</span>
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    <span>{primaryButtonLabel}</span>
                  </>
                )}
              </button>
            </div>
          </motion.form>
        </div>
      )}
    </AnimatePresence>
  );

  if (!isClient) return null;
  return createPortal(modalContent, document.body);
}


