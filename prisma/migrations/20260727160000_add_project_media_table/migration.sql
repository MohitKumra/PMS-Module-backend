-- CreateTable: ProjectMedia (store multiple attachments and voice notes per project)
CREATE TABLE "ProjectMedia" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectMedia_projectId_idx" ON "ProjectMedia"("projectId");
CREATE INDEX "ProjectMedia_projectId_type_idx" ON "ProjectMedia"("projectId", "type");

-- AddForeignKey
ALTER TABLE "ProjectMedia" ADD CONSTRAINT "ProjectMedia_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;