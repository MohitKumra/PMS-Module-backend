-- CreateTable: TaskMedia (store multiple attachments and voice notes per task)
CREATE TABLE "TaskMedia" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskMedia_taskId_idx" ON "TaskMedia"("taskId");
CREATE INDEX "TaskMedia_taskId_type_idx" ON "TaskMedia"("taskId", "type");

-- AddForeignKey
ALTER TABLE "TaskMedia" ADD CONSTRAINT "TaskMedia_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;