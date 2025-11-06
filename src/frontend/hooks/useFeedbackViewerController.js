import { useState, useCallback, useMemo, useRef } from 'react';

export default function useFeedbackViewerController({
  showToast,
  defaultSortBy = 'created_at',
  defaultSortOrder = 'desc',
  filterStatus = 'all',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [sortBy, setSortBy] = useState(defaultSortBy);
  const [sortOrder, setSortOrder] = useState(defaultSortOrder);
  const [currentFilterStatus, setCurrentFilterStatus] = useState(filterStatus);
  
  const lastClosedAtRef = useRef(0);

  // Store callbacks
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const stableShowToast = useCallback((...args) => {
    if (showToastRef.current) return showToastRef.current(...args);
  }, []);

  const open = useCallback(({ 
    index: startIndex = 0, 
    sortBy: sb, 
    sortOrder: so, 
    filterStatus: fs 
  } = {}) => {
    const now = Date.now();
    if (now - (lastClosedAtRef.current || 0) < 200) return;
    
    if (typeof sb !== 'undefined') setSortBy(sb);
    if (typeof so !== 'undefined') setSortOrder(so);
    if (typeof fs !== 'undefined') setCurrentFilterStatus(fs);
    
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
    isOpen,
    onClose: close,
    onNavigate: navigate,
    currentIndex: index,
    sortBy,
    sortOrder,
    filterStatus: currentFilterStatus,
    showToast: stableShowToast,
  }), [isOpen, close, navigate, index, sortBy, sortOrder, currentFilterStatus, stableShowToast]);

  return {
    isOpen,
    open,
    close,
    navigate,
    viewerProps,
  };
}

