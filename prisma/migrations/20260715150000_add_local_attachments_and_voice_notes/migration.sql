-- Add local media storage fields for tasks, notes, and projects.

ALTER TABLE "Task" ADD COLUMN "voiceNoteUrl" TEXT;

ALTER TABLE "Note" ADD COLUMN "attachmentUrl" TEXT;
ALTER TABLE "Note" ADD COLUMN "voiceNoteUrl" TEXT;

ALTER TABLE "Project" ADD COLUMN "attachmentUrl" TEXT;
ALTER TABLE "Project" ADD COLUMN "voiceNoteUrl" TEXT;
