import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Shield, Image as ImageIcon, FolderOpen, Users, AlertTriangle, AlertCircle, Save, Trash2, MapPin, ChevronDown, Calendar, Plus, HelpCircle, Lock, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalStore } from '../../utils/modalManager';
import { profilesAPI, getEventUrlById, API_BASE } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { getCurrentProfile } from '../../utils/profileService';
import { useApplyScopes, useChilds, useEventId, getEventUrlFromId as getEventUrlFromIdUtil } from '../../utils/storeUtils';
import { useDataStore } from '../../utils/dataManager';
import { useEventGeneralById, useProfileById, useEventProfileById, useEventsGeneralList } from '../../utils/dataManager';
import { formatErrorMessage } from '../../utils/errorHandler';
import { RemovableThumbnail } from '../common';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../common/PermissionGate';
import ConfirmDelete from '../modals/ConfirmDelete';
import PublicProfilePasswordModal from './PublicProfilePasswordModal';
import SimpleVirtuosoGrid from '../images/SimpleVirtuosoGrid';

export default function EditProfileModal({ isOpen, onClose, profile, eventUrl, urlHelpers, onSave, isCreating = false, initialEventId = null }) {
  const { t } = useTranslation();
  const { isRTL, startClass, endClass, ps, pe } = useRTL();
  const eventId = useEventId(eventUrl);
  const { showToast } = useToast();
  const MODAL_ID = 'edit-profile-modal';
  
  // Make currentProfile reactive - update when localStorage changes or selectedEventId changes
  const [currentProfile, setCurrentProfile] = useState(() => getCurrentProfile());
  const isCurrentProfileRestricted = Boolean(currentProfile?.restricted_to_event);
  const currentProfileRestrictedEventId = currentProfile?.restricted_to_event || null;
  
  // Get general profile data (includes email and other general fields)
  const generalProfile = useProfileById(profile?.id);
  
  // Local editing state
  const [editingProfile, setEditingProfile] = useState(null);
  const editingProfileRef = useRef(null); // Track latest editingProfile to avoid dependency issues
  const [initialProfileState, setInitialProfileState] = useState(null);
  const [initialSelectedEventId, setInitialSelectedEventId] = useState(null);
  const [profileEvents, setProfileEvents] = useState([]); // Track profile's events list
  const [nameConflict, setNameConflict] = useState(false);
  const [eventToRemove, setEventToRemove] = useState(null); // Event to remove (for confirmation modal)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Use initialEventId if provided, otherwise fall back to eventId from URL, or restricted event if current profile is restricted
  const [selectedEventId, setSelectedEventId] = useState(
    isCurrentProfileRestricted 
      ? currentProfileRestrictedEventId 
      : (initialEventId || eventId || null)
  );
  const [eventSearchTerm, setEventSearchTerm] = useState('');
  const [showEventDropdown, setShowEventDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const eventInputRef = useRef(null);
  const eventInputElementRef = useRef(null);
  const eventDropdownRef = useRef(null);
  
  // Track initial event-specific fields state for save/cancel
  const [initialEventSpecificState, setInitialEventSpecificState] = useState(null);
  const [initialEventSpecificEventId, setInitialEventSpecificEventId] = useState(null);
  const [savingEventSpecific, setSavingEventSpecific] = useState(false);
  const lastProcessedEventProfileRef = useRef(null); // Track last processed eventProfile to prevent loops
  
  // Restriction combobox state
  const [restrictionSearchTerm, setRestrictionSearchTerm] = useState('');
  const [showRestrictionDropdown, setShowRestrictionDropdown] = useState(false);
  const [restrictionHighlightedIndex, setRestrictionHighlightedIndex] = useState(0);
  const restrictionInputRef = useRef(null);
  const restrictionInputElementRef = useRef(null);
  const restrictionDropdownRef = useRef(null);
  const addEventSelectRef = useRef(null);
  const [selectedEventToAdd, setSelectedEventToAdd] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  // Tooltip states for help icons
  const [showRankTooltip, setShowRankTooltip] = useState(false);
  const [showPublicTooltip, setShowPublicTooltip] = useState(false);
  const [showManageEventTooltip, setShowManageEventTooltip] = useState(false);
  const [showImagesTooltip, setShowImagesTooltip] = useState(false);
  const [showAlbumsTooltip, setShowAlbumsTooltip] = useState(false);
  const [showGroupsTooltip, setShowGroupsTooltip] = useState(false);
  
  // Get events list from profile's events field in general store
  const generalEventsStore = useDataStore((state) => state.entities?.general?.events || {});
  const allEventsList = useEventsGeneralList(); // Get all events for lookup
  const eventsList = useMemo(() => {
    if (!generalProfile?.events || !Array.isArray(generalProfile.events)) {
      return [];
    }
    return generalProfile.events
      .map(eventId => {
        const event = generalEventsStore[eventId];
        if (!event) return null;
        // Ensure event_id is set for consistency
        return { ...event, event_id: event.event_id || event.id || eventId };
      })
      .filter(Boolean);
  }, [generalProfile?.events, generalEventsStore]);

  // Get profile events list (events currently assigned to profile)
  const profileEventsList = useMemo(() => {
    return profileEvents
      .map(eventId => {
        const event = generalEventsStore[eventId];
        if (!event) return null;
        return { ...event, event_id: event.event_id || event.id || eventId };
      })
      .filter(Boolean);
  }, [profileEvents, generalEventsStore]);

  // Get available events to add (all events from store not already in profileEvents)
  const availableEventsToAdd = useMemo(() => {
    const profileEventIds = new Set(profileEvents.map(id => String(id)));
    return Object.values(generalEventsStore)
      .map(event => {
        const eventId = event.event_id || event.id;
        if (!eventId || profileEventIds.has(String(eventId))) return null;
        return { ...event, event_id: eventId };
      })
      .filter(Boolean);
  }, [generalEventsStore, profileEvents]);
  
  // Helper to get eventUrl from eventId using store utility
  const getEventUrlFromId = useCallback((targetEventId) => {
    return getEventUrlFromIdUtil(targetEventId, eventId, eventUrl);
  }, [eventId, eventUrl]);
  
  const eventProfile = useEventProfileById(selectedEventId, profile?.id);
  
  // Get current profile's event-specific permissions for the selected event
  // Current profile's event permissions are stored in currentProfile.events[eventId]
  const currentProfileEventPermissions = useMemo(() => {
    if (!currentProfile || !selectedEventId) return null;
    const events = currentProfile.events || {};
    const eventIdStr = String(selectedEventId);
    // Try both string and direct key access (in case of type mismatch)
    return events[eventIdStr] || events[selectedEventId] || null;
  }, [currentProfile, selectedEventId]);
  
  // Check if current profile has permissions to grant these permissions
  // Check for explicit true value (handles both true/1 and false/0)
  const canGrantCanCreateEvents = Boolean(currentProfile?.can_create_events);
  const canGrantCanUploadAndDeleteImages = Boolean(currentProfileEventPermissions?.can_upload_and_delete_images);
  const canGrantCanEdit = Boolean(currentProfileEventPermissions?.can_edit);
  const canGrantAllImages = Boolean(currentProfileEventPermissions?.all_images);
  const canGrantAllGroups = Boolean(currentProfileEventPermissions?.all_groups);
  const canGrantAllAlbums = Boolean(currentProfileEventPermissions?.all_albums);
  const canGrantCanManageEvent = Boolean(currentProfileEventPermissions?.can_manage_event);
  const canGrantCanDeleteEvent = Boolean(currentProfileEventPermissions?.can_delete_event);
  
  
  // Apply scopes for profile relations
  useApplyScopes(profile?.id ? [
    { entity: 'event_profile', id: String(profile.id), eventId: selectedEventId || eventId },
    { entity: 'profile', id: String(profile.id), eventId: 'general' },
    ...(selectedEventId ? [{ entity: 'event_profiles', eventId: selectedEventId }] : [])
  ] : []);
  
  // Get profile images, albums, and groups from store (always call hooks, but use empty array when no event selected)
  const currentEventIdForChilds = selectedEventId || eventId || null;
  const profileImagesRaw = useChilds(currentEventIdForChilds, 'event_profiles', profile?.id, 'images', { sortBy: 'date', sortOrder: 'asc' });
  const profileAlbumsRaw = useChilds(currentEventIdForChilds, 'event_profiles', profile?.id, 'albums', { sortBy: 'name', sortOrder: 'asc' });
  const profileGroupsRaw = useChilds(currentEventIdForChilds, 'event_profiles', profile?.id, 'groups', { sortBy: 'name', sortOrder: 'asc' });
  
  // Only return data when selectedEventId is set (to ensure event-specific data)
  const profileImages = selectedEventId ? profileImagesRaw : [];
  const profileAlbums = selectedEventId ? profileAlbumsRaw : [];
  const profileGroups = selectedEventId ? profileGroupsRaw : [];
  
  // Compute when fields should be disabled based on database constraints
  // Constraint: can_upload_and_delete_images requires all_groups and can_edit, and no forbidden groups
  // all_groups should be disabled when can_upload_and_delete_images is enabled (cannot restrict groups if upload is enabled)
  const disableAllGroups = Boolean(editingProfile?.can_upload_and_delete_images);
  const allGroupsDisabledReason = disableAllGroups 
    ? t('editProfile.cannotRestrictGroupsWhenUploadIsEnabled')
    : null;
  
  // can_upload_and_delete_images should be disabled when:
  // - is_public is true (public profiles cannot have upload permissions), OR
  // - all_groups is false (groups are restricted), OR
  // - can_edit is false (edit permission required), OR
  // - there are forbidden groups (when all_groups is true and profileGroups.length > 0)
  const hasForbiddenGroups = Boolean(editingProfile?.all_groups) && profileGroups.length > 0;
  const disableCanUploadAndDeleteImages = Boolean(editingProfile?.is_public) || !Boolean(editingProfile?.all_groups) || !Boolean(editingProfile?.can_edit) || hasForbiddenGroups;
  const canUploadAndDeleteImagesDisabledReason = disableCanUploadAndDeleteImages
    ? Boolean(editingProfile?.is_public)
      ? t('editProfile.publicProfilesCannotHaveUploadPermissions')
      : !Boolean(editingProfile?.all_groups)
        ? t('editProfile.allPeopleAccessMustBeEnabled')
        : !Boolean(editingProfile?.can_edit)
          ? t('editProfile.canEditPermissionMustBeEnabled')
          : t('editProfile.removeForbiddenGroupsFirst')
    : null;
  
  // can_edit should be enabled/required when can_upload_and_delete_images is enabled
  // Note: This is more of a constraint than a disable - if can_upload_and_delete_images is enabled, can_edit must also be enabled
  // Also disabled when is_public is true (public profiles cannot have edit permissions)
  const requiresCanEdit = Boolean(editingProfile?.can_upload_and_delete_images);
  const disableCanEdit = Boolean(editingProfile?.is_public);
  
  
  // Get permissions for the selected event (not the URL event)
  // This ensures PermissionGate checks permissions for the event being edited
  const selectedEventUrl = useMemo(() => {
    if (!selectedEventId) return eventUrl;
    return getEventUrlFromId(selectedEventId) || eventUrl;
  }, [selectedEventId, eventUrl, eventsList]);
  
  const permissions = usePermissions(selectedEventUrl);

// Use editingProfile if it exists (even if null), otherwise fall back to generalProfile
const restrictedToEventId = editingProfile && 'restricted_to_event' in editingProfile
  ? editingProfile.restricted_to_event || null
  : (generalProfile?.restricted_to_event || null);
const restrictedEvent = useEventGeneralById(restrictedToEventId);
const restrictedEventName = editingProfile && 'restricted_to_event_name' in editingProfile
  ? (editingProfile.restricted_to_event_name || null)
  : (generalProfile?.restricted_to_event_name ?? restrictedEvent?.name ?? null);

const publicToggleRestrictedByEvent = !restrictedToEventId;
const publicToggleRestrictedByRank = (editingProfile?.hierarchy_rank ?? 0) > 0;
const publicToggleRestrictedByCanCreateEvents = Boolean(editingProfile?.can_create_events);
const disablePublicToggle = publicToggleRestrictedByEvent || publicToggleRestrictedByRank || publicToggleRestrictedByCanCreateEvents;
const publicToggleTooltip = publicToggleRestrictedByCanCreateEvents
  ? t('editProfile.profilesWithEventCreationPermissionsCannotBePublic')
  : publicToggleRestrictedByRank
    ? t('editProfile.publicProfilesMustUseRank0')
    : publicToggleRestrictedByEvent
      ? t('editProfile.publicAccessIsOnlyAvailableForProfilesRestrictedToEvent')
      : undefined;
const isRestricted = Boolean(editingProfile?.restricted_to_event || currentProfile?.restricted_to_event);
const disableRestrictionToggle = isCurrentProfileRestricted || Boolean(editingProfile?.is_public) || Boolean(editingProfile?.can_create_events);
const restrictionTooltip = isCurrentProfileRestricted
  ? t('editProfile.youAreRestrictedCannotChange')
  : Boolean(editingProfile?.is_public)
    ? t('editProfile.publicProfilesMustBeRestricted')
    : Boolean(editingProfile?.can_create_events)
      ? t('editProfile.profilesWithEventCreationCannotBeRestricted')
      : t('editProfile.manageRestrictions')
const disableEventManagementToggles = Boolean(editingProfile?.is_public);
const disableCanCreateEvents = disableEventManagementToggles || isRestricted;
const disableRankSelection = Boolean(editingProfile?.is_public);

// Check if is_public has changed from initial state
const isPublicChanged = useMemo(() => {
  if (!initialProfileState || !editingProfile) return false;
  const initialIsPublic = Boolean(initialProfileState.is_public);
  const currentIsPublic = Boolean(editingProfile.is_public);
  return initialIsPublic !== currentIsPublic;
}, [initialProfileState, editingProfile]);

// Check if both initial and current is_public are true (required for password change)
const canChangePassword = useMemo(() => {
  if (!initialProfileState || !editingProfile) return false;
  const initialIsPublic = Boolean(initialProfileState.is_public);
  const currentIsPublic = Boolean(editingProfile.is_public);
  return initialIsPublic && currentIsPublic;
}, [initialProfileState, editingProfile]);

// Check if changing from public to non-public (email becomes required and editable)
const changingFromPublicToNonPublic = useMemo(() => {
  if (!initialProfileState || !editingProfile || isCreating) return false;
  const initialIsPublic = Boolean(initialProfileState.is_public);
  const currentIsPublic = Boolean(editingProfile.is_public);
  return initialIsPublic && !currentIsPublic;
}, [initialProfileState, editingProfile, isCreating]);

// Check if profile is editable (for basic info section)
const isProfileEditable = useMemo(() => {
  if (isCreating) return true; // Always editable when creating
  // Check generalProfile first, then fall back to profile prop
  return Boolean(generalProfile?.is_editable ?? profile?.is_editable ?? true);
}, [isCreating, generalProfile?.is_editable, profile?.is_editable]);

  // Check if event-specific fields have been modified
  const hasEventSpecificChanges = useMemo(() => {
    if (!selectedEventId || !editingProfile) {
      return false;
    }
    
    if (!initialEventSpecificState) {
      return false;
    }
    
    const eventSpecificFields = [
      'can_manage_event', 'can_delete_event', 'can_upload_and_delete_images',
      'can_edit', 'all_images', 'all_groups', 'all_albums'
    ];
    
    for (const field of eventSpecificFields) {
      const currentValue = editingProfile[field];
      const initialValue = initialEventSpecificState[field];
      
      // Normalize to boolean, but treat undefined/null as false
      const normalizedCurrent = currentValue === undefined || currentValue === null ? false : Boolean(currentValue);
      const normalizedInitial = initialValue === undefined || initialValue === null ? false : Boolean(initialValue);
      
      if (normalizedCurrent !== normalizedInitial) {
        return true;
      }
    }
    
    return false;
  }, [editingProfile, initialEventSpecificState, selectedEventId]);

  // Check if profile has been modified (defined early so it can be used in handlers)
  const hasChanges = useMemo(() => {
    if (isCreating) {
      // When creating, require label to be filled
      const hasLabel = editingProfile?.label?.trim();
      return hasLabel;
    }
    
    // Don't enable save until both editingProfile and initialProfileState are set
    if (!editingProfile || !initialProfileState) {
      return false;
    }
    
    // Don't count selectedEventId change as a change for the main save button
    // Event-specific changes are handled separately with their own save button
    
    // Compare general profile fields (exclude event-specific fields)
    // Note: email is only included when creating; when editing, it's private and only editable via current_profile
    const generalFieldsToCompare = isCreating
      ? ['label', 'email', 'hierarchy_rank', 'can_create_events', 'is_public', 'restricted_to_event']
      : ['label', 'hierarchy_rank', 'can_create_events', 'is_public', 'restricted_to_event'];
    
    for (const field of generalFieldsToCompare) {
      const currentValue = editingProfile[field];
      const initialValue = initialProfileState[field];
      
      // For boolean fields, compare as booleans
      if (field === 'can_create_events' || field === 'is_public') {
        const normalizedCurrent = currentValue === undefined || currentValue === null ? false : Boolean(currentValue);
        const normalizedInitial = initialValue === undefined || initialValue === null ? false : Boolean(initialValue);
        if (normalizedCurrent !== normalizedInitial) {
          return true;
        }
      } else {
        // For other fields, compare as strings (handles null/undefined)
        const normalizedCurrent = currentValue === null || currentValue === undefined ? null : String(currentValue);
        const normalizedInitial = initialValue === null || initialValue === undefined ? null : String(initialValue);
        if (normalizedCurrent !== normalizedInitial) {
          return true;
        }
      }
    }
    
    return false;
  }, [editingProfile, initialProfileState, isCreating]);

  // Custom keyboard handler
  const handleEditProfileKeys = (e) => {
    // Handle event input keyboard events directly here (since customKeyHandler runs before onKeyDown)
    if (e.target === eventInputElementRef.current || eventInputRef.current?.contains(e.target)) {
      if (!showEventDropdown) {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          setShowEventDropdown(true);
          return true; // Handled
        }
        return false; // Let default behavior
      }

      // Handle keyboard navigation when dropdown is open
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          setHighlightedIndex(prev => 
            prev < selectableOptions.length - 1 ? prev + 1 : prev
          );
          return true;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          setHighlightedIndex(prev => prev > 0 ? prev - 1 : 0);
          return true;
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
              return true;
            }
          }
          return true;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          setShowEventDropdown(false);
          if (selectedEventId) {
            setEventSearchTerm(selectedEventName);
          } else {
            setEventSearchTerm('');
          }
          return true;
        default:
          return false; // Let other keys pass through
      }
    }
    
    // Handle button elements - prevent Enter from triggering toggle buttons, route to save instead
    const targetTagName = e.target.tagName?.toLowerCase();
    if (targetTagName === 'button') {
      // Check if this is the save button using data attribute
      const isSaveButton = e.target.dataset?.isSaveButton === 'true';
      
      // Allow save button to work normally
      if (isSaveButton && e.key === 'Enter') {
        return false; // Let the button's onClick handle it
      }
      
      // For other buttons (like toggles), prevent Enter from triggering them
      // Instead, trigger save if conditions are met
      if (e.key === 'Enter' && !loading && !nameConflict && editingProfile?.label.trim() && hasChanges) {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
        return true;
      }
      // For ESC key, return false to let useModalFocus handle closing the modal
      if (e.key === 'Escape') {
        return false;
      }
      // For other keys on buttons, allow default behavior
      return true;
    }
    
    // Allow all normal input behavior for input, textarea, and select elements
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      // For Enter key, save the profile (only if there are changes)
      if (e.key === 'Enter' && !loading && !nameConflict && editingProfile?.label.trim() && hasChanges) {
        e.preventDefault();
        handleSave();
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
  };

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId: MODAL_ID,
    modalType: 'popup',
    allowOutsideScroll: true,
    enableFocusTrapping: true,
    customKeyHandler: handleEditProfileKeys
  });

  // Register modal (scopes managed by useApplyScopes above)
  useEffect(() => {
    if (isOpen) {
      const { registerModal, unregisterModal } = useModalStore.getState();
      try {
        registerModal({ 
          id: MODAL_ID, 
          type: 'popup', 
          allowOutsideScroll: true 
        });
      } catch {}
      
      // Listen for logout to auto-close modal
      const handleAuthLogout = () => {
        onClose();
      };
      window.addEventListener('auth:logout', handleAuthLogout);
      
      return () => {
        try { unregisterModal(MODAL_ID); } catch {}
        window.removeEventListener('auth:logout', handleAuthLogout);
      };
    }
  }, [isOpen, profile?.id]);

  // Fetch general profile when modal opens
  useEffect(() => {
    if (isOpen && profile?.id && !isCreating) {
      profilesAPI.getGeneralById(profile.id).catch((error) => {
        console.error('[EditProfileModal] Failed to fetch general profile:', error);
      });
    }
  }, [isOpen, profile?.id, isCreating]);

  // Function to initialize editing state from profile data (reusable for opening and after creation)
  const initializeEditingState = useCallback((profileData, eventProfileData = null) => {
    // Merge profile data
    const mergedProfile = profileData;
    const eventData = eventProfileData || {};
    
    // Create initial editing state
    const initialEditingState = {
      id: mergedProfile.id || mergedProfile.profile_id,
      label: mergedProfile.label || '',
      hierarchy_rank: mergedProfile.hierarchy_rank || 0,
      can_create_events: Boolean(mergedProfile.can_create_events),
      can_upload_and_delete_images: Boolean(eventData.can_upload_and_delete_images ?? mergedProfile.can_upload_and_delete_images),
      can_edit: Boolean(eventData.can_edit ?? mergedProfile.can_edit),
      all_images: Boolean(eventData.all_images ?? mergedProfile.all_images),
      all_groups: Boolean(eventData.all_groups ?? mergedProfile.all_groups),
      all_albums: Boolean(eventData.all_albums ?? mergedProfile.all_albums),
      is_public: Boolean(mergedProfile.is_public),
      can_manage_event: Boolean(eventData.can_manage_event ?? mergedProfile.can_manage_event),
      can_delete_event: Boolean(eventData.can_delete_event ?? mergedProfile.can_delete_event),
      restricted_to_event: mergedProfile.restricted_to_event || null,
      restricted_to_event_name: mergedProfile.restricted_to_event_name || null
    };
    
    setEditingProfile(initialEditingState);
    setInitialProfileState(initialEditingState);
    setNameConflict(false);
    
    // Initialize profile events from mergedProfile
    const initialEvents = Array.isArray(mergedProfile.events) ? [...mergedProfile.events] : [];
    setProfileEvents(initialEvents);
    
    // Use restricted event if current profile is restricted, otherwise use initialEventId or eventId from URL
    const targetEventId = isCurrentProfileRestricted 
      ? currentProfileRestrictedEventId 
      : (initialEventId || eventId || null);
    setSelectedEventId(targetEventId);
    setInitialSelectedEventId(targetEventId);
    
    // Initialize event search term
    setEventSearchTerm('');
    setShowEventDropdown(false);
    
    // Reset add event selection
    setSelectedEventToAdd('');
    setEventToRemove(null);
  }, [initialEventId, eventId, isCurrentProfileRestricted, currentProfileRestrictedEventId]);


  // Initialize editing state from merged profile data (only once when modal opens)
  useEffect(() => {
    // When creating, profile is a template object, so check isCreating first
    if (isOpen && isCreating) {
      // Initialize for creating new profile
      // If initialEventId is set (filter is active), use it as default restriction
      const defaultRestrictedEventId = initialEventId || null;
      let defaultRestrictedEventName = null;
      if (defaultRestrictedEventId) {
        // Find event from all events list
        const foundEvent = allEventsList.find(e => {
          const evtId = e.event_id || e.id;
          return evtId && (String(evtId) === String(defaultRestrictedEventId));
        });
        defaultRestrictedEventName = foundEvent?.name || null;
      }
      
      // Email is included when creating (required for non-public profiles)
      // Password is included when creating public profiles (required)
      // When editing, email is private and only editable via AccountModal (current_profile)
      const initialEditingState = {
        label: profile?.label || '',
        email: '', // Required for non-public profiles when creating
        password: '', // Required for public profiles when creating
        hierarchy_rank: profile?.hierarchy_rank || 0,
        can_create_events: false,
        can_upload_and_delete_images: Boolean(profile?.can_upload_and_delete_images),
        can_edit: Boolean(profile?.can_edit),
        all_images: Boolean(profile?.all_images),
        all_groups: Boolean(profile?.all_groups),
        all_albums: Boolean(profile?.all_albums),
        is_public: Boolean(profile?.is_public),
        can_manage_event: false,
        can_delete_event: false,
        restricted_to_event: defaultRestrictedEventId,
        restricted_to_event_name: defaultRestrictedEventName
      };
      setEditingProfile(initialEditingState);
      setInitialProfileState(initialEditingState);
      setNameConflict(false);
      setProfileEvents([]);
      const targetEventId = isCurrentProfileRestricted 
        ? currentProfileRestrictedEventId 
        : (initialEventId || eventId || null);
      setSelectedEventId(targetEventId);
      setInitialSelectedEventId(targetEventId);
      setEventSearchTerm('');
      setShowEventDropdown(false);
      setSelectedEventToAdd('');
      setEventToRemove(null);
      // Set restriction search term if restriction is set
      if (defaultRestrictedEventName) {
        setRestrictionSearchTerm(defaultRestrictedEventName);
      } else {
        setRestrictionSearchTerm('');
      }
    } else if (isOpen && profile && !isCreating) {
      // Prevent re-initialization if we've already initialized with this profile ID
      // (e.g., after creating a profile, we initialize manually, then useEffect runs again)
      const profileId = profile?.id || profile?.profile_id;
      if (editingProfile?.id && String(editingProfile.id) === String(profileId)) {
        return;
      }
      
      // Use the merged profile for initial data, but only set it once
      const initialProfile = generalProfile ? { ...profile, ...generalProfile } : profile;
      // Get event-specific data from eventProfile if available
      const eventProfileData = eventProfile || {};
      // Use the extracted function to initialize editing state
      initializeEditingState(initialProfile, eventProfileData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, profile?.id, initialEventId, isCreating]); // Only re-initialize when modal opens or profile ID changes (generalProfile intentionally excluded to prevent input resets)

  // Update restriction name when events load (for creating new profiles)
  useEffect(() => {
    if (isOpen && isCreating && initialEventId && editingProfile && 
        String(editingProfile.restricted_to_event || '') === String(initialEventId) && 
        !editingProfile.restricted_to_event_name) {
      // Find event from all events list
      const foundEvent = allEventsList.find(e => {
        const evtId = e.event_id || e.id;
        return evtId && (String(evtId) === String(initialEventId));
      });
      
      if (foundEvent?.name) {
        setEditingProfile(prev => ({
          ...prev,
          restricted_to_event_name: foundEvent.name
        }));
        setRestrictionSearchTerm(foundEvent.name);
      }
    }
  }, [isOpen, isCreating, initialEventId, allEventsList, editingProfile?.restricted_to_event, editingProfile?.restricted_to_event_name]);

  // Check name conflict when modal opens for creating (if editingProfile has a label)
  useEffect(() => {
    if (isOpen && isCreating && editingProfile?.label?.trim()) {
      checkNameConflict(editingProfile.label);
    }
  }, [isOpen, isCreating, editingProfile?.label]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update profileEvents when generalProfile.events changes
  useEffect(() => {
    if (isOpen && generalProfile?.events && Array.isArray(generalProfile.events)) {
      setProfileEvents([...generalProfile.events]);
    }
  }, [isOpen, generalProfile?.events]);


  // Fetch profile with scopes (images and albums relations) when modal opens and event is selected
  useEffect(() => {
    const fetchProfileWithScopes = async () => {
      if (!isOpen || !profile || isCreating || !selectedEventId) {
        return;
      }
      
      try {
        // First try to get eventUrl from eventsList
        let targetEventUrl = getEventUrlFromId(selectedEventId);
        
        // If not found in eventsList, try to get it from API
        if (!targetEventUrl) {
          targetEventUrl = await getEventUrlById(selectedEventId);
        }
        
        // If we still don't have eventUrl, fetch event profiles first (this might populate eventsList)
        if (!targetEventUrl) {
          try {
            await profilesAPI.getByEvent(selectedEventId);
            // Try again after fetching event profiles
            targetEventUrl = getEventUrlFromId(selectedEventId);
            if (!targetEventUrl) {
              targetEventUrl = await getEventUrlById(selectedEventId);
            }
          } catch (error) {
            console.error('[EditProfileModal] Failed to fetch event profiles:', error);
          }
        }
        
        // If we have eventUrl, fetch profile with scopes
        if (targetEventUrl) {
          await profilesAPI.getById(profile.id, targetEventUrl);
        }
      } catch (error) {
        console.error('[EditProfileModal] Failed to fetch profile with scopes:', error);
        showToast(formatErrorMessage('load profile details', error), 'error');
      }
    };

    fetchProfileWithScopes();
  }, [isOpen, profile?.id, selectedEventId, isCreating, showToast, eventsList]);

  // Fetch event profiles when selectedEventId changes
  useEffect(() => {
    if (!isOpen || !profile || isCreating || !selectedEventId) {
      return;
    }
    
    const fetchEventProfiles = async () => {
      try {
        await profilesAPI.getByEvent(selectedEventId);
      } catch (error) {
        console.error('[EditProfileModal] Failed to fetch event profiles:', error);
      }
    };

    fetchEventProfiles();
  }, [isOpen, profile?.id, selectedEventId, isCreating]);

  // Update currentProfile from localStorage when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentProfile(getCurrentProfile());
    }
  }, [isOpen]);

  // Listen for localStorage changes (custom event for same-tab updates, storage event for cross-tab updates)
  useEffect(() => {
    const handleCurrentProfileUpdate = () => {
      setCurrentProfile(getCurrentProfile());
    };
    
    const handleStorageChange = (e) => {
      if (e.key === 'currentProfile' || e.key === null) {
        setCurrentProfile(getCurrentProfile());
      }
    };
    
    // Listen for custom event dispatched by dataManager when currentProfile is updated
    window.addEventListener('localStorage:currentProfile', handleCurrentProfileUpdate);
    // Listen for storage events (cross-tab updates)
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('localStorage:currentProfile', handleCurrentProfileUpdate);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // Fetch current profile with event-specific data when selectedEventId changes
  useEffect(() => {
    if (!isOpen || !selectedEventId || isCreating) {
      return;
    }
    
    const fetchCurrentProfileForEvent = async () => {
      try {
        // Get event URL from event ID
        let targetEventUrl = getEventUrlFromId(selectedEventId);
        if (!targetEventUrl) {
          // If not found in store, try to fetch it from the backend
          targetEventUrl = await getEventUrlById(selectedEventId);
        }
        
        // Fetch current profile with event context
        if (targetEventUrl) {
          await profilesAPI.getCurrentProfile(targetEventUrl);
          // currentProfile state will be updated via the 'localStorage:currentProfile' event listener
          // But also update immediately in case event hasn't fired yet
          setCurrentProfile(getCurrentProfile());
        } else {
          // If we can't get event URL, we can't fetch with event context
          // The hook will still work but might not have the latest data
          console.warn('[EditProfileModal] Could not determine event URL for selected event:', selectedEventId);
        }
      } catch (error) {
        console.error('[EditProfileModal] Failed to fetch current profile for event:', error);
      }
    };

    fetchCurrentProfileForEvent();
  }, [isOpen, selectedEventId, isCreating]);

  // Reset initial state when selectedEventId changes
  useEffect(() => {
    if (!isOpen) return;
    
    // Reset initial state when event changes
    setInitialEventSpecificState(null);
    setInitialEventSpecificEventId(null);
    lastProcessedEventProfileRef.current = null;
  }, [isOpen, selectedEventId]);

  // Keep ref in sync with editingProfile state
  useEffect(() => {
    editingProfileRef.current = editingProfile;
  }, [editingProfile]);

  // Update event-specific fields when eventProfile loads for current event
  // Also track initial state for save/cancel
  useEffect(() => {
    if (!isOpen) return;
    
    // If we have eventProfile, we can proceed even without editingProfileRef
    // (it will be set when editingProfile initializes)
    const canProceed = selectedEventId && eventProfile;
    const needsEditingProfile = selectedEventId && !eventProfile && !initialEventSpecificState;
    
    if (!canProceed && needsEditingProfile && !editingProfileRef.current) {
      return;
    }
    
    if (selectedEventId && eventProfile) {
      const eventSpecificData = {
        can_upload_and_delete_images: Boolean(eventProfile.can_upload_and_delete_images),
        can_edit: Boolean(eventProfile.can_edit),
        all_images: Boolean(eventProfile.all_images),
        all_groups: Boolean(eventProfile.all_groups),
        all_albums: Boolean(eventProfile.all_albums),
        can_manage_event: Boolean(eventProfile.can_manage_event),
        can_delete_event: Boolean(eventProfile.can_delete_event),
      };
      
      // Create a key to identify this eventProfile instance
      // This helps us detect when eventProfile loads after fallback was set
      const eventProfileKey = `${selectedEventId}:${JSON.stringify(eventSpecificData)}`;
      const isNewEventProfile = lastProcessedEventProfileRef.current !== eventProfileKey;
      const isDifferentEvent = initialEventSpecificEventId && String(initialEventSpecificEventId) !== String(selectedEventId);
      
      // Always update initial state when:
      // 1. This is a new eventProfile (different from what we processed before)
      // 2. Event changed (different eventId)
      // 3. We don't have initial state yet
      // This ensures we always get the correct baseline from eventProfile (authoritative source)
      if (isNewEventProfile || isDifferentEvent || !initialEventSpecificState) {
        setInitialEventSpecificState(eventSpecificData);
        setInitialEventSpecificEventId(selectedEventId);
        lastProcessedEventProfileRef.current = eventProfileKey;
        
        // Update editingProfile to match the loaded eventProfile data (only if it exists)
        if (editingProfileRef.current) {
          setEditingProfile(prev => {
            if (!prev) return null;
            return {
              ...prev,
              ...eventSpecificData,
            };
          });
        }
      }
    } else if (selectedEventId && !eventProfile) {
      // Reset tracking when eventProfile becomes null
      lastProcessedEventProfileRef.current = null;
      
      // Fallback: Set initial state from editingProfile's current values if eventProfile not loaded yet
      // This allows change detection to work even before eventProfile loads
      // Use ref to read current values without adding editingProfile to dependencies
      // NOTE: This will be overridden when eventProfile loads (see condition above)
      if (!initialEventSpecificState) {
        const currentProfile = editingProfileRef.current;
        if (currentProfile) {
          const fallbackInitialState = {
            can_upload_and_delete_images: Boolean(currentProfile.can_upload_and_delete_images),
            can_edit: Boolean(currentProfile.can_edit),
            all_images: Boolean(currentProfile.all_images),
            all_groups: Boolean(currentProfile.all_groups),
            all_albums: Boolean(currentProfile.all_albums),
            can_manage_event: Boolean(currentProfile.can_manage_event),
            can_delete_event: Boolean(currentProfile.can_delete_event),
          };
          
          setInitialEventSpecificState(fallbackInitialState);
          setInitialEventSpecificEventId(selectedEventId);
        }
      }
    } else if (!selectedEventId) {
      // Reset event-specific fields when no event is selected
      const resetData = {
        can_upload_and_delete_images: false,
        can_edit: false,
        all_images: false,
        all_groups: false,
        all_albums: false,
        can_manage_event: false,
        can_delete_event: false,
      };
      
      setEditingProfile(prev => ({
        ...prev,
        ...resetData,
      }));
      
      setInitialEventSpecificState(null);
      setInitialEventSpecificEventId(null);
      lastProcessedEventProfileRef.current = null;
    }
  }, [isOpen, eventProfile, selectedEventId]); // Removed initialEventSpecificState from deps to prevent infinite loop

  const checkNameConflict = async (label) => {
    if (!label || !label.trim()) {
      setNameConflict(false);
      setError(''); // Clear error when label is empty
      return;
    }

    try {
      // When creating, pass null/undefined for excludeProfileId; when editing, pass the profile ID
      const excludeProfileId = isCreating ? null : editingProfile?.id;
      
      // Get restricted event URL if restriction is set
      let restrictedToEventUrl = null;
      const restrictedEventId = editingProfile?.restricted_to_event;
      if (restrictedEventId) {
        restrictedToEventUrl = getEventUrlFromId(restrictedEventId);
        // If not found in store, try to fetch it
        if (!restrictedToEventUrl) {
          restrictedToEventUrl = await getEventUrlById(restrictedEventId);
        }
      }
      
      const result = await profilesAPI.checkName(label.trim(), excludeProfileId, restrictedToEventUrl);
      const hasConflict = result.conflict || false;
      setNameConflict(hasConflict);
      // Clear error if check-name returns false (no conflict)
      if (!hasConflict) {
        setError('');
      }
    } catch (error) {
      console.error('Error checking name conflict:', error);
      setNameConflict(false);
      setError(''); // Clear error on check failure
    }
  };

  const handleFieldChange = (field, value) => {
    setEditingProfile(prev => {
      const updated = { ...prev, [field]: value };
      
      // When toggling is_public
      if (field === 'is_public') {
        if (!Boolean(value) && isCreating) {
          // When creating: clear password if switching to non-public
          updated.password = '';
        } else if (!Boolean(value) && !isCreating && Boolean(prev.is_public)) {
          // When editing: initialize email if changing from public to non-public
          // Use existing email from generalProfile if available, otherwise empty string
          if (!updated.email && generalProfile?.email) {
            updated.email = generalProfile.email;
          } else if (!updated.email) {
            updated.email = '';
          }
        } else if (Boolean(value) && !isCreating && !Boolean(prev.is_public)) {
          // When editing: clear email if changing from non-public to public
          updated.email = '';
        }
      }
      
      // Update ref immediately so it's available in timeouts
      editingProfileRef.current = updated;
      return updated;
    });
    
    // Check name conflict after changing label or restricted_to_event
    if (field === 'label' || field === 'restricted_to_event') {
      if (handleFieldChange._timeout) clearTimeout(handleFieldChange._timeout);
      handleFieldChange._timeout = setTimeout(() => {
        // For label changes, use the new value; for restricted changes, use current label from ref (latest state)
        const labelToCheck = field === 'label' ? value : editingProfileRef.current?.label;
        if (labelToCheck?.trim()) {
          checkNameConflict(labelToCheck);
        }
      }, 300);
    }
  };

  const handleSave = async () => {
    // When profile is not editable, only validate and send event-specific fields
    if (!isProfileEditable && !isCreating) {
      // Only save event-specific fields when profile is not editable
      if (!selectedEventId) {
        showToast(t('editProfile.pleaseSelectEventToUpdateEventSpecificAuthorizations'), 'error');
        return;
      }
      
      if (!hasEventSpecificChanges) {
        showToast(t('editProfile.noEventSpecificChangesToSave'), 'info');
        return;
      }
      
      // Use the event-specific save handler (which only sends event-specific fields)
      await handleSaveEventSpecific();
      return;
    }

    // Normal validation for editable profiles or when creating
    if (nameConflict) {
      showToast(t('editProfile.cannotSaveProfileNameAlreadyExists'), 'error');
      return;
    }

    if (!editingProfile.label.trim()) {
      showToast(t('editProfile.profileNameCannotBeEmpty'), 'error');
      return;
    }

    // Email is required for non-public profiles when creating
    if (isCreating && !Boolean(editingProfile.is_public)) {
      const emailValue = editingProfile.email?.trim();
      if (!emailValue || emailValue.length === 0) {
        showToast(t('editProfile.emailIsRequiredForNonPublicProfiles'), 'error');
        return;
      }
    }

    // Email is required when changing from public to non-public
    if (!isCreating && changingFromPublicToNonPublic) {
      const emailValue = editingProfile.email?.trim();
      if (!emailValue || emailValue.length === 0) {
        showToast(t('editProfile.emailIsRequiredWhenChangingFromPublicToNonPublic'), 'error');
        return;
      }
    }

    // Password is required for public profiles when creating
    if (isCreating && Boolean(editingProfile.is_public)) {
      const passwordValue = editingProfile.password?.trim();
      if (!passwordValue || passwordValue.length === 0) {
        showToast(t('editProfile.passwordIsRequiredForPublicProfiles'), 'error');
        return;
      }
    }

    setLoading(true);
    setError('');

    try {
      // General profile data (always saved when editable)
      // Convert boolean values (1/0) to true/false for backend
      const generalProfileData = {
        label: editingProfile.label,
        hierarchy_rank: editingProfile.hierarchy_rank,
        can_create_events: Boolean(editingProfile.can_create_events),
        is_public: Boolean(editingProfile.is_public),
        restricted_to_event: editingProfile.restricted_to_event || null
      };
      
      // Include email when:
      // - Creating non-public profiles (required)
      // - Changing from public to non-public (required)
      // When editing normally, email is private and only editable via AccountModal (current_profile)
      if (isCreating && editingProfile.email) {
        generalProfileData.email = editingProfile.email.trim() || null;
      } else if (!isCreating && changingFromPublicToNonPublic && editingProfile.email) {
        generalProfileData.email = editingProfile.email.trim() || null;
      }

      // Include password only when creating public profiles (required)
      // When editing, password is changed via separate modal
      if (isCreating && Boolean(editingProfile.is_public) && editingProfile.password) {
        generalProfileData.password = editingProfile.password.trim() || null;
      }

      // Event-specific profile data (only if selectedEventId is set)
      // Convert boolean values (1/0) to true/false for backend
      const eventProfileData = selectedEventId ? {
        can_manage_event: Boolean(editingProfile.can_manage_event),
        can_delete_event: Boolean(editingProfile.can_delete_event),
        can_upload_and_delete_images: Boolean(editingProfile.can_upload_and_delete_images),
        can_edit: Boolean(editingProfile.can_edit),
        all_images: Boolean(editingProfile.all_images),
        all_groups: Boolean(editingProfile.all_groups),
        all_albums: Boolean(editingProfile.all_albums)
      } : {};

      if (isCreating) {
        // Create new profile - combine general and event data
        const createData = { ...generalProfileData, ...eventProfileData };
        const targetEventUrl = selectedEventId ? getEventUrlFromId(selectedEventId) : eventUrl;
        const createdProfile = await profilesAPI.create(createData, targetEventUrl || eventUrl);
        showToast(t('editProfile.profileCreatedSuccessfully'), 'success');
        
        // After creation, get profile from store (API interceptor should have added it)
        const createdProfileId = createdProfile?.id || createdProfile?.profile_id;
        if (createdProfileId) {
          const store = useDataStore.getState();
          const generalProfileFromStore = store.entities?.general?.profiles?.[createdProfileId];
          const eventProfileFromStore = selectedEventId 
            ? store.entities?.event_profiles?.[`${selectedEventId}:${createdProfileId}`]
            : null;
          
          if (generalProfileFromStore) {
            // Use the extracted function to initialize editing state (switch to edit mode)
            initializeEditingState(generalProfileFromStore, eventProfileFromStore);
            
            // Notify parent to update props
            if (onSave) {
              onSave(generalProfileFromStore);
            }
          }
        }
      } else {
        // Update existing profile
        // Combine general and event data - _update_profile handles separation
        // Note: event-specific data is included when selectedEventId is set, so it will be saved
        const updateData = { ...generalProfileData, ...eventProfileData };
        const targetEventUrl = selectedEventId ? getEventUrlFromId(selectedEventId) : eventUrl;
        await profilesAPI.update(editingProfile.id, updateData, targetEventUrl || null);
        
        // Update initial event-specific state if we saved event-specific changes
        if (hasEventSpecificChanges && selectedEventId && initialEventSpecificState) {
          setInitialEventSpecificState({
            can_manage_event: editingProfile.can_manage_event,
            can_delete_event: editingProfile.can_delete_event,
            can_upload_and_delete_images: editingProfile.can_upload_and_delete_images,
            can_edit: editingProfile.can_edit,
            all_images: editingProfile.all_images,
            all_groups: editingProfile.all_groups,
            all_albums: editingProfile.all_albums
          });
        }
        
        showToast(t('editProfile.profileUpdatedSuccessfully'), 'success');
        
        // Changes are automatically applied by apiService interceptor
        if (onSave) onSave();
        
        // Close modal when updating
        onClose();
      }
    } catch (error) {
      console.error(`Failed to ${isCreating ? 'create' : 'update'} profile:`, error);
      const rawErrorMsg = error.response?.data?.error || error.message || '';
      
      // Normalize error message for case-insensitive comparison
      const normalizedErrorMsg = rawErrorMsg.toLowerCase();
      
      // Check for specific database policy errors that need special handling
      if (normalizedErrorMsg.includes('profile label already exists')) {
        // Only label exists (not the combination)
        // Handles: "Profile label already exists", "Policy error: Profile label already exists", etc.
        setNameConflict(true);
        setError('');
        // Show both inline error and toast
        showToast(t('editProfile.profileLabelAlreadyExists'), 'error');
      } else {
        // Use the error handler for user-friendly messages
        const errorMsg = formatErrorMessage(isCreating ? 'create' : 'update profile', error);
        setError(errorMsg);
        showToast(errorMsg, 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  // Get selected event name for display
  const selectedEventName = useMemo(() => {
    if (!selectedEventId) return '';
    // First try to find in eventsList (profile's events)
    let event = eventsList.find(e => {
      const evtId = e.event_id || e.id;
      return evtId && String(evtId) === String(selectedEventId);
    });
    // If not found and creating, try allEventsList
    if (!event && isCreating) {
      event = allEventsList.find(e => {
        const evtId = e.event_id || e.id;
        return evtId && String(evtId) === String(selectedEventId);
      });
    }
    return event?.name || t('profilesGallery.untitledEvent');
  }, [selectedEventId, eventsList, allEventsList, isCreating, t]);

  // Update restriction search term when restricted event changes
  useEffect(() => {
    if (!showRestrictionDropdown) {
      // Use editingProfile first, then fall back to computed values
      const currentRestrictionId = editingProfile?.restricted_to_event || restrictedToEventId;
      const currentRestrictionName = editingProfile?.restricted_to_event_name || restrictedEventName;
      if (currentRestrictionId && currentRestrictionName) {
        setRestrictionSearchTerm(currentRestrictionName);
      } else if (!currentRestrictionId) {
        setRestrictionSearchTerm('');
      }
    }
  }, [editingProfile?.restricted_to_event, editingProfile?.restricted_to_event_name, restrictedToEventId, restrictedEventName, showRestrictionDropdown]);

  // Close restriction dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        restrictionInputRef.current &&
        !restrictionInputRef.current.contains(event.target) &&
        restrictionDropdownRef.current &&
        !restrictionDropdownRef.current.contains(event.target)
      ) {
        setShowRestrictionDropdown(false);
        // Reset search term to display name (use editingProfile first)
        const currentRestrictionId = editingProfile?.restricted_to_event || restrictedToEventId;
        const currentRestrictionName = editingProfile?.restricted_to_event_name || restrictedEventName;
        if (currentRestrictionId && currentRestrictionName) {
          setRestrictionSearchTerm(currentRestrictionName);
        } else {
          setRestrictionSearchTerm('');
        }
      }
    };

    if (showRestrictionDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showRestrictionDropdown, editingProfile?.restricted_to_event, editingProfile?.restricted_to_event_name, restrictedToEventId, restrictedEventName]);

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

  // Handle event selection (prevent if there are unsaved changes)
  const handleEventSelect = (evtId) => {
    if (hasEventSpecificChanges) {
      showToast(t('editProfile.pleaseSaveOrCancelChangesBeforeSwitchingEvents'), 'error');
      return;
    }
    
    setSelectedEventId(evtId);
    setEventSearchTerm('');
    setShowEventDropdown(false);
    setHighlightedIndex(0);
  };

  // Save event-specific authorizations
  const handleSaveEventSpecific = async () => {
    if (!selectedEventId || !editingProfile) return;
    
    setSavingEventSpecific(true);
    setError('');
    
    try {
      // Send all event-specific fields - backend will handle permission validation
      // Convert boolean values (1/0) to true/false for backend
      const eventProfileData = {
        can_manage_event: Boolean(editingProfile.can_manage_event),
        can_delete_event: Boolean(editingProfile.can_delete_event),
        can_upload_and_delete_images: Boolean(editingProfile.can_upload_and_delete_images),
        can_edit: Boolean(editingProfile.can_edit),
        all_images: Boolean(editingProfile.all_images),
        all_groups: Boolean(editingProfile.all_groups),
        all_albums: Boolean(editingProfile.all_albums)
      };
      
      const targetEventUrl = getEventUrlFromId(selectedEventId) || eventUrl;
      await profilesAPI.update(editingProfile.id, eventProfileData, targetEventUrl || null);
      
      // Update initial state to current state after successful save
      setInitialEventSpecificState({
        can_manage_event: editingProfile.can_manage_event,
        can_delete_event: editingProfile.can_delete_event,
        can_upload_and_delete_images: editingProfile.can_upload_and_delete_images,
        can_edit: editingProfile.can_edit,
        all_images: editingProfile.all_images,
        all_groups: editingProfile.all_groups,
        all_albums: editingProfile.all_albums
      });
      
      showToast(t('editProfile.eventSpecificAuthorizationsSavedSuccessfully'), 'success');
    } catch (error) {
      console.error('Failed to save event-specific authorizations:', error);
      const errorMsg = error.response?.data?.error || error.message || t('editProfile.failedToSaveEventSpecificAuthorizations');
      setError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setSavingEventSpecific(false);
    }
  };

  // Cancel event-specific changes (revert to initial state)
  const handleCancelEventSpecific = () => {
    if (!initialEventSpecificState || !editingProfile) return;
    
    setEditingProfile(prev => ({
      ...prev,
      can_manage_event: initialEventSpecificState.can_manage_event,
      can_delete_event: initialEventSpecificState.can_delete_event,
      can_upload_and_delete_images: initialEventSpecificState.can_upload_and_delete_images,
      can_edit: initialEventSpecificState.can_edit,
      all_images: initialEventSpecificState.all_images,
      all_groups: initialEventSpecificState.all_groups,
      all_albums: initialEventSpecificState.all_albums
    }));
  };

  // Handle removing an event from profile (shows confirmation modal)
  const handleRemoveProfileEvent = (eventIdToRemove) => {
    if (!editingProfile?.id || !eventIdToRemove) return;
    setEventToRemove(eventIdToRemove);
  };

  // Actually remove event after confirmation
  const handleConfirmRemoveEvent = async () => {
    if (!editingProfile?.id || !eventToRemove) return;
    
    try {
      await profilesAPI.removeEvent(editingProfile.id, eventToRemove);
      // Changes are automatically applied by apiService interceptor
      
      // If the removed event is currently selected, clear the selection
      if (selectedEventId && String(selectedEventId) === String(eventToRemove)) {
        setSelectedEventId(null);
        setEventSearchTerm('');
        setShowEventDropdown(false);
      }
      
      showToast(t('editProfile.eventRemovedFromProfile'), 'success');
      setEventToRemove(null);
    } catch (error) {
      console.error('Failed to remove event from profile:', error);
      showToast(formatErrorMessage('remove event', error), 'error');
      setEventToRemove(null);
    }
  };

  // Handle adding an event to profile
  const handleAddProfileEvent = async (eventIdToAdd) => {
    if (!editingProfile?.id || !eventIdToAdd) return;
    
    try {
      await profilesAPI.addEvent(editingProfile.id, eventIdToAdd);
      // Changes are automatically applied by apiService interceptor
      showToast(t('editProfile.eventAddedToProfile'), 'success');
    } catch (error) {
      console.error('Failed to add event to profile:', error);
      showToast(formatErrorMessage('add event', error), 'error');
    }
  };

  // Get selectable options (including "Select Event" and "Clear" if applicable)
  const selectableOptions = useMemo(() => {
    const options = [];
    // Add "Clear" option if an event is selected and not searching
    if (selectedEventId && !eventSearchTerm) {
      options.push({ id: null, name: t('editProfile.clearSelection'), isPlaceholder: false, isClear: true });
    }
    // Add "Select Event" if no eventId from URL and not searching
    if (!eventId && !eventSearchTerm && !selectedEventId) {
      options.push({ id: null, name: t('editProfile.selectEvent'), isPlaceholder: true });
    }
    filteredEvents.forEach(event => {
      const evtId = event?.event_id || event?.id;
      const evtName = event?.name || t('profilesGallery.untitledEvent');
      options.push({ id: evtId, name: evtName, isPlaceholder: false });
    });
    return options;
  }, [filteredEvents, eventId, eventSearchTerm, selectedEventId, t]);

  // Handle keyboard navigation (backup handler, but modal handler takes precedence)
  const handleEventInputKeyDown = (e) => {
    // This handler is kept as backup, but modal handler handles most cases
    // It's still useful for cases where modal handler might not catch it
    if (!showEventDropdown && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      e.stopPropagation();
      setShowEventDropdown(true);
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
        if (selectedEventId) {
          setEventSearchTerm(selectedEventName);
        } else {
          setEventSearchTerm('');
        }
      }
    };

    if (showEventDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showEventDropdown, selectedEventId, selectedEventName]);

  // Update search term when selected event changes (but not when dropdown is open)
  useEffect(() => {
    if (!showEventDropdown) {
      if (selectedEventId && selectedEventName) {
        setEventSearchTerm(selectedEventName);
      } else if (!selectedEventId) {
        setEventSearchTerm('');
      }
    }
  }, [selectedEventId, selectedEventName, showEventDropdown]);

  // Generate urlHelpers dynamically based on selectedEventId (or fallback to prop urlHelpers)
  const dynamicUrlHelpers = useMemo(() => {
    // If we have selectedEventId, create urlHelpers for it
    if (selectedEventId) {
      const urlHelpersObj = {
        getDisplayImageUrl: (imageId) => {
          if (!selectedEventId) return null;
          return `${API_BASE}/api/events/${selectedEventId}/display/${imageId}.webp`;
        },
        getThumbnailUrl: (imageId) => {
          if (!selectedEventId) return null;
          return `${API_BASE}/api/events/${selectedEventId}/thumb/${imageId}.webp`;
        },
        getHighQualityUrl: (imageId) => {
          if (!selectedEventId) return null;
          return `${API_BASE}/api/events/${selectedEventId}/high_quality/${imageId}.jpg`;
        },
        getOriginalUrl: (imageId) => {
          if (!selectedEventId) return null;
          return `${API_BASE}/api/events/${selectedEventId}/original/${imageId}.jpg`;
        },
        getFaceCropUrl: (faceId) => {
          if (!selectedEventId) return null;
          return `${API_BASE}/api/events/${selectedEventId}/faces/${faceId}.webp`;
        },
        getRepresentativeUrl: (entity, parentId) => {
          if (!selectedEventId) return null;
          return `${API_BASE}/api/events/${selectedEventId}/${entity}/${parentId}/representative`;
        },
        getRepresentativeWithFallback: (entity, parentId) => {
          if (!selectedEventId) return null;
          return `${API_BASE}/api/events/${selectedEventId}/${entity}/${parentId}/representative`;
        },
        getDefaultPlaceholder: () => null,
        getRelativeDisplayUrl: (imageId) => {
          if (!selectedEventId) return null;
          return `/api/events/${selectedEventId}/display/${imageId}.webp`;
        },
        getRelativeThumbnailUrl: (imageId) => {
          if (!selectedEventId) return null;
          return `/api/events/${selectedEventId}/thumb/${imageId}.webp`;
        },
        getRelativeFaceCropUrl: (faceId) => {
          if (!selectedEventId) return null;
          return `/api/events/${selectedEventId}/faces/${faceId}.webp`;
        },
        navigateToGroups: () => {
          const targetEventUrl = getEventUrlFromId(selectedEventId);
          if (!targetEventUrl) return;
          window.location.href = `/${targetEventUrl}/people`;
        },
        navigateToAlbums: () => {
          const targetEventUrl = getEventUrlFromId(selectedEventId);
          if (!targetEventUrl) return;
          window.location.href = `/${targetEventUrl}/albums`;
        },
        navigateToTimeline: () => {
          const targetEventUrl = getEventUrlFromId(selectedEventId);
          if (!targetEventUrl) return;
          window.location.href = `/${targetEventUrl}/timeline`;
        },
        navigateToUploads: () => {
          const targetEventUrl = getEventUrlFromId(selectedEventId);
          if (!targetEventUrl) return;
          window.location.href = `/${targetEventUrl}/uploads`;
        },
        navigateToRequests: () => {
          const targetEventUrl = getEventUrlFromId(selectedEventId);
          if (!targetEventUrl) return;
          window.location.href = `/${targetEventUrl}/requests`;
        },
        navigateToFeedbacks: () => {
          const targetEventUrl = getEventUrlFromId(selectedEventId);
          if (!targetEventUrl) return;
          window.location.href = `/${targetEventUrl}/feedbacks`;
        },
      };
      return urlHelpersObj;
    }
    // Fallback to prop urlHelpers if available
    return urlHelpers || null;
  }, [selectedEventId, urlHelpers, eventsList, eventId, eventUrl]);

  const handleRemoveImage = async (imageId) => {
    try {
      const targetEventUrl = getEventUrlFromId(selectedEventId) || eventUrl;
      await profilesAPI.removeImagesFromProfile(editingProfile.id, [imageId], targetEventUrl);
      // Changes are automatically applied by apiService interceptor
      showToast(t('editProfile.photoRemovedFromProfile'), 'success');
    } catch (error) {
      console.error('Failed to remove photo:', error);
      showToast(formatErrorMessage('remove photo', error), 'error');
    }
  };

  const handleRemoveAlbum = async (albumId) => {
    try {
      const targetEventUrl = getEventUrlFromId(selectedEventId) || eventUrl;
      await profilesAPI.removeAlbumsFromProfile(editingProfile.id, [albumId], targetEventUrl);
      // Changes are automatically applied by apiService interceptor
      showToast(t('editProfile.albumRemovedFromProfile'), 'success');
    } catch (error) {
      console.error('Failed to remove album:', error);
      showToast(formatErrorMessage('remove album', error), 'error');
    }
  };

  const handleClearAllImages = async () => {
    if (profileImages.length === 0) return;
    
    try {
      const imageIds = profileImages.map(img => img.id);
      const targetEventUrl = getEventUrlFromId(selectedEventId) || eventUrl;
      await profilesAPI.removeImagesFromProfile(editingProfile.id, imageIds, targetEventUrl);
      // Changes are automatically applied by apiService interceptor
      showToast(t('editProfile.photosClearedFromProfile', { count: imageIds.length }), 'success');
    } catch (error) {
      console.error('Failed to clear photos:', error);
      showToast(formatErrorMessage('clear photos', error), 'error');
    }
  };

  const handleClearAllAlbums = async () => {
    if (profileAlbums.length === 0) return;
    
    try {
      const albumIds = profileAlbums.map(album => album.id);
      const targetEventUrl = getEventUrlFromId(selectedEventId) || eventUrl;
      await profilesAPI.removeAlbumsFromProfile(editingProfile.id, albumIds, targetEventUrl);
      // Changes are automatically applied by apiService interceptor
      showToast(t('editProfile.albumsClearedFromProfile', { count: albumIds.length }), 'success');
    } catch (error) {
      console.error('Failed to clear albums:', error);
      showToast(formatErrorMessage('clear albums', error), 'error');
    }
  };

  const handleRemoveGroup = async (groupId) => {
    try {
      const targetEventUrl = getEventUrlFromId(selectedEventId) || eventUrl;
      await profilesAPI.removeGroupsFromProfile(editingProfile.id, [groupId], targetEventUrl);
      // Changes are automatically applied by apiService interceptor
      showToast(t('editProfile.groupRemovedFromProfile'), 'success');
    } catch (error) {
      console.error('Failed to remove group:', error);
      showToast(formatErrorMessage('remove group', error), 'error');
    }
  };

  const handleClearAllGroups = async () => {
    if (profileGroups.length === 0) return;
    
    try {
      const groupIds = profileGroups.map(group => group.id);
      const targetEventUrl = getEventUrlFromId(selectedEventId) || eventUrl;
      await profilesAPI.removeGroupsFromProfile(editingProfile.id, groupIds, targetEventUrl);
      // Changes are automatically applied by apiService interceptor
      showToast(t('editProfile.groupsClearedFromProfile', { count: groupIds.length }), 'success');
    } catch (error) {
      console.error('Failed to clear groups:', error);
      showToast(formatErrorMessage('clear groups', error), 'error');
    }
  };

  // Define renderItem callbacks separately to keep references stable
  // MUST be before early return to follow Rules of Hooks
  const renderProfileImage = useCallback((image) => (
    <ProfileImageThumb
      imageId={image.id}
      eventUrl={getEventUrlFromId(selectedEventId) || eventUrl}
      urlHelpers={dynamicUrlHelpers}
      onRemove={() => handleRemoveImage(image.id)}
      title={t('editProfile.clickToRemove')}
    />
  ), [selectedEventId, eventUrl, dynamicUrlHelpers, t, handleRemoveImage]);

  const renderProfileAlbum = useCallback((album) => (
    <ProfileAlbumThumb
      album={album}
      eventUrl={getEventUrlFromId(selectedEventId) || eventUrl}
      urlHelpers={dynamicUrlHelpers}
      onRemove={() => handleRemoveAlbum(album.id)}
      title={t('editProfile.clickToRemove')}
    />
  ), [selectedEventId, eventUrl, dynamicUrlHelpers, t, handleRemoveAlbum]);

  const renderProfileGroup = useCallback((group) => (
    <ProfileGroupThumb
      group={group}
      eventUrl={getEventUrlFromId(selectedEventId) || eventUrl}
      urlHelpers={dynamicUrlHelpers}
      onRemove={() => handleRemoveGroup(group.id)}
      title={t('editProfile.clickToRemove')}
    />
  ), [selectedEventId, eventUrl, dynamicUrlHelpers, t, handleRemoveGroup]);

  if (!isOpen || !editingProfile) return null;

  const maxRank = (currentProfile?.hierarchy_rank || 0) - 1;
  const rankOptions = Array.from({ length: Math.max(0, maxRank) + 1 }, (_, i) => i);

  // Email field is shown:
  // - As input when creating (required for non-public profiles)
  // - As input when editing and changing from public to non-public (required)
  // - As read-only text when editing non-public profiles (not changing)
  const hasEmailInput = (isCreating && !Boolean(editingProfile?.is_public)) || 
                        (!isCreating && changingFromPublicToNonPublic);
  const hasEmailDisplay = !isCreating && !Boolean(editingProfile?.is_public) && !changingFromPublicToNonPublic;
  const hasEmailField = hasEmailInput || hasEmailDisplay;
  
  // Password field is shown:
  // - As input when creating public profiles (required)
  const hasPasswordInput = isCreating && Boolean(editingProfile?.is_public);
  const hasPasswordField = hasPasswordInput;
  
  // Determine grid layout based on fields
  let basicInfoGridLayout = 'md:grid-cols-[15rem_auto]';
  if (hasEmailField && hasPasswordField) {
    basicInfoGridLayout = 'md:grid-cols-[15rem_15rem_15rem_auto]';
  } else if (hasEmailField || hasPasswordField) {
    basicInfoGridLayout = 'md:grid-cols-[15rem_15rem_auto]';
  }

  return (
    <AnimatePresence>
      <div key="edit-profile-modal-overlay" className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <motion.div
          key="edit-profile-modal-content"
          ref={modalRef}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          dir={isRTL ? 'rtl' : 'ltr'}
          className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
          tabIndex={-1}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <User className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {isCreating ? t('editProfile.createProfile') : t('editProfile.editProfile')}
                </h2>
                {!isCreating && <p className="text-sm text-gray-500">{profile?.label}</p>}
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-4">
              {/* Basic Info Section - Compact (only show if profile is editable) */}
              {isProfileEditable && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    <span>{t('editProfile.basicInformation')}</span>
                  </h3>

                  <div className={`flex flex-col gap-3 md:grid ${basicInfoGridLayout} md:justify-center md:items-start md:gap-3`}>
                    {/* Label */}
                    <div className="w-full md:w-full">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        {t('editProfile.profileNameRequired')}
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={editingProfile.label}
                          onChange={(e) => handleFieldChange('label', e.target.value)}
                        className={`w-full h-10 px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                            nameConflict ? 'border-red-500' : 'border-gray-300'
                          }`}
                          placeholder={t('editProfile.enterProfileName')}
                        />
                        {nameConflict && (
                          <div className="absolute top-full left-0 mt-1 flex items-center gap-1 text-red-500 text-xs">
                            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                            <span>{t('editProfile.nameExists')}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Email - input when creating or when changing from public to non-public */}
                    {hasEmailInput && (
                      <div className="w-full md:w-full">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          {t('editProfile.emailRequired')}
                        </label>
                        <input
                          type="email"
                          value={editingProfile.email || ''}
                          onChange={(e) => handleFieldChange('email', e.target.value)}
                          autoComplete="off"
                          className="w-full h-10 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder={t('editProfile.enterEmailRequired')}
                          required
                        />
                      </div>
                    )}
                    {hasEmailDisplay && (
                      <div className="w-full md:w-full">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          {t('editProfile.email')}
                        </label>
                        <div className="w-full h-10 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-700 flex items-center">
                          {generalProfile?.email || t('editProfile.notAvailable')}
                        </div>
                      </div>
                    )}

                    {/* Password - input when creating public profile */}
                    {hasPasswordInput && (
                      <div className="w-full md:w-full">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          {t('editProfile.passwordRequired')}
                        </label>
                        <div className="relative">
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={editingProfile.password || ''}
                            onChange={(e) => handleFieldChange('password', e.target.value)}
                            autoComplete="new-password"
                            className={`w-full h-10 px-3 py-2 ${pe('10')} text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
                            placeholder={t('editProfile.enterPasswordRequired')}
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className={`absolute ${endClass('2')} top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors`}
                            title={showPassword ? t('editProfile.hidePassword') : t('editProfile.showPassword')}
                            aria-label={showPassword ? t('editProfile.hidePassword') : t('editProfile.showPassword')}
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* General Authorizations Section */}
              {!isCurrentProfileRestricted && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  <span>{t('editProfile.generalAuthorizations')}</span>
                </h3>

                <div className="space-y-3">
                  {/* Restricted to Event */}
                  <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{t('editProfile.restrictedToEvent')}</p>
                      <p className="text-sm text-gray-500">{t('editProfile.profileIsRestrictedToSpecificEvent')}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="relative" ref={restrictionInputRef}>
                        <div className="relative">
                          <input
                            ref={restrictionInputElementRef}
                            type="text"
                            value={restrictionSearchTerm}
                            onChange={(e) => {
                              setRestrictionSearchTerm(e.target.value);
                              setShowRestrictionDropdown(true);
                            }}
                            onFocus={() => {
                              // Use editingProfile first, then fall back to computed values
                              const currentRestrictionId = editingProfile?.restricted_to_event || restrictedToEventId;
                              const currentRestrictionName = currentRestrictionId
                                ? (editingProfile?.restricted_to_event_name || restrictedEventName || `Event ${currentRestrictionId}`)
                                : '';
                              if (restrictionSearchTerm === currentRestrictionName) {
                                setRestrictionSearchTerm('');
                              }
                              setShowRestrictionDropdown(true);
                            }}
                            placeholder={t('editProfile.selectEventOrClear')}
                            className={`px-3 py-1.5 ${pe('8')} text-sm border border-gray-300 rounded-lg bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent w-64 disabled:opacity-60 disabled:cursor-not-allowed`}
                            disabled={disableRestrictionToggle}
                            title={disableRestrictionToggle ? restrictionTooltip : undefined}
                          />
                          <ChevronDown className={`absolute ${endClass('2')} top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none`} />
                        </div>
                        {showRestrictionDropdown && (
                          <div
                            ref={restrictionDropdownRef}
                            className="absolute z-50 mt-1 w-64 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto"
                          >
                            {(() => {
                              const restrictionOptions = [];
                              // Add "Clear Selection" if restricted (always show when restricted, even when searching)
                              // Use editingProfile first, then fall back to computed values
                              const currentRestrictionId = editingProfile?.restricted_to_event || restrictedToEventId;
                              if (currentRestrictionId) {
                                restrictionOptions.push({ id: null, name: t('editProfile.clearSelection'), isClear: true });
                              }
                              
                              // When editing existing profile: only show profile events
                              // When creating new profile: show all events (prioritize initialEventId if filtered)
                              let eventsToShow;
                              if (isCreating) {
                                // Creating: show all events, prioritize initialEventId
                                const allEvents = allEventsList.map(event => {
                                  const eventId = event.event_id || event.id;
                                  if (!eventId) return null;
                                  return { ...event, event_id: eventId };
                                }).filter(Boolean);
                                
                                // Sort: initialEventId first (if exists), then by name
                                const sortedEvents = allEvents.sort((a, b) => {
                                  const aId = String(a.event_id || a.id);
                                  const bId = String(b.event_id || b.id);
                                  const initialIdStr = initialEventId ? String(initialEventId) : null;
                                  
                                  if (initialIdStr) {
                                    if (aId === initialIdStr && bId !== initialIdStr) return -1;
                                    if (aId !== initialIdStr && bId === initialIdStr) return 1;
                                  }
                                  // If both are initial or both are not, sort by name
                                  const aName = (a?.name || t('profilesGallery.untitledEvent')).toLowerCase();
                                  const bName = (b?.name || t('profilesGallery.untitledEvent')).toLowerCase();
                                  return aName.localeCompare(bName);
                                });
                                
                                eventsToShow = sortedEvents;
                              } else {
                                // Editing: only show profile events
                                eventsToShow = profileEventsList.map(event => {
                                  const eventId = event.event_id || event.id;
                                  if (!eventId) return null;
                                  return { ...event, event_id: eventId };
                                }).filter(Boolean);
                                
                                // Sort by name
                                eventsToShow.sort((a, b) => {
                                  const aName = (a?.name || t('profilesGallery.untitledEvent')).toLowerCase();
                                  const bName = (b?.name || t('profilesGallery.untitledEvent')).toLowerCase();
                                  return aName.localeCompare(bName);
                                });
                              }
                              
                              // Filter events based on search term
                              const filtered = restrictionSearchTerm.trim()
                                ? eventsToShow.filter(e => 
                                    (e?.name || t('profilesGallery.untitledEvent')).toLowerCase().includes(restrictionSearchTerm.toLowerCase())
                                  )
                                : eventsToShow;
                              
                              filtered.forEach(event => {
                                const evtId = event?.event_id || event?.id;
                                const evtName = event?.name || t('profilesGallery.untitledEvent');
                                restrictionOptions.push({ id: evtId, name: evtName, event: event });
                              });
                              
                              return restrictionOptions.length === 0 ? (
                                <div className="px-3 py-2 text-sm text-gray-500">
                                  {restrictionSearchTerm ? t('profilesGallery.noEventsFound') : t('profilesGallery.noEventsAvailable')}
                                </div>
                              ) : (
                                restrictionOptions.map((option, index) => {
                                  // Use editingProfile first, then fall back to computed values
                                  const currentRestrictionId = editingProfile?.restricted_to_event || restrictedToEventId;
                                  const isSelected = option.id && String(option.id) === String(currentRestrictionId);
                                  const isHighlighted = index === restrictionHighlightedIndex;
                                  const isClear = option.isClear;
                                  return (
                                    <button
                                      key={option.id || 'clear-restriction'}
                                      type="button"
                                      onClick={() => {
                                        if (option.isClear) {
                                          // Clear restriction
                                          handleFieldChange('restricted_to_event', null);
                                          handleFieldChange('restricted_to_event_name', null);
                                          setRestrictionSearchTerm('');
                                        } else {
                                          // Set restriction to selected event
                                          // Use the event object stored in the option, or find it in allEventsList
                                          const selectedEvent = option.event || allEventsList.find(e => {
                                            const evtId = e?.event_id || e?.id;
                                            return evtId && String(evtId) === String(option.id);
                                          });
                                          const eventName = selectedEvent?.name || option.name;
                                          handleFieldChange('restricted_to_event', option.id);
                                          handleFieldChange('restricted_to_event_name', eventName);
                                          setRestrictionSearchTerm(eventName);
                                        }
                                        setShowRestrictionDropdown(false);
                                        setRestrictionHighlightedIndex(0);
                                      }}
                                      className={`w-full text-left px-3 py-2 text-sm ${
                                        isHighlighted 
                                          ? 'bg-blue-100 text-blue-900' 
                                          : isSelected 
                                            ? 'bg-blue-50 text-blue-700' 
                                            : isClear
                                              ? 'text-red-600 hover:bg-red-50'
                                              : 'text-gray-700 hover:bg-gray-100'
                                      }`}
                                    >
                                      {option.name}
                                    </button>
                                  );
                                })
                              );
                            })()}
                          </div>
                        )}
                      </div>
                      {disableRestrictionToggle && (
                        <p className="text-xs text-gray-500 text-right">
                          {restrictionTooltip}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Hierarchy Rank */}
                  <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                    <div className="flex-1 relative">
                      <div className="flex items-center gap-1">
                        <p className="font-medium text-gray-900">{t('editProfile.rank')}</p>
                        <div className="relative">
                          <HelpCircle 
                            className="w-3.5 h-3.5 text-gray-400 cursor-help" 
                            onMouseEnter={() => setShowRankTooltip(true)}
                            onMouseLeave={() => setShowRankTooltip(false)}
                          />
                          {showRankTooltip && (
                            <div className={`absolute ${startClass('0')} top-6 w-64 p-3 bg-gray-900 text-white text-sm rounded-lg shadow-lg z-50 whitespace-normal`}>
                              {t('editProfile.rankTooltip')}
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-500">{t('editProfile.canManageProfilesWithLowerRank')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {disableRankSelection ? (
                        <div
                          className="w-32 h-10 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 opacity-80 flex items-center"
                          title={t('editProfile.publicProfilesUseDefaultRank')}
                        >
                          {editingProfile.hierarchy_rank}
                        </div>
                      ) : (
                        <select
                          value={editingProfile.hierarchy_rank}
                          onChange={(e) => handleFieldChange('hierarchy_rank', parseInt(e.target.value, 10))}
                          className="w-32 h-10 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          {rankOptions.map(rank => (
                            <option key={`rank-${rank}`} value={rank}>
                              {rank}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  {/* Can Create Events */}
                  {Boolean(currentProfile?.can_manage_create_events) && (
                    <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">{t('editProfile.canCreateEvents')}</p>
                        <p className="text-sm text-gray-500">{t('editProfile.canCreateNewEvents')}</p>
                      </div>
                      <div className="flex flex-col items-end">
                        <button
                          onClick={() => {
                            if (!canGrantCanCreateEvents || disableCanCreateEvents) return;
                            handleFieldChange('can_create_events', !Boolean(editingProfile.can_create_events));
                          }}
                          disabled={!canGrantCanCreateEvents || disableCanCreateEvents}
                          className={`w-10 h-6 rounded-full relative transition-colors ${Boolean(editingProfile.can_create_events) ? 'bg-blue-600' : 'bg-gray-300'} ${!canGrantCanCreateEvents || disableCanCreateEvents ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                          aria-pressed={Boolean(editingProfile.can_create_events)}
                          title={disableCanCreateEvents ? (Boolean(editingProfile?.is_public) ? t('editProfile.publicProfilesCannotCreateEvents') : t('editProfile.restrictedProfilesCannotCreateEvents')) : undefined}
                        >
                          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isRTL ? 'right-0.5' : 'left-0.5'} ${Boolean(editingProfile.can_create_events) ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
                        </button>
                        {disableCanCreateEvents && (
                          <p className="mt-1 text-xs text-gray-500 text-right">
                            {Boolean(editingProfile?.is_public) 
                              ? t('editProfile.publicProfilesCannotCreateEvents')
                              : t('editProfile.restrictedProfilesCannotCreateEvents')}
                          </p>
                        )}
                        {!canGrantCanCreateEvents && !disableCanCreateEvents && (
                          <p className="mt-1 text-xs text-gray-500 text-right">
                            {t('editProfile.youDoNotHavePermissionToGrantThis')}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Public Profile */}
                  <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                    <div className="relative">
                      <div className="flex items-center gap-1">
                        <p className="font-medium text-gray-900">{t('editProfile.publicProfile')}</p>
                        <div className="relative">
                          <HelpCircle 
                            className="w-3.5 h-3.5 text-gray-400 cursor-help" 
                            onMouseEnter={() => setShowPublicTooltip(true)}
                            onMouseLeave={() => setShowPublicTooltip(false)}
                          />
                          {showPublicTooltip && (
                            <div className={`absolute ${startClass('0')} top-6 w-64 p-3 bg-gray-900 text-white text-sm rounded-lg shadow-lg z-50 whitespace-normal`}>
                              {t('editProfile.publicProfileTooltip')}
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-500">{t('editProfile.accessibleViaLinkManagedByAdminsOnly')}</p>
                    </div>
                    <div className="flex flex-col items-end">
                      <div className="flex items-center gap-3">
                        {/* Change Password Button - only show when editing existing public profile */}
                        {!isCreating && Boolean(editingProfile?.is_public) && (
                          <button
                            type="button"
                            onClick={() => setShowPasswordModal(true)}
                            disabled={!canChangePassword}
                            className={`px-3 py-1.5 text-sm font-medium flex items-center gap-2 transition-colors ${
                              canChangePassword
                                ? 'bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200'
                                : 'bg-gray-50 text-gray-400 rounded-lg cursor-not-allowed opacity-60'
                            }`}
                            title={
                              !canChangePassword
                                ? isPublicChanged
                                  ? t('editProfile.pleaseSaveChangesFirst')
                                  : t('editProfile.passwordCanOnlyBeChangedForPublicProfiles')
                                : t('editProfile.changePasswordForThisPublicProfile')
                            }
                          >
                            <Lock className="w-3.5 h-3.5" />
                            <span>{t('editProfile.changePassword')}</span>
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (disablePublicToggle) return;
                            handleFieldChange('is_public', !Boolean(editingProfile.is_public));
                          }}
                          disabled={disablePublicToggle}
                          className={`w-10 h-6 rounded-full relative transition-colors ${Boolean(editingProfile.is_public) ? 'bg-blue-600' : 'bg-gray-300'} ${disablePublicToggle ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                          aria-pressed={Boolean(editingProfile.is_public)}
                          title={disablePublicToggle ? publicToggleTooltip : undefined}
                        >
                          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isRTL ? 'right-0.5' : 'left-0.5'} ${Boolean(editingProfile.is_public) ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
                        </button>
                      </div>
                      {disablePublicToggle && (
                        <p className="mt-1 text-xs text-gray-500 text-right">
                          {publicToggleTooltip}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              )}

              {/* Profile Events Section */}
              {!isCreating && !isCurrentProfileRestricted && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Calendar className="w-5 h-5" />
                    <span>{t('editProfile.profileEvents')}</span>
                  </h3>
                  
                  <div className="space-y-2">
                    {profileEventsList.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-2">{t('editProfile.noEventsAssigned')}</p>
                    ) : (
                      profileEventsList.map((event) => {
                        const eventId = event.event_id || event.id;
                        const eventName = event.name || t('profilesGallery.untitledEvent');
                        return (
                          <div
                            key={eventId}
                            className="flex items-center justify-between py-2 px-3 bg-white rounded-lg border border-gray-200"
                          >
                            <span className="text-sm text-gray-900">{eventName}</span>
                            <button
                              onClick={() => handleRemoveProfileEvent(eventId)}
                              className="w-6 h-6 flex items-center justify-center text-red-600 hover:bg-red-50 rounded transition-colors"
                              title={t('editProfile.removeEvent')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })
                    )}
                    
                    {availableEventsToAdd.length > 0 && (
                      <div className="flex items-center gap-2 pt-2">
                        <select
                          ref={addEventSelectRef}
                          value={selectedEventToAdd}
                          onChange={(e) => setSelectedEventToAdd(e.target.value)}
                          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">{t('editProfile.selectEventToAdd')}</option>
                          {availableEventsToAdd.map((event) => {
                            const eventId = event.event_id || event.id;
                            const eventName = event.name || t('profilesGallery.untitledEvent');
                            return (
                              <option key={eventId} value={eventId}>
                                {eventName}
                              </option>
                            );
                          })}
                        </select>
                        <button
                          onClick={() => {
                            if (selectedEventToAdd) {
                              handleAddProfileEvent(selectedEventToAdd);
                              setSelectedEventToAdd('');
                            }
                          }}
                          className="w-10 h-10 flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title={t('editProfile.addEvent')}
                          disabled={!selectedEventToAdd}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Specific Event Authorizations Section */}
              {!(isCreating && !initialEventId) && (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    <span>{t('editProfile.specificEventAuthorizations')}</span>
                  </h3>
                  <div className="flex items-center gap-3">
                    {/* Save/Cancel buttons for event-specific changes */}
                    {selectedEventId && hasEventSpecificChanges && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleCancelEventSpecific}
                          disabled={savingEventSpecific}
                          className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {t('editProfile.cancel')}
                        </button>
                        <button
                          onClick={handleSaveEventSpecific}
                          disabled={savingEventSpecific}
                          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {savingEventSpecific ? (
                            <>
                              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              <span>{t('editProfile.saving')}</span>
                            </>
                          ) : (
                            <>
                              <Save className="w-3 h-3" />
                              <span>{t('editProfile.save')}</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                    {/* Event Combobox */}
                    {!isCurrentProfileRestricted && (
                      isCreating && initialEventId && selectedEventId ? (
                        // When creating with initialEventId, show event name as plain text (read-only)
                        <div className="px-3 py-1.5 text-sm text-gray-900 w-64">
                          {selectedEventName}
                        </div>
                      ) : (
                        <div className="relative" ref={eventInputRef}>
                          <div className="relative">
                            <input
                              ref={eventInputElementRef}
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
                              placeholder={!eventId ? t('editProfile.selectEvent') : t('profilesGallery.searchEvents')}
                              disabled={hasEventSpecificChanges}
                              className={`px-3 py-1.5 ${pe('8')} text-sm border border-gray-300 rounded-lg bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent w-64 ${
                                hasEventSpecificChanges ? 'opacity-60 cursor-not-allowed' : ''
                              }`}
                              title={hasEventSpecificChanges ? t('editProfile.pleaseSaveOrCancelChangesBeforeSwitchingEvents') : undefined}
                            />
                            <ChevronDown className={`absolute ${endClass('2')} top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none`} />
                          </div>
                          {showEventDropdown && (
                            <div
                              ref={eventDropdownRef}
                              className="absolute z-50 mt-1 w-64 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto"
                            >
                              {selectableOptions.length === 0 ? (
                                <div className="px-3 py-2 text-sm text-gray-500">
                                  {eventSearchTerm ? t('profilesGallery.noEventsFound') : t('profilesGallery.noEventsAvailable')}
                                </div>
                              ) : (
                                selectableOptions.map((option, index) => {
                                  const isSelected = option.id && String(option.id) === String(selectedEventId);
                                  const isHighlighted = index === highlightedIndex;
                                  const isClear = option.isClear;
                                  const isDisabled = hasEventSpecificChanges && option.id !== selectedEventId;
                                  return (
                                    <button
                                      key={option.id || (isClear ? 'clear-event' : 'select-event')}
                                      type="button"
                                      onClick={() => handleEventSelect(option.id)}
                                      disabled={isDisabled}
                                      className={`w-full text-left px-3 py-2 text-sm ${
                                        isDisabled
                                          ? 'opacity-50 cursor-not-allowed text-gray-400'
                                          : isHighlighted 
                                            ? 'bg-blue-100 text-blue-900' 
                                            : isSelected 
                                              ? 'bg-blue-50 text-blue-700' 
                                              : isClear
                                                ? 'text-red-600 hover:bg-red-50'
                                                : 'text-gray-700 hover:bg-gray-100'
                                      }`}
                                      title={isDisabled ? t('editProfile.pleaseSaveOrCancelChangesBeforeSwitchingEvents') : undefined}
                                    >
                                      {option.name}
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      )
                    )}
                  </div>
                </div>

                {selectedEventId ? (
                  <div className="space-y-3">
                    {/* Manage Event */}
                    <PermissionGate requires="canManageEvent" eventUrl={selectedEventUrl}>
                      <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                        <div className="relative">
                          <div className="flex items-center gap-1">
                            <p className="font-medium text-gray-900">{t('editProfile.manageEvent')}</p>
                            <div className="relative">
                              <HelpCircle 
                                className="w-3.5 h-3.5 text-gray-400 cursor-help" 
                                onMouseEnter={() => setShowManageEventTooltip(true)}
                                onMouseLeave={() => setShowManageEventTooltip(false)}
                              />
                              {showManageEventTooltip && (
                                <div className={`absolute ${startClass('0')} top-6 w-64 p-3 bg-gray-900 text-white text-sm rounded-lg shadow-lg z-50 whitespace-normal`}>
                                  {t('editProfile.manageEventTooltip')}
                                </div>
                              )}
                            </div>
                          </div>
                          <p className="text-sm text-gray-500">{t('editProfile.canUpdateEventSettings')}</p>
                        </div>
                        <div className="flex flex-col items-end">
                          <button
                            onClick={() => {
                              if (disableEventManagementToggles || !canGrantCanManageEvent) return;
                              handleFieldChange('can_manage_event', !Boolean(editingProfile.can_manage_event));
                            }}
                            disabled={disableEventManagementToggles || !canGrantCanManageEvent}
                            className={`w-10 h-6 rounded-full relative transition-colors ${Boolean(editingProfile.can_manage_event) ? 'bg-blue-600' : 'bg-gray-300'} ${disableEventManagementToggles || !canGrantCanManageEvent ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                            aria-pressed={Boolean(editingProfile.can_manage_event)}
                            title={disableEventManagementToggles ? t('editProfile.publicProfilesCannotManageEvents') : !canGrantCanManageEvent ? t('editProfile.youDoNotHavePermissionToGrantThis') : undefined}
                          >
                            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isRTL ? 'right-0.5' : 'left-0.5'} ${Boolean(editingProfile.can_manage_event) ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
                          </button>
                          {disableEventManagementToggles && (
                            <p className="mt-1 text-xs text-gray-500 text-right">
                              {t('editProfile.publicProfilesCannotManageEvents')}
                            </p>
                          )}
                          {!canGrantCanManageEvent && !disableEventManagementToggles && (
                            <p className="mt-1 text-xs text-gray-500 text-right">
                              {t('editProfile.youDoNotHavePermissionToGrantThis')}
                            </p>
                          )}
                        </div>
                      </div>
                    </PermissionGate>

                    {/* Delete Event */}
                    <PermissionGate requires="canManageEvent" eventUrl={selectedEventUrl}>
                      <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                        <div>
                          <p className="font-medium text-gray-900">{t('editProfile.deleteEvent')}</p>
                          <p className="text-sm text-gray-500">{t('editProfile.canPermanentlyDeleteThisEventAndAllRelatedData')}</p>
                        </div>
                        <div className="flex flex-col items-end">
                          <button
                            onClick={() => {
                              if (disableEventManagementToggles || !canGrantCanDeleteEvent) return;
                              handleFieldChange('can_delete_event', !Boolean(editingProfile.can_delete_event));
                            }}
                            disabled={disableEventManagementToggles || !canGrantCanDeleteEvent}
                            className={`w-10 h-6 rounded-full relative transition-colors ${Boolean(editingProfile.can_delete_event) ? 'bg-blue-600' : 'bg-gray-300'} ${disableEventManagementToggles || !canGrantCanDeleteEvent ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                            aria-pressed={Boolean(editingProfile.can_delete_event)}
                            title={disableEventManagementToggles ? t('editProfile.publicProfilesCannotDeleteEvents') : !canGrantCanDeleteEvent ? t('editProfile.youDoNotHavePermissionToGrantThis') : undefined}
                          >
                            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isRTL ? 'right-0.5' : 'left-0.5'} ${Boolean(editingProfile.can_delete_event) ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
                          </button>
                          {disableEventManagementToggles && (
                            <p className="mt-1 text-xs text-gray-500 text-right">
                              {t('editProfile.publicProfilesCannotDeleteEvents')}
                            </p>
                          )}
                          {!canGrantCanDeleteEvent && !disableEventManagementToggles && (
                            <p className="mt-1 text-xs text-gray-500 text-right">
                              {t('editProfile.youDoNotHavePermissionToGrantThis')}
                            </p>
                          )}
                        </div>
                      </div>
                    </PermissionGate>

                    {/* Upload & Delete Images */}
                    <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                      <div className="relative">
                        <div className="flex items-center gap-1">
                          <p className="font-medium text-gray-900">{t('editProfile.uploadDeletePhotos')}</p>
                        </div>
                        <p className="text-sm text-gray-500">{t('editProfile.canUploadNewPhotosAndDeleteExistingOnes')}</p>
                      </div>
                      <div className="flex flex-col items-end">
                        <button
                          onClick={() => {
                            if (!canGrantCanUploadAndDeleteImages || disableCanUploadAndDeleteImages) return;
                            const newValue = !Boolean(editingProfile.can_upload_and_delete_images);
                            handleFieldChange('can_upload_and_delete_images', newValue);
                            // If enabling upload, also enable can_edit and all_groups (constraint)
                            if (Boolean(newValue)) {
                              handleFieldChange('can_edit', true);
                              handleFieldChange('all_groups', true);
                            }
                          }}
                          disabled={!canGrantCanUploadAndDeleteImages || disableCanUploadAndDeleteImages}
                          className={`w-10 h-6 rounded-full relative transition-colors ${Boolean(editingProfile.can_upload_and_delete_images) ? 'bg-blue-600' : 'bg-gray-300'} ${!canGrantCanUploadAndDeleteImages || disableCanUploadAndDeleteImages ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                          aria-pressed={Boolean(editingProfile.can_upload_and_delete_images)}
                          title={disableCanUploadAndDeleteImages ? canUploadAndDeleteImagesDisabledReason : undefined}
                        >
                          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isRTL ? 'right-0.5' : 'left-0.5'} ${Boolean(editingProfile.can_upload_and_delete_images) ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
                        </button>
                        {disableCanUploadAndDeleteImages && (
                          <p className="mt-1 text-xs text-gray-500 text-right">
                            {canUploadAndDeleteImagesDisabledReason}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Can Edit */}
                    <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">{t('editProfile.canEdit')}</p>
                        <p className="text-sm text-gray-500">{t('editProfile.canEditAlbumsGroupsMomentsAndTransferFaces')}</p>
                      </div>
                      <div className="flex flex-col items-end">
                        <button
                          onClick={() => {
                            if (!canGrantCanEdit || requiresCanEdit || disableCanEdit) return;
                            const newValue = !Boolean(editingProfile.can_edit);
                            // If disabling can_edit while can_upload_and_delete_images is enabled, also disable upload
                            if (!newValue && Boolean(editingProfile.can_upload_and_delete_images)) {
                              handleFieldChange('can_upload_and_delete_images', false);
                            }
                            handleFieldChange('can_edit', newValue);
                          }}
                          disabled={!canGrantCanEdit || requiresCanEdit || disableCanEdit}
                          className={`w-10 h-6 rounded-full relative transition-colors ${Boolean(editingProfile.can_edit) ? 'bg-blue-600' : 'bg-gray-300'} ${!canGrantCanEdit || requiresCanEdit || disableCanEdit ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                          aria-pressed={Boolean(editingProfile.can_edit)}
                          title={disableCanEdit ? t('editProfile.publicProfilesCannotHaveEditPermissions') : requiresCanEdit ? t('editProfile.requiredWhenUploadDeletePhotosIsEnabled') : undefined}
                        >
                          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isRTL ? 'right-0.5' : 'left-0.5'} ${Boolean(editingProfile.can_edit) ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
                        </button>
                        {disableCanEdit && (
                          <p className="mt-1 text-xs text-gray-500 text-right">
                            {t('editProfile.publicProfilesCannotHaveEditPermissions')}
                          </p>
                        )}
                        {requiresCanEdit && !disableCanEdit && (
                          <p className="mt-1 text-xs text-gray-500 text-right">
                            {t('editProfile.requiredWhenUploadDeletePhotosIsEnabled')}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* All Images */}
                    <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                      <div className="relative">
                        <div className="flex items-center gap-1">
                          <p className="font-medium text-gray-900">{t('editProfile.allPhotosAccess')}</p>
                          <div className="relative">
                            <HelpCircle 
                              className="w-3.5 h-3.5 text-gray-400 cursor-help" 
                              onMouseEnter={() => setShowImagesTooltip(true)}
                              onMouseLeave={() => setShowImagesTooltip(false)}
                            />
                            {showImagesTooltip && (
                              <div className={`absolute ${startClass('0')} top-6 w-64 p-3 bg-gray-900 text-white text-sm rounded-lg shadow-lg z-50 whitespace-normal`}>
                                <div>{t('editProfile.determinesWhichPhotosAreAccessible')}</div>
                                <div className="mt-1">{t('editProfile.archivedPhotosRequireArchiveAlbumAccess')}</div>
                              </div>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-gray-500">{t('editProfile.ifOnAccessAllPhotosExceptListedBelow')}</p>
                      </div>
                      <button
                        onClick={() => {
                          if (!canGrantAllImages) return;
                          handleFieldChange('all_images', !Boolean(editingProfile.all_images));
                        }}
                        disabled={!canGrantAllImages}
                        className={`w-10 h-6 rounded-full relative transition-colors ${Boolean(editingProfile.all_images) ? 'bg-blue-600' : 'bg-gray-300'} ${!canGrantAllImages ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        aria-pressed={Boolean(editingProfile.all_images)}
                      >
                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isRTL ? 'right-0.5' : 'left-0.5'} ${Boolean(editingProfile.all_images) ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
                      </button>
                    </div>

                    {/* All Albums */}
                    <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                      <div className="relative">
                        <div className="flex items-center gap-1">
                          <p className="font-medium text-gray-900">{t('editProfile.allAlbumsAccess')}</p>
                          <div className="relative">
                            <HelpCircle 
                              className="w-3.5 h-3.5 text-gray-400 cursor-help" 
                              onMouseEnter={() => setShowAlbumsTooltip(true)}
                              onMouseLeave={() => setShowAlbumsTooltip(false)}
                            />
                            {showAlbumsTooltip && (
                              <div className={`absolute ${startClass('0')} top-6 w-64 p-3 bg-gray-900 text-white text-sm rounded-lg shadow-lg z-50 whitespace-normal`}>
                                <div>{t('editProfile.controlsWhichAlbumsAreVisibleInCollection')}</div>
                                <div className="mt-1">{t('editProfile.photoAccessFollowsThePhotosRule')}</div>
                                <div className="mt-1">{t('editProfile.archivedPhotosRequireArchiveAlbumAccess')}</div>
                                <div className="mt-1">{t('editProfile.withoutEditPermissionEmptyAlbumsAreHidden')}</div>
                              </div>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-gray-500">{t('editProfile.ifOnAccessAllAlbumsExceptListedBelow')}</p>
                      </div>
                      <button
                        onClick={() => {
                          if (!canGrantAllAlbums) return;
                          handleFieldChange('all_albums', !Boolean(editingProfile.all_albums));
                        }}
                        disabled={!canGrantAllAlbums}
                        className={`w-10 h-6 rounded-full relative transition-colors ${Boolean(editingProfile.all_albums) ? 'bg-blue-600' : 'bg-gray-300'} ${!canGrantAllAlbums ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        aria-pressed={Boolean(editingProfile.all_albums)}
                      >
                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isRTL ? 'right-0.5' : 'left-0.5'} ${Boolean(editingProfile.all_albums) ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
                      </button>
                    </div>

                    {/* All Groups */}
                    <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                      <div className="relative">
                        <div className="flex items-center gap-1">
                          <p className="font-medium text-gray-900">{t('editProfile.allPeopleAccess')}</p>
                          <div className="relative">
                            <HelpCircle 
                              className="w-3.5 h-3.5 text-gray-400 cursor-help"
                              onMouseEnter={() => setShowGroupsTooltip(true)}
                              onMouseLeave={() => setShowGroupsTooltip(false)}
                            />
                            {showGroupsTooltip && (
                              <div className={`absolute ${startClass('0')} top-6 w-64 p-3 bg-gray-900 text-white text-sm rounded-lg shadow-lg z-50 whitespace-normal`}>
                                <div>{t('editProfile.controlsWhichPeopleAreVisibleInCollection')}</div>
                                <div className="mt-1">{t('editProfile.inaccessibleNoFaceRectanglesHiddenFromCollection')}</div>
                                <div className="mt-1">{t('editProfile.withoutEditPermissionEmptyAlbumsAreHidden')}</div>
                                <div className="mt-1">{t('editProfile.unassociatedFacesAreOnlyAccessibleWithEditPermission')}</div>
                              </div>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-gray-500">{t('editProfile.ifOnAccessAllGroupsExceptListedBelow')}</p>
                      </div>
                      <div className="flex flex-col items-end">
                        <button
                          onClick={() => {
                            if (!canGrantAllGroups || disableAllGroups) return;
                            const newValue = !Boolean(editingProfile.all_groups);
                            // If disabling all_groups while can_upload_and_delete_images is enabled, also disable upload
                            if (!newValue && Boolean(editingProfile.can_upload_and_delete_images)) {
                              handleFieldChange('can_upload_and_delete_images', false);
                            }
                            handleFieldChange('all_groups', newValue);
                          }}
                          disabled={!canGrantAllGroups || disableAllGroups}
                          className={`w-10 h-6 rounded-full relative transition-colors ${Boolean(editingProfile.all_groups) ? 'bg-blue-600' : 'bg-gray-300'} ${!canGrantAllGroups || disableAllGroups ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                          aria-pressed={Boolean(editingProfile.all_groups)}
                          title={disableAllGroups ? allGroupsDisabledReason : undefined}
                        >
                          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isRTL ? 'right-0.5' : 'left-0.5'} ${Boolean(editingProfile.all_groups) ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
                        </button>
                        {disableAllGroups && (
                          <p className="mt-1 text-xs text-gray-500 text-right">
                            {allGroupsDisabledReason}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Calendar className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm">{t('editProfile.selectEventToConfigure')}</p>
                  </div>
                )}
              </div>
              )}

              {/* Specific Access - Images (only show for existing profiles and when event is selected) */}
              {!isCreating && selectedEventId && (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <ImageIcon className="w-5 h-5" />
                    <span>{t('editProfile.specificPhotoAccess')} ({profileImages.length})</span>
                  </h3>
                  {profileImages.length > 0 && (
                    <button
                      onClick={handleClearAllImages}
                      className="text-sm text-red-600 hover:text-red-700 hover:underline flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>{t('editProfile.clearAll')}</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-600 mb-3">
                  {Boolean(editingProfile.all_images) 
                    ? t('editProfile.thesePhotosAreForbiddenToThisProfile')
                    : t('editProfile.theseAreTheOnlyPhotosAccessibleToThisProfile')}
                </p>
                {profileImages.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    {t('editProfile.noSpecificPhotosConfigured')}
                  </p>
                ) : (
                  <SimpleVirtuosoGrid
                    items={profileImages.map(img => ({ id: img.id, ...img }))}
                    baseSize={48}
                    gap={4}
                    containerHeight="192px"
                    className="w-full"
                    overscan={1500}
                    renderItem={renderProfileImage}
                  />
                )}
              </div>
              )}

              {/* Specific Access - Albums (only show for existing profiles and when event is selected) */}
              {!isCreating && selectedEventId && (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <FolderOpen className="w-5 h-5" />
                    <span>{t('editProfile.specificAlbumAccess')} ({profileAlbums.length})</span>
                  </h3>
                  {profileAlbums.length > 0 && (
                    <button
                      onClick={handleClearAllAlbums}
                      className="text-sm text-red-600 hover:text-red-700 hover:underline flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>{t('editProfile.clearAll')}</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-600 mb-3">
                  {Boolean(editingProfile.all_albums) 
                    ? t('editProfile.theseAlbumsAreForbiddenToThisProfile')
                    : t('editProfile.theseAreTheOnlyAlbumsAccessibleToThisProfile')}
                </p>
                {profileAlbums.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    {t('editProfile.noSpecificAlbumsConfigured')}
                  </p>
                ) : (
                  <SimpleVirtuosoGrid
                    items={profileAlbums.map(album => ({ id: album.id, ...album }))}
                    baseSize={48}
                    gap={4}
                    containerHeight="192px"
                    className="w-full"
                    overscan={1500}
                    renderItem={renderProfileAlbum}
                  />
                )}
              </div>
              )}

              {/* Specific Access - Groups (only show for existing profiles and when event is selected) */}
              {!isCreating && selectedEventId && (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    <span>{t('editProfile.specificPersonAccess')} ({profileGroups.length})</span>
                  </h3>
                  {profileGroups.length > 0 && (
                    <button
                      onClick={handleClearAllGroups}
                      className="text-sm text-red-600 hover:text-red-700 hover:underline flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>{t('editProfile.clearAll')}</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-600 mb-3">
                  {Boolean(editingProfile.all_groups) 
                    ? t('editProfile.thesePeopleAreForbiddenToThisProfile')
                    : t('editProfile.theseAreTheOnlyPeopleAccessibleToThisProfile')}
                </p>
                {profileGroups.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    {t('editProfile.noSpecificPeopleConfigured')}
                  </p>
                ) : (
                  <SimpleVirtuosoGrid
                    items={profileGroups.map(group => ({ id: group.id, ...group }))}
                    baseSize={48}
                    gap={4}
                    containerHeight="192px"
                    className="w-full"
                    overscan={1500}
                    renderItem={renderProfileGroup}
                  />
                )}
              </div>
              )}

              {error && (
                <div className="flex items-center space-x-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end gap-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('editProfile.cancel')}
            </button>
            <button
              type="button"
              data-is-save-button="true"
              onClick={handleSave}
              disabled={
                loading || 
                savingEventSpecific ||
                (isProfileEditable && (
                  nameConflict || 
                  !editingProfile.label.trim() || 
                  (isCreating && !Boolean(editingProfile.is_public) && !editingProfile.email?.trim()) ||
                  (isCreating && Boolean(editingProfile.is_public) && !editingProfile.password?.trim()) ||
                  (!isCreating && changingFromPublicToNonPublic && !editingProfile.email?.trim())
                )) ||
                (!isProfileEditable && !isCreating && (!selectedEventId || !hasEventSpecificChanges)) ||
                (isProfileEditable && !hasChanges && !hasEventSpecificChanges)
              }
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>{isCreating ? t('editProfile.creating') : t('editProfile.saving')}</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>{isCreating ? t('editProfile.createProfile') : t('editProfile.save')}</span>
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>

      {/* Remove Event Confirmation Modal */}
      {eventToRemove && (() => {
        const eventToRemoveObj = profileEventsList.find(e => {
          const evtId = e.event_id || e.id;
          return evtId && String(evtId) === String(eventToRemove);
        });
        const eventName = eventToRemoveObj?.name || t('profilesGallery.untitledEvent');
        return (
          <ConfirmDelete
            isOpen={!!eventToRemove}
            onClose={() => setEventToRemove(null)}
            onConfirm={handleConfirmRemoveEvent}
            title={t('editProfile.removeEventFromProfile')}
            message={t('editProfile.areYouSureWantToRemove')}
            itemName={eventName}
            confirmText={t('editProfile.removeEvent')}
            caption={t('editProfile.allProfileAuthorizationsForThisEventWillBeRemoved')}
            simpleMessage={false}
          />
        );
      })()}

      {/* Public Profile Password Change Modal */}
      {!isCreating && editingProfile?.id && Boolean(editingProfile?.is_public) && (
        <PublicProfilePasswordModal
          isOpen={showPasswordModal}
          onClose={() => setShowPasswordModal(false)}
          profileId={editingProfile.id}
          profileLabel={editingProfile.label}
          eventUrl={selectedEventId ? getEventUrlFromId(selectedEventId) : eventUrl}
        />
      )}
    </AnimatePresence>
  );
}

// ProfileImageThumb component for grid display
function ProfileImageThumb({ imageId, eventUrl, urlHelpers, onRemove, title }) {
  const imageUrl = useMemo(() => {
    if (!urlHelpers) return null;
    return urlHelpers.getRelativeThumbnailUrl(imageId);
  }, [urlHelpers, imageId]);

  return (
    <RemovableThumbnail
      imageUrl={imageUrl}
      alt={imageId}
      onRemove={onRemove}
      size="medium"
      title={title}
    />
  );
}

// ProfileAlbumThumb component for grid display
function ProfileAlbumThumb({ album, eventUrl, urlHelpers, onRemove, title }) {
  const imageUrl = useMemo(() => {
    if (!urlHelpers || !urlHelpers.getRepresentativeUrl) return null;
    return `${urlHelpers.getRepresentativeUrl('albums', album.id)}?v=${album.representative_image || 'none'}`;
  }, [urlHelpers, album.id, album.representative_image]);

  return (
    <RemovableThumbnail
      imageUrl={imageUrl}
      alt={album.label}
      onRemove={onRemove}
      text={album.label}
      size="medium"
      withGradient={true}
      iconType="image"
      title={title}
    />
  );
}

// ProfileGroupThumb component for grid display
function ProfileGroupThumb({ group, eventUrl, urlHelpers, onRemove, title }) {
  const imageUrl = useMemo(() => {
    if (!urlHelpers || !urlHelpers.getRepresentativeUrl) return null;
    return `${urlHelpers.getRepresentativeUrl('groups', group.id)}?v=${group.representative_face || 'none'}`;
  }, [urlHelpers, group.id, group.representative_face]);

  return (
    <RemovableThumbnail
      imageUrl={imageUrl}
      alt={group.label}
      onRemove={onRemove}
      text={group.label}
      size="medium"
      withGradient={true}
      iconType="image"
      title={title}
    />
  );
}




