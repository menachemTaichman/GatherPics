import { useState, useCallback, useRef, useMemo } from 'react';

export default function useImageViewerController({
  eventUrl,
  showToast,
  onTransferComplete = null,
  onJumpToMoment = null,
  defaultSortBy = 'date',
  defaultSortOrder = 'asc',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [parent, setParent] = useState(null);
  const [entity, setEntity] = useState(null);
  const [sortBy, setSortBy] = useState(defaultSortBy);
  const [sortOrder, setSortOrder] = useState(defaultSortOrder);
  const [currentGroupId, setCurrentGroupId] = useState(null);
  const lastClosedAtRef = useRef(0);

  const open = useCallback(({ index: startIndex = 0, parent: p, entity: e, sortBy: sb, sortOrder: so, currentGroupId: cg } = {}) => {
    const now = Date.now();
    if (now - (lastClosedAtRef.current || 0) < 200) return;
    if (typeof p !== 'undefined') setParent(p);
    if (typeof e !== 'undefined') setEntity(e);
    if (typeof sb !== 'undefined') setSortBy(sb);
    if (typeof so !== 'undefined') setSortOrder(so);
    if (typeof cg !== 'undefined') setCurrentGroupId(cg);
    setIndex(Math.max(0, startIndex));
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    lastClosedAtRef.current = Date.now();
    setIsOpen(false);
  }, []);

  const navigate = useCallback((direction, targetIndex) => {
    if (direction === 'jump' && typeof targetIndex === 'number') {
      setIndex(Math.max(0, targetIndex));
    } else if (direction === 'next') {
      setIndex(prev => prev + 1);
    } else if (direction === 'prev') {
      setIndex(prev => Math.max(0, prev - 1));
    }
  }, []);

  const viewerProps = useMemo(() => ({
    image: null,
    eventUrl,
    onClose: close,
    onNavigate: navigate,
    totalImages: 0,
    currentIndex: index,
    currentGroupId,
    onJumpToMoment,
    onTransferComplete,
    showToast,
    parent,
    entity,
    sortBy,
    sortOrder,
  }), [eventUrl, close, navigate, index, currentGroupId, onJumpToMoment, onTransferComplete, showToast, parent, entity, sortBy, sortOrder]);

  return { isOpen, open, close, navigate, viewerProps };
}


