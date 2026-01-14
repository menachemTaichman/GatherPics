import React, { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Image as ImageIcon, User } from 'lucide-react';

// Lazy loading configuration: how far before viewport to start loading images
const LAZY_LOAD_ROOT_MARGIN = '500px';

/**
 * Question mark placeholder component for real errors
 */
function QuestionMarkPlaceholder({ 
  width = 200, 
  height = 200, 
  className = "",
  ...props 
}) {
  // Use viewBox for responsive SVG when w-full or h-full is present
  const hasResponsive = className.includes('w-full') || className.includes('h-full');
  const svgDataUrl = hasResponsive 
    ? `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="${Math.min(width, height) * 0.4}" fill="%239ca3af">?</text></svg>`
    : `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="%23e5e7eb"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" font-size="${Math.min(width, height) * 0.4}" fill="%239ca3af">?</text></svg>`;
  
  return (
    <img
      src={svgDataUrl}
      alt="No image available"
      className={className}
      {...props}
    />
  );
}

/**
 * Image icon placeholder component for 204 responses (no representative)
 */
function ImageIconPlaceholder({ 
  width = 200, 
  height = 200, 
  className = "",
  iconType = "image", // "image" or "person"
  ...props 
}) {
  const IconComponent = iconType === "person" ? User : ImageIcon;
  
  // If w-full or h-full is in className, don't use inline styles
  const hasResponsiveWidth = className.includes('w-full');
  const hasResponsiveHeight = className.includes('h-full');
  const style = {};
  if (!hasResponsiveWidth) style.width = width;
  if (!hasResponsiveHeight) style.height = height;
  
  return (
    <div
      className={`flex items-center justify-center bg-gray-200 text-gray-400 rounded-lg ${className}`}
      style={Object.keys(style).length > 0 ? style : undefined}
      {...props}
    >
      <IconComponent size={Math.min(width, height) * 0.6} strokeWidth={1.5} />
    </div>
  );
}

/**
 * Universal hook for handling image loading with automatic placeholder fallback
 * Uses Intersection Observer for true lazy loading - images only load when near viewport
 * @param {string|null} src - Image source URL
 * @param {object} options - Configuration options
 * @returns {object} - { imageSrc, isLoaded, isError, ImageComponent }
 */
export function useImage(src, options = {}) {
  const {
    width = 200,
    height = 200,
    className = '',
    alt = '',
    loading = 'eager',
    onLoad: customOnLoad,
    onError: customOnError,
    iconType = "image", // "image" or "person"
    ...imgProps
  } = options;

  const [isLoaded, setIsLoaded] = useState(false);
  const [isError, setIsError] = useState(false);
  const [isNoContent, setIsNoContent] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const imgRef = useRef(null);
  const observerRef = useRef(null);

  // Reset state when the src changes to avoid stale placeholders persisting
  useEffect(() => {
    setIsLoaded(false);
    setIsError(false);
    setIsNoContent(false);
    setShouldLoad(false);
    // Disconnect old observer
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
  }, [src]);

  // Callback ref to set up observer when element is attached
  const setImgRef = useCallback((element) => {
    imgRef.current = element;
    
    if (!element || !src || shouldLoad) {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      return;
    }

    // For 'eager' loading, load immediately
    if (loading === 'eager') {
      setShouldLoad(true);
      return;
    }

    // Disconnect any existing observer
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    // Create Intersection Observer with rootMargin to start loading slightly before viewport
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            if (observerRef.current) {
              observerRef.current.disconnect();
              observerRef.current = null;
            }
          }
        });
      },
      {
        rootMargin: LAZY_LOAD_ROOT_MARGIN,
        threshold: 0.01
      }
    );

    observerRef.current.observe(element);
  }, [src, shouldLoad, loading]);

  // Cleanup observer when dependencies change
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [src, shouldLoad, loading]);

  const handleLoad = useCallback((e) => {
    setIsLoaded(true);
    setIsError(false);
    setIsNoContent(false);
    if (customOnLoad) customOnLoad(e);
  }, [customOnLoad]);

  const handleError = useCallback((e) => {
    // For representative images, assume 204 (no representative) first
    // This is the most common case and avoids extra network requests
    if (src && src.includes('/representative')) {
      setIsNoContent(true);
      setIsError(false);
    } else {
      // For other images, treat as real error
      setIsError(true);
      setIsNoContent(false);
    }
    
    if (customOnError) customOnError(e);
  }, [customOnError, src]);

  // If no src, return image icon placeholder
  if (!src) {
    return {
      imageSrc: null,
      isLoaded: false,
      isError: false,
      isNoContent: true,
      ImageComponent: () => (
        <ImageIconPlaceholder
          width={width}
          height={height}
          className={className}
          alt={alt}
          iconType={iconType}
        />
      )
    };
  }

  // If 204 No Content (no representative), show image icon
  if (isNoContent) {
    return {
      imageSrc: null,
      isLoaded: false,
      isError: false,
      isNoContent: true,
      ImageComponent: () => (
        <ImageIconPlaceholder
          width={width}
          height={height}
          className={className}
          alt={alt}
          iconType={iconType}
        />
      )
    };
  }

  // If real error occurred, show question mark
  if (isError) {
    return {
      imageSrc: null,
      isLoaded: false,
      isError: true,
      isNoContent: false,
      ImageComponent: () => (
        <QuestionMarkPlaceholder
          width={width}
          height={height}
          className={className}
          alt={alt}
        />
      )
    };
  }

  // Return the actual image component
  // Use data-src instead of src until shouldLoad is true to prevent eager loading
  const { key, ...restImgProps } = imgProps;
  const imageSrc = shouldLoad ? src : undefined;
  
  return {
    imageSrc: shouldLoad ? src : null,
    isLoaded,
    isError: false,
    isNoContent: false,
    ImageComponent: () => (
      <img
        ref={setImgRef}
        key={key}
        data-src={src}
        src={imageSrc}
        alt={alt}
        className={className}
        width={width}
        height={height}
        loading={loading === 'eager' ? 'eager' : 'lazy'}
        onLoad={handleLoad}
        onError={handleError}
        {...restImgProps}
      />
    )
  };
}

/**
 * Simplified hook that just returns the appropriate component
 * @param {string|null} src - Image source URL
 * @param {object} options - Configuration options
 * @returns {React.Component} - Either img element or ImageIconPlaceholder
 */
export function useImageComponent(src, options = {}) {
  const { ImageComponent } = useImage(src, options);
  return <ImageComponent />;
}

/**
 * React component that handles image loading with error fallback
 * This is a proper React component that can manage state for error handling
 * Uses Intersection Observer for true lazy loading
 */
function ImageWithErrorFallback({ src, options = {} }) {
  const [hasError, setHasError] = React.useState(false);
  const [isNoContent, setIsNoContent] = React.useState(false);
  const [shouldLoad, setShouldLoad] = React.useState(false);
  const imgRef = React.useRef(null);
  const observerRef = React.useRef(null);
  const timeoutRef = React.useRef(null);
  
  const {
    width = 200,
    height = 200,
    className = '',
    alt = '',
    loading = 'eager', //'lazy',
    onError: propOnError,
    iconType = "image", // "image" or "person"
    ...imgProps
  } = options;

  // Reset states when src changes
  React.useEffect(() => {
    setHasError(false);
    setIsNoContent(false);
    setShouldLoad(false);
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [src]);

  // Callback ref to set up observer when element is attached
  const setImgRef = React.useCallback((element) => {
    imgRef.current = element;
    
    if (!element || !src || shouldLoad) {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      return;
    }

    // For 'eager' loading, load immediately
    if (loading === 'eager') {
      setShouldLoad(true);
      return;
    }

    // Disconnect any existing observer
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    // Helper function to check if element is in viewport
    const checkIfInViewport = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const rootMarginValue = parseInt(LAZY_LOAD_ROOT_MARGIN);
      return (
        rect.top < window.innerHeight + rootMarginValue &&
        rect.bottom > -rootMarginValue &&
        rect.left < window.innerWidth + rootMarginValue &&
        rect.right > -rootMarginValue
      );
    };
    
    // Check immediately if element is already in viewport
    if (checkIfInViewport(element)) {
      setShouldLoad(true);
      return;
    }
    
    // Create Intersection Observer with rootMargin to start loading slightly before viewport
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            if (observerRef.current) {
              observerRef.current.disconnect();
              observerRef.current = null;
            }
          }
        });
      },
      {
        rootMargin: LAZY_LOAD_ROOT_MARGIN,
        threshold: 0.01
      }
    );

    observerRef.current.observe(element);
    
    // Also check after a short delay in case the observer doesn't fire immediately
    // This handles edge cases where elements are in viewport but observer hasn't fired yet
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      // Use a function to get current state
      setShouldLoad((currentShouldLoad) => {
        if (!currentShouldLoad && imgRef.current && checkIfInViewport(imgRef.current)) {
          if (observerRef.current) {
            observerRef.current.disconnect();
            observerRef.current = null;
          }
          return true;
        }
        return currentShouldLoad;
      });
    }, 100);
  }, [src, shouldLoad, loading]);

  // Cleanup observer when dependencies change
  React.useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [src, shouldLoad, loading]);

  // If no src, show image icon (no representative)
  if (!src) {
    return (
      <ImageIconPlaceholder
        width={width}
        height={height}
        className={className}
        alt={alt}
        iconType={iconType}
      />
    );
  }

  // If 204 No Content (no representative), show image icon
  if (isNoContent) {
    return (
      <ImageIconPlaceholder
        width={width}
        height={height}
        className={className}
        alt={alt}
        iconType={iconType}
      />
    );
  }

  // If real error occurred, show question mark
  if (hasError) {
    return (
      <QuestionMarkPlaceholder
        width={width}
        height={height}
        className={className}
        alt={alt}
      />
    );
  }

  // Extract key prop to avoid spread warning
  const { key, ...restImgProps } = imgProps;

  // Handle image load errors
  const handleError = (e) => {
    // Prevent infinite loop
    e.target.onerror = null;
    
    // Call custom error handler if provided
    if (propOnError) {
      propOnError(e);
    }
    
    // For representative images, assume 204 (no representative) first
    // This is the most common case and avoids extra network requests
    if (src && src.includes('/representative')) {
      setIsNoContent(true);
      setHasError(false);
    } else {
      // For other images, treat as real error
      setHasError(true);
      setIsNoContent(false);
    }
  };

  // Return the actual image component
  // Use data-src instead of src until shouldLoad is true to prevent eager loading
  const imageSrc = shouldLoad ? src : undefined;

  return (
    <img
      ref={setImgRef}
      key={key}
      data-src={src}
      src={imageSrc}
      alt={alt}
      className={className}
      width={width}
      height={height}
      loading={loading === 'eager' ? 'eager' : 'lazy'}
      onError={handleError}
      {...restImgProps}
    />
  );
}

/**
 * Non-hook version for use in loops and conditional rendering
 * @param {string|null} src - Image source URL
 * @param {object} options - Configuration options
 * @returns {React.Component} - Either img element or ImageIconPlaceholder
 */
export function ImageComponent(src, options = {}) {
  return <ImageWithErrorFallback src={src} options={options} />;
}

// Export placeholder components for backward compatibility
export { ImageIconPlaceholder, QuestionMarkPlaceholder };



