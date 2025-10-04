## Frontend State and Data Changes Architecture (v4)

### Overview
The frontend maintains a single source of truth via a normalized Zustand store. UI updates are driven by minimal change-sets with scope-based gating so tabs only apply relevant data. Cross-tab sync uses BroadcastChannel.

### Store Shape (high-level)
```
useDataStore state
  entities:
    images:  { [imageId]: Image }
    groups:  { [groupId]: Group & { images?: Set<imageId>, faces_mapping?: { [imageId]: faceId }, images_count?: number } }
    moments: { [momentId]: Moment & { images?: Set<imageId>, images_count?: number } }
    albums:  { [albumId]: Album  & { images?: Set<imageId>, images_count?: number } }

  // Per-tab scopes: which parents/collections are considered "main" for this session
  scope:   { entity: 'group'|'album'|'moment'|'image'|'all', id?: string }
  scopes:  { [key: string]: { entity: string, id?: string } } // ref-counted
  scopeCounts: { [key: string]: number }

  // UI state (trimmed)
  selectedImages: Set<string>
  imageViewer: { show: boolean, image: string|null, index: number }
```

- Relations are embedded in parent entities as Sets (e.g., `groups[groupId].images` is `Set<string>`).
- Only `entities` are persisted in `sessionStorage['entities']`. On hydration, arrays are coerced back to `Set`.

### Change Schema (API → Interceptor → Store)
Endpoints may return a `changes` array. The interceptor forwards them to `store.applyChanges(changes)`.

Supported change types:
```
// Insert or update (gated by scopes). Defaults: ignoreScope=false, broadcast=true
{ type: 'UPSERT', entity: 'images'|'groups'|'moments'|'albums', items: [ { id, ...partial }, ... ], ignoreScope?, broadcast? }

// Update-only (never inserts). Defaults: ignoreScope=true, broadcast=true
{ type: 'UPDATE', entity: 'images'|'groups'|'moments'|'albums', items: [ { id, ...partial }, ... ], ignoreScope?, broadcast? }

// Insert-only (skip if exists). Defaults: ignoreScope=true, broadcast=false
{ type: 'INSERT', entity: 'images'|'groups'|'moments'|'albums', items: [ { id, ...partial }, ... ], ignoreScope?, broadcast? }

// Remove entities by id. Defaults: ignoreScope=true, broadcast=true
{ type: 'REMOVE', entity: 'images'|'groups'|'moments'|'albums', ids: [string,...], ignoreScope?, broadcast? }

// Relation mutations on parent. Defaults: ignoreScope=false, broadcast=true
{ type: 'RELATION_ADD'|'RELATION_REMOVE'|'RELATION_SET', relation: 'group.images'|'moment.images'|'album.images'|'image.groups'|'image.moments'|'image.faces'..., parentId, ids?,
  // Optional child entities to upsert locally (labels, etc.)
  entities?: { [childId]: Partial<ChildEntity> }, ignoreScope?, broadcast? }
```

Scope gating rules:
- UPSERT/INSERT apply only if allowed by scopes unless `ignoreScope=true`.
  - Allowed when:
    - A matching global scope exists: `all:<entity>` (e.g., `all:groups`), or
    - A specific parent scope is active that references the entity type (e.g., `group:<id>`, `album:<id>`, `moment:<id>` allow `images`; `image:<id>` allows `images` and `groups` for `image.groups`).
- UPDATE applies regardless of scopes and never inserts.
- Relation changes apply only if the parent matches an active scope. There is no special-casing (e.g., `image.*` is not auto-allowed).

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
- Faces (nested in Images): `id`, `groupId`
- Counts: `images_count` on groups, albums, moments
- Group face selection: `groups[groupId].faces_mapping: { [imageId]: faceId }`

### Rendering Pattern
1) Components register scopes on mount (e.g., `group:<id>`, `image:<id>`, `all:groups`), and unregister on unmount.
2) Subscribe to embedded relation Sets and derive lists with `useMemo`.
3) Use UPDATE for broad metadata tweaks; rely on relation changes for precise UI diffs.

### Examples
- Group page: register `group:<id>`, fetch details, apply `UPSERT group`, `RELATION_SET group.images`; child `images` entities from the same change are upserted locally (`ignoreScope=true`, `broadcast=false`).
- Image viewer: register `image:<id>`, fetch details; `RELATION_SET image.groups` arrives with `entities` → local upsert of `groups` for labels, relation broadcast without entities.
- Related groups panel: register `all:groups`; `get_related_groups` inserts groups locally via `INSERT groups` with `broadcast=false`.

### Why This Works Smoothly
- Scope-gated inserts prevent unrelated tabs from growing their stores while keeping in-view data reactive.
- Local child upserts deliver instant labels without leaking across tabs.
- Relation Sets mutate stable Set instances, guarded by shallow-equality selectors, minimizing re-renders.
