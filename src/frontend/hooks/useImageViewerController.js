import { useState, useCallback, useRef, useMemo } from 'react';

export default function useImageViewerController({
  eventUrl,
  showToast,
  onTransferComplete = null,
  onJumpToMoment = null,
  defaultSortBy = 'date',
  defaultSortOrder = 'asc',
  urlHelpers = null,
  // New filtering parameters
  filterGroups = [],
  filterMode = 'and',
  onlySelected = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [parent, setParent] = useState(null);
  const [entity, setEntity] = useState(null);
  const [sortBy, setSortBy] = useState(defaultSortBy);
  const [sortOrder, setSortOrder] = useState(defaultSortOrder);
  const [filterByUploadId, setFilterByUploadId] = useState(null);
  const [filteredIds, setFilteredIds] = useState(null);
  const [currentGroupId, setCurrentGroupId] = useState(null);
  // New filtering state
  const [currentFilterGroups, setCurrentFilterGroups] = useState(filterGroups);
  const [currentFilterMode, setCurrentFilterMode] = useState(filterMode);
  const [currentOnlySelected, setCurrentOnlySelected] = useState(onlySelected);
  const lastClosedAtRef = useRef(0);

  // Stabilize external callbacks to avoid prop churn
  const onTransferCompleteRef = useRef(onTransferComplete);
  const onJumpToMomentRef = useRef(onJumpToMoment);
  const showToastRef = useRef(showToast);
  onTransferCompleteRef.current = onTransferComplete;
  onJumpToMomentRef.current = onJumpToMoment;
  showToastRef.current = showToast;

  // Stable wrappers so prop identities don't churn when viewerProps changes
  const stableOnTransferComplete = useCallback((...args) => {
    if (onTransferCompleteRef.current) return onTransferCompleteRef.current(...args);
  }, []);
  const stableOnJumpToMoment = useCallback((...args) => {
    if (onJumpToMomentRef.current) return onJumpToMomentRef.current(...args);
  }, []);
  const stableShowToast = useCallback((...args) => {
    if (showToastRef.current) return showToastRef.current(...args);
  }, []);

  const open = useCallback(({ index: startIndex = 0, parent: p, entity: e, sortBy: sb, sortOrder: so, filteredIds: fi, filterByUploadId: fbu, currentGroupId: cg, filterGroups: fg, filterMode: fm, onlySelected: os } = {}) => {
    const now = Date.now();
    if (now - (lastClosedAtRef.current || 0) < 200) return;
    if (typeof p !== 'undefined') setParent(p);
    if (typeof e !== 'undefined') setEntity(e);
    if (typeof sb !== 'undefined') setSortBy(sb);
    if (typeof so !== 'undefined') setSortOrder(so);
    if (typeof fi !== 'undefined') setFilteredIds(fi);
    if (typeof fbu !== 'undefined') setFilterByUploadId(fbu);
    if (typeof cg !== 'undefined') setCurrentGroupId(cg);
    // Handle new filtering parameters
    if (typeof fg !== 'undefined') setCurrentFilterGroups(fg);
    if (typeof fm !== 'undefined') setCurrentFilterMode(fm);
    if (typeof os !== 'undefined') setCurrentOnlySelected(os);
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
    onJumpToMoment: stableOnJumpToMoment,
    onTransferComplete: stableOnTransferComplete,
    showToast: stableShowToast,
    urlHelpers,
    filteredIds,
    filterByUploadId,
    parent,
    entity,
    sortBy,
    sortOrder,
    // New filtering parameters
    filterGroups: currentFilterGroups,
    filterMode: currentFilterMode,
    onlySelected: currentOnlySelected,
  }), [eventUrl, close, navigate, index, currentGroupId, parent, entity, sortBy, sortOrder, filteredIds, filterByUploadId, currentFilterGroups, currentFilterMode, currentOnlySelected, stableOnJumpToMoment, stableOnTransferComplete, stableShowToast, urlHelpers]);

  return { isOpen, open, close, navigate, viewerProps };
}





