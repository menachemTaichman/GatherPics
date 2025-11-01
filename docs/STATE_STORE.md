## Frontend State and Data Changes Architecture (v5 - Multi-Event)

### Overview
The frontend maintains a single source of truth via a normalized Zustand store. The store is organized per-event to support multiple independent events. UI updates are driven by minimal change-sets with scope-based gating so tabs only apply relevant data. Cross-tab sync uses BroadcastChannel.

### Store Shape (high-level)
```
useDataStore state
  entities:
    [eventId]: {  // Event-scoped entities
      images:  { [imageId]: Image }
      groups:  { [groupId]: Group & { images?: Set<imageId>, faces_mapping?: { [imageId]: faceId }, images_count?: number } }
      moments: { [momentId]: Moment & { images?: Set<imageId>, images_count?: number } }
      albums:  { [albumId]: Album  & { images?: Set<imageId>, images_count?: number } }
      faces:   { [faceId]: Face }
      event_profiles: { [profileId]: EventProfile }
      uploads: { [uploadId]: Upload }
      access_requests: { [requestId]: AccessRequest }
      my_access_requests: { [requestId]: AccessRequest }
    }
    general: {  // General (non-event-scoped) entities
      profiles: { [profileId]: Profile }
      my_notifications: { [notificationId]: Notification }
    }

  // Per-tab, per-event scopes: which parents/collections are considered "main" for this session
  scope:   { entity: 'group'|'album'|'moment'|'image'|'event_profile'|'access_request'|'all', id?: string, eventId: string }
  scopes:  { [key: string]: { entity: string, id?: string, eventId: string } } // ref-counted, key format: "eventId:entity:id"
  scopeCounts: { [key: string]: number } // key format: "eventId:entity:id"

  // UI state (trimmed)
  selectedImages: Set<string>
  imageViewer: { show: boolean, image: string|null, index: number }
```

- Relations are embedded in parent entities as Sets (e.g., `groups[groupId].images` is `Set<string>`).
- Only `entities` are persisted in `sessionStorage['frw_entities']`. On hydration, arrays are coerced back to `Set`.
- Current profile is stored in `localStorage['frw_currentProfile']` with general data and nested event-specific data.
- Preferences are stored in `localStorage['frw_preferences']`.

### Change Schema (API → Interceptor → Store)
Endpoints may return a `changes` array. The API interceptor automatically injects `event_id` from the request URL (e.g., `/api/events/EVENT_ID/...`) into each change object. The interceptor then forwards changes to `store.applyChanges(changes)`.

**Event ID Routing:**
- Changes with `event_id` are routed to `entities[eventId]`
- Changes without `event_id` default to `entities.general`
- The `event_id` field is automatically stripped before applying the change

Supported change types:
```
// Insert or update (gated by scopes). Defaults: ignoreScope=false, broadcast=true
{ type: 'UPSERT', entity: 'images'|'groups'|'moments'|'albums'|'event_profiles'|'localStorage', items: [ { id, ...partial }, ... ] | { [id]: { ...partial } }, event_id?, ignoreScope?, broadcast? }

// Update-only (never inserts). Defaults: ignoreScope=true, broadcast=true
{ type: 'UPDATE', entity: 'images'|'groups'|'moments'|'albums'|'event_profiles'|'localStorage', items: [ { id, ...partial }, ... ] | { [id]: { ...partial } }, event_id?, ignoreScope?, broadcast? }

// Insert-only (skip if exists). Defaults: ignoreScope=true, broadcast=false
{ type: 'INSERT', entity: 'images'|'groups'|'moments'|'albums'|'event_profiles', items: [ { id, ...partial }, ... ], event_id?, ignoreScope?, broadcast? }

// Remove entities by id. Defaults: ignoreScope=true, broadcast=true
{ type: 'REMOVE', entity: 'images'|'groups'|'moments'|'albums'|'event_profiles'|'localStorage', ids: [string,...], event_id?, ignoreScope?, broadcast? }

// Relation mutations on parent. Defaults: ignoreScope=false, broadcast=true
{ type: 'RELATION_ADD'|'RELATION_REMOVE'|'RELATION_SET', relation: 'group.images'|'moment.images'|'album.images'|'image.groups'|'image.moments'|'image.faces'..., parentId, ids?, event_id?,
  // Optional child entities to upsert locally (labels, etc.)
  entities?: { [childId]: Partial<ChildEntity> }, ignoreScope?, broadcast? }
```

**localStorage entity:**
- Special entity type for updating localStorage values (e.g., `currentProfile`, `preferences`)
- For `localStorage` entity, `id` is the localStorage key (e.g., `'currentProfile'`, `'preferences'`)
- UPDATE merges into existing localStorage value, UPSERT replaces entire value, REMOVE deletes the key
- Changes to `localStorage` entity are never broadcasted (localStorage is per-origin, shared across tabs)
- Format: `{ type: 'UPDATE', entity: 'localStorage', items: { 'currentProfile': { total_notifications: 2, ... } } }`

Scope gating rules:
- Scopes are per-tab, per-event with format `eventId:entity:id`
- UPSERT/INSERT apply only if allowed by scopes unless `ignoreScope=true`.
  - Allowed when:
    - A matching global scope exists: `eventId:all:<entity>` (e.g., `75cb...fb2:all:groups`), or
    - A specific parent scope is active that references the entity type (e.g., `eventId:group:<id>`, `eventId:album:<id>`, `eventId:moment:<id>` allow `images`; `eventId:image:<id>` allows `images` and `groups` for `image.groups`).
- UPDATE applies regardless of scopes and never inserts.
- Relation changes apply only if the parent matches an active scope within the same event. There is no special-casing (e.g., `image.*` is not auto-allowed).
- General entities use `general` as the eventId in scopes (e.g., `general:all:my_notifications`).

Child entities in relation changes:
- When a relation change includes an `entities` dict, the store performs a local, non-broadcast upsert of those child entities with `ignoreScope=true`. The broadcasted relation change is sanitized (its `entities` field is stripped) before sending to other tabs.

Broadcasting:
- Each change or call may control broadcasting via `broadcast` (default varies by type). Changes with `broadcast=false` are applied locally and not sent to other tabs.

applyChanges API:
```
applyChanges(changes: Change[], options?: { ignoreScope?: boolean, broadcast?: boolean })
```
- Per-change flags override call-level options. If omitted, type defaults apply.

### Normalization and Field Conventions
- Images: `id`
- Groups: `id`
- Moments: `id`
- Albums: `id`
- Faces: `id`, `groupId` or `group_id`
- EventProfiles: `id`, `label`, `hierarchy_rank`, `can_upload_and_delete_images`, `can_edit`, `all_images`, `all_albums`, `save_preferences`
- GeneralProfiles: `id`, `email`, `events` (list of event IDs)
- Counts: `images_count` on groups, albums, moments
- Group face selection: `groups[groupId].faces_mapping: { [imageId]: faceId }`
- Profile access control: `event_profiles[profileId].images` (Set), `event_profiles[profileId].albums` (Set)

### Event Resolution
Components use `useEventId(eventUrl)` to resolve the event URL to an event ID. The hook:
- Maintains a cache of `eventUrl → eventId` mappings
- Returns `null` while resolving (components should wait before accessing store)
- Caches results for 5 minutes to avoid repeated API calls

### Rendering Pattern
1) Components get `eventId = useEventId(eventUrl)` to resolve the current event
2) Components register scopes on mount (e.g., `{ entity: 'group', id, eventId }`), and unregister on unmount via `useApplyScopes([...])`
3) Subscribe to embedded relation Sets and derive lists with `useMemo` or use universal hooks (`useChilds`, `useEntity`)
4) Use UPDATE for broad metadata tweaks; rely on relation changes for precise UI diffs

### Examples
- Group page: `eventId = useEventId(eventUrl)`, register `{ entity: 'group', id: groupId, eventId }`, fetch details, apply `UPSERT group`, `RELATION_SET group.images`; child `images` entities from the same change are upserted locally (`ignoreScope=true`, `broadcast=false`).
- Image viewer: register `{ entity: 'image', id: imageId, eventId }`, fetch details; `RELATION_SET image.groups` arrives with `entities` → local upsert of `groups` for labels, relation broadcast without entities.
- Related groups panel: register `{ entity: 'all', id: 'groups', eventId }`; `get_related_groups` inserts groups locally via `INSERT groups` with `broadcast=false`.

### Why This Works Smoothly
- Scope-gated inserts prevent unrelated tabs from growing their stores while keeping in-view data reactive.
- Local child upserts deliver instant labels without leaking across tabs.
- Relation Sets mutate stable Set instances, guarded by shallow-equality selectors, minimizing re-renders.
