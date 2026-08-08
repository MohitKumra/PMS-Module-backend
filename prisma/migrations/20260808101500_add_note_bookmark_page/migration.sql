-- Add bookmarkPage column to Note table
ALTER TABLE "Note" 
ADD COLUMN IF NOT EXISTS "bookmarkPage" INTEGER;