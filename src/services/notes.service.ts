// backend/src/services/notes.service.ts
// Notes CRUD — supports both regular notes and journal entries (isJournal flag).
// Enhanced with: pagination, search, date-range, sort, tags, mood, pinning, archive.

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { deleteStoredFile } from '../lib/fileStorage';
import type { NoteDTO, CreateNoteRequest, UpdateNoteRequest, NoteListFilters } from '../types';
import type { Prisma } from '@prisma/client';

function normalizeMediaUrl(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Convert raw Prisma Note row to API DTO. */
export function toNoteDTO(n: any): NoteDTO {
  return {
    id: n.id,
    userId: n.userId,
    title: n.title,
    content: n.content,
    isJournal: n.isJournal,
    taskId: n.taskId,
    projectId: n.projectId,
    attachmentUrl: n.attachmentUrl,
    voiceNoteUrl: n.voiceNoteUrl,
    isPinned: n.isPinned ?? false,
    mood: n.mood ?? null,
    tags: n.tags ?? [],
    archived: n.archived ?? false,
    bookmarkPage: n.bookmarkPage ?? null,
    bookmarks: Array.isArray(n.bookmarks) ? n.bookmarks : [],
    contentVersion: typeof n.contentVersion === 'number' ? n.contentVersion : 1,
    createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : n.createdAt,
    updatedAt: n.updatedAt instanceof Date ? n.updatedAt.toISOString() : n.updatedAt,
  };
}

export async function listNotes(
  userId: string,
  filters?: NoteListFilters
): Promise<{ data: NoteDTO[]; meta: { total: number; page: number; totalPages: number } }> {
  const where: Prisma.NoteWhereInput = { userId };

  // Note type filter
  if (filters?.isJournal !== undefined) {
    where.isJournal = filters.isJournal;
  }
  if (filters?.taskId) {
    where.taskId = filters.taskId;
  }
  if (filters?.projectId) {
    where.projectId = filters.projectId;
  }

  // Search across title + content
  if (filters?.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { content: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  // Tag filter (match any) — tags is a Json array, so use JSON containment.
  // For a top-level JSON array, target the root with `path: ['$']` and check containment.
  if (filters?.tags && filters.tags.length > 0) {
    const existingOr = Array.isArray(where.OR) ? where.OR : where.OR ? [where.OR] : [];
    where.OR = [...existingOr, ...filters.tags.map((t) => ({ tags: { path: ['$'], array_contains: [t] } }))];
  }

  // Mood filter
  if (filters?.mood) {
    where.mood = filters.mood;
  }

  // Date range filter
  const dateField = filters?.sortField === 'createdAt' ? 'createdAt' : 'updatedAt';
  if (filters?.dateFrom) {
    where[dateField] = { ...((where[dateField] as object) || {}), gte: new Date(filters.dateFrom) };
  }
  if (filters?.dateTo) {
    where[dateField] = { ...((where[dateField] as object) || {}), lte: new Date(filters.dateTo) };
  }

  // Archive filter — default: exclude archived
  if (filters?.archived === true) {
    where.archived = true;
  } else if (filters?.archived !== undefined) {
    where.archived = false;
  } else {
    where.archived = false; // default: hide archived
  }

  // Pinned filter
  if (filters?.isPinned !== undefined) {
    where.isPinned = filters.isPinned;
  }

  // Attachment / voice-note filter (has any media)
  if (filters?.hasAttachment) {
    where.OR = [
      ...(where.OR ? (Array.isArray(where.OR) ? where.OR : [where.OR]) : []),
      { attachmentUrl: { not: null } },
      { voiceNoteUrl: { not: null } },
    ];
  }

  // Sort
  const sortField = filters?.sortField || 'updatedAt';
  const sortOrder = filters?.sortOrder || 'desc';
  const orderBy: Prisma.NoteOrderByWithRelationInput = { [sortField]: sortOrder };

  // Pagination
  const page = Math.max(filters?.page || 1, 1);
  const limit = Math.min(Math.max(filters?.limit || 20, 1), 100);
  const skip = (page - 1) * limit;

  const [notes, total] = await Promise.all([
    prisma.note.findMany({
      where,
      orderBy,
      skip,
      take: limit,
    }),
    prisma.note.count({ where }),
  ]);

  return {
    data: notes.map(toNoteDTO),
    meta: {
      total,
      page,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getNote(userId: string, noteId: string): Promise<NoteDTO> {
  const note = await prisma.note.findFirst({ where: { id: noteId, userId } });
  if (!note) throw createError(404, 'NOTE_NOT_FOUND', 'Note not found');
  return toNoteDTO(note);
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
      mood: data.mood ?? null,
      // Only write tags when non-empty; otherwise omit so the DB column default
      // ('[]'::jsonb, or '{}' for a legacy TEXT[] column) applies. This avoids
      // sending an empty JS array that the pg driver adapter can mis-serialize
      // (P2007 "malformed array literal: []").
      ...(Array.isArray(data.tags) && data.tags.length > 0 ? { tags: data.tags } : {}),
      bookmarkPage: data.bookmarkPage ?? null,
    },
  });
  return toNoteDTO(note);
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

  const currentVersion = typeof existing.contentVersion === 'number' ? existing.contentVersion : 1;
  // Optimistic concurrency: a stale save must not replace a newer complete document.
  if (data.content !== undefined && data.contentVersion !== undefined && data.contentVersion !== currentVersion) {
    throw createError(
      409,
      'STALE_CONTENT',
      'A newer version of this journal has already been saved. Your local document was not overwritten.'
    );
  }

  const previousAttachmentUrl = existing.attachmentUrl;
  const previousVoiceNoteUrl = existing.voiceNoteUrl;
  const nextVersion = data.content !== undefined ? currentVersion + 1 : currentVersion;

  const note = await prisma.note.update({
    where: { id: noteId },
    data: {
      ...(data.title !== undefined && { title: data.title ?? null }),
      ...(data.content !== undefined && { content: data.content, contentVersion: nextVersion }),
      ...(data.isJournal !== undefined && { isJournal: data.isJournal }),
      ...(data.taskId !== undefined && { taskId: data.taskId ?? null }),
      ...(data.projectId !== undefined && { projectId: data.projectId ?? null }),
      ...(data.attachmentUrl !== undefined && { attachmentUrl: normalizeMediaUrl(data.attachmentUrl) }),
      ...(data.voiceNoteUrl !== undefined && { voiceNoteUrl: normalizeMediaUrl(data.voiceNoteUrl) }),
      ...(data.isPinned !== undefined && { isPinned: data.isPinned }),
      ...(data.mood !== undefined && { mood: data.mood }),
      ...(data.tags !== undefined && { tags: data.tags }),
      ...(data.archived !== undefined && { archived: data.archived }),
      ...(data.bookmarkPage !== undefined && { bookmarkPage: data.bookmarkPage }),
      ...(data.bookmarks !== undefined && { bookmarks: data.bookmarks as any }),
    },
  });
  if (data.attachmentUrl !== undefined && data.attachmentUrl !== previousAttachmentUrl) {
    await deleteStoredFile(previousAttachmentUrl);
  }
  if (data.voiceNoteUrl !== undefined && data.voiceNoteUrl !== previousVoiceNoteUrl) {
    await deleteStoredFile(previousVoiceNoteUrl);
  }
  return toNoteDTO(note);
}

export async function deleteNote(userId: string, noteId: string): Promise<void> {
  const existing = await prisma.note.findFirst({ where: { id: noteId, userId } });
  if (!existing) throw createError(404, 'NOTE_NOT_FOUND', 'Note not found');
  await deleteStoredFile(existing.attachmentUrl);
  await deleteStoredFile(existing.voiceNoteUrl);
  await prisma.note.delete({ where: { id: noteId } });
}
