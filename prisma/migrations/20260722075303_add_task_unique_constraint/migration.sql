/*
  Warnings:

  - A unique constraint covering the columns `[parentTaskId,dueDate]` on the table `Task` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Task_parentTaskId_dueDate_key" ON "Task"("parentTaskId", "dueDate");
