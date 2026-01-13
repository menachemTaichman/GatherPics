import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';

/**
 * SimpleVirtuosoGrid - A lightweight wrapper around VirtuosoGrid for uniform grids
 * 
 * This component is designed for simpler grids that don't need masonry layout,
 * headers, or variable item heights. It provides:
 * - Uniform grid layout (square items)
 * - Responsive column calculation based on baseSize
 * - Pinch-to-zoom support via onPinchRef
 * - Item ref callbacks
 * - Gap spacing
 * 
 * For complex grids with masonry layout, headers, or variable heights,
 * use AbsoluteMasonryGrid instead.
 */
const SimpleVirtuosoGrid = React.forwardRef(({
  items = [],
  renderItem,
  baseSize = 150,
  gap = 8,
  heightMultiplier = 1.0,
  containerHeight = '100%',
  className = '',
  style = {},
  onItemRef = null,
  onPinchRef = null,
  overscan = 200,
}, ref) => {
  const containerRef = useRef(null);
  const scrollRef = useRef(null);
  const [dimensions, setDimensions] = React.useState({ width: 0 });

  // Merge refs: internal container ref + onPinchRef callback
  const setMultiRef = useCallback((node) => {
    containerRef.current = node;
    // Use scroll element if available, otherwise use container
    const elementForPinch = scrollRef.current || node;
    if (onPinchRef && elementForPinch) {
      onPinchRef(elementForPinch);
    }
  }, [onPinchRef]);

  // Get the actual scroll element from VirtuosoGrid
  const handleScrollerRef = useCallback((element) => {
    scrollRef.current = element;
    // Update pinch ref when scroll element is available
    if (onPinchRef && element) {
      onPinchRef(element);
    }
  }, [onPinchRef]);

  // Track container width for responsive column calculation
  useEffect(() => {
    if (!containerRef.current) return;
    const element = containerRef.current;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setDimensions({
        width: entry.contentRect.width
      });
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Calculate responsive columns based on baseSize
  const columnCount = useMemo(() => {
    if (!dimensions.width) return 3; // Default fallback
    return Math.max(1, Math.floor((dimensions.width + gap) / (baseSize + gap)));
  }, [dimensions.width, baseSize, gap]);

  // Calculate item width (fills available space with gap)
  const itemWidth = useMemo(() => {
    if (!dimensions.width || columnCount === 0) return baseSize;
    return (dimensions.width - (columnCount - 1) * gap) / columnCount;
  }, [dimensions.width, columnCount, gap, baseSize]);

  // Calculate item height (square by default, or multiplied)
  const itemHeight = useMemo(() => {
    return itemWidth * heightMultiplier;
  }, [itemWidth, heightMultiplier]);

  // Styled components for VirtuosoGrid
  const ItemContainer = useMemo(() => {
    const ItemComponent = React.forwardRef(({ children, ...props }, ref) => {
      const itemIndex = props['data-index'];
      const item = items[itemIndex];
      const itemRef = React.useRef(null);

      // Merge external ref with internal ref
      React.useEffect(() => {
        if (ref) {
          if (typeof ref === 'function') {
            ref(itemRef.current);
          } else {
            ref.current = itemRef.current;
          }
        }
      }, [ref]);

      // Call onItemRef when element is mounted
      React.useEffect(() => {
        if (itemRef.current && onItemRef && item) {
          onItemRef(item, itemIndex, itemRef.current);
        }
      }, [item, itemIndex, onItemRef]);

      // Extract padding from props.style if it exists to avoid conflicts
      const { padding, paddingTop, paddingRight, paddingBottom, paddingLeft, ...restStyle } = props.style || {};
      
      return (
        <div
          {...props}
          ref={itemRef}
          style={{
            ...restStyle,
            paddingTop: paddingTop || `${gap / 2}px`,
            paddingRight: paddingRight || `${gap / 2}px`,
            paddingBottom: paddingBottom || `${gap / 2}px`,
            paddingLeft: paddingLeft || `${gap / 2}px`,
            width: `${100 / columnCount}%`,
            display: 'flex',
            flex: 'none',
            alignContent: 'stretch',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              width: '100%',
              height: `${itemHeight}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {children}
          </div>
        </div>
      );
    });
    
    ItemComponent.displayName = 'ItemContainer';
    return React.memo(ItemComponent);
  }, [columnCount, gap, itemHeight, items, onItemRef]);

  const ListContainer = useMemo(() => {
    const ListComponent = React.forwardRef(({ children, ...props }, ref) => {
      // Extract padding from props.style if it exists to avoid conflicts
      const { padding, paddingTop, paddingRight, paddingBottom, paddingLeft, ...restStyle } = props.style || {};
      
      return (
        <div
          {...props}
          ref={ref}
          style={{
            ...restStyle,
            paddingTop: paddingTop || `${gap / 2}px`,
            paddingRight: paddingRight || `${gap / 2}px`,
            paddingBottom: paddingBottom || `${gap / 2}px`,
            paddingLeft: paddingLeft || `${gap / 2}px`,
            display: 'flex',
            flexWrap: 'wrap',
          }}
        >
          {children}
        </div>
      );
    });
    
    ListComponent.displayName = 'ListContainer';
    return React.memo(ListComponent);
  }, [gap]);

  // Expose scrollToIndex via ref if needed
  React.useImperativeHandle(ref, () => ({
    scrollToIndex: (index) => {
      // VirtuosoGrid doesn't expose scrollToIndex directly via ref,
      // but we can access it through the container if needed
      // For now, this is a placeholder for future enhancement
    }
  }), []);

  if (!items.length) return null;

  return (
    <div
      ref={setMultiRef}
      className={className}
      style={{
        width: '100%',
        height: containerHeight,
        position: 'relative',
        willChange: 'scroll-position',
        touchAction: 'pan-y',
        ...style,
      }}
    >
      <VirtuosoGrid
        style={{ height: '100%', width: '100%' }}
        totalCount={items.length}
        overscan={overscan}
        scrollerRef={handleScrollerRef}
        components={{
          Item: ItemContainer,
          List: ListContainer,
        }}
        itemContent={(index) => {
          const item = items[index];
          if (!item) return null;
          
          // Call renderItem similar to AbsoluteMasonryGrid API
          // renderItem receives (item, index, isPortrait, setRef)
          // For uniform grid, isPortrait is always false
          const rendered = renderItem(item, index, false, (el) => {
            // setRef callback can be used by renderItem if needed
            if (onItemRef && el) {
              onItemRef(item, index, el);
            }
          });
          
          return rendered;
        }}
      />
    </div>
  );
});

SimpleVirtuosoGrid.displayName = 'SimpleVirtuosoGrid';

export default SimpleVirtuosoGrid;