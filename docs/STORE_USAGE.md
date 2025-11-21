## Store usage guide (Zustand) - Multi-Event Architecture

This guide explains the minimal, safe patterns for interacting with the app store. It focuses on preventing render loops, keeping derived lists reactive, and ensuring relation updates apply correctly in a multi-event environment.

### Goals
- Keep component renders stable by preserving references and narrowing subscriptions
- React to the right changes (archive status, face/group labels, album names)
- Apply relation changes only for relevant scopes within the correct event
- Centralize usage through small, reusable hooks
- Support multiple independent events with isolated data

### Event Resolution
All components must first resolve the event URL (slug) to an event ID:

```jsx
import { useEventId } from '../src/frontend/utils/storeUtils';

const { eventUrl } = useParams();
const eventId = useEventId(eventUrl); // Returns null while resolving

// Wait for eventId before accessing store data
if (!eventId) return null; // or show loading state
```

**How it works:**
- `useEventId(eventUrl)` queries `/api/events/resolve?url=EVENT_URL` to get the event ID
- Results are cached for 5 minutes to avoid repeated API calls
- Returns `null` while resolving (async operation)
- Components should add early returns or show loading state when `eventId` is `null`

**Storage Keys:**
- Entities: `sessionStorage['gather_pics_entities']` - nested by eventId: `{ [eventId]: { images: {}, groups: {}, ... }, general: { profiles: {}, ... } }`
- Current Profile: `localStorage['gather_pics_currentProfile']` - general data with `events` key
- Preferences: `localStorage['gather_pics_preferences']`

### Scopes: always scope your component
Scopes gate which relation changes are allowed to apply in the current tab. Scopes are per-event and per-tab. Add the relevant scope(s) on mount and remove them on unmount.

```jsx
import { useApplyScopes, useEventId } from '../src/frontend/utils/storeUtils';

const eventId = useEventId(eventUrl);

// Example: Group page
useApplyScopes([{ entity: 'group', id: groupId, eventId }]);

// Example: ImageViewer opened from a group (or album/moment) and focused image
useApplyScopes([
  { entity, id: parentId, eventId },           // entity in: 'group' | 'album' | 'moment'
  { entity: 'image', id: imageId, eventId },   // focused image
]);

// Example: All entities scope for a modal
useApplyScopes([{ entity: 'all', id: 'groups', eventId }]);

// Example: General (non-event) scope
useApplyScopes([{ entity: 'all', id: 'my_notifications', eventId: 'general' }]);
```

Notes:
- Scopes use reference counting; multiple components can scope the same entity safely.
- Without the proper scope, relation changes (e.g., `image.albums`) are ignored.
- Scope format: `eventId:entity:id` (e.g., `75cb6635-879d-4386-b023-366444dc0fb2:group:abc123`)

### Read data via stable hooks

#### Universal Hooks (Mirror Backend API)
Use the universal hooks in `storeUtils.js` for consistent, event-aware data access:

```jsx
import { useEventId, useChilds, useEntity } from '../src/frontend/utils/storeUtils';

const eventId = useEventId(eventUrl);

// Get child entities (e.g., images for a group, faces for an image)
const images = useChilds(eventId, 'groups', groupId, 'images', { 
  includeArchived: false,
  sortBy: 'date',
  sortOrder: 'asc'
});

const faces = useChilds(eventId, 'images', imageId, 'faces');
const albums = useChilds(eventId, 'images', imageId, 'albums');

// Get a single entity
const group = useEntity(eventId, 'groups', groupId);
const image = useEntity(eventId, 'images', imageId);
```

#### Specific Entity Hooks (Convenience Wrappers)
For common entity types, use the typed hooks in `dataManager.js`:

```jsx
import { useGroupsList, useGroupById, useImagesList, useImageById } from '../src/frontend/utils/dataManager';

const eventId = useEventId(eventUrl);

// Get all entities of a type
const groups = useGroupsList(eventId);
const images = useImagesList(eventId);
const albums = useAlbumsList(eventId);

// Get a single entity by ID
const group = useGroupById(eventId, groupId);
const image = useImageById(eventId, imageId);
```

#### General (Non-Event) Entity Hooks
For general entities that aren't tied to a specific event:

```jsx
import { useProfilesList, useProfileById, useMyNotificationsList } from '../src/frontend/utils/dataManager';

// General profiles (not event-specific)
const profiles = useProfilesList();
const profile = useProfileById(profileId);

// Notifications (general entity)
const notifications = useMyNotificationsList();
```

The hooks:
- Subscribe narrowly to the relevant relation `Set` or entity map
- Return stable array references via internal memoization (no infinite loops)
- Recompute when the right metadata changes (e.g., `is_archived`, group label, album name)
- Sort consistently using `sorting.js`

### Representative URLs
Use the helper for representative thumbnails:

```jsx
import { getRepresentativeUrl } from '../src/frontend/utils/storeUtils';
const src = getRepresentativeUrl(urlHelpers, 'groups', groupId);
```

### Component patterns that prevent churn
- Prefer the stable hooks above over subscribing to whole maps
- For large components, wrap in `React.memo` with a focused `arePropsEqual` comparator
- Avoid setting local state to the same value repeatedly; guard writes
- When using URL helpers, memoize or pass them down so reference stays stable

### Applying changes to the store
Use `applyChanges` with entity upserts/updates and relation ops. The API interceptor automatically injects `event_id` from the request URL. Relation ops are scope-gated per-event.

Supported relation formats:
- `RELATION_SET` with optional `entities` dict to upsert children
- `RELATION_ADD`/`RELATION_REMOVE` with `ids` or `entities`

Examples:

```js
// Add image to group.images, with child entity data to upsert
{
  type: 'RELATION_ADD',
  relation: 'group.images',
  parentId: groupId,
  event_id: '75cb6635-879d-4386-b023-366444dc0fb2', // Auto-injected by interceptor
  entities: { [imageId]: { id: imageId, is_archived: 0 } },
}

// Add album to image.albums (requires image scope in the same event)
{
  type: 'RELATION_ADD',
  relation: 'image.albums',
  parentId: imageId,
  event_id: '75cb6635-879d-4386-b023-366444dc0fb2', // Auto-injected by interceptor
  entities: { [albumId]: { id: albumId, label: 'Album name' } },
}
```

Important:
- The relevant scope must be present with matching eventId: `eventId:group:<id>`, `eventId:album:<id>`, `eventId:moment:<id>`, or `eventId:image:<id>`
- The `event_id` field is automatically injected by the API interceptor based on the request URL
- Entities dict is optional but recommended; it keeps maps up to date without a separate upsert
- Structural sharing preserves references if contents did not change, avoiding unnecessary rerenders

### Do / Don't
- Do: resolve `eventId` with `useEventId(eventUrl)` at the start of your component
- Do: add scopes via `useApplyScopes` with `eventId` included
- Do: use universal hooks (`useChilds`, `useEntity`) or specific hooks (`useGroupsList`, etc.)
- Do: wait for `eventId` to resolve before accessing store data (`if (!eventId) return null`)
- Do: keep effect deps minimal and stable; memoize heavy computations
- Do: use `|| null` instead of `|| {}` to avoid creating new object references
- Don't: subscribe to entire maps in components (e.g., `state.entities[eventId].images`)
- Don't: access `state.entities.images` directly (missing eventId); use `state.entities[eventId].images`
- Don't: create scopes without `eventId` (except for general entities which use `eventId: 'general'`)
- Don't: mutate arrays/Sets directly; always create new Sets in reducers (handled internally)
- Don't: call internal `setScope` directly; use `useApplyScopes`
- Don't: use `useCallback` or `useMemo` to wrap selectors passed to Zustand (causes infinite loops)

### Migration checklist
- [ ] Add `eventId = useEventId(eventUrl)` at the start of the component
- [ ] Add early return when `!eventId` to wait for resolution
- [ ] Add scopes with `useApplyScopes([{ ..., eventId }])` in the component
- [ ] Update all entity access to use `entities[eventId].entityType` or `entities.general.entityType`
- [ ] Replace old specific hooks with universal hooks or update to pass `eventId`
- [ ] Pass `urlHelpers` as a prop when needed (keep reference stable)
- [ ] Guard local state writes (only set when value actually changes)
- [ ] Update all imperative store access (`useDataStore.getState()`) to include `eventId`

See also:
- `src/frontend/utils/storeUtils.js`
- `src/frontend/utils/dataManager.js` (structural sharing, relation ops)


