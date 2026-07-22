-- AlterTable
ALTER TABLE "FocusSession" ADD COLUMN "projectId" TEXT;

-- CreateIndex
CREATE INDEX "FocusSession_projectId_idx" ON "FocusSession"("projectId");
