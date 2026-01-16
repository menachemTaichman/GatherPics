import { useRef, useCallback, useEffect } from 'react';

export const useSwipeSelection = ({ 
  layout, 
  scrollTop, // אנו נשמור את זה ב-Ref כדי שיהיה עדכני תמיד
  onSelectionChange, 
  enable = true,
  scrollerRef // רפרנס לאלמנט שצריך לגלול (ה-Container)
}) => {
  const isDraggingRef = useRef(false);
  const containerRef = useRef(null);
  const scrollTopRef = useRef(scrollTop);
  const autoScrollSpeedRef = useRef(0);
  const animationFrameRef = useRef(null);
  const startItemRef = useRef(null); // הפריט הראשון שנבחר (לבחירת טווח)

  // עדכון שוטף של ה-ScrollTop בלי לגרום לרינדור מחדש של ה-Hook
  useEffect(() => {
    scrollTopRef.current = scrollTop;
  }, [scrollTop]);

  // --- לוגיקת גלילה אוטומטית ---
  const performAutoScroll = useCallback(() => {
    if (autoScrollSpeedRef.current !== 0 && scrollerRef?.current) {
      scrollerRef.current.scrollTop += autoScrollSpeedRef.current;
      animationFrameRef.current = requestAnimationFrame(performAutoScroll);
    } else {
      animationFrameRef.current = null;
    }
  }, [scrollerRef]);

  const updateAutoScroll = useCallback((clientY) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const threshold = 100; // מרחק מהקצה שמתחיל לגלול
    const maxSpeed = 15; // מהירות מקסימלית

    // בדיקה לקצה עליון
    if (clientY - rect.top < threshold) {
      autoScrollSpeedRef.current = -maxSpeed * ((threshold - (clientY - rect.top)) / threshold);
    } 
    // בדיקה לקצה תחתון
    else if (rect.bottom - clientY < threshold) {
      autoScrollSpeedRef.current = maxSpeed * ((threshold - (rect.bottom - clientY)) / threshold);
    } 
    else {
      autoScrollSpeedRef.current = 0;
    }

    // הפעלת הלולאה אם היא לא רצה כבר
    if (autoScrollSpeedRef.current !== 0 && !animationFrameRef.current) {
      performAutoScroll();
    }
  }, [performAutoScroll]);

  // --- לוגיקת איתור פריט ---
  const findItemAtPosition = useCallback((x, clientY) => {
    // חשוב: משתמשים ב-scrollTop העדכני ביותר מה-Ref + הגלילה שקרתה הרגע
    // אם יש גלילה אוטומטית, אנחנו צריכים לקחת בחשבון שה-scrollTop משתנה בזמן אמת
    const currentScrollTop = scrollerRef?.current?.scrollTop ?? scrollTopRef.current;
    
    // חישוב Y אבסולוטי (מיקום בקונטיינר + גלילה)
    // clientY הוא יחסי לחלון, צריך להמיר אותו ליחסי לקונטיינר
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    
    const relativeY = clientY - rect.top;
    const absoluteY = relativeY + currentScrollTop;

    return layout.find(item => {
        if (item.isHeader) return false;
        
        // בדיקת Y
        if (absoluteY < item.top || absoluteY > item.top + item.height) return false;

        // בדיקת X (כולל תמיכה ב-RTL)
        const containerWidth = rect.width;
        let itemLeft, itemRight;

        if (item.left !== undefined) {
           itemLeft = item.left;
           itemRight = item.left + item.width;
        } else { // RTL חישוב משוער אם אין left
           itemLeft = containerWidth - (item.right || 0) - item.width;
           itemRight = containerWidth - (item.right || 0);
        }

        return x >= itemLeft && x <= itemRight;
    });
  }, [layout, scrollerRef]);

  // --- חישוב כל הפריטים בטווח בין שני פריטים ---
  const getItemsInRange = useCallback((startItem, endItem) => {
    if (!startItem || !endItem || startItem.id === endItem.id) {
      return [endItem];
    }

    // מציאת האינדקסים של שני הפריטים
    const startIndex = layout.findIndex(item => item.id === startItem.id);
    const endIndex = layout.findIndex(item => item.id === endItem.id);

    if (startIndex === -1 || endIndex === -1) {
      return [endItem];
    }

    // בחירת כל הפריטים בטווח (לא כולל headers)
    const minIndex = Math.min(startIndex, endIndex);
    const maxIndex = Math.max(startIndex, endIndex);
    const itemsInRange = [];

    for (let i = minIndex; i <= maxIndex; i++) {
      const item = layout[i];
      if (!item.isHeader) {
        itemsInRange.push(item);
      }
    }

    return itemsInRange.length > 0 ? itemsInRange : [endItem];
  }, [layout]);

  // --- טיפול בתנועה ---
  const handleTouchMove = useCallback((e) => {
    if (!isDraggingRef.current || !enable) return;

    // חובה! מונע Pull-to-refresh וגלילת דפדפן
    if (e.cancelable) e.preventDefault();

    const touch = e.touches[0];
    const { clientX, clientY } = touch;
    
    // 1. חישוב גלילה אוטומטית
    updateAutoScroll(clientY);

    // 2. איתור פריט
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clientX - rect.left;

    const currentItem = findItemAtPosition(x, clientY);

    if (currentItem && startItemRef.current) {
      // בחירת כל הפריטים בטווח בין הפריט הראשון לנוכחי
      const itemsInRange = getItemsInRange(startItemRef.current, currentItem);
      const itemIds = itemsInRange.map(item => item.id);
      onSelectionChange(itemIds, false);
    }
  }, [enable, findItemAtPosition, onSelectionChange, updateAutoScroll, getItemsInRange]);

  const handleTouchEnd = useCallback(() => {
    isDraggingRef.current = false;
    startItemRef.current = null;
    autoScrollSpeedRef.current = 0;
    if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
    }
  }, []);

  // פונקציה שנקראת מבחוץ (מהלחיצה הארוכה על הצ'קבוקס)
  const startDrag = useCallback((initialItemId) => {
    isDraggingRef.current = true;
    if (initialItemId) {
        // שמירת הפריט הראשון לבחירת טווח
        const startItem = layout.find(item => item.id === initialItemId && !item.isHeader);
        startItemRef.current = startItem || null;
        onSelectionChange([initialItemId], true);
    }
  }, [onSelectionChange, layout]);

  // הוספת event listeners באופן ידני עם { passive: false } כדי לאפשר preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enable) return;

    // הוספת event listeners עם passive: false
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [handleTouchMove, handleTouchEnd, enable]);

  return {
    containerRef, // לשים על ה-DIV שעוטף את הפריטים
    startDrag,    // להעביר לפריטים להתחלת גרירה
    events: {}    // ריק - האירועים מתווספים באופן ידני ב-useEffect
  };
};

export default useSwipeSelection;
