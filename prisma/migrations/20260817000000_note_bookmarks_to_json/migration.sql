-- Convert Note.bookmarks from PostgreSQL INTEGER[] to JSONB.
-- Existing arrays are converted losslessly:
-- {1,2,5} -> [1,2,5]

ALTER TABLE "Note"
ALTER COLUMN "bookmarks" DROP DEFAULT;

ALTER TABLE "Note"
ALTER COLUMN "bookmarks"
TYPE JSONB
USING to_jsonb("bookmarks");

ALTER TABLE "Note"
ALTER COLUMN "bookmarks"
SET DEFAULT '[]'::jsonb;