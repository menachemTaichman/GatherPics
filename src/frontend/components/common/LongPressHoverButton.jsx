import React, { useState, forwardRef, useRef, useEffect } from 'react';
import { useLongPress } from 'use-long-press';
import { createPortal } from 'react-dom';

/**
 * כפתור עם tooltip על לחיצה ארוכה במובייל
 * מציג tooltip ויזואלי על לחיצה ארוכה, ומבחין בין לחיצה קצרה (onClick) ללחיצה ארוכה (tooltip)
 */
export const LongPressHoverButton = forwardRef(function LongPressHoverButton({ children, onClick, title, className = '', 'aria-label': ariaLabel, ...props }, ref) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef(null);
  const tooltipRef = useRef(null);
  
  // משתמש ב-title או aria-label מה-props
  const tooltipText = title || ariaLabel || '';

  // שילוב refs
  const combinedRef = (node) => {
    buttonRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  };

  // בדיקה אם הכפתור הוא absolute positioned
  const isAbsolute = className.includes('absolute');

  // חישוב מיקום tooltip
  useEffect(() => {
    if (showTooltip && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setTooltipPosition({
        top: rect.top - 8, // מעל הכפתור
        left: rect.left + rect.width / 2, // מרכז הכפתור
      });
    }
  }, [showTooltip]);

  // הגדרת הלוגיקה של לחיצה ארוכה
  const bind = useLongPress(() => {
    // זה קורה כשהלחיצה הארוכה הסתיימה בהצלחה
    if (tooltipText) {
      setShowTooltip(true);
      // נעלים את ה-Tooltip אחרי 1.5 שניות אוטומטית
      setTimeout(() => setShowTooltip(false), 1500);
    }
  }, {
    // הגדרות חשובות:
    onStart: () => {}, 
    onFinish: () => {}, 
    onCancel: () => setShowTooltip(false), // אם הוא הזיז את האצבע
    threshold: 500, // זמן לחיצה במילישניות
    captureEvent: true,
    cancelOnMovement: true, // חובה! מבטל אם גוללים
    detect: 'touch', // עובד רק במגע (לא משפיע על דסקטופ)
  });

  // פונקציה שמטפלת בלחיצה רגילה
  const handleClick = (e) => {
    // אם ה-Tooltip מוצג כרגע, סימן שזו הייתה לחיצה ארוכה - אל תפעיל את הפעולה
    if (showTooltip) {
      setShowTooltip(false);
      return;
    }
    
    // אחרת, תפעיל את הפעולה הרגילה
    if (onClick) onClick(e);
  };

  // אם הכפתור הוא absolute, לא עוטפים ב-div נוסף
  if (isAbsolute) {
    return (
      <>
        <button
          ref={combinedRef}
          {...bind()} // מחבר את אירועי הלחיצה הארוכה
          onClick={handleClick}
          className={className}
          onContextMenu={(e) => e.preventDefault()} // חובה! מונע תפריט מערכת בלחיצה ארוכה
          aria-label={tooltipText}
          {...props}
        >
          {children}
        </button>

        {/* Tooltip דרך portal כדי לא להיחתך */}
        {showTooltip && tooltipText && createPortal(
          <div
            ref={tooltipRef}
            className="fixed px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg z-[10000] whitespace-nowrap pointer-events-none fade-in"
            style={{
              top: `${tooltipPosition.top}px`,
              left: `${tooltipPosition.left}px`,
              transform: 'translate(-50%, -100%)',
              marginBottom: '4px'
            }}
          >
            {tooltipText}
            {/* חץ קטן למטה */}
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
          </div>,
          document.body
        )}
      </>
    );
  }

  // עבור כפתורים רגילים - עוטפים ב-div, אבל tooltip דרך portal
  return (
    <div className="relative inline-block touch-none"> {/* wrapper div */}
      
      {/* הכפתור עצמו */}
      <button
        ref={combinedRef}
        {...bind()} // מחבר את אירועי הלחיצה הארוכה
        onClick={handleClick}
        className={className}
        onContextMenu={(e) => e.preventDefault()} // חובה! מונע תפריט מערכת בלחיצה ארוכה
        aria-label={tooltipText}
        {...props}
      >
        {children}
      </button>

      {/* Tooltip דרך portal כדי לא להיחתך על ידי overflow */}
      {showTooltip && tooltipText && createPortal(
        <div
          ref={tooltipRef}
          className="fixed px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg z-[10000] whitespace-nowrap pointer-events-none fade-in"
          style={{
            top: `${tooltipPosition.top}px`,
            left: `${tooltipPosition.left}px`,
            transform: 'translate(-50%, -100%)',
            marginBottom: '4px'
          }}
        >
          {tooltipText}
          {/* חץ קטן למטה */}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
        </div>,
        document.body
      )}
    </div>
  );
});
