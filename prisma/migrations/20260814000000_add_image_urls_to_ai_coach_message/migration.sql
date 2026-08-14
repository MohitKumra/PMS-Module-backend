-- Add imageUrls column to AICoachMessage
-- This column was added to the Prisma schema but the migration was never created.

ALTER TABLE "AICoachMessage" ADD COLUMN "imageUrls" TEXT;
