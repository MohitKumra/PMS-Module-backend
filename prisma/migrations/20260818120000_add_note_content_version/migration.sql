-- Optimistic concurrency token for journal/note content updates.
-- Stale save requests must not overwrite a newer complete document.
ALTER TABLE "Note"
ADD COLUMN IF NOT EXISTS "contentVersion" INTEGER NOT NULL DEFAULT 1;
