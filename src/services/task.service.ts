// backend/src/services/task.service.ts
// Business logic for task CRUD and recurrence. All DB access goes through Prisma.
// Recurrence: stores RRULE strings (e.g. "FREQ=DAILY;INTERVAL=1").

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { RRule, RRuleSet, rrulestr } from 'rrule';
import type {
  TaskDTO,
  CreateTaskRequest,
  UpdateTaskRequest,
  SubTaskDTO,
  CreateSubTaskRequest,
  UpdateSubTaskRequest,
  TaskSubTaskInput,
} from '../types';

/**
 * Returns today's date at midnight local time. Used to anchor recurrence
 * when a recurring task is created/updated without an explicit due date —
 * RRULE needs a dtstart to compute occurrences from, but the user shouldn't
 * have to pick a date manually just to turn on "Daily".
 */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Calculates the next occurrence date for a recurring task
 */
function getNextOccurrence(
  currentDueDate: Date | null,
  recurrenceRule: string | null,
  recurrenceEndDate: Date | null,
  skipDates: string[]
): Date | null {
  if (!currentDueDate || !recurrenceRule) return null;

  try {
    const rule = rrulestr(recurrenceRule, { dtstart: currentDueDate });

    // Get all occurrences after current due date
    const occurrences = rule.between(
      new Date(currentDueDate.getTime() + 1), // Start after current date
      recurrenceEndDate || new Date(currentDueDate.getTime() + 365 * 24 * 60 * 60 * 1000), // 1 year max if no end
      true,
      (date, i) => {
        // Skip dates in skipDates array (YYYY-MM-DD)
        const dateStr = date.toISOString().split('T')[0];
        return !skipDates.includes(dateStr);
      }
    );

    if (occurrences.length > 0) {
      return occurrences[0];
    }
    return null;
  } catch (e) {
    console.error('Error calculating next occurrence:', e);
    return null;
  }
}

/** Converts Prisma Task row to TaskDTO. */
function toDTO(t: any): TaskDTO {
  return {
    id: t.id,
    userId: t.userId,
    title: t.title,
    description: t.description,
    status: t.status as TaskDTO['status'],
    priority: t.priority as TaskDTO['priority'],
    dueDate: t.dueDate?.toISOString() ?? null,
    recurrenceRule: t.recurrenceRule,
    recurrenceEndDate: t.recurrenceEndDate?.toISOString() ?? null,
    skipDates: t.skipDates || [],
    parentTaskId: t.parentTaskId,
    attachmentUrl: t.attachmentUrl,
    subTasks: t.subTasks?.map(subTaskToDTO),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function subTaskToDTO(st: any): SubTaskDTO {
  return {
    id: st.id,
    taskId: st.taskId,
    title: st.title,
    completed: st.completed,
    order: st.order,
    createdAt: st.createdAt.toISOString(),
    updatedAt: st.updatedAt.toISOString(),
  };
}

function normalizeSubTaskTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ');
}

function normalizeSubTaskOrder(subTasks: TaskSubTaskInput[]): TaskSubTaskInput[] {
  return subTasks.map((subTask, index) => ({
    ...subTask,
    title: normalizeSubTaskTitle(subTask.title),
    order: subTask.order ?? index,
  }));
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
    if (filters.to) (where.dueDate as Record<string, unknown>).lte = new Date(filters.to);
  }
  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      include: { subTasks: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } }
    }),
    prisma.task.count({ where }),
  ]);
  return { data: tasks.map(toDTO), meta: { total } };
}

export async function getTask(userId: string, taskId: string): Promise<TaskDTO> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId },
    include: { subTasks: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } }
  });
  if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  return toDTO(task);
}

export async function createTask(userId: string, data: CreateTaskRequest): Promise<TaskDTO> {
  const hasExplicitDueDate = !!(data.dueDate && data.dueDate !== '');
  // Recurring tasks need an anchor date to compute occurrences from, even if
  // the user didn't set one — default silently to today rather than forcing
  // it as a required field in the UI.
  const dueDate = hasExplicitDueDate
    ? new Date(data.dueDate as string)
    : data.recurrenceRule
    ? startOfToday()
    : null;

  const task = await prisma.task.create({
    data: {
      userId,
      title: data.title,
      description: data.description ?? null,
      priority: data.priority ?? 'MEDIUM',
      dueDate,
      recurrenceRule: data.recurrenceRule ?? null,
      recurrenceEndDate: (data.recurrenceEndDate && data.recurrenceEndDate !== '') ? new Date(data.recurrenceEndDate) : null,
      skipDates: data.skipDates || [],
      parentTaskId: data.parentTaskId ?? null,
      subTasks: data.subTasks && data.subTasks.length > 0 ? {
        create: data.subTasks.map((st, index) => ({
          title: normalizeSubTaskTitle(st.title),
          order: st.order ?? index,
        }))
      } : undefined,
    },
    include: { subTasks: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } }
  });
  return toDTO(task);
}

export async function updateTask(userId: string, taskId: string, data: UpdateTaskRequest): Promise<TaskDTO> {
  const existing = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!existing) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');

  const wasNotDone = existing.status !== 'DONE';
  const isBeingMarkedDone = data.status === 'DONE';

  // Resolve the effective recurrence rule and due date after this update,
  // so we can anchor recurrence to "today" if the task ends up recurring
  // with no due date (covers turning recurrence on for the first time via edit).
  const nextRecurrenceRule = data.recurrenceRule !== undefined ? data.recurrenceRule : existing.recurrenceRule;
  let nextDueDate: Date | null | undefined = undefined;
  if (data.dueDate !== undefined) {
    nextDueDate = (data.dueDate && data.dueDate !== '') ? new Date(data.dueDate) : null;
  }
  const effectiveDueDate = nextDueDate !== undefined ? nextDueDate : existing.dueDate;
  if (nextRecurrenceRule && !effectiveDueDate) {
    nextDueDate = startOfToday();
  }

  const task = await prisma.$transaction(async (tx) => {
    if (data.subTasks !== undefined) {
      const existingSubTasks = await tx.subTask.findMany({
        where: { taskId },
        orderBy: { order: 'asc' },
      });
      const existingById = new Map(existingSubTasks.map((subTask) => [subTask.id, subTask]));
      const normalizedSubTasks = normalizeSubTaskOrder(data.subTasks);
      const retainedIds = new Set<string>();

      for (const subTask of normalizedSubTasks) {
        if (subTask.id && existingById.has(subTask.id)) {
          retainedIds.add(subTask.id);
          await tx.subTask.update({
            where: { id: subTask.id },
            data: {
              title: subTask.title,
              ...(subTask.completed !== undefined && { completed: subTask.completed }),
              order: subTask.order ?? 0,
            },
          });
          continue;
        }

        await tx.subTask.create({
          data: {
            taskId,
            title: subTask.title,
            completed: subTask.completed ?? false,
            order: subTask.order ?? 0,
          },
        });
      }

      const deletions = existingSubTasks.filter((subTask) => !retainedIds.has(subTask.id));
      if (deletions.length > 0) {
        await tx.subTask.deleteMany({
          where: {
            id: { in: deletions.map((subTask) => subTask.id) },
          },
        });
      }
    }

    return tx.task.update({
      where: { id: taskId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(nextDueDate !== undefined && { dueDate: nextDueDate }),
        ...(data.recurrenceRule !== undefined && { recurrenceRule: data.recurrenceRule }),
        ...(data.recurrenceEndDate !== undefined && { recurrenceEndDate: (data.recurrenceEndDate && data.recurrenceEndDate !== '') ? new Date(data.recurrenceEndDate) : null }),
        ...(data.skipDates !== undefined && { skipDates: data.skipDates }),
        ...(data.attachmentUrl !== undefined && { attachmentUrl: data.attachmentUrl }),
      },
      include: { subTasks: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
    });
  });

  // If task is being marked as done and it's a recurring task, create next occurrence
  if (wasNotDone && isBeingMarkedDone && task.recurrenceRule) {
    const nextOccurrenceDate = getNextOccurrence(
      task.dueDate,
      task.recurrenceRule,
      task.recurrenceEndDate,
      task.skipDates
    );

    if (nextOccurrenceDate) {
      // Get subtasks from original task to copy
      const originalSubTasks = await prisma.subTask.findMany({
        where: { taskId: task.id },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      });

      // Create new task for next occurrence
      await prisma.task.create({
        data: {
          userId,
          title: task.title,
          description: task.description,
          priority: task.priority,
          status: 'TODO',
          dueDate: nextOccurrenceDate,
          recurrenceRule: task.recurrenceRule,
          recurrenceEndDate: task.recurrenceEndDate,
          skipDates: task.skipDates,
          // Fixed: previously this copied `task.parentTaskId`, which just
          // re-copied the parent's own parent (usually null), so the chain
          // never actually linked occurrences together. Every occurrence
          // should point back to the original series root.
          parentTaskId: task.parentTaskId ?? task.id,
          attachmentUrl: task.attachmentUrl,
          subTasks: originalSubTasks.length > 0 ? {
            create: originalSubTasks.map((st) => ({
              title: st.title,
              order: st.order,
              completed: false
            }))
          } : undefined
        }
      });
    }
  }

  return toDTO(task);
}

export async function deleteTask(userId: string, taskId: string): Promise<void> {
  const existing = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!existing) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  await prisma.task.delete({ where: { id: taskId } });
}

// Subtask CRUD
export async function listSubTasks(userId: string, taskId: string): Promise<SubTaskDTO[]> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  const subTasks = await prisma.subTask.findMany({
    where: { taskId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }]
  });
  return subTasks.map(subTaskToDTO);
}

export async function createSubTask(userId: string, taskId: string, data: CreateSubTaskRequest): Promise<SubTaskDTO> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  const title = normalizeSubTaskTitle(data.title);
  if (!title) throw createError(400, 'INVALID_SUBTASK_TITLE', 'Subtask title is required');
  const nextOrder = data.order ?? ((await prisma.subTask.findFirst({ where: { taskId }, orderBy: { order: 'desc' } }))?.order ?? -1) + 1;
  const subTask = await prisma.subTask.create({
    data: {
      taskId,
      title,
      order: nextOrder
    }
  });
  return subTaskToDTO(subTask);
}

export async function updateSubTask(userId: string, taskId: string, subTaskId: string, data: UpdateSubTaskRequest): Promise<SubTaskDTO> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  const subTask = await prisma.subTask.findFirst({ where: { id: subTaskId, taskId } });
  if (!subTask) throw createError(404, 'SUBTASK_NOT_FOUND', 'Subtask not found');
  const updated = await prisma.subTask.update({
    where: { id: subTaskId },
    data: {
      ...(data.title !== undefined && { title: normalizeSubTaskTitle(data.title) }),
      ...(data.completed !== undefined && { completed: data.completed }),
      ...(data.order !== undefined && { order: data.order }),
    }
  });
  return subTaskToDTO(updated);
}

export async function deleteSubTask(userId: string, taskId: string, subTaskId: string): Promise<void> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  const subTask = await prisma.subTask.findFirst({ where: { id: subTaskId, taskId } });
  if (!subTask) throw createError(404, 'SUBTASK_NOT_FOUND', 'Subtask not found');
  await prisma.subTask.delete({ where: { id: subTaskId } });
}
