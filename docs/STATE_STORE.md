## Frontend State and Data Changes Architecture

### Overview
The frontend maintains a single source of truth via a normalized Zustand store. Components subscribe to granular slices using selectors and shallow comparison to achieve smooth, incremental UI updates without full refreshes or scroll jumps.

### Store Shape (v3 - high-level)
```
useDataStore state
  entities:
    images:  { [imageId]: Image }
    groups:  { [groupId]: Group & { images?: Set<imageId>, faces_mapping?: { [imageId]: faceId }, images_count?: number } }
    moments: { [momentId]: Moment & { images?: Set<imageId>, images_count?: number } }
    albums:  { [albumId]: Album  & { images?: Set<imageId>, images_count?: number } }
  view:
    includeArchived: boolean
    current: { type, id?, filter?, sort? }
```

- Relations are embedded inside the corresponding parent entity as Sets of child ids (e.g., `groups[groupId].images` is `Set<string>`).
- The store persists only `entities` in `localStorage['entities']`. On hydration, any relation arrays are coerced to `Set` for runtime efficiency.

### Generic Change Schema (API → Interceptor → Store)
Backend endpoints return a `changes` array (lists only; no sets). An Axios interceptor applies them to the store via `store.applyChanges`.

- UPSERT
```
{ type: 'UPSERT', entity: 'images'|'groups'|'moments'|'albums', items: [ { id: string, ...partialOrFullEntity }, ... ] }
```

- REMOVE (not used by the client)
  - The client does not execute removal logic. Server state is authoritative and emits relation updates and upserts that reflect deletes. If a REMOVE item appears, the client ignores it.

- RELATION_ADD / RELATION_REMOVE / RELATION_MOVE / RELATION_SET
```
{ type: 'RELATION_ADD', relation: 'group.images'|'moment.images'|'album.images', parentId: string, ids: [string,...] }
{ type: 'RELATION_REMOVE', relation: 'group.images'|'moment.images'|'album.images', parentId: string, ids: [string,...] }
{ type: 'RELATION_MOVE', relation: 'group.images'|'moment.images', fromParentId: string, toParentId: string, ids: [string,...] }
{ type: 'RELATION_SET',  relation: 'group.images'|'moment.images'|'album.images', parentId: string, ids: [string,...] }
```
The store applies relation changes by mutating the embedded `images` Set on the parent entity. This yields precise, minimal UI diffs without reloads.

### Normalization and Field Conventions
- Images: `id`
- Groups: `id`
- Moments: `id`
- Albums: `id`
- Faces (nested in Images): `id`, `groupId`
- Counts: `images_count` on groups, albums, moments
- Group face selection: `groups[groupId].faces_mapping: { [imageId]: faceId }`

All payloads and components must use the normalized keys above; legacy aliases are not supported.

### Rendering Pattern
1) Subscribe to embedded relation Sets on parent entities and map them to images via `useMemo`.
2) Derive visible/sorted lists with `useMemo` (no setState inside effects to avoid loops).
3) Use store-driven flags where possible (e.g., favorites/archive via album entities’ `images` Set).

### Optimistic Updates (Optional)
Components may optimistically update (e.g., label change) but must rely on API responses for final state. The interceptor’s `changes` serve as the single authority. Endpoints that edit child relations return `len_edited` for concise UI feedback.

### Why This Works Smoothly
- Normalized entities with embedded relation Sets minimize writes and re-renders.
- Relation edits mutate stable Set instances, guarded by shallow-equality selectors.
- Components subscribe to precise slices, reducing update depth and preventing feedback loops.


