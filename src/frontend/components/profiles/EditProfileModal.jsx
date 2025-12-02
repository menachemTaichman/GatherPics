import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Key, Shield, Image as ImageIcon, FolderOpen, Users, AlertTriangle, AlertCircle, Save, Trash2, MapPin, ChevronDown, Calendar, Plus, HelpCircle } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalStore } from '../../utils/modalManager';
import { profilesAPI, getEventUrlById, API_BASE } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { getCurrentProfile } from '../../utils/profileService';
import { useApplyScopes, useChilds, useEventId, getEventUrlFromId as getEventUrlFromIdUtil } from '../../utils/storeUtils';
import { useDataStore } from '../../utils/dataManager';
import { useEventGeneralById, useProfileById, useEventProfileById, useEventsGeneralList } from '../../utils/dataManager';
import { formatErrorMessage } from '../../utils/errorHandler';
import { ChangePasswordModal } from './';
import { RemovableThumbnail } from '../common';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../common/PermissionGate';
import ConfirmDelete from '../modals/ConfirmDelete';

export default function EditProfileModal({ isOpen, onClose, profile, eventUrl, urlHelpers, onSave, isCreating = false, initialEventId = null }) {
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
  const [showPasswordModal, setShowPasswordModal] = useState(false);
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
    ? 'Cannot restrict groups when Upload & Delete Photos is enabled' 
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
      ? 'Public profiles cannot have upload permissions'
      : !Boolean(editingProfile?.all_groups)
        ? 'All People Access must be enabled'
        : !Boolean(editingProfile?.can_edit)
          ? 'Can Edit permission must be enabled'
          : 'Remove forbidden groups first'
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
  ? 'Profiles with event creation permissions cannot be public.'
  : publicToggleRestrictedByRank
    ? 'Public profiles must use rank 0.'
    : publicToggleRestrictedByEvent
      ? 'Public access is only available for profiles restricted to an event.'
      : undefined;
const isRestricted = Boolean(editingProfile?.restricted_to_event || currentProfile?.restricted_to_event);
const disableRestrictionToggle = isCurrentProfileRestricted || Boolean(editingProfile?.is_public) || Boolean(editingProfile?.can_create_events);
const restrictionTooltip = isCurrentProfileRestricted
  ? 'You are restricted to an event and cannot change restrictions'
  : Boolean(editingProfile?.is_public)
    ? 'Public profiles must be restricted to their own event'
    : Boolean(editingProfile?.can_create_events)
      ? 'Profiles with event creation permissions cannot be restricted to an event'
      : `Manage restrictions`
const disableEventManagementToggles = Boolean(editingProfile?.is_public);
const disableCanCreateEvents = disableEventManagementToggles || isRestricted;
const disableRankSelection = Boolean(editingProfile?.is_public);

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
      // When creating, require both label and password to be filled
      const hasLabel = editingProfile?.label?.trim();
      const hasPassword = editingProfile?.password?.trim();
      return hasLabel && hasPassword;
    }
    
    // Don't enable save until both editingProfile and initialProfileState are set
    if (!editingProfile || !initialProfileState) {
      return false;
    }
    
    // Don't count selectedEventId change as a change for the main save button
    // Event-specific changes are handled separately with their own save button
    
    // Compare general profile fields (exclude event-specific fields)
    const generalFieldsToCompare = [
      'label', 'email', 'hierarchy_rank', 'can_create_events', 'is_public', 'restricted_to_event'
    ];
    
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

  // Custom keyboard handler to allow child modal to work
  const handleEditProfileKeys = (e) => {
    // If password modal is open, let events pass through to child modal
    if (showPasswordModal) {
      return true; // Return true to prevent this modal from stopping propagation to child modal
    }
    
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
    
    // Allow all normal input behavior for input, textarea, and select elements
    const targetTagName = e.target.tagName?.toLowerCase();
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      // For Enter key, save the profile (only if there are changes)
      if (e.key === 'Enter' && !loading && !nameConflict && editingProfile?.label.trim() && (!isCreating || editingProfile?.password?.trim()) && hasChanges) {
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
    enableFocusTrapping: !showPasswordModal, // Disable when child modal is open
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
      email: mergedProfile.email || '',
      password: undefined, // Don't include password when editing
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
      
      const initialEditingState = {
        label: profile?.label || '',
        email: '',
        password: '',
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

  // Update email when generalProfile loads (after initial render)
  useEffect(() => {
    if (isOpen && !isCreating && generalProfile?.email && editingProfile && !editingProfile.email) {
      setEditingProfile(prev => ({ ...prev, email: generalProfile.email }));
    }
  }, [isOpen, isCreating, generalProfile?.email, editingProfile?.email]);

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
      setError(''); // Clear "label with password" error when label is empty
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
      // Clear "label with password" error if check-name returns false (no conflict)
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
      // Update ref immediately so it's available in timeouts
      editingProfileRef.current = updated;
      return updated;
    });
    
    // Clear "label with password" error only when password changes
    if (field === 'password') {
      // Clear the "label with password" error when password changes
      // Also clear nameConflict since the combination error doesn't mean the label alone exists
      if (error === 'Name and password combination already exists') {
        setError('');
        setNameConflict(false);
      }
    }
    
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
        showToast('Please select an event to update event-specific authorizations', 'error');
        return;
      }
      
      if (!hasEventSpecificChanges) {
        showToast('No event-specific changes to save', 'info');
        return;
      }
      
      // Use the event-specific save handler (which only sends event-specific fields)
      await handleSaveEventSpecific();
      return;
    }

    // Normal validation for editable profiles or when creating
    if (nameConflict) {
      showToast('Cannot save: Profile name already exists', 'error');
      return;
    }

    if (!editingProfile.label.trim()) {
      showToast('Profile name cannot be empty', 'error');
      return;
    }

    // Validate password is not null or empty (required when creating)
    if (isCreating) {
      const passwordValue = editingProfile.password?.trim();
      if (!passwordValue || passwordValue.length === 0) {
        showToast('Password is required', 'error');
        return;
      }
    } else {
      // When editing, ensure password is not null/empty if it exists in editingProfile
      // (password field is not shown when editing, so this is a safety check)
      if (editingProfile.password !== undefined && (!editingProfile.password || !editingProfile.password.trim())) {
        showToast('Password cannot be empty', 'error');
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
        email: editingProfile.email || null,
        hierarchy_rank: editingProfile.hierarchy_rank,
        can_create_events: Boolean(editingProfile.can_create_events),
        is_public: Boolean(editingProfile.is_public),
        restricted_to_event: editingProfile.restricted_to_event || null
      };
      
      // Include password when creating/editing (required, already validated above)
      if (editingProfile.password) {
        generalProfileData.password = editingProfile.password.trim();
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
        showToast(`Profile "${editingProfile.label}" created successfully`, 'success');
        
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
        
        showToast('Profile updated successfully', 'success');
        
        // Changes are automatically applied by apiService interceptor
        if (onSave) onSave();
        
        // Close modal when updating
        onClose();
      }
    } catch (error) {
      console.error(`Failed to ${isCreating ? 'create' : 'update'} profile:`, error);
      const rawErrorMsg = error.response?.data?.error || error.message || '';
      
      // Check for specific database policy errors that need special handling
      if (rawErrorMsg.includes('Label with this password already exists')) {
        // Label AND password combination already exists
        // Don't set nameConflict=true because this is about the combination, not just the label
        setNameConflict(false);
        setError('Name and password combination already exists');
        // Don't show toast for this error, show error message near the name field instead
      } else if (rawErrorMsg.includes('Profile label already exists') && !rawErrorMsg.includes('Label with this password')) {
        // Only label exists (not the combination)
        setNameConflict(true);
        setError('');
        // Don't show toast for this error, show "Name exists" near the name field instead
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
    return event?.name || 'Untitled Event';
  }, [selectedEventId, eventsList, allEventsList, isCreating]);

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
      const evtName = event?.name || 'Untitled Event';
      return evtName.toLowerCase().includes(searchLower);
    });
  }, [eventsList, eventSearchTerm]);

  // Reset highlighted index when filtered events change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredEvents.length, eventSearchTerm]);

  // Handle event selection (prevent if there are unsaved changes)
  const handleEventSelect = (evtId) => {
    if (hasEventSpecificChanges) {
      showToast('Please save or cancel event-specific changes before switching events', 'error');
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
      
      showToast('Event-specific authorizations saved successfully', 'success');
    } catch (error) {
      console.error('Failed to save event-specific authorizations:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Failed to save event-specific authorizations';
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
      
      showToast('Event removed from profile', 'success');
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
      showToast('Event added to profile', 'success');
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
      options.push({ id: null, name: 'Clear Selection', isPlaceholder: false, isClear: true });
    }
    // Add "Select Event" if no eventId from URL and not searching
    if (!eventId && !eventSearchTerm && !selectedEventId) {
      options.push({ id: null, name: 'Select Event', isPlaceholder: true });
    }
    filteredEvents.forEach(event => {
      const evtId = event?.event_id || event?.id;
      const evtName = event?.name || 'Untitled Event';
      options.push({ id: evtId, name: evtName, isPlaceholder: false });
    });
    return options;
  }, [filteredEvents, eventId, eventSearchTerm, selectedEventId]);

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
      return {
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
          return `${API_BASE}/api/events/${selectedEventId}/high_quality/${imageId}.webp`;
        },
        getOriginalUrl: (imageId) => {
          if (!selectedEventId) return null;
          return `${API_BASE}/api/events/${selectedEventId}/original/${imageId}.webp`;
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
    }
    // Fallback to prop urlHelpers if available
    return urlHelpers || null;
  }, [selectedEventId, urlHelpers, eventsList, eventId, eventUrl]);

  const handleRemoveImage = async (imageId) => {
    try {
      const targetEventUrl = getEventUrlFromId(selectedEventId) || eventUrl;
      await profilesAPI.removeImagesFromProfile(editingProfile.id, [imageId], targetEventUrl);
      // Changes are automatically applied by apiService interceptor
      showToast('Photo removed from profile', 'success');
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
      showToast('Album removed from profile', 'success');
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
      showToast(`${imageIds.length} photos cleared from profile`, 'success');
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
      showToast(`${albumIds.length} albums cleared from profile`, 'success');
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
      showToast('Group removed from profile', 'success');
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
      showToast(`${groupIds.length} groups cleared from profile`, 'success');
    } catch (error) {
      console.error('Failed to clear groups:', error);
      showToast(formatErrorMessage('clear groups', error), 'error');
    }
  };

  if (!isOpen || !editingProfile) return null;

  const maxRank = (currentProfile?.hierarchy_rank || 0) - 1;
  const rankOptions = Array.from({ length: Math.max(0, maxRank) + 1 }, (_, i) => i);

  const hasEmailField = !Boolean(editingProfile.is_public);
  const basicInfoGridLayout = hasEmailField
    ? 'md:grid-cols-[15rem_15rem_auto]'
    : 'md:grid-cols-[15rem_auto]';

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
          className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
          tabIndex={-1}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <User className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {isCreating ? 'Create Profile' : 'Edit Profile'}
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
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center space-x-2">
                    <User className="w-4 h-4" />
                    <span>Basic Information</span>
                  </h3>

                  <div className={`flex flex-col gap-3 md:grid ${basicInfoGridLayout} md:justify-center md:items-start md:gap-3`}>
                    {/* Label */}
                    <div className="w-full md:w-full">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Profile Name <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={editingProfile.label}
                          onChange={(e) => handleFieldChange('label', e.target.value)}
                        className={`w-full h-10 px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                            (nameConflict || error === 'Name and password combination already exists') ? 'border-red-500' : 'border-gray-300'
                          }`}
                          placeholder="Enter profile name"
                        />
                        {(nameConflict || error === 'Name and password combination already exists') && (
                          <div className="absolute top-full left-0 mt-1 flex items-center space-x-1 text-red-500 text-xs">
                            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                            <span>
                              {error === 'Name and password combination already exists' 
                                ? 'Name and password combination already exists'
                                : 'Name exists'}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Email - only for non-public profiles */}
                    {hasEmailField && (
                      <div className="w-full md:w-full">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Email
                        </label>
                        <input
                          type="email"
                          value={editingProfile.email || ''}
                          onChange={(e) => handleFieldChange('email', e.target.value)}
                          autoComplete={isCreating ? "off" : "email"}
                          className="w-full h-10 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus;border-transparent"
                          placeholder="Enter email (optional)"
                        />
                      </div>
                    )}

                    {/* Password */}
                    <div className={`flex flex-col gap-1 ${isCreating ? 'w-full md:w-full' : 'md:justify-self-center'}`}>
                      <label className="block text-xs font-medium text-gray-600">
                        Password {isCreating && <span className="text-red-500">*</span>}
                      </label>
                      {isCreating ? (
                        <form onSubmit={(e) => e.preventDefault()} autoComplete="off">
                          <input
                            type="text"
                            name="username"
                            autoComplete="username"
                            value={editingProfile.label || ''}
                            readOnly
                            style={{ display: 'none' }}
                          />
                          <input
                            type="password"
                            value={editingProfile.password || ''}
                            onChange={(e) => handleFieldChange('password', e.target.value)}
                            autoComplete="new-password"
                            className="w-full h-10 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Enter password (required)"
                          />
                        </form>
                      ) : (
                        <button
                          onClick={() => setShowPasswordModal(true)}
                          className="w-10 h-10 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center"
                          title="Change password"
                        >
                          <Key className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* General Authorizations Section */}
              {!isCurrentProfileRestricted && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
                  <Shield className="w-5 h-5" />
                  <span>General Authorizations</span>
                </h3>

                <div className="space-y-3">
                  {/* Restricted to Event */}
                  <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">Restricted to Event</p>
                      <p className="text-sm text-gray-500">Profile is restricted to a specific event</p>
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
                            placeholder="Select event or clear"
                            className="px-3 py-1.5 pr-8 text-sm border border-gray-300 rounded-lg bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent w-64 disabled:opacity-60 disabled:cursor-not-allowed"
                            disabled={disableRestrictionToggle}
                            title={disableRestrictionToggle ? restrictionTooltip : undefined}
                          />
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
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
                                restrictionOptions.push({ id: null, name: 'Clear Selection', isClear: true });
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
                                  const aName = (a?.name || 'Untitled Event').toLowerCase();
                                  const bName = (b?.name || 'Untitled Event').toLowerCase();
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
                                  const aName = (a?.name || 'Untitled Event').toLowerCase();
                                  const bName = (b?.name || 'Untitled Event').toLowerCase();
                                  return aName.localeCompare(bName);
                                });
                              }
                              
                              // Filter events based on search term
                              const filtered = restrictionSearchTerm.trim()
                                ? eventsToShow.filter(e => 
                                    (e?.name || 'Untitled Event').toLowerCase().includes(restrictionSearchTerm.toLowerCase())
                                  )
                                : eventsToShow;
                              
                              filtered.forEach(event => {
                                const evtId = event?.event_id || event?.id;
                                const evtName = event?.name || 'Untitled Event';
                                restrictionOptions.push({ id: evtId, name: evtName, event: event });
                              });
                              
                              return restrictionOptions.length === 0 ? (
                                <div className="px-3 py-2 text-sm text-gray-500">
                                  {restrictionSearchTerm ? 'No events found' : 'No events available'}
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
                        <p className="font-medium text-gray-900">Rank</p>
                        <div className="relative">
                          <HelpCircle 
                            className="w-3.5 h-3.5 text-gray-400 cursor-help" 
                            onMouseEnter={() => setShowRankTooltip(true)}
                            onMouseLeave={() => setShowRankTooltip(false)}
                          />
                          {showRankTooltip && (
                            <div className="absolute left-0 top-6 w-64 p-3 bg-gray-900 text-white text-sm rounded-lg shadow-lg z-50 whitespace-normal">
                              Can create and manage profiles with lower rank. Rank 0 has no managing authority.
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-500">Can manage profiles with lower rank</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {disableRankSelection ? (
                        <div
                          className="w-32 h-10 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 opacity-80 flex items-center"
                          title="Public profiles use default rank"
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
                        <p className="font-medium text-gray-900">Can Create Events</p>
                        <p className="text-sm text-gray-500">Can create new events</p>
                      </div>
                      <div className="flex flex-col items-end">
                        <label className={`relative inline-flex items-center ${canGrantCanCreateEvents && !disableCanCreateEvents ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`} title={disableCanCreateEvents ? (Boolean(editingProfile?.is_public) ? 'Public profiles cannot create events' : 'Restricted profiles cannot create events') : undefined}>
                          <input
                            type="checkbox"
                            checked={Boolean(editingProfile.can_create_events)}
                            onChange={(e) => handleFieldChange('can_create_events', Boolean(e.target.checked))}
                            disabled={!canGrantCanCreateEvents || disableCanCreateEvents}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                        {disableCanCreateEvents && (
                          <p className="mt-1 text-xs text-gray-500 text-right">
                            {Boolean(editingProfile?.is_public) 
                              ? 'Public profiles cannot create events.'
                              : 'Restricted profiles cannot create events.'}
                          </p>
                        )}
                        {!canGrantCanCreateEvents && !disableCanCreateEvents && (
                          <p className="mt-1 text-xs text-gray-500 text-right">
                            You do not have permission to grant this.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Public Profile */}
                  <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                    <div className="relative">
                      <div className="flex items-center gap-1">
                        <p className="font-medium text-gray-900">Public Profile</p>
                        <div className="relative">
                          <HelpCircle 
                            className="w-3.5 h-3.5 text-gray-400 cursor-help" 
                            onMouseEnter={() => setShowPublicTooltip(true)}
                            onMouseLeave={() => setShowPublicTooltip(false)}
                          />
                          {showPublicTooltip && (
                            <div className="absolute left-0 top-6 w-64 p-3 bg-gray-900 text-white text-sm rounded-lg shadow-lg z-50 whitespace-normal">
                              Accessible via link. Cannot edit own label/password. No email. Preferences not saved.
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-500">Accessible via link, managed by admins only</p>
                    </div>
                    <div className="flex flex-col items-end">
                      <label
                        className={`relative inline-flex items-center ${disablePublicToggle ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                        title={disablePublicToggle ? publicToggleTooltip : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(editingProfile.is_public)}
                          onChange={(e) => handleFieldChange('is_public', Boolean(e.target.checked))}
                          className="sr-only peer"
                          disabled={disablePublicToggle}
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
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
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
                    <Calendar className="w-5 h-5" />
                    <span>Profile Events</span>
                  </h3>
                  
                  <div className="space-y-2">
                    {profileEventsList.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-2">No events assigned</p>
                    ) : (
                      profileEventsList.map((event) => {
                        const eventId = event.event_id || event.id;
                        const eventName = event.name || 'Untitled Event';
                        return (
                          <div
                            key={eventId}
                            className="flex items-center justify-between py-2 px-3 bg-white rounded-lg border border-gray-200"
                          >
                            <span className="text-sm text-gray-900">{eventName}</span>
                            <button
                              onClick={() => handleRemoveProfileEvent(eventId)}
                              className="w-6 h-6 flex items-center justify-center text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Remove event"
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
                          <option value="">Select event to add...</option>
                          {availableEventsToAdd.map((event) => {
                            const eventId = event.event_id || event.id;
                            const eventName = event.name || 'Untitled Event';
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
                          title="Add event"
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
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
                    <Shield className="w-5 h-5" />
                    <span>Specific Event Authorizations</span>
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
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveEventSpecific}
                          disabled={savingEventSpecific}
                          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {savingEventSpecific ? (
                            <>
                              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              <span>Saving...</span>
                            </>
                          ) : (
                            <>
                              <Save className="w-3 h-3" />
                              <span>Save</span>
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
                              placeholder={!eventId ? "Select Event" : "Search events..."}
                              disabled={hasEventSpecificChanges}
                              className={`px-3 py-1.5 pr-8 text-sm border border-gray-300 rounded-lg bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent w-64 ${
                                hasEventSpecificChanges ? 'opacity-60 cursor-not-allowed' : ''
                              }`}
                              title={hasEventSpecificChanges ? 'Please save or cancel changes before switching events' : undefined}
                            />
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                          </div>
                          {showEventDropdown && (
                            <div
                              ref={eventDropdownRef}
                              className="absolute z-50 mt-1 w-64 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto"
                            >
                              {selectableOptions.length === 0 ? (
                                <div className="px-3 py-2 text-sm text-gray-500">
                                  {eventSearchTerm ? 'No events found' : 'No events available'}
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
                                      title={isDisabled ? 'Please save or cancel changes before switching events' : undefined}
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
                            <p className="font-medium text-gray-900">Manage Event</p>
                            <div className="relative">
                              <HelpCircle 
                                className="w-3.5 h-3.5 text-gray-400 cursor-help" 
                                onMouseEnter={() => setShowManageEventTooltip(true)}
                                onMouseLeave={() => setShowManageEventTooltip(false)}
                              />
                              {showManageEventTooltip && (
                                <div className="absolute left-0 top-6 w-64 p-3 bg-gray-900 text-white text-sm rounded-lg shadow-lg z-50 whitespace-normal">
                                  Can edit event name, URL, upload limits, and cover photo
                                </div>
                              )}
                            </div>
                          </div>
                          <p className="text-sm text-gray-500">Can update event settings</p>
                        </div>
                        <div className="flex flex-col items-end">
                          <label className={`relative inline-flex items-center ${disableEventManagementToggles || !canGrantCanManageEvent ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                            <input
                              type="checkbox"
                              checked={Boolean(editingProfile.can_manage_event)}
                              onChange={(e) => handleFieldChange('can_manage_event', Boolean(e.target.checked))}
                              className="sr-only peer"
                              disabled={disableEventManagementToggles || !canGrantCanManageEvent}
                            />
                            <div
                              className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
                              title={disableEventManagementToggles ? 'Public profiles cannot manage events' : !canGrantCanManageEvent ? 'You do not have permission to grant this' : undefined}
                            ></div>
                          </label>
                          {disableEventManagementToggles && (
                            <p className="mt-1 text-xs text-gray-500 text-right">
                              Public profiles cannot manage events.
                            </p>
                          )}
                          {!canGrantCanManageEvent && !disableEventManagementToggles && (
                            <p className="mt-1 text-xs text-gray-500 text-right">
                              You do not have permission to grant this.
                            </p>
                          )}
                        </div>
                      </div>
                    </PermissionGate>

                    {/* Delete Event */}
                    <PermissionGate requires="canManageEvent" eventUrl={selectedEventUrl}>
                      <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                        <div>
                          <p className="font-medium text-gray-900">Delete Event</p>
                          <p className="text-sm text-gray-500">Can permanently delete this event and all related data</p>
                        </div>
                        <div className="flex flex-col items-end">
                          <label className={`relative inline-flex items-center ${disableEventManagementToggles || !canGrantCanDeleteEvent ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                            <input
                              type="checkbox"
                              checked={Boolean(editingProfile.can_delete_event)}
                              onChange={(e) => handleFieldChange('can_delete_event', Boolean(e.target.checked))}
                              className="sr-only peer"
                              disabled={disableEventManagementToggles || !canGrantCanDeleteEvent}
                            />
                            <div
                              className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
                              title={disableEventManagementToggles ? 'Public profiles cannot delete events' : !canGrantCanDeleteEvent ? 'You do not have permission to grant this' : undefined}
                            ></div>
                          </label>
                          {disableEventManagementToggles && (
                            <p className="mt-1 text-xs text-gray-500 text-right">
                              Public profiles cannot delete events.
                            </p>
                          )}
                          {!canGrantCanDeleteEvent && !disableEventManagementToggles && (
                            <p className="mt-1 text-xs text-gray-500 text-right">
                              You do not have permission to grant this.
                            </p>
                          )}
                        </div>
                      </div>
                    </PermissionGate>

                    {/* Upload & Delete Images */}
                    <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                      <div className="relative">
                        <div className="flex items-center gap-1">
                          <p className="font-medium text-gray-900">Upload & Delete Photos</p>
                        </div>
                        <p className="text-sm text-gray-500">Can upload new photos and delete existing ones</p>
                      </div>
                      <div className="flex flex-col items-end">
                        <label className={`relative inline-flex items-center ${canGrantCanUploadAndDeleteImages && !disableCanUploadAndDeleteImages ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`} title={disableCanUploadAndDeleteImages ? canUploadAndDeleteImagesDisabledReason : undefined}>
                          <input
                            type="checkbox"
                            checked={Boolean(editingProfile.can_upload_and_delete_images)}
                          onChange={(e) => {
                            const newValue = Boolean(e.target.checked);
                            handleFieldChange('can_upload_and_delete_images', newValue);
                            // If enabling upload, also enable can_edit and all_groups (constraint)
                            if (Boolean(newValue)) {
                              handleFieldChange('can_edit', true);
                              handleFieldChange('all_groups', true);
                            }
                          }}
                            disabled={!canGrantCanUploadAndDeleteImages || disableCanUploadAndDeleteImages}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
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
                        <p className="font-medium text-gray-900">Can Edit</p>
                        <p className="text-sm text-gray-500">Can edit albums, groups, moments, and transfer faces</p>
                      </div>
                      <div className="flex flex-col items-end">
                        <label className={`relative inline-flex items-center ${canGrantCanEdit && !requiresCanEdit && !disableCanEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`} title={disableCanEdit ? 'Public profiles cannot have edit permissions' : requiresCanEdit ? 'Required when Upload & Delete Photos is enabled' : undefined}>
                          <input
                            type="checkbox"
                            checked={Boolean(editingProfile.can_edit)}
                            onChange={(e) => {
                              const newValue = Boolean(e.target.checked);
                              // If disabling can_edit while can_upload_and_delete_images is enabled, also disable upload
                              if (!newValue && Boolean(editingProfile.can_upload_and_delete_images)) {
                                handleFieldChange('can_upload_and_delete_images', false);
                              }
                              handleFieldChange('can_edit', Boolean(newValue));
                            }}
                            disabled={!canGrantCanEdit || requiresCanEdit || disableCanEdit}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                        {disableCanEdit && (
                          <p className="mt-1 text-xs text-gray-500 text-right">
                            Public profiles cannot have edit permissions.
                          </p>
                        )}
                        {requiresCanEdit && !disableCanEdit && (
                          <p className="mt-1 text-xs text-gray-500 text-right">
                            Required when Upload & Delete Photos is enabled
                          </p>
                        )}
                      </div>
                    </div>

                    {/* All Images */}
                    <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                      <div className="relative">
                        <div className="flex items-center gap-1">
                          <p className="font-medium text-gray-900">All Photos Access</p>
                          <div className="relative">
                            <HelpCircle 
                              className="w-3.5 h-3.5 text-gray-400 cursor-help" 
                              onMouseEnter={() => setShowImagesTooltip(true)}
                              onMouseLeave={() => setShowImagesTooltip(false)}
                            />
                            {showImagesTooltip && (
                              <div className="absolute left-0 top-6 w-64 p-3 bg-gray-900 text-white text-sm rounded-lg shadow-lg z-50 whitespace-normal">
                                <div>Determines which photos are accessible.</div>
                                <div className="mt-1">Archived photos require archive album access.</div>
                              </div>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-gray-500">If ON: Access all photos except listed below. If OFF: Only access listed photos</p>
                      </div>
                      <label className={`relative inline-flex items-center ${canGrantAllImages ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                        <input
                          type="checkbox"
                          checked={Boolean(editingProfile.all_images)}
                          onChange={(e) => handleFieldChange('all_images', Boolean(e.target.checked))}
                          disabled={!canGrantAllImages}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 peer-disabled:opacity-50"></div>
                      </label>
                    </div>

                    {/* All Albums */}
                    <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                      <div className="relative">
                        <div className="flex items-center gap-1">
                          <p className="font-medium text-gray-900">All Albums Access</p>
                          <div className="relative">
                            <HelpCircle 
                              className="w-3.5 h-3.5 text-gray-400 cursor-help" 
                              onMouseEnter={() => setShowAlbumsTooltip(true)}
                              onMouseLeave={() => setShowAlbumsTooltip(false)}
                            />
                            {showAlbumsTooltip && (
                              <div className="absolute left-0 top-6 w-64 p-3 bg-gray-900 text-white text-sm rounded-lg shadow-lg z-50 whitespace-normal">
                                <div>Controls which albums are visible in collection.</div>
                                <div className="mt-1">Photo access follows the photos rule.</div>
                                <div className="mt-1">Archived photos require archive album access.</div>
                                <div className="mt-1">Without edit permission, empty albums are hidden.</div>
                              </div>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-gray-500">If ON: Access all albums except listed below. If OFF: Only access listed albums</p>
                      </div>
                      <label className={`relative inline-flex items-center ${canGrantAllAlbums ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                        <input
                          type="checkbox"
                          checked={Boolean(editingProfile.all_albums)}
                          onChange={(e) => handleFieldChange('all_albums', Boolean(e.target.checked))}
                          disabled={!canGrantAllAlbums}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 peer-disabled:opacity-50"></div>
                      </label>
                    </div>

                    {/* All Groups */}
                    <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                      <div className="relative">
                        <div className="flex items-center gap-1">
                          <p className="font-medium text-gray-900">All People Access</p>
                          <div className="relative">
                            <HelpCircle 
                              className="w-3.5 h-3.5 text-gray-400 cursor-help"
                              onMouseEnter={() => setShowGroupsTooltip(true)}
                              onMouseLeave={() => setShowGroupsTooltip(false)}
                            />
                            {showGroupsTooltip && (
                              <div className="absolute left-0 top-6 w-64 p-3 bg-gray-900 text-white text-sm rounded-lg shadow-lg z-50 whitespace-normal">
                                <div>Controls which people are visible in collection.</div>
                                <div className="mt-1">Inaccessible: no face rectangles, hidden from collection.</div>
                                <div className="mt-1">Without edit permission, empty people are hidden.</div>
                                <div className="mt-1">Unassociated faces are only accessible with edit permission.</div>
                              </div>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-gray-500">If ON: Access all groups except listed below. If OFF: Only access listed groups</p>
                      </div>
                      <div className="flex flex-col items-end">
                        <label className={`relative inline-flex items-center ${canGrantAllGroups && !disableAllGroups ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`} title={disableAllGroups ? allGroupsDisabledReason : undefined}>
                          <input
                            type="checkbox"
                            checked={Boolean(editingProfile.all_groups)}
                          onChange={(e) => {
                            const newValue = Boolean(e.target.checked);
                            // If disabling all_groups (restricting groups) while can_upload_and_delete_images is enabled, also disable upload
                            if (!newValue && Boolean(editingProfile.can_upload_and_delete_images)) {
                              handleFieldChange('can_upload_and_delete_images', false);
                            }
                            handleFieldChange('all_groups', Boolean(newValue));
                          }}
                            disabled={!canGrantAllGroups || disableAllGroups}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
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
                    <p className="text-sm">Select an event to configure event-specific authorizations</p>
                  </div>
                )}
              </div>
              )}

              {/* Specific Access - Images (only show for existing profiles and when event is selected) */}
              {!isCreating && selectedEventId && (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
                    <ImageIcon className="w-5 h-5" />
                    <span>Specific Photo Access ({profileImages.length})</span>
                  </h3>
                  {profileImages.length > 0 && (
                    <button
                      onClick={handleClearAllImages}
                      className="text-sm text-red-600 hover:text-red-700 hover:underline flex items-center space-x-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear All</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-600 mb-3">
                  {Boolean(editingProfile.all_images) 
                    ? '🚫 These photos are FORBIDDEN to this profile' 
                    : '✓ These are the ONLY photos accessible to this profile'}
                </p>
                {profileImages.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No specific photos configured
                  </p>
                ) : (
                  <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
                    {profileImages.map((image) => (
                      <ProfileImageThumb
                        key={image.id}
                        imageId={image.id}
                        eventUrl={getEventUrlFromId(selectedEventId) || eventUrl}
                        urlHelpers={dynamicUrlHelpers}
                        onRemove={() => handleRemoveImage(image.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
              )}

              {/* Specific Access - Albums (only show for existing profiles and when event is selected) */}
              {!isCreating && selectedEventId && (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
                    <FolderOpen className="w-5 h-5" />
                    <span>Specific Album Access ({profileAlbums.length})</span>
                  </h3>
                  {profileAlbums.length > 0 && (
                    <button
                      onClick={handleClearAllAlbums}
                      className="text-sm text-red-600 hover:text-red-700 hover:underline flex items-center space-x-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear All</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-600 mb-3">
                  {Boolean(editingProfile.all_albums) 
                    ? '🚫 These albums are FORBIDDEN to this profile' 
                    : '✓ These are the ONLY albums accessible to this profile'}
                </p>
                {profileAlbums.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No specific albums configured
                  </p>
                ) : (
                  <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
                    {profileAlbums.map((album) => (
                      <ProfileAlbumThumb
                        key={album.id}
                        album={album}
                        eventUrl={getEventUrlFromId(selectedEventId) || eventUrl}
                        urlHelpers={dynamicUrlHelpers}
                        onRemove={() => handleRemoveAlbum(album.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
              )}

              {/* Specific Access - Groups (only show for existing profiles and when event is selected) */}
              {!isCreating && selectedEventId && (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
                    <Users className="w-5 h-5" />
                    <span>Specific Person Access ({profileGroups.length})</span>
                  </h3>
                  {profileGroups.length > 0 && (
                    <button
                      onClick={handleClearAllGroups}
                      className="text-sm text-red-600 hover:text-red-700 hover:underline flex items-center space-x-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear All</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-600 mb-3">
                  {Boolean(editingProfile.all_groups) 
                    ? '🚫 These people are FORBIDDEN to this profile' 
                    : '✓ These are the ONLY people accessible to this profile'}
                </p>
                {profileGroups.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No specific people configured
                  </p>
                ) : (
                  <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
                    {profileGroups.map((group) => (
                      <ProfileGroupThumb
                        key={group.id}
                        group={group}
                        eventUrl={getEventUrlFromId(selectedEventId) || eventUrl}
                        urlHelpers={dynamicUrlHelpers}
                        onRemove={() => handleRemoveGroup(group.id)}
                      />
                    ))}
                  </div>
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
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end space-x-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={
                loading || 
                savingEventSpecific ||
                (isProfileEditable && (nameConflict || !editingProfile.label.trim() || (isCreating && !editingProfile.password?.trim()))) ||
                (!isProfileEditable && !isCreating && (!selectedEventId || !hasEventSpecificChanges)) ||
                (isProfileEditable && !hasChanges && !hasEventSpecificChanges)
              }
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>{isCreating ? 'Creating...' : 'Saving...'}</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>{isCreating ? 'Create' : 'Save'}</span>
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>

      {/* Change Password Modal (nested) */}
      {showPasswordModal && (
        <ChangePasswordModal
          isOpen={showPasswordModal}
          onClose={() => setShowPasswordModal(false)}
          profileId={editingProfile.id}
          profileLabel={editingProfile.label}
          eventUrl={eventUrl}
        />
      )}

      {/* Remove Event Confirmation Modal */}
      {eventToRemove && (() => {
        const eventToRemoveObj = profileEventsList.find(e => {
          const evtId = e.event_id || e.id;
          return evtId && String(evtId) === String(eventToRemove);
        });
        const eventName = eventToRemoveObj?.name || 'this event';
        return (
          <ConfirmDelete
            isOpen={!!eventToRemove}
            onClose={() => setEventToRemove(null)}
            onConfirm={handleConfirmRemoveEvent}
            title="Remove Event from Profile"
            message="Are you sure you want to remove"
            itemName={eventName}
            confirmText="Remove Event"
            caption="All profile authorizations for this event will be removed."
            simpleMessage={false}
          />
        );
      })()}
    </AnimatePresence>
  );
}

// ProfileImageThumb component for grid display
function ProfileImageThumb({ imageId, eventUrl, urlHelpers, onRemove }) {
  const getUrl = () => {
    if (!urlHelpers) return null;
    return urlHelpers.getRelativeThumbnailUrl(imageId);
  };

  return (
    <RemovableThumbnail
      imageUrl={getUrl()}
      alt={imageId}
      onRemove={onRemove}
      size="medium"
      title="Click to remove"
    />
  );
}

// ProfileAlbumThumb component for grid display
function ProfileAlbumThumb({ album, eventUrl, urlHelpers, onRemove }) {
  const getUrl = () => {
    if (!urlHelpers || !urlHelpers.getRepresentativeUrl) return null;
    return `${urlHelpers.getRepresentativeUrl('albums', album.id)}?v=${album.representative_image || 'none'}`;
  };

  return (
    <RemovableThumbnail
      imageUrl={getUrl()}
      alt={album.label}
      onRemove={onRemove}
      text={album.label}
      size="medium"
      withGradient={true}
      iconType="image"
      title="Click to remove"
    />
  );
}

// ProfileGroupThumb component for grid display
function ProfileGroupThumb({ group, eventUrl, urlHelpers, onRemove }) {
  const getUrl = () => {
    if (!urlHelpers || !urlHelpers.getRepresentativeUrl) return null;
    return `${urlHelpers.getRepresentativeUrl('groups', group.id)}?v=${group.representative_face || 'none'}`;
  };

  return (
    <RemovableThumbnail
      imageUrl={getUrl()}
      alt={group.label}
      onRemove={onRemove}
      text={group.label}
      size="medium"
      withGradient={true}
      iconType="image"
      title="Click to remove"
    />
  );
}




