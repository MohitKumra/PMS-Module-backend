-- AlterTable
ALTER TABLE "Habit" ADD COLUMN "reminderMessage" TEXT;
ALTER TABLE "Habit" ADD COLUMN "durationDays" INTEGER;
ALTER TABLE "Habit" ADD COLUMN "skipDays" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Habit" ADD COLUMN "streakBrokenAt" TIMESTAMP(3);
