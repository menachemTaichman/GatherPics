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
      // נעילים את ה-Tooltip אחרי 1.5 שניות אוטומטית
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

  // בדיקה אם הכפתור צריך להיות full width
  const isFullWidth = className.includes('w-full');
  
  // בדיקה אם הכפתור משתמש ב-flex classes (כמו flex-1, flex-grow, וכו')
  // וחילוץ כל ה-flex classes מה-className
  const flexClassRegex = /\b(flex-(?:1|auto|none|grow|shrink|basis-[\w-]+))\b/g;
  const flexClasses = className.match(flexClassRegex) || [];
  const hasFlexClasses = flexClasses.length > 0;
  const flexClass = flexClasses.join(' ');
  
  // בדיקה אם הכפתור הוא fixed-size (יש לו width ו-height classes ספציפיים)
  // נחפש classes כמו w-*, h-* אבל לא w-full
  const fixedSizeRegex = /\b([wh]-\[\d+\w+\]|[wh]-0|[wh]-px|[wh]-0\.5|[wh]-1|[wh]-1\.5|[wh]-2|[wh]-2\.5|[wh]-3|[wh]-3\.5|[wh]-4|[wh]-5|[wh]-6|[wh]-7|[wh]-8|[wh]-9|[wh]-10|[wh]-11|[wh]-12|[wh]-14|[wh]-16|[wh]-20|[wh]-24|[wh]-28|[wh]-32|[wh]-36|[wh]-40|[wh]-44|[wh]-48|[wh]-52|[wh]-56|[wh]-60|[wh]-64|[wh]-72|[wh]-80|[wh]-96)\b/g;
  const hasFixedSize = !isFullWidth && fixedSizeRegex.test(className);
  
  // חילוץ width ו-height classes כדי לשמור עליהם ב-wrapper אם נדרש
  const widthMatch = className.match(/\bw-(\d+|\[\d+\w+\]|0|px|0\.5|1\.5|2\.5|3\.5|full)\b/);
  const heightMatch = className.match(/\bh-(\d+|\[\d+\w+\]|0|px|0\.5|1\.5|2\.5|3\.5|full)\b/);
  const extractedWidth = widthMatch ? widthMatch[0] : null;
  const extractedHeight = heightMatch ? heightMatch[0] : null;
  
  // הסרת ה-flex classes מה-button className (כי הם יעברו ל-wrapper)
  // והוספת w-full לכפתור כדי שימלא את ה-wrapper
  let buttonClassName = hasFlexClasses
    ? className.replace(flexClassRegex, '').replace(/\s+/g, ' ').trim()
    : className;
  
  // אם יש flex classes, נוסיף w-full לכפתור כדי שימלא את ה-wrapper
  if (hasFlexClasses && !buttonClassName.includes('w-full')) {
    buttonClassName = `${buttonClassName} w-full`.trim();
  }
  
  // אם הכפתור הוא בגודל קבוע ושווה (w-X h-X עם אותו X), נוסיף aspect-square כדי להבטיח שהוא מרובע
  if (hasFixedSize && extractedWidth && extractedHeight) {
    // בדיקה אם הרוחב והגובה זהים (למשל w-8 h-8)
    const widthValue = extractedWidth.replace('w-', '');
    const heightValue = extractedHeight.replace('h-', '');
    if (widthValue === heightValue && !buttonClassName.includes('aspect-square')) {
      buttonClassName = `${buttonClassName} aspect-square`.trim();
    }
  }

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
  // אם הכפתור הוא w-full, גם ה-wrapper צריך להיות w-full
  // אם הכפתור משתמש ב-flex classes, ה-wrapper צריך להיות block ולהכיל את ה-flex classes
  // אם הכפתור הוא fixed-size, ה-wrapper צריך להיות inline-block כדי לשמור על הגדלים
  // ואנחנו נוסיף min-w-0 ו-min-h-0 כדי למנוע התרחבות מעבר לגדלים המוגדרים
  let wrapperClassName;
  if (isFullWidth) {
    wrapperClassName = `relative block w-full touch-none ${flexClass}`.trim();
  } else if (hasFlexClasses) {
    wrapperClassName = `relative block touch-none ${flexClass}`.trim();
  } else if (hasFixedSize) {
    // עבור כפתורים בגודל קבוע, נשתמש ב-inline-block כדי לשמור על הגדלים
    // ונוודא שהכפתור ישמור על יחס גובה-רוחב של 1:1 (מרובע)
    wrapperClassName = "relative inline-block touch-none";
  } else {
    wrapperClassName = "relative inline-block touch-none";
  }
  
  return (
    <div className={wrapperClassName}> {/* wrapper div */}
      
      {/* הכפתור עצמו */}
      <button
        ref={combinedRef}
        {...bind()} // מחבר את אירועי הלחיצה הארוכה
        onClick={handleClick}
        className={buttonClassName}
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
