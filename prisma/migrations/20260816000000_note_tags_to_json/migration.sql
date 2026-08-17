-- Convert Note.tags from a native TEXT[] (Postgres array) to JSONB.
--
-- Prisma scalar-list (array) writes are broken through @prisma/adapter-pg:
-- the query engine emits them as JSON-style literals (e.g. "[]") that Postgres
-- rejects with "malformed array literal: []" (P2007). Storing tags as a Json
-- array avoids that path entirely and matches the existing Note.bookmarks field.

ALTER TABLE "Note" ALTER COLUMN "tags" DROP DEFAULT;

-- to_jsonb(text[]) converts {a,b} -> ["a","b"], migrating existing data losslessly.
ALTER TABLE "Note" ALTER COLUMN "tags" TYPE JSONB USING to_jsonb("tags");

ALTER TABLE "Note" ALTER COLUMN "tags" SET DEFAULT '[]'::jsonb;
