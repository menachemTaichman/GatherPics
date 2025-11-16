import { usePermissions } from '../../hooks/usePermissions';

/**
 * Permission gate component that conditionally renders children based on permissions
 * 
 * @param {Object} props
 * @param {string|string[]} props.requires - Permission(s) required (single string or array)
 * @param {boolean} [props.requiresAll=true] - If true, all permissions must be met (AND). If false, any permission (OR)
 * @param {string} [props.eventUrl] - Optional event URL to check permissions for (defaults to current route event)
 * @param {React.ReactNode} props.children - Content to render if permission check passes
 * 
 * @example
 * // Single permission
 * <PermissionGate requires="canEdit">
 *   <button>Edit</button>
 * </PermissionGate>
 * 
 * @example
 * // Multiple permissions (AND - all required)
 * <PermissionGate requires={["canEdit", "hasArchiveAlbum"]}>
 *   <button>Archive</button>
 * </PermissionGate>
 * 
 * @example
 * // Multiple permissions (OR - any required)
 * <PermissionGate requires={["canEdit", "isProfilesManager"]} requiresAll={false}>
 *   <button>Action</button>
 * </PermissionGate>
 * 
 * @example
 * // With specific event URL
 * <PermissionGate requires="canManageEvent" eventUrl={selectedEventUrl}>
 *   <button>Manage Event</button>
 * </PermissionGate>
 */
export default function PermissionGate({ requires, requiresAll = true, eventUrl = null, children }) {
  const permissions = usePermissions(eventUrl);

  // Handle single permission string
  if (typeof requires === 'string') {
    return permissions[requires] ? children : null;
  }

  // Handle array of permissions
  if (Array.isArray(requires)) {
    const hasPermission = requiresAll
      ? requires.every(permission => permissions[permission])
      : requires.some(permission => permissions[permission]);
    
    return hasPermission ? children : null;
  }

  // Invalid requires prop
  console.warn('PermissionGate: requires prop must be a string or array of strings');
  return null;
}




