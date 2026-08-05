-- Drop manualProgress column from Goal — progress is now fully dynamic.
ALTER TABLE "Goal" DROP COLUMN "manualProgress";