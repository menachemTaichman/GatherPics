import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Calendar, Eye, Edit2, ArrowUp, ArrowDown, Plus, Trash2 } from 'lucide-react';
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
import Header from '../../components/layout/Header';

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'N/A';
  }
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isNaN(numeric) ? 0 : numeric;
}

export default function EventsGalleryPage() {
  const { showToast } = useToast();
  const { canCreateEvents } = usePermissions();

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

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    fetchEvents();
  }, [fetchEvents]);

  const currentProfile = useMemo(() => getCurrentProfile(), [profileVersion]);
  const profileEvents = currentProfile?.events || {};

  const editableEventIds = useMemo(() => {
    return new Set(
      Object.entries(profileEvents)
        .filter(([, perms]) => perms && (perms.can_manage_event === 1 || perms.can_manage_event === true))
        .map(([id]) => String(id))
    );
  }, [profileEvents]);

  const deletableEventIds = useMemo(() => {
    return new Set(
      Object.entries(profileEvents)
        .filter(([, perms]) => perms && (perms.can_delete_event === 1 || perms.can_delete_event === true))
        .map(([id]) => String(id))
    );
  }, [profileEvents]);

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

  const manageableEvents = useMemo(() => {
    return eventsArray.filter((evt) => editableEventIds.has(String(evt.event_id)));
  }, [eventsArray, editableEventIds]);

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
          return evt.is_public ? 1 : 0;
        case 'images_count':
          return toNumber(evt.images_count);
        case 'faces_count':
          return toNumber(evt.faces_count);
        case 'albums_count':
          return toNumber(evt.albums_count);
        case 'moments_count':
          return toNumber(evt.moments_count);
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
  }, [filteredEvents, sortBy, sortDir]);

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

  const getSortIcon = useCallback(
    (field) => {
      if (sortBy !== field) return null;
      return sortDir === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />;
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
      showToast('Event deleted', 'success');
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
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="bg-white border-b border-gray-200">
          <div className="w-full px-8 py-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Calendar className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Event Management</h1>
                  <p className="text-sm text-gray-500">
                    {hasEditableEvents
                      ? `${stats.total} manageable event${stats.total === 1 ? '' : 's'}`
                      : 'No events with edit access yet'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleFilterChange('all')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filterVisibility === 'all'
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  All ({stats.total})
                </button>
                <button
                  onClick={() => handleFilterChange('public')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filterVisibility === 'public'
                      ? 'bg-green-100 text-green-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Public ({stats.public})
                </button>
                <button
                  onClick={() => handleFilterChange('private')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filterVisibility === 'private'
                      ? 'bg-amber-100 text-amber-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Private ({stats.private})
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

          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-500">
              <div className="mr-3 h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
              Loading events...
            </div>
          ) : sortedEvents.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12"
            >
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No manageable events</h3>
              <p className="text-gray-500">
                {hasEditableEvents
                  ? 'Try adjusting filters or sorting options.'
                  : 'You do not have edit access to any events yet.'}
              </p>
            </motion.div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th
                        onClick={() => handleSort('name')}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-50"
                      >
                        <div className="flex items-center space-x-1">
                          <span>Name</span>
                          {getSortIcon('name')}
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('url')}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-50"
                      >
                        <div className="flex items-center space-x-1">
                          <span>URL</span>
                          {getSortIcon('url')}
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('date')}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-50"
                      >
                        <div className="flex items-center space-x-1">
                          <span>Date</span>
                          {getSortIcon('date')}
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('is_public')}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-50"
                      >
                        <div className="flex items-center space-x-1">
                          <span>Visibility</span>
                          {getSortIcon('is_public')}
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('images_count')}
                        className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-50"
                      >
                        <div className="flex items-center justify-center space-x-1">
                          <span>Photos</span>
                          {getSortIcon('images_count')}
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('faces_count')}
                        className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-50"
                      >
                        <div className="flex items-center justify-center space-x-1">
                          <span>Faces</span>
                          {getSortIcon('faces_count')}
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('albums_count')}
                        className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-50"
                      >
                        <div className="flex items-center justify-center space-x-1">
                          <span>Albums</span>
                          {getSortIcon('albums_count')}
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('moments_count')}
                        className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-50"
                      >
                        <div className="flex items-center justify-center space-x-1">
                          <span>Moments</span>
                          {getSortIcon('moments_count')}
                        </div>
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-600 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {sortedEvents.map((event) => (
                      <tr key={event.event_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900 font-medium">
                          {event.name || 'Untitled Event'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {event.url ? (
                            <span className="font-mono text-xs text-blue-600">{event.url}</span>
                          ) : (
                            <span className="text-gray-400 italic text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {formatDate(event.date)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span
                            className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                              event.is_public
                                ? 'bg-green-100 text-green-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {event.is_public ? 'Public' : 'Private'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 text-center">
                          {toNumber(event.images_count)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 text-center">
                          {toNumber(event.faces_count)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 text-center">
                          {toNumber(event.albums_count)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 text-center">
                          {toNumber(event.moments_count)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right">
                          <div className="flex items-center justify-end space-x-2">
                            {event.url ? (
                              <Link
                                to={`/${event.url}`}
                                className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                title="Open event"
                              >
                                <Eye className="w-4 h-4 text-blue-600" />
                              </Link>
                            ) : (
                              <span
                                className="p-2 rounded-lg text-gray-300 cursor-not-allowed"
                                title="Event URL not available"
                              >
                                <Eye className="w-4 h-4" />
                              </span>
                            )}
                            <button
                              onClick={() => openEditModal(event.url)}
                              className="p-2 hover:bg-indigo-100 rounded-lg transition-colors"
                              title="Edit settings"
                            >
                              <Edit2 className="w-4 h-4 text-indigo-600" />
                            </button>
                            {deletableEventIds.has(String(event.event_id)) && (
                              <button
                                onClick={() => handleRequestDelete(event)}
                                className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                title="Delete event"
                              >
                                <Trash2 className="w-4 h-4 text-red-600" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
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
          ? `Are you sure you want to delete “${displayLabel}”?`
          : 'Are you sure you want to delete this event?';
        return (
          <ConfirmDelete
            isOpen={!!eventToDelete}
            onClose={handleCancelDelete}
            onConfirm={handleConfirmDelete}
            title="Delete Event"
            message={message}
            confirmText="Delete"
            cancelText="Cancel"
            caption="This action cannot be undone. All event data will be permanently removed."
            simpleMessage={true}
          />
        );
      })()}

      {canCreateEvents && (
        <div className="fixed bottom-8 right-8 z-40">
          <motion.button
            onClick={openCreateModal}
            className="w-16 h-16 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 hover:from-blue-600 hover:via-indigo-600 hover:to-purple-700 text-white rounded-full shadow-lg hover:shadow-2xl transition-all duration-200 flex items-center justify-center"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title="Create new event"
          >
            <Plus className="w-8 h-8" />
          </motion.button>
        </div>
      )}
    </>
  );
}


