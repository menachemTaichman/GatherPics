import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Key, Shield, Image as ImageIcon, FolderOpen, Users, AlertTriangle, AlertCircle, Save, Trash2, MapPin, ChevronDown, Calendar, Plus } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalStore } from '../../utils/modalManager';
import { profilesAPI, getEventUrlById, API_BASE } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { getCurrentProfile } from '../../utils/profileService';
import { useApplyScopes, useChilds, useEventId } from '../../utils/storeUtils';
import { useDataStore } from '../../utils/dataManager';
import { useEventGeneralById, useProfileById, useEventProfileById } from '../../utils/dataManager';
import { formatErrorMessage } from '../../utils/errorHandler';
import { ChangePasswordModal } from './';
import { RemovableThumbnail } from '../common';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../common/PermissionGate';

export default function EditProfileModal({ isOpen, onClose, profile, eventUrl, urlHelpers, onSave, isCreating = false, initialEventId = null }) {
  const eventId = useEventId(eventUrl);
  const { showToast } = useToast();
  const MODAL_ID = 'edit-profile-modal';
  const currentProfile = getCurrentProfile();
  const isCurrentProfileRestricted = Boolean(currentProfile?.restricted_to_event);
  const currentProfileRestrictedEventId = currentProfile?.restricted_to_event || null;
  
  // Get general profile data (includes email and other general fields)
  const generalProfile = useProfileById(profile?.id);
  
  // Local editing state
  const [editingProfile, setEditingProfile] = useState(null);
  const [initialProfileState, setInitialProfileState] = useState(null);
  const [initialSelectedEventId, setInitialSelectedEventId] = useState(null);
  const [profileEvents, setProfileEvents] = useState([]); // Track profile's events list
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [nameConflict, setNameConflict] = useState(false);
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
  
  // Restriction combobox state
  const [restrictionSearchTerm, setRestrictionSearchTerm] = useState('');
  const [showRestrictionDropdown, setShowRestrictionDropdown] = useState(false);
  const [restrictionHighlightedIndex, setRestrictionHighlightedIndex] = useState(0);
  const restrictionInputRef = useRef(null);
  const restrictionInputElementRef = useRef(null);
  const restrictionDropdownRef = useRef(null);
  const addEventSelectRef = useRef(null);
  
  // Get events list from profile's events field in general store
  const generalEventsStore = useDataStore((state) => state.entities?.general?.events || {});
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
  // Check for explicit value of 1 (not just truthy)
  const canGrantCanCreateEvents = currentProfile?.can_create_events === 1;
  const canGrantCanUploadAndDeleteImages = currentProfileEventPermissions?.can_upload_and_delete_images === 1;
  const canGrantCanEdit = currentProfileEventPermissions?.can_edit === 1;
  const canGrantAllImages = currentProfileEventPermissions?.all_images === 1;
  const canGrantAllGroups = currentProfileEventPermissions?.all_groups === 1;
  const canGrantAllAlbums = currentProfileEventPermissions?.all_albums === 1;
  const canGrantCanManageEvent = currentProfileEventPermissions?.can_manage_event === 1;
  const canGrantCanDeleteEvent = currentProfileEventPermissions?.can_delete_event === 1;
  
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
  
const permissions = usePermissions(eventUrl);

// Use editingProfile if it exists (even if null), otherwise fall back to generalProfile
const restrictedToEventId = editingProfile && 'restricted_to_event' in editingProfile
  ? editingProfile.restricted_to_event || null
  : (generalProfile?.restricted_to_event || null);
const restrictedEvent = useEventGeneralById(restrictedToEventId);
const restrictedEventName = editingProfile && 'restricted_to_event_name' in editingProfile
  ? (editingProfile.restricted_to_event_name || null)
  : (generalProfile?.restricted_to_event_name ?? restrictedEvent?.name ?? null);

const matchesCurrentEvent =
  !!restrictedToEventId && !!eventId
    ? String(restrictedToEventId) === String(eventId)
    : false;
const publicToggleRestrictedByEvent = !isCreating && !!generalProfile && !matchesCurrentEvent;
const publicToggleRestrictedByRank = (editingProfile?.hierarchy_rank ?? 0) > 0;
const disablePublicToggle = publicToggleRestrictedByEvent || publicToggleRestrictedByRank;
const publicToggleTooltip = publicToggleRestrictedByRank
  ? 'Public profiles must use rank 0.'
  : publicToggleRestrictedByEvent
    ? 'Public access is only available for profiles restricted to this event.'
    : undefined;
const disableRestrictionToggle = Boolean(currentProfile?.restricted_to_event);
const restrictionTooltip = disableRestrictionToggle
  ? 'You are restricted to an event and cannot change restrictions'
  : `Manage restrictions`
const disableEventManagementToggles = editingProfile?.is_public === 1;
const disableRankSelection = editingProfile?.is_public === 1;

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
      
      const normalizedCurrent = currentValue === null || currentValue === undefined ? null : currentValue;
      const normalizedInitial = initialValue === null || initialValue === undefined ? null : initialValue;
      
      if (String(normalizedCurrent || '') !== String(normalizedInitial || '')) {
        return true;
      }
    }
    
    return false;
  }, [editingProfile, initialEventSpecificState, selectedEventId]);

  // Check if profile has been modified (defined early so it can be used in handlers)
  const hasChanges = useMemo(() => {
    if (isCreating) {
      return true; // Always allow save when creating
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
      
      // Normalize values for comparison (handle null/undefined)
      const normalizedCurrent = currentValue === null || currentValue === undefined ? null : currentValue;
      const normalizedInitial = initialValue === null || initialValue === undefined ? null : initialValue;
      
      if (String(normalizedCurrent || '') !== String(normalizedInitial || '')) {
        return true;
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

  // Initialize editing state from merged profile data (only once when modal opens)
  useEffect(() => {
    if (isOpen && profile) {
      // Use the merged profile for initial data, but only set it once
      const initialProfile = generalProfile ? { ...profile, ...generalProfile } : profile;
      // Get event-specific data from eventProfile if available
      const eventProfileData = eventProfile || {};
      const initialEditingState = {
        id: initialProfile.id || initialProfile.profile_id,
        label: initialProfile.label || '',
        email: initialProfile.email || '',
        hierarchy_rank: initialProfile.hierarchy_rank || 0,
        can_create_events: initialProfile.can_create_events || 0,
        can_upload_and_delete_images: eventProfileData.can_upload_and_delete_images ?? initialProfile.can_upload_and_delete_images ?? 0,
        can_edit: eventProfileData.can_edit ?? initialProfile.can_edit ?? 0,
        all_images: eventProfileData.all_images ?? initialProfile.all_images ?? 0,
        all_groups: eventProfileData.all_groups ?? initialProfile.all_groups ?? 0,
        all_albums: eventProfileData.all_albums ?? initialProfile.all_albums ?? 0,
        is_public: initialProfile.is_public || 0,
        can_manage_event: eventProfileData.can_manage_event ?? initialProfile.can_manage_event ?? 0,
        can_delete_event: eventProfileData.can_delete_event ?? initialProfile.can_delete_event ?? 0,
        restricted_to_event: initialProfile.restricted_to_event || null,
        restricted_to_event_name: initialProfile.restricted_to_event_name || null
      };
      setEditingProfile(initialEditingState);
      setInitialProfileState(initialEditingState);
      setNameConflict(false);
      // Initialize profile events from generalProfile
      const initialEvents = Array.isArray(initialProfile.events) ? [...initialProfile.events] : [];
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, profile?.id, initialEventId]); // Only re-initialize when modal opens or profile ID changes (generalProfile intentionally excluded to prevent input resets)

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
  }, [isOpen, selectedEventId]);

  // Update event-specific fields when eventProfile loads for current event
  // Also track initial state for save/cancel
  useEffect(() => {
    if (!isOpen || !editingProfile) return;
    
    if (selectedEventId && eventProfile) {
      const eventSpecificData = {
        can_upload_and_delete_images: eventProfile.can_upload_and_delete_images ?? 0,
        can_edit: eventProfile.can_edit ?? 0,
        all_images: eventProfile.all_images ?? 0,
        all_groups: eventProfile.all_groups ?? 0,
        all_albums: eventProfile.all_albums ?? 0,
        can_manage_event: eventProfile.can_manage_event ?? 0,
        can_delete_event: eventProfile.can_delete_event ?? 0,
      };
      
      // Set initial state if we don't have it yet, or if eventId changed (meaning we had fallback state)
      const shouldSetInitialState = !initialEventSpecificState || 
        (initialEventSpecificEventId && String(initialEventSpecificEventId) !== String(selectedEventId));
      
      if (shouldSetInitialState) {
        setEditingProfile(prev => ({
          ...prev,
          ...eventSpecificData,
        }));
        
        setInitialEventSpecificState(eventSpecificData);
        setInitialEventSpecificEventId(selectedEventId);
      }
    } else if (selectedEventId && !eventProfile && !initialEventSpecificState) {
      // Fallback: Set initial state from editingProfile's current values if eventProfile not loaded yet
      // This allows change detection to work even before eventProfile loads
      const fallbackInitialState = {
        can_upload_and_delete_images: editingProfile.can_upload_and_delete_images ?? 0,
        can_edit: editingProfile.can_edit ?? 0,
        all_images: editingProfile.all_images ?? 0,
        all_groups: editingProfile.all_groups ?? 0,
        all_albums: editingProfile.all_albums ?? 0,
        can_manage_event: editingProfile.can_manage_event ?? 0,
        can_delete_event: editingProfile.can_delete_event ?? 0,
      };
      
      setInitialEventSpecificState(fallbackInitialState);
      setInitialEventSpecificEventId(selectedEventId);
    } else if (!selectedEventId) {
      // Reset event-specific fields when no event is selected
      const resetData = {
        can_upload_and_delete_images: 0,
        can_edit: 0,
        all_images: 0,
        all_groups: 0,
        all_albums: 0,
        can_manage_event: 0,
        can_delete_event: 0,
      };
      
      setEditingProfile(prev => ({
        ...prev,
        ...resetData,
      }));
      
      setInitialEventSpecificState(null);
      setInitialEventSpecificEventId(null);
    }
  }, [isOpen, eventProfile, selectedEventId, initialEventSpecificState, editingProfile]);


  const checkNameConflict = async (label) => {
    if (!label || !label.trim()) {
      setNameConflict(false);
      return;
    }

    try {
      const result = await profilesAPI.checkName(label.trim(), editingProfile.id);
      setNameConflict(result.conflict || false);
    } catch (error) {
      console.error('Error checking name conflict:', error);
      setNameConflict(false);
    }
  };

  const handleFieldChange = (field, value) => {
    setEditingProfile(prev => ({ ...prev, [field]: value }));
    
    // Debounce name conflict check
    if (field === 'label') {
      if (handleFieldChange._timeout) clearTimeout(handleFieldChange._timeout);
      handleFieldChange._timeout = setTimeout(() => {
        checkNameConflict(value);
      }, 300);
    }
  };

  const handleSave = async () => {
    if (nameConflict) {
      showToast('Cannot save: Profile name already exists', 'error');
      return;
    }

    if (!editingProfile.label.trim()) {
      showToast('Profile name cannot be empty', 'error');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // General profile data (always saved)
      const generalProfileData = {
        label: editingProfile.label,
        email: editingProfile.email || null,
        hierarchy_rank: editingProfile.hierarchy_rank,
        can_create_events: editingProfile.can_create_events,
        is_public: editingProfile.is_public,
        restricted_to_event: editingProfile.restricted_to_event || null
      };

      // Event-specific profile data (only if selectedEventId is set)
      // Send all fields - backend will handle permission validation
      const eventProfileData = selectedEventId ? {
        can_manage_event: editingProfile.can_manage_event,
        can_delete_event: editingProfile.can_delete_event,
        can_upload_and_delete_images: editingProfile.can_upload_and_delete_images,
        can_edit: editingProfile.can_edit,
        all_images: editingProfile.all_images,
        all_groups: editingProfile.all_groups,
        all_albums: editingProfile.all_albums
      } : {};

      if (isCreating) {
        // Create new profile - combine general and event data
        const createData = { ...generalProfileData, ...eventProfileData };
        const targetEventUrl = selectedEventId ? getEventUrlFromId(selectedEventId) : eventUrl;
        await profilesAPI.create(createData, targetEventUrl || eventUrl);
        showToast(`Profile "${editingProfile.label}" created successfully`, 'success');
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
      }
      
      // Changes are automatically applied by apiService interceptor
      
      if (onSave) onSave();
      onClose();
    } catch (error) {
      console.error(`Failed to ${isCreating ? 'create' : 'update'} profile:`, error);
      const errorMsg = error.response?.data?.error || error.message || `Failed to ${isCreating ? 'create' : 'update'} profile`;
      setError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Helper to get eventUrl from eventId
  const getEventUrlFromId = (targetEventId) => {
    if (!targetEventId) return null;
    // Try to find in eventsList first
    const event = eventsList.find(e => {
      const evtId = e.event_id || e.id;
      return evtId && String(evtId) === String(targetEventId);
    });
    if (event?.url) return event.url;
    // Try to find in generalEventsStore
    const eventFromStore = generalEventsStore[targetEventId];
    if (eventFromStore?.url) return eventFromStore.url;
    // Otherwise use the current eventUrl if it matches
    if (targetEventId === eventId) return eventUrl;
    return null;
  };

  // Get selected event name for display
  const selectedEventName = useMemo(() => {
    if (!selectedEventId) return '';
    const event = eventsList.find(e => {
      const evtId = e.event_id || e.id;
      return evtId && String(evtId) === String(selectedEventId);
    });
    return event?.name || 'Untitled Event';
  }, [selectedEventId, eventsList]);

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
      const eventProfileData = {
        can_manage_event: editingProfile.can_manage_event,
        can_delete_event: editingProfile.can_delete_event,
        can_upload_and_delete_images: editingProfile.can_upload_and_delete_images,
        can_edit: editingProfile.can_edit,
        all_images: editingProfile.all_images,
        all_groups: editingProfile.all_groups,
        all_albums: editingProfile.all_albums
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

  // Handle removing an event from profile
  const handleRemoveProfileEvent = async (eventIdToRemove) => {
    if (!editingProfile?.id || !eventIdToRemove) return;
    
    try {
      await profilesAPI.removeEvent(editingProfile.id, eventIdToRemove);
      // Changes are automatically applied by apiService interceptor
      showToast('Event removed from profile', 'success');
    } catch (error) {
      console.error('Failed to remove event from profile:', error);
      showToast(formatErrorMessage('remove event', error), 'error');
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
      showToast('Image removed from profile', 'success');
    } catch (error) {
      console.error('Failed to remove image:', error);
      showToast(formatErrorMessage('remove image', error), 'error');
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
      showToast(`${imageIds.length} images cleared from profile`, 'success');
    } catch (error) {
      console.error('Failed to clear images:', error);
      showToast(formatErrorMessage('clear images', error), 'error');
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

  const hasEmailField = editingProfile.is_public !== 1;
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
              {/* Basic Info Section - Compact */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center space-x-2">
                  <User className="w-4 h-4" />
                  <span>Basic Information</span>
                </h3>

                <div className={`flex flex-col gap-3 md:grid ${basicInfoGridLayout} md:justify-center md:items-start md:gap-3`}>
                  {/* Label */}
                  <div className="w-full md:w-full">
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Profile Name
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={editingProfile.label}
                        onChange={(e) => handleFieldChange('label', e.target.value)}
                      className={`w-full h-10 px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                          nameConflict ? 'border-red-500' : 'border-gray-300'
                        }`}
                        placeholder="Enter profile name"
                      />
                      {nameConflict && (
                        <div className="absolute top-full left-0 mt-1 flex items-center space-x-1 text-red-500 text-xs whitespace-nowrap">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Name exists</span>
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
                        className="w-full h-10 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus;border-transparent"
                        placeholder="Enter email (optional)"
                      />
                    </div>
                  )}

                  {/* Password */}
                  <div className="flex flex-col gap-1 md:justify-self-center">
                    <label className="block text-xs font-medium text-gray-600">
                      Password
                    </label>
                    <button
                      onClick={() => setShowPasswordModal(true)}
                      disabled={isCreating}
                      className="w-10 h-10 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                      title={isCreating ? 'Save profile first to set password' : 'Change password'}
                    >
                      <Key className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

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
                    <div className="flex items-center gap-2">
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
                            className="px-3 py-1.5 pr-8 text-sm border border-gray-300 rounded-lg bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent w-64"
                            disabled={disableRestrictionToggle}
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
                              // Filter events
                              const filtered = restrictionSearchTerm.trim()
                                ? eventsList.filter(e => 
                                    (e?.name || 'Untitled Event').toLowerCase().includes(restrictionSearchTerm.toLowerCase())
                                  )
                                : eventsList;
                              filtered.forEach(event => {
                                const evtId = event?.event_id || event?.id;
                                const evtName = event?.name || 'Untitled Event';
                                restrictionOptions.push({ id: evtId, name: evtName });
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
                                        } else {
                                          // Set restriction to selected event
                                          const selectedEvent = eventsList.find(e => {
                                            const evtId = e?.event_id || e?.id;
                                            return evtId && String(evtId) === String(option.id);
                                          });
                                          handleFieldChange('restricted_to_event', option.id);
                                          handleFieldChange('restricted_to_event_name', selectedEvent?.name || null);
                                        }
                                        setRestrictionSearchTerm('');
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
                    </div>
                  </div>

                  {/* Hierarchy Rank */}
                  <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">Rank</p>
                      <p className="text-sm text-gray-500">Hierarchy rank for this profile</p>
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
                  <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">Can Create Events</p>
                      <p className="text-sm text-gray-500">Can create new events</p>
                    </div>
                    <label className={`relative inline-flex items-center ${canGrantCanCreateEvents ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                      <input
                        type="checkbox"
                        checked={editingProfile.can_create_events === 1}
                        onChange={(e) => handleFieldChange('can_create_events', e.target.checked ? 1 : 0)}
                        disabled={!canGrantCanCreateEvents}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 peer-disabled:opacity-50"></div>
                    </label>
                  </div>

                  {/* Public Profile */}
                  <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">Public Profile</p>
                      <p className="text-sm text-gray-500">Accessible via link, managed by admins only</p>
                    </div>
                    <div className="flex flex-col items-end">
                      <label
                        className={`relative inline-flex items-center ${disablePublicToggle ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                        title={disablePublicToggle ? publicToggleTooltip : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={editingProfile.is_public === 1}
                          onChange={(e) => handleFieldChange('is_public', e.target.checked ? 1 : 0)}
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
                          onChange={(e) => {
                            if (e.target.value) {
                              handleAddProfileEvent(e.target.value);
                              e.target.value = ''; // Reset selection
                            }
                          }}
                          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          defaultValue=""
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
                            if (addEventSelectRef.current && addEventSelectRef.current.value) {
                              handleAddProfileEvent(addEventSelectRef.current.value);
                              addEventSelectRef.current.value = '';
                            }
                          }}
                          className="w-10 h-10 flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                          title="Add event"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Specific Event Authorizations Section */}
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
                    )}
                  </div>
                </div>

                {selectedEventId ? (
                  <div className="space-y-3">
                    {/* Manage Event */}
                    <PermissionGate requires="canManageEvent">
                      <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                        <div>
                          <p className="font-medium text-gray-900">Manage Event</p>
                          <p className="text-sm text-gray-500">Can update event settings, permissions, and approvals</p>
                        </div>
                        <div className="flex flex-col items-end">
                          <label className={`relative inline-flex items-center ${disableEventManagementToggles || !canGrantCanManageEvent ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                            <input
                              type="checkbox"
                              checked={editingProfile.can_manage_event === 1}
                              onChange={(e) => handleFieldChange('can_manage_event', e.target.checked ? 1 : 0)}
                              className="sr-only peer"
                              disabled={disableEventManagementToggles || !canGrantCanManageEvent}
                            />
                            <div
                              className={`w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all ${disableEventManagementToggles || !canGrantCanManageEvent ? '' : 'peer-checked:bg-blue-600'} peer-disabled:opacity-50`}
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
                    <PermissionGate requires="canManageEvent">
                      <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                        <div>
                          <p className="font-medium text-gray-900">Delete Event</p>
                          <p className="text-sm text-gray-500">Can permanently delete this event and all related data</p>
                        </div>
                        <div className="flex flex-col items-end">
                          <label className={`relative inline-flex items-center ${disableEventManagementToggles || !canGrantCanDeleteEvent ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                            <input
                              type="checkbox"
                              checked={editingProfile.can_delete_event === 1}
                              onChange={(e) => handleFieldChange('can_delete_event', e.target.checked ? 1 : 0)}
                              className="sr-only peer"
                              disabled={disableEventManagementToggles || !canGrantCanDeleteEvent}
                            />
                            <div
                              className={`w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all ${disableEventManagementToggles || !canGrantCanDeleteEvent ? '' : 'peer-checked:bg-blue-600'} peer-disabled:opacity-50`}
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
                      <div>
                        <p className="font-medium text-gray-900">Upload & Delete Images</p>
                        <p className="text-sm text-gray-500">Can upload new photos and delete existing ones</p>
                      </div>
                      <label className={`relative inline-flex items-center ${canGrantCanUploadAndDeleteImages ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                        <input
                          type="checkbox"
                          checked={editingProfile.can_upload_and_delete_images === 1}
                          onChange={(e) => handleFieldChange('can_upload_and_delete_images', e.target.checked ? 1 : 0)}
                          disabled={!canGrantCanUploadAndDeleteImages}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 peer-disabled:opacity-50"></div>
                      </label>
                    </div>

                    {/* Can Edit */}
                    <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">Can Edit</p>
                        <p className="text-sm text-gray-500">Can edit albums, groups, moments, and transfer faces</p>
                      </div>
                      <label className={`relative inline-flex items-center ${canGrantCanEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                        <input
                          type="checkbox"
                          checked={editingProfile.can_edit === 1}
                          onChange={(e) => handleFieldChange('can_edit', e.target.checked ? 1 : 0)}
                          disabled={!canGrantCanEdit}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 peer-disabled:opacity-50"></div>
                      </label>
                    </div>

                    {/* All Images */}
                    <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">All Images Access</p>
                        <p className="text-sm text-gray-500">If ON: Access all images except listed below. If OFF: Only access listed images</p>
                      </div>
                      <label className={`relative inline-flex items-center ${canGrantAllImages ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                        <input
                          type="checkbox"
                          checked={editingProfile.all_images === 1}
                          onChange={(e) => handleFieldChange('all_images', e.target.checked ? 1 : 0)}
                          disabled={!canGrantAllImages}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 peer-disabled:opacity-50"></div>
                      </label>
                    </div>

                    {/* All Albums */}
                    <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">All Albums Access</p>
                        <p className="text-sm text-gray-500">If ON: Access all albums except listed below. If OFF: Only access listed albums</p>
                      </div>
                      <label className={`relative inline-flex items-center ${canGrantAllAlbums ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                        <input
                          type="checkbox"
                          checked={editingProfile.all_albums === 1}
                          onChange={(e) => handleFieldChange('all_albums', e.target.checked ? 1 : 0)}
                          disabled={!canGrantAllAlbums}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 peer-disabled:opacity-50"></div>
                      </label>
                    </div>

                    {/* All Groups */}
                    <div className="flex items-center justify-between py-3 px-4 bg-white rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">All Groups Access</p>
                        <p className="text-sm text-gray-500">If ON: Access all groups except listed below. If OFF: Only access listed groups</p>
                      </div>
                      <label className={`relative inline-flex items-center ${canGrantAllGroups ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                        <input
                          type="checkbox"
                          checked={editingProfile.all_groups === 1}
                          onChange={(e) => handleFieldChange('all_groups', e.target.checked ? 1 : 0)}
                          disabled={!canGrantAllGroups}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 peer-disabled:opacity-50"></div>
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Calendar className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm">Select an event to configure event-specific authorizations</p>
                  </div>
                )}
              </div>

              {/* Specific Access - Images (only show for existing profiles and when event is selected) */}
              {!isCreating && selectedEventId && (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
                    <ImageIcon className="w-5 h-5" />
                    <span>Specific Image Access ({profileImages.length})</span>
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
                  {editingProfile.all_images === 1 
                    ? '🚫 These images are FORBIDDEN to this profile' 
                    : '✓ These are the ONLY images accessible to this profile'}
                </p>
                {profileImages.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No specific images configured
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
                  {editingProfile.all_albums === 1 
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
                    <span>Specific Group Access ({profileGroups.length})</span>
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
                  {editingProfile.all_groups === 1 
                    ? '🚫 These groups are FORBIDDEN to this profile' 
                    : '✓ These are the ONLY groups accessible to this profile'}
                </p>
                {profileGroups.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No specific groups configured
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
              disabled={loading || nameConflict || !editingProfile.label.trim() || (!hasChanges && !hasEventSpecificChanges)}
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




