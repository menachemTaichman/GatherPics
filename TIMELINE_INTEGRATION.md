# Timeline URL Management System

This document explains how to use the new timeline URL management system that replaces the complex scroll handling in the Moments component.

## Overview

The new system provides clean, predictable URL management for timeline pages with two distinct behaviors:

1. **Scroll-based updates**: Uses `history.replaceState` (no history entry)
2. **Click-based navigation**: Uses `history.pushState` (creates history entry)

## Key Benefits

- **Clean URLs**: `/timeline/moment-id` instead of `/timeline?name=moment-name`
- **No conflicts**: Programmatic scrolling doesn't interfere with automatic URL updates
- **Performance**: Uses Intersection Observer instead of scroll event listeners
- **Maintainable**: Centralized logic in a single utility class
- **Flexible**: Easy to customize anchor points and behavior

## Files

- `src/frontend/utils/timeline.js` - The main timeline manager utility
- `src/frontend/components/Moments.jsx` - Updated to use the timeline manager
- `timeline-integration-example.html` - Standalone HTML demo
- `TIMELINE_INTEGRATION.md` - This documentation

## How It Works

### 1. Initialization

```javascript
import timelineManager from '../utils/timeline';

// In your component
useEffect(() => {
  timelineManager.init('/timeline', '.sticky.top-16');
  
  return () => {
    timelineManager.destroy();
  };
}, []);
```

### 2. Registering Moments

```javascript
// Use the setMomentRef callback to register moment elements
const setMomentRef = useCallback((momentId) => (element) => {
  if (element) {
    timelineManager.registerMoment(momentId, element);
  } else {
    timelineManager.unregisterMoment(momentId);
  }
}, []);

// In your JSX
<MomentCard ref={setMomentRef(moment.momentID)} />
```

### 3. Navigation

```javascript
// Navigate to a specific moment (creates history entry)
timelineManager.navigateToMoment(momentId, momentName);

// The timeline manager automatically handles:
// - URL updates
// - Smooth scrolling
// - Conflict prevention
```

## URL Format

- **Base timeline**: `/timeline`
- **Specific moment**: `/timeline/moment-id`
- **Example**: `/timeline/98ff7b08-bdbe-4b15-9637-290e24a58a7c`

## Integration with React Router

The system works seamlessly with React Router. Add a route for the new format:

```jsx
<Route path="/timeline" element={<Moments />} />
<Route path="/timeline/:momentId" element={<Moments />} />
```

## Carousel Integration

Update your carousel click handlers to use the timeline manager:

```javascript
onClick={() => {
  timelineManager.navigateToMoment(moment.momentID, moment.label);
}}
```

## Jump to Moment Buttons

Update your "Jump to Moment" buttons to use the new URL format:

```javascript
// In PhotoViewer.jsx
const handleJumpToMoment = () => {
  if (momentInfo && onJumpToMoment) {
    onJumpToMoment(momentInfo);
  } else if (momentInfo) {
    navigate(`/timeline/${momentInfo.id}`);
  }
};

// In FaceDetail.jsx
const handleJumpToMoment = (momentInfo) => {
  navigate(`/timeline/${momentInfo.id}`);
};
```

## How the Timeline Manager Works

### Scroll Detection

1. **Intersection Observer**: Monitors which moment elements are visible
2. **Anchor Point**: Calculates the optimal viewing position (header + carousel height)
3. **Best Match**: Finds the moment closest to the anchor point
4. **URL Update**: Uses `history.replaceState` to update URL without history entry

### Navigation

1. **Programmatic Flag**: Sets `isProgrammaticScroll = true` to prevent conflicts
2. **URL Update**: Uses `history.pushState` to create history entry
3. **Smooth Scroll**: Scrolls to the target moment
4. **Flag Reset**: Re-enables scroll detection after 1 second

### Conflict Prevention

- **Scroll Listener**: Only updates URL when not in programmatic mode
- **Timing**: Uses timeouts to prevent immediate conflicts
- **State Tracking**: Maintains clear separation between user scroll and programmatic scroll

## Customization

### Anchor Point

```javascript
// Customize the anchor point calculation
timelineManager.init('/timeline', '.my-custom-header');
```

### Scroll Behavior

```javascript
// Modify scroll behavior in the timeline manager
scrollToElement(element) {
  // Custom scroll logic here
}
```

### URL Format

```javascript
// Change URL format in the timeline manager
updateURLFromScroll(momentId) {
  const newURL = `${this.basePath}/section/${momentId}`;
  // ... rest of the logic
}
```

## Troubleshooting

### URL Not Updating

1. Check that moments are properly registered with `registerMoment()`
2. Verify the anchor selector matches your DOM structure
3. Ensure the timeline manager is initialized

### Scrolling Not Working

1. Check that moment elements have the correct `data-moment-id` attributes
2. Verify that the anchor offset calculation is correct
3. Check console for any error messages

### Conflicts Between Scroll and Click

1. The timeline manager automatically prevents conflicts
2. If issues persist, check the `isProgrammaticScroll` flag timing
3. Ensure proper cleanup in component unmount

## Performance Considerations

- **Intersection Observer**: Much more efficient than scroll event listeners
- **Debouncing**: Built-in conflict prevention reduces unnecessary updates
- **Memory Management**: Proper cleanup prevents memory leaks
- **DOM Queries**: Cached element references for better performance

## Browser Compatibility

- **Intersection Observer**: Modern browsers (IE 11+ with polyfill)
- **History API**: All modern browsers
- **Smooth Scrolling**: Most modern browsers support `behavior: 'smooth'`

## Migration from Old System

The old system used:
- Complex scroll event listeners
- Manual navigation flags
- Query parameters (`?name=moment-name`)
- Brittle ref management

The new system provides:
- Clean Intersection Observer
- Automatic conflict prevention
- Path-based URLs (`/moment-id`)
- Robust element registration

## Example Usage

See `timeline-integration-example.html` for a complete working example that demonstrates all the features of the timeline manager.
