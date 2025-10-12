// Store utils: read the guide at docs/STORE_USAGE.md for patterns and examples.
import { useMemo, useEffect } from 'react';
import { useDataStore } from './dataManager';
import { sortImages, sortGroups, sortByField } from './sorting';

// debug logs removed

// Apply and cleanup scopes against the data store
export function useApplyScopes(scopes = []) {
  useEffect(() => {
    try {
      const ds = useDataStore.getState();
      scopes.forEach((s) => s?.entity && ds.addScope && ds.addScope({ entity: s.entity, id: String(s.id) }));
      
    } catch {}
    return () => {
      try {
        const ds = useDataStore.getState();
        scopes.forEach((s) => s?.entity && ds.removeScope && ds.removeScope({ entity: s.entity, id: String(s.id) }));
        
      } catch {}
    };
  }, [JSON.stringify(scopes)]);
}

// Stable list of images for a parent entity (group/album/moment) or filteredIds override
export function useImagesForParent({ entity, parentId, filteredIds = null, includeArchived = false, sortBy = 'date', sortOrder = 'asc' }) {
  const relationSet = useDataStore((state) => {
    if (!entity || !parentId) return null;
    const key = entity === 'group' ? 'groups' : (entity === 'album' ? 'albums' : (entity === 'moment' ? 'moments' : null));
    if (!key) return null;
    return state.entities?.[key]?.[parentId]?.images || null;
  });

  // Subscribe to images map to reflect archive and metadata changes
  const imagesMapSub = useDataStore((state) => state.entities?.images || {});

  const images = useMemo(() => {
    let ids;
    if (filteredIds && entity === 'group') {
      ids = Array.isArray(filteredIds) ? filteredIds : [];
    } else {
      ids = relationSet instanceof Set ? Array.from(relationSet) : [];
    }
    const stateImages = (useDataStore.getState().entities || {}).images || {};
    let list = ids.map((id) => stateImages[id]).filter(Boolean);
    if (!includeArchived) list = list.filter((img) => !img.is_archived);
    const sorted = sortImages(list, sortBy || 'date', sortOrder || 'asc');
    return sorted;
  }, [relationSet, filteredIds, entity, includeArchived, sortBy, sortOrder, imagesMapSub, parentId]);

  return images;
}

// Stable faces list for an image id
export function useFacesForImage(imageId) {
  const facesSet = useDataStore((state) => (imageId ? state.entities?.images?.[imageId]?.faces || null : null));
  const facesMapSub = useDataStore((state) => state.entities?.faces || {});
  const groupsMapSub = useDataStore((state) => state.entities?.groups || {});

  const faces = useMemo(() => {
    if (!facesSet) return [];
    const ids = Array.from(facesSet);
    const facesMap = (useDataStore.getState().entities?.faces || {});
    const groupsMap = (useDataStore.getState().entities?.groups || {});
    const list = ids.map((fid) => facesMap[fid]).filter(Boolean);
    const sorted = sortByField(list, 'group_label', 'asc', (face) => {
      const gid = face?.groupId || face?.group_id;
      if (!gid) return '';
      return groupsMap[gid]?.label || '';
    });
    return sorted;
  }, [imageId, facesSet, facesMapSub, groupsMapSub]);

  return faces;
}

// Stable albums list for an image id
export function useAlbumsForImage(imageId) {
  const albumsSet = useDataStore((state) => (imageId ? state.entities?.images?.[imageId]?.albums || null : null));
  const albumsMapSub = useDataStore((state) => state.entities?.albums || {});

  const albums = useMemo(() => {
    if (!albumsSet) return [];
    const ids = Array.from(albumsSet);
    const albumsMap = (useDataStore.getState().entities?.albums || {});
    const list = ids.map((aid) => albumsMap[aid]).filter(Boolean);
    const sorted = sortGroups(list, 'name', 'asc');
    return sorted;
  }, [imageId, albumsSet, albumsMapSub]);

  return albums;
}

// Stable images list for a profile id
export function useImagesForProfile(profileId) {
  const imagesSet = useDataStore((state) => (profileId ? state.entities?.profiles?.[profileId]?.images || null : null));
  const imagesMapSub = useDataStore((state) => state.entities?.images || {});

  const images = useMemo(() => {
    if (!imagesSet) return [];
    const ids = Array.from(imagesSet);
    const imagesMap = (useDataStore.getState().entities?.images || {});
    const list = ids.map((iid) => imagesMap[iid]).filter(Boolean);
    const sorted = sortImages(list, 'date', 'asc');
    return sorted;
  }, [profileId, imagesSet, imagesMapSub]);

  return images;
}

// Stable albums list for a profile id
export function useAlbumsForProfile(profileId) {
  const albumsSet = useDataStore((state) => (profileId ? state.entities?.profiles?.[profileId]?.albums || null : null));
  const albumsMapSub = useDataStore((state) => state.entities?.albums || {});

  const albums = useMemo(() => {
    if (!albumsSet) return [];
    const ids = Array.from(albumsSet);
    const albumsMap = (useDataStore.getState().entities?.albums || {});
    const list = ids.map((aid) => albumsMap[aid]).filter(Boolean);
    const sorted = sortGroups(list, 'name', 'asc');
    return sorted;
  }, [profileId, albumsSet, albumsMapSub]);

  return albums;
}

// Representative URL helper with debug
export function getRepresentativeUrl(urlHelpers, entity, id) {
  const url = urlHelpers?.getRepresentativeUrl ? urlHelpers.getRepresentativeUrl(entity, id) : null;
  return url;
}


