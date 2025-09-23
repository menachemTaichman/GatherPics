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
    parent: null,
    entity: null,
    sortBy: 'date',
    sortOrder: 'asc',
  });

  const open = useCallback((config) => {
    const {
      index = 0,
      eventUrl = null,
      groups = null,
      currentGroupId = null,
      showToast = () => {},
      onTransferComplete = null,
      onJumpToMoment = null,
      image = null,
      parent = null,
      entity = null,
      sortBy = 'date',
      sortOrder = 'asc',
    } = config || {};

    setSession({
      images: [],
      index: Math.max(0, index),
      eventUrl,
      groups,
      currentGroupId,
      showToast,
      onTransferComplete,
      onJumpToMoment,
      parent,
      entity,
      sortBy,
      sortOrder,
    });
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const navigate = useCallback((direction, targetIndex) => {
    setSession((prev) => {
      let idx = prev.index;
      if (direction === 'jump' && typeof targetIndex === 'number') {
        idx = Math.max(0, targetIndex);
      } else if (direction === 'next') {
        idx = prev.index + 1;
      } else if (direction === 'prev') {
        idx = Math.max(0, prev.index - 1);
      }
      return { ...prev, index: idx };
    });
  }, []);

  const updateSession = useCallback((config) => {
    setSession((prev) => {
      const { 
        index = prev.index, 
        image = null, 
        parent = prev.parent, 
        entity = prev.entity,
        sortBy = prev.sortBy,
        sortOrder = prev.sortOrder
      } = config || {};
      
      return {
        ...prev,
        images: [],
        index: Math.max(0, index),
        parent,
        entity,
        sortBy,
        sortOrder,
      };
    });
  }, []);

  const currentImageId = useMemo(() => {
    return null;
  }, [session.index, session.parent, session.entity]);

  const value = useMemo(() => ({
    open,
    close,
    navigate,
    updateSession,
    isOpen,
    currentImageId,
    currentIndex: session.index,
  }), [open, close, navigate, updateSession, isOpen, currentImageId, session.index]);

  // React to store changes
  useEffect(() => {
    const unsubscribe = () => {};
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
          parent={session.parent}
          entity={session.entity}
          sortBy={session.sortBy}
          sortOrder={session.sortOrder}
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


