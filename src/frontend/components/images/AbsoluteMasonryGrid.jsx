import React, { useMemo, useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';

// --- אופטימיזציה 1: הגדרת הקומפוננטה מחוץ ללולאה ---
const GridItem = React.memo(({ itemLayout, renderItem, renderHeader, onItemRef, highlightedId }) => {
  // Handle header items
  if (itemLayout.isHeader) {
    const isHighlighted = highlightedId === itemLayout.id;
    return (
      <div
        style={{
          position: 'absolute',
          top: `${itemLayout.top}px`,
          left: `${itemLayout.left}px`,
          width: `${itemLayout.width}px`,
          height: `${itemLayout.height}px`,
          zIndex: 10,
          transition: 'background-color 0.5s ease',
          backgroundColor: isHighlighted ? 'rgba(66, 135, 245, 0.2)' : 'transparent',
        }}
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
  return (
    <div
      className="virtualized-grid-item"
      style={{
        position: 'absolute',
        top: `${itemLayout.top}px`,
        left: `${itemLayout.left}px`,
        width: `${itemLayout.width}px`,
        height: `${itemLayout.height}px`,
        contain: 'layout style paint', // שיפור ביצועים לדפדפן
        overflow: 'visible',
        transform: 'scale(var(--grid-scale, 1))',
        transformOrigin: 'center center',
        zIndex: 'var(--grid-z-index, 1)',
        transition: 'transform 0.1s ease-out',
        willChange: 'transform'
      }}
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
const calculateLayout = (items, containerWidth, baseSize, gap, imageClasses, isSquareGrid = false, heightMultiplier = 1.0) => {
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
        left: 0,
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
    const left = colIndex * (realColWidth + gap);

    colHeights[colIndex] += itemHeight + gap;

    return {
      id: item.id,
      top,
      left,
      width: realColWidth,
      height: itemHeight,
      data: item,
      isPortrait: isSquareGrid ? false : imageClasses[item.id] === 'portrait'
    };
  });

  return { layout, totalHeight: Math.max(...colHeights) };
};

const calculateListLayout = (items, containerWidth, itemHeight, gap) => {
  if (!containerWidth) return { layout: [], totalHeight: 0 };
  
  let currentTop = 0;
  
  const layout = items.map(item => {
    const top = currentTop;
    currentTop += itemHeight + gap;
    
    return {
      id: item.id,
      top,
      left: 0,
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
}, ref) => {
  const internalContainerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 800 });
  const [scrollTop, setScrollTop] = useState(0);
  const [highlightedId, setHighlightedId] = useState(null);

  const setMultiRef = useCallback((node) => {
    internalContainerRef.current = node;
    if (onPinchRef) onPinchRef(node);
  }, [onPinchRef]);

  useEffect(() => {
    if (!internalContainerRef.current) return;
    const element = internalContainerRef.current;

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
  }, []);

  const { layout, totalHeight } = useMemo(() => {
    if (isListLayout) {
      return calculateListLayout(items, dimensions.width, listItemHeight, gap);
    }
    return calculateLayout(items, dimensions.width, baseSize, gap, imageClasses, isSquareGrid, heightMultiplier);
  }, [items, dimensions.width, baseSize, gap, imageClasses, isSquareGrid, isListLayout, listItemHeight, heightMultiplier]);

  useImperativeHandle(ref, () => ({
    scrollToItem: (itemId) => {
      const container = internalContainerRef.current;
      if (!container) return;
      const itemLayout = layout.find(item => item.id === itemId);
      if (!itemLayout) return;
      
      container.scrollTo({ top: itemLayout.top - 20, behavior: 'smooth' });
    },
    scrollToMoment: (headerId) => {
      const container = internalContainerRef.current;
      if (!container) return;
      const itemLayout = layout.find(item => item.id === headerId && item.isHeader);
      if (!itemLayout) return;

      container.scrollTo({ top: itemLayout.top, behavior: 'smooth' });
      setHighlightedId(headerId);
      setTimeout(() => setHighlightedId(null), 1500);
    },
    getCurrentVisibleMoment: () => {
      const container = internalContainerRef.current;
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
  }), [layout, scrollTop, dimensions.height]);

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

  return (
    <div 
      ref={setMultiRef}
      className={className}
      style={{ 
        width: '100%', 
        height: containerHeight, 
        overflowY: 'auto', 
        position: 'relative',
        willChange: 'scroll-position',
        touchAction: 'pan-y', 
        ...style 
      }}
    >
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
    </div>
  );
});

AbsoluteMasonryGrid.displayName = 'AbsoluteMasonryGrid';

export default AbsoluteMasonryGrid;