# Universal Permissions System

## Overview

This document describes the centralized permissions system that controls UI element visibility based on profile permissions from the database.

## Architecture

### Core Components

1. **`usePermissions()` Hook** (`src/frontend/utils/usePermissions.js`)
   - Reads current profile from localStorage via `getCurrentProfile()`
   - Returns object with 6 boolean permission flags
   - Automatically updates when profile changes

2. **`<PermissionGate>` Component** (`src/frontend/components/PermissionGate.jsx`)
   - Wrapper component that conditionally renders children
   - Supports single permission or array of permissions
   - Supports AND logic (default) or OR logic via `requiresAll` prop

### Permission Flags

| Flag | Source | Description |
|------|--------|-------------|
| `canCreateEvents` | general_db.profiles.can_create_events | Can create new events |
| `isProfilesManager` | event_db.profiles_details.is_profiles_manager | Can manage other profiles (derived from hierarchy_rank != 0) |
| `canUploadAndDeleteImages` | event_db.profiles.can_upload_and_delete_images | Can upload and delete images |
| `canEdit` | event_db.profiles.can_edit | Can edit entities (labels, moments, albums, etc.) |
| `hasArchiveAlbum` | event_db.profiles_details.has_archive_album | Has access to archive album |
| `hasFavoritesAlbum` | event_db.profiles_details.has_favorites_album | Has access to favorites album |

## Usage Examples

### Using the Hook

```jsx
import { usePermissions } from '../utils/usePermissions';

function MyComponent() {
  const { canEdit, isProfilesManager } = usePermissions();
  
  return (
    <div>
      {canEdit && <button>Edit</button>}
      {isProfilesManager && <button>Manage Profiles</button>}
    </div>
  );
}
```

### Using the Component Wrapper

```jsx
import PermissionGate from './PermissionGate';

// Single permission
<PermissionGate requires="canEdit">
  <button>Edit Label</button>
</PermissionGate>

// Multiple permissions (AND - all required)
<PermissionGate requires={["canEdit", "hasArchiveAlbum"]}>
  <button>Move to Archive</button>
</PermissionGate>

// Multiple permissions (OR - any required)
<PermissionGate requires={["canEdit", "isProfilesManager"]} requiresAll={false}>
  <button>Special Action</button>
</PermissionGate>
```

## Implementation Details

### Where Permissions Are Applied

#### SettingsManager.jsx
- **Tabs Filtering**:
  - **Profiles Tab**: Hidden if `!isProfilesManager`
  - **General Tab**: Hidden if `!canUploadAndDeleteImages && !hasArchiveAlbum` (nothing to show in general)
- **Account Section**: 
  - **Managers**: Shows name, rank, and change password button in detailed layout
  - **Non-Managers**: Shows profile name in simple, elegant layout with user icon (no rank, no password button)
- **Upload Photos**: `canUploadAndDeleteImages` - Upload section hidden if can't upload
- **Include Archived Toggle**: `hasArchiveAlbum` - Hidden if no archive access

#### FloatingSelectionControls.jsx
- **Delete Button**: `canUploadAndDeleteImages` - Hidden if can't delete
- **Manage Access Button**: `isProfilesManager` - Hidden if not manager
- **Set Representative**: `canEdit` - Hidden if can't edit
- **Transfer Faces**: `canEdit` - Hidden if can't edit
- **Move to Moment**: `canEdit` - Hidden if can't edit
- **Remove from Album**: `canEdit` - Hidden if can't edit
- **Archive Toggle**: `canEdit` AND `hasArchiveAlbum` - Hidden if can't edit OR no archive access
- **Favorites Toggle**: `canEdit` AND `hasFavoritesAlbum` - Hidden if can't edit OR no favorites access
- **Add to Album**: `canEdit` - Hidden if can't edit
- **Smart Separators**: Separators (`|`) only show between visible button groups, preventing orphaned separators

#### ImageViewer.jsx (ImageViewerActions)
- **Delete Button**: `canUploadAndDeleteImages` - Hidden if can't delete
- **Manage Access Button**: `isProfilesManager` - Hidden if not manager
- **Set Representative**: `canEdit` - Hidden if can't edit
- **Archive Toggle**: `hasArchiveAlbum` - Shows interactive button if `canEdit`, shows static icon only if image is archived AND can't edit, completely hidden if not archived AND can't edit
- **Favorites Toggle**: `hasFavoritesAlbum` - Shows interactive button if `canEdit`, shows static icon only if image is favorited AND can't edit, completely hidden if not favorited AND can't edit
- **Add to Album**: `canEdit` - Hidden if can't edit
- **Remove from Album**: `canEdit` - Hidden if can't edit
- **Edit Moment Button**: `canEdit` - Pencil icon next to moment name, hidden if can't edit
- **Transfer Face Button**: `canEdit` - Small pencil on face rectangles overlay, hidden if can't edit
- **Smart Separators**: Separators (`|`) only show between visible button groups

#### GroupDetail.jsx
- **Edit Title**: `canEdit` - Title not clickable if can't edit
- **Remove Representative**: `canEdit`

#### AlbumDetail.jsx
- **Edit Title**: `canEdit` - Title not clickable if can't edit (and not default album)
- **Remove Representative**: `canEdit`
- **Delete Album**: `canEdit`
- **Manage Access**: `isProfilesManager`

#### SingleImageTile.jsx
- **Archive Icon**: `hasArchiveAlbum` AND `canEdit` - Only shown on archived images when can edit (completely hidden otherwise)
- **Favorite Heart Icon** (first position): `hasFavoritesAlbum` - Shows interactive button if `canEdit`, shows disabled button if image is favorited AND can't edit, hidden if not favorited AND can't edit
- **Favorite Heart Icon** (second position when archived): `hasFavoritesAlbum` - Shows interactive button if `canEdit`, shows disabled button if image is favorited AND can't edit, hidden if not favorited AND can't edit

#### Moments.jsx
- **Edit Moments Button**: `canEdit`

## Data Flow

1. **Login**: Backend returns profile with general permissions from `general_db.profiles`
2. **Event Entry**: App.jsx fetches event-specific profile data via `profilesAPI.getAll(eventUrl)`
3. **Profile Storage**: Profile with all permissions stored in localStorage via `setCurrentProfile()`
4. **Permission Check**: Components use `usePermissions()` or `<PermissionGate>` to check permissions
5. **UI Update**: Elements are hidden (removed from DOM) if permission check fails

## Backend Protection

All permissions are also enforced in the database via triggers in `event_db.py`:
- Triggers check permissions using `cur_profile()` function
- Database raises `ABORT` errors if permission denied
- Frontend permissions are for UX only - backend is the source of truth

## Testing Checklist

Test with different profile configurations:

### Test Profile 1: Full Access (Developer)
- is_profiles_manager: true
- can_upload_and_delete_images: true
- can_edit: true
- has_archive_album: true
- has_favorites_album: true

**Expected**: All features visible and functional

### Test Profile 2: Viewer Only
- is_profiles_manager: false
- can_upload_and_delete_images: false
- can_edit: false
- has_archive_album: true
- has_favorites_album: true

**Expected**:
- ✗ Cannot see Profiles tab
- ✗ Cannot upload images
- ✗ Cannot delete images
- ✗ Cannot edit labels
- ✗ Cannot transfer faces
- ✗ Cannot move to moments
- ✗ Cannot add to albums
- ✗ Cannot set representatives
- ✗ Cannot manage access
- ✓ Can see archive toggle (but disabled)
- ✓ Can see favorites (but disabled)
- ✓ Can view images

### Test Profile 3: Editor without Archive
- is_profiles_manager: false
- can_upload_and_delete_images: false
- can_edit: true
- has_archive_album: false
- has_favorites_album: true

**Expected**:
- ✗ Archive toggle completely hidden
- ✗ Include Archived setting hidden
- ✓ Can edit labels
- ✓ Can manage moments/albums
- ✓ Can see favorites

### Test Profile 4: Uploader without Edit
- is_profiles_manager: false
- can_upload_and_delete_images: true
- can_edit: false
- has_archive_album: true
- has_favorites_album: true

**Expected**:
- ✓ Can upload images
- ✓ Can delete images
- ✗ Cannot edit labels
- ✗ Cannot transfer faces
- ✗ Archive/Favorites visible but disabled

## Notes

- All hidden elements are completely removed from DOM (not just disabled)
- The `disabled` attribute is only used on favorite/archive buttons in SingleImageTile when visible but not editable
- Permission checks happen client-side for UX, but backend enforces all permissions via database triggers
- Profile permissions automatically update when switching events (App.jsx fetches event-specific profile data)

