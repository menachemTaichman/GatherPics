import { createContext, useCallback, useContext, useMemo, useState, useEffect } from 'react';
import { useDataStore } from '../utils/dataManager';
import ImageViewer from './ImageViewer';

const ImageViewerContext = createContext(null);

export function ImageViewerProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [session, setSession] = useState({
    images: [],
    index: 0,
    eventUrl: null,
    groups: null,
    currentGroupId: null,
    showToast: () => {},
    onTransferComplete: null,
    onJumpToMoment: null,
  });

  const open = useCallback((config) => {
    const {
      images = [],
      index = 0,
      eventUrl = null,
      groups = null,
      currentGroupId = null,
      showToast = () => {},
      onTransferComplete = null,
      onJumpToMoment = null,
      image = null,
    } = config || {};

    // Normalize images to an array of IDs (strings)
    const normalized = Array.isArray(images)
      ? images.map(it => (typeof it === 'string' ? it : it?.id)).filter(Boolean)
      : [];
    let nextIndex = index;

    // If explicit image provided, prefer it to calculate index
    if (image) {
      const imageId = typeof image === 'string' ? image : image?.id;
      const found = normalized.findIndex(it => it === imageId);
      if (found >= 0) nextIndex = found;
    }

    setSession({
      images: normalized,
      index: Math.max(0, Math.min(nextIndex, Math.max(0, normalized.length - 1))),
      eventUrl,
      groups,
      currentGroupId,
      showToast,
      onTransferComplete,
      onJumpToMoment,
    });
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const navigate = useCallback((direction, targetIndex) => {
    setSession((prev) => {
      const total = prev.images.length;
      if (total === 0) return prev;
      let idx = prev.index;
      if (direction === 'jump' && typeof targetIndex === 'number') {
        idx = Math.max(0, Math.min(targetIndex, total - 1));
      } else if (direction === 'next') {
        idx = Math.min(prev.index + 1, total - 1);
      } else if (direction === 'prev') {
        idx = Math.max(prev.index - 1, 0);
      }
      return { ...prev, index: idx };
    });
  }, []);

  const updateSession = useCallback((config) => {
    setSession((prev) => {
      const { images = prev.images, index = prev.index, image = null } = config || {};
      const normalized = Array.isArray(images)
        ? images.map(it => (typeof it === 'string' ? it : it?.id)).filter(Boolean)
        : prev.images;
      let nextIndex = index;
      if (image) {
        const imageId = typeof image === 'string' ? image : image?.id;
        const found = normalized.findIndex((it) => it === imageId);
        if (found >= 0) nextIndex = found;
      }
      return {
        ...prev,
        images: normalized,
        index: Math.max(0, Math.min(nextIndex, Math.max(0, normalized.length - 1)))
      };
    });
  }, []);

  const currentImageId = useMemo(() => {
    const current = session.images[session.index];
    if (!current) return null;
    return current;
  }, [session.images, session.index]);

  const value = useMemo(() => ({
    open,
    close,
    navigate,
    updateSession,
    isOpen,
    currentImageId,
    currentIndex: session.index,
  }), [open, close, navigate, updateSession, isOpen, currentImageId, session.index]);

  // React to store changes: if current image leaves the group's grid, advance/close
  useEffect(() => {
    const unsubscribe = useDataStore.subscribe((state) => {
      try {
        if (!isOpen) return;
        const groupId = session.currentGroupId;
        if (!groupId) return;
        const grid = (state.relations?.groupImages?.[groupId] || []);
        if (!Array.isArray(grid)) return;
        const visibleSet = new Set(grid);
        const filtered = (session.images || []).filter((id) => visibleSet.has(id));
        if (filtered.length === 0) {
          setIsOpen(false);
          return;
        }
        // If list changed or current id removed, update session gracefully
        const currentId = session.images[session.index];
        const nextIndex = Math.min(
          currentId && visibleSet.has(currentId) ? filtered.indexOf(currentId) : Math.max(0, Math.min(session.index, filtered.length - 1)),
          filtered.length - 1
        );
        if (
          filtered.length !== session.images.length ||
          filtered.some((id, i) => id !== session.images[i]) ||
          filtered.indexOf(currentId) !== session.index
        ) {
          setSession((prev) => ({ ...prev, images: filtered, index: Math.max(0, nextIndex) }));
        }
      } catch {}
    });
    return unsubscribe;
  }, [isOpen, session.currentGroupId, session.images, session.index]);

  return (
    <ImageViewerContext.Provider value={value}>
      {children}
      {isOpen && (
        <ImageViewer
          image={currentImageId}
          eventUrl={session.eventUrl}
          onClose={close}
          onNavigate={navigate}
          totalImages={session.images.length}
          currentIndex={session.index}
          currentGroupId={session.currentGroupId}
          onJumpToMoment={session.onJumpToMoment}
          groups={session.groups}
          onTransferComplete={session.onTransferComplete}
          showToast={session.showToast}
        />
      )}
    </ImageViewerContext.Provider>
  );
}

export function useImageViewer() {
  const ctx = useContext(ImageViewerContext);
  if (!ctx) {
    throw new Error('useImageViewer must be used within an ImageViewerProvider');
  }
  return ctx;
}


