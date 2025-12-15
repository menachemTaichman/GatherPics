import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Save, AlertCircle, Image as ImageIcon, Users, Layers, Calendar, Settings, Minus, HardDrive, Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import { eventsAPI, API_BASE } from '../../utils/apiService';
import { formatErrorMessage } from '../../utils/errorHandler';
import { useEventGeneralById } from '../../utils/dataManager';
import { ImageComponent } from '../../hooks/useImage.jsx';
import { useEventId, useApplyScopes } from '../../utils/storeUtils';
import { useModalManager } from '../../utils/modalManager';
import { useModalFocus } from '../../hooks/useModalFocus';
import { usePermissions } from '../../hooks/usePermissions';
import { useRTL } from '../../hooks/useRTL';
import i18n from '../../i18n';

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

function createEmptyEventDraft(uploadsLimits = null) {
  return {
    name: '',
    url: '',
    date: '',
    is_public: Boolean(0), // Internal state uses 0/1, but will be converted to true/false when sending to backend
    images_count_limit: uploadsLimits?.images_count_limit ?? 0,
    image_size_limit_bytes: uploadsLimits?.image_size_limit_bytes ?? 0,
    rekognition_calls_limit: uploadsLimits?.rekognition_calls_limit ?? 0,
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
  const [uploadsLimits, setUploadsLimits] = useState(null);
  const [limitErrors, setLimitErrors] = useState({
    images_count_limit: null,
    image_size_limit_bytes: null,
    rekognition_calls_limit: null,
  });
  const eventId = useEventId(isCreateMode ? null : eventUrl);
  const baseEvent = useEventGeneralById(eventId);
  const permissions = usePermissions(isCreateMode ? null : eventUrl);
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { isRTL, startClass, endClass } = useRTL();
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
    if (!isOpen) return;
    const fetchUploadsLimits = async () => {
      try {
        const limits = await eventsAPI.getUploadsLimits();
        setUploadsLimits(limits);
      } catch (error) {
        console.error('Failed to fetch upload limits:', error);
      }
    };
    fetchUploadsLimits();
  }, [isOpen]);

  useEffect(() => {
    if (!uploadsLimits) return;
    // Update draft with default limits if they're null
    setEventDraft((prev) => {
      if (!prev) return prev;
      const updates = {};
      if (prev.images_count_limit == null && uploadsLimits.images_count_limit != null) {
        updates.images_count_limit = uploadsLimits.images_count_limit;
      }
      if (prev.image_size_limit_bytes == null && uploadsLimits.image_size_limit_bytes != null) {
        updates.image_size_limit_bytes = uploadsLimits.image_size_limit_bytes;
      }
      return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev;
    });
  }, [uploadsLimits]);

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
      is_public: Boolean(evt.is_public),
      images_count_limit:
        evt.images_count_limit !== null && evt.images_count_limit !== undefined
          ? Number(evt.images_count_limit)
          : uploadsLimits?.images_count_limit ?? 0,
      image_size_limit_bytes:
        evt.image_size_limit_bytes !== null && evt.image_size_limit_bytes !== undefined
          ? Number(evt.image_size_limit_bytes)
          : uploadsLimits?.image_size_limit_bytes ?? 0,
      rekognition_calls_limit:
        evt.rekognition_calls_limit !== null && evt.rekognition_calls_limit !== undefined
          ? Number(evt.rekognition_calls_limit)
          : uploadsLimits?.rekognition_calls_limit ?? 0,
    };
  }, [uploadsLimits]);

  const handleResetEventDraft = useCallback(() => {
    if (nameCheckTimeout.current) clearTimeout(nameCheckTimeout.current);
    if (urlCheckTimeout.current) clearTimeout(urlCheckTimeout.current);
    if (isCreateMode) {
      setEventDraft(createEmptyEventDraft(uploadsLimits));
    } else if (baseEvent) {
      setEventDraft(buildEventDraft(baseEvent));
    } else {
      setEventDraft(null);
    }
    setEventError('');
    setNameConflict(false);
    setUrlConflict(false);
    setLimitErrors({
      images_count_limit: null,
      image_size_limit_bytes: null,
      rekognition_calls_limit: null,
    });
  }, [baseEvent, buildEventDraft, isCreateMode, uploadsLimits]);

  const handleRemoveRepresentative = useCallback(async () => {
    if (isCreateMode || !eventUrl || !baseEvent?.representative_image || removingRepresentative) {
      return;
    }
    setRemovingRepresentative(true);
    try {
      await eventsAPI.update(eventUrl, { representative_image: null });
      setEventError('');
      emitToast(t('editEventModal.eventCoverRemoved'), 'success');
      setCoverCacheBuster(Date.now());
    } catch (error) {
      console.error('Failed to remove event representative image:', error);
      const message = formatErrorMessage(t('editEventModal.removeEventCover'), error);
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
  }, [isOpen, isCreateMode, handleResetEventDraft, uploadsLimits]);

  const fetchEventDetails = useCallback(async () => {
    if (!eventUrl || !isOpen || isCreateMode) return;
    setEventLoading(true);
    setEventError('');
    try {
      await eventsAPI.getById(eventUrl);
    } catch (error) {
      console.error('Failed to load event details:', error);
      setEventError(formatErrorMessage(t('editEventModal.loadEventDetails'), error));
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
    const draftPublic = Boolean(eventDraft.is_public ?? false);
    const originalPublic = Boolean(baseEvent.is_public ?? false);
    const draftImagesLimit = eventDraft.images_count_limit ?? null;
    const originalImagesLimit = baseEvent.images_count_limit ?? null;
    const draftSizeLimit = eventDraft.image_size_limit_bytes ?? null;
    const originalSizeLimit = baseEvent.image_size_limit_bytes ?? null;
    const draftCallsLimit = eventDraft.rekognition_calls_limit ?? null;
    const originalCallsLimit = baseEvent.rekognition_calls_limit ?? null;
    return (
      draftName !== originalName ||
      draftUrl !== originalUrl ||
      draftDate !== originalDate ||
      draftPublic !== originalPublic ||
      draftImagesLimit !== originalImagesLimit ||
      draftSizeLimit !== originalSizeLimit ||
      draftCallsLimit !== originalCallsLimit
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
      handleEventFieldChange(field, Boolean(checked));
    },
    [handleEventFieldChange]
  );

  const validateLimit = useCallback((field, value) => {
    if (value === '' || value === null || value === undefined) {
      return { valid: false, error: t('editEventModal.photoCountLimitRequired') };
    }
    const numValue = Number(value);
    if (Number.isNaN(numValue)) {
      return { valid: false, error: t('editEventModal.photoCountLimitRequired') };
    }
    
    if (field === 'images_count_limit') {
      const minLimit = !isCreateMode && baseEvent?.images_count != null ? baseEvent.images_count : 0;
      const maxLimit = uploadsLimits?.images_count_limit;
      if (numValue < minLimit) {
        return { valid: false, error: t('editEventModal.photoCountLimitTooLow', { count: minLimit.toLocaleString() }) };
      }
      if (maxLimit != null && numValue > maxLimit) {
        return { valid: false, error: `${t('editEventModal.maximumPhotos', { max: maxLimit.toLocaleString() })}` };
      }
    } else if (field === 'image_size_limit_bytes') {
      const maxLimitBytes = uploadsLimits?.image_size_limit_bytes;
      if (numValue < 0) {
        return { valid: false, error: t('editEventModal.maxUploadSizeRequired') };
      }
      if (maxLimitBytes != null && numValue > maxLimitBytes) {
        const maxMb = Math.round(maxLimitBytes / (1024 * 1024));
        return { valid: false, error: `${t('editEventModal.maximumAllowedMB', { max: maxMb })}` };
      }
    } else if (field === 'rekognition_calls_limit') {
      const minLimit = !isCreateMode && baseEvent?.rekognition_calls_used != null ? baseEvent.rekognition_calls_used : 0;
      const maxLimit = uploadsLimits?.rekognition_calls_limit;
      if (numValue < minLimit) {
        return { valid: false, error: `${t('editEventModal.minimumCalls', { count: minLimit.toLocaleString() })}` };
      }
      if (maxLimit != null && numValue > maxLimit) {
        return { valid: false, error: `${t('editEventModal.maximumCalls', { max: maxLimit.toLocaleString() })}` };
      }
    }
    
    return { valid: true, error: null };
  }, [uploadsLimits, isCreateMode, baseEvent?.images_count, baseEvent?.rekognition_calls_used, t]);

  const handleEventLimitChange = useCallback((field, value) => {
    setEventDraft((prev) => {
      if (!prev) return prev;
      // Allow free typing - store the value as-is (could be string or number)
      const numValue = value === '' ? null : (typeof value === 'string' ? value : Number(value));
      return { ...prev, [field]: numValue };
    });
    
    // Clear error when user starts typing
    setLimitErrors((prev) => ({ ...prev, [field]: null }));
  }, []);

  const handleEventSizeLimitMbChange = useCallback((value) => {
    setEventDraft((prev) => {
      if (!prev) return prev;
      // Allow free typing - store raw value (string or number)
      const rawValue = value === '' ? null : value;
      return { ...prev, _image_size_limit_mb_input: rawValue };
    });
    
    // Clear error when user starts typing
    setLimitErrors((prev) => ({ ...prev, image_size_limit_bytes: null }));
  }, []);

  const handleEventCallsLimitChange = useCallback((value) => {
    setEventDraft((prev) => {
      if (!prev) return prev;
      // Allow free typing - store the value as-is (could be string or number)
      const numValue = value === '' ? null : (typeof value === 'string' ? value : Number(value));
      return { ...prev, rekognition_calls_limit: numValue };
    });
    
    // Clear error when user starts typing
    setLimitErrors((prev) => ({ ...prev, rekognition_calls_limit: null }));
  }, []);

  const handleLimitBlur = useCallback((field, value) => {
    if (field === 'image_size_limit_bytes') {
      // Convert MB input to bytes
      const mbValue = typeof value === 'string' ? (value === '' ? null : Number(value)) : value;
      if (mbValue === null || mbValue === '') {
        const maxLimitBytes = uploadsLimits?.image_size_limit_bytes;
        const correctedValue = maxLimitBytes ?? 0;
        setEventDraft((prev) => {
          if (!prev) return prev;
          return { ...prev, image_size_limit_bytes: correctedValue, _image_size_limit_mb_input: null };
        });
        const validation = validateLimit(field, correctedValue);
        setLimitErrors((prev) => ({ ...prev, [field]: validation.error }));
        return;
      }
      const bytesValue = Math.round(Number(mbValue) * 1024 * 1024);
      const validation = validateLimit(field, bytesValue);
      if (validation.valid) {
        setEventDraft((prev) => {
          if (!prev) return prev;
          return { ...prev, image_size_limit_bytes: bytesValue, _image_size_limit_mb_input: null };
        });
        setLimitErrors((prev) => ({ ...prev, [field]: null }));
      } else {
        // Clamp to valid range
        const maxLimitBytes = uploadsLimits?.image_size_limit_bytes;
        let correctedBytes = bytesValue;
        if (maxLimitBytes != null && correctedBytes > maxLimitBytes) {
          correctedBytes = maxLimitBytes;
        }
        if (correctedBytes < 0) {
          correctedBytes = 0;
        }
        setEventDraft((prev) => {
          if (!prev) return prev;
          return { ...prev, image_size_limit_bytes: correctedBytes, _image_size_limit_mb_input: null };
        });
        setLimitErrors((prev) => ({ ...prev, [field]: validation.error }));
      }
    } else {
      const numValue = typeof value === 'string' ? (value === '' ? null : Number(value)) : value;
      if (numValue === null || numValue === '') {
        const maxLimit = uploadsLimits?.[field === 'images_count_limit' ? 'images_count_limit' : 'rekognition_calls_limit'];
        const minLimit = field === 'images_count_limit' 
          ? (!isCreateMode && baseEvent?.images_count != null ? baseEvent.images_count : 0)
          : (!isCreateMode && baseEvent?.rekognition_calls_used != null ? baseEvent.rekognition_calls_used : 0);
        const correctedValue = maxLimit ?? minLimit;
        setEventDraft((prev) => {
          if (!prev) return prev;
          return { ...prev, [field]: correctedValue };
        });
        const validation = validateLimit(field, correctedValue);
        setLimitErrors((prev) => ({ ...prev, [field]: validation.error }));
        return;
      }
      const validation = validateLimit(field, numValue);
      if (validation.valid) {
        setEventDraft((prev) => {
          if (!prev) return prev;
          return { ...prev, [field]: numValue };
        });
        setLimitErrors((prev) => ({ ...prev, [field]: null }));
      } else {
        // Clamp to valid range
        const maxLimit = uploadsLimits?.[field === 'images_count_limit' ? 'images_count_limit' : 'rekognition_calls_limit'];
        const minLimit = field === 'images_count_limit' 
          ? (!isCreateMode && baseEvent?.images_count != null ? baseEvent.images_count : 0)
          : (!isCreateMode && baseEvent?.rekognition_calls_used != null ? baseEvent.rekognition_calls_used : 0);
        let correctedValue = numValue;
        if (correctedValue < minLimit) {
          correctedValue = minLimit;
        }
        if (maxLimit != null && correctedValue > maxLimit) {
          correctedValue = maxLimit;
        }
        setEventDraft((prev) => {
          if (!prev) return prev;
          return { ...prev, [field]: correctedValue };
        });
        setLimitErrors((prev) => ({ ...prev, [field]: validation.error }));
      }
    }
  }, [validateLimit, uploadsLimits, isCreateMode, baseEvent?.images_count, baseEvent?.rekognition_calls_used]);

  const handleEventSave = useCallback(async (source = 'ui') => {
    if (!eventDraft) return;
    const trimmedName = (eventDraft.name || '').trim();
    const trimmedUrl = (eventDraft.url || '').trim();
    if (!trimmedName) {
      setEventError(t('editEventModal.eventNameCannotBeEmpty'));
      return;
    }
    if (!trimmedUrl) {
      setEventError(t('editEventModal.eventUrlCannotBeEmpty'));
      return;
    }
    if (nameConflict || urlConflict) {
      setEventError(t('editEventModal.resolveConflictsBeforeSaving'));
      return;
    }
    if (!isCreateMode && !eventUrl) {
      setEventError(t('editEventModal.eventUrlMissing'));
      return;
    }
    
    // Validate limits before saving
    if (eventDraft.images_count_limit == null) {
      setEventError(t('editEventModal.photoCountLimitRequired'));
      return;
    }
    const imagesLimitValidation = validateLimit('images_count_limit', eventDraft.images_count_limit);
    if (!imagesLimitValidation.valid) {
      setLimitErrors((prev) => ({ ...prev, images_count_limit: imagesLimitValidation.error }));
      setEventError(imagesLimitValidation.error);
      return;
    }
    
    // Handle image size limit - convert MB input to bytes if needed
    let imageSizeLimitBytes = eventDraft.image_size_limit_bytes;
    if (eventDraft._image_size_limit_mb_input != null) {
      const mbValue = typeof eventDraft._image_size_limit_mb_input === 'string' 
        ? (eventDraft._image_size_limit_mb_input === '' ? null : Number(eventDraft._image_size_limit_mb_input))
        : eventDraft._image_size_limit_mb_input;
      imageSizeLimitBytes = mbValue != null ? Math.round(mbValue * 1024 * 1024) : null;
    }
    
    if (imageSizeLimitBytes == null) {
      setEventError(t('editEventModal.maxUploadSizeRequired'));
      return;
    }
    const sizeLimitValidation = validateLimit('image_size_limit_bytes', imageSizeLimitBytes);
    if (!sizeLimitValidation.valid) {
      setLimitErrors((prev) => ({ ...prev, image_size_limit_bytes: sizeLimitValidation.error }));
      setEventError(sizeLimitValidation.error);
      return;
    }
    
    if (permissions.has_settings && eventDraft.rekognition_calls_limit != null) {
      const callsLimitValidation = validateLimit('rekognition_calls_limit', eventDraft.rekognition_calls_limit);
      if (!callsLimitValidation.valid) {
        setLimitErrors((prev) => ({ ...prev, rekognition_calls_limit: callsLimitValidation.error }));
        setEventError(callsLimitValidation.error);
        return;
      }
    }
    setEventSaving(true);
    setEventError('');
    const previousUrl = baseEvent?.url;
    const payload = {
      name: trimmedName,
      url: trimmedUrl,
      date: eventDraft.date || null,
      is_public: Boolean(eventDraft.is_public),
      images_count_limit: Number(eventDraft.images_count_limit),
      image_size_limit_bytes: imageSizeLimitBytes,
    };
    // Only include rekognition_calls_limit if user has settings permission
    if (permissions.has_settings && eventDraft.rekognition_calls_limit != null) {
      payload.rekognition_calls_limit = eventDraft.rekognition_calls_limit;
    }
    try {
      let response;
      if (isCreateMode) {
        response = await eventsAPI.create(payload);
        emitToast(t('editEventModal.eventCreated'), 'success');
      } else {
        response = await eventsAPI.update(eventUrl, payload);
        const urlChanged = Boolean(previousUrl && trimmedUrl !== previousUrl);
        if (urlChanged) {
          emitToast(t('editEventModal.eventUrlUpdated'), 'info');
        }
        emitToast(t('editEventModal.eventSettingsUpdated'), 'success');
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
      const actionLabel = isCreateMode ? t('editEventModal.createEventAction') : t('editEventModal.updateEventAction');
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
    permissions.has_settings,
  ]);

  const hasLimitErrors = useMemo(() => {
    return limitErrors.images_count_limit != null || 
           limitErrors.image_size_limit_bytes != null || 
           limitErrors.rekognition_calls_limit != null;
  }, [limitErrors]);

  const canSaveEvent = useMemo(
    () => hasEventChanges && !nameConflict && !urlConflict && !eventSaving && !hasLimitErrors,
    [hasEventChanges, nameConflict, urlConflict, eventSaving, hasLimitErrors]
  );

  const handleModalKeys = useCallback(
    (e) => {
      // Allow all normal input behavior for input, textarea, and select elements
      const targetTagName = e.target.tagName?.toLowerCase();
      if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
        // For Enter key, save the event (only if there are changes and no conflicts)
        if (e.key === 'Enter' && !eventSaving && !nameConflict && !urlConflict && canSaveEvent) {
          e.preventDefault();
          e.stopPropagation();
          enterSubmitRef.current = true;
          handleEventSave('enter-key');
          return true;
        }
        // For ESC key, return false to let useModalFocus handle closing the modal
        if (e.key === 'Escape') {
          return false;
        }
        // Return true to signal that we're handling this, preventing useModalFocus from stopping it
        return true;
      }

      return false; // Let default modal behavior handle it (ESC to close)
    },
    [canSaveEvent, nameConflict, urlConflict, eventSaving, handleEventSave]
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

  const modalTitle = isCreateMode ? t('editEventModal.createEvent') : t('editEventModal.editEvent');
  const modalSubtitle = isCreateMode ? t('editEventModal.setUpNewEvent') : t('editEventModal.updateGeneralPreferences');
  const primaryButtonLabel = isCreateMode ? t('editEventModal.createEvent') : t('editEventModal.saveChanges');
  const savingLabel = isCreateMode ? t('editEventModal.creating') : t('editEventModal.saving');

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={onClose}
          dir={isRTL ? 'rtl' : 'ltr'}
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
              <div className="flex items-center gap-3">
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
                title={t('account.close')}
                aria-label={t('account.close')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-0">
              {eventLoading ? (
                <div className="flex items-center justify-center py-8 text-sm text-gray-500">
                  <div className={`h-4 w-4 animate-spin rounded-full border-2 border-primary-500 border-t-transparent ${isRTL ? 'ml-3' : 'mr-3'}`} />
                  {t('editEventModal.loadingEventSettings')}
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
                          <h3 className="text-sm font-semibold text-gray-700">{t('editEventModal.basics')}</h3>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs font-medium text-gray-600">
                                {t('editEventModal.eventName')}
                                <span className={`${isRTL ? 'mr-1' : 'ml-1'} text-red-500`}>*</span>
                              </label>
                              <input
                                type="text"
                                value={eventDraft.name}
                                onChange={(e) => handleEventFieldChange('name', e.target.value)}
                                required
                                dir={isRTL ? 'rtl' : 'ltr'}
                                className={`w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:border-transparent ${
                                  nameConflict
                                    ? 'border-red-500 focus:ring-red-500'
                                    : 'border-gray-300 focus:ring-blue-500'
                                }`}
                                placeholder={t('editEventModal.enterEventName')}
                              />
                              {checkingName ? (
                                <p className="mt-1 text-xs text-gray-500">{t('editEventModal.checkingAvailability')}</p>
                              ) : nameConflict ? (
                                <p className="mt-1 text-xs text-red-600">
                                  {t('editEventModal.nameAlreadyInUse')}
                                </p>
                              ) : null}
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-gray-600">
                                {t('editEventModal.eventUrl')}
                                <span className={`${isRTL ? 'mr-1' : 'ml-1'} text-red-500`}>*</span>
                              </label>
                              <input
                                type="text"
                                value={eventDraft.url}
                                onChange={(e) => handleEventFieldChange('url', e.target.value)}
                                required
                                dir="ltr"
                                className={`w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:border-transparent ${
                                  urlConflict
                                    ? 'border-red-500 focus:ring-red-500'
                                    : 'border-gray-300 focus:ring-blue-500'
                                }`}
                                placeholder={t('editEventModal.friendlyEventSlug')}
                              />
                              {checkingUrl ? (
                                <p className="mt-1 text-xs text-gray-500">{t('editEventModal.checkingAvailability')}</p>
                              ) : urlConflict ? (
                                <p className="mt-1 text-xs text-red-600">
                                  {t('editEventModal.urlAlreadyInUse')}
                                </p>
                              ) : null}
                              {baseEvent?.url && eventDraft.url !== baseEvent.url && (
                                <p className="mt-1 text-xs text-amber-600">
                                  {t('editEventModal.urlWillChange')}
                                </p>
                              )}
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-gray-600">
                                {t('editEventModal.eventDate')}
                              </label>
                              <input
                                type="date"
                                value={eventDraft.date || ''}
                                onChange={(e) => handleEventFieldChange('date', e.target.value)}
                                dir="ltr"
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                          <div className="mt-4 flex items-center justify-between rounded-lg bg-white px-4 py-3">
                            <div>
                              <p className="font-medium text-gray-900">{t('editEventModal.publicEvent')}</p>
                              <p className="text-sm text-gray-500">
                                {t('editEventModal.showInPublicList')}
                              </p>
                            </div>
                            <label className="relative inline-flex cursor-pointer items-center">
                              <input
                                type="checkbox"
                                checked={Boolean(eventDraft.is_public)}
                                onChange={(e) => handleEventToggle('is_public', e.target.checked)}
                                className="peer sr-only"
                              />
                              <div className={`after:absolute after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all peer h-6 w-11 rounded-full bg-gray-200 after:content-[''] peer-checked:bg-blue-600 peer-checked:after:border-white ${
                                isRTL 
                                  ? 'after:right-[2px] peer-checked:after:-translate-x-5' 
                                  : 'after:left-[2px] peer-checked:after:translate-x-5'
                              }`} />
                            </label>
                          </div>
                          {!isCreateMode && (
                            <div className="mt-4 rounded-lg bg-white px-4 py-3">
                              <div className="flex items-start justify-between">
                                <div>
                                  <p className="font-medium text-gray-900">{t('editEventModal.coverPhoto')}</p>
                                  <p className="text-sm text-gray-500">
                                    {t('editEventModal.displayedOnHomepage')}
                                  </p>
                                </div>
                                {baseEvent?.representative_image ? (
                                  <div className="relative inline-block">
                                    <div className="h-24 w-24 overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-sm">
                                      {ImageComponent(representativeThumbUrl, {
                                        width: 96,
                                        height: 96,
                                        className: 'h-full w-full object-cover',
                                        alt: t('editEventModal.coverPhoto'),
                                      })}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={handleRemoveRepresentative}
                                      disabled={removingRepresentative}
                                      className={`absolute -bottom-2 flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white shadow-md transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-70 ${endClass('2')}`}
                                      title={t('editEventModal.removeCoverPhoto')}
                                      aria-label={t('editEventModal.removeCoverPhoto')}
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
                                      alt: t('editEventModal.coverPhoto'),
                                    })}
                                  </div>
                                )}
                              </div>
                              {!baseEvent?.representative_image && (
                                <p className="mt-3 text-sm text-gray-500">
                                  {t('editEventModal.choosePhotoFromTimeline')}
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="rounded-lg bg-gray-50 p-4">
                          <h3 className="text-sm font-semibold text-gray-700">{t('editEventModal.limits')}</h3>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs font-medium text-gray-600">
                                {t('editEventModal.photoCountLimit')}
                                <span className={`${isRTL ? 'mr-1' : 'ml-1'} text-red-500`}>*</span>
                              </label>
                              <input
                                type="number"
                                required
                                min={!isCreateMode && baseEvent?.images_count != null ? baseEvent.images_count : 0}
                                max={uploadsLimits?.images_count_limit ?? undefined}
                                value={eventDraft.images_count_limit ?? ''}
                                onChange={(e) => {
                                  const value = e.target.value === '' ? '' : e.target.value;
                                  handleEventLimitChange('images_count_limit', value);
                                }}
                                onBlur={(e) => {
                                  handleLimitBlur('images_count_limit', e.target.value);
                                }}
                                dir={isRTL ? 'rtl' : 'ltr'}
                                className={`w-full rounded-lg border px-3 py-2 text-sm focus:border-transparent focus:ring-2 ${
                                  limitErrors.images_count_limit
                                    ? 'border-red-500 focus:ring-red-500'
                                    : 'border-gray-300 focus:ring-blue-500'
                                }`}
                                placeholder={uploadsLimits?.images_count_limit?.toLocaleString() ?? t('editEventModal.requiredEnterMaxPhotos')}
                              />
                              {limitErrors.images_count_limit ? (
                                <p className="mt-1 text-xs text-red-600">{limitErrors.images_count_limit}</p>
                              ) : (
                                <p className="mt-1 text-xs text-gray-500">
                                  {!isCreateMode && baseEvent?.images_count != null
                                    ? `${t('editEventModal.minimumPhotos', { count: baseEvent.images_count.toLocaleString() })} ${uploadsLimits?.images_count_limit != null ? t('editEventModal.maximumPhotos', { max: uploadsLimits.images_count_limit.toLocaleString() }) : ''}`
                                    : uploadsLimits?.images_count_limit != null
                                    ? t('editEventModal.maximumAllowedPhotos', { max: uploadsLimits.images_count_limit.toLocaleString() })
                                    : t('editEventModal.requiredEnterMaxPhotos')}
                                </p>
                              )}
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-gray-600">
                                {t('editEventModal.maxUploadSize')}
                                <span className={`${isRTL ? 'mr-1' : 'ml-1'} text-red-500`}>*</span>
                              </label>
                              <input
                                type="number"
                                required
                                min={0}
                                max={
                                  uploadsLimits?.image_size_limit_bytes != null
                                    ? Math.round(uploadsLimits.image_size_limit_bytes / (1024 * 1024))
                                    : undefined
                                }
                                value={
                                  eventDraft._image_size_limit_mb_input != null
                                    ? eventDraft._image_size_limit_mb_input
                                    : eventDraft.image_size_limit_bytes != null
                                    ? Math.round(eventDraft.image_size_limit_bytes / (1024 * 1024))
                                    : ''
                                }
                                onChange={(e) => {
                                  const value = e.target.value === '' ? '' : e.target.value;
                                  handleEventSizeLimitMbChange(value);
                                }}
                                onBlur={(e) => {
                                  handleLimitBlur('image_size_limit_bytes', e.target.value);
                                }}
                                dir={isRTL ? 'rtl' : 'ltr'}
                                className={`w-full rounded-lg border px-3 py-2 text-sm focus:border-transparent focus:ring-2 ${
                                  limitErrors.image_size_limit_bytes
                                    ? 'border-red-500 focus:ring-red-500'
                                    : 'border-gray-300 focus:ring-blue-500'
                                }`}
                                placeholder={
                                  uploadsLimits?.image_size_limit_bytes != null
                                    ? String(Math.round(uploadsLimits.image_size_limit_bytes / (1024 * 1024)))
                                    : t('editEventModal.requiredEnterMaxSize')
                                }
                              />
                              {limitErrors.image_size_limit_bytes ? (
                                <p className="mt-1 text-xs text-red-600">{limitErrors.image_size_limit_bytes}</p>
                              ) : (
                                <p className="mt-1 text-xs text-gray-500">
                                  {uploadsLimits?.image_size_limit_bytes != null
                                    ? t('editEventModal.maximumAllowedMB', { max: Math.round(uploadsLimits.image_size_limit_bytes / (1024 * 1024)) })
                                    : t('editEventModal.requiredEnterMaxSize')}
                                </p>
                              )}
                            </div>
                            {permissions.has_settings && (
                              <div>
                                <label className="mb-1 block text-xs font-medium text-gray-600">
                                  {t('editEventModal.callsLimit')}
                                  <span className={`${isRTL ? 'mr-1' : 'ml-1'} text-red-500`}>*</span>
                                </label>
                                <input
                                  type="number"
                                  min={!isCreateMode && baseEvent?.rekognition_calls_used != null ? baseEvent.rekognition_calls_used : 0}
                                  max={uploadsLimits?.rekognition_calls_limit ?? undefined}
                                  value={eventDraft.rekognition_calls_limit ?? ''}
                                  onChange={(e) => {
                                    const value = e.target.value === '' ? '' : e.target.value;
                                    handleEventCallsLimitChange(value);
                                  }}
                                  onBlur={(e) => {
                                    handleLimitBlur('rekognition_calls_limit', e.target.value);
                                  }}
                                  dir={isRTL ? 'rtl' : 'ltr'}
                                  className={`w-full rounded-lg border px-3 py-2 text-sm focus:border-transparent focus:ring-2 ${
                                    limitErrors.rekognition_calls_limit
                                      ? 'border-red-500 focus:ring-red-500'
                                      : 'border-gray-300 focus:ring-blue-500'
                                  }`}
                                  placeholder={uploadsLimits?.rekognition_calls_limit?.toLocaleString() ?? t('editEventModal.enterMaxCalls')}
                                />
                                {limitErrors.rekognition_calls_limit ? (
                                  <p className="mt-1 text-xs text-red-600">{limitErrors.rekognition_calls_limit}</p>
                                ) : (
                                  <p className="mt-1 text-xs text-gray-500">
                                    {!isCreateMode && baseEvent?.rekognition_calls_used != null
                                      ? `${t('editEventModal.minimumCalls', { count: baseEvent.rekognition_calls_used.toLocaleString() })} ${uploadsLimits?.rekognition_calls_limit != null ? t('editEventModal.maximumCalls', { max: uploadsLimits.rekognition_calls_limit.toLocaleString() }) : ''}`
                                      : uploadsLimits?.rekognition_calls_limit != null
                                      ? t('editEventModal.maximumAllowedCalls', { max: uploadsLimits.rekognition_calls_limit.toLocaleString() })
                                      : t('editEventModal.enterMaxCalls')}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {!isCreateMode && baseEvent && (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                                  <ImageIcon className="h-5 w-5 text-blue-500" />
                                </div>
                                <p className="text-sm font-medium text-gray-600">{t('eventsGallery.photos')}</p>
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
                                <p className="text-sm font-medium text-gray-600">{t('eventsGallery.faces')}</p>
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
                                <p className="text-sm font-medium text-gray-600">{t('eventsGallery.albums')}</p>
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
                                <p className="text-sm font-medium text-gray-600">{t('eventsGallery.moments')}</p>
                              </div>
                              <span className="text-base font-semibold text-blue-600">
                                {baseEvent?.moments_count ?? 0}
                              </span>
                            </div>
                            <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                                  <HardDrive className="h-5 w-5 text-blue-500" />
                                </div>
                                <p className="text-sm font-medium text-gray-600">{t('eventsGallery.totalSize')}</p>
                              </div>
                              <span className="text-base font-semibold text-blue-600">
                                {baseEvent.total_size != null
                                  ? `${(baseEvent.total_size / (1024 * 1024)).toFixed(2)} MB`
                                  : '0 MB'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                                  <HardDrive className="h-5 w-5 text-blue-500" />
                                </div>
                                <p className="text-sm font-medium text-gray-600">{t('eventsGallery.totalSize')}</p>
                              </div>
                              <span className="text-base font-semibold text-blue-600">
                                {baseEvent.total_original_size != null
                                  ? `${(baseEvent.total_original_size / (1024 * 1024)).toFixed(2)} MB`
                                  : '0 MB'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                                  <HardDrive className="h-5 w-5 text-blue-500" />
                                </div>
                                <p className="text-sm font-medium text-gray-600">{t('eventsGallery.totalSize')}</p>
                              </div>
                              <span className="text-base font-semibold text-blue-600">
                                {baseEvent.total_high_quality_size != null
                                  ? `${(baseEvent.total_high_quality_size / (1024 * 1024)).toFixed(2)} MB`
                                  : '0 MB'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                                  <HardDrive className="h-5 w-5 text-blue-500" />
                                </div>
                                <p className="text-sm font-medium text-gray-600">{t('eventsGallery.totalSize')}</p>
                              </div>
                              <span className="text-base font-semibold text-blue-600">
                                {baseEvent.max_image_size != null
                                  ? `${(baseEvent.max_image_size / (1024 * 1024)).toFixed(2)} MB`
                                  : '0 MB'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                                  <Activity className="h-5 w-5 text-blue-500" />
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-gray-600">{t('editEventModal.callsLimit')}</p>
                                  {baseEvent?.rekognition_calls_limit != null && (
                                    <p className="text-xs text-gray-500">
                                      {t('editEventModal.maximumCalls', { max: baseEvent.rekognition_calls_limit.toLocaleString() })}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <span className="text-base font-semibold text-blue-600">
                                {baseEvent?.rekognition_calls_used ?? 0}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-lg bg-gray-50 py-8 text-center text-sm text-gray-500">
                      {t('editEventModal.eventDetailsUnavailable')}
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
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
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


