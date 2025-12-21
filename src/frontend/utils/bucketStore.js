import { create } from 'zustand';
import { getPreference, setPreference } from './settings';

// mode: 'download' | 'upload'
// quality: 'high' | 'original'
export const useBucketStore = create((set, get) => ({
  isOpen: false,
  mode: getPreference('BucketDrawer.mode') ?? 'download',
  quality: getPreference('BucketDrawer.quality') ?? 'high',
  excludeAlready: getPreference('BucketDrawer.excludeAlready') ?? true,
  lastPulseTs: 0,
  // downloaded/uploaded history lists (ordered by last action, newest first)
  downloaded: Array.isArray(getPreference('BucketDrawer.alreadyDownloaded')) ? getPreference('BucketDrawer.alreadyDownloaded') : [], // array of image ids
  uploaded: Array.isArray(getPreference('BucketDrawer.alreadyUploaded')) ? getPreference('BucketDrawer.alreadyUploaded') : [],
  // current bucket queue (image ids to act on)
  queue: Array.isArray(getPreference('BucketDrawer.queue')) ? getPreference('BucketDrawer.queue') : [],

  // UI helpers
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),

  setMode: (mode) => {
    setPreference('BucketDrawer.mode', mode);
    set({ mode });
  },
  setQuality: (quality) => {
    setPreference('BucketDrawer.quality', quality);
    set({ quality });
  },
  setExcludeAlready: (value) => {
    setPreference('BucketDrawer.excludeAlready', value);
    set({ excludeAlready: value });
  },

  addToQueue: (imageIds) => {
    const currentQueue = Array.isArray(get().queue) ? get().queue : [];
    const existing = new Set(currentQueue);
    let list = [...currentQueue];
    imageIds.forEach(id => { if (!existing.has(id)) list.push(id); });
    setPreference('BucketDrawer.queue', list);
    set({ queue: list });
  },
  addImages: (imageIds) => {
    const currentQueue = Array.isArray(get().queue) ? get().queue : [];
    const existing = new Set(currentQueue);
    const filtered = imageIds.filter(id => !existing.has(id));
    if (filtered.length === 0) {
      set({ lastPulseTs: Date.now() });
      return 0;
    }
    const list = [...currentQueue, ...filtered];
    setPreference('BucketDrawer.queue', list);
    set({ queue: list, lastPulseTs: Date.now() });
    return filtered.length;
  },
  removeFromQueue: (imageId) => {
    const currentQueue = Array.isArray(get().queue) ? get().queue : [];
    const list = currentQueue.filter(id => id !== imageId);
    setPreference('BucketDrawer.queue', list);
    set({ queue: list });
  },
  removeManyFromQueue: (imageIds) => {
    const currentQueue = Array.isArray(get().queue) ? get().queue : [];
    const removeSet = new Set(imageIds);
    const list = currentQueue.filter(id => !removeSet.has(id));
    setPreference('BucketDrawer.queue', list);
    set({ queue: list });
  },
  clearQueue: () => {
    setPreference('BucketDrawer.queue', []);
    set({ queue: [] });
  },

  // record successful actions
  markDownloaded: (imageIds) => {
    const prev = get().downloaded;
    const setIds = new Set(imageIds);
    const newList = [
      ...imageIds,
      ...prev.filter(id => !setIds.has(id))
    ];
    setPreference('BucketDrawer.alreadyDownloaded', newList);
    set({ downloaded: newList });
  },
  removeDownloaded: (imageId) => {
    const list = (get().downloaded || []).filter(id => id !== imageId);
    setPreference('BucketDrawer.alreadyDownloaded', list);
    set({ downloaded: list });
  },
  markUploaded: (imageIds) => {
    const prev = get().uploaded;
    const setIds = new Set(imageIds);
    const newList = [
      ...imageIds,
      ...prev.filter(id => !setIds.has(id))
    ];
    setPreference('BucketDrawer.alreadyUploaded', newList);
    set({ uploaded: newList });
  },
  removeUploaded: (imageId) => {
    const list = (get().uploaded || []).filter(id => id !== imageId);
    setPreference('BucketDrawer.alreadyUploaded', list);
    set({ uploaded: list });
  },
  clearDownloaded: () => {
    setPreference('BucketDrawer.alreadyDownloaded', []);
    set({ downloaded: [] });
  },
  clearUploaded: () => {
    setPreference('BucketDrawer.alreadyUploaded', []);
    set({ uploaded: [] });
  }
}));

export default useBucketStore;





