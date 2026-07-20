/*
  Warnings:

  - You are about to drop the `Message` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TaskComment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TaskDependency` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_userId_fkey";

-- DropForeignKey
ALTER TABLE "TaskComment" DROP CONSTRAINT "TaskComment_taskId_fkey";

-- DropForeignKey
ALTER TABLE "TaskComment" DROP CONSTRAINT "TaskComment_userId_fkey";

-- DropForeignKey
ALTER TABLE "TaskDependency" DROP CONSTRAINT "TaskDependency_dependsOnTaskId_fkey";

-- DropForeignKey
ALTER TABLE "TaskDependency" DROP CONSTRAINT "TaskDependency_taskId_fkey";

-- AlterTable
ALTER TABLE "TaskTimeEntry" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- DropTable
DROP TABLE "Message";

-- DropTable
DROP TABLE "TaskComment";

-- DropTable
DROP TABLE "TaskDependency";

-- DropEnum
DROP TYPE "TaskDependencyType";

-- CreateTable
CREATE TABLE "FocusTimeLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FocusTimeLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "FocusTimeLog" ADD CONSTRAINT "FocusTimeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
