-- Migration: Convert bookmarks from Int[] to Json (Bookmark objects)
-- This migration preserves existing bookmark data by converting page numbers to full bookmark objects
-- Run this manually before generating the Prisma migration

-- Step 1: Add a temporary Json column
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "bookmarks_json" JSONB DEFAULT '[]';

-- Step 2: Migrate existing Int[] bookmarks to Json format with full bookmark structure
-- Convert each page number to a bookmark object with id, pageNumber, color (default yellow), and createdAt
UPDATE "Note"
SET "bookmarks_json" = (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', 'bm_' || extract(epoch from NOW())::text || '_' || generate_series::text,
        'pageNumber', bookmark_page,
        'color', 'yellow',
        'createdAt', NOW()::text
      )
    ),
    '[]'::jsonb
  )
  FROM unnest(bookmarks) WITH ORDINALITY AS t(bookmark_page, generate_series)
)
WHERE array_length(bookmarks, 1) > 0;

-- Step 3: Drop the old bookmarks column
ALTER TABLE "Note" DROP COLUMN IF EXISTS "bookmarks";

-- Step 4: Rename the new column to bookmarks
ALTER TABLE "Note" RENAME COLUMN "bookmarks_json" TO "bookmarks";

-- Step 5: Ensure default value
ALTER TABLE "Note" ALTER COLUMN "bookmarks" SET DEFAULT '[]'::jsonb;
