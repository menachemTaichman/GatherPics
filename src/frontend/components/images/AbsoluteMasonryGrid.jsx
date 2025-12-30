import React, { useMemo, useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';

// --- האלגוריתם שלך נשאר ללא שינוי ---
const calculateLayout = (items, containerWidth, baseSize, gap, imageClasses, isSquareGrid = false, heightMultiplier = 1.0) => {
  if (!containerWidth) return { layout: [], totalHeight: 0 };

  const colCount = Math.max(1, Math.floor((containerWidth + gap) / (baseSize + gap)));
  const realColWidth = (containerWidth - (colCount - 1) * gap) / colCount;
  const colHeights = new Array(colCount).fill(0);

  const layout = items.map((item) => {
    // Handle header items (for moment separators)
    if (item.isHeader) {
      // 1. מוצאים את הגובה המקסימלי הנוכחי (תחתית האלמנט הכי נמוך)
      const currentMaxHeight = Math.max(...colHeights);
      
      // 2. קובעים גובה לכותרת (למשל 50 פיקסל)
      const headerHeight = item.headerHeight || 50; 

      // 3. מעדכנים את כל העמודות להיות "אחרי" הכותרת
      const newBaseHeight = currentMaxHeight + headerHeight + gap;
      colHeights.fill(newBaseHeight);

      return {
        id: item.id,
        top: currentMaxHeight, // מתחיל מייד אחרי האלמנט הכי נמוך
        left: 0,
        width: containerWidth, // תופס את כל הרוחב!
        height: headerHeight,
        data: item,
        isHeader: true // כדי שתוכל לרנדר אותו אחרת
      };
    }
    
    // Regular image item
    // --- השינוי כאן ---
    let itemHeight;
    
    if (isSquareGrid) {
        // במצב ריבועי: הגובה שווה לרוחב (יחס 1:1)
        itemHeight = realColWidth;
    } else {
        // במצב מייסונרי רגיל: הלוגיקה המקורית שלך
        const isPortrait = imageClasses[item.id] === 'portrait';
        // Use heightMultiplier for portrait items, or apply to all items if heightMultiplier is set
        if (heightMultiplier !== 1.0) {
          itemHeight = realColWidth * heightMultiplier;
        } else {
          itemHeight = isPortrait ? (realColWidth * 2) + gap : realColWidth;
        }
    }
    // ------------------
    
    // מציאת העמודה הנמוכה ביותר
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
      isPortrait: isSquareGrid ? false : imageClasses[item.id] === 'portrait' // אופציונלי: לעדכן גם את הדגל הזה
    };
  });

  return { layout, totalHeight: Math.max(...colHeights) };
};

// התאמה לרשימה (עמודה אחת)
const calculateListLayout = (items, containerWidth, itemHeight, gap) => {
  if (!containerWidth) return { layout: [], totalHeight: 0 };
  
  // פשוט רץ אחד אחרי השני
  let currentTop = 0;
  
  const layout = items.map(item => {
    const top = currentTop;
    currentTop += itemHeight + gap; // מקדם את ה-Top הבא
    
    return {
      id: item.id,
      top,
      left: 0,
      width: containerWidth, // רוחב מלא
      height: itemHeight,
      data: item
    };
  });

  return { layout, totalHeight: currentTop };
};

/**
 * AbsoluteMasonryGrid - Virtualized masonry grid with absolute positioning
 * 
 * TESTING PARAMETERS:
 * 
 * 1. ZOOMING/JUMPING (Image Size Changes):
 *    - Controlled by: `baseSize` prop
 *    - In AlbumDetailPage: `baseSize={Math.max(120, 266 * imageSize)}`
 *    - To test: Change the multiplier (266) or min value (120)
 *    - Example: `baseSize={Math.max(80, 200 * imageSize)}` = smaller images
 *    - Example: `baseSize={Math.max(150, 350 * imageSize)}` = larger images
 * 
 * 2. SCROLLING PERFORMANCE (How fast images appear):
 *    - Controlled by: `bufferMultiplier` prop (default: 2.5)
 *    - Lower values (0.5-1.0): Faster scrolling, less pre-rendering, may show blank areas
 *    - Higher values (3.0-5.0): Smoother scrolling, more pre-rendering, more DOM elements
 *    - To test: Pass `bufferMultiplier={1.0}` or `bufferMultiplier={5.0}` to AbsoluteMasonryGrid
 */
const AbsoluteMasonryGrid = forwardRef(({
  items = [],
  renderItem,
  renderHeader = null, // Optional function to render header items
  baseSize = 150,
  gap = 3,
  imageClasses = {},
  containerHeight = '100%',
  className = '',
  style = {},
  onItemRef = null,
  // TESTING PARAMETER: Controls how much content is pre-rendered ahead/behind viewport
  // Higher = smoother scrolling but more DOM elements (try 1.0, 2.5, 5.0)
  bufferMultiplier = 3.0,
  onPinchRef = null, // <--- Prop חדש שמקבל את ה-Ref מההוק
  isSquareGrid = false, // <--- Prop חדש למצב ריבועי
  isListLayout = false, // <--- Prop חדש למצב רשימה
  listItemHeight = 80, // <--- גובה פריט במצב רשימה
  heightMultiplier = 1.0, // <--- Multiplier for item height (e.g., 1.5 = 50% taller)
}, ref) => {
  const internalContainerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 800 });
  const [scrollTop, setScrollTop] = useState(0);
  const [highlightedId, setHighlightedId] = useState(null);

  // --- הלב של התיקון: מיזוג Refs ---
  const setMultiRef = useCallback((node) => {
    // 1. עדכון ה-Ref הפנימי (בשביל הגלילה והמדידות שלנו כאן)
    internalContainerRef.current = node;

    // 2. העברת ה-Node להוק של ה-Pinch (כדי שיוכל להוסיף Event Listeners)
    if (onPinchRef) {
        onPinchRef(node);
    }
  }, [onPinchRef]); // תלות ב-Ref החיצוני

  // 1. האזנה לשינויי גודל + גלילה
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
       // requestAnimationFrame משפר ביצועים בגלילה מהירה
       requestAnimationFrame(() => {
         setScrollTop(element.scrollTop);
       });
    };

    observer.observe(element);
    element.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', handleScroll);
    };
  }, [dimensions.width]); // הוספנו תלות כדי לוודא שזה מתעדכן, למרות שבדרך כלל [] מספיק אם ה-Ref יציב

  // 2. חישוב ה-Layout (רץ רק כשמשתנה הרוחב או התמונות)
  const { layout, totalHeight } = useMemo(() => {
    if (isListLayout) {
      return calculateListLayout(items, dimensions.width, listItemHeight, gap);
    }
    return calculateLayout(items, dimensions.width, baseSize, gap, imageClasses, isSquareGrid, heightMultiplier);
  }, [items, dimensions.width, baseSize, gap, imageClasses, isSquareGrid, isListLayout, listItemHeight, heightMultiplier]);

  // --- Expose scrollToItem and scrollToMoment methods via ref ---
  useImperativeHandle(ref, () => ({
    /**
     * Smart scrolling function to scroll to a specific item
     * Implements "nearest" logic within a virtualized environment
     * Uses distance-based scrolling: instant jump if far, smooth scroll if close
     */
    scrollToItem: (itemId) => {
      const container = internalContainerRef.current;
      if (!container) return;

      // 1. Find the calculated position of the item (even if it's not in the DOM)
      const itemLayout = layout.find(item => item.id === itemId);
      if (!itemLayout) return;

      // 2. Calculate boundaries
      const itemTop = itemLayout.top;
      const itemBottom = itemLayout.top + itemLayout.height;
      const containerTop = container.scrollTop;
      const containerBottom = container.scrollTop + container.clientHeight;
      
      // Leave some padding so it's not stuck to the edge
      const padding = 20;
      const HUGE_DISTANCE_THRESHOLD = 3000; // Threshold for instant scroll (in pixels)

      // 3. Nearest logic - only scroll if necessary
      if (itemTop < containerTop + padding) {
        // Image is "above" the visible area -> scroll up
        const targetTop = Math.max(0, itemTop - padding);
        const distance = Math.abs(targetTop - containerTop);
        const behavior = distance > HUGE_DISTANCE_THRESHOLD ? 'auto' : 'smooth';
        container.scrollTo({ top: targetTop, behavior });
      } else if (itemBottom > containerBottom - padding) {
        // Image is "below" the visible area -> scroll down
        const targetTop = itemBottom - container.clientHeight + padding;
        const distance = Math.abs(targetTop - containerTop);
        const behavior = distance > HUGE_DISTANCE_THRESHOLD ? 'auto' : 'smooth';
        container.scrollTo({ top: targetTop, behavior });
      }
      // Otherwise: image is already on screen, do nothing!
    },
    
    /**
     * Scroll to a moment header with visual highlight effect
     * @param {string} headerId - The header ID (e.g., "header-{momentId}")
     */
    scrollToMoment: (headerId) => {
      const container = internalContainerRef.current;
      if (!container) return;

      const itemLayout = layout.find(item => item.id === headerId && item.isHeader);
      if (!itemLayout) return; // Header not found

      const targetTop = itemLayout.top;
      const currentScroll = container.scrollTop;
      const distance = Math.abs(targetTop - currentScroll);
      const HUGE_DISTANCE_THRESHOLD = 3000; // Threshold for instant scroll (in pixels)

      // Scroll logic
      if (distance > HUGE_DISTANCE_THRESHOLD) {
        // Large distance: instant jump ("Teleport")
        container.scrollTo({ top: targetTop, behavior: 'auto' });
      } else {
        // Reasonable distance: smooth scroll
        container.scrollTo({ top: targetTop, behavior: 'smooth' });
      }

      // Visual effect ("Cue"): highlight the header
      setHighlightedId(headerId);
      
      // Clear highlight after animation duration
      setTimeout(() => {
        setHighlightedId(null);
      }, 1500);
    }
  }), [layout]); // Depend on layout to have up-to-date information

  // 3. הווירטואליזציה האמיתית
  const visibleItems = useMemo(() => {
    if (!layout.length) return [];
    
    // TESTING: Adjust bufferMultiplier to test scrolling performance
    // Lower values (0.5-1.0) = faster scrolling, less pre-rendering, may show blank areas
    // Higher values (3.0-5.0) = smoother scrolling, more pre-rendering, more DOM elements
    const buffer = dimensions.height * bufferMultiplier; 
    
    const minTop = scrollTop - buffer;
    const maxTop = scrollTop + dimensions.height + buffer;

    return layout.filter(item => {
      return (item.top + item.height > minTop) && (item.top < maxTop);
    });
  }, [layout, scrollTop, dimensions.height, bufferMultiplier]);

  // שינוי 2: קומפוננטה פנימית עם Memo כדי למנוע רינדורים מיותרים בזמן גלילה
  // זה קריטי כי renderItem שלך מוגדר כפונקציה בתוך ה-Parent ולכן מתחדש כל הזמן
  const MemoizedItem = useMemo(() => React.memo(({ itemLayout, renderItem, renderHeader, onItemRef, highlightedId }) => {
    // Handle header items differently
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
            zIndex: 10, // Headers should be above images
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
    
    // Regular image item
    return (
      <div
        className="virtualized-grid-item"
        style={{
          position: 'absolute',
          top: `${itemLayout.top}px`,
          left: `${itemLayout.left}px`,
          width: `${itemLayout.width}px`,
          height: `${itemLayout.height}px`,
          contain: 'layout style paint',
          overflow: 'visible',
          
          // --- השינוי הקריטי ---
          // התמונה מקבלת את הסקייל מהמשתנה שהגדרנו באבא
          transform: 'scale(var(--grid-scale, 1))', 
          // נקודת העוגן היא המרכז, כך שהתמונות גדלות מהאמצע החוצה
          transformOrigin: 'center center',
          // Z-Index דינמי: בזמן זום התמונות עולות למעלה כדי לא להסתיר אחת את השנייה עם חיתוכים
          zIndex: 'var(--grid-z-index, 1)',
          // מעבר חד בזמן צביטה כדי למנוע לאגים
          transition: 'transform 0.1s ease-out', // טרנזישן קצר מאוד
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
  }), []);

  if (!items.length) return null;

  return (
    <div 
      ref={setMultiRef} // <--- משתמשים ב-Ref המאוחד
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
          // אופטימיזציה למניעת אירועי עכבר מיותרים בזמן גלילה (Pointer Events)
          pointerEvents: 'auto' 
        }}
      >
        {visibleItems.map((itemLayout) => (
          <MemoizedItem 
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

