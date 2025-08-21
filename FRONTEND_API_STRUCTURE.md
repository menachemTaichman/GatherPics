# Frontend API Structure - Best Practices

## Overview

The frontend has been restructured to use a centralized API service that eliminates redundancy and provides a clean, maintainable architecture.

## New Structure

### 1. Centralized Configuration (`apiService.js`)

**Before (Problematic):**
```javascript
// In each component (redundant!)
const FIXED_EVENT_ID = "75cb6635-879d-4386-b023-366444dc0fb2";
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';
```

**After (Centralized):**
```javascript
// In apiService.js only
const FIXED_EVENT_ID = "75cb6635-879d-4386-b023-366444dc0fb2";
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

// Export for components that need them
export { FIXED_EVENT_ID, API_BASE };
```

### 2. URL Construction Helpers

**New: Centralized URL helpers**
```javascript
export const urlHelpers = {
  // Full URLs (with API_BASE)
  getDisplayImageUrl: (imageId) => `${API_BASE}/api/events/${FIXED_EVENT_ID}/display/${imageId}.webp`,
  getThumbnailUrl: (imageId) => `${API_BASE}/api/events/${FIXED_EVENT_ID}/thumb/${imageId}.webp`,
  getFaceCropUrl: (faceId) => `${API_BASE}/api/events/${FIXED_EVENT_ID}/faces/${faceId}.webp`,
  
  // Relative URLs (without API_BASE)
  getRelativeDisplayUrl: (imageId) => `/api/events/${FIXED_EVENT_ID}/display/${imageId}.webp`,
  getRelativeThumbnailUrl: (imageId) => `/api/events/${FIXED_EVENT_ID}/thumb/${imageId}.webp`,
  getRelativeFaceCropUrl: (faceId) => `/api/events/${FIXED_EVENT_ID}/faces/${faceId}.webp`,
};
```

### 3. API Functions

**All API calls now include event ID:**
```javascript
// Before
const groups = await groupsAPI.getAll();

// After
const groups = await groupsAPI.getAll(); // Uses default FIXED_EVENT_ID
const groups = await groupsAPI.getAll(customEventId); // Or pass custom event ID
```

## How Components Should Use This

### ✅ **Correct Usage**

```javascript
import { 
  groupsAPI, 
  momentsAPI, 
  urlHelpers, 
  FIXED_EVENT_ID 
} from '../utils/apiService';

export default function MyComponent() {
  // 1. API calls - no need to handle URLs
  const fetchGroups = async () => {
    const groups = await groupsAPI.getAll();
    // ...
  };

  // 2. Image URLs - use helpers
  const imageUrl = urlHelpers.getDisplayImageUrl(imageId);
  const faceUrl = urlHelpers.getFaceCropUrl(faceId);
  
  // 3. Constants - import if needed
  const eventId = FIXED_EVENT_ID;
  
  return (
    <img src={imageUrl} alt="Display" />
  );
}
```

### ❌ **Incorrect Usage (Don't Do This)**

```javascript
// DON'T: Define constants locally
const FIXED_EVENT_ID = "75cb6635-879d-4386-b023-366444dc0fb2";
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

// DON'T: Construct URLs manually
const imageUrl = `${API_BASE}/api/events/${FIXED_EVENT_ID}/display/${imageId}.webp`;

// DON'T: Make direct fetch calls
const response = await fetch('/api/groups');
```

## Benefits of New Structure

### 1. **No More Redundancy**
- Single source of truth for `FIXED_EVENT_ID`
- Single source of truth for `API_BASE`
- Centralized URL construction

### 2. **Easy to Change**
- Change event ID in one place
- Change API base in one place
- Update URL patterns in one place

### 3. **Consistent URLs**
- All components use the same URL format
- No more typos in URL construction
- Easy to debug URL issues

### 4. **Better Testing**
- Mock the entire `apiService` module
- Test URL construction separately
- Easier to test API interactions

## Migration Guide

### Step 1: Update Imports
```javascript
// Before
import { groupsAPI } from '../utils/apiService';

// After
import { groupsAPI, urlHelpers, FIXED_EVENT_ID } from '../utils/apiService';
```

### Step 2: Remove Local Constants
```javascript
// Before
const FIXED_EVENT_ID = "75cb6635-879d-4386-b023-366444dc0fb2";
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

// After
// Remove these lines - import from apiService instead
```

### Step 3: Use URL Helpers
```javascript
// Before
const imageUrl = `${API_BASE}/api/events/${FIXED_EVENT_ID}/display/${imageId}.webp`;

// After
const imageUrl = urlHelpers.getDisplayImageUrl(imageId);
```

### Step 4: Update API Calls
```javascript
// Before
const response = await fetch('/api/groups');

// After
const groups = await groupsAPI.getAll();
```

## Environment Configuration

### Development
```bash
# .env.local
VITE_API_BASE=http://localhost:5000
```

### Production
```bash
# .env.production
VITE_API_BASE=https://your-api-domain.com
```

### Component Usage
```javascript
// Components don't need to know about environment
// Just use the helpers
const imageUrl = urlHelpers.getDisplayImageUrl(imageId);
```

## Future Improvements

### 1. **Dynamic Event IDs**
```javascript
// When you support multiple events
const eventId = useCurrentEvent(); // From context/store
const groups = await groupsAPI.getAll(eventId);
```

### 2. **Type Safety**
```typescript
// Add TypeScript for better API contracts
interface Group {
  groupID: string;
  label: string;
  // ...
}

export const groupsAPI = {
  getAll: async (eventId?: string): Promise<Group[]> => { /* ... */ }
};
```

### 3. **Caching Layer**
```javascript
// Add caching to API calls
export const groupsAPI = {
  getAll: async (eventId = FIXED_EVENT_ID) => {
    const cacheKey = `groups_${eventId}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    
    const response = await api.get(`/api/events/${eventId}/groups`);
    cache.set(cacheKey, response.data);
    return response.data;
  }
};
```

## Conclusion

This new structure provides:
- **Single source of truth** for all API-related configuration
- **Consistent URL construction** across all components
- **Easy maintenance** when API changes are needed
- **Better testing** capabilities
- **Cleaner component code** with less duplication

Components should focus on their UI logic and use the centralized API service for all data operations and URL construction.
