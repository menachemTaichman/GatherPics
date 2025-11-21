import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Settings as SettingsIcon, AlertCircle, HardDrive, Activity, Save, Calendar } from 'lucide-react';
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

function formatDateTime(dateString) {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return dateString;
  }
}

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
  
  const [settings, setSettings] = useState(null);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  
  // Active section (limits or usage)
  const [activeSection, setActiveSection] = useState(() => getPreference('SettingsPage.activeSection', 'limits'));
  
  // Filters
  const [filterPeriod, setFilterPeriod] = useState(() => getPreference('SettingsPage.filterPeriod', 'all'));
  const [filterDateFrom, setFilterDateFrom] = useState(() => getPreference('SettingsPage.filterDateFrom', ''));
  const [filterDateTo, setFilterDateTo] = useState(() => getPreference('SettingsPage.filterDateTo', ''));
  const [sortBy, setSortBy] = useState(() => getPreference('SettingsPage.sortBy', 'created_at'));
  const [sortDir, setSortDir] = useState(() => getPreference('SettingsPage.sortDir', 'desc'));
  
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
    document.title = `Settings | ${APP_CONFIG.name}`;
  }, []);

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
      const errorMessage = formatErrorMessage(err, 'Failed to load settings');
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
      showToast('Settings saved successfully', 'success');
      
      // Smoothly update state instead of reloading (preserve rekognition_usage)
      setSettings((prev) => ({
        ...prev,
        ...updatedSettings,
        rekognition_usage: prev?.rekognition_usage || updatedSettings.rekognition_usage,
      }));
      setSettingsDraft({
        image_size_limit_bytes: updatedSettings.image_size_limit_bytes ?? 0,
        images_count_limit: updatedSettings.images_count_limit ?? 0,
        rekognition_calls_limit: updatedSettings.rekognition_calls_limit ?? 0,
        min_rank_to_create_event: updatedSettings.min_rank_to_create_event ?? 0,
      });
    } catch (err) {
      const errorMessage = formatErrorMessage(err, 'Failed to save settings');
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
      setPreference('SettingsPage.sortDir', newDir);
    } else {
      setSortBy(field);
      setSortDir('desc');
      setPreference('SettingsPage.sortBy', field);
      setPreference('SettingsPage.sortDir', 'desc');
    }
  };

  const handleFilterPeriodChange = (period) => {
    setFilterPeriod(period);
    setPreference('SettingsPage.filterPeriod', period);
    if (period !== 'custom') {
      setFilterDateFrom('');
      setFilterDateTo('');
      setPreference('SettingsPage.filterDateFrom', '');
      setPreference('SettingsPage.filterDateTo', '');
    }
  };

  const handleDateFromChange = (date) => {
    setFilterDateFrom(date);
    setPreference('SettingsPage.filterDateFrom', date);
    if (date) {
      setFilterPeriod('custom');
      setPreference('SettingsPage.filterPeriod', 'custom');
    }
  };

  const handleDateToChange = (date) => {
    setFilterDateTo(date);
    setPreference('SettingsPage.filterDateTo', date);
    if (date) {
      setFilterPeriod('custom');
      setPreference('SettingsPage.filterPeriod', 'custom');
    }
  };

  const handleSectionChange = (section) => {
    setActiveSection(section);
    setPreference('SettingsPage.activeSection', section);
  };

  const columns = [
    {
      key: 'created_at',
      label: 'Date',
      sortable: true,
      align: 'left',
      renderCell: (usage) => (
        <span className="text-gray-600">
          {usage.created_at ? formatDateTime(usage.created_at) : '-'}
        </span>
      ),
    },
    {
      key: 'event_label',
      label: 'Event',
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
      label: 'Profile',
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
      label: 'Calls',
      sortable: true,
      align: 'right',
      renderCell: (usage) => (
        <span className="font-medium text-gray-900">
          {(usage.calls_count || 0).toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
        <TopNavigationBar variant="light" showBackground={true} mode="full" />
        
        {/* Page Header */}
        <div className="bg-white border-b border-gray-200 pt-[4rem] flex-none z-30">
          <div className="w-full px-8 py-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
                  <SettingsIcon className="w-6 h-6 text-primary-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
                  <p className="text-sm text-gray-500">Manage system-wide configuration</p>
                </div>
              </div>
              
              {/* Section Tabs */}
              <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => handleSectionChange('limits')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeSection === 'limits'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Limits
                </button>
                <button
                  onClick={() => handleSectionChange('usage')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeSection === 'usage'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Usage Tracking
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="w-full px-8 py-8">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-sm text-gray-500">Loading settings...</div>
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
                    Limits
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Image Size Limit (bytes)
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
                        Images Count Limit
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
                        Rekognition Calls Limit
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
                        Minimum Rank to Create Event
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
                        Cancel
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={!canSave}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saving ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          <span>Save</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
                )}

                {/* Rekognition Usage Section */}
                {activeSection === 'usage' && (
                <div className="rounded-lg bg-white border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <Activity className="h-5 w-5" />
                      Rekognition Usage Tracking
                    </h3>
                    <div className="flex items-center gap-3">
                      {/* Period Filter */}
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <select
                          value={filterPeriod}
                          onChange={(e) => handleFilterPeriodChange(e.target.value)}
                          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="all">All Time</option>
                          <option value="last_month">Last Month</option>
                          <option value="last_3_months">Last 3 Months</option>
                          <option value="last_6_months">Last 6 Months</option>
                          <option value="last_year">Last Year</option>
                          <option value="custom">Custom Range</option>
                        </select>
                      </div>
                      
                      {/* Custom Date Range */}
                      {filterPeriod === 'custom' && (
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            value={filterDateFrom}
                            onChange={(e) => handleDateFromChange(e.target.value)}
                            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="From"
                          />
                          <span className="text-gray-500">to</span>
                          <input
                            type="date"
                            value={filterDateTo}
                            onChange={(e) => handleDateToChange(e.target.value)}
                            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="To"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <ScrollableTable
                    columns={columns}
                    data={filteredAndSortedUsage}
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleSort}
                    emptyState={{
                      icon: Activity,
                      title: 'No usage data',
                      message: filterPeriod !== 'all' || filterDateFrom || filterDateTo
                        ? 'No usage data matches the current filters'
                        : 'No rekognition usage data available yet'
                    }}
                    getRowKey={(usage) => usage.usage_id || `usage-${usage.created_at}`}
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
    </>
  );
}

