import { create } from 'zustand';
import { getSetting, setSetting } from './settings';

// mode: 'download' | 'upload'
// quality: 'high' | 'original'
export const useBucketStore = create((set, get) => ({
  isOpen: false,
  mode: getSetting('bucket_mode') ?? 'download',
  quality: getSetting('bucket_quality') ?? 'high',
  excludeAlready: getSetting('bucket_excludeAlready') ?? true,
  lastPulseTs: 0,
  // downloaded/uploaded history lists (ordered by last action, newest first)
  downloaded: getSetting('bucket_downloaded') ?? [], // array of image IDs
  uploaded: getSetting('bucket_uploaded') ?? [],
  // current bucket queue (image IDs to act on)
  queue: getSetting('bucket_queue') ?? [],

  // UI helpers
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set({ isOpen: !get().isOpen }),

  setMode: (mode) => {
    setSetting('bucket_mode', mode);
    set({ mode });
  },
  setQuality: (quality) => {
    setSetting('bucket_quality', quality);
    set({ quality });
  },
  setExcludeAlready: (value) => {
    setSetting('bucket_excludeAlready', value);
    set({ excludeAlready: value });
  },

  addToQueue: (imageIds) => {
    const existing = new Set(get().queue);
    let list = [...get().queue];
    imageIds.forEach(id => { if (!existing.has(id)) list.push(id); });
    setSetting('bucket_queue', list);
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
    setSetting('bucket_queue', list);
    set({ queue: list, lastPulseTs: Date.now() });
    return filtered.length;
  },
  removeFromQueue: (imageId) => {
    const list = get().queue.filter(id => id !== imageId);
    setSetting('bucket_queue', list);
    set({ queue: list });
  },
  removeManyFromQueue: (imageIds) => {
    const removeSet = new Set(imageIds);
    const list = get().queue.filter(id => !removeSet.has(id));
    setSetting('bucket_queue', list);
    set({ queue: list });
  },
  clearQueue: () => {
    setSetting('bucket_queue', []);
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
    setSetting('bucket_downloaded', newList);
    set({ downloaded: newList });
  },
  removeDownloaded: (imageId) => {
    const list = (get().downloaded || []).filter(id => id !== imageId);
    setSetting('bucket_downloaded', list);
    set({ downloaded: list });
  },
  markUploaded: (imageIds) => {
    const prev = get().uploaded;
    const setIds = new Set(imageIds);
    const newList = [
      ...imageIds,
      ...prev.filter(id => !setIds.has(id))
    ];
    setSetting('bucket_uploaded', newList);
    set({ uploaded: newList });
  },
  removeUploaded: (imageId) => {
    const list = (get().uploaded || []).filter(id => id !== imageId);
    setSetting('bucket_uploaded', list);
    set({ uploaded: list });
  },
  clearDownloaded: () => {
    setSetting('bucket_downloaded', []);
    set({ downloaded: [] });
  },
  clearUploaded: () => {
    setSetting('bucket_uploaded', []);
    set({ uploaded: [] });
  }
}));

export default useBucketStore;


