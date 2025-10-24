## Store usage guide (Zustand)

This guide explains the minimal, safe patterns for interacting with the app store. It focuses on preventing render loops, keeping derived lists reactive, and ensuring relation updates apply correctly.

### Goals
- Keep component renders stable by preserving references and narrowing subscriptions
- React to the right changes (archive status, face/group labels, album names)
- Apply relation changes only for relevant scopes
- Centralize usage through small, reusable hooks

### Scopes: always scope your component
Scopes gate which relation changes are allowed to apply in the current tab. Add the relevant scope(s) on mount and remove them on unmount.

```jsx
import { useApplyScopes } from '../src/frontend/utils/storeUtils';

// Example: Group page
useApplyScopes([{ entity: 'group', id: groupId }]);

// Example: ImageViewer opened from a group (or album/moment) and focused image
useApplyScopes([
  { entity, id: parentId },           // entity in: 'group' | 'album' | 'moment'
  { entity: 'image', id: imageId },   // focused image
]);
```

Notes:
- Scopes use reference counting; multiple components can scope the same entity safely.
- Without the proper scope, relation changes (e.g., `image.albums`) are ignored.

### Read data via stable hooks
Use the hooks in `storeUtils.js` to avoid subscribing to large maps and to keep derived lists reactive.

```jsx
import { useImagesForParent, useFacesForImage, useAlbumsForImage } from '../src/frontend/utils/storeUtils';

// Images for a parent entity (group/album/moment). Optionally filter by specific ids from the parent page.
const images = useImagesForParent({
  entity: 'group',         // 'group' | 'album' | 'moment'
  parentId: groupId,
  filteredIds,             // optional override (array of ids) for group pages
  includeArchived: false,
  sortBy: 'date',
  sortOrder: 'asc',
});

// Faces and albums of the current image, react to label/name changes
const faces = useFacesForImage(imageId);
const albums = useAlbumsForImage(imageId);
```

Faces filtering parity with images mode:

- `useFacesForGroups(groupIds, filterMode, onlySelected, includeArchived)` computes faces by first deriving the image set using the same semantics as images mode:
  - Base images = union of `group.images` for the main group plus any selected groups
  - Apply `includeArchived` to exclude archived images when false
  - Apply `filterImages(images, [main + selected], filterMode, onlySelected)` using `image.groups` membership
  - Faces = union of `group.faces` for main + selected groups, filtered to those whose `face.image_id` is in the derived image set

This keeps faces mode output consistent with images mode filters and the archive preference, while maintaining stable subscriptions to avoid render loops.

The hooks:
- Subscribe narrowly to the relevant relation `Set`
- Recompute when the right metadata changes (e.g., `is_archived`, group label, album name)
- Sort consistently using `sorting.js`

### Representative URLs
Use the helper for representative thumbnails with logging.

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
Use `applyChanges` with entity upserts/updates and relation ops. Relation ops are scope-gated.

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
  entities: { [imageId]: { id: imageId, is_archived: 0 } },
}

// Add album to image.albums (requires image scope)
{
  type: 'RELATION_ADD',
  relation: 'image.albums',
  parentId: imageId,
  entities: { [albumId]: { id: albumId, label: 'Album name' } },
}
```

Important:
- The relevant scope must be present: `group:<id>`, `album:<id>`, `moment:<id>`, or `image:<id>`
- Entities dict is optional but recommended; it keeps maps up to date without a separate upsert
- Structural sharing preserves references if contents did not change, avoiding unnecessary rerenders

### Do / Don’t
- Do: add scopes via `useApplyScopes`
- Do: use `useImagesForParent` / `useFacesForImage` / `useAlbumsForImage`
- Do: keep effect deps minimal and stable; memoize heavy computations
- Don’t: subscribe to entire maps in components (e.g., `state.entities.images`)
- Don’t: mutate arrays/Sets directly; always create new Sets in reducers (handled internally)
- Don’t: call internal `setScope` directly; use `useApplyScopes`

### Migration checklist
- [ ] Add scopes with `useApplyScopes` in the component
- [ ] Replace manual derivations with stable hooks
- [ ] Pass `urlHelpers` as a prop when needed (keep reference stable)
- [ ] Guard local state writes (only set when value actually changes)
- [ ] Keep debug logs until stability is confirmed

See also:
- `src/frontend/utils/storeUtils.js`
- `src/frontend/utils/dataManager.js` (structural sharing, relation ops)


