-- Enhance Note model with isPinned, mood, tags, archived fields

-- Add new columns to Note table
ALTER TABLE "Note" 
ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Note" 
ADD COLUMN IF NOT EXISTS "mood" TEXT;

ALTER TABLE "Note" 
ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "Note" 
ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false;

-- Create indexes for new query patterns
CREATE INDEX IF NOT EXISTS "Note_userId_isJournal_idx" ON "Note"("userId", "isJournal");
CREATE INDEX IF NOT EXISTS "Note_userId_isPinned_idx" ON "Note"("userId", "isPinned");
CREATE INDEX IF NOT EXISTS "Note_userId_archived_idx" ON "Note"("userId", "archived");
CREATE INDEX IF NOT EXISTS "Note_userId_createdAt_idx" ON "Note"("userId", "createdAt");