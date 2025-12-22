import { useRef, useEffect, useCallback } from 'react';

export default function usePinchToZoom(imageSize, setImageSize, options = {}) {
  const { minSize = 0.25, maxSize = 3.0, sensitivity = 1.0 } = options;
  
  const gridContainerRef = useRef(null);
  
  // משתנים למגע (Touch)
  const pinchStartDistanceRef = useRef(null);
  
  // משתנים ל-Trackpad (Wheel)
  const isWheelingRef = useRef(false);
  const wheelTimeoutRef = useRef(null);

  const startSizeRef = useRef(imageSize);
  const currentVisualScaleRef = useRef(1);
  const setImageSizeRef = useRef(setImageSize);

  // עדכון רפרנסים
  useEffect(() => { setImageSizeRef.current = setImageSize; }, [setImageSize]);
  useEffect(() => { startSizeRef.current = imageSize; }, [imageSize]);

  // --- פונקציית עזר לניקוי אגרסיבי (משותפת לכולם) ---
  const forceResetVisualZoom = useCallback(() => {
    const container = gridContainerRef.current;
    if (container) {
       container.style.transition = 'none';
       container.style.setProperty('--grid-scale', '1');
       container.style.setProperty('--grid-z-index', '1');
       requestAnimationFrame(() => {
           if(container) container.style.transition = '';
       });
       
       pinchStartDistanceRef.current = null;
       isWheelingRef.current = false;
       currentVisualScaleRef.current = 1;
    }
  }, []);

  // --- רשת ביטחון ---
  useEffect(() => {
    if (pinchStartDistanceRef.current === null && !isWheelingRef.current) {
      requestAnimationFrame(forceResetVisualZoom);
    }
  }, [imageSize, forceResetVisualZoom]);

  
  // ==========================================
  // Lógica de TOUCH (כבר עובד, השארתי ללא שינוי מהותי)
  // ==========================================
  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 2) {
      const container = gridContainerRef.current;
      if (!container) return;

      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistanceRef.current = Math.sqrt(dx * dx + dy * dy);
      
      startSizeRef.current = imageSize; // חשוב: לוקחים גודל עדכני
      container.style.setProperty('--grid-scale', '1');
      container.style.setProperty('--grid-z-index', '10');
      
      if (e.cancelable) { e.preventDefault(); e.stopPropagation(); }
    }
  }, [imageSize]);

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 2 && pinchStartDistanceRef.current !== null) {
      const container = gridContainerRef.current;
      if (!container) return;
      if (e.cancelable) { e.preventDefault(); e.stopPropagation(); }

      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDistance = Math.sqrt(dx * dx + dy * dy);

      const scale = currentDistance / pinchStartDistanceRef.current;
      
      updateVisualZoom(scale); // פונקציה משותפת שיצרתי למטה
    }
  }, [minSize, maxSize]); // הנחתי שפונקציית העדכון משתמשת בהם

  const handleTouchEnd = useCallback((e) => {
    if (e.touches.length < 2 && pinchStartDistanceRef.current !== null) {
       applyZoom(); // פונקציה משותפת לסיום
    }
  }, []);


  // ==========================================
  // Lógica de TRACKPAD / WHEEL
  // ==========================================
  const handleWheel = useCallback((e) => {
    // בודקים אם זה Pinch ב-Trackpad (דפדפנים שולחים ctrlKey ב-Pinch)
    if (e.ctrlKey) {
      const container = gridContainerRef.current;
      if (!container) return;

      e.preventDefault(); // מונע זום של כל הדפדפן

      // התחלת זום אם לא התחלנו
      if (!isWheelingRef.current) {
        isWheelingRef.current = true;
        startSizeRef.current = imageSize; // מתחילים מהגודל הנוכחי
        container.style.setProperty('--grid-z-index', '10');
        currentVisualScaleRef.current = 1;
      }

      // חישוב הסקייל החדש על בסיס הדלתא של הגלגלת
      // e.deltaY שלילי = זום אין, חיובי = זום אאוט
      // המקדם 0.01 הוא הרגישות, אפשר לשחק איתו
      const zoomFactor = 1 - e.deltaY * 0.01; 
      
      // מכפילים את הסקייל הויזואלי הנוכחי בפקטור החדש
      const newVisualScale = currentVisualScaleRef.current * zoomFactor;
      
      // מעדכנים ויזואלית (משתמשים בפונקציה המשותפת אבל עם לוגיקה קצת שונה כי כאן זה מצטבר)
      let targetSize = startSizeRef.current * newVisualScale;
      targetSize = Math.max(minSize * 0.9, Math.min(maxSize * 1.1, targetSize));
      const finalVisualScale = targetSize / startSizeRef.current;
      
      currentVisualScaleRef.current = finalVisualScale;
      
      requestAnimationFrame(() => {
          if (container) container.style.setProperty('--grid-scale', finalVisualScale);
      });

      // זיהוי סיום הגלילה (Debounce)
      // מכיוון שאירוע wheel לא נותן "end", אנחנו מניחים שאם עברו 150ms בלי אירוע, זה נגמר
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
      
      wheelTimeoutRef.current = setTimeout(() => {
        isWheelingRef.current = false;
        applyZoom(); // מבצעים את העדכון ל-State
      }, 150);
    }
  }, [imageSize, minSize, maxSize]);


  // ==========================================
  // פונקציות עזר משותפות (DRY)
  // ==========================================
  
  // עדכון ויזואלי בזמן אמת (עבור Touch)
  const updateVisualZoom = (scale) => {
      const container = gridContainerRef.current;
      if (!container) return;

      let targetSize = startSizeRef.current * scale;
      targetSize = Math.max(minSize * 0.9, Math.min(maxSize * 1.1, targetSize)); 
      const visualScale = targetSize / startSizeRef.current;
      currentVisualScaleRef.current = visualScale;

      requestAnimationFrame(() => {
         container.style.setProperty('--grid-scale', visualScale);
      });
  };

  // החלת הזום הסופי ל-State
  const applyZoom = () => {
      const finalScale = currentVisualScaleRef.current;
      let newSize = startSizeRef.current * finalScale;
      newSize = Math.max(minSize, Math.min(maxSize, newSize));

      forceResetVisualZoom(); // איפוס ויזואלי

      if (Math.abs(newSize - startSizeRef.current) > 0.1) {
          setImageSizeRef.current(newSize);
      }
  };


  // ==========================================
  // חיבור Event Listeners
  // ==========================================
  // Helper function to attach listeners - called both from useEffect and from ref callback
  const attachListeners = useCallback(() => {
    const container = gridContainerRef.current;
    if (!container) {
      return null;
    }
    
    // אתחול ערכים התחלתיים
    container.style.setProperty('--grid-scale', '1');
    container.style.setProperty('--grid-z-index', '1');

    const opts = { passive: false };

    container.addEventListener('touchstart', handleTouchStart, opts);
    container.addEventListener('touchmove', handleTouchMove, opts);
    container.addEventListener('touchend', handleTouchEnd, opts);
    container.addEventListener('touchcancel', handleTouchEnd, opts);
    
    // מאזין ל-Wheel בשביל Trackpad
    container.addEventListener('wheel', handleWheel, opts);
    
    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      container.removeEventListener('wheel', handleWheel);
      
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, handleWheel]);

  // Store cleanup function
  const cleanupRef = useRef(null);

  useEffect(() => {
    const container = gridContainerRef.current;
    
    // Clean up previous listeners if any
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    
    // Attach listeners if container is available
    if (container) {
      cleanupRef.current = attachListeners();
    }

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [attachListeners]);

  return useCallback((node) => {
     // Clean up previous listeners if container changed or being removed
     if (cleanupRef.current) {
       cleanupRef.current();
       cleanupRef.current = null;
     }
     
     gridContainerRef.current = node;
     
     // אתחול גם כאן למקרה של Remount
     if (node) {
         node.style.setProperty('--grid-scale', '1');
         node.style.setProperty('--grid-z-index', '1');
         
         // Attach listeners immediately when ref is set
         const cleanup = attachListeners();
         if (cleanup) {
           cleanupRef.current = cleanup;
         }
     }
  }, [imageSize, attachListeners]);
}