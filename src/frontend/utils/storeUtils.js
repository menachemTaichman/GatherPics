// Store utils: read the guide at docs/STORE_USAGE.md for patterns and examples.
import { useMemo, useEffect, useRef } from 'react';
import { useDataStore } from './dataManager';
import { sortImages, sortGroups, sortByField, filterImages } from './sorting';

// debug logs removed

// Apply and cleanup scopes against the data store
export function useApplyScopes(scopes = []) {
  const prevKeysRef = useRef(new Set());

  // Normalize scopes and build a stable signature
  const { keysSet: nextKeys, signature } = useMemo(() => {
    const normalized = Array.isArray(scopes)
      ? scopes
          .filter((s) => s && s.entity && s.id !== undefined && s.id !== null)
          .map((s) => ({ entity: s.entity, id: String(s.id) }))
      : [];
    const keyList = Array.from(
      new Set(normalized.map((s) => `${s.entity}:${s.id}`))
    ).sort();
    return {
      keysSet: new Set(keyList),
      signature: keyList.join('|'),
    };
  }, [scopes]);

  // Apply only the diffs between previous and next scope keys
  useEffect(() => {
    try {
      const ds = useDataStore.getState();
      const prevKeys = prevKeysRef.current;

      // Compute removals (in prev but not in next)
      const toRemove = [];
      prevKeys.forEach((k) => {
        if (!nextKeys.has(k)) toRemove.push(k);
      });

      // Compute additions (in next but not in prev)
      const toAdd = [];
      nextKeys.forEach((k) => {
        if (!prevKeys.has(k)) toAdd.push(k);
      });

      // Apply removals first
      for (const key of toRemove) {
        const [entity, id] = key.split(':');
        ds.removeScope && ds.removeScope({ entity, id });
        prevKeys.delete(key);
      }

      // Apply additions
      for (const key of toAdd) {
        const [entity, id] = key.split(':');
        ds.addScope && ds.addScope({ entity, id });
        prevKeys.add(key);
      }

      // logging removed
    } catch {}
  }, [signature]);

  // Cleanup on unmount: remove what we still hold
  useEffect(() => {
    return () => {
      try {
        const ds = useDataStore.getState();
        prevKeysRef.current.forEach((key) => {
          const [entity, id] = key.split(':');
          ds.removeScope && ds.removeScope({ entity, id });
        });
        prevKeysRef.current.clear();
      } catch {}
    };
  }, []);
}

// Stable list of images for a parent entity (group/album/moment/upload) or filteredIds override
export function useImagesForParent({ entity, parentId, filteredIds = null, filterByUploadId = null, includeArchived = false, sortBy = 'date', sortOrder = 'asc' }) {
  const relationSet = useDataStore((state) => {
    if (!entity || !parentId) return null;
    const key = entity === 'group' ? 'groups' : (entity === 'album' ? 'albums' : (entity === 'moment' ? 'moments' : (entity === 'upload' ? 'uploads' : null)));
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
    if (filterByUploadId !== null) list = list.filter((img) => String(img.upload_id) === String(filterByUploadId));
    const sorted = sortImages(list, sortBy || 'date', sortOrder || 'asc');
    return sorted;
  }, [relationSet, filteredIds, entity, includeArchived, filterByUploadId, sortBy, sortOrder, imagesMapSub, parentId]);

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

// Stable faces list for a group id
export function useFacesForGroup(groupId) {
  const facesSet = useDataStore((state) => (groupId ? state.entities?.groups?.[groupId]?.faces || null : null));

  const faces = useMemo(() => {
    if (!facesSet) return [];
    const ids = Array.from(facesSet);
    const facesMap = (useDataStore.getState().entities?.faces || {});
    const list = ids.map((fid) => facesMap[fid]).filter(Boolean);
    return list;
  }, [groupId, facesSet]);

  return faces;
}

// Stable faces list for multiple groups with filtering
export function useFacesForGroups(groupIds, filterMode = 'and', onlySelected = false, includeArchived = false) {
  const selectedIds = useMemo(() => {
    const ids = Array.isArray(groupIds) ? groupIds : [];
    return Array.from(new Set(ids.map((g) => String(g)))).sort();
  }, [groupIds]);

  // Subscribe to a compact signature of sizes for selected groups to avoid unstable arrays
  const sizesSig = useDataStore((state) => {
    if (!selectedIds.length) return '';
    const parts = [];
    for (const gid of selectedIds) {
      const g = state.entities?.groups?.[gid];
      const isz = g?.images instanceof Set ? g.images.size : (Array.isArray(g?.images) ? g.images.length : -1);
      const fsz = g?.faces instanceof Set ? g.faces.size : (Array.isArray(g?.faces) ? g.faces.length : -1);
      parts.push(`${gid}:${isz}:${fsz}`);
    }
    return parts.join('|');
  });

  // Subscribe to images map to reflect archive status changes
  const imagesMapSub = useDataStore((state) => state.entities?.images || {});

  const faces = useMemo(() => {
    if (selectedIds.length === 0) return [];
    const groupsMap = (useDataStore.getState().entities || {}).groups || {};
    const facesMap = (useDataStore.getState().entities || {}).faces || {};
    const imagesMap = (useDataStore.getState().entities || {}).images || {};

    // Determine filtered image ids using same semantics as images mode, with fallbacks
    const filteredImageIds = new Set();
    // Union of images from all selected groups
    const baseIdSet = new Set();
    selectedIds.forEach((gid) => {
      const rel = groupsMap[gid]?.images;
      if (rel instanceof Set) rel.forEach((iid) => baseIdSet.add(String(iid)));
      else if (Array.isArray(rel)) rel.forEach((iid) => baseIdSet.add(String(iid)));
    });
    const baseIds = Array.from(baseIdSet);
    const baseImages = baseIds
      .map((id) => imagesMap[String(id)])
      .filter(Boolean)
      .filter((img) => includeArchived || !img.is_archived);

    // Always use image.groups + AND/OR/ONLY semantics (no fallback)
    const utilFiltered = (!onlySelected && selectedIds.length === 1)
      ? baseImages
      : filterImages(baseImages, selectedIds, filterMode, onlySelected);

    utilFiltered.forEach((img) => {
      filteredImageIds.add(String(img.id));
    });

    // Collect faces whose image is in the filtered set
    const out = [];
    selectedIds.forEach((gid) => {
      const setOrArray = groupsMap[gid]?.faces;
      if (setOrArray instanceof Set) {
        setOrArray.forEach((faceId) => {
          const face = facesMap[faceId];
          const imgId = face ? String(face.image_id) : null;
          if (face && filteredImageIds.has(imgId)) {
            out.push(face);
          }
        });
      } else if (Array.isArray(setOrArray)) {
        setOrArray.forEach((faceId) => {
          const face = facesMap[faceId];
          const imgId = face ? String(face.image_id) : null;
          if (face && filteredImageIds.has(imgId)) {
            out.push(face);
          }
        });
      }
    });
    return out;
  }, [selectedIds.join('|'), sizesSig, filterMode, onlySelected, includeArchived, imagesMapSub]);

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

// Stable groups list for a profile id
export function useGroupsForProfile(profileId) {
  const groupsSet = useDataStore((state) => (profileId ? state.entities?.profiles?.[profileId]?.groups || null : null));
  const groupsMapSub = useDataStore((state) => state.entities?.groups || {});

  const groups = useMemo(() => {
    if (!groupsSet) return [];
    const ids = Array.from(groupsSet);
    const groupsMap = (useDataStore.getState().entities?.groups || {});
    const list = ids.map((gid) => groupsMap[gid]).filter(Boolean);
    const sorted = sortGroups(list, 'name', 'asc');
    return sorted;
  }, [profileId, groupsSet, groupsMapSub]);

  return groups;
}

// Stable images list for an upload id
export function useImagesForUpload(uploadId) {
  const imagesSet = useDataStore((state) => (uploadId ? state.entities?.uploads?.[uploadId]?.images || null : null));
  const imagesMapSub = useDataStore((state) => state.entities?.images || {});

  const images = useMemo(() => {
    if (!imagesSet) return [];
    const ids = Array.from(imagesSet);
    const imagesMap = (useDataStore.getState().entities?.images || {});
    const list = ids.map((iid) => imagesMap[iid]).filter(Boolean);
    const sorted = sortImages(list, 'date', 'asc');
    return sorted;
  }, [uploadId, imagesSet, imagesMapSub]);

  return images;
}

// Stable groups list for an upload id
export function useGroupsForUpload(uploadId) {
  const groupsSet = useDataStore((state) => (uploadId ? state.entities?.uploads?.[uploadId]?.groups || null : null));
  const groupsMapSub = useDataStore((state) => state.entities?.groups || {});

  const groups = useMemo(() => {
    if (!groupsSet) return [];
    const ids = Array.from(groupsSet);
    const groupsMap = (useDataStore.getState().entities?.groups || {});
    const list = ids.map((gid) => groupsMap[gid]).filter(Boolean);
    const sorted = sortGroups(list, 'name', 'asc');
    return sorted;
  }, [uploadId, groupsSet, groupsMapSub]);

  return groups;
}

// Stable moments list for an upload id
export function useMomentsForUpload(uploadId) {
  const momentsSet = useDataStore((state) => (uploadId ? state.entities?.uploads?.[uploadId]?.moments || null : null));
  const momentsMapSub = useDataStore((state) => state.entities?.moments || {});

  const moments = useMemo(() => {
    if (!momentsSet) return [];
    const ids = Array.from(momentsSet);
    const momentsMap = (useDataStore.getState().entities?.moments || {});
    const list = ids.map((mid) => momentsMap[mid]).filter(Boolean);
    const sorted = sortByField(list, 'label', 'asc');
    return sorted;
  }, [uploadId, momentsSet, momentsMapSub]);

  return moments;
}

// Representative URL helper with debug
export function getRepresentativeUrl(urlHelpers, entity, id) {
  const url = urlHelpers?.getRepresentativeUrl ? urlHelpers.getRepresentativeUrl(entity, id) : null;
  return url;
}





