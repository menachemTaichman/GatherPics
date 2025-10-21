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
  downloaded: getPreference('BucketDrawer.alreadyDownloaded') ?? [], // array of image ids
  uploaded: getPreference('BucketDrawer.alreadyUploaded') ?? [],
  // current bucket queue (image ids to act on)
  queue: getPreference('BucketDrawer.queue') ?? [],

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
    const existing = new Set(get().queue);
    let list = [...get().queue];
    imageIds.forEach(id => { if (!existing.has(id)) list.push(id); });
    setPreference('BucketDrawer.queue', list);
    set({ queue: list });
  },
  addImages: (imageIds) => {
    const existing = new Set(get().queue);
    const filtered = imageIds.filter(id => !existing.has(id));
    if (filtered.length === 0) {
      set({ lastPulseTs: Date.now() });
      return 0;
    }
    const list = [...get().queue, ...filtered];
    setPreference('BucketDrawer.queue', list);
    set({ queue: list, lastPulseTs: Date.now() });
    return filtered.length;
  },
  removeFromQueue: (imageId) => {
    const list = get().queue.filter(id => id !== imageId);
    setPreference('BucketDrawer.queue', list);
    set({ queue: list });
  },
  removeManyFromQueue: (imageIds) => {
    const removeSet = new Set(imageIds);
    const list = get().queue.filter(id => !removeSet.has(id));
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





