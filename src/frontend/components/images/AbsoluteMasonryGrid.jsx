import React, { useMemo, useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react';
import { useRTL } from '../../hooks/useRTL';

// --- אופטימיזציה 1: הגדרת הקומפוננטה מחוץ ללולאה ---
const GridItem = React.memo(({ itemLayout, renderItem, renderHeader, onItemRef, highlightedId }) => {
  // Handle header items
  if (itemLayout.isHeader) {
    const isHighlighted = highlightedId === itemLayout.id;
    const positionStyle = {
      position: 'absolute',
      top: `${itemLayout.top}px`,
      width: `${itemLayout.width}px`,
      height: `${itemLayout.height}px`,
      zIndex: 10,
      transition: 'background-color 0.5s ease',
      backgroundColor: isHighlighted ? 'rgba(66, 135, 245, 0.2)' : 'transparent',
    };
    if (itemLayout.left !== undefined) {
      positionStyle.left = `${itemLayout.left}px`;
    }
    if (itemLayout.right !== undefined) {
      positionStyle.right = `${itemLayout.right}px`;
    }
    
    return (
      <div
        style={positionStyle}
        className={isHighlighted ? 'moment-header-highlighted' : ''}
      >
        {renderHeader ? renderHeader(itemLayout.data) : (
          <div style={{ width: '100%', height: '100%', padding: '8px' }}>
            {itemLayout.data.label || itemLayout.data.title || 'Header'}
          </div>
        )}
      </div>
    );
  }

  // Regular item
  const positionStyle = {
    position: 'absolute',
    top: `${itemLayout.top}px`,
    width: `${itemLayout.width}px`,
    height: `${itemLayout.height}px`,
    contain: 'layout style paint', // שיפור ביצועים לדפדפן
    overflow: 'visible',
    transform: 'scale(var(--grid-scale, 1))',
    transformOrigin: 'center center',
    zIndex: 'var(--grid-z-index, 1)',
    transition: 'transform 0.1s ease-out',
    willChange: 'transform'
  };
  if (itemLayout.left !== undefined) {
    positionStyle.left = `${itemLayout.left}px`;
  }
  if (itemLayout.right !== undefined) {
    positionStyle.right = `${itemLayout.right}px`;
  }
  
  return (
    <div
      className="virtualized-grid-item"
      style={positionStyle}
    >
      <div style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        {renderItem(itemLayout.data, -1, itemLayout.isPortrait, (el) => {
          if (onItemRef && el) onItemRef(itemLayout.data, -1, el);
        })}
      </div>
    </div>
  );
});

// --- פונקציות חישוב Layout ---
const calculateLayout = (items, containerWidth, baseSize, gap, imageClasses, isSquareGrid = false, heightMultiplier = 1.0, isRTL = false) => {
  if (!containerWidth) return { layout: [], totalHeight: 0 };

  const colCount = Math.max(1, Math.floor((containerWidth + gap) / (baseSize + gap)));
  const realColWidth = (containerWidth - (colCount - 1) * gap) / colCount;
  const colHeights = new Array(colCount).fill(0);

  const layout = items.map((item) => {
    // Handle header items (for moment separators)
    if (item.isHeader) {
      const currentMaxHeight = Math.max(...colHeights);
      
      const headerHeight = item.headerHeight || 50; 

      const newBaseHeight = currentMaxHeight + headerHeight + gap;
      colHeights.fill(newBaseHeight);

      return {
        id: item.id,
        top: currentMaxHeight,
        left: isRTL ? undefined : 0,
        right: isRTL ? 0 : undefined,
        width: containerWidth,
        height: headerHeight,
        data: item,
        isHeader: true
      };
    }
    
    // Regular image item
    let itemHeight;
    
    if (isSquareGrid) {
      itemHeight = realColWidth;
    } else {
      const isPortrait = imageClasses[item.id] === 'portrait';
      if (heightMultiplier !== 1.0) {
        itemHeight = realColWidth * heightMultiplier;
      } else {
        itemHeight = isPortrait ? (realColWidth * 2) + gap : realColWidth;
      }
    }
    
    const minHeight = Math.min(...colHeights);
    const colIndex = colHeights.indexOf(minHeight);

    const top = colHeights[colIndex];
    
    // Calculate position based on RTL
    let left, right;
    if (isRTL) {
      // In RTL, use right positioning: colIndex 0 starts at right: 0
      right = colIndex * (realColWidth + gap);
      left = undefined;
    } else {
      // In LTR, use left positioning: colIndex 0 starts at left: 0
      left = colIndex * (realColWidth + gap);
      right = undefined;
    }

    colHeights[colIndex] += itemHeight + gap;

    return {
      id: item.id,
      top,
      left,
      right,
      width: realColWidth,
      height: itemHeight,
      data: item,
      isPortrait: isSquareGrid ? false : imageClasses[item.id] === 'portrait'
    };
  });

  return { layout, totalHeight: Math.max(...colHeights) };
};

const calculateListLayout = (items, containerWidth, itemHeight, gap, isRTL = false) => {
  if (!containerWidth) return { layout: [], totalHeight: 0 };
  
  let currentTop = 0;
  
  const layout = items.map(item => {
    const top = currentTop;
    currentTop += itemHeight + gap;
    
    return {
      id: item.id,
      top,
      left: isRTL ? undefined : 0,
      right: isRTL ? 0 : undefined,
      width: containerWidth,
      height: itemHeight,
      data: item
    };
  });

  return { layout, totalHeight: currentTop };
};

// --- עזר לחיפוש בינארי ---
// מוצא את האינדקס הראשון שבו הפריט נגע ב-minTop
const findStartIndex = (layout, minTop) => {
  let start = 0;
  let end = layout.length - 1;
  let result = 0;

  while (start <= end) {
    const mid = Math.floor((start + end) / 2);
    const item = layout[mid];
    
    if (item.top + item.height < minTop) {
      start = mid + 1;
    } else {
      result = mid;
      end = mid - 1;
    }
  }
  return result;
};

const AbsoluteMasonryGrid = forwardRef(({
  items = [],
  renderItem,
  renderHeader = null,
  baseSize = 150,
  gap = 3,
  imageClasses = {},
  containerHeight = '100%',
  className = '',
  style = {},
  onItemRef = null,
  bufferMultiplier = 3.0,
  onPinchRef = null,
  isSquareGrid = false,
  isListLayout = false,
  listItemHeight = 80,
  heightMultiplier = 1.0,
  useCustomScrollbar = undefined, // undefined means auto-detect mobile
}, ref) => {
  const internalContainerRef = useRef(null);
  const overlayScrollbarsRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 800 });
  const [scrollTop, setScrollTop] = useState(0);
  const [highlightedId, setHighlightedId] = useState(null);
  const { isRTL } = useRTL();
  
  // Auto-detect mobile if useCustomScrollbar is undefined
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  // Use custom scrollbar on mobile by default, or if explicitly set
  const shouldUseCustomScrollbar = useCustomScrollbar !== undefined 
    ? useCustomScrollbar 
    : isMobile;

  // Get the actual scrollable element from OverlayScrollbars
  const getScrollableElement = useCallback(() => {
    if (shouldUseCustomScrollbar && overlayScrollbarsRef.current) {
      try {
        // OverlayScrollbars creates a wrapper, we need the actual scrollable element
        const instance = overlayScrollbarsRef.current.osInstance();
        if (instance) {
          const elements = instance.elements();
          return elements?.viewport || internalContainerRef.current;
        }
      } catch (error) {
        // Fallback if instance not ready yet
        return internalContainerRef.current;
      }
    }
    return internalContainerRef.current;
  }, [shouldUseCustomScrollbar]);

  // Handle OverlayScrollbars initialization
  const handleOverlayScrollbarsInit = useCallback((instance) => {
    if (!instance) return;
    try {
      const elements = instance.elements();
      const viewport = elements?.viewport;
      if (viewport) {
        internalContainerRef.current = viewport;
        if (onPinchRef) onPinchRef(viewport);
        // Trigger initial dimensions update
        setTimeout(() => {
          const element = viewport;
          if (element) {
            setDimensions({
              width: element.clientWidth,
              height: element.clientHeight
            });
          }
        }, 0);
      }
    } catch (error) {
      console.warn('Error initializing OverlayScrollbars:', error);
    }
  }, [onPinchRef]);

  const setMultiRef = useCallback((node) => {
    if (!shouldUseCustomScrollbar) {
      internalContainerRef.current = node;
      if (onPinchRef) onPinchRef(node);
    }
  }, [onPinchRef, shouldUseCustomScrollbar]);

  useEffect(() => {
    const element = getScrollableElement();
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setDimensions({
        width: entry.contentRect.width,
        height: entry.contentRect.height
      });
    });

    const handleScroll = () => {
       requestAnimationFrame(() => {
         if (element) setScrollTop(element.scrollTop);
       });
    };

    observer.observe(element);
    element.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', handleScroll);
    };
  }, [getScrollableElement]);

  const { layout, totalHeight } = useMemo(() => {
    if (isListLayout) {
      return calculateListLayout(items, dimensions.width, listItemHeight, gap, isRTL);
    }
    return calculateLayout(items, dimensions.width, baseSize, gap, imageClasses, isSquareGrid, heightMultiplier, isRTL);
  }, [items, dimensions.width, baseSize, gap, imageClasses, isSquareGrid, isListLayout, listItemHeight, heightMultiplier, isRTL]);

  useImperativeHandle(ref, () => ({
    scrollToItem: (itemId) => {
      const container = getScrollableElement();
      if (!container) return;
      const itemLayout = layout.find(item => item.id === itemId);
      if (!itemLayout) return;
      
      container.scrollTo({ top: itemLayout.top - 20, behavior: 'smooth' });
    },
    scrollToMoment: (headerId) => {
      const container = getScrollableElement();
      if (!container) return;
      const itemLayout = layout.find(item => item.id === headerId && item.isHeader);
      if (!itemLayout) return;

      container.scrollTo({ top: itemLayout.top, behavior: 'smooth' });
      setHighlightedId(headerId);
      setTimeout(() => setHighlightedId(null), 1500);
    },
    getCurrentVisibleMoment: () => {
      const container = getScrollableElement();
      if (!container || !layout.length) return null;

      const currentScrollTop = scrollTop || container.scrollTop;
      const viewportHeight = dimensions.height || container.clientHeight;
      const viewportCenter = currentScrollTop + viewportHeight / 2;

      const headers = layout.filter(item => item.isHeader);
      if (headers.length === 0) return null;

      let bestHeader = null;
      let bestDistance = Infinity;

      for (const header of headers) {
        const headerTop = header.top;
        const distanceFromCenter = Math.abs(headerTop - viewportCenter);
        
        if (headerTop <= viewportCenter + 100 && distanceFromCenter < bestDistance) {
          bestDistance = distanceFromCenter;
          bestHeader = header;
        }
      }

      if (!bestHeader) {
        for (const header of headers) {
          if (header.top > viewportCenter) {
            bestHeader = header;
            break;
          }
        }
      }

      if (!bestHeader && currentScrollTop < 50 && headers.length > 0) {
        bestHeader = headers[0];
      }

      if (!bestHeader && headers.length > 0) {
        bestHeader = headers[headers.length - 1];
      }

      return bestHeader ? bestHeader.id : null;
    }
  }), [layout, scrollTop, dimensions.height, getScrollableElement]);

  // --- אופטימיזציה 2: שימוש בחיפוש בינארי במקום Filter מלא ---
  const visibleItems = useMemo(() => {
    if (!layout.length) return [];
    
    const buffer = dimensions.height * bufferMultiplier;
    const minTop = Math.max(0, scrollTop - buffer);
    const maxTop = scrollTop + dimensions.height + buffer;

    const startIndex = findStartIndex(layout, minTop);
    
    const items = [];
    for (let i = startIndex; i < layout.length; i++) {
      const item = layout[i];
      if (item.top > maxTop) {
        if (item.top > maxTop + baseSize * 2) break;
      }
      
      if (item.top + item.height > minTop) {
        items.push(item);
      }
    }

    return items;
  }, [layout, scrollTop, dimensions.height, bufferMultiplier, baseSize]);

  if (!items.length) return null;

  const content = (
    <div 
      style={{ 
        height: totalHeight, 
        width: '100%', 
        position: 'relative',
        pointerEvents: 'auto' 
      }}
    >
      {visibleItems.map((itemLayout) => (
        <GridItem 
           key={itemLayout.id}
           itemLayout={itemLayout}
           renderItem={renderItem}
           renderHeader={renderHeader}
           onItemRef={onItemRef}
           highlightedId={highlightedId}
        />
      ))}
    </div>
  );

  if (shouldUseCustomScrollbar) {
    // Use OverlayScrollbars for custom scrollbar
    return (
      <OverlayScrollbarsComponent
        ref={overlayScrollbarsRef}
        element="div"
        className={className}
        options={{
          scrollbars: {
            theme: isRTL ? 'os-theme-dark os-theme-dark-rtl' : 'os-theme-dark',
            autoHide: 'never', // Always show on mobile for easier grabbing
            autoHideDelay: 0,
            clickScroll: true,
            dragScroll: true,
            pointers: ['mouse', 'touch', 'pen'],
            visibility: 'visible',
            size: '10px', // Default size, will be overridden by CSS on mobile
          },
          overflow: {
            x: 'hidden',
            y: 'scroll',
          },
        }}
        events={{
          initialized: handleOverlayScrollbarsInit,
          updated: handleOverlayScrollbarsInit,
        }}
        style={{ 
          width: '100%', 
          height: containerHeight,
          position: 'relative',
          touchAction: 'pan-y',
          ...style 
        }}
      >
        {content}
      </OverlayScrollbarsComponent>
    );
  }

  // Default native scrollbar
  return (
    <div 
      ref={setMultiRef}
      className={className}
      style={{ 
        width: '100%', 
        height: containerHeight, 
        overflowY: 'auto', 
        overflowX: 'hidden',
        position: 'relative',
        willChange: 'scroll-position',
        touchAction: 'pan-y',
        WebkitOverflowScrolling: 'touch',
        ...style 
      }}
    >
      {content}
    </div>
  );
});

AbsoluteMasonryGrid.displayName = 'AbsoluteMasonryGrid';

export default AbsoluteMasonryGrid;