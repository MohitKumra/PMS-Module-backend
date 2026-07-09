// backend/src/services/task.service.ts
// Business logic for task CRUD and recurrence. All DB access goes through Prisma.
// Recurrence: stores RRULE strings (e.g. "FREQ=DAILY;INTERVAL=1").
// Expanding RRULE instances on demand is Phase 2 — Phase 1 just stores the rule.

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import type { TaskDTO, CreateTaskRequest, UpdateTaskRequest } from '../types';

/** Converts Prisma Task row to TaskDTO. */
function toDTO(t: {
  id: string; userId: string; title: string; description: string | null;
  status: string; priority: string; dueDate: Date | null; recurrenceRule: string | null;
  parentTaskId: string | null; attachmentUrl: string | null; createdAt: Date; updatedAt: Date;
}): TaskDTO {
  return {
    id: t.id, userId: t.userId, title: t.title, description: t.description,
    status: t.status as TaskDTO['status'], priority: t.priority as TaskDTO['priority'],
    dueDate: t.dueDate?.toISOString() ?? null,
    recurrenceRule: t.recurrenceRule, parentTaskId: t.parentTaskId,
    attachmentUrl: t.attachmentUrl,
    createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
  };
}

export async function listTasks(userId: string, filters?: {
  status?: string; priority?: string; from?: string; to?: string;
}): Promise<{ data: TaskDTO[]; meta: { total: number } }> {
  const where: Record<string, unknown> = { userId };
  if (filters?.status) where.status = filters.status;
  if (filters?.priority) where.priority = filters.priority;
  if (filters?.from || filters?.to) {
    where.dueDate = {};
    if (filters.from) (where.dueDate as Record<string, unknown>).gte = new Date(filters.from);
    if (filters.to)   (where.dueDate as Record<string, unknown>).lte = new Date(filters.to);
  }
  const [tasks, total] = await Promise.all([
    prisma.task.findMany({ where, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }] }),
    prisma.task.count({ where }),
  ]);
  return { data: tasks.map(toDTO), meta: { total } };
}

export async function getTask(userId: string, taskId: string): Promise<TaskDTO> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  return toDTO(task);
}

export async function createTask(userId: string, data: CreateTaskRequest): Promise<TaskDTO> {
  const task = await prisma.task.create({
    data: {
      userId, title: data.title,
      description: data.description ?? null,
      priority: data.priority ?? 'MEDIUM',
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      recurrenceRule: data.recurrenceRule ?? null,
      parentTaskId: data.parentTaskId ?? null,
    },
  });
  return toDTO(task);
}

export async function updateTask(userId: string, taskId: string, data: UpdateTaskRequest): Promise<TaskDTO> {
  const existing = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!existing) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.priority !== undefined && { priority: data.priority }),
      ...(data.dueDate !== undefined && { dueDate: data.dueDate ? new Date(data.dueDate) : null }),
      ...(data.recurrenceRule !== undefined && { recurrenceRule: data.recurrenceRule }),
      ...(data.attachmentUrl !== undefined && { attachmentUrl: data.attachmentUrl }),
    },
  });
  return toDTO(task);
}

export async function deleteTask(userId: string, taskId: string): Promise<void> {
  const existing = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!existing) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  await prisma.task.delete({ where: { id: taskId } });
}
