# Avatar File Management

## Overview

Profile pictures (avatars) are now automatically cleaned up when users update or remove them. This prevents orphaned files from accumulating on the server and wasting storage space.

## The Problem That Was Fixed

Previously, the system stored avatar URLs as **full URLs** (e.g., `http://localhost:3001/uploads/avatars/user-id/file.png`), but the deletion function only handled **relative paths** (e.g., `/uploads/avatars/user-id/file.png`). This mismatch meant old avatar files were never being deleted, causing them to pile up on the server.

## The Solution

The `deleteStoredFile` function in `backend/src/lib/fileStorage.ts` now handles both URL formats:
- Full URLs: `http://localhost:3001/uploads/avatars/...` or `https://domain.com/uploads/avatars/...`
- Relative paths: `/uploads/avatars/...`

When a full URL is provided, the function extracts just the pathname portion before attempting deletion.

## How It Works

### Automatic Cleanup

The system automatically deletes old avatar files in the following scenarios:

1. **Manual Avatar Upload** (`POST /users/me/avatar`)
   - When a user uploads a new profile picture, the old one is automatically deleted
   - Implemented in: `backend/src/controllers/users.controller.ts`

2. **Avatar Removal** (`DELETE /users/me/avatar`)
   - When a user removes their avatar, the file is deleted from storage
   - Implemented in: `backend/src/controllers/users.controller.ts`

### File Deletion Logic

- Works with both full URLs (`http://...`) and relative paths (`/uploads/...`)
- Only files stored in `/uploads/avatars/` are deleted
- External URLs (like Google profile pictures) are never deleted
- Deletion is "best-effort" and won't block the operation if it fails
- File deletion happens after the database is updated to ensure data consistency
- Security check ensures files outside the uploads directory cannot be deleted

## Cleanup Script

A cleanup script is provided to remove any orphaned avatar files that may have accumulated before this feature was implemented.

### Usage

```bash
# Dry run (shows what would be deleted without actually deleting)
npx tsx scripts/cleanup-orphaned-avatars.ts

# Actually delete orphaned files
npx tsx scripts/cleanup-orphaned-avatars.ts --execute
```

### What the Script Does

1. Scans all avatar files in the `uploads/avatars/` directory
2. Queries the database for all referenced avatar URLs
3. Identifies orphaned files (files that exist but aren't referenced by any user)
4. Reports statistics and lists orphaned files
5. Optionally deletes orphaned files (when `--execute` flag is used)

### Example Output

```
🔍 Scanning for orphaned avatar files...

📊 Statistics:
   Total avatar files: 45
   Referenced by users: 23
   Orphaned files: 22

🗑️  Orphaned files to be deleted:
   - /uploads/avatars/user123/1234567890-profile-abc123.jpg (152.34 KB)
   - /uploads/avatars/user456/1234567891-avatar-def456.png (203.12 KB)
   ...

📈 Summary:
   Would delete: 22 files
   Would free up: 4.82 MB

💡 Run with --execute flag to actually delete these files.
```

## Storage Structure

Avatars are stored in the following structure:

```
uploads/
└── avatars/
    └── {userId}/
        └── {timestamp}-{sanitized-name}-{uuid}.{ext}
```

Example:
```
uploads/avatars/user-123-abc/1720000000000-profile-picture-a1b2c3d4.jpg
```

## Technical Details

### Safe Deletion

The `deleteStoredFile` function in `backend/src/lib/fileStorage.ts` includes safety checks:

- Validates the path starts with `/uploads/`
- Ensures the resolved path is within the uploads directory (prevents path traversal)
- Silently fails if the file doesn't exist (idempotent)
- Uses best-effort deletion that won't throw errors

### Error Handling

- Upload failures roll back without affecting existing avatars
- Database update failures leave the new file orphaned (can be cleaned up later)
- Deletion failures leave the old file orphaned (can be cleaned up later)
- The system prioritizes data consistency over perfect cleanup

## Maintenance

### Regular Cleanup

Consider running the cleanup script periodically (e.g., monthly) to ensure optimal storage usage:

```bash
# Add to cron job or scheduled task
npx tsx scripts/cleanup-orphaned-avatars.ts --execute
```

### Monitoring Storage

To check avatar storage usage:

```bash
# Linux/Mac
du -sh uploads/avatars/

# Windows PowerShell
Get-ChildItem -Path uploads\avatars -Recurse | Measure-Object -Property Length -Sum
```

## Future Improvements

Potential enhancements for consideration:

1. **Scheduled Background Job**: Automatically run cleanup periodically
2. **Storage Quotas**: Limit avatar file size per user
3. **Image Optimization**: Compress avatars server-side to save space
4. **CDN Integration**: Move avatars to cloud storage (S3, Cloudinary, etc.)
5. **Soft Delete**: Keep files for a grace period before permanent deletion

## Related Files

- `backend/src/controllers/users.controller.ts` - Manual avatar upload/removal
- `backend/src/services/google.service.ts` - Google OAuth avatar updates
- `backend/src/lib/fileStorage.ts` - File storage utilities
- `backend/scripts/cleanup-orphaned-avatars.ts` - Cleanup script
