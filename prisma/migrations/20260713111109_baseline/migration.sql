-- AlterTable
ALTER TABLE "FocusSession" ADD COLUMN     "isBreak" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taskId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "inProgressAt" TIMESTAMP(3);
