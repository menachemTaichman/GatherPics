# API Restructuring and Security Improvements

## Overview

The API has been restructured to address security concerns and provide a more consistent, event-scoped architecture. This document outlines the changes and their benefits.

## Key Changes

### 1. Event-Scoped API Design

**Before (Inconsistent):**
- `/api/photos/<image_id>/complete` - Direct access without event context
- `/api/groups` - No event scope
- `/api/moments` - No event scope
- `/api/images.json` - No event scope

**After (Consistent):**
- `/api/events/<event_id>/photos/<image_id>/complete` - Properly scoped
- `/api/events/<event_id>/groups` - Event-scoped
- `/api/events/<event_id>/moments` - Event-scoped
- `/api/events/<event_id>/images.json` - Event-scoped

### 2. Security Improvements

**Before (Security Issues):**
- Direct photo access: `/api/photos/<image_id>/complete` was accessible to anyone with the image ID
- No event validation - could access photos from any event
- Hardcoded profile ID with no real authentication

**After (Secure):**
- All endpoints require event ID validation
- Event ID must match the authenticated user's event
- Proper access control through profile permissions
- Event-scoped image serving with permission checks

### 3. New API Structure

#### Event-Scoped Endpoints

**Groups:**
- `GET /api/events/<event_id>/groups` - List groups
- `GET /api/events/<event_id>/groups/<group_id>` - Get specific group
- `PUT /api/events/<event_id>/groups/<group_id>` - Update group
- `DELETE /api/events/<event_id>/groups/<group_id>` - Delete group
- `POST /api/events/<event_id>/groups/check-name` - Check name conflicts
- `POST /api/events/<event_id>/groups/transfer-faces` - Transfer faces between groups

**Moments:**
- `GET /api/events/<event_id>/moments` - List moments
- `GET /api/events/<event_id>/moments/<moment_id>` - Get specific moment
- `POST /api/events/<event_id>/moments` - Create moment
- `PUT /api/events/<event_id>/moments/<moment_id>` - Update moment
- `DELETE /api/events/<event_id>/moments/<moment_id>` - Delete moment

**Photos:**
- `GET /api/events/<event_id>/photos/<image_id>/complete` - Get complete photo data
- `GET /api/events/<event_id>/photos/<image_id>/info` - Get basic photo info
- `GET /api/events/<event_id>/photos/<image_id>/faces` - Get faces in photo

**Image Files:**
- `GET /api/events/<event_id>/display/<image_id>.webp` - Display image
- `GET /api/events/<event_id>/thumb/<image_id>.webp` - Thumbnail
- `GET /api/events/<event_id>/high_quality/<image_id>.webp` - High quality
- `GET /api/events/<event_id>/original/<image_id>.webp` - Original image
- `GET /api/events/<event_id>/faces/<face_id>.webp` - Face crop

**Other:**
- `GET /api/events/<event_id>/profile/permissions` - Get user permissions
- `POST /api/events/<event_id>/download` - Download images as ZIP
- `GET /api/events/<event_id>/images.json` - Get all images metadata

### 4. Security Features

#### Event Validation
```python
@app.route("/api/events/<event_id>/photos/<image_id>/complete", methods=["GET"])
@require_auth
def get_photo_complete(event_id, image_id):
    event = get_event_with_profile()
    if str(event.event_id) != event_id:
        return not_found(f"Event {event_id} not found or not accessible")
    # ... rest of function
```

#### Profile-Based Access Control
```python
@app.route('/api/events/<event_id>/display/<image_id>.webp')
@require_auth
def get_display_image_webp(event_id, image_id):
    event = Event(event_id)
    profile_id = g.profile_id
    if image_id not in event.profile_model.get_accessible_images(profile_id):
        return abort(403)  # Forbidden - user doesn't have access to this image
    # ... serve image
```

### 5. Backward Compatibility

Legacy endpoints are maintained for backward compatibility but should be deprecated:

- `/api/groups` → `/api/events/<event_id>/groups`
- `/api/photos/<image_id>/complete` → `/api/events/<event_id>/photos/<image_id>/complete`
- `/api/images.json` → `/api/events/<event_id>/images.json`

## Benefits

### 1. Security
- **No more direct photo access** - all photos must be accessed through event context
- **Event isolation** - users can only access photos from their authorized events
- **Profile-based permissions** - proper access control based on user profile

### 2. Scalability
- **Multi-event support** - API structure supports multiple events
- **Clear resource hierarchy** - events → groups/moments/photos
- **Consistent URL patterns** - easier to understand and maintain

### 3. Maintainability
- **Consistent API design** - all endpoints follow the same pattern
- **Clear separation of concerns** - event-scoped operations
- **Better error handling** - specific error messages for different failure cases

## Future Authentication Implementation

When implementing real authentication:

1. **Replace `@require_auth` decorator** with proper JWT/session validation
2. **Validate event access** - check if user has permission to access the specified event
3. **Profile permissions** - use real profile data instead of hardcoded values
4. **Rate limiting** - add rate limiting per user/profile
5. **Audit logging** - log all API access for security monitoring

## Migration Guide

### Frontend Changes Required

1. **Update API calls** to include event ID:
   ```javascript
   // Before
   fetch('/api/photos/123/complete')
   
   // After
   fetch('/api/events/75cb6635-879d-4386-b023-366444dc0fb2/photos/123/complete')
   ```

2. **Update image URLs** to use event-scoped endpoints:
   ```javascript
   // Before
   imageUrl: `/api/photos/${imageId}/display`
   
   // After
   imageUrl: `/api/events/${eventId}/display/${imageId}.webp`
   ```

3. **Add event ID context** to all API calls:
   ```javascript
   const eventId = '75cb6635-879d-4386-b023-366444dc0fb2';
   
   // Use in all API calls
   const groups = await apiService.getGroups(eventId);
   const moments = await apiService.getMoments(eventId);
   ```

### Backend Changes Required

1. **Update models** to support event-scoped operations
2. **Implement proper profile permissions** system
3. **Add event validation** to all endpoints
4. **Update database queries** to filter by event ID

## Testing

Test the new security by:

1. **Accessing photos directly** - should return 404 for invalid event IDs
2. **Cross-event access** - should be denied
3. **Unauthenticated access** - should return 401/403
4. **Profile permissions** - should respect user access levels

## Conclusion

This restructuring provides a solid foundation for:
- **Multi-tenant architecture** with proper event isolation
- **Real authentication** implementation
- **Scalable API design** that's easy to maintain
- **Security best practices** for photo sharing applications

The new structure ensures that users can only access photos they're authorized to see, while maintaining a clean and consistent API design.
