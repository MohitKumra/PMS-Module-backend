-- CreateTable
CREATE TABLE "NotionConnection" (
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "workspaceName" TEXT,
    "workspaceIcon" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "NotionConnection_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "IntegrationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "itemsCount" INTEGER NOT NULL DEFAULT 0,
    "errorLog" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationLog_userId_source_idx" ON "IntegrationLog"("userId", "source");

-- CreateIndex
CREATE INDEX "IntegrationLog_userId_createdAt_idx" ON "IntegrationLog"("userId", "createdAt");

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "notionPageId" TEXT;

-- AlterTable
ALTER TABLE "Note" ADD COLUMN "notionPageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Task_notionPageId_key" ON "Task"("notionPageId");

-- CreateIndex
CREATE UNIQUE INDEX "Note_notionPageId_key" ON "Note"("notionPageId");

-- AddForeignKey
ALTER TABLE "NotionConnection" ADD CONSTRAINT "NotionConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationLog" ADD CONSTRAINT "IntegrationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;