## Frontend State and Data Changes Architecture

### Overview
The frontend maintains a single source of truth via a normalized Zustand store. Components subscribe to granular slices using selectors and shallow comparison to achieve smooth, incremental UI updates without full refreshes or scroll jumps.

### Store Shape (high-level)
```
useDataStore state
  entities:
    imagesById: { [imageId]: Image }
    groupsById: { [groupId]: Group }
    momentsById: { [momentId]: Moment }
    albumsById: { [albumId]: Album }
  relations:
    groupImages:  { [groupId]: imageId[] }
    momentImages: { [momentId]: imageId[] }
    albumImages:  { [albumId]: imageId[] }
  view:
    includeArchived: boolean
    current: { type, id?, filter?, sort? }
```

All core UI derives from the normalized `entities` and `relations`.

### Generic Change Schema (API → Interceptor → Store)
Backend endpoints return a `changes` array. An Axios interceptor applies them to the store via `store.applyChanges`.

- UPSERT
```
{ type: 'UPSERT', entity: 'image'|'group'|'moment'|'album', items: [ { id: string, ...partialOrFullEntity }, ... ] }
```

- REMOVE
```
{ type: 'REMOVE', entity: 'image'|'group'|'moment'|'album', ids: [string, ...] }
```

- RELATION_ADD / RELATION_REMOVE / RELATION_MOVE / RELATION_SET
```
{ type: 'RELATION_ADD', relation: 'group.images'|'moment.images'|'album.images', parentId: string, ids: [string,...], position?: 'start'|'end'|number }
{ type: 'RELATION_REMOVE', relation: 'group.images'|'moment.images'|'album.images', parentId: string, ids: [string,...] }
{ type: 'RELATION_MOVE', relation: 'group.images'|'moment.images', fromParentId: string, toParentId: string, ids: [string,...], position?: 'start'|'end'|number }
{ type: 'RELATION_SET',  relation: 'group.images'|'moment.images'|'album.images', parentId: string, ids: [string,...] }
```

This schema allows precise, minimal UI diffs (insert/remove/move) without reloads.

### Normalization and Field Conventions
- Images: `id`
- Groups: `id`
- Moments: `id`
- Albums: `id`
- Faces (nested in Images): `id`, `groupId`

All payloads and components must use the normalized keys above; legacy aliases are not supported.

### Rendering Pattern
1) Subscribe to ids arrays (relations) using shallow comparison and map to entities locally with `useMemo`.
2) Derive visible/sorted lists with `useMemo` (no setState inside effects to avoid loops).
3) Use store-driven flags (e.g., favorites/archive via `albumImages`) instead of local toggles.

### Optimistic Updates (Optional)
Components may optimistically update (e.g., label change) but must rely on API responses for final state. The interceptor’s `changes` serve as the single authority.

### Why This Works Smoothly
- Normalized structure ensures minimal writes on entity updates.
- Relation edits are stable arrays with shallow equality guards to avoid unnecessary re-renders.
- Components subscribe to precise slices, reducing update depth and preventing feedback loops.


