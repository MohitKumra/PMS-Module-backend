// backend/src/services/notes.service.ts
// Notes CRUD — supports both regular notes and journal entries (isJournal flag).

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { deleteStoredFile } from '../lib/fileStorage';
import type { NoteDTO, CreateNoteRequest, UpdateNoteRequest } from '../types';

function normalizeMediaUrl(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toDTO(n: {
  id: string; userId: string; title: string | null; content: string;
  isJournal: boolean; taskId: string | null; projectId: string | null; createdAt: Date; updatedAt: Date;
  attachmentUrl: string | null; voiceNoteUrl: string | null;
}): NoteDTO {
  return {
    id: n.id, userId: n.userId, title: n.title, content: n.content,
    isJournal: n.isJournal,
    taskId: n.taskId,
    projectId: n.projectId,
    attachmentUrl: n.attachmentUrl,
    voiceNoteUrl: n.voiceNoteUrl,
    createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString(),
  };
}

export async function listNotes(userId: string, filters?: {
  isJournal?: boolean;
  taskId?: string;
  projectId?: string;
}): Promise<{ data: NoteDTO[]; meta: { total: number } }> {
  const where: Record<string, unknown> = { userId };
  if (filters?.isJournal !== undefined) where.isJournal = filters.isJournal;
  if (filters?.taskId) where.taskId = filters.taskId;
  if (filters?.projectId) where.projectId = filters.projectId;
  const [notes, total] = await Promise.all([
    prisma.note.findMany({ where, orderBy: { updatedAt: 'desc' } }),
    prisma.note.count({ where }),
  ]);
  return { data: notes.map(toDTO), meta: { total } };
}

export async function getNote(userId: string, noteId: string): Promise<NoteDTO> {
  const note = await prisma.note.findFirst({ where: { id: noteId, userId } });
  if (!note) throw createError(404, 'NOTE_NOT_FOUND', 'Note not found');
  return toDTO(note);
}

export async function createNote(userId: string, data: CreateNoteRequest): Promise<NoteDTO> {
  if (data.taskId) {
    const task = await prisma.task.findFirst({ where: { id: data.taskId, userId } });
    if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  }
  if (data.projectId) {
    const project = await prisma.project.findFirst({ where: { id: data.projectId, userId } });
    if (!project) throw createError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  const note = await prisma.note.create({
    data: {
      userId,
    title: data.title ?? null,
    content: data.content,
    isJournal: data.isJournal ?? false,
    taskId: data.taskId ?? null,
    projectId: data.projectId ?? null,
    attachmentUrl: normalizeMediaUrl(data.attachmentUrl),
    voiceNoteUrl: normalizeMediaUrl(data.voiceNoteUrl),
  },
  });
  return toDTO(note);
}

export async function updateNote(userId: string, noteId: string, data: UpdateNoteRequest): Promise<NoteDTO> {
  const existing = await prisma.note.findFirst({ where: { id: noteId, userId } });
  if (!existing) throw createError(404, 'NOTE_NOT_FOUND', 'Note not found');
  if (data.taskId !== undefined && data.taskId !== null) {
    const task = await prisma.task.findFirst({ where: { id: data.taskId, userId } });
    if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  }
  if (data.projectId !== undefined && data.projectId !== null) {
    const project = await prisma.project.findFirst({ where: { id: data.projectId, userId } });
    if (!project) throw createError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  const previousAttachmentUrl = existing.attachmentUrl;
  const previousVoiceNoteUrl = existing.voiceNoteUrl;
  const note = await prisma.note.update({
    where: { id: noteId },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.content !== undefined && { content: data.content }),
      ...(data.isJournal !== undefined && { isJournal: data.isJournal }),
      ...(data.taskId !== undefined && { taskId: data.taskId }),
      ...(data.projectId !== undefined && { projectId: data.projectId }),
      ...(data.attachmentUrl !== undefined && { attachmentUrl: normalizeMediaUrl(data.attachmentUrl) }),
      ...(data.voiceNoteUrl !== undefined && { voiceNoteUrl: normalizeMediaUrl(data.voiceNoteUrl) }),
    },
  });
  if (data.attachmentUrl !== undefined && data.attachmentUrl !== previousAttachmentUrl) {
    await deleteStoredFile(previousAttachmentUrl);
  }
  if (data.voiceNoteUrl !== undefined && data.voiceNoteUrl !== previousVoiceNoteUrl) {
    await deleteStoredFile(previousVoiceNoteUrl);
  }
  return toDTO(note);
}

export async function deleteNote(userId: string, noteId: string): Promise<void> {
  const existing = await prisma.note.findFirst({ where: { id: noteId, userId } });
  if (!existing) throw createError(404, 'NOTE_NOT_FOUND', 'Note not found');
  await deleteStoredFile(existing.attachmentUrl);
  await deleteStoredFile(existing.voiceNoteUrl);
  await prisma.note.delete({ where: { id: noteId } });
}
