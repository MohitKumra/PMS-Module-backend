// backend/src/services/notes.service.ts
// Notes CRUD — supports both regular notes and journal entries (isJournal flag).

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import type { NoteDTO, CreateNoteRequest, UpdateNoteRequest } from '../types';

function toDTO(n: {
  id: string; userId: string; title: string | null; content: string;
  isJournal: boolean; createdAt: Date; updatedAt: Date;
}): NoteDTO {
  return {
    id: n.id, userId: n.userId, title: n.title, content: n.content,
    isJournal: n.isJournal,
    createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString(),
  };
}

export async function listNotes(userId: string, isJournal?: boolean): Promise<{ data: NoteDTO[]; meta: { total: number } }> {
  const where: Record<string, unknown> = { userId };
  if (isJournal !== undefined) where.isJournal = isJournal;
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
  const note = await prisma.note.create({
    data: { userId, title: data.title ?? null, content: data.content, isJournal: data.isJournal ?? false },
  });
  return toDTO(note);
}

export async function updateNote(userId: string, noteId: string, data: UpdateNoteRequest): Promise<NoteDTO> {
  const existing = await prisma.note.findFirst({ where: { id: noteId, userId } });
  if (!existing) throw createError(404, 'NOTE_NOT_FOUND', 'Note not found');
  const note = await prisma.note.update({
    where: { id: noteId },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.content !== undefined && { content: data.content }),
      ...(data.isJournal !== undefined && { isJournal: data.isJournal }),
    },
  });
  return toDTO(note);
}

export async function deleteNote(userId: string, noteId: string): Promise<void> {
  const existing = await prisma.note.findFirst({ where: { id: noteId, userId } });
  if (!existing) throw createError(404, 'NOTE_NOT_FOUND', 'Note not found');
  await prisma.note.delete({ where: { id: noteId } });
}
