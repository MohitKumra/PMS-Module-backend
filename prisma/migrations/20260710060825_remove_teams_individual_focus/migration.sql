/*
  Warnings:

  - The values [DELIVERED] on the enum `MessageStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [DIRECT,TEAM] on the enum `MessageType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `attachments` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `recipientId` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `senderId` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `teamId` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `createdBy` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `teamId` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `assignedBy` on the `ProjectTask` table. All the data in the column will be lost.
  - You are about to drop the column `assignedTo` on the `ProjectTask` table. All the data in the column will be lost.
  - You are about to drop the `ProjectMember` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Team` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TeamMember` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[taskId]` on the table `ProjectTask` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userId` to the `Message` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Project` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "MessageStatus_new" AS ENUM ('SENT', 'READ');
ALTER TABLE "public"."Message" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Message" ALTER COLUMN "status" TYPE "MessageStatus_new" USING ("status"::text::"MessageStatus_new");
ALTER TYPE "MessageStatus" RENAME TO "MessageStatus_old";
ALTER TYPE "MessageStatus_new" RENAME TO "MessageStatus";
DROP TYPE "public"."MessageStatus_old";
ALTER TABLE "Message" ALTER COLUMN "status" SET DEFAULT 'SENT';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "MessageType_new" AS ENUM ('SYSTEM', 'PROJECT', 'REMINDER', 'ACHIEVEMENT');
ALTER TABLE "public"."Message" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Message" ALTER COLUMN "type" TYPE "MessageType_new" USING ("type"::text::"MessageType_new");
ALTER TYPE "MessageType" RENAME TO "MessageType_old";
ALTER TYPE "MessageType_new" RENAME TO "MessageType";
DROP TYPE "public"."MessageType_old";
ALTER TABLE "Message" ALTER COLUMN "type" SET DEFAULT 'SYSTEM';
COMMIT;

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_recipientId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_senderId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_teamId_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_teamId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectMember" DROP CONSTRAINT "ProjectMember_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectMember" DROP CONSTRAINT "ProjectMember_userId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectTask" DROP CONSTRAINT "ProjectTask_assignedTo_fkey";

-- DropForeignKey
ALTER TABLE "Team" DROP CONSTRAINT "Team_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "TeamMember" DROP CONSTRAINT "TeamMember_teamId_fkey";

-- DropForeignKey
ALTER TABLE "TeamMember" DROP CONSTRAINT "TeamMember_userId_fkey";

-- DropIndex
DROP INDEX "Message_recipientId_idx";

-- DropIndex
DROP INDEX "Message_senderId_idx";

-- DropIndex
DROP INDEX "Message_teamId_idx";

-- DropIndex
DROP INDEX "Project_createdBy_idx";

-- DropIndex
DROP INDEX "Project_teamId_idx";

-- DropIndex
DROP INDEX "ProjectTask_assignedTo_idx";

-- DropIndex
DROP INDEX "ProjectTask_projectId_taskId_key";

-- AlterTable
ALTER TABLE "Message" DROP COLUMN "attachments",
DROP COLUMN "recipientId",
DROP COLUMN "senderId",
DROP COLUMN "teamId",
ADD COLUMN     "actionUrl" TEXT,
ADD COLUMN     "priority" TEXT DEFAULT 'NORMAL',
ADD COLUMN     "userId" TEXT NOT NULL,
ALTER COLUMN "type" SET DEFAULT 'SYSTEM';

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "createdBy",
DROP COLUMN "teamId",
ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ProjectTask" DROP COLUMN "assignedBy",
DROP COLUMN "assignedTo",
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "ProjectMember";

-- DropTable
DROP TABLE "Team";

-- DropTable
DROP TABLE "TeamMember";

-- DropEnum
DROP TYPE "ProjectMemberRole";

-- CreateIndex
CREATE INDEX "Message_userId_idx" ON "Message"("userId");

-- CreateIndex
CREATE INDEX "Message_status_idx" ON "Message"("status");

-- CreateIndex
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTask_taskId_key" ON "ProjectTask"("taskId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
