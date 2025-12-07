import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Settings as SettingsIcon, AlertCircle, HardDrive, Activity, Save, Calendar, AlertTriangle, ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import { settingsAPI, eventsAPI } from '../../utils/apiService';
import { formatErrorMessage } from '../../utils/errorHandler';
import { getPreference, setPreference } from '../../utils/settings';
import { useAuth } from '../../contexts/authContext';
import { LoginModal } from '../../components/auth';
import { useAuthRefresh } from '../../hooks/useAuthRefresh';
import { TopNavigationBar } from '../../components/layout';
import { ScrollableTable } from '../../components/common';
import { useEventsGeneralList, useDataStore } from '../../utils/dataManager';
import { useApplyScopes } from '../../utils/storeUtils';
import { APP_CONFIG } from '../../config/appConfig';
import { formatDateTimeLocale } from '../../utils/dateUtils';
import ErrorDetailModal from '../../components/errors/ErrorDetailModal';
import AuditLogDetailModal from '../../components/auditLogs/AuditLogDetailModal';
import { useRTL } from '../../hooks/useRTL';
import i18n from '../../i18n';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

export default function SettingsPage() {
  const { isAuthenticated, isLoading, showLoginModal, loginError, login, closeLoginModal, openLoginModal } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  
  const [settings, setSettings] = useState(null);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  
  // Active section (limits, usage, errors, or audit)
  const [activeSection, setActiveSection] = useState(() => getPreference('SettingsPage.activeSection', 'limits'));
  
  // Filters for usage section
  const [filterPeriod, setFilterPeriod] = useState(() => getPreference('SettingsPage.usageFilterPeriod') ?? 'all');
  const [filterDateFrom, setFilterDateFrom] = useState(() => getPreference('SettingsPage.usageFilterDateFrom') ?? '');
  const [filterDateTo, setFilterDateTo] = useState(() => getPreference('SettingsPage.usageFilterDateTo') ?? '');
  const [sortBy, setSortBy] = useState(() => getPreference('SettingsPage.usageSortBy') ?? 'created_at');
  const [sortDir, setSortDir] = useState(() => getPreference('SettingsPage.usageSortDir') ?? 'desc');
  
  // Filters for errors section
  const [errorFilterPeriod, setErrorFilterPeriod] = useState(() => getPreference('SettingsPage.errorFilterPeriod') ?? 'all');
  const [errorFilterDateFrom, setErrorFilterDateFrom] = useState(() => getPreference('SettingsPage.errorFilterDateFrom') ?? '');
  const [errorFilterDateTo, setErrorFilterDateTo] = useState(() => getPreference('SettingsPage.errorFilterDateTo') ?? '');
  const [errorFilterType, setErrorFilterType] = useState(() => getPreference('SettingsPage.errorFilterType') ?? 'all');
  const [errorSortBy, setErrorSortBy] = useState(() => getPreference('SettingsPage.errorSortBy') ?? 'created_at');
  const [errorSortDir, setErrorSortDir] = useState(() => getPreference('SettingsPage.errorSortDir') ?? 'desc');
  
  // Filters for audit logs section
  const [auditFilterPeriod, setAuditFilterPeriod] = useState(() => getPreference('SettingsPage.auditFilterPeriod') ?? 'all');
  const [auditFilterDateFrom, setAuditFilterDateFrom] = useState(() => getPreference('SettingsPage.auditFilterDateFrom') ?? '');
  const [auditFilterDateTo, setAuditFilterDateTo] = useState(() => getPreference('SettingsPage.auditFilterDateTo') ?? '');
  const [auditFilterSeverity, setAuditFilterSeverity] = useState(() => getPreference('SettingsPage.auditFilterSeverity') ?? 'all');
  const [auditFilterAction, setAuditFilterAction] = useState(() => getPreference('SettingsPage.auditFilterAction') ?? 'all');
  const [auditSortBy, setAuditSortBy] = useState(() => getPreference('SettingsPage.auditSortBy') ?? 'timestamp');
  const [auditSortDir, setAuditSortDir] = useState(() => getPreference('SettingsPage.auditSortDir') ?? 'desc');
  
  // Error detail modal state
  const [openErrorId, setOpenErrorId] = useState(null);
  const [errorNavigation, setErrorNavigation] = useState({ currentIndex: 0, errors: [] });
  
  // Audit log detail modal state
  const [openAuditLogId, setOpenAuditLogId] = useState(null);
  const [auditLogNavigation, setAuditLogNavigation] = useState({ currentIndex: 0, logs: [] });
  
  // Fetch events and add to scope
  useApplyScopes([{ entity: 'all', id: 'events', eventId: 'general' }]);
  const applyChanges = useDataStore((state) => state.applyChanges);
  const eventsList = useEventsGeneralList();
  
  const fetchEvents = useCallback(async () => {
    try {
      const data = await eventsAPI.list();
      const appliedChanges = Array.isArray(data?.__appliedChanges) ? data.__appliedChanges : [];
      
      const upsertChange = appliedChanges.find(
        (change) => change && change.type === 'UPSERT' && (change.entity === 'event' || change.entity === 'events')
      );
      const items = Array.isArray(upsertChange?.items) ? upsertChange.items : [];
      
      const currentStateBefore = useDataStore.getState();
      const currentMap = currentStateBefore.entities?.general?.events || {};
      const nextIds = new Set(items.map((evt) => String(evt.event_id)));
      const currentIds = new Set(Object.keys(currentMap || {}));
      const removedIds = Array.from(currentIds).filter((id) => !nextIds.has(String(id)));
      
      if (removedIds.length > 0) {
        const removalChange = {
          type: 'REMOVE',
          entity: 'event',
          ids: removedIds,
          event_id: 'general',
          ignoreScope: true,
          broadcast: false,
        };
        applyChanges([removalChange], { broadcast: false, ignoreScope: true });
      }
    } catch (err) {
      console.error('Failed to load events:', err);
    }
  }, [applyChanges]);
  
  useAuthRefresh(fetchEvents, []);

  // Set document title
  useEffect(() => {
    document.title = `${t('settings.settings')} | ${APP_CONFIG.name}`;
  }, [i18n.language]);

  // Auto-show login modal when not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      openLoginModal();
    }
  }, [isAuthenticated, isLoading, openLoginModal]);

  // Load settings
  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await settingsAPI.get();
      const loadedSettings = response.settings || {};
      setSettings(loadedSettings);
      setSettingsDraft({
        image_size_limit_bytes: loadedSettings.image_size_limit_bytes ?? 0,
        images_count_limit: loadedSettings.images_count_limit ?? 0,
        rekognition_calls_limit: loadedSettings.rekognition_calls_limit ?? 0,
        min_rank_to_create_event: loadedSettings.min_rank_to_create_event ?? 0,
      });
    } catch (err) {
      const errorMessage = formatErrorMessage(err, t('settings.failedToLoadSettings'));
      setError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useAuthRefresh(loadSettings, []);

  const hasChanges = useCallback(() => {
    if (!settings || !settingsDraft) return false;
    return (
      settingsDraft.image_size_limit_bytes !== (settings.image_size_limit_bytes ?? 0) ||
      settingsDraft.images_count_limit !== (settings.images_count_limit ?? 0) ||
      settingsDraft.rekognition_calls_limit !== (settings.rekognition_calls_limit ?? 0) ||
      settingsDraft.min_rank_to_create_event !== (settings.min_rank_to_create_event ?? 0)
    );
  }, [settings, settingsDraft]);

  const canSave = !loading && !saving && settingsDraft && hasChanges();

  const handleFieldChange = useCallback((field, value) => {
    setSettingsDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, [field]: value };
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!canSave || !settingsDraft) return;

    setSaving(true);
    setError('');

    try {
      const updateData = {};
      if (settingsDraft.image_size_limit_bytes !== (settings?.image_size_limit_bytes ?? 0)) {
        updateData.image_size_limit_bytes = settingsDraft.image_size_limit_bytes;
      }
      if (settingsDraft.images_count_limit !== (settings?.images_count_limit ?? 0)) {
        updateData.images_count_limit = settingsDraft.images_count_limit;
      }
      if (settingsDraft.rekognition_calls_limit !== (settings?.rekognition_calls_limit ?? 0)) {
        updateData.rekognition_calls_limit = settingsDraft.rekognition_calls_limit;
      }
      if (settingsDraft.min_rank_to_create_event !== (settings?.min_rank_to_create_event ?? 0)) {
        updateData.min_rank_to_create_event = settingsDraft.min_rank_to_create_event;
      }

      const response = await settingsAPI.update(updateData);
      const updatedSettings = response?.settings || {};
      showToast(t('settings.settingsSavedSuccessfully'), 'success');
      
      // Smoothly update state instead of reloading (preserve rekognition_usage, errors, and audit_logs)
      setSettings((prev) => ({
        ...prev,
        ...updatedSettings,
        rekognition_usage: prev?.rekognition_usage || updatedSettings.rekognition_usage,
        errors: prev?.errors || updatedSettings.errors,
        audit_logs: prev?.audit_logs || updatedSettings.audit_logs,
      }));
      setSettingsDraft({
        image_size_limit_bytes: updatedSettings.image_size_limit_bytes ?? 0,
        images_count_limit: updatedSettings.images_count_limit ?? 0,
        rekognition_calls_limit: updatedSettings.rekognition_calls_limit ?? 0,
        min_rank_to_create_event: updatedSettings.min_rank_to_create_event ?? 0,
      });
    } catch (err) {
      const errorMessage = formatErrorMessage(err, t('settings.failedToSaveSettings'));
      setError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setSaving(false);
    }
  }, [canSave, settingsDraft, settings, showToast]);
  
  const handleCancel = useCallback(() => {
    if (!settings) return;
    setSettingsDraft({
      image_size_limit_bytes: settings.image_size_limit_bytes ?? 0,
      images_count_limit: settings.images_count_limit ?? 0,
      rekognition_calls_limit: settings.rekognition_calls_limit ?? 0,
      min_rank_to_create_event: settings.min_rank_to_create_event ?? 0,
    });
    setError('');
  }, [settings]);

  // Handle ESC key for cancel
  useEffect(() => {
    if (activeSection !== 'limits') return;
    
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && hasChanges()) {
        handleCancel();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSection, hasChanges, handleCancel]);

  // Handle form submission (Enter key)
  const handleFormSubmit = useCallback((e) => {
    e.preventDefault();
    if (canSave && !saving) {
      handleSave();
    }
  }, [canSave, saving, handleSave]);

  // Filter and sort usage data
  const filteredAndSortedUsage = useMemo(() => {
    const usageDict = settings?.rekognition_usage || {};
    let usageArray = Object.values(usageDict);

    // Filter by date period
    if (filterPeriod && filterPeriod !== 'all') {
      if (filterPeriod === 'custom') {
        // Custom date range
        if (filterDateFrom || filterDateTo) {
          usageArray = usageArray.filter(usage => {
            if (!usage.created_at) return false;
            const usageDate = new Date(usage.created_at);
            
            if (filterDateFrom && filterDateTo) {
              const startDate = new Date(filterDateFrom);
              startDate.setHours(0, 0, 0, 0);
              const endDate = new Date(filterDateTo);
              endDate.setHours(23, 59, 59, 999);
              return usageDate >= startDate && usageDate <= endDate;
            } else if (filterDateFrom) {
              const startDate = new Date(filterDateFrom);
              startDate.setHours(0, 0, 0, 0);
              return usageDate >= startDate;
            } else if (filterDateTo) {
              const endDate = new Date(filterDateTo);
              endDate.setHours(23, 59, 59, 999);
              return usageDate <= endDate;
            }
            return true;
          });
        }
      } else {
        // Predefined periods
        const now = new Date();
        let startDate;
        
        if (filterPeriod === 'last_month') {
          startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        } else if (filterPeriod === 'last_3_months') {
          startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
        } else if (filterPeriod === 'last_6_months') {
          startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
        } else if (filterPeriod === 'last_year') {
          startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        }
        
        if (startDate) {
          usageArray = usageArray.filter(usage => {
            if (!usage.created_at) return false;
            const usageDate = new Date(usage.created_at);
            return usageDate >= startDate;
          });
        }
      }
    }

    // Sort
    const toValue = (item, field) => {
      switch (field) {
        case 'created_at':
          return item.created_at ? new Date(item.created_at).getTime() : 0;
        case 'event_label':
          return (item.event_label || item.event_id || '').toString().toLowerCase();
        case 'profile_label':
          return (item.profile_label || item.profile_id || '').toString().toLowerCase();
        case 'calls_count':
          return item.calls_count || 0;
        default:
          return '';
      }
    };

    const copy = [...usageArray];
    copy.sort((a, b) => {
      const aVal = toValue(a, sortBy);
      const bVal = toValue(b, sortBy);
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      const comparison = String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? comparison : -comparison;
    });

    return copy;
  }, [settings?.rekognition_usage, filterPeriod, filterDateFrom, filterDateTo, sortBy, sortDir]);

  const handleSort = (field) => {
    if (sortBy === field) {
      const newDir = sortDir === 'asc' ? 'desc' : 'asc';
      setSortDir(newDir);
      setPreference('SettingsPage.usageSortDir', newDir);
    } else {
      setSortBy(field);
      setSortDir('desc');
      setPreference('SettingsPage.usageSortBy', field);
      setPreference('SettingsPage.usageSortDir', 'desc');
    }
  };

  const handleFilterPeriodChange = (period) => {
    setFilterPeriod(period);
    setPreference('SettingsPage.usageFilterPeriod', period);
    if (period !== 'custom') {
      setFilterDateFrom('');
      setFilterDateTo('');
      setPreference('SettingsPage.usageFilterDateFrom', '');
      setPreference('SettingsPage.usageFilterDateTo', '');
    }
  };

  const handleDateFromChange = (date) => {
    setFilterDateFrom(date);
    setPreference('SettingsPage.usageFilterDateFrom', date);
    if (date) {
      setFilterPeriod('custom');
      setPreference('SettingsPage.usageFilterPeriod', 'custom');
    }
  };

  const handleDateToChange = (date) => {
    setFilterDateTo(date);
    setPreference('SettingsPage.usageFilterDateTo', date);
    if (date) {
      setFilterPeriod('custom');
      setPreference('SettingsPage.usageFilterPeriod', 'custom');
    }
  };

  const handleSectionChange = (section) => {
    setActiveSection(section);
    setPreference('SettingsPage.activeSection', section);
  };

  // Filter and sort errors data
  const filteredAndSortedErrors = useMemo(() => {
    const errorsDict = settings?.errors || {};
    let errorsArray = Object.values(errorsDict);

    // Filter by error type
    if (errorFilterType && errorFilterType !== 'all') {
      errorsArray = errorsArray.filter(err => err.error_type === errorFilterType);
    }

    // Filter by date period
    if (errorFilterPeriod && errorFilterPeriod !== 'all') {
      if (errorFilterPeriod === 'custom') {
        if (errorFilterDateFrom || errorFilterDateTo) {
          errorsArray = errorsArray.filter(err => {
            if (!err.created_at) return false;
            const errDate = new Date(err.created_at);
            
            if (errorFilterDateFrom && errorFilterDateTo) {
              const startDate = new Date(errorFilterDateFrom);
              startDate.setHours(0, 0, 0, 0);
              const endDate = new Date(errorFilterDateTo);
              endDate.setHours(23, 59, 59, 999);
              return errDate >= startDate && errDate <= endDate;
            } else if (errorFilterDateFrom) {
              const startDate = new Date(errorFilterDateFrom);
              startDate.setHours(0, 0, 0, 0);
              return errDate >= startDate;
            } else if (errorFilterDateTo) {
              const endDate = new Date(errorFilterDateTo);
              endDate.setHours(23, 59, 59, 999);
              return errDate <= endDate;
            }
            return true;
          });
        }
      } else {
        const now = new Date();
        let startDate;
        
        if (errorFilterPeriod === 'last_month') {
          startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        } else if (errorFilterPeriod === 'last_3_months') {
          startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
        } else if (errorFilterPeriod === 'last_6_months') {
          startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
        } else if (errorFilterPeriod === 'last_year') {
          startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        }
        
        if (startDate) {
          errorsArray = errorsArray.filter(err => {
            if (!err.created_at) return false;
            const errDate = new Date(err.created_at);
            return errDate >= startDate;
          });
        }
      }
    }

    // Sort
    const toErrorValue = (item, field) => {
      switch (field) {
        case 'created_at':
          return item.created_at ? new Date(item.created_at).getTime() : 0;
        case 'error_type':
          return (item.error_type || '').toString().toLowerCase();
        case 'error_message':
          return (item.error_message || '').toString().toLowerCase();
        case 'request_path':
          return (item.request_path || '').toString().toLowerCase();
        default:
          return '';
      }
    };

    const copy = [...errorsArray];
    copy.sort((a, b) => {
      const aVal = toErrorValue(a, errorSortBy);
      const bVal = toErrorValue(b, errorSortBy);
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return errorSortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      const comparison = String(aVal).localeCompare(String(bVal));
      return errorSortDir === 'asc' ? comparison : -comparison;
    });

    return copy;
  }, [settings?.errors, errorFilterPeriod, errorFilterDateFrom, errorFilterDateTo, errorFilterType, errorSortBy, errorSortDir]);

  const handleErrorSort = (field) => {
    if (errorSortBy === field) {
      const newDir = errorSortDir === 'asc' ? 'desc' : 'asc';
      setErrorSortDir(newDir);
      setPreference('SettingsPage.errorSortDir', newDir);
    } else {
      setErrorSortBy(field);
      setErrorSortDir('desc');
      setPreference('SettingsPage.errorSortBy', field);
      setPreference('SettingsPage.errorSortDir', 'desc');
    }
  };

  const handleErrorFilterPeriodChange = (period) => {
    setErrorFilterPeriod(period);
    setPreference('SettingsPage.errorFilterPeriod', period);
    if (period !== 'custom') {
      setErrorFilterDateFrom('');
      setErrorFilterDateTo('');
      setPreference('SettingsPage.errorFilterDateFrom', '');
      setPreference('SettingsPage.errorFilterDateTo', '');
    }
  };

  const handleErrorDateFromChange = (date) => {
    setErrorFilterDateFrom(date);
    setPreference('SettingsPage.errorFilterDateFrom', date);
    if (date) {
      setErrorFilterPeriod('custom');
      setPreference('SettingsPage.errorFilterPeriod', 'custom');
    }
  };

  const handleErrorDateToChange = (date) => {
    setErrorFilterDateTo(date);
    setPreference('SettingsPage.errorFilterDateTo', date);
    if (date) {
      setErrorFilterPeriod('custom');
      setPreference('SettingsPage.errorFilterPeriod', 'custom');
    }
  };

  const handleErrorFilterTypeChange = (type) => {
    setErrorFilterType(type);
    setPreference('SettingsPage.errorFilterType', type);
  };

  // Filter and sort audit logs data
  const filteredAndSortedAuditLogs = useMemo(() => {
    const auditLogsDict = settings?.audit_logs || {};
    let auditLogsArray = Object.values(auditLogsDict);

    // Filter by severity
    if (auditFilterSeverity && auditFilterSeverity !== 'all') {
      auditLogsArray = auditLogsArray.filter(log => log.severity === auditFilterSeverity);
    }

    // Filter by action
    if (auditFilterAction && auditFilterAction !== 'all') {
      auditLogsArray = auditLogsArray.filter(log => log.action === auditFilterAction);
    }

    // Filter by date period
    if (auditFilterPeriod && auditFilterPeriod !== 'all') {
      if (auditFilterPeriod === 'custom') {
        if (auditFilterDateFrom || auditFilterDateTo) {
          auditLogsArray = auditLogsArray.filter(log => {
            if (!log.timestamp) return false;
            const logDate = new Date(log.timestamp);
            
            if (auditFilterDateFrom && auditFilterDateTo) {
              const startDate = new Date(auditFilterDateFrom);
              startDate.setHours(0, 0, 0, 0);
              const endDate = new Date(auditFilterDateTo);
              endDate.setHours(23, 59, 59, 999);
              return logDate >= startDate && logDate <= endDate;
            } else if (auditFilterDateFrom) {
              const startDate = new Date(auditFilterDateFrom);
              startDate.setHours(0, 0, 0, 0);
              return logDate >= startDate;
            } else if (auditFilterDateTo) {
              const endDate = new Date(auditFilterDateTo);
              endDate.setHours(23, 59, 59, 999);
              return logDate <= endDate;
            }
            return true;
          });
        }
      } else {
        const now = new Date();
        let startDate;
        
        if (auditFilterPeriod === 'last_month') {
          startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        } else if (auditFilterPeriod === 'last_3_months') {
          startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
        } else if (auditFilterPeriod === 'last_6_months') {
          startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
        } else if (auditFilterPeriod === 'last_year') {
          startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        }
        
        if (startDate) {
          auditLogsArray = auditLogsArray.filter(log => {
            if (!log.timestamp) return false;
            const logDate = new Date(log.timestamp);
            return logDate >= startDate;
          });
        }
      }
    }

    // Sort
    const toAuditValue = (item, field) => {
      switch (field) {
        case 'timestamp':
          return item.timestamp ? new Date(item.timestamp).getTime() : 0;
        case 'action':
          return (item.action || '').toString().toLowerCase();
        case 'severity':
          return (item.severity || '').toString().toLowerCase();
        case 'actor_profile_label':
          return (item.actor_profile_label || item.actor_profile_id || '').toString().toLowerCase();
        case 'ip_address':
          return (item.ip_address || '').toString().toLowerCase();
        default:
          return '';
      }
    };

    const copy = [...auditLogsArray];
    copy.sort((a, b) => {
      const aVal = toAuditValue(a, auditSortBy);
      const bVal = toAuditValue(b, auditSortBy);
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return auditSortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      const comparison = String(aVal).localeCompare(String(bVal));
      return auditSortDir === 'asc' ? comparison : -comparison;
    });

    return copy;
  }, [settings?.audit_logs, auditFilterPeriod, auditFilterDateFrom, auditFilterDateTo, auditFilterSeverity, auditFilterAction, auditSortBy, auditSortDir]);

  const handleAuditSort = (field) => {
    if (auditSortBy === field) {
      const newDir = auditSortDir === 'asc' ? 'desc' : 'asc';
      setAuditSortDir(newDir);
      setPreference('SettingsPage.auditSortDir', newDir);
    } else {
      setAuditSortBy(field);
      setAuditSortDir('desc');
      setPreference('SettingsPage.auditSortBy', field);
      setPreference('SettingsPage.auditSortDir', 'desc');
    }
  };

  const handleAuditFilterPeriodChange = (period) => {
    setAuditFilterPeriod(period);
    setPreference('SettingsPage.auditFilterPeriod', period);
    if (period !== 'custom') {
      setAuditFilterDateFrom('');
      setAuditFilterDateTo('');
      setPreference('SettingsPage.auditFilterDateFrom', '');
      setPreference('SettingsPage.auditFilterDateTo', '');
    }
  };

  const handleAuditDateFromChange = (date) => {
    setAuditFilterDateFrom(date);
    setPreference('SettingsPage.auditFilterDateFrom', date);
    if (date) {
      setAuditFilterPeriod('custom');
      setPreference('SettingsPage.auditFilterPeriod', 'custom');
    }
  };

  const handleAuditDateToChange = (date) => {
    setAuditFilterDateTo(date);
    setPreference('SettingsPage.auditFilterDateTo', date);
    if (date) {
      setAuditFilterPeriod('custom');
      setPreference('SettingsPage.auditFilterPeriod', 'custom');
    }
  };

  const handleAuditFilterSeverityChange = (severity) => {
    setAuditFilterSeverity(severity);
    setPreference('SettingsPage.auditFilterSeverity', severity);
  };

  const handleAuditFilterActionChange = (action) => {
    setAuditFilterAction(action);
    setPreference('SettingsPage.auditFilterAction', action);
  };

  // Audit log definitions based on audit_log.py
  const AUDIT_SEVERITIES = ['critical', 'warning', 'info'];
  const AUDIT_ACTION_SEVERITY_MAP = {
    'profile_changed_password': 'critical',
    'profile_reset_password_completed': 'critical',
    'profile_requested_password_reset': 'critical',
    'profile_deleted': 'critical',
    'event_deleted': 'warning',
    'image_deleted': 'warning',
    'profile_created': 'info',
    'event_created': 'info',
    'upload_made': 'info',
  };
  
  const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_SEVERITY_MAP);

  // Get filtered actions based on selected severity
  const filteredAuditActions = useMemo(() => {
    if (!auditFilterSeverity || auditFilterSeverity === 'all') {
      return AUDIT_ACTIONS;
    }
    return AUDIT_ACTIONS.filter(action => AUDIT_ACTION_SEVERITY_MAP[action] === auditFilterSeverity);
  }, [auditFilterSeverity]);

  // Reset action filter when severity changes if current action is not valid for new severity
  useEffect(() => {
    if (auditFilterAction && auditFilterAction !== 'all' && !filteredAuditActions.includes(auditFilterAction)) {
      setAuditFilterAction('all');
      setPreference('SettingsPage.auditFilterAction', 'all');
    }
  }, [auditFilterSeverity, auditFilterAction, filteredAuditActions]);

  // Audit log detail modal handlers
  const handleAuditLogRowClick = useCallback((log, index) => {
    const logsArray = filteredAndSortedAuditLogs;
    setAuditLogNavigation({
      currentIndex: index,
      logs: logsArray
    });
    setOpenAuditLogId(log.audit_log_id);
  }, [filteredAndSortedAuditLogs]);

  const handleAuditLogNavigate = useCallback((direction, targetIndex = null) => {
    setAuditLogNavigation(prev => {
      const logs = prev.logs || filteredAndSortedAuditLogs;
      let newIndex = prev.currentIndex;
      
      if (targetIndex !== null) {
        newIndex = targetIndex;
      } else if (direction === 'prev') {
        newIndex = newIndex === 0 ? logs.length - 1 : newIndex - 1;
      } else if (direction === 'next') {
        newIndex = newIndex === logs.length - 1 ? 0 : newIndex + 1;
      }
      
      const log = logs[newIndex];
      if (log) {
        setOpenAuditLogId(log.audit_log_id);
      }
      
      return {
        ...prev,
        currentIndex: newIndex,
        logs
      };
    });
  }, [filteredAndSortedAuditLogs]);

  const handleCloseAuditLogModal = useCallback(() => {
    setOpenAuditLogId(null);
  }, []);

  const columns = [
    {
      key: 'created_at',
      label: t('settings.date'),
      sortable: true,
      align: 'left',
      renderCell: (usage) => (
        <span className="text-gray-600">
          {usage.created_at ? formatDateTimeLocale(usage.created_at) : '-'}
        </span>
      ),
    },
    {
      key: 'event_label',
      label: t('settings.event'),
      sortable: true,
      align: 'left',
      renderCell: (usage) => (
        <div>
          <div className="font-medium text-gray-900">{usage.event_label || usage.event_id || '-'}</div>
          {usage.event_id && (
            <div className="text-xs text-gray-500">{usage.event_id}</div>
          )}
        </div>
      ),
    },
    {
      key: 'profile_label',
      label: t('settings.profile'),
      sortable: true,
      align: 'left',
      renderCell: (usage) => (
        <div>
          <div className="font-medium text-gray-900">{usage.profile_label || usage.profile_id || '-'}</div>
          {usage.profile_id && (
            <div className="text-xs text-gray-500">{usage.profile_id}</div>
          )}
        </div>
      ),
    },
    {
      key: 'calls_count',
      label: t('settings.calls'),
      sortable: true,
      align: 'right',
      renderCell: (usage) => (
        <span className="font-medium text-gray-900">
          {(usage.calls_count || 0).toLocaleString()}
        </span>
      ),
    },
  ];

  const errorColumns = [
    {
      key: 'created_at',
      label: t('settings.date'),
      sortable: true,
      align: 'left',
      renderCell: (error) => (
        <span className="text-gray-600">
          {error.created_at ? formatDateTimeLocale(error.created_at) : '-'}
        </span>
      ),
    },
    {
      key: 'error_type',
      label: t('settings.type'),
      sortable: true,
      align: 'left',
      renderCell: (error) => (
        <span className={`px-2 py-1 text-xs rounded-full ${
          error.error_type === 'DatabaseError' ? 'bg-red-100 text-red-700' :
          error.error_type === 'PolicyError' ? 'bg-orange-100 text-orange-700' :
          error.error_type === 'Forbidden' ? 'bg-yellow-100 text-yellow-700' :
          'bg-gray-100 text-gray-700'
        }`}>
          {error.error_type || '-'}
        </span>
      ),
    },
    {
      key: 'error_message',
      label: t('settings.message'),
      sortable: true,
      align: 'left',
      renderCell: (error) => (
        <span className="text-sm text-gray-900" title={error.error_message}>
          {error.error_message ? (error.error_message.length > 100 ? error.error_message.substring(0, 100) + '...' : error.error_message) : '-'}
        </span>
      ),
    },
    {
      key: 'request_path',
      label: t('settings.path'),
      sortable: true,
      align: 'left',
      renderCell: (error) => (
        <div>
          <div className="text-sm text-gray-900">{error.request_method || '-'} {error.request_path || '-'}</div>
          {error.feedback_id && (
            <div className="text-xs text-gray-500">Feedback #{error.feedback_id}</div>
          )}
        </div>
      ),
    },
  ];

  const auditLogColumns = [
    {
      key: 'timestamp',
      label: t('settings.date'),
      sortable: true,
      align: 'left',
      renderCell: (log) => (
        <span className="text-gray-600">
          {log.timestamp ? formatDateTimeLocale(log.timestamp) : '-'}
        </span>
      ),
    },
    {
      key: 'severity',
      label: t('settings.filterSeverity'),
      sortable: true,
      align: 'left',
      renderCell: (log) => (
        <span className={`px-2 py-1 text-xs rounded-full ${
          log.severity === 'critical' ? 'bg-red-100 text-red-700' :
          log.severity === 'warning' ? 'bg-orange-100 text-orange-700' :
          'bg-blue-100 text-blue-700'
        }`}>
          {log.severity || '-'}
        </span>
      ),
    },
    {
      key: 'action',
      label: t('settings.action'),
      sortable: true,
      align: 'left',
      renderCell: (log) => (
        <span className="text-sm font-medium text-gray-900">
          {log.action ? log.action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : '-'}
        </span>
      ),
    },
    {
      key: 'actor_profile_label',
      label: t('settings.actor'),
      sortable: true,
      align: 'left',
      renderCell: (log) => (
        <div>
          <div className="font-medium text-gray-900">{log.actor_profile_label || log.actor_profile_id || '-'}</div>
          {log.actor_profile_id && (
            <div className="text-xs text-gray-500">{log.actor_profile_id}</div>
          )}
        </div>
      ),
    },
    {
      key: 'ip_address',
      label: t('settings.ipAddress'),
      sortable: true,
      align: 'left',
      renderCell: (log) => (
        <span className="text-sm text-gray-600">{log.ip_address || '-'}</span>
      ),
    },
    {
      key: 'details',
      label: t('settings.details'),
      sortable: false,
      align: 'left',
      renderCell: (log) => (
        log.details && Object.keys(log.details).length > 0 ? (
          <span className="text-xs text-blue-600 font-medium">{t('settings.viewDetails')}</span>
        ) : (
          <span className="text-xs text-gray-400">-</span>
        )
      ),
    },
  ];

  // Get unique error types for filter
  const errorTypes = useMemo(() => {
    const errorsDict = settings?.errors || {};
    const errorsArray = Object.values(errorsDict);
    const types = [...new Set(errorsArray.map(e => e.error_type).filter(Boolean))];
    return types.sort();
  }, [settings?.errors]);

  // Error detail modal handlers
  const handleErrorRowClick = useCallback((error, index) => {
    const errorsArray = filteredAndSortedErrors;
    setErrorNavigation({
      currentIndex: index,
      errors: errorsArray
    });
    setOpenErrorId(error.error_id);
  }, [filteredAndSortedErrors]);

  const handleErrorNavigate = useCallback((direction, targetIndex = null) => {
    setErrorNavigation(prev => {
      const errors = prev.errors || filteredAndSortedErrors;
      let newIndex = prev.currentIndex;
      
      if (targetIndex !== null) {
        newIndex = targetIndex;
      } else if (direction === 'prev') {
        newIndex = newIndex === 0 ? errors.length - 1 : newIndex - 1;
      } else if (direction === 'next') {
        newIndex = newIndex === errors.length - 1 ? 0 : newIndex + 1;
      }
      
      const error = errors[newIndex];
      if (error) {
        setOpenErrorId(error.error_id);
      }
      
      return {
        ...prev,
        currentIndex: newIndex,
        errors
      };
    });
  }, [filteredAndSortedErrors]);

  const handleCloseErrorModal = useCallback(() => {
    setOpenErrorId(null);
  }, []);

  // Listen for global error:open-detail event (local handler for SettingsPage with navigation)
  useEffect(() => {
    const handler = (ev) => {
      const errorId = ev?.detail?.errorId;
      if (!errorId) return;
      
      // Try to find in filtered errors for navigation support
      const errorsArray = filteredAndSortedErrors;
      const index = errorsArray.findIndex(e => e.error_id === errorId);
      
      if (index >= 0) {
        // Found in filtered list - use local modal with navigation
        setErrorNavigation({
          currentIndex: index,
          errors: errorsArray
        });
        setOpenErrorId(errorId);
        // Stop event propagation so global handler doesn't also open modal
        ev.stopPropagation();
      }
      // If not found in filtered list, let the global handler in App.jsx handle it
    };
    window.addEventListener('error:open-detail', handler, true);
    return () => {
      window.removeEventListener('error:open-detail', handler, true);
    };
  }, [filteredAndSortedErrors]);

  return (
    <>
      <div dir={isRTL ? 'rtl' : 'ltr'} className="min-h-screen bg-gray-50 overflow-x-hidden">
        <TopNavigationBar variant="light" showBackground={true} mode="full" />
        <div className="h-[4rem]"></div>
        <div className="sticky top-[4rem] z-30 bg-white border-b border-gray-200 shadow-sm">
          <div className="w-full px-4 sm:px-8 py-2 sm:py-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-3 sm:mb-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-shrink-0">
                <Link
                  to="/dashboard"
                  className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                  title={t('settings.backToDashboard')}
                  aria-label={t('settings.backToDashboard')}
                >
                  {isRTL ? (
                    <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                  ) : (
                    <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                  )}
                </Link>
                <div className="w-8 h-8 sm:w-12 sm:h-12 bg-primary-100 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0">
                  <SettingsIcon className="w-4 h-4 sm:w-6 sm:h-6 text-primary-600" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-2xl font-bold text-gray-900 truncate">{t('settings.settings')}</h1>
                  <p className="text-xs sm:text-sm text-gray-500 truncate">{t('settings.manageSystemWideConfiguration')}</p>
                </div>
              </div>
              
              {/* Section Tabs */}
              <div className="flex items-center gap-1 sm:gap-2 bg-gray-100 rounded-lg p-0.5 sm:p-1 overflow-x-auto">
                <button
                  onClick={() => handleSectionChange('limits')}
                  className={`px-2 py-1.5 sm:px-4 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                    activeSection === 'limits'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {t('settings.limits')}
                </button>
                <button
                  onClick={() => handleSectionChange('usage')}
                  className={`px-2 py-1.5 sm:px-4 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                    activeSection === 'usage'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {t('settings.rekognitionUsage')}
                </button>
                <button
                  onClick={() => handleSectionChange('errors')}
                  className={`px-2 py-1.5 sm:px-4 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                    activeSection === 'errors'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {t('settings.errors')}
                </button>
                <button
                  onClick={() => handleSectionChange('audit')}
                  className={`px-2 py-1.5 sm:px-4 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                    activeSection === 'audit'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {t('settings.auditLogs')}
                </button>
              </div>
            </div>
          </div>

        {/* Content */}
        <div className="w-full px-4 sm:px-8 py-3 sm:py-6 overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-sm text-gray-500">{t('settings.loadingSettings')}</div>
              </div>
            ) : error && !settingsDraft ? (
              <div className="flex items-center gap-3 rounded-lg bg-red-50 p-4 text-red-800">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                <div className="text-sm">{error}</div>
              </div>
            ) : settingsDraft ? (
              <div className="space-y-6">
                {error && (
                  <div className="flex items-center gap-3 rounded-lg bg-red-50 p-4 text-red-800">
                    <AlertCircle className="h-5 w-5 flex-shrink-0" />
                    <div className="text-sm">{error}</div>
                  </div>
                )}

                {/* Limits Section */}
                {activeSection === 'limits' && (
                <form onSubmit={handleFormSubmit} className="rounded-lg bg-white border border-gray-200 p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <HardDrive className="h-5 w-5" />
                    {t('settings.limits')}
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        {t('settings.imageSizeLimitBytes')}
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={settingsDraft.image_size_limit_bytes ?? ''}
                        onChange={(e) => handleFieldChange('image_size_limit_bytes', e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                        placeholder="0"
                      />
                      {settingsDraft.image_size_limit_bytes > 0 && (
                        <p className="mt-1 text-xs text-gray-500">
                          {formatBytes(settingsDraft.image_size_limit_bytes)}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        {t('settings.imagesCountLimit')}
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={settingsDraft.images_count_limit ?? ''}
                        onChange={(e) => handleFieldChange('images_count_limit', e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        {t('settings.rekognitionCallsLimit')}
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={settingsDraft.rekognition_calls_limit ?? ''}
                        onChange={(e) => handleFieldChange('rekognition_calls_limit', e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        {t('settings.minimumRankToCreateEvent')}
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={settingsDraft.min_rank_to_create_event ?? ''}
                        onChange={(e) => handleFieldChange('min_rank_to_create_event', e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end gap-3">
                    {hasChanges() && (
                      <button
                        type="button"
                        onClick={handleCancel}
                        disabled={saving}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {t('settings.cancel')}
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={!canSave}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saving ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>{t('settings.saving')}</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          <span>{t('settings.save')}</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
                )}

                {/* Rekognition Usage Section */}
                {activeSection === 'usage' && (
                <div className="rounded-lg bg-white border border-gray-200 p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-3 mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <Activity className="h-5 w-5" />
                      {t('settings.rekognitionUsageTracking')}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      {/* Period Filter */}
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <select
                          value={filterPeriod}
                          onChange={(e) => handleFilterPeriodChange(e.target.value)}
                          className="text-xs sm:text-sm border border-gray-300 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="all">{t('settings.allTime')}</option>
                          <option value="last_month">{t('settings.lastMonth')}</option>
                          <option value="last_3_months">{t('settings.last3Months')}</option>
                          <option value="last_6_months">{t('settings.last6Months')}</option>
                          <option value="last_year">{t('settings.lastYear')}</option>
                          <option value="custom">{t('settings.customRange')}</option>
                        </select>
                      </div>
                      
                      {/* Custom Date Range */}
                      {filterPeriod === 'custom' && (
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            value={filterDateFrom}
                            onChange={(e) => handleDateFromChange(e.target.value)}
                            className="text-xs sm:text-sm border border-gray-300 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder={t('settings.from')}
                          />
                          <span className="text-gray-500">{t('settings.to')}</span>
                          <input
                            type="date"
                            value={filterDateTo}
                            onChange={(e) => handleDateToChange(e.target.value)}
                            className="text-xs sm:text-sm border border-gray-300 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder={t('settings.to')}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <ScrollableTable
                    style={{ maxHeight: 'calc(100vh - 20rem)' }}
                    columns={columns}
                    data={filteredAndSortedUsage}
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleSort}
                    emptyState={{
                      icon: Activity,
                      title: t('settings.noUsageData'),
                      message: filterPeriod !== 'all' || filterDateFrom || filterDateTo
                        ? t('settings.noUsageDataMatchesFilters')
                        : t('settings.noRekognitionUsageDataAvailable')
                    }}
                    getRowKey={(usage) => usage.usage_id || `usage-${usage.created_at}`}
                  />
                </div>
                )}

                {/* Errors Section */}
                {activeSection === 'errors' && (
                <div className="rounded-lg bg-white border border-gray-200 p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-3 mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5" />
                      {t('settings.errorLog')}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      {/* Error Type Filter */}
                      <select
                        value={errorFilterType}
                        onChange={(e) => handleErrorFilterTypeChange(e.target.value)}
                        className="text-xs sm:text-sm border border-gray-300 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="all">{t('settings.allTypes')}</option>
                        {errorTypes.map(type => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                      
                      {/* Period Filter */}
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <select
                          value={errorFilterPeriod}
                          onChange={(e) => handleErrorFilterPeriodChange(e.target.value)}
                          className="text-xs sm:text-sm border border-gray-300 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="all">{t('settings.allTime')}</option>
                          <option value="last_month">{t('settings.lastMonth')}</option>
                          <option value="last_3_months">{t('settings.last3Months')}</option>
                          <option value="last_6_months">{t('settings.last6Months')}</option>
                          <option value="last_year">{t('settings.lastYear')}</option>
                          <option value="custom">{t('settings.customRange')}</option>
                        </select>
                      </div>
                      
                      {/* Custom Date Range */}
                      {errorFilterPeriod === 'custom' && (
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            value={errorFilterDateFrom}
                            onChange={(e) => handleErrorDateFromChange(e.target.value)}
                            className="text-xs sm:text-sm border border-gray-300 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder={t('settings.from')}
                          />
                          <span className="text-gray-500">{t('settings.to')}</span>
                          <input
                            type="date"
                            value={errorFilterDateTo}
                            onChange={(e) => handleErrorDateToChange(e.target.value)}
                            className="text-xs sm:text-sm border border-gray-300 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder={t('settings.to')}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <ScrollableTable
                    style={{ maxHeight: 'calc(100vh - 20rem)' }}
                    columns={errorColumns}
                    data={filteredAndSortedErrors}
                    sortBy={errorSortBy}
                    sortDir={errorSortDir}
                    onSort={handleErrorSort}
                    onRowClick={handleErrorRowClick}
                    emptyState={{
                      icon: AlertTriangle,
                      title: t('settings.noErrors'),
                      message: errorFilterPeriod !== 'all' || errorFilterDateFrom || errorFilterDateTo || errorFilterType !== 'all'
                        ? t('settings.noErrorsMatchFilters')
                        : t('settings.noErrorsLoggedYet')
                    }}
                    getRowKey={(error) => error.error_id || `error-${error.created_at}`}
                  />
                </div>
                )}

                {/* Audit Logs Section */}
                {activeSection === 'audit' && (
                <div className="rounded-lg bg-white border border-gray-200 p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-3 mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <Activity className="h-5 w-5" />
                      {t('settings.auditLogs')}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      {/* Severity Filter */}
                      <select
                        value={auditFilterSeverity}
                        onChange={(e) => handleAuditFilterSeverityChange(e.target.value)}
                        className="text-xs sm:text-sm border border-gray-300 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="all">{t('settings.allSeverities')}</option>
                        {AUDIT_SEVERITIES.map(severity => (
                          <option key={severity} value={severity}>{severity.charAt(0).toUpperCase() + severity.slice(1)}</option>
                        ))}
                      </select>
                      
                      {/* Action Filter */}
                      <select
                        value={auditFilterAction}
                        onChange={(e) => handleAuditFilterActionChange(e.target.value)}
                        className="text-xs sm:text-sm border border-gray-300 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="all">{t('settings.allActions')}</option>
                        {filteredAuditActions.map(action => (
                          <option key={action} value={action}>{action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>
                        ))}
                      </select>
                      
                      {/* Period Filter */}
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <select
                          value={auditFilterPeriod}
                          onChange={(e) => handleAuditFilterPeriodChange(e.target.value)}
                          className="text-xs sm:text-sm border border-gray-300 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="all">{t('settings.allTime')}</option>
                          <option value="last_month">{t('settings.lastMonth')}</option>
                          <option value="last_3_months">{t('settings.last3Months')}</option>
                          <option value="last_6_months">{t('settings.last6Months')}</option>
                          <option value="last_year">{t('settings.lastYear')}</option>
                          <option value="custom">{t('settings.customRange')}</option>
                        </select>
                      </div>
                      
                      {/* Custom Date Range */}
                      {auditFilterPeriod === 'custom' && (
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            value={auditFilterDateFrom}
                            onChange={(e) => handleAuditDateFromChange(e.target.value)}
                            className="text-xs sm:text-sm border border-gray-300 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder={t('settings.from')}
                          />
                          <span className="text-gray-500">{t('settings.to')}</span>
                          <input
                            type="date"
                            value={auditFilterDateTo}
                            onChange={(e) => handleAuditDateToChange(e.target.value)}
                            className="text-xs sm:text-sm border border-gray-300 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder={t('settings.to')}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <ScrollableTable
                    style={{ maxHeight: 'calc(100vh - 20rem)' }}
                    columns={auditLogColumns}
                    data={filteredAndSortedAuditLogs}
                    sortBy={auditSortBy}
                    sortDir={auditSortDir}
                    onSort={handleAuditSort}
                    onRowClick={handleAuditLogRowClick}
                    emptyState={{
                      icon: Activity,
                      title: t('settings.noAuditLogs'),
                      message: auditFilterPeriod !== 'all' || auditFilterDateFrom || auditFilterDateTo || auditFilterSeverity !== 'all' || auditFilterAction !== 'all'
                        ? t('settings.noAuditLogsMatchFilters')
                        : t('settings.noAuditLogsAvailableYet')
                    }}
                    getRowKey={(log) => log.audit_log_id || `audit-${log.timestamp}`}
                  />
                </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {showLoginModal && (
        <LoginModal
          isOpen={showLoginModal}
          onClose={closeLoginModal}
          onLogin={login}
          error={loginError}
        />
      )}

      {/* Error Detail Modal */}
      <ErrorDetailModal
        isOpen={!!openErrorId}
        onClose={handleCloseErrorModal}
        errorId={openErrorId}
        onNavigate={handleErrorNavigate}
        currentIndex={errorNavigation.currentIndex}
        totalErrors={errorNavigation.errors?.length || 0}
        filteredErrors={errorNavigation.errors || []}
      />

      {/* Audit Log Detail Modal */}
      <AuditLogDetailModal
        isOpen={!!openAuditLogId}
        onClose={handleCloseAuditLogModal}
        auditLogId={openAuditLogId}
        onNavigate={handleAuditLogNavigate}
        currentIndex={auditLogNavigation.currentIndex}
        totalLogs={auditLogNavigation.logs?.length || 0}
        filteredLogs={auditLogNavigation.logs || []}
      />
    </>
  );
}

