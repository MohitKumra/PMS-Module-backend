// backend/src/services/task.service.ts
// Business logic for task CRUD and recurrence. All DB access goes through Prisma.
// Recurrence: stores RRULE strings (e.g. "FREQ=DAILY;INTERVAL=1").

import { prisma } from '../lib/prismaClient';
import { Prisma } from '@prisma/client';
import { createError } from '../middleware/errorHandler';
import { deleteStoredFile } from '../lib/fileStorage';
import { rrulestr } from 'rrule';
import { updateProjectProgress } from './project.service';
import { recomputeGoalProgress } from './goal.service';
import { syncGoogleCalendarTasks, deleteGoogleCalendarEvents } from './google.service';
import { awardTaskCompletion, revokeTaskCompletion, deleteTaskPoints } from './gamification.service';
import { toNoteDTO } from './notes.service';
import { checkUserEntitlement } from './entitlement.service';
import type {
  TaskDTO,
  TaskDetailDTO,
  CreateTaskRequest,
  UpdateTaskRequest,
  TaskRecurrenceConfig,
  SubTaskDTO,
  CreateSubTaskRequest,
  UpdateSubTaskRequest,
  TaskSubTaskInput,
  TaskTimeEntryDTO,
  CreateTaskTimeEntryRequest,
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

function normalizeTimeString(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : null;
}

function subtractMinutes(time: string, minutes: number): string | null {
  const normalized = normalizeTimeString(time);
  if (!normalized) return null;
  const [hours, mins] = normalized.split(':').map((part) => parseInt(part, 10));
  const total = hours * 60 + mins - minutes;
  const normalizedTotal = ((total % 1440) + 1440) % 1440;
  const nextHours = Math.floor(normalizedTotal / 60);
  const nextMinutes = normalizedTotal % 60;
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}`;
}

function resolveReminderTime(
  dueTime: string | null | undefined,
  reminderTime: string | null | undefined
): string | null {
  const explicitReminder = normalizeTimeString(reminderTime);
  if (explicitReminder) return explicitReminder;
  const normalizedDueTime = normalizeTimeString(dueTime);
  return normalizedDueTime ? subtractMinutes(normalizedDueTime, 30) : null;
}

function getWeekdayToken(date: Date): string {
  return ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][date.getDay()];
}

/**
 * Maps weekday names (full words or 2-letter tokens, case-insensitive) to
 * RFC 5545 BYDAY tokens (MO..SU). Used by both the weekly and the
 * daily-with-skip-day recurrence builders.
 */
function normalizeWeekdayTokens(weekdays: string[]): string[] {
  const map: Record<string, string> = {
    sunday: 'SU',
    monday: 'MO',
    tuesday: 'TU',
    wednesday: 'WE',
    thursday: 'TH',
    friday: 'FR',
    saturday: 'SA',
    su: 'SU',
    mo: 'MO',
    tu: 'TU',
    we: 'WE',
    th: 'TH',
    fr: 'FR',
    sa: 'SA',
  };
  return weekdays
    .map((day) => day.trim().toUpperCase())
    .filter(Boolean)
    .map((day) => map[day.toLowerCase()] ?? day.slice(0, 2));
}

export function buildRecurrenceFromConfig(
  config: TaskRecurrenceConfig,
  startDate: Date
): { recurrenceRule: string | null; recurrenceEndDate: Date | null; dueDate: Date | null } {
  if (!config.enabled) {
    return { recurrenceRule: null, recurrenceEndDate: null, dueDate: startDate };
  }

  const interval = Math.max(1, config.interval || 1);
  const parts: string[] = [];
  let recurrenceEndDate: Date | null = config.endsType === 'date' && config.endsAt ? new Date(config.endsAt) : null;

  switch (config.frequency) {
    case 'day': {
      parts.push('FREQ=DAILY', `INTERVAL=${interval}`);
      // Allow narrowing a *daily* cadence with weekdays (i.e. skip days, the
      // task equivalent of a habit's skip days). A partial set emits BYDAY;
      // all 7 (or none) collapses to a plain daily rule.
      const dayTokens = normalizeWeekdayTokens(config.weekdays ?? []);
      if (dayTokens.length > 0 && dayTokens.length < 7) {
        parts.push(`BYDAY=${dayTokens.join(',')}`);
      }
      break;
    }
    case 'week': {
      parts.push('FREQ=WEEKLY', `INTERVAL=${interval}`);
      const weekTokens = normalizeWeekdayTokens(config.weekdays ?? []);
      if (weekTokens.length > 0) {
        parts.push(`BYDAY=${weekTokens.join(',')}`);
      }
      break;
    }
    case 'month':
      parts.push('FREQ=MONTHLY', `INTERVAL=${interval}`);
      if (config.monthlyMode === 'weekdayPattern' && config.weekday && config.weekOfMonth) {
        const weekday = config.weekday.trim().toUpperCase().slice(0, 2);
        parts.push(`BYDAY=${weekday}`, `BYSETPOS=${config.weekOfMonth}`);
      } else {
        const dayOfMonth = typeof config.dayOfMonth === 'number' ? config.dayOfMonth : startDate.getDate();
        parts.push(`BYMONTHDAY=${Math.max(1, Math.min(31, dayOfMonth))}`);
      }
      break;
    case 'year': {
      parts.push('FREQ=YEARLY', `INTERVAL=${interval}`);
      const month = startDate.getMonth() + 1;
      const day = startDate.getDate();
      parts.push(`BYMONTH=${month}`, `BYMONTHDAY=${day}`);
      break;
    }
    default:
      parts.push('FREQ=DAILY', 'INTERVAL=1');
      break;
  }

  if (config.endsType === 'occurrences' && config.occurrenceCount && config.occurrenceCount > 0) {
    parts.push(`COUNT=${config.occurrenceCount}`);
    recurrenceEndDate = null;
  }

  const dueDate = config.startsAt ? new Date(config.startsAt) : startDate;
  return { recurrenceRule: parts.join(';'), recurrenceEndDate, dueDate };
}

export function recurrenceConfigToRule(
  config?: TaskRecurrenceConfig | null,
  fallbackDueDate?: Date | null
): { recurrenceRule?: string | null; recurrenceEndDate?: Date | null; dueDate?: Date | null } {
  if (!config?.enabled) return {};
  const startDate = config.startsAt ? new Date(config.startsAt) : (fallbackDueDate ?? startOfToday());
  return buildRecurrenceFromConfig(config, startDate);
}

const ACTIVE_RECURRING_STATUSES = ['TODO', 'IN_PROGRESS'] as const;

function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function isFutureScheduledDate(scheduledDate: Date | null, timeZone: string): boolean {
  if (!scheduledDate) return false;
  return dateKeyInTimeZone(scheduledDate, timeZone) > dateKeyInTimeZone(new Date(), timeZone);
}

/**
 * Calculates the next scheduled date for a recurring task.
 *
 * repeatBasedOn = 'dueDate' (default):
 *   Always anchors to the original due date. Completing late doesn't shift
 *   the schedule. E.g. a Monday task completed on Wednesday still creates
 *   the next occurrence on the following Monday.
 *
 * repeatBasedOn = 'completionDate':
 *   The interval counts from when the task was actually completed. Useful
 *   for tasks like "water the plants every 3 days" where the clock resets
 *   on completion, not on the original due date.
 */
export function getNextOccurrence(
  scheduledDate: Date | null,
  recurrenceRule: string | null,
  recurrenceEndDate: Date | null,
  skipDates: string[],
  options?: {
    repeatBasedOn?: 'dueDate' | 'completionDate';
    completionDate?: Date | null;
  }
): Date | null {
  if (!recurrenceRule) return null;

  // Choose anchor based on repeatBasedOn setting
  const repeatBasedOn = options?.repeatBasedOn ?? 'dueDate';
  let anchor: Date | null = null;

  if (repeatBasedOn === 'completionDate' && options?.completionDate) {
    // Anchor from completion time, but normalise to midnight UTC so the
    // RRULE engine (which works in UTC midnight dates) stays consistent.
    anchor = new Date(options.completionDate);
    anchor.setUTCHours(0, 0, 0, 0);
  } else {
    anchor = scheduledDate;
  }

  if (!anchor) return null;

  try {
    const rule = rrulestr(recurrenceRule, { dtstart: anchor });
    // For dueDate mode we use rule.after(anchor) which gives the next
    // occurrence *strictly after* the anchor date — i.e. the one after
    // the just-completed task.
    // For completionDate mode the anchor IS the completion date, so we
    // also want the first occurrence strictly after it.
    let next = rule.after(anchor, false);

    while (next) {
      if (recurrenceEndDate && next > recurrenceEndDate) return null;
      const dateStr = next.toISOString().split('T')[0];
      if (!skipDates.includes(dateStr)) return next;
      next = rule.after(next, false);
    }

    return null;
  } catch (e) {
    console.error('Error calculating next occurrence:', e);
    return null;
  }
}

async function createNextRecurringOccurrence(
  tx: any,
  task: any,
  rootId: string,
  options?: {
    completionDate?: Date | null;
    /** Override the config stored on the task (used when called from updateTask) */
    recurrenceConfig?: TaskRecurrenceConfig | null;
  }
): Promise<void> {
  const cfg: TaskRecurrenceConfig | null =
    options?.recurrenceConfig ?? (task.recurrenceConfig as TaskRecurrenceConfig | null) ?? null;
  const missedBehavior = cfg?.missedBehavior ?? 'skip';
  const generateNext = cfg?.generateNext ?? 'onCompletion';
  const repeatBasedOn = cfg?.repeatBasedOn ?? 'dueDate';

  // generateNext = 'onDueDate': do NOT spawn here — the cron job handles it.
  if (generateNext === 'onDueDate') return;

  const existingActiveOccurrence = await tx.task.findFirst({
    where: {
      userId: task.userId,
      OR: [{ id: rootId }, { parentTaskId: rootId }],
      status: { in: [...ACTIVE_RECURRING_STATUSES] },
    },
  });
  if (existingActiveOccurrence) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const nextDate = getNextOccurrence(task.dueDate, task.recurrenceRule, task.recurrenceEndDate, task.skipDates || [], {
    repeatBasedOn,
    completionDate: options?.completionDate ?? null,
  });
  if (!nextDate) return;

  // missedBehavior = 'skip' (default): only create future occurrences.
  // missedBehavior = 'overdue': create the task even if nextDate is in the past.
  // missedBehavior = 'createNext': create the missed occurrence AND the one after it.
  const nextDateIsInPast = nextDate < today;

  if (nextDateIsInPast && missedBehavior === 'skip') {
    // Find the first future occurrence instead
    let futureDate = getNextOccurrence(nextDate, task.recurrenceRule, task.recurrenceEndDate, task.skipDates || [], {
      repeatBasedOn: 'dueDate',
      completionDate: null,
    });
    // Keep advancing until we find a future date
    while (futureDate && futureDate < today) {
      futureDate = getNextOccurrence(futureDate, task.recurrenceRule, task.recurrenceEndDate, task.skipDates || [], {
        repeatBasedOn: 'dueDate',
        completionDate: null,
      });
    }
    if (!futureDate) return;
    await spawnOccurrence(tx, task, rootId, futureDate);
    return;
  }

  // 'overdue' and 'createNext' both create at nextDate (even if past)
  const existingSameDate = await tx.task.findFirst({
    where: {
      userId: task.userId,
      OR: [{ id: rootId }, { parentTaskId: rootId }],
      dueDate: nextDate,
    },
  });
  if (!existingSameDate) {
    await spawnOccurrence(tx, task, rootId, nextDate);
  }

  // 'createNext': also spawn the one after the missed date
  if (missedBehavior === 'createNext' && nextDateIsInPast) {
    let futureDate = getNextOccurrence(nextDate, task.recurrenceRule, task.recurrenceEndDate, task.skipDates || [], {
      repeatBasedOn: 'dueDate',
      completionDate: null,
    });
    while (futureDate && futureDate < today) {
      futureDate = getNextOccurrence(futureDate, task.recurrenceRule, task.recurrenceEndDate, task.skipDates || [], {
        repeatBasedOn: 'dueDate',
        completionDate: null,
      });
    }
    if (futureDate) {
      const existingFuture = await tx.task.findFirst({
        where: {
          userId: task.userId,
          OR: [{ id: rootId }, { parentTaskId: rootId }],
          dueDate: futureDate,
        },
      });
      if (!existingFuture) {
        await spawnOccurrence(tx, task, rootId, futureDate);
      }
    }
  }
}

/** Creates a single child occurrence task at the given due date. */
async function spawnOccurrence(tx: any, task: any, rootId: string, dueDate: Date): Promise<void> {
  await tx.task.create({
    data: {
      userId: task.userId,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: 'TODO',
      dueDate,
      recurrenceRule: task.recurrenceRule,
      recurrenceConfig: task.recurrenceConfig ?? Prisma.JsonNull,
      recurrenceEndDate: task.recurrenceEndDate,
      skipDates: task.skipDates || [],
      parentTaskId: rootId,
      dueTime: task.dueTime ?? null,
      reminderTime: task.reminderTime ?? null,
      reminderMessage: task.reminderMessage ?? null,
      attachmentUrl: task.attachmentUrl,
      voiceNoteUrl: task.voiceNoteUrl,
      estimatedDuration: task.estimatedDuration,
      subTasks:
        task.subTasks?.length > 0
          ? {
              create: task.subTasks.map((st: any) => ({
                title: st.title,
                order: st.order,
                completed: false,
              })),
            }
          : undefined,
      projectTasks: task.projectTasks
        ? {
            create: {
              projectId: task.projectTasks.projectId,
              order: task.projectTasks.order,
            },
          }
        : undefined,
    },
  });
}

/** Converts Prisma Task row to TaskDTO. */
function toProjectSummary(projectTask: any) {
  return projectTask?.project
    ? {
        id: projectTask.project.id,
        name: projectTask.project.name,
        color: projectTask.project.color ?? null,
      }
    : null;
}

function toDTO(t: any): TaskDTO {
  return {
    id: t.id,
    userId: t.userId,
    goalId: t.goalId ?? null,
    title: t.title,
    description: t.description,
    status: t.status as TaskDTO['status'],
    priority: t.priority as TaskDTO['priority'],
    dueDate: t.dueDate?.toISOString() ?? null,
    dueTime: t.dueTime ?? null,
    reminderTime: t.reminderTime ?? null,
    reminderMessage: t.reminderMessage ?? null,
    recurrenceRule: t.recurrenceRule,
    recurrenceConfig: (t.recurrenceConfig as TaskRecurrenceConfig | null) ?? null,
    recurrenceEndDate: t.recurrenceEndDate?.toISOString() ?? null,
    skipDates: t.skipDates || [],
    parentTaskId: t.parentTaskId,
    attachmentUrl: t.attachmentUrl,
    voiceNoteUrl: t.voiceNoteUrl,
    inProgressAt: t.inProgressAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    estimatedDuration: t.estimatedDuration ?? null,
    project: toProjectSummary(t.projectTasks),
    subTasks: t.subTasks?.map(subTaskToDTO),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/**
 * Fire-and-forget trigger to sync changes to Google Calendar.
 * Catches errors silently so a sync failure never blocks the task operation.
 */
async function triggerCalendarSync(userId: string): Promise<void> {
  try {
    const entitlement = await checkUserEntitlement(userId, 'calendarSync');
    if (!entitlement.allowed) {
      return; // Skip sync if calendarSync is locked on the user's plan
    }

    // Check if Google Calendar is connected before attempting sync
    const connection = await prisma.googleCalendarConnection.findUnique({
      where: { userId },
    });

    if (!connection || !connection.isActive || !connection.syncTasks) {
      return; // Skip sync if not connected or sync disabled
    }

    await syncGoogleCalendarTasks(userId);
    console.log(`[Google Calendar] Successfully synced tasks for user ${userId}`);
  } catch (error: any) {
    // Log cleanly if re-authentication is required
    if (error?.code === 'GOOGLE_CALENDAR_REAUTH_REQUIRED') {
      console.warn(`[Google Calendar] Sync skipped for user ${userId}: Google re-authentication required.`);
    } else {
      console.error(`[Google Calendar] Sync failed for user ${userId}:`, error?.message || error);
    }
  }
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

function timeEntryToDTO(entry: any): TaskTimeEntryDTO {
  return {
    id: entry.id,
    taskId: entry.taskId,
    userId: entry.userId,
    minutes: entry.minutes,
    note: entry.note ?? null,
    startedAt: entry.startedAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

async function createActivity(taskId: string, userId: string, type: string, content: string) {
  await prisma.taskActivity.create({
    data: { taskId, userId, type, content },
  });
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

export async function listTasks(
  userId: string,
  filters?: Record<string, string>
): Promise<{ data: TaskDTO[]; meta: { total: number; nextCursor?: string | null; page?: number; pageSize?: number; totalPages?: number } }> {
  const where: Prisma.TaskWhereInput = { userId };

  // ── named preset filter ────────────────────────────────────────────────────
  // ?filter=pending|today|upcoming|overdue|completed|all
  // These map directly to the tab filters in the UI.
  const preset = filters?.filter;
  if (preset && preset !== 'all') {
    // Resolve the user's timezone so date-based tabs (Today / Upcoming / Overdue)
    // use the user's local calendar-day boundaries. The frontend stores dueDate
    // as YYYY-MM-DD → UTC midnight (e.g. "2026-08-10" → 2026-08-10T00:00:00.000Z),
    // so computing boundaries from the local date key keeps every tab's results
    // aligned with what the user sees on their calendar — otherwise an IST user's
    // "Today" tasks (stored at 2026-08-09T18:30:00.000Z) would fall into the
    // "Overdue" bucket when compared against UTC midnight.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const timeZone = user?.timezone || 'UTC';
    const todayKey = dateKeyInTimeZone(new Date(), timeZone); // YYYY-MM-DD in user's timezone
    const today = new Date(`${todayKey}T00:00:00.000Z`);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const nextWeek = new Date(today);
    nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
    nextWeek.setUTCHours(23, 59, 59, 999);

    switch (preset) {
      case 'pending':
        // Active tasks (not done/cancelled) whose due date is today or earlier (or has no due date)
        where.status = { notIn: ['DONE', 'CANCELLED'] };
        where.OR = [{ dueDate: null }, { dueDate: { lte: new Date(today.getTime() + 86399999) } }];
        break;
      case 'today':
        where.status = { notIn: ['DONE', 'CANCELLED'] };
        where.dueDate = { gte: today, lt: tomorrow };
        break;
      case 'upcoming':
        // Due in the next 1–7 days (exclusive of today)
        where.status = { notIn: ['DONE', 'CANCELLED'] };
        where.dueDate = { gte: tomorrow, lte: nextWeek };
        break;
      case 'overdue':
        // Due before today, not done/cancelled
        where.status = { notIn: ['DONE', 'CANCELLED'] };
        where.dueDate = { lt: today };
        break;
      case 'completed':
        where.status = 'DONE';
        break;
      default:
        break;
    }

    // ── Apply date range / noDate overrides on top of the preset ──────────
    // The frontend sends these alongside a preset filter like "pending" or
    // "completed" (e.g. filter=pending&noDate=true). In that case we need to
    // override the preset's date conditions with the more specific date filter.
    if (filters?.noDate === 'true') {
      delete where.OR; // remove any OR from preset (e.g. pending's dueDate OR)
      where.dueDate = null;
    } else if (filters?.from || filters?.to) {
      delete where.OR; // remove any OR from preset
      const dateFilter: Prisma.DateTimeNullableFilter = {};
      if (filters.from) dateFilter.gte = new Date(filters.from);
      if (filters.to) {
        const toDate = new Date(filters.to);
        toDate.setUTCHours(23, 59, 59, 999);
        dateFilter.lte = toDate;
      }
      where.dueDate = dateFilter;
    }
  } else {
    // ── individual param filters (used for advanced/date filter combos) ──────
    if (filters?.status) {
      // Support comma-separated values: e.g. status=TODO,IN_PROGRESS
      const statuses = filters.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        where.status = statuses[0] as Prisma.EnumTaskStatusFilter<'Task'> | import('@prisma/client').TaskStatus;
      } else if (statuses.length > 1) {
        where.status = { in: statuses as import('@prisma/client').TaskStatus[] };
      }
    }
    if (filters?.priority) {
      where.priority = filters.priority as import('@prisma/client').Priority;
    }
    // ── date range / noDate (individual params mode, no preset) ──────────
    if (filters?.noDate === 'true') {
      where.dueDate = null;
    } else if (filters?.from || filters?.to) {
      where.dueDate = {};
      if (filters.from) (where.dueDate as Prisma.DateTimeNullableFilter).gte = new Date(filters.from);
      if (filters.to) {
        // Set to end of day for the to-date
        const toDate = new Date(filters.to);
        toDate.setUTCHours(23, 59, 59, 999);
        (where.dueDate as Prisma.DateTimeNullableFilter).lte = toDate;
      }
    }
  }

  // ── search (title or description contains, case-insensitive) ──────────────
  if (filters?.search?.trim()) {
    const searchTerm = filters.search.trim();
    const searchCondition = {
      OR: [
        { title: { contains: searchTerm, mode: 'insensitive' as const } },
        { description: { contains: searchTerm, mode: 'insensitive' as const } },
      ],
    };
    // Merge with any existing OR from preset filters
    if (where.OR) {
      where.AND = [{ OR: where.OR as Prisma.TaskWhereInput[] }, searchCondition];
      delete where.OR;
    } else {
      Object.assign(where, searchCondition);
    }
  }

  // ── sort ───────────────────────────────────────────────────────────────────
  let orderBy: Prisma.TaskOrderByWithRelationInput[] = [{ dueDate: 'asc' }, { id: 'asc' }];
  if (filters?.sortBy === 'priority') {
    // Prisma doesn't support custom enum ordering natively; fall back to createdAt
    // and let the client re-sort by priority locally for display purposes.
    orderBy = [{ createdAt: 'desc' }, { id: 'asc' }];
  } else if (filters?.sortBy === 'created') {
    orderBy = [{ createdAt: 'desc' }, { id: 'asc' }];
  }

  // ── pagination ─────────────────────────────────────────────────────────────
  // Two modes:
  //   cursor (default / board view): ?take=10&cursor=<id>   → nextCursor in meta
  //   offset (card / list view):     ?page=2&pageSize=10    → page/totalPages in meta

  const useOffsetPagination = !!(filters?.page || filters?.pageSize);

  if (useOffsetPagination) {
    // ── Offset pagination ──────────────────────────────────────────────────
    const pageRaw = filters?.page ? parseInt(filters.page, 12) : 1;
    const pageSizeRaw = filters?.pageSize ? parseInt(filters.pageSize, 12) : 12;
    const page = Math.max(1, pageRaw);
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);
    const skip = (page - 1) * pageSize;

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        take: pageSize,
        skip,
        orderBy,
        include: {
          subTasks: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
          projectTasks: { include: { project: true } },
          goal: true,
        },
      }),
      prisma.task.count({ where }),
    ]);

    const totalPages = Math.ceil(total / pageSize);
    return {
      data: tasks.map(toDTO),
      meta: { total, nextCursor: null, page, pageSize, totalPages },
    };
  }

  // ── Cursor pagination ──────────────────────────────────────────────────────
  const cursor = filters?.cursor ?? undefined;
  const takeRaw = filters?.take ? parseInt(filters.take, 10) : 10;
  const take = Math.min(Math.max(takeRaw, 1), 100); // clamp 1–100

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      take: take + 1, // fetch one extra to detect hasMore
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy,
      include: {
        subTasks: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
        projectTasks: { include: { project: true } },
        goal: true,
      },
    }),
    prisma.task.count({ where }),
  ]);

  const hasMore = tasks.length > take;
  if (hasMore) tasks.pop(); // remove the extra sentinel item
  const nextCursor = hasMore ? tasks[tasks.length - 1].id : null;

  return { data: tasks.map(toDTO), meta: { total, nextCursor } };
}

/**
 * Returns per-tab task counts for the tasks page in a single call.
 * Mirrors the filter logic from listTasks so the tab badges always
 * match exactly what each tab would return.
 */
export async function getTaskCounts(
  userId: string,
  timeZone?: string | null
): Promise<{ pending: number; today: number; upcoming: number; completed: number; overdue: number; all: number }> {
  const user = timeZone
    ? null
    : await prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      });
  const tz = timeZone || user?.timezone || 'UTC';
  const todayKey = dateKeyInTimeZone(new Date(), tz);
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const nextWeek = new Date(today);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  nextWeek.setUTCHours(23, 59, 59, 999);

  const baseActive: Prisma.TaskWhereInput = { userId, status: { notIn: ['DONE', 'CANCELLED'] } };

  const [pending, todayCount, upcoming, completed, overdue, all] = await Promise.all([
    prisma.task.count({
      where: {
        userId,
        status: { notIn: ['DONE', 'CANCELLED'] },
        OR: [{ dueDate: null }, { dueDate: { lte: new Date(today.getTime() + 86399999) } }],
      },
    }),
    prisma.task.count({ where: { ...baseActive, dueDate: { gte: today, lt: tomorrow } } }),
    prisma.task.count({ where: { ...baseActive, dueDate: { gte: tomorrow, lte: nextWeek } } }),
    prisma.task.count({ where: { userId, status: 'DONE' } }),
    prisma.task.count({ where: { userId, status: { notIn: ['DONE', 'CANCELLED'] }, dueDate: { lt: today } } }),
    prisma.task.count({ where: { userId } }),
  ]);

  return { pending, today: todayCount, upcoming, completed, overdue, all };
}

export async function getTask(userId: string, taskId: string): Promise<TaskDetailDTO> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId },
    include: {
      subTasks: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
      projectTasks: { include: { project: true } },
      activity: { orderBy: { createdAt: 'desc' } },
      timeEntries: { orderBy: { createdAt: 'desc' } },
      media: true,
      goal: true,
    },
  });
  if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  const linkedNotes = await prisma.note.findMany({
    where: { userId, taskId },
    orderBy: { updatedAt: 'desc' },
  });
  const mediaItems = task.media ?? [];
  return {
    ...toDTO(task),
    activity: task.activity.map((item) => ({
      id: item.id,
      taskId: item.taskId,
      userId: item.userId,
      type: item.type,
      content: item.content,
      createdAt: item.createdAt.toISOString(),
    })),
    timeEntries: task.timeEntries.map(timeEntryToDTO),
    linkedNotes: linkedNotes.map(toNoteDTO),
    attachments: mediaItems
      .filter((m: any) => m.type === 'attachment')
      .map((m: any) => ({
        id: m.id,
        url: m.url,
        type: m.type as 'attachment',
        fileName: m.fileName,
        mimeType: m.mimeType,
        size: m.size,
        createdAt: m.createdAt.toISOString(),
      })),
    voiceNotes: mediaItems
      .filter((m: any) => m.type === 'voice_note')
      .map((m: any) => ({
        id: m.id,
        url: m.url,
        type: m.type as 'voice_note',
        fileName: m.fileName,
        mimeType: m.mimeType,
        size: m.size,
        createdAt: m.createdAt.toISOString(),
      })),
  };
}

export async function createTask(userId: string, data: CreateTaskRequest): Promise<TaskDTO> {
  const hasExplicitDueDate = !!(data.dueDate && data.dueDate !== '');
  // Recurring tasks need an anchor date to compute occurrences from, even if
  // the user didn't set one — default silently to today rather than forcing
  // it as a required field in the UI.
  const recurrenceData = recurrenceConfigToRule(
    data.recurrenceConfig,
    hasExplicitDueDate ? new Date(data.dueDate as string) : null
  );
  const dueDate =
    recurrenceData.dueDate ??
    (hasExplicitDueDate ? new Date(data.dueDate as string) : data.recurrenceRule ? startOfToday() : null);
  const dueTime = normalizeTimeString(data.dueTime);
  const reminderTime = resolveReminderTime(dueTime, data.reminderTime);
  const reminderMessage = data.reminderMessage?.trim() || null;
  const projectId = data.projectId?.trim() || null;
  const goalId = data.goalId?.trim() || null;

  const task = await prisma.$transaction(async (tx) => {
    if (projectId) {
      const project = await tx.project.findFirst({
        where: { id: projectId, userId },
        select: { id: true },
      });
      if (!project) throw createError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }
    if (goalId) {
      const goal = await tx.goal.findFirst({
        where: { id: goalId, userId },
        select: { id: true },
      });
      if (!goal) throw createError(404, 'GOAL_NOT_FOUND', 'Goal not found');
    }
    let resolvedProjectId = projectId;
    if (!resolvedProjectId && goalId) {
      const goalProject = await tx.project.findFirst({
        where: { userId, goalId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      resolvedProjectId = goalProject?.id ?? null;
    }

    return tx.task.create({
      data: {
        userId,
        title: data.title,
        description: data.description ?? null,
        status: data.status ?? 'TODO',
        priority: data.priority ?? 'MEDIUM',
        dueDate,
        dueTime,
        reminderTime,
        reminderMessage,
        recurrenceRule: recurrenceData.recurrenceRule ?? data.recurrenceRule ?? null,
        recurrenceConfig: data.recurrenceConfig ?? Prisma.JsonNull,
        recurrenceEndDate:
          recurrenceData.recurrenceEndDate ??
          (data.recurrenceEndDate && data.recurrenceEndDate !== '' ? new Date(data.recurrenceEndDate) : null),
        skipDates: data.skipDates || [],
        parentTaskId: data.parentTaskId ?? null,
        estimatedDuration: data.estimatedDuration ?? null,
        attachmentUrl: data.attachmentUrl ?? null,
        voiceNoteUrl: data.voiceNoteUrl ?? null,
        goalId,
        inProgressAt: data.status === 'IN_PROGRESS' ? new Date() : null,
        completedAt: data.status === 'DONE' ? new Date() : null,
        subTasks:
          data.subTasks && data.subTasks.length > 0
            ? {
                create: data.subTasks.map((st, index) => ({
                  title: normalizeSubTaskTitle(st.title),
                  order: st.order ?? index,
                })),
              }
            : undefined,
        projectTasks: resolvedProjectId
          ? {
              create: {
                projectId: resolvedProjectId,
                order: 0,
              },
            }
          : undefined,
      },
      include: {
        subTasks: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
        projectTasks: { include: { project: true } },
        goal: true,
      },
    });
  });
  await createActivity(task.id, userId, 'CREATED', `Created task "${task.title}"`);
  if (projectId || goalId) {
    const linkedProjectId =
      projectId ?? (await prisma.project.findFirst({ where: { userId, goalId }, select: { id: true } }))?.id ?? null;
    if (linkedProjectId) {
      await updateProjectProgress(linkedProjectId);
    }
  }

  // Fire-and-forget: sync to Google Calendar if connected
  triggerCalendarSync(userId);

  if (goalId) {
    await recomputeGoalProgress(goalId).catch(() => undefined);
  }

  return toDTO(task);
}

export async function updateTask(userId: string, taskId: string, data: UpdateTaskRequest): Promise<TaskDTO> {
  const existing = await prisma.task.findFirst({
    where: { id: taskId, userId },
    include: {
      user: { select: { timezone: true } },
      subTasks: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
      projectTasks: true,
      goal: true,
    },
  });
  if (!existing) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  const previousAttachmentUrl = existing.attachmentUrl;
  const previousVoiceNoteUrl = existing.voiceNoteUrl;

  if (data.goalId !== undefined && data.goalId !== null) {
    const goal = await prisma.goal.findFirst({ where: { id: data.goalId, userId }, select: { id: true } });
    if (!goal) throw createError(404, 'GOAL_NOT_FOUND', 'Goal not found');
  }

  const wasNotDone = existing.status !== 'DONE';
  const isBeingMarkedDone = data.status === 'DONE';
  const isRecurringCompletion = wasNotDone && isBeingMarkedDone && !!existing.recurrenceRule;

  if (isRecurringCompletion && isFutureScheduledDate(existing.dueDate, existing.user.timezone || 'UTC')) {
    throw createError(
      400,
      'RECURRING_OCCURRENCE_NOT_DUE',
      'Future recurring tasks cannot be completed before their scheduled date'
    );
  }

  let nextInProgressAt: Date | null | undefined = undefined;
  let nextCompletedAt: Date | null | undefined = undefined;

  if (data.status !== undefined) {
    if (data.status === 'IN_PROGRESS') {
      nextInProgressAt = existing.inProgressAt || new Date();
      nextCompletedAt = null;
    } else if (data.status === 'DONE') {
      nextCompletedAt = existing.completedAt || new Date();
      nextInProgressAt = existing.inProgressAt || existing.createdAt;
    } else if (data.status === 'TODO' || data.status === 'CANCELLED') {
      nextInProgressAt = null;
      nextCompletedAt = null;
    }
  }

  // Resolve the effective recurrence rule and due date after this update,
  // so we can anchor recurrence to "today" if the task ends up recurring
  // with no due date (covers turning recurrence on for the first time via edit).
  let nextDueDate: Date | null | undefined = undefined;
  if (data.dueDate !== undefined) {
    nextDueDate = data.dueDate && data.dueDate !== '' ? new Date(data.dueDate) : null;
  }
  const nextRecurrenceRule = data.recurrenceRule !== undefined ? data.recurrenceRule : existing.recurrenceRule;
  const nextRecurrenceData = recurrenceConfigToRule(data.recurrenceConfig, nextDueDate ?? existing.dueDate);
  const nextDueTime = data.dueTime !== undefined ? normalizeTimeString(data.dueTime) : (existing.dueTime ?? null);
  const nextReminderMessage =
    data.reminderMessage !== undefined ? data.reminderMessage?.trim() || null : (existing.reminderMessage ?? null);
  let nextReminderTime: string | null | undefined = undefined;
  if (data.reminderTime !== undefined) {
    nextReminderTime = normalizeTimeString(data.reminderTime);
  } else if (data.dueTime !== undefined) {
    nextReminderTime = resolveReminderTime(nextDueTime, undefined);
  } else {
    nextReminderTime = existing.reminderTime ?? null;
  }
  const effectiveDueDate = nextDueDate !== undefined ? nextDueDate : existing.dueDate;
  const dueDateChanged =
    data.dueDate !== undefined && (existing.dueDate?.toISOString() ?? null) !== (nextDueDate?.toISOString() ?? null);
  const dueTimeChanged = data.dueTime !== undefined && (existing.dueTime ?? null) !== (nextDueTime ?? null);
  if ((nextRecurrenceRule || nextRecurrenceData.recurrenceRule) && !effectiveDueDate) {
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

    const updatedTask = await tx.task.update({
      where: { id: taskId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(nextDueDate !== undefined && { dueDate: nextDueDate }),
        ...(data.dueTime !== undefined && { dueTime: nextDueTime }),
        ...(data.reminderTime !== undefined || data.dueTime !== undefined ? { reminderTime: nextReminderTime } : {}),
        ...(data.reminderMessage !== undefined && { reminderMessage: nextReminderMessage }),
        ...(data.recurrenceRule !== undefined && { recurrenceRule: data.recurrenceRule }),
        ...(data.recurrenceEndDate !== undefined && {
          recurrenceEndDate:
            data.recurrenceEndDate && data.recurrenceEndDate !== '' ? new Date(data.recurrenceEndDate) : null,
        }),
        ...(data.recurrenceConfig !== undefined &&
          nextRecurrenceData.recurrenceRule !== undefined && { recurrenceRule: nextRecurrenceData.recurrenceRule }),
        ...(data.recurrenceConfig !== undefined &&
          nextRecurrenceData.recurrenceEndDate !== undefined && {
            recurrenceEndDate: nextRecurrenceData.recurrenceEndDate,
          }),
        ...(data.recurrenceConfig !== undefined && {
          recurrenceConfig: data.recurrenceConfig ? data.recurrenceConfig : Prisma.JsonNull,
        }),
        ...(data.skipDates !== undefined && { skipDates: data.skipDates }),
        ...(data.attachmentUrl !== undefined && { attachmentUrl: data.attachmentUrl }),
        ...(data.voiceNoteUrl !== undefined && { voiceNoteUrl: data.voiceNoteUrl }),
        ...(data.estimatedDuration !== undefined && { estimatedDuration: data.estimatedDuration }),
        ...(data.goalId !== undefined && { goalId: data.goalId || null }),
        ...(nextInProgressAt !== undefined && { inProgressAt: nextInProgressAt }),
        ...(nextCompletedAt !== undefined && { completedAt: nextCompletedAt }),
      } as any,
      include: {
        subTasks: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
        projectTasks: { include: { project: true } },
        goal: true,
      },
    });

    if (isRecurringCompletion) {
      await createNextRecurringOccurrence(tx, updatedTask, existing.parentTaskId ?? existing.id, {
        completionDate: nextCompletedAt ?? new Date(),
        recurrenceConfig: (data.recurrenceConfig ??
          (updatedTask as any).recurrenceConfig) as TaskRecurrenceConfig | null,
      });
    }

    return updatedTask;
  });

  if (data.status !== undefined && data.status !== existing.status) {
    await createActivity(task.id, userId, 'STATUS_CHANGED', `Changed status to ${task.status}`);
  }
  if (wasNotDone && isBeingMarkedDone) {
    await awardTaskCompletion(userId, task.id, task.title);
  } else if (!wasNotDone && existing.status === 'DONE' && data.status && data.status !== 'DONE') {
    await revokeTaskCompletion(userId, task.id, task.title);
  }
  if (data.title !== undefined && data.title !== existing.title) {
    await createActivity(task.id, userId, 'TITLE_CHANGED', 'Updated task title');
  }
  if (dueDateChanged || dueTimeChanged) {
    await createActivity(task.id, userId, 'DUE_DATE_CHANGED', 'Rescheduled task');
  }
  if (data.description !== undefined) {
    await createActivity(task.id, userId, 'DESCRIPTION_CHANGED', 'Updated task details');
  }
  if (data.attachmentUrl !== undefined && data.attachmentUrl !== previousAttachmentUrl) {
    await deleteStoredFile(previousAttachmentUrl);
  }
  if (data.voiceNoteUrl !== undefined && data.voiceNoteUrl !== previousVoiceNoteUrl) {
    await deleteStoredFile(previousVoiceNoteUrl);
  }

  // If task is being unmarked (DONE → non-DONE/TODO), delete spawned occurrences
  // scheduled AFTER this task's due date (or created after if no due date).
  // This rolls back the recurring chain from this point forward without
  // affecting past completed occurrences prior to this date.
  if (
    !wasNotDone &&
    existing.status === 'DONE' &&
    data.status !== undefined &&
    data.status !== 'DONE' &&
    existing.recurrenceRule
  ) {
    const rootId = existing.parentTaskId ?? taskId;
    const spawnedOccurrences = await prisma.task.findMany({
      where: {
        parentTaskId: rootId,
        recurrenceRule: { not: null },
        id: { not: taskId },
        ...(existing.dueDate ? { dueDate: { gt: existing.dueDate } } : { createdAt: { gt: existing.createdAt } }),
      },
    });
    const deletedTaskIds = spawnedOccurrences.map((occ) => occ.id);
    for (const occ of spawnedOccurrences) {
      await prisma.subTask.deleteMany({ where: { taskId: occ.id } });
      await prisma.task.delete({ where: { id: occ.id } });
    }
    // Delete the Google Calendar events and their sync items for removed tasks
    if (deletedTaskIds.length > 0) {
      // Fire-and-forget: delete from Google Calendar
      deleteGoogleCalendarEvents(userId, deletedTaskIds).catch(() => {});
      console.log(
        `Deleted ${spawnedOccurrences.length} spawned occurrence(s) after ${existing.dueDate?.toISOString() ?? existing.createdAt.toISOString()} for unmarked task ${taskId}`
      );
    }
  }

  const projectTask = await prisma.projectTask.findUnique({ where: { taskId } });
  if (projectTask) {
    await updateProjectProgress(projectTask.projectId);
  }

  const effectiveGoalId = data.goalId !== undefined ? data.goalId || null : (existing.goalId ?? null);
  if (effectiveGoalId) {
    await recomputeGoalProgress(effectiveGoalId).catch(() => undefined);
  }

  // Fire-and-forget: sync to Google Calendar if connected
  triggerCalendarSync(userId);

  return toDTO(task);
}

export async function deleteTask(userId: string, taskId: string): Promise<void> {
  const existing = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!existing) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  const projectTask = await prisma.projectTask.findUnique({ where: { taskId } });

  // If task was completed, deduct the XP before deleting
  if (existing.status === 'DONE') {
    await deleteTaskPoints(userId, existing.id, existing.title);
  }

  await prisma.task.delete({ where: { id: taskId } });

  // Clean up the Google Calendar sync item for this task
  await prisma.googleCalendarSyncItem.deleteMany({
    where: { userId, localType: 'TASK', localId: taskId },
  });

  if (projectTask) {
    await updateProjectProgress(projectTask.projectId);
  }

  if (existing.goalId) {
    await recomputeGoalProgress(existing.goalId).catch(() => undefined);
  }

  // Fire-and-forget: sync to Google Calendar if connected
  triggerCalendarSync(userId);
}

export async function synchronizeRecurringTasks(userId?: string): Promise<void> {
  const recurringRoots = await prisma.task.findMany({
    where: {
      ...(userId ? { userId } : {}),
      recurrenceRule: { not: null },
      parentTaskId: null,
    },
    include: {
      subTasks: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
      projectTasks: true,
      goal: true,
    },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const root of recurringRoots) {
    try {
      await prisma.$transaction(async (tx) => {
        const rootId = root.id;
        const cfg = (root as any).recurrenceConfig as TaskRecurrenceConfig | null;
        const generateNext = cfg?.generateNext ?? 'onCompletion';

        const activeOccurrence = await tx.task.findFirst({
          where: {
            userId: root.userId,
            OR: [{ id: rootId }, { parentTaskId: rootId }],
            status: { in: [...ACTIVE_RECURRING_STATUSES] },
          },
        });
        if (activeOccurrence) return;

        const latestOccurrence = await tx.task.findFirst({
          where: {
            userId: root.userId,
            OR: [{ id: rootId }, { parentTaskId: rootId }],
            dueDate: { not: null },
          },
          orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
        });
        if (!latestOccurrence?.dueDate) return;

        // For 'onDueDate' tasks: only create when the latest due date has arrived.
        // For 'onCompletion' tasks: the completion handler normally spawns; the cron
        // acts as a safety net for any that were missed.
        if (generateNext === 'onDueDate') {
          const latestDueKey = dateKeyInTimeZone(latestOccurrence.dueDate, 'UTC');
          const todayKey = dateKeyInTimeZone(today, 'UTC');
          if (latestDueKey > todayKey) return; // not yet due
        }

        await createNextRecurringOccurrence(
          tx,
          {
            ...root,
            dueDate: latestOccurrence.dueDate,
            recurrenceConfig: cfg,
          },
          rootId,
          { recurrenceConfig: cfg }
        );
      });
    } catch (err: any) {
      if (err?.code !== 'P2002') {
        console.error(`[Recurrence] Failed to synchronize recurring task ${root.id}:`, err);
      }
    }
  }
}

// Subtask CRUD
export async function listSubTasks(userId: string, taskId: string): Promise<SubTaskDTO[]> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  const subTasks = await prisma.subTask.findMany({
    where: { taskId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });
  return subTasks.map(subTaskToDTO);
}

export async function createSubTask(userId: string, taskId: string, data: CreateSubTaskRequest): Promise<SubTaskDTO> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  const title = normalizeSubTaskTitle(data.title);
  if (!title) throw createError(400, 'INVALID_SUBTASK_TITLE', 'Subtask title is required');
  const nextOrder =
    data.order ??
    ((await prisma.subTask.findFirst({ where: { taskId }, orderBy: { order: 'desc' } }))?.order ?? -1) + 1;
  const subTask = await prisma.subTask.create({
    data: {
      taskId,
      title,
      order: nextOrder,
    },
  });
  await createActivity(taskId, userId, 'SUBTASK_CREATED', `Added subtask "${title}"`);
  return subTaskToDTO(subTask);
}

export async function updateSubTask(
  userId: string,
  taskId: string,
  subTaskId: string,
  data: UpdateSubTaskRequest
): Promise<SubTaskDTO> {
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
    },
  });
  if (data.completed !== undefined) {
    await createActivity(
      taskId,
      userId,
      data.completed ? 'SUBTASK_COMPLETED' : 'SUBTASK_REOPENED',
      `Updated subtask "${updated.title}"`
    );
  }
  return subTaskToDTO(updated);
}

export async function deleteSubTask(userId: string, taskId: string, subTaskId: string): Promise<void> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  const subTask = await prisma.subTask.findFirst({ where: { id: subTaskId, taskId } });
  if (!subTask) throw createError(404, 'SUBTASK_NOT_FOUND', 'Subtask not found');
  await prisma.subTask.delete({ where: { id: subTaskId } });
  await createActivity(taskId, userId, 'SUBTASK_DELETED', `Deleted subtask "${subTask.title}"`);
}

export async function createTaskTimeEntry(userId: string, taskId: string, data: CreateTaskTimeEntryRequest) {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  if (data.minutes <= 0) throw createError(400, 'INVALID_TIME_ENTRY', 'Minutes must be positive');
  const entry = await prisma.taskTimeEntry.create({
    data: {
      taskId,
      userId,
      minutes: data.minutes,
      note: data.note?.trim() || null,
      startedAt: data.startedAt ? new Date(data.startedAt) : null,
    },
  });
  await createActivity(taskId, userId, 'TIME_LOGGED', `Logged ${data.minutes} minutes`);
  return timeEntryToDTO(entry);
}

/** Add a media item to a task */
export async function addTaskMedia(
  userId: string,
  taskId: string,
  url: string,
  type: 'attachment' | 'voice_note',
  fileName?: string,
  mimeType?: string,
  size?: number
): Promise<void> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');

  await prisma.taskMedia.create({
    data: {
      taskId,
      url,
      type,
      fileName: fileName ?? null,
      mimeType: mimeType ?? null,
      size: size ?? null,
    },
  });
}

/** Remove a media item from a task */
export async function removeTaskMedia(userId: string, taskId: string, mediaId: string): Promise<void> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');

  const media = await prisma.taskMedia.findFirst({
    where: { id: mediaId, taskId },
  });
  if (!media) throw createError(404, 'MEDIA_NOT_FOUND', 'Media item not found');

  await prisma.taskMedia.delete({ where: { id: mediaId } });
  await deleteStoredFile(media.url);
}
