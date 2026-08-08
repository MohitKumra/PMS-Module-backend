# Avatar Deletion Fix Summary

## Problem Identified

Profile pictures were accumulating in the `uploads/avatars/` folder without being deleted when users changed their avatars. The investigation revealed the root cause:

**The Issue:** Avatar URLs in the database were stored as **full URLs** (e.g., `http://localhost:3001/uploads/avatars/user-id/file.png`), but the `deleteStoredFile` function was only checking for **relative paths** starting with `/uploads/`.

This mismatch caused the deletion logic to silently fail every time, leaving old avatar files on the server.

## Files Modified

### 1. `backend/src/lib/fileStorage.ts`

**Changed:** The `deleteStoredFile` function now handles both URL formats:

```typescript
export async function deleteStoredFile(publicPath?: string | null): Promise<void> {
  if (!publicPath) return;

  // Handle both full URLs and relative paths
  let pathToDelete = publicPath;

  // If it's a full URL, extract just the path portion
  if (publicPath.startsWith('http://') || publicPath.startsWith('https://')) {
    try {
      const url = new URL(publicPath);
      pathToDelete = url.pathname; // Extracts /uploads/... from http://localhost:3001/uploads/...
    } catch (error) {
      return; // Invalid URL format
    }
  }

  if (!pathToDelete.startsWith('/uploads/')) return;

  // ... rest of deletion logic
}
```

**What it does:**

- Accepts both `http://localhost:3001/uploads/avatars/...` and `/uploads/avatars/...`
- Extracts the pathname from full URLs using the URL API
- Maintains all existing security checks
- Silently handles invalid URLs without blocking the operation

### 2. `backend/src/controllers/users.controller.ts`

**No changes needed.** The existing logic was already correct:

1. Upload new avatar
2. Update database with new URL
3. Delete old avatar file

The issue was in the deletion function itself, not in how it was called.

### 3. `backend/src/services/google.service.ts`

**Reverted changes.** Google OAuth doesn't need avatar cleanup since:

- Google profile pictures are external URLs (not local files)
- They're hosted by Google, not stored in our uploads folder
- The deletion function already handles external URLs correctly (skips them)

## Testing the Fix

### Before Fix

```
GET users from database:
- avatarUrl: "http://localhost:3001/uploads/avatars/user-id/old-file.png"

User uploads new avatar:
- New file created: "http://localhost:3001/uploads/avatars/user-id/new-file.png"
- deleteStoredFile("http://localhost:3001/uploads/avatars/user-id/old-file.png")
  → Checks if path starts with '/uploads/' → FALSE (it starts with 'http')
  → Returns early, file NOT deleted ❌

Result: Both old-file.png and new-file.png exist on disk
```

### After Fix

```
User uploads new avatar:
- New file created: "http://localhost:3001/uploads/avatars/user-id/new-file.png"
- deleteStoredFile("http://localhost:3001/uploads/avatars/user-id/old-file.png")
  → Detects it's a full URL
  → Extracts pathname: "/uploads/avatars/user-id/old-file.png"
  → Checks if path starts with '/uploads/' → TRUE
  → Deletes the file ✅

Result: Only new-file.png exists on disk, old-file.png is deleted
```

## Cleanup Script

A cleanup script is provided to remove existing orphaned files:

```bash
# See what would be deleted (safe, read-only)
npx tsx scripts/cleanup-orphaned-avatars.ts

# Actually delete orphaned files
npx tsx scripts/cleanup-orphaned-avatars.ts --execute
```

## How to Verify the Fix Works

1. **Start the backend server**
2. **Upload a profile picture** for a user
3. **Upload a different profile picture** for the same user
4. **Check the uploads folder:**
   ```bash
   cd backend
   dir uploads\avatars\{user-id}\
   ```
5. **You should see only ONE file** (the latest avatar)

## Impact

- ✅ Old avatar files are now automatically deleted
- ✅ No manual cleanup needed for future uploads
- ✅ Existing orphaned files can be cleaned up with the script
- ✅ Works with both relative paths and full URLs
- ✅ Maintains all existing security checks
- ✅ Backward compatible with existing code

## Additional Notes

### Why were URLs stored as full URLs?

Looking at `storeBase64File` in `fileStorage.ts`:

```typescript
return {
  url: `${env.BACKEND_URL}${publicPath}`, // Constructs full URL
};
```

The function was designed to return full URLs for use in the frontend, which makes sense for API responses. The deletion function just needed to be updated to handle this format.

### Why not change the storage format?

Changing the URL format would require:

1. Database migration to update all existing URLs
2. API changes that might break the frontend
3. More extensive testing

The fix to `deleteStoredFile` is simpler, safer, and handles both formats for maximum compatibility.
