import React, { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';

// Debounce helper to prevent layout thrashing
const useDebouncedDimensions = (ref, delay = 100) => {
  const [dimensions, setDimensions] = useState({ width: 0 });

  useEffect(() => {
    if (!ref.current) return;
    
    let timeoutId;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      // Only update if width actually changed significantly (avoid fractional pixel jitter)
      if (Math.abs(width - dimensions.width) > 1) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          setDimensions({ width });
        }, delay);
      }
    });

    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      clearTimeout(timeoutId);
    };
  }, [ref, delay, dimensions.width]);

  return dimensions;
};

const SimpleVirtuosoGrid = React.forwardRef(({
  items = [],
  renderItem,
  baseSize = 150,
  gap = 8,
  heightMultiplier = 1.0,
  containerHeight = '100%',
  className = '',
  style = {},
  onPinchRef = null,
  // Increase overscan significantly for images to prevent "blank" areas during scroll
  overscan = 1200,
  // Allow disabling minHeight for flex containers to prevent gaps
  disableMinHeight = false,
}, ref) => {
  const containerRef = useRef(null);
  const scrollRef = useRef(null);
  
  // Use debounced width to prevent excessive re-renders during resize
  const { width } = useDebouncedDimensions(containerRef, 50);

  // Calculate columns - Memoized
  const gridLayout = useMemo(() => {
    if (!width) return { columns: 3, itemWidth: baseSize, itemHeight: baseSize * heightMultiplier };
    
    const columns = Math.max(1, Math.floor((width + gap) / (baseSize + gap)));
    const itemWidth = (width - (columns - 1) * gap) / columns;
    
    return {
      columns,
      itemWidth,
      itemHeight: itemWidth * heightMultiplier
    };
  }, [width, baseSize, gap, heightMultiplier]);

  // Handle refs
  const setMultiRef = useCallback((node) => {
    containerRef.current = node;
    const elementForPinch = scrollRef.current || node;
    if (onPinchRef && elementForPinch) onPinchRef(elementForPinch);
  }, [onPinchRef]);

  const handleScrollerRef = useCallback((element) => {
    scrollRef.current = element;
    if (onPinchRef && element) onPinchRef(element);
  }, [onPinchRef]);

  // Stable ItemContainer to prevent remounts
  // We construct the styles outside to avoid recreating objects inside the render function
  const ItemContainer = useMemo(() => {
    return ({ children, style: propStyle, ...restProps }) => {
      // Only extract style - don't spread other props to avoid passing non-DOM props to div
      // VirtuosoGrid may pass internal props that shouldn't be on DOM elements
      return (
        <div
          style={{
            ...propStyle,
            width: `${100 / gridLayout.columns}%`,
            padding: `${gap / 2}px`,
            display: 'flex',
            boxSizing: 'border-box',
            // Critical for performance:
            contentVisibility: 'auto', 
            containIntrinsicSize: `${gridLayout.itemHeight}px` 
          }}
        >
          <div style={{ width: '100%', height: `${gridLayout.itemHeight}px` }}>
            {children}
          </div>
        </div>
      );
    };
  }, [gridLayout.columns, gridLayout.itemHeight, gap]);

  const ListContainer = useMemo(() => {
    return React.forwardRef(({ style, children, ...restProps }, listRef) => {
      // Only extract style - don't spread other props to avoid passing non-DOM props to div
      // VirtuosoGrid may pass internal props that shouldn't be on DOM elements
      return (
        <div
          ref={listRef}
          style={{
            ...style,
            display: 'flex',
            flexWrap: 'wrap',
            // Remove padding from container to handle gaps strictly via Item padding
            // Negative margin compensates for item padding, so we don't need to add to width
            margin: `-${gap/2}px`,
            width: '100%',
            boxSizing: 'border-box'
          }}
        >
          {children}
        </div>
      );
    });
  }, [gap]);

  // Stable item content renderer
  const itemContent = useCallback((index) => {
    return renderItem(items[index], index);
  }, [items, renderItem]);

  // Optimized key computation
  const computeItemKey = useCallback((index) => {
    const item = items[index];
    // Ensure we return a string or number, fallback to index is dangerous for lazy loading
    return item?.id ?? item?.group_id ?? item?.key ?? index;
  }, [items]);

  if (!items.length) return null;

  // Calculate container style
  const containerStyle = useMemo(() => {
    const baseStyle = {
      width: '100%',
      height: containerHeight,
      position: 'relative',
      touchAction: 'pan-y', // Improves scrolling on mobile
      overflow: 'hidden', // Prevent horizontal scrolling
      ...style,
    };
    
    // If containerHeight is 100% and no custom minHeight/height is set,
    // add a reasonable minHeight for initial render (unless disabled for flex containers)
    if (containerHeight === '100%' && !style.minHeight && !style.height && !disableMinHeight) {
      // Use a reasonable minHeight for initial render (allows grid to calculate layout)
      baseStyle.minHeight = '300px';
    } else if (containerHeight === '100%' && disableMinHeight) {
      // For flex containers, use minHeight: 0 to allow proper flex behavior
      baseStyle.minHeight = style.minHeight || 0;
    }
    
    return baseStyle;
  }, [containerHeight, style]);

  return (
    <div
      ref={setMultiRef}
      className={className}
      style={containerStyle}
    >
      <VirtuosoGrid
        style={{ 
          height: '100%', 
          width: '100%',
          overflowX: 'hidden' // Prevent horizontal scrolling
        }}
        totalCount={items.length}
        overscan={overscan}
        // Fixed item height helps VirtuosoGrid calculate which items to render
        // Total height = itemHeight + gap (padding top + bottom)
        // Safe to use now - we don't spread props to DOM elements in ItemContainer/ListContainer
        // fixedItemHeight={gridLayout.itemHeight + gap}  // removed beacuse of "Warning: React does not recognize the `fixedItemHeight` prop on a DOM element"
        // Increase viewport by additional pixels to prevent cut-offs
        // This renders extra items beyond the visible area
        increaseViewportBy={{ top: 400, bottom: 400 }}
        scrollerRef={handleScrollerRef}
        components={{
          Item: ItemContainer,
          List: ListContainer,
        }}
        itemContent={itemContent}
        computeItemKey={computeItemKey}
      />
    </div>
  );
});

SimpleVirtuosoGrid.displayName = 'SimpleVirtuosoGrid';
export default SimpleVirtuosoGrid;