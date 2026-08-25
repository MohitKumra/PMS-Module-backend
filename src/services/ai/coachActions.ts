// backend/src/services/ai/coachActions.ts
// Server-side validated entity creation triggered by the AI coach.
// Raw LLM output NEVER touches the DB directly — every field is validated
// against the real Create*Request types and service constraints before writing.

import { z } from 'zod';
import { createError } from '../../middleware/errorHandler';
import { createTask } from '../task.service';
import { createHabit } from '../habit.service';
import { createGoal } from '../goal.service';
import { createProject } from '../project.service';
import type { TaskDTO, HabitDTO, GoalDTO, ProjectDTO, TaskRecurrenceConfig } from '../../types';
import {
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  GOAL_CATEGORY_OPTIONS,
  GOAL_PRIORITY_OPTIONS,
  GOAL_STATUS_OPTIONS,
  PROJECT_STATUS_OPTIONS,
} from './prompts/entityPrompts';

// ─── Validation schemas ───────────────────────────────────────────────────────
// These mirror the real Create*Request types and add safe coercions for
// values that come through the LLM (e.g. relative date labels → ISO strings).

const TIME_RE = /^\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Coerce a relative date label (from the option chips) or a raw YYYY-MM-DD
 * string into a YYYY-MM-DD string. Returns null when unrecognised.
 */
function coerceDate(value: string | null | undefined): string | null {
  if (!value || value === 'No due date' || value === 'No target date') return null;
  if (DATE_RE.test(value)) return value;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const addDays = (n: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const addMonths = (n: number) => {
    const d = new Date(today);
    d.setUTCMonth(d.getUTCMonth() + n);
    return d.toISOString().slice(0, 10);
  };

  const v = value.toLowerCase().trim().replace(/\s+/g, ' ');

  // Exact matches
  if (v === 'today') return addDays(0);
  if (v === 'tomorrow') return addDays(1);
  if (v === 'this week') return addDays(6 - today.getUTCDay());
  if (v === 'next week') return addDays(7 + (7 - today.getUTCDay()));
  if (v === '1 week') return addDays(7);
  if (v === '2 weeks') return addDays(14);
  if (v === '1 month') return addMonths(1);
  if (v === '3 months') return addMonths(3);
  if (v === '6 months') return addMonths(6);
  if (v === '1 year') return addMonths(12);

  // Day of week handling: "friday", "next friday", "this friday"
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const isNext = v.startsWith('next ');
  const dayMatch = dayNames.findIndex((day) => v.endsWith(day) || v === day);

  if (dayMatch !== -1) {
    const currentDay = today.getUTCDay();
    let daysUntil = dayMatch - currentDay;

    if (isNext) {
      // "next friday" always means the friday in the next week
      daysUntil = daysUntil <= 0 ? daysUntil + 7 : daysUntil + 7;
    } else {
      // "friday" or "this friday" means upcoming occurrence (including today if it's friday)
      if (daysUntil < 0) daysUntil += 7;
    }

    return addDays(daysUntil);
  }

  return null;
}

/**
 * Coerce a reminder label (from the option chips) into an HH:mm string.
 * Returns null when unrecognised.
 */
function coerceTime(value: string | null | undefined): string | null {
  if (!value || value === 'No reminder') return null;

  // Already in HH:mm format
  if (TIME_RE.test(value)) return value;

  // Extract from parentheses: "Morning (09:00)"
  const parenMatch = value.match(/\((\d{2}:\d{2})\)/);
  if (parenMatch) return parenMatch[1];

  // Handle common time formats: "2pm", "2:30pm", "14:00", "2:30 pm"
  const v = value.toLowerCase().trim().replace(/\s+/g, '');

  // Match "2pm", "14:30", "2:30pm"
  const timeMatch = v.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3];

    // Convert 12-hour to 24-hour
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    // Validate
    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * The LLM emits every optional field in entityDraft.fields and uses `null` for
 * missing ones (`fields` is typed `Record<string, string | null>`). Zod's
 * `.optional()` only accepts `undefined`, not explicit `null`, so those nulls
 * must be stripped before validating. Removing them is safe because every
 * underlying Create*Request field is optional and the service already falls
 * back to its default (?? default / ?? undefined / ?? null) when omitted.
 */
function stripNulls<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value != null)) as Partial<T>;
}

/**
 * Coerce the habit skip-days field (day names, numeric indices, or numeric
 * strings) to a sorted, de-duplicated array of numeric indices.
 * 0=Mon … 6=Sun, matching the backend convention used in habit.service.ts
 * The LLM may emit any of: "Saturday"/["Saturday","Sunday"], [5,6], ["5","6"].
 */
export function coerceSkipDays(value: unknown): number[] {
  const DAY_MAP: Record<string, number> = {
    monday: 0,
    tuesday: 1,
    wednesday: 2,
    thursday: 3,
    friday: 4,
    saturday: 5,
    sunday: 6,
  };
  if (value == null || value === '') return [];

  const arr = Array.isArray(value) ? value : [value];
  const result = new Set<number>();

  for (const item of arr) {
    if (item == null) continue;

    // Already a numeric index (0-6)
    if (typeof item === 'number') {
      if (Number.isInteger(item) && item >= 0 && item <= 6) result.add(item);
      continue;
    }

    const raw = String(item).trim().toLowerCase();
    if (!raw) continue;

    // Handle comma-delimited single string: "Saturday, Sunday" or "5,6"
    const pieces = raw.includes(',') ? raw.split(',').map((p) => p.trim()) : [raw];

    for (const s of pieces) {
      if (!s) continue;
      // Day name: "saturday", "Saturday"
      const named = DAY_MAP[s];
      if (named !== undefined) {
        result.add(named);
        continue;
      }
      // Numeric string: "5" or "6"
      const numeric = Number(s);
      if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) result.add(numeric);
    }
  }

  return [...result].sort((a, b) => a - b);
}

/**
 * Normalize the subtask drafts the LLM produced into the shape createTask()
 * expects: `{ title, order }[]`. Accepts an array of plain title strings
 * and/or objects. Titles are trimmed and empty entries dropped, then ordered.
 */
export function normalizeSubTasks(
  value: Array<{ title?: string } | string> | { title?: string } | string | null | undefined
): Array<{ title: string; order: number }> {
  const arr = Array.isArray(value) ? value : value == null ? [] : [value];
  const result: Array<{ title: string; order: number }> = [];

  arr.forEach((item) => {
    const title = typeof item === 'string' ? item : item?.title;
    const t = (title ?? '').trim();
    if (!t) return;
    // Preserve existing order when provided, otherwise use array position.
    const order =
      typeof item === 'object' && item !== null && (item as { order?: number }).order != null
        ? (item as { order?: number }).order!
        : result.length;
    result.push({ title: t, order });
  });

  return result;
}

// ─── Task ─────────────────────────────────────────────────────────────────────

const CoachTaskDraftSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  priority: z.enum(TASK_PRIORITY_OPTIONS).optional(),
  dueDate: z.string().optional().nullable(),
  dueTime: z.string().optional().nullable(),
  reminderTime: z.string().optional().nullable(),
  reminderMessage: z.string().max(200).optional().nullable(),
  status: z.enum(TASK_STATUS_OPTIONS).optional(),
  subTasks: z
    .union([z.array(z.object({ title: z.string().min(1).max(200) })), z.array(z.string().min(1).max(200))])
    .optional(),
  recurrence: z.string().optional().nullable(),
});

export type CoachTaskDraft = z.infer<typeof CoachTaskDraftSchema>;

function parseRecurrencePattern(
  pattern: string | null | undefined,
  dueDate: string | null
): TaskRecurrenceConfig | undefined {
  if (!pattern || pattern === 'none') return undefined;
  const startsAt = dueDate ?? new Date().toISOString().slice(0, 10);
  const parts = pattern.toLowerCase().split(':');
  const base = parts[0];
  const options = parts[1]?.split(',').map((s) => s.trim());

  if (base === 'daily-skip' && options) {
    const allDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const skipDays = options.map((d) => d.toLowerCase());
    const includeDays = allDays.filter((d) => !skipDays.includes(d));
    return {
      enabled: true,
      frequency: 'week',
      interval: 1,
      weekdays: includeDays,
      startsAt,
      endsType: 'never',
      repeatBasedOn: 'dueDate',
      missedBehavior: 'skip',
      generateNext: 'onCompletion',
    };
  }
  if (base === 'daily') {
    return {
      enabled: true,
      frequency: 'day',
      interval: 1,
      startsAt,
      endsType: 'never',
      repeatBasedOn: 'dueDate',
      missedBehavior: 'skip',
      generateNext: 'onCompletion',
    };
  }
  if (base === 'weekly') {
    return {
      enabled: true,
      frequency: 'week',
      interval: 1,
      weekdays: options || undefined,
      startsAt,
      endsType: 'never',
      repeatBasedOn: 'dueDate',
      missedBehavior: 'skip',
      generateNext: 'onCompletion',
    };
  }
  if (base === 'biweekly') {
    return {
      enabled: true,
      frequency: 'week',
      interval: 2,
      startsAt,
      endsType: 'never',
      repeatBasedOn: 'dueDate',
      missedBehavior: 'skip',
      generateNext: 'onCompletion',
    };
  }
  if (base === 'monthly') {
    const dayOfMonth = options && options[0] ? parseInt(options[0], 10) : undefined;
    return {
      enabled: true,
      frequency: 'month',
      interval: 1,
      monthlyMode: dayOfMonth ? 'dayOfMonth' : undefined,
      dayOfMonth: dayOfMonth || null,
      startsAt,
      endsType: 'never',
      repeatBasedOn: 'dueDate',
      missedBehavior: 'skip',
      generateNext: 'onCompletion',
    };
  }
  if (base === 'quarterly') {
    return {
      enabled: true,
      frequency: 'month',
      interval: 3,
      startsAt,
      endsType: 'never',
      repeatBasedOn: 'dueDate',
      missedBehavior: 'skip',
      generateNext: 'onCompletion',
    };
  }
  if (base === 'yearly') {
    return {
      enabled: true,
      frequency: 'year',
      interval: 1,
      startsAt,
      endsType: 'never',
      repeatBasedOn: 'dueDate',
      missedBehavior: 'skip',
      generateNext: 'onCompletion',
    };
  }
  return undefined;
}

export async function createTaskFromCoach(userId: string, draft: CoachTaskDraft): Promise<TaskDTO> {
  const parsed = CoachTaskDraftSchema.safeParse(stripNulls(draft));
  if (!parsed.success) {
    console.error('[Coach] Task draft validation failed:', parsed.error);
    throw createError(400, 'INVALID_TASK_DRAFT', 'Invalid task draft from coach');
  }
  const d = parsed.data;

  const dueDate = coerceDate(d.dueDate ?? null);
  const dueTime = coerceTime(d.dueTime ?? null);
  const reminderTime = coerceTime(d.reminderTime ?? null);
  const recurrenceConfig = parseRecurrencePattern(d.recurrence, dueDate);

  return createTask(userId, {
    title: d.title,
    description: d.description,
    priority: d.priority ?? 'MEDIUM',
    status: d.status ?? 'TODO',
    dueDate: dueDate ?? undefined,
    dueTime,
    reminderTime,
    reminderMessage: d.reminderMessage ?? null,
    subTasks: normalizeSubTasks(d.subTasks as Array<{ title?: string } | string> | undefined),
    recurrenceConfig,
  });
}

// ─── Habit ────────────────────────────────────────────────────────────────────

const CoachHabitDraftSchema = z.object({
  title: z.string().min(1).max(200),
  reminderTime: z.string().optional().nullable(),
  reminderMessage: z.string().max(200).optional().nullable(),
  skipDays: z
    .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
    .optional()
    .nullable(),
  durationDays: z.number().int().positive().optional().nullable(),
  goalId: z.string().optional().nullable(),
});

export type CoachHabitDraft = z.infer<typeof CoachHabitDraftSchema>;

export async function createHabitFromCoach(userId: string, draft: CoachHabitDraft): Promise<HabitDTO> {
  const parsed = CoachHabitDraftSchema.safeParse(stripNulls(draft));
  if (!parsed.success) {
    throw createError(400, 'INVALID_HABIT_DRAFT', 'Invalid habit draft from coach');
  }
  const d = parsed.data;
  const reminderTime = coerceTime(d.reminderTime ?? null);
  const skipDays = coerceSkipDays(d.skipDays ?? null);

  return createHabit(userId, {
    title: d.title,
    reminderTime: reminderTime ?? undefined,
    reminderMessage: d.reminderMessage ?? undefined,
    skipDays,
    durationDays: d.durationDays ?? null,
    goalId: d.goalId ?? null,
  });
}

// ─── Goal ─────────────────────────────────────────────────────────────────────

const CoachGoalDraftSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(600).optional(),
  category: z.enum(GOAL_CATEGORY_OPTIONS).optional().nullable(),
  priority: z.enum(GOAL_PRIORITY_OPTIONS).optional(),
  status: z.enum(GOAL_STATUS_OPTIONS).optional(),
  targetDate: z.string().optional().nullable(),
  color: z.string().max(12).optional(),
  icon: z.string().max(60).optional(),
});

export type CoachGoalDraft = z.infer<typeof CoachGoalDraftSchema>;

export async function createGoalFromCoach(userId: string, draft: CoachGoalDraft): Promise<GoalDTO> {
  const parsed = CoachGoalDraftSchema.safeParse(stripNulls(draft));
  if (!parsed.success) {
    throw createError(400, 'INVALID_GOAL_DRAFT', 'Invalid goal draft from coach');
  }
  const d = parsed.data;
  const targetDate = coerceDate(d.targetDate ?? null);

  return createGoal(userId, {
    title: d.title,
    description: d.description,
    category: d.category ?? undefined,
    priority: d.priority ?? 'MEDIUM',
    status: d.status ?? 'ACTIVE',
    targetDate: targetDate ?? undefined,
    color: d.color ?? '#4F46E5',
    icon: d.icon ?? 'target',
  });
}

// ─── Project ──────────────────────────────────────────────────────────────────

const CoachProjectDraftSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(600).optional(),
  status: z.enum(PROJECT_STATUS_OPTIONS).optional(),
  color: z.string().max(12).optional(),
  startDate: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  goalId: z.string().optional().nullable(),
});

export type CoachProjectDraft = z.infer<typeof CoachProjectDraftSchema>;

export async function createProjectFromCoach(userId: string, draft: CoachProjectDraft): Promise<ProjectDTO> {
  const parsed = CoachProjectDraftSchema.safeParse(stripNulls(draft));
  if (!parsed.success) {
    throw createError(400, 'INVALID_PROJECT_DRAFT', 'Invalid project draft from coach');
  }
  const d = parsed.data;
  const dueDate = coerceDate(d.dueDate ?? null);
  const startDate = coerceDate(d.startDate ?? null);

  return createProject(userId, {
    name: d.name,
    description: d.description,
    status: d.status ?? 'PLANNING',
    color: d.color ?? '#4F46E5',
    startDate: startDate ?? undefined,
    dueDate: dueDate ?? undefined,
    goalId: d.goalId ?? null,
  });
}

// ─── Unified confirm dispatcher ───────────────────────────────────────────────

export type CoachConfirmEntityRequest =
  | { entity: 'task'; draft: CoachTaskDraft }
  | { entity: 'habit'; draft: CoachHabitDraft }
  | { entity: 'goal'; draft: CoachGoalDraft }
  | { entity: 'project'; draft: CoachProjectDraft };

export type CoachConfirmEntityResponse =
  | { entity: 'task'; result: TaskDTO }
  | { entity: 'habit'; result: HabitDTO }
  | { entity: 'goal'; result: GoalDTO }
  | { entity: 'project'; result: ProjectDTO };

export async function confirmCoachEntity(
  userId: string,
  req: CoachConfirmEntityRequest
): Promise<CoachConfirmEntityResponse> {
  switch (req.entity) {
    case 'task':
      return { entity: 'task', result: await createTaskFromCoach(userId, req.draft) };
    case 'habit':
      return { entity: 'habit', result: await createHabitFromCoach(userId, req.draft) };
    case 'goal':
      return { entity: 'goal', result: await createGoalFromCoach(userId, req.draft) };
    case 'project':
      return { entity: 'project', result: await createProjectFromCoach(userId, req.draft) };
    default: {
      const _exhaustive: never = req;
      throw createError(400, 'UNKNOWN_ENTITY', 'Unknown entity type');
    }
  }
}
