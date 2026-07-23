-- Add lifecycle fields to FocusSession
ALTER TABLE "FocusSession" ADD COLUMN "elapsedMin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FocusSession" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS';
ALTER TABLE "FocusSession" ADD COLUMN "completedAt" TIMESTAMPTZ;

-- Backfill existing data
-- Sessions with completed=true become COMPLETED, with elapsedMin = durationMin
UPDATE "FocusSession" SET "status" = 'COMPLETED', "elapsedMin" = "durationMin", "completedAt" = "startedAt" + ("durationMin" * interval '1 minute') WHERE "completed" = true;
-- Sessions with completed=false become CANCELLED
UPDATE "FocusSession" SET "status" = 'CANCELLED' WHERE "completed" = false;

-- Create index for status-based queries
CREATE INDEX IF NOT EXISTS "FocusSession_userId_status_idx" ON "FocusSession"("userId", "status");