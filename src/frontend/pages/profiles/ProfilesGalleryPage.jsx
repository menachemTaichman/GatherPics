import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Trash2, Plus, Link as LinkIcon, RotateCcw, Minus, ChevronDown, Calendar, Copy, X, ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
import { useToast } from '../../contexts/ToastContext';
import { profilesAPI, eventsAPI, getEventUrlById } from '../../utils/apiService';
import { formatErrorMessage, getErrorExplanation } from '../../utils/errorHandler';
import { getPreference, setPreference } from '../../utils/settings';
import { EditProfileModal } from '../../components/profiles';
import { ConfirmDelete } from '../../components/modals';
import { usePermissions } from '../../hooks/usePermissions';
import { getCurrentProfile } from '../../utils/profileService';
import { useEventProfilesList, useProfilesList, useDataStore, useEventsGeneralList } from '../../utils/dataManager';
import { useApplyScopes, useEventId, getEventUrlFromId } from '../../utils/storeUtils';
import { TopNavigationBar } from '../../components/layout';
import { useAuth } from '../../contexts/authContext';
import { LoginModal } from '../../components/auth';
import { useAuthRefresh } from '../../hooks/useAuthRefresh';
import { useParams, Link } from 'react-router-dom';
import { useEventUrls } from '../../hooks/useEventUrls';
import { ScrollableTable } from '../../components/common';
import { APP_CONFIG } from '../../config/appConfig';
import i18n from '../../i18n';

const FILTER_ALL_EVENTS = 'dashboard';

export default function ProfilesGalleryPage() {
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  const params = useParams();
  const eventUrl = params.eventUrl || null;
  const { urlHelpers } = eventUrl ? useEventUrls(eventUrl) : { urlHelpers: null };
  const { isAuthenticated, isLoading, showLoginModal, loginError, login, closeLoginModal, openLoginModal } = useAuth();
  const { showToast } = useToast();
  const permissions = usePermissions(eventUrl);
  const eventId = useEventId(eventUrl);

  const [loading, setLoading] = useState(true);
  
  // Reset loading state when authenticated status changes
  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
    }
  }, [isAuthenticated]);
  const [error, setError] = useState('');
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [showRemoveFromEventModal, setShowRemoveFromEventModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [profileToDelete, setProfileToDelete] = useState(null);
  const [profileToRemoveFromEvent, setProfileToRemoveFromEvent] = useState(null);
  const [isCreatingNewProfile, setIsCreatingNewProfile] = useState(false);
  const [publicAccessCodes, setPublicAccessCodes] = useState({});
  const [publicAccessFlags, setPublicAccessFlags] = useState({});
  const publicAccessFetchesRef = useRef(new Set());
  const [duplicatingProfileId, setDuplicatingProfileId] = useState(null);
  const [showDuplicateEmailModal, setShowDuplicateEmailModal] = useState(false);
  const [duplicateEmail, setDuplicateEmail] = useState('');
  const [profileToDuplicate, setProfileToDuplicate] = useState(null);

  const [sortBy, setSortBy] = useState(() => getPreference('ProfilesGallery.sortBy', 'hierarchy_rank'));
  const [sortDir, setSortDir] = useState(() => getPreference('ProfilesGallery.sortDir', 'desc'));
  // Initialize filterEventId: use restricted event if current profile is restricted, otherwise eventId from URL or FILTER_ALL_EVENTS
  // Note: If eventUrl exists but eventId is not yet available, useEffect will update this when eventId resolves
  const [filterEventId, setFilterEventId] = useState(() => {
    const currentProfile = getCurrentProfile();
    if (currentProfile?.restricted_to_event) {
      return currentProfile.restricted_to_event;
    }
    // If eventUrl exists but eventId is not available yet, use FILTER_ALL_EVENTS as placeholder
    // The useEffect will update it when eventId becomes available
    if (eventUrl && eventId) {
      return eventId;
    }
    return FILTER_ALL_EVENTS;
  });
  const [eventSearchTerm, setEventSearchTerm] = useState('');
  const [showEventDropdown, setShowEventDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const eventInputRef = useRef(null);
  const eventDropdownRef = useRef(null);

  // Set document title
  useEffect(() => {
    document.title = `${t('profilesGallery.profiles')} | ${APP_CONFIG.name}`;
  }, [i18n.language]);

  // Auto-show login modal when not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      openLoginModal();
    }
  }, [isAuthenticated, isLoading, openLoginModal]);

  useApplyScopes([
    { entity: 'all', id: 'profiles', eventId: 'general' },
    ...(filterEventId && filterEventId !== FILTER_ALL_EVENTS ? [{ entity: 'all', id: 'event_profiles', eventId: filterEventId }] : []),
    ...(eventId && (!filterEventId || filterEventId === FILTER_ALL_EVENTS) ? [{ entity: 'all', id: 'event_profiles', eventId }] : [])
  ]);

  const currentProfile = getCurrentProfile();
  const isCurrentProfileRestricted = Boolean(currentProfile?.restricted_to_event);
  const currentProfileRestrictedEventId = currentProfile?.restricted_to_event || null;
  const generalProfiles = useProfilesList();
  const eventsList = useEventsGeneralList();
  const eventProfiles = useEventProfilesList(filterEventId && filterEventId !== FILTER_ALL_EVENTS ? filterEventId : eventId);

  const fetchProfiles = useCallback(async () => {
    // Determine what we need to fetch
    const targetEventId = filterEventId && filterEventId !== FILTER_ALL_EVENTS ? filterEventId : eventId;
    
    // Check store directly for the target event's profiles
    const store = useDataStore.getState();
    const hasGeneralProfiles = generalProfiles.length > 0;
    const hasEventProfiles = targetEventId ? (store.entities?.[targetEventId]?.event_profiles && Object.keys(store.entities[targetEventId].event_profiles).length > 0) : true;
    
    // If we already have all the data we need, skip fetching (withDedupe will handle concurrent requests)
    if (hasGeneralProfiles && hasEventProfiles) {
      setLoading(false); // Ensure loading is false if we're skipping
      return;
    }
    
    setLoading(true);
    setError('');
    try {
      // If filtering by event (not 'dashboard'), use the new by-event endpoint
      if (filterEventId && filterEventId !== FILTER_ALL_EVENTS) {
        await profilesAPI.getByEvent(filterEventId);
      } else {
        // Otherwise use general profiles route
        await profilesAPI.getAll(eventUrl || null);
      }
      // Changes are automatically applied by apiService interceptor
    } catch (err) {
      const message = formatErrorMessage('load profiles', err);
      console.error('Failed to load profiles:', err);
      setError(message);
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [eventUrl, filterEventId, showToast, generalProfiles.length, eventId]);

  useAuthRefresh(fetchProfiles, [eventUrl, filterEventId]);

  // Fetch events for dropdown
  useEffect(() => {
    if (isAuthenticated && eventsList.length === 0) {
      eventsAPI.list().catch((err) => {
        console.error('Failed to load events:', err);
      });
    }
  }, [isAuthenticated, eventsList.length]);

  // Create placeholder profiles when not authenticated
  const placeholderProfiles = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => ({
      id: `placeholder-${i}`,
      label: '',
      hierarchy_rank: 0,
      is_public: false,
      has_public_access_code: false,
      isPlaceholder: true
    }));
  }, []);

  const fetchPublicAccessCode = useCallback(async (profileId, { notifyOnError = false } = {}) => {
    if (!profileId) return null;
    const idStr = String(profileId);
    if (publicAccessFetchesRef.current.has(idStr)) {
      return publicAccessCodes[idStr] ?? null;
    }
    publicAccessFetchesRef.current.add(idStr);
    try {
      const response = await profilesAPI.getPublicAccessCode(idStr);
      const publicCode = response?.public_code || null;
      setPublicAccessCodes((prev) => {
        if (prev[idStr] === publicCode) return prev;
        return { ...prev, [idStr]: publicCode };
      });
      setPublicAccessFlags((prev) => {
        const nextValue = publicCode ? 1 : 0;
        if (prev[idStr] === nextValue) return prev;
        return { ...prev, [idStr]: nextValue };
      });
      return publicCode;
    } catch (error) {
      console.error('Failed to fetch public access code:', error);
      if (notifyOnError) {
        showToast(formatErrorMessage('load public access code', error), 'error');
      }
      setPublicAccessFlags((prev) => {
        if (prev[idStr] === 0) return prev;
        return { ...prev, [idStr]: 0 };
      });
      return null;
    } finally {
      publicAccessFetchesRef.current.delete(idStr);
    }
  }, [publicAccessCodes, showToast]);

  // Get other profiles (exclude current) and sort by rank desc, then label asc
  const generalProfilesById = useMemo(() => {
    const map = new Map();
    generalProfiles.forEach((profile) => {
      const generalId = profile?.id || profile?.profile_id;
      if (generalId) {
        map.set(String(generalId), profile);
      }
    });
    return map;
  }, [generalProfiles]);

  const eventProfilesForDisplay = useMemo(() => {
    // If filtering by event (not 'dashboard'), only show profiles that have a relation to that event
    if (filterEventId && filterEventId !== FILTER_ALL_EVENTS) {
      // Create a map of event profiles by profile_id
      const eventProfileMap = new Map();
      eventProfiles.forEach((ep) => {
        const epId = ep?.id || ep?.profile_id;
        if (epId) {
          eventProfileMap.set(String(epId), ep);
        }
      });
      
      // Only include general profiles that have an event profile relation
      return generalProfiles
        .filter((profile) => {
          const baseId = profile?.id || profile?.profile_id;
          if (!baseId) return false;
          return eventProfileMap.has(String(baseId));
        })
        .map((profile) => {
          const baseId = profile?.id || profile?.profile_id;
          const baseIdStr = String(baseId);
          // Get event profile data from event_profiles store
          const eventProfile = eventProfileMap.get(baseIdStr) || null;
          
          const hasPublicAccessOverride = Object.prototype.hasOwnProperty.call(publicAccessFlags, baseIdStr)
            ? publicAccessFlags[baseIdStr]
            : undefined;
          const hasPublicAccessCode =
            Boolean(hasPublicAccessOverride ?? profile?.has_public_access_code);
          const publicAccessCode = Object.prototype.hasOwnProperty.call(publicAccessCodes, baseIdStr)
            ? publicAccessCodes[baseIdStr]
            : undefined;

          return {
            id: baseIdStr,
            label: profile.label || '',
            hierarchy_rank: Number(profile.hierarchy_rank ?? 0),
            is_public: Boolean(profile.is_public) ? 1 : 0,
            has_public_access_code: hasPublicAccessCode ? 1 : 0,
            public_access_code: publicAccessCode,
            restricted_to_event: profile.restricted_to_event ?? null,
            restricted_to_event_name: profile.restricted_to_event_name ?? null,
            can_create_events: Boolean(profile.can_create_events) ? 1 : 0,
            can_manage_event: Boolean(eventProfile?.can_manage_event) ? 1 : 0,
            can_delete_event: Boolean(eventProfile?.can_delete_event) ? 1 : 0,
            can_edit: Boolean(eventProfile?.can_edit) ? 1 : 0,
            is_editable: Boolean(profile.is_editable ?? true),
            eventProfile: eventProfile || null,
            generalProfile: profile,
          };
        });
    }
    
    // Otherwise show all general profiles
    return generalProfiles.map((profile) => {
      const baseId = profile?.id || profile?.profile_id;
      if (!baseId) return null;
      const baseIdStr = String(baseId);
      
      // Get event profile if available (for event-specific data)
      const eventProfile = eventId ? eventProfiles.find(ep => {
        const epId = ep?.id || ep?.profile_id;
        return epId && String(epId) === baseIdStr;
      }) : null;
      
      const hasPublicAccessOverride = Object.prototype.hasOwnProperty.call(publicAccessFlags, baseIdStr)
        ? publicAccessFlags[baseIdStr]
        : undefined;
      const hasPublicAccessCode =
        Boolean(hasPublicAccessOverride ?? profile?.has_public_access_code);
      const publicAccessCode = Object.prototype.hasOwnProperty.call(publicAccessCodes, baseIdStr)
        ? publicAccessCodes[baseIdStr]
        : undefined;

      return {
        id: baseIdStr,
        label: profile.label || '',
        hierarchy_rank: Number(profile.hierarchy_rank ?? 0),
        is_public: Boolean(profile.is_public) ? 1 : 0,
        has_public_access_code: Boolean(hasPublicAccessCode) ? 1 : 0,
        public_access_code: publicAccessCode,
        restricted_to_event: profile.restricted_to_event ?? null,
        restricted_to_event_name: profile.restricted_to_event_name ?? null,
        can_create_events: Boolean(profile.can_create_events) ? 1 : 0,
        can_manage_event: Boolean(eventProfile?.can_manage_event) ? 1 : 0,
        can_delete_event: Boolean(eventProfile?.can_delete_event) ? 1 : 0,
        can_edit: Boolean(eventProfile?.can_edit) ? 1 : 0,
        is_editable: Boolean(profile.is_editable ?? true),
        eventProfile: eventProfile || null,
        generalProfile: profile,
      };
    }).filter(Boolean);
  }, [generalProfiles, eventProfiles, publicAccessCodes, publicAccessFlags, eventId, filterEventId]);

  const profilesArray = useMemo(() => {
    return [...eventProfilesForDisplay].sort((a, b) => {
      // Sort by rank descending, then by label ascending
      const rankA = a.hierarchy_rank || 0;
      const rankB = b.hierarchy_rank || 0;
      if (rankA !== rankB) {
        return rankB - rankA; // descending
      }
      return (a.label || '').localeCompare(b.label || ''); // ascending
    });
  }, [eventProfilesForDisplay]);

  // Use profiles from store or placeholders when not authenticated
  const currentProfiles = isAuthenticated ? profilesArray : placeholderProfiles;

  const sortedProfiles = useMemo(() => {
    if (!isAuthenticated) return currentProfiles;

    const dir = sortDir === 'asc' ? 1 : -1;
    const getValue = (profile) => {
      switch (sortBy) {
        case 'label':
          return (profile.label || '').toLowerCase();
        case 'hierarchy_rank':
          return profile.hierarchy_rank || 0;
        case 'is_public':
          return Boolean(profile.is_public) ? 1 : 0;
        case 'can_create_events':
          return Boolean(profile.can_create_events) ? 1 : 0;
        case 'restricted_to_event_name':
          return (profile.restricted_to_event_name || '').toLowerCase();
        case 'can_manage_event':
          return profile.can_manage_event ? 1 : 0;
        case 'can_delete_event':
          return profile.can_delete_event ? 1 : 0;
        case 'can_edit':
          return profile.can_edit ? 1 : 0;
        default:
          return profile[sortBy] ?? '';
      }
    };

    return [...currentProfiles].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [currentProfiles, sortBy, sortDir, isAuthenticated]);

  const handleSort = useCallback(
    (field) => {
      if (sortBy === field) {
        const nextDir = sortDir === 'asc' ? 'desc' : 'asc';
        setSortDir(nextDir);
        setPreference('ProfilesGallery.sortDir', nextDir);
      } else {
        setSortBy(field);
        setSortDir('desc');
        setPreference('ProfilesGallery.sortBy', field);
        setPreference('ProfilesGallery.sortDir', 'desc');
      }
    },
    [sortBy, sortDir]
  );


  const handleEditProfile = (profile) => {
    const mergedProfile = {
      ...(profile.generalProfile || {}),
      ...(profile.eventProfile || {}),
      id: profile.id,
      public_access_code: profile.public_access_code,
      restricted_to_event: profile.restricted_to_event,
    };
    setSelectedProfile(mergedProfile);
    setIsCreatingNewProfile(false);
    setShowEditProfileModal(true);
  };

  const handleCreateProfile = () => {
    const newProfileTemplate = {
      id: null,
      label: 'New Profile',
      hierarchy_rank: 0,
      can_upload_and_delete_images: 0,
      can_edit: 0,
      all_images: 0,
      all_groups: 0,
      all_albums: 0,
      is_public: 0
    };
    
    setSelectedProfile(newProfileTemplate);
    setIsCreatingNewProfile(true);
    setShowEditProfileModal(true);
  };

  const handleDuplicateProfile = async (profile) => {
    if (!profile || !profile.id) return;
    
    // Check if profile is non-public (email required)
    const isPublic = Boolean(profile.is_public);
    if (!isPublic) {
      // Show popup for email input
      setProfileToDuplicate(profile);
      setDuplicateEmail('');
      setShowDuplicateEmailModal(true);
      return;
    }
    
    // For public profiles, duplicate directly (no email needed)
    await performDuplicate(profile.id, null);
  };

  const performDuplicate = async (profileId, email) => {
    if (!profileId) return;
    
    setDuplicatingProfileId(profileId);
    try {
      // Pass email if provided (for non-public profiles)
      const result = await profilesAPI.duplicate(profileId, email ? { email } : undefined);
      
      // Show success toast
      const incompleteCount = result.incomplete_events?.length || 0;
      const profileLabel = profileToDuplicate?.label || t('profilesGallery.profile');
      if (incompleteCount > 0) {
        showToast(
          t('profilesGallery.profileDuplicatedWithWarning', { count: incompleteCount }),
          'warning'
        );
      } else {
        showToast(t('profilesGallery.profileDuplicatedSuccessfully', { profileLabel }), 'success');
      }
      
      // Fetch the new profile and open it in the modal
      // The API response includes changes that update the store automatically
      if (result.new_profile_id) {
        try {
          // Wait a bit for store to update from the changes in the response
          await new Promise(resolve => setTimeout(resolve, 100));
          
          const newProfile = await profilesAPI.getGeneralById(result.new_profile_id);
          
          // The profile data from the store should be up to date
          // The modal will handle fetching event-specific data if needed
          setSelectedProfile({
            ...newProfile,
            id: result.new_profile_id,
          });
          setIsCreatingNewProfile(false);
          setShowEditProfileModal(true);
        } catch (err) {
          console.error('Failed to fetch duplicated profile:', err);
          // Still show success, but don't open modal
          showToast('Profile duplicated, but could not open it for editing', 'warning');
        }
      }
    } catch (error) {
      console.error('Failed to duplicate profile:', error);
      // Use errorHandler to get user-friendly error message
      const errorMsg = getErrorExplanation(error);
      showToast(errorMsg, 'error');
    } finally {
      setDuplicatingProfileId(null);
      setShowDuplicateEmailModal(false);
      setProfileToDuplicate(null);
      setDuplicateEmail('');
    }
  };

  const handleConfirmDuplicateEmail = async () => {
    if (!profileToDuplicate) return;
    
    const emailValue = duplicateEmail.trim();
    if (!emailValue) {
      showToast(t('profilesGallery.duplicateEmailModal.emailIsRequiredForNonPublicProfiles'), 'error');
      return;
    }
    
    await performDuplicate(profileToDuplicate.id, emailValue);
  };

  const handleDeleteProfile = (profile) => {
    setProfileToDelete(profile);
    setShowDeleteConfirmModal(true);
  };

  const handleConfirmDeleteProfile = async () => {
    if (!profileToDelete) return;

    try {
      // When event filter is active, delete should use non-event URL to delete entirely
      // If profile is restricted to an event, it will be deleted completely
      // Otherwise, if event filter is active, we should delete from general (not just remove from event)
      let targetEventUrl = null;
      
      // Only use event URL if:
      // 1. We're not filtering by event (filterEventId is FILTER_ALL_EVENTS or null)
      // 2. AND profile is restricted to an event
      const restrictedEventId = profileToDelete.restricted_to_event;
      const isEventFilterActive = filterEventId && filterEventId !== FILTER_ALL_EVENTS;
      
      if (!isEventFilterActive && restrictedEventId) {
        // Get event URL from event ID (same logic as EditProfileModal)
        targetEventUrl = getEventUrlFromId(restrictedEventId, eventId, eventUrl);
        // If not found in store, try to fetch it from API
        if (!targetEventUrl) {
          targetEventUrl = await getEventUrlById(restrictedEventId);
        }
      }
      // If event filter is active, targetEventUrl stays null to delete from general
      
      await profilesAPI.delete(profileToDelete.id, targetEventUrl);
      showToast(t('profilesGallery.profileDeleted'), 'success');
    } catch (error) {
      console.error('Failed to delete profile:', error);
      // Get user-friendly error message (already includes context, no need for "Failed to..." prefix)
      const errorMsg = getErrorExplanation(error);
      showToast(errorMsg, 'error');
    } finally {
      setProfileToDelete(null);
      setShowDeleteConfirmModal(false);
    }
  };

  const handleRemoveFromEvent = (profile) => {
    setProfileToRemoveFromEvent(profile);
    setShowRemoveFromEventModal(true);
  };

  const handleConfirmRemoveFromEvent = async () => {
    if (!profileToRemoveFromEvent || !filterEventId || filterEventId === FILTER_ALL_EVENTS) return;
    
    try {
      const result = await profilesAPI.deleteEventProfile(profileToRemoveFromEvent.id, filterEventId);
      // Check if profile was completely deleted (if it was restricted to this event)
      const wasCompletelyDeleted = result.deleted_ids && result.deleted_ids.includes(profileToRemoveFromEvent.id);
      if (wasCompletelyDeleted) {
        showToast(t('profilesGallery.profileDeleted'), 'success');
      } else {
        showToast(t('profilesGallery.profileRemovedFromEvent'), 'success');
      }
    } catch (error) {
      console.error('Failed to remove profile from event:', error);
      const errorMsg = getErrorExplanation(error);
      showToast(errorMsg, 'error');
    } finally {
      setProfileToRemoveFromEvent(null);
      setShowRemoveFromEventModal(false);
    }
  };

  const handleCopyPublicLink = async (profile) => {
    try {
      let publicCode = Object.prototype.hasOwnProperty.call(publicAccessCodes, profile.id)
        ? publicAccessCodes[profile.id]
        : undefined;
      if (publicCode === undefined) {
        publicCode = await fetchPublicAccessCode(profile.id, { notifyOnError: true });
      }
      if (!publicCode) {
        showToast(t('profilesGallery.noPublicAccessCodeAvailable'), 'error');
        return;
      }
      
      // Determine the event URL to use
      let targetEventUrl = eventUrl;
      if (!targetEventUrl) {
        // If no eventUrl from URL params, try to get it from the profile's restricted event
        const restrictedEventId = profile.restricted_to_event;
        if (restrictedEventId) {
          targetEventUrl = getEventUrlFromId(restrictedEventId, eventId, eventUrl);
          // If not found in store, try to fetch it from API
          if (!targetEventUrl) {
            targetEventUrl = await getEventUrlById(restrictedEventId);
          }
        }
      }
      
      if (!targetEventUrl) {
        showToast(t('profilesGallery.cannotGeneratePublicLink'), 'error');
        return;
      }
      
      const publicUrl = `${window.location.origin}/${targetEventUrl}/public-access/${publicCode}`;
      await navigator.clipboard.writeText(publicUrl);
      showToast(t('profilesGallery.publicLinkCopiedToClipboard'), 'success');
    } catch (error) {
      console.error('Failed to copy link:', error);
      showToast(t('profilesGallery.failedToCopyLink'), 'error');
    }
  };

  const handleResetPublicCode = async (profile) => {
    try {
      const result = await profilesAPI.resetPublicAccessCode(profile.id);
      showToast(t('profilesGallery.publicAccessCodeReset'), 'success');
      
      if (result.public_code) {
        // Determine the event URL to use
        let targetEventUrl = eventUrl;
        if (!targetEventUrl) {
          // If no eventUrl from URL params, try to get it from the profile's restricted event
          const restrictedEventId = profile.restricted_to_event;
          if (restrictedEventId) {
            targetEventUrl = getEventUrlFromId(restrictedEventId, eventId, eventUrl);
            // If not found in store, try to fetch it from API
            if (!targetEventUrl) {
              targetEventUrl = await getEventUrlById(restrictedEventId);
            }
          }
        }
        
        if (targetEventUrl) {
          const publicUrl = `${window.location.origin}/${targetEventUrl}/public-access/${result.public_code}`;
          try {
            await navigator.clipboard.writeText(publicUrl);
            showToast(t('profilesGallery.publicLinkCopiedToClipboard'), 'success');
          } catch (copyError) {
            console.error('Failed to copy link:', copyError);
            showToast(t('profilesGallery.linkCreatedButFailedToCopy'), 'warning');
          }
        } else {
          showToast(t('profilesGallery.publicAccessCodeResetButCannotGenerateLink'), 'warning');
        }
      }
      
      setPublicAccessCodes((prev) => ({
        ...prev,
        [profile.id]: result.public_code || null,
      }));
      setPublicAccessFlags((prev) => ({
        ...prev,
        [profile.id]: result.public_code ? 1 : 0,
      }));
    } catch (error) {
      console.error('Failed to reset public access code:', error);
      showToast(formatErrorMessage('reset public access code', error), 'error');
    }
  };

  const handleRemovePublicCode = async (profile) => {
    try {
      await profilesAPI.removePublicAccessCode(profile.id);
      showToast(t('profilesGallery.publicAccessCodeRemoved'), 'success');
      setPublicAccessCodes((prev) => ({
        ...prev,
        [profile.id]: null,
      }));
      setPublicAccessFlags((prev) => ({
        ...prev,
        [profile.id]: 0,
      }));
    } catch (error) {
      console.error('Failed to remove public access code:', error);
      showToast(formatErrorMessage('remove public access code', error), 'error');
    }
  };

  const stats = useMemo(() => {
    const total = profilesArray.length;
    const publicCount = profilesArray.filter((p) => Boolean(p.is_public)).length;
    const privateCount = total - publicCount;
    return { total, public: publicCount, private: privateCount };
  }, [profilesArray]);

  // Get selected event name for display
  const selectedEventName = useMemo(() => {
    if (!filterEventId || filterEventId === FILTER_ALL_EVENTS) return t('profilesGallery.allEvents');
    const event = eventsList.find(e => {
      const evtId = e.event_id || e.id;
      return evtId && String(evtId) === String(filterEventId);
    });
    return event?.name || t('profilesGallery.untitledEvent');
  }, [filterEventId, eventsList, t]);

  // Filter events based on search term
  const filteredEvents = useMemo(() => {
    if (!eventSearchTerm.trim()) return eventsList;
    const searchLower = eventSearchTerm.toLowerCase();
    return eventsList.filter(event => {
      const evtName = event?.name || t('profilesGallery.untitledEvent');
      return evtName.toLowerCase().includes(searchLower);
    });
  }, [eventsList, eventSearchTerm, t]);

  // Reset highlighted index when filtered events change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredEvents.length, eventSearchTerm]);

  // Handle event selection
  const handleEventSelect = (evtId) => {
    const newEventId = evtId || FILTER_ALL_EVENTS;
    setFilterEventId(newEventId);
    setEventSearchTerm('');
    setShowEventDropdown(false);
    setHighlightedIndex(0);
  };

  // Get selectable options (including "All Events")
  const selectableOptions = useMemo(() => {
    const options = [];
    if (!eventSearchTerm) {
      options.push({ id: null, name: t('profilesGallery.allEvents'), isPlaceholder: true });
    }
    filteredEvents.forEach(event => {
      const evtId = event?.event_id || event?.id;
      const evtName = event?.name || t('profilesGallery.untitledEvent');
      options.push({ id: evtId, name: evtName, isPlaceholder: false });
    });
    return options;
  }, [filteredEvents, eventSearchTerm, t]);

  // Handle keyboard navigation
  const handleEventInputKeyDown = (e) => {
    if (!showEventDropdown) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        setShowEventDropdown(true);
        return;
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex(prev => 
          prev < selectableOptions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex(prev => prev > 0 ? prev - 1 : 0);
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        if (selectableOptions.length > 0) {
          const safeIndex = highlightedIndex >= 0 && highlightedIndex < selectableOptions.length 
            ? highlightedIndex 
            : 0;
          const option = selectableOptions[safeIndex];
          if (option) {
            handleEventSelect(option.id);
          }
        }
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        setShowEventDropdown(false);
        setEventSearchTerm(selectedEventName || '');
        break;
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        eventInputRef.current &&
        !eventInputRef.current.contains(event.target) &&
        eventDropdownRef.current &&
        !eventDropdownRef.current.contains(event.target)
      ) {
        setShowEventDropdown(false);
        // Reset search term to selected event name when closing
        setEventSearchTerm(selectedEventName);
      }
    };

    if (showEventDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showEventDropdown, selectedEventName]);

  // Update filterEventId when eventId becomes available (e.g., after useEventId resolves)
  // But don't override user selections - only set initial value
  const hasInitializedFilterRef = useRef(false);
  useEffect(() => {
    // Only set initial value once, don't override user selections
    if (hasInitializedFilterRef.current) {
      // After initialization, only enforce restriction if current profile is restricted
      if (isCurrentProfileRestricted) {
        // If current profile is restricted, always use the restricted event
        if (String(filterEventId) !== String(currentProfileRestrictedEventId)) {
          setFilterEventId(currentProfileRestrictedEventId);
        }
      }
      return;
    }
    
    // Initial setup
    if (isCurrentProfileRestricted) {
      setFilterEventId(currentProfileRestrictedEventId);
      hasInitializedFilterRef.current = true;
    } else if (eventUrl && eventId) {
      // If we have an eventUrl and eventId is available, use that event
      setFilterEventId(eventId);
      hasInitializedFilterRef.current = true;
    } else if (eventUrl && !eventId) {
      // If we have eventUrl but eventId is not yet available, wait for it
      // Don't mark as initialized yet
      return;
    } else {
      // No eventUrl, default to all events
      setFilterEventId(FILTER_ALL_EVENTS);
      hasInitializedFilterRef.current = true;
    }
  }, [eventId, eventUrl, filterEventId, isCurrentProfileRestricted, currentProfileRestrictedEventId]);

  // Update search term when selected event changes
  useEffect(() => {
    if (!showEventDropdown) {
      setEventSearchTerm(selectedEventName);
    }
  }, [filterEventId, selectedEventName, showEventDropdown]);

  // Build columns array dynamically
  const columns = useMemo(() => {
    const baseColumns = [
      {
        key: 'label',
        label: t('profilesGallery.name'),
        sortable: true,
        align: 'left',
        headerClassName: 'w-48 min-w-[192px]',
        cellClassName: 'text-gray-900 font-medium w-48 min-w-[192px]',
        renderCell: (profile) =>
          profile.isPlaceholder ? (
            <span className="text-gray-400 italic">—</span>
          ) : (
            profile.label || t('profilesGallery.untitledProfile')
          ),
      },
      {
        key: 'hierarchy_rank',
        label: t('profilesGallery.rank'),
        sortable: true,
        align: 'left',
        headerClassName: 'w-24 min-w-[96px]',
        cellClassName: 'text-gray-700 w-24 min-w-[96px]',
        renderCell: (profile) =>
          profile.isPlaceholder ? (
            <span className="text-gray-400 italic">—</span>
          ) : (
            profile.hierarchy_rank || 0
          ),
      },
      {
        key: 'is_public',
        label: t('profilesGallery.accessibility'),
        sortable: true,
        align: 'left',
        headerClassName: 'w-36 min-w-[144px]',
        cellClassName: 'w-36 min-w-[144px]',
        renderCell: (profile) =>
          profile.isPlaceholder ? (
            <span className="text-gray-400 italic">—</span>
          ) : (
            <span
              className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                Boolean(profile.is_public)
                  ? 'bg-green-100 text-green-700'
                  : 'bg-purple-100 text-purple-700'
              }`}
            >
              {Boolean(profile.is_public) ? t('profilesGallery.public') : t('profilesGallery.private')}
            </span>
          ),
      },
    ];

    if (Boolean(currentProfile?.can_manage_create_events)) {
      baseColumns.push({
        key: 'can_create_events',
        label: t('profilesGallery.canCreateEvents'),
        sortable: true,
        align: 'left',
        headerClassName: 'w-40 min-w-[160px]',
        cellClassName: 'w-40 min-w-[160px]',
        renderCell: (profile) =>
          profile.isPlaceholder ? (
            <span className="text-gray-400 italic">—</span>
          ) : (
            <span
              className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                Boolean(profile.can_create_events)
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {Boolean(profile.can_create_events) ? t('profilesGallery.yes') : t('profilesGallery.no')}
            </span>
          ),
      });
    }

    baseColumns.push({
      key: 'restricted_to_event_name',
      label: t('profilesGallery.restrictedToEvent'),
      sortable: true,
      align: 'left',
      cellClassName: 'text-gray-700',
      renderCell: (profile) =>
        profile.isPlaceholder ? (
          <span className="text-gray-400 italic">—</span>
        ) : (
          profile.restricted_to_event_name || <span className="text-gray-400 italic">—</span>
        ),
    });

    if (filterEventId && filterEventId !== FILTER_ALL_EVENTS) {
      baseColumns.push(
        {
          key: 'can_manage_event',
          label: t('profilesGallery.canManage'),
          sortable: true,
          align: 'left',
          renderCell: (profile) =>
            profile.isPlaceholder ? (
              <span className="text-gray-400 italic">—</span>
            ) : (
              <span
                className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                  Boolean(profile.can_manage_event)
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                {Boolean(profile.can_manage_event) ? t('profilesGallery.yes') : t('profilesGallery.no')}
              </span>
            ),
        },
        {
          key: 'can_delete_event',
          label: t('profilesGallery.canDelete'),
          sortable: true,
          align: 'left',
          renderCell: (profile) =>
            profile.isPlaceholder ? (
              <span className="text-gray-400 italic">—</span>
            ) : (
              <span
                className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                  Boolean(profile.can_delete_event)
                    ? 'bg-red-100 text-red-700'
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                {Boolean(profile.can_delete_event) ? t('profilesGallery.yes') : t('profilesGallery.no')}
              </span>
            ),
        },
        {
          key: 'can_edit',
          label: t('profilesGallery.canEdit'),
          sortable: true,
          align: 'left',
          renderCell: (profile) =>
            profile.isPlaceholder ? (
              <span className="text-gray-400 italic">—</span>
            ) : (
              <span
                className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                  Boolean(profile.can_edit)
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                {Boolean(profile.can_edit) ? t('profilesGallery.yes') : t('profilesGallery.no')}
              </span>
            ),
        }
      );
    }

    baseColumns.push({
      key: 'actions',
      label: t('profilesGallery.actions'),
      align: 'right',
      renderCell: (profile) => (
        <div className="flex items-center justify-end gap-2">
          {!profile.isPlaceholder && (
            <>
              {Boolean(profile.is_public) && (
                <>
                  {Boolean(profile.has_public_access_code) ? (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyPublicLink(profile);
                        }}
                        className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                        title={t('profilesGallery.copyPublicLink')}
                      >
                        <LinkIcon className="w-4 h-4 text-blue-600" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResetPublicCode(profile);
                        }}
                        className="p-2 hover:bg-yellow-100 rounded-lg transition-colors"
                        title={t('profilesGallery.resetPublicAccessCode')}
                      >
                        <RotateCcw className="w-4 h-4 text-yellow-600" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemovePublicCode(profile);
                        }}
                        className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                        title={t('profilesGallery.removePublicAccessCode')}
                      >
                        <Minus className="w-4 h-4 text-red-600" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleResetPublicCode(profile);
                      }}
                      className="p-2 hover:bg-green-100 rounded-lg transition-colors"
                      title={t('profilesGallery.createPublicAccessCode')}
                    >
                      <LinkIcon className="w-4 h-4 text-green-600" />
                    </button>
                  )}
                </>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDuplicateProfile(profile);
                }}
                disabled={duplicatingProfileId === profile.id}
                className="p-2 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t('profilesGallery.duplicateProfile')}
              >
                {duplicatingProfileId === profile.id ? (
                  <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Copy className="w-4 h-4 text-green-600" />
                )}
              </button>
              {/* Show remove from event button when event filter is active */}
              {filterEventId && filterEventId !== FILTER_ALL_EVENTS && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveFromEvent(profile);
                  }}
                  className="p-2 hover:bg-orange-100 rounded-lg transition-colors"
                  title={t('profilesGallery.removeFromEvent')}
                >
                  <X className="w-4 h-4 text-orange-600" />
                </button>
              )}
              {/* Show delete button only if profile is editable */}
              {Boolean(profile.is_editable) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteProfile(profile);
                  }}
                  className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                  title={t('profilesGallery.deleteProfile')}
                >
                  <Trash2 className="w-4 h-4 text-red-600" />
                </button>
              )}
            </>
          )}
        </div>
      ),
    });

    return baseColumns;
  }, [currentProfile, filterEventId, handleCopyPublicLink, handleResetPublicCode, handleRemovePublicCode, handleEditProfile, handleDuplicateProfile, handleDeleteProfile, handleRemoveFromEvent, duplicatingProfileId, selectedEventName, t]);

  return (
    <>
      <div dir={isRTL ? 'rtl' : 'ltr'} className={`${!eventUrl ? 'min-h-screen' : ''} bg-gray-50 overflow-x-hidden`}>
        {!eventUrl && <TopNavigationBar variant="light" showBackground={true} mode="full" />}
        {!eventUrl && <div className="h-[4rem]"></div>}
        {eventUrl && <div className="h-[4rem]"></div>}
        <div className={`sticky ${!eventUrl ? 'top-[4rem]' : 'top-[4rem]'} z-30 bg-white border-b border-gray-200 shadow-sm`}>
          <div className="w-full px-4 sm:px-8 py-2 sm:py-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-shrink-0">
                {eventUrl ? (
                  <Link
                    to={`/${eventUrl}`}
                    className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                    title={t('profilesGallery.backToEvent')}
                    aria-label={t('profilesGallery.backToEvent')}
                  >
                    {isRTL ? (
                      <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                    ) : (
                      <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                    )}
                  </Link>
                ) : (
                  <Link
                    to="/dashboard"
                    className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                    title={t('profilesGallery.backToDashboard')}
                    aria-label={t('profilesGallery.backToDashboard')}
                  >
                    {isRTL ? (
                      <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                    ) : (
                      <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                    )}
                  </Link>
                )}
                <div className="w-8 h-8 sm:w-12 sm:h-12 bg-purple-100 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 sm:w-6 sm:h-6 text-purple-600" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-2xl font-bold text-gray-900 truncate">{t('profilesGallery.profileManagement')}</h1>
                  <p className="text-xs sm:text-sm text-gray-500 truncate">
                    {isAuthenticated
                      ? `${stats.total} ${stats.total === 1 ? t('profilesGallery.profile') : t('profilesGallery.profilesPlural')}`
                      : t('profilesGallery.loading')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Event Filter Combobox */}
                {!isCurrentProfileRestricted && !eventUrl && (
                <div className="relative w-full sm:w-auto" ref={eventInputRef}>
                  <div className="relative">
                    <input
                      type="text"
                      value={eventSearchTerm}
                      onChange={(e) => {
                        setEventSearchTerm(e.target.value);
                        setShowEventDropdown(true);
                      }}
                      onFocus={() => {
                        // Clear the input if it shows the display name, so user can type freely
                        if (eventSearchTerm === selectedEventName) {
                          setEventSearchTerm('');
                        }
                        setShowEventDropdown(true);
                      }}
                      onKeyDown={handleEventInputKeyDown}
                      placeholder={t('profilesGallery.searchEvents')}
                      className="px-3 py-1.5 pr-8 text-sm border border-gray-300 rounded-lg bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent w-full sm:w-64"
                    />
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                  {showEventDropdown && (
                    <div
                      ref={eventDropdownRef}
                      className="absolute z-50 mt-1 w-full sm:w-64 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto"
                    >
                      {selectableOptions.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-500">
                          {eventSearchTerm ? t('profilesGallery.noEventsFound') : t('profilesGallery.noEventsAvailable')}
                        </div>
                      ) : (
                        selectableOptions.map((option, index) => {
                          const isSelected = option.id === null 
                            ? filterEventId === FILTER_ALL_EVENTS 
                            : option.id && String(option.id) === String(filterEventId);
                          const isHighlighted = index === highlightedIndex;
                          return (
                            <button
                              key={option.id || 'all-events'}
                              type="button"
                              onClick={() => handleEventSelect(option.id)}
                              className={`w-full text-left px-3 py-2 text-sm ${
                                isHighlighted 
                                  ? 'bg-blue-100 text-blue-900' 
                                  : isSelected 
                                    ? 'bg-blue-50 text-blue-700' 
                                    : 'text-gray-700 hover:bg-gray-100'
                              }`}
                            >
                              {option.name}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="w-full px-4 sm:px-8 py-3 sm:py-6 overflow-x-auto">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {loading && isAuthenticated ? (
            <div className="flex items-center justify-center py-16 text-gray-500">
              <div className={`${isRTL ? 'ml-3' : 'mr-3'} h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent`} />
              {t('profilesGallery.loadingProfiles')}
            </div>
          ) : sortedProfiles.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12"
            >
              <User className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">{t('profilesGallery.noProfiles')}</h3>
              <p className="text-gray-500 mb-4">{t('profilesGallery.getStartedByCreatingNewProfile')}</p>
              {isAuthenticated && (
                <button
                  onClick={handleCreateProfile}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t('profilesGallery.createProfile')}</span>
                </button>
              )}
            </motion.div>
          ) : (
            <div className="w-full min-w-0">
              <ScrollableTable
                style={{ maxHeight: 'calc(100vh - 20rem)' }}
                columns={columns}
                data={sortedProfiles}
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
                onRowClick={(profile) => {
                  if (!profile.isPlaceholder) {
                    handleEditProfile(profile);
                  }
                }}
                emptyState={{
                  icon: User,
                  title: t('profilesGallery.noProfiles'),
                  message: t('profilesGallery.getStartedByCreatingNewProfile'),
                }}
                getRowKey={(profile) => profile.id}
              />
            </div>
          )}
        </div>
      </div>

      {showEditProfileModal && selectedProfile && (
        <EditProfileModal
          isOpen={showEditProfileModal}
          onClose={() => {
            setShowEditProfileModal(false);
            setSelectedProfile(null);
            setIsCreatingNewProfile(false);
          }}
          profile={selectedProfile}
          eventUrl={eventUrl}
          urlHelpers={urlHelpers}
          isCreating={isCreatingNewProfile}
          initialEventId={filterEventId !== FILTER_ALL_EVENTS ? filterEventId : null}
          onSave={(createdProfile) => {
            // Changes are automatically applied by apiService interceptor
            setIsCreatingNewProfile(false);
            // Update selectedProfile with created profile if provided
            if (createdProfile && createdProfile.id) {
              setSelectedProfile(createdProfile);
            }
          }}
        />
      )}

      {showDeleteConfirmModal && profileToDelete && (
        <ConfirmDelete
          isOpen={showDeleteConfirmModal}
          onClose={() => {
            setShowDeleteConfirmModal(false);
            setProfileToDelete(null);
          }}
          onConfirm={handleConfirmDeleteProfile}
          title={t('profilesGallery.deleteConfirmModal.deleteProfile')}
          message={t('profilesGallery.deleteConfirmModal.areYouSureDeleteProfile')}
          itemName={profileToDelete.label}
          confirmText={t('profilesGallery.deleteConfirmModal.delete')}
          cancelText={t('profilesGallery.deleteConfirmModal.cancel')}
          caption={t('profilesGallery.deleteConfirmModal.thisActionCannotBeUndone')}
        />
      )}

      <AnimatePresence>
        {showDuplicateEmailModal && profileToDuplicate && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-xl shadow-2xl w-full max-w-md"
            >
              <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">{t('profilesGallery.duplicateEmailModal.duplicateProfile')}</h2>
                  <button
                    onClick={() => {
                      setShowDuplicateEmailModal(false);
                      setProfileToDuplicate(null);
                      setDuplicateEmail('');
                    }}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="px-6 py-4">
                <p className="text-sm text-gray-600 mb-4">
                  {t('profilesGallery.duplicateEmailModal.enterEmailForDuplicatedProfile', { profileLabel: profileToDuplicate.label })}
                </p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('profilesGallery.duplicateEmailModal.emailRequiredStar')}
                  </label>
                  <input
                    type="email"
                    value={duplicateEmail}
                    onChange={(e) => setDuplicateEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && duplicateEmail.trim()) {
                        handleConfirmDuplicateEmail();
                      } else if (e.key === 'Escape') {
                        setShowDuplicateEmailModal(false);
                        setProfileToDuplicate(null);
                        setDuplicateEmail('');
                      }
                    }}
                    autoFocus
                    className="w-full h-10 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder={t('profilesGallery.duplicateEmailModal.enterEmailRequired')}
                  />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowDuplicateEmailModal(false);
                    setProfileToDuplicate(null);
                    setDuplicateEmail('');
                  }}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                >
                  {t('profilesGallery.duplicateEmailModal.cancel')}
                </button>
                <button
                  onClick={handleConfirmDuplicateEmail}
                  disabled={!duplicateEmail.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('profilesGallery.duplicateEmailModal.duplicate')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {showRemoveFromEventModal && profileToRemoveFromEvent && (
        <ConfirmDelete
          isOpen={showRemoveFromEventModal}
          onClose={() => {
            setShowRemoveFromEventModal(false);
            setProfileToRemoveFromEvent(null);
          }}
          onConfirm={handleConfirmRemoveFromEvent}
          title={t('profilesGallery.removeFromEventConfirmModal.removeProfileFromEvent')}
          message={t('profilesGallery.removeFromEventConfirmModal.areYouSureRemoveProfile')}
          itemName={profileToRemoveFromEvent.label}
          confirmText={t('profilesGallery.removeFromEventConfirmModal.remove')}
          cancelText={t('profilesGallery.removeFromEventConfirmModal.cancel')}
          caption={t('profilesGallery.removeFromEventConfirmModal.willRemoveFromEvent', { eventName: selectedEventName })}
        />
      )}

      {isAuthenticated && (
        <div className="fixed bottom-4 right-4 sm:bottom-8 sm:right-8 z-40">
          <motion.button
            onClick={handleCreateProfile}
            className="w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-purple-500 via-indigo-500 to-blue-600 hover:from-purple-600 hover:via-indigo-600 hover:to-blue-700 text-white rounded-full shadow-lg hover:shadow-2xl transition-all duration-200 flex items-center justify-center"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title={t('profilesGallery.createProfile')}
          >
            <Plus className="w-6 h-6 sm:w-8 sm:h-8" />
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

