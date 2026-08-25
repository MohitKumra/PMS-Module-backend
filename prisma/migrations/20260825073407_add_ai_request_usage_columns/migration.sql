-- AlterTable
ALTER TABLE "AIPreference" ADD COLUMN     "aiRequestsThisMonth" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "aiRequestsTotal" INTEGER NOT NULL DEFAULT 0;
