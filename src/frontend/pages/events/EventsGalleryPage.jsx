import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Calendar, Eye, Edit2, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import { eventsAPI, profilesAPI } from '../../utils/apiService';
import { getPreference, setPreference } from '../../utils/settings';
import { formatErrorMessage } from '../../utils/errorHandler';
import EditEventModal from '../../components/events/EditEventModal';
import { usePermissions } from '../../hooks/usePermissions';
import { getCurrentProfile } from '../../utils/profileService';
import { ConfirmDelete } from '../../components/modals';
import { useEventsGeneralList, useDataStore } from '../../utils/dataManager';
import { useApplyScopes } from '../../utils/storeUtils';
import { TopNavigationBar } from '../../components/layout';
import { useAuth } from '../../contexts/authContext';
import { LoginModal } from '../../components/auth';
import { useAuthRefresh } from '../../hooks/useAuthRefresh';
import { ScrollableTable } from '../../components/common';
import { APP_CONFIG } from '../../config/appConfig';
import { formatDate } from '../../utils/dateUtils';
import { useRTL } from '../../hooks/useRTL';
import i18n from '../../i18n';

function toNumber(value) {
  const numeric = Number(value);
  return Number.isNaN(numeric) ? 0 : numeric;
}

export default function EventsGalleryPage() {
  const { isAuthenticated, isLoading, showLoginModal, loginError, login, closeLoginModal, openLoginModal } = useAuth();
  const { showToast } = useToast();
  const { canCreateEvents } = usePermissions();
  const { t } = useTranslation();
  const { isRTL, startClass, endClass } = useRTL();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profileVersion, setProfileVersion] = useState(0);
  const [modalState, setModalState] = useState({
    isOpen: false,
    mode: 'edit',
    eventUrl: null,
  });
  const [eventToDelete, setEventToDelete] = useState(null);

  const [sortBy, setSortBy] = useState(() => getPreference('EventsGallery.sortBy', 'date'));
  const [sortDir, setSortDir] = useState(() => getPreference('EventsGallery.sortDir', 'desc'));
  const [filterVisibility, setFilterVisibility] = useState(() =>
    getPreference('EventsGallery.filterVisibility', 'all')
  );

  // Set document title
  useEffect(() => {
    document.title = `${t('eventsGallery.events')} | ${APP_CONFIG.name}`;
  }, [i18n.language]);

  // Auto-show login modal when not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      openLoginModal();
    }
  }, [isAuthenticated, isLoading, openLoginModal]);

  useApplyScopes([{ entity: 'all', id: 'events', eventId: 'general' }]);

  const applyChanges = useDataStore((state) => state.applyChanges);
  const eventsFromStore = useEventsGeneralList();
  const hasFetchedRef = useRef(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError('');
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

      const afterState = useDataStore.getState();
      const storedEvents = afterState.entities?.general?.events || {};
    } catch (err) {
      const message = formatErrorMessage('load events', err);
      console.error('Failed to load events:', err);
      setError(message);
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [applyChanges, showToast]);

  useAuthRefresh(fetchEvents, []);

  // Create placeholder events when not authenticated
  const placeholderEvents = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => ({
      event_id: `placeholder-${i}`,
      name: '',
      url: '',
      date: null,
      is_public: false,
      images_count: 0,
      faces_count: 0,
      albums_count: 0,
      moments_count: 0,
      isPlaceholder: true
    }));
  }, []);

  const currentProfile = useMemo(() => getCurrentProfile(), [profileVersion]);
  const profileEvents = currentProfile?.events || {};

  const editableEventIds = useMemo(() => {
    if (!isAuthenticated) return new Set();
    return new Set(
      Object.entries(profileEvents)
        .filter(([, perms]) => perms && Boolean(perms.can_manage_event))
        .map(([id]) => String(id))
    );
  }, [profileEvents, isAuthenticated]);

  const deletableEventIds = useMemo(() => {
    if (!isAuthenticated) return new Set();
    return new Set(
      Object.entries(profileEvents)
        .filter(([, perms]) => perms && Boolean(perms.can_delete_event))
        .map(([id]) => String(id))
    );
  }, [profileEvents, isAuthenticated]);

  const editableEventsCount = editableEventIds.size;
  const hasEditableEvents = editableEventsCount > 0;

  const eventsArray = useMemo(() => {
    return (eventsFromStore || []).map((evt) => {
      const eventId = evt?.event_id || evt?.id || evt?.eventId;
      return {
        ...evt,
        event_id: eventId,
      };
    });
  }, [eventsFromStore]);

  // Use events from store or placeholders when not authenticated
  const currentEvents = isAuthenticated ? eventsArray : placeholderEvents;

  const manageableEvents = useMemo(() => {
    if (!isAuthenticated) return placeholderEvents;
    return eventsArray.filter((evt) => editableEventIds.has(String(evt.event_id)));
  }, [eventsArray, editableEventIds, isAuthenticated, placeholderEvents]);

  const filteredEvents = useMemo(() => {
    if (filterVisibility === 'public') {
      return manageableEvents.filter((evt) => Boolean(evt.is_public));
    }
    if (filterVisibility === 'private') {
      return manageableEvents.filter((evt) => !Boolean(evt.is_public));
    }
    return manageableEvents;
  }, [manageableEvents, filterVisibility]);

  const stats = useMemo(() => {
    const total = manageableEvents.length;
    const publicCount = manageableEvents.filter((evt) => Boolean(evt.is_public)).length;
    const privateCount = total - publicCount;
    return { total, public: publicCount, private: privateCount };
  }, [manageableEvents]);

  const sortedEvents = useMemo(() => {
    if (!isAuthenticated) return filteredEvents;

    const dir = sortDir === 'asc' ? 1 : -1;
    const getValue = (evt) => {
      switch (sortBy) {
        case 'date':
          return evt.date ? new Date(evt.date).getTime() : 0;
        case 'name':
          return (evt.name || '').toLowerCase();
        case 'url':
          return (evt.url || '').toLowerCase();
        case 'is_public':
          return Boolean(evt.is_public) ? 1 : 0;
        case 'images_count':
          return toNumber(evt.images_count);
        case 'faces_count':
          return toNumber(evt.faces_count);
        case 'albums_count':
          return toNumber(evt.albums_count);
        case 'moments_count':
          return toNumber(evt.moments_count);
        case 'total_size':
          return toNumber(evt.total_size);
        default:
          return evt[sortBy] ?? '';
      }
    };

    return [...filteredEvents].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [filteredEvents, sortBy, sortDir, isAuthenticated]);

  const handleSort = useCallback(
    (field) => {
      if (sortBy === field) {
        const nextDir = sortDir === 'asc' ? 'desc' : 'asc';
        setSortDir(nextDir);
        setPreference('EventsGallery.sortDir', nextDir);
      } else {
        setSortBy(field);
        setPreference('EventsGallery.sortBy', field);
      }
    },
    [sortBy, sortDir]
  );


  const handleFilterChange = useCallback((value) => {
    setFilterVisibility(value);
    setPreference('EventsGallery.filterVisibility', value);
  }, []);

  const openEditModal = useCallback((eventUrl) => {
    if (!eventUrl) return;
    setModalState({
      isOpen: true,
      mode: 'edit',
      eventUrl,
    });
  }, []);

  const openCreateModal = useCallback(() => {
    setModalState({
      isOpen: true,
      mode: 'create',
      eventUrl: null,
    });
  }, []);

  const closeModal = useCallback(() => {
    setModalState((prev) => ({
      ...prev,
      isOpen: false,
    }));
  }, []);

  const handleModalSuccess = useCallback(async ({ mode }) => {
    if (mode === 'create') {
      try {
        await profilesAPI.getCurrentProfile();
        setProfileVersion((prev) => prev + 1);
      } catch (err) {
        console.error('Failed to refresh profile after event change:', err);
      }
    }
  }, []);

  const handleRequestDelete = useCallback((event) => {
    if (!event) return;
    setEventToDelete(event);
  }, []);

  const handleCancelDelete = useCallback(() => {
    setEventToDelete(null);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!eventToDelete?.url) return;
    try {
      await eventsAPI.delete(eventToDelete.url);
      showToast(t('eventsGallery.eventDeleted'), 'success');
      try {
        await profilesAPI.getCurrentProfile();
        setProfileVersion((prev) => prev + 1);
      } catch (err) {
        console.error('Failed to refresh profile after deleting event:', err);
      }
      setEventToDelete(null);
    } catch (err) {
      console.error('Failed to delete event:', err);
      showToast(formatErrorMessage('delete event', err), 'error');
    }
  }, [eventToDelete, showToast]);

  const modalEventUrl = modalState.mode === 'edit' ? modalState.eventUrl : null;

  return (
    <>
      <div className="min-h-screen bg-gray-50" dir={isRTL ? 'rtl' : 'ltr'}>
        <TopNavigationBar variant="light" showBackground={true} mode="full" />
        <div className="bg-white border-b border-gray-200 pt-[4rem]">
          <div className="w-full px-8 py-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Calendar className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{t('eventsGallery.eventManagement')}</h1>
                  <p className="text-sm text-gray-500">
                    {isAuthenticated
                      ? hasEditableEvents
                        ? `${stats.total} ${stats.total === 1 ? t('eventsGallery.manageableEvent') : t('eventsGallery.manageableEvents')}`
                        : t('eventsGallery.noEventsWithEditAccess')
                      : t('eventsGallery.loading')}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleFilterChange('all')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filterVisibility === 'all'
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {t('eventsGallery.all')} ({stats.total})
                </button>
                <button
                  onClick={() => handleFilterChange('public')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filterVisibility === 'public'
                      ? 'bg-green-100 text-green-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {t('eventsGallery.public')} ({stats.public})
                </button>
                <button
                  onClick={() => handleFilterChange('private')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filterVisibility === 'private'
                      ? 'bg-amber-100 text-amber-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {t('eventsGallery.private')} ({stats.private})
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="w-full px-8 py-8">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {loading && isAuthenticated ? (
            <div className="flex items-center justify-center py-16 text-gray-500">
              <div className={`h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent ${isRTL ? 'ml-3' : 'mr-3'}`} />
              {t('eventsGallery.loadingEvents')}
            </div>
          ) : sortedEvents.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12"
            >
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">{t('eventsGallery.noManageableEvents')}</h3>
              <p className="text-gray-500">
                {hasEditableEvents
                  ? t('eventsGallery.tryAdjustingFilters')
                  : t('eventsGallery.noEditAccess')}
              </p>
            </motion.div>
          ) : (
            <ScrollableTable
              style={{ maxHeight: 'calc(100vh - 22rem)' }}
              columns={[
                {
                  key: 'name',
                  label: t('eventsGallery.name'),
                  sortable: true,
                  align: 'left',
                  cellClassName: 'text-gray-900 font-medium',
                  renderCell: (event) => event.name || t('eventsGallery.untitledEvent'),
                },
                {
                  key: 'url',
                  label: t('eventsGallery.url'),
                  sortable: true,
                  align: 'left',
                  cellClassName: 'text-gray-600',
                  renderCell: (event) =>
                    event.url ? (
                      <span className="font-mono text-xs text-blue-600">{event.url}</span>
                    ) : (
                      <span className="text-gray-400 italic text-xs">—</span>
                    ),
                },
                {
                  key: 'date',
                  label: t('eventsGallery.date'),
                  sortable: true,
                  align: 'left',
                  cellClassName: 'text-gray-700',
                  renderCell: (event) => formatDate(event.date),
                },
                {
                  key: 'is_public',
                  label: t('eventsGallery.visibility'),
                  sortable: true,
                  align: 'left',
                  renderCell: (event) => (
                    <span
                      className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                        event.is_public
                          ? 'bg-green-100 text-green-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {event.is_public ? t('eventsGallery.public') : t('eventsGallery.private')}
                    </span>
                  ),
                },
                {
                  key: 'images_count',
                  label: t('eventsGallery.photos'),
                  sortable: true,
                  align: 'center',
                  cellClassName: 'text-gray-700',
                  renderCell: (event) => toNumber(event.images_count),
                },
                {
                  key: 'faces_count',
                  label: t('eventsGallery.faces'),
                  sortable: true,
                  align: 'center',
                  cellClassName: 'text-gray-700',
                  renderCell: (event) => toNumber(event.faces_count),
                },
                {
                  key: 'albums_count',
                  label: t('eventsGallery.albums'),
                  sortable: true,
                  align: 'center',
                  cellClassName: 'text-gray-700',
                  renderCell: (event) => toNumber(event.albums_count),
                },
                {
                  key: 'moments_count',
                  label: t('eventsGallery.moments'),
                  sortable: true,
                  align: 'center',
                  cellClassName: 'text-gray-700',
                  renderCell: (event) => toNumber(event.moments_count),
                },
                {
                  key: 'total_size',
                  label: t('eventsGallery.totalSize'),
                  sortable: true,
                  align: 'center',
                  cellClassName: 'text-gray-700',
                  renderCell: (event) =>
                    event.total_size != null
                      ? `${(event.total_size / (1024 * 1024)).toFixed(2)} MB`
                      : '—',
                },
                {
                  key: 'actions',
                  label: t('eventsGallery.actions'),
                  align: 'right',
                  renderCell: (event) => (
                    <div className="flex items-center justify-end gap-2">
                      {event.isPlaceholder ? (
                        <>
                          <span
                            className="p-2 rounded-lg text-gray-300 cursor-not-allowed"
                            title={t('eventsGallery.pleaseLogInToView')}
                            aria-label={t('eventsGallery.pleaseLogInToView')}
                          >
                            <Eye className="w-4 h-4" />
                          </span>
                          <span
                            className="p-2 rounded-lg text-gray-300 cursor-not-allowed"
                            title={t('eventsGallery.pleaseLogInToEdit')}
                            aria-label={t('eventsGallery.pleaseLogInToEdit')}
                          >
                            <Edit2 className="w-4 h-4" />
                          </span>
                        </>
                      ) : (
                        <>
                          {event.url ? (
                            <Link
                              to={`/${event.url}`}
                              className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                              title={t('eventsGallery.openEvent')}
                              aria-label={t('eventsGallery.openEvent')}
                            >
                              <Eye className="w-4 h-4 text-blue-600" />
                            </Link>
                          ) : (
                            <span
                              className="p-2 rounded-lg text-gray-300 cursor-not-allowed"
                              title={t('eventsGallery.eventUrlNotAvailable')}
                              aria-label={t('eventsGallery.eventUrlNotAvailable')}
                            >
                              <Eye className="w-4 h-4" />
                            </span>
                          )}
                          <button
                            onClick={() => openEditModal(event.url)}
                            className="p-2 hover:bg-indigo-100 rounded-lg transition-colors"
                            title={t('eventsGallery.editSettings')}
                            aria-label={t('eventsGallery.editSettings')}
                          >
                            <Edit2 className="w-4 h-4 text-indigo-600" />
                          </button>
                          {deletableEventIds.has(String(event.event_id)) && (
                            <button
                              onClick={() => handleRequestDelete(event)}
                              className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                              title={t('eventsGallery.deleteEvent')}
                              aria-label={t('eventsGallery.deleteEvent')}
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  ),
                },
              ]}
              data={sortedEvents}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={handleSort}
              emptyState={{
                icon: Calendar,
                title: t('eventsGallery.noManageableEvents'),
                message: hasEditableEvents
                  ? t('eventsGallery.tryAdjustingFilters')
                  : t('eventsGallery.noEditAccess'),
              }}
              getRowKey={(event) => event.event_id}
            />
          )}
        </div>
      </div>

      {modalState.isOpen && (
        <EditEventModal
          eventUrl={modalEventUrl}
          isOpen={modalState.isOpen}
          mode={modalState.mode}
          onClose={closeModal}
          onSuccess={handleModalSuccess}
          onToast={showToast}
        />
      )}

      {eventToDelete && (() => {
        const displayLabel = (eventToDelete.name || eventToDelete.url || '').trim();
        const message = displayLabel
          ? t('eventsGallery.deleteEventConfirm', { label: displayLabel })
          : t('eventsGallery.deleteEventConfirmNoLabel');
        return (
          <ConfirmDelete
            isOpen={!!eventToDelete}
            onClose={handleCancelDelete}
            onConfirm={handleConfirmDelete}
            title={t('eventsGallery.deleteEventTitle')}
            message={message}
            confirmText={t('eventsGallery.delete')}
            cancelText={t('account.cancel')}
            caption={t('eventsGallery.deleteEventCaption')}
            simpleMessage={true}
          />
        );
      })()}

      {canCreateEvents && isAuthenticated && (
        <div className={`fixed bottom-8 z-40 ${endClass('8')}`}>
          <motion.button
            onClick={openCreateModal}
            className="w-16 h-16 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 hover:from-blue-600 hover:via-indigo-600 hover:to-purple-700 text-white rounded-full shadow-lg hover:shadow-2xl transition-all duration-200 flex items-center justify-center"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title={t('eventsGallery.createNewEvent')}
            aria-label={t('eventsGallery.createNewEvent')}
          >
            <Plus className="w-8 h-8" />
          </motion.button>
        </div>
      )}

      {/* Login Modal */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={closeLoginModal}
        onLogin={login}
        error={loginError}
      />
    </>
  );
}


