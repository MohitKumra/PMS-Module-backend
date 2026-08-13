import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { listTasks } from './task.service';
import { listHabits } from './habit.service';
import { listProjects } from './project.service';
import { updateProjectProgress } from './project.service';
import { awardGoalCompletion } from './gamification.service';
import type {
  GoalDTO,
  GoalMilestoneDTO,
  CreateGoalRequest,
  UpdateGoalRequest,
  CreateGoalMilestoneRequest,
  UpdateGoalMilestoneRequest,
  GoalWorkspaceCreateResponse,
  GoalPlannerPlanDTO,
} from '../types';

type GoalWithRelations = NonNullable<Awaited<ReturnType<typeof loadGoal>>>;

function clampProgress(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function uniqueIds(ids?: string[]): string[] {
  return Array.from(new Set((ids ?? []).map((id) => id.trim()).filter(Boolean)));
}

function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function weekStartUtc(): Date {
  const today = utcToday();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start;
}

async function loadGoal(userId: string, goalId: string) {
  return prisma.goal.findFirst({
    where: { id: goalId, userId },
    include: {
      milestones: { orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }] },
      habits: {
        select: {
          id: true,
          goalId: true,
          targetPerWeek: true,
          completions: { select: { date: true } },
        },
      },
      tasks: {
        select: {
          id: true,
          goalId: true,
          status: true,
        },
      },
      projects: {
        select: {
          id: true,
          goalId: true,
          progress: true,
        },
      },
    },
  });
}

/**
 * Compute goal progress from real, derived signals only:
 *   Milestones 35%  → completed / (total − skipped)
 *   Tasks      25%  → done / (total − cancelled)
 *   Projects   20%  → average linked project progress
 *   Habits     20%  → 4-week rolling completion consistency (smoothed)
 *
 * No manual input is ever used — every factor comes from user actions.
 */
function calculateProgress(goal: GoalWithRelations): number {
  const now = utcToday();

  // ── Milestones (35%) ──────────────────────────────────────────────
  const activeMilestones = goal.milestones.filter((m) => m.status !== 'SKIPPED');
  const milestoneScore =
    activeMilestones.length === 0
      ? 0
      : activeMilestones.filter((m) => m.status === 'COMPLETED').length / activeMilestones.length;

  // ── Tasks (25%) ───────────────────────────────────────────────────
  const activeTasks = goal.tasks.filter((t) => t.status !== 'CANCELLED');
  const taskScore =
    activeTasks.length === 0 ? 0 : activeTasks.filter((t) => t.status === 'DONE').length / activeTasks.length;

  // ── Projects (20%) ────────────────────────────────────────────────
  const projectScore =
    goal.projects.length === 0
      ? 0
      : goal.projects.reduce((sum, project) => sum + clampProgress(project.progress) / 100, 0) / goal.projects.length;

  // ── Habits (20%) — 4-week rolling consistency ─────────────────────
  // For each habit, average the weekly completion ratio over the last 4
  // weeks (capped at 1 per week), then average across habits. This smooths
  // single-week noise and rewards sustained momentum.
  const habitScore =
    goal.habits.length === 0
      ? 0
      : goal.habits.reduce((sum, habit) => {
          const target = Math.max(habit.targetPerWeek || 1, 1);
          let weeksSum = 0;
          for (let w = 0; w < 4; w++) {
            const weekEnd = new Date(now);
            weekEnd.setUTCDate(weekEnd.getUTCDate() - w * 7);
            const weekStart = new Date(weekEnd);
            weekStart.setUTCDate(weekStart.getUTCDate() - 6);
            const completionsInWeek = habit.completions.filter((completion) => {
              const d = new Date(completion.date);
              return d >= weekStart && d <= weekEnd;
            }).length;
            weeksSum += Math.min(1, completionsInWeek / target);
          }
          return sum + weeksSum / 4;
        }, 0) / goal.habits.length;

  const weighted = milestoneScore * 0.35 + taskScore * 0.25 + projectScore * 0.2 + habitScore * 0.2;
  return Math.max(0, Math.min(100, Math.round(weighted * 100)));
}

/**
 * Recompute and persist a goal's progress from its linked work.
 * Also auto-completes the goal when progress reaches 100%.
 * Safe to call from any service that mutates linked tasks/habits/projects/milestones.
 */
export async function recomputeGoalProgress(goalId: string): Promise<void> {
  const goal = await loadGoalForRecompute(goalId);
  if (!goal) return;

  const progress = calculateProgress(goal as any);
  const nextStatus = progress >= 100 && goal.status === 'ACTIVE' ? 'COMPLETED' : goal.status;

  await prisma.goal.update({
    where: { id: goalId },
    data: { progress, ...(nextStatus !== goal.status ? { status: nextStatus } : {}) },
  });

  // Award XP (and re-evaluate achievements) exactly once when a goal tips over
  // to COMPLETED. The PointLedger unique constraint on (userId, reason,
  // entityType, entityId) makes this idempotent even though recompute is fired
  // from many call sites, so we never double-award.
  if (nextStatus === 'COMPLETED' && goal.status !== 'COMPLETED') {
    await awardGoalCompletion(goal.userId, goalId, goal.title).catch(() => undefined);
  }
}

async function loadGoalForRecompute(goalId: string) {
  return prisma.goal.findUnique({
    where: { id: goalId },
    include: {
      milestones: { select: { status: true } },
      habits: {
        select: {
          id: true,
          targetPerWeek: true,
          completions: { select: { date: true } },
        },
      },
      tasks: { select: { id: true, status: true } },
      projects: { select: { id: true, progress: true } },
    },
  });
}

function toDTO(goal: GoalWithRelations): GoalDTO {
  const progress = calculateProgress(goal);
  return {
    id: goal.id,
    userId: goal.userId,
    title: goal.title,
    description: goal.description ?? null,
    category: goal.category ?? null,
    icon: goal.icon ?? null,
    color: goal.color ?? '#4F46E5',
    targetDate: goal.targetDate?.toISOString() ?? null,
    status: goal.status as GoalDTO['status'],
    priority: goal.priority as GoalDTO['priority'],
    progress,
    aiSummary: goal.aiSummary ?? null,
    linkedHabitIds: goal.habits.map((habit) => habit.id),
    linkedTaskIds: goal.tasks.map((task) => task.id),
    linkedProjectIds: goal.projects.map((project) => project.id),
    milestones: goal.milestones.map(toMilestoneDTO),
    habitCount: goal.habits.length,
    taskCount: goal.tasks.length,
    projectCount: goal.projects.length,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

function toMilestoneDTO(milestone: any): GoalMilestoneDTO {
  return {
    id: milestone.id,
    goalId: milestone.goalId,
    title: milestone.title,
    description: milestone.description ?? null,
    dueDate: milestone.dueDate?.toISOString() ?? null,
    status: milestone.status,
    sortOrder: milestone.sortOrder,
    completedAt: milestone.completedAt?.toISOString() ?? null,
    createdAt: milestone.createdAt.toISOString(),
    updatedAt: milestone.updatedAt.toISOString(),
  };
}

async function assertOwnedIds(userId: string, ids: string[], model: 'habit' | 'task' | 'project') {
  if (ids.length === 0) return;
  const count = await (model === 'habit'
    ? prisma.habit.count({ where: { userId, id: { in: ids } } })
    : model === 'task'
      ? prisma.task.count({ where: { userId, id: { in: ids } } })
      : prisma.project.count({ where: { userId, id: { in: ids } } }));
  if (count !== ids.length) {
    const code = model === 'habit' ? 'HABIT_NOT_FOUND' : model === 'task' ? 'TASK_NOT_FOUND' : 'PROJECT_NOT_FOUND';
    throw createError(404, code, `${model.charAt(0).toUpperCase() + model.slice(1)} not found`);
  }
}

async function syncLinks(
  tx: any,
  userId: string,
  goalId: string,
  currentIds: { habits: string[]; tasks: string[]; projects: string[] },
  nextIds: { habits: string[]; tasks: string[]; projects: string[] }
) {
  const updateLinks = async (model: 'habit' | 'task' | 'project', ids: string[], current: string[]) => {
    const toKeep = new Set(ids);
    const toClear = current.filter((id) => !toKeep.has(id));
    if (toClear.length > 0) {
      await (model === 'habit'
        ? tx.habit.updateMany({ where: { userId, goalId, id: { in: toClear } }, data: { goalId: null } })
        : model === 'task'
          ? tx.task.updateMany({ where: { userId, goalId, id: { in: toClear } }, data: { goalId: null } })
          : tx.project.updateMany({ where: { userId, goalId, id: { in: toClear } }, data: { goalId: null } }));
    }
    if (ids.length > 0) {
      await (model === 'habit'
        ? tx.habit.updateMany({ where: { userId, id: { in: ids } }, data: { goalId } })
        : model === 'task'
          ? tx.task.updateMany({ where: { userId, id: { in: ids } }, data: { goalId } })
          : tx.project.updateMany({ where: { userId, id: { in: ids } }, data: { goalId } }));
    }
  };

  await updateLinks('habit', nextIds.habits, currentIds.habits);
  await updateLinks('task', nextIds.tasks, currentIds.tasks);
  await updateLinks('project', nextIds.projects, currentIds.projects);
}

export interface GoalListFilters {
  status?: string; // 'ALL' | GoalStatus
  search?: string;
  sort?: string; // 'latest' | 'oldest' | 'progress' | 'name'
}

export async function listGoals(
  userId: string,
  filters: GoalListFilters = {}
): Promise<{ data: GoalDTO[]; meta: { total: number } }> {
  const goals = await prisma.goal.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      habits: { select: { id: true, goalId: true, targetPerWeek: true, completions: { select: { date: true } } } },
      tasks: { select: { id: true, goalId: true, status: true } },
      projects: { select: { id: true, goalId: true, progress: true } },
      milestones: { orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }] },
    },
  });

  // Filter / search / sort on the server, mirroring the previous frontend logic.
  let data = goals.map((goal) => toDTO(goal as any));

  const status = filters.status ?? 'ALL';
  if (status !== 'ALL') data = data.filter((goal) => goal.status === status);

  const term = (filters.search ?? '').trim().toLowerCase();
  if (term) {
    data = data.filter((goal) =>
      [goal.title, goal.description, goal.category, goal.aiSummary]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }

  switch (filters.sort) {
    case 'oldest':
      data = [...data].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      break;
    case 'progress':
      data = [...data].sort((a, b) => b.progress - a.progress);
      break;
    case 'name':
      data = [...data].sort((a, b) => a.title.localeCompare(b.title));
      break;
    default: // 'latest'
      data = [...data].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  return { data, meta: { total: data.length } };
}

export async function getGoal(userId: string, goalId: string): Promise<GoalDTO> {
  const goal = await loadGoal(userId, goalId);
  if (!goal) throw createError(404, 'GOAL_NOT_FOUND', 'Goal not found');
  return toDTO(goal as any);
}

export async function createGoal(userId: string, data: CreateGoalRequest): Promise<GoalDTO> {
  const linkedHabitIds = uniqueIds(data.linkedHabitIds);
  const linkedTaskIds = uniqueIds(data.linkedTaskIds);
  const linkedProjectIds = uniqueIds(data.linkedProjectIds);

  await assertOwnedIds(userId, linkedHabitIds, 'habit');
  await assertOwnedIds(userId, linkedTaskIds, 'task');
  await assertOwnedIds(userId, linkedProjectIds, 'project');

  const goal = await prisma.$transaction(async (tx) => {
    const created = await tx.goal.create({
      data: {
        userId,
        title: data.title,
        description: data.description ?? null,
        category: data.category ?? null,
        icon: data.icon ?? null,
        color: data.color ?? '#4F46E5',
        targetDate: data.targetDate ? new Date(data.targetDate) : null,
        status: data.status ?? 'ACTIVE',
        priority: data.priority ?? 'MEDIUM',
        aiSummary: data.aiSummary ?? null,
      },
    });

    await syncLinks(
      tx as any,
      userId,
      created.id,
      { habits: [], tasks: [], projects: [] },
      { habits: linkedHabitIds, tasks: linkedTaskIds, projects: linkedProjectIds }
    );

    return tx.goal.findUnique({
      where: { id: created.id },
      include: {
        habits: { select: { id: true, goalId: true, targetPerWeek: true, completions: { select: { date: true } } } },
        tasks: { select: { id: true, goalId: true, status: true } },
        projects: { select: { id: true, goalId: true, progress: true } },
        milestones: { orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }] },
      },
    });
  });

  if (!goal) throw createError(500, 'GOAL_CREATE_FAILED', 'Goal creation failed');
  return toDTO(goal as any);
}

export async function updateGoal(userId: string, goalId: string, data: UpdateGoalRequest): Promise<GoalDTO> {
  const existing = await loadGoal(userId, goalId);
  if (!existing) throw createError(404, 'GOAL_NOT_FOUND', 'Goal not found');

  const nextHabitIds = data.linkedHabitIds ? uniqueIds(data.linkedHabitIds) : existing.habits.map((habit) => habit.id);
  const nextTaskIds = data.linkedTaskIds ? uniqueIds(data.linkedTaskIds) : existing.tasks.map((task) => task.id);
  const nextProjectIds = data.linkedProjectIds
    ? uniqueIds(data.linkedProjectIds)
    : existing.projects.map((project) => project.id);

  await assertOwnedIds(userId, nextHabitIds, 'habit');
  await assertOwnedIds(userId, nextTaskIds, 'task');
  await assertOwnedIds(userId, nextProjectIds, 'project');

  const goal = await prisma.$transaction(async (tx) => {
    await tx.goal.update({
      where: { id: goalId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.icon !== undefined && { icon: data.icon }),
        ...(data.color !== undefined && { color: data.color }),
        ...(data.targetDate !== undefined && { targetDate: data.targetDate ? new Date(data.targetDate) : null }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.aiSummary !== undefined && { aiSummary: data.aiSummary }),
      },
    });

    await syncLinks(
      tx as any,
      userId,
      goalId,
      {
        habits: existing.habits.map((habit) => habit.id),
        tasks: existing.tasks.map((task) => task.id),
        projects: existing.projects.map((project) => project.id),
      },
      {
        habits: nextHabitIds,
        tasks: nextTaskIds,
        projects: nextProjectIds,
      }
    );

    return tx.goal.findUnique({
      where: { id: goalId },
      include: {
        habits: { select: { id: true, goalId: true, targetPerWeek: true, completions: { select: { date: true } } } },
        tasks: { select: { id: true, goalId: true, status: true } },
        projects: { select: { id: true, goalId: true, progress: true } },
        milestones: { orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }] },
      },
    });
  });

  if (!goal) throw createError(500, 'GOAL_UPDATE_FAILED', 'Goal update failed');
  return toDTO(goal as any);
}

export interface DeleteGoalOptions {
  /** Delete habits that are linked to this goal (goalId === goalId). */
  deleteLinkedHabits?: boolean;
  /** Delete tasks that are linked to this goal (goalId === goalId). */
  deleteLinkedTasks?: boolean;
  /** Delete projects that are linked to this goal (goalId === goalId). */
  deleteLinkedProjects?: boolean;
}

export async function deleteGoal(userId: string, goalId: string, options: DeleteGoalOptions = {}): Promise<void> {
  const existing = await loadGoal(userId, goalId);
  if (!existing) throw createError(404, 'GOAL_NOT_FOUND', 'Goal not found');

  await prisma.$transaction(async (tx) => {
    // Delete linked items the user chose to remove.
    // Items NOT selected are kept — their goalId is nulled out by the goal's
    // onDelete: SetNull cascade so they survive as standalone records.
    if (options.deleteLinkedHabits) {
      await tx.habit.deleteMany({ where: { userId, goalId } });
    }
    if (options.deleteLinkedTasks) {
      await tx.task.deleteMany({ where: { userId, goalId } });
    }
    if (options.deleteLinkedProjects) {
      await tx.project.deleteMany({ where: { userId, goalId } });
    }
    // Deleting the goal itself. Foreign keys (habit.goalId, task.goalId, project.goalId)
    // are defined with onDelete: SetNull, so any remaining linked items are automatically
    // unlinked rather than deleted.
    await tx.goal.delete({ where: { id: goalId } });
  });
}

// Valid Prisma ProjectStatus enum values
const VALID_PROJECT_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;
type ValidProjectStatus = (typeof VALID_PROJECT_STATUSES)[number];

/**
 * Maps any incoming status string to a valid ProjectStatus enum value.
 * Falls back to 'PLANNING' for unknown/invalid values (e.g. AI-generated "IN_PROGRESS").
 */
function sanitizeProjectStatus(status: string | null | undefined): ValidProjectStatus {
  if (!status) return 'PLANNING';
  const upper = status.toUpperCase().trim();
  // Direct match
  if ((VALID_PROJECT_STATUSES as readonly string[]).includes(upper)) {
    return upper as ValidProjectStatus;
  }
  // Common mappings from AI-generated values
  const mappings: Record<string, ValidProjectStatus> = {
    IN_PROGRESS: 'ACTIVE',
    INPROGRESS: 'ACTIVE',
    IN_REVIEW: 'ACTIVE',
    REVIEW: 'ACTIVE',
    STARTED: 'ACTIVE',
    PENDING: 'PLANNING',
    NOT_STARTED: 'PLANNING',
    NOTSTARTED: 'PLANNING',
    PAUSED: 'ON_HOLD',
    BLOCKED: 'ON_HOLD',
    DONE: 'COMPLETED',
    FINISHED: 'COMPLETED',
    ARCHIVED: 'CANCELLED',
    DELETED: 'CANCELLED',
  };
  return mappings[upper] ?? 'PLANNING';
}

/**
 * Validates a time string is in HH:mm format. Returns null if invalid.
 */
function sanitizeReminderTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : null;
}

export async function createGoalWorkspace(
  userId: string,
  plan: GoalPlannerPlanDTO
): Promise<GoalWorkspaceCreateResponse> {
  const createdGoal = await prisma.$transaction(async (tx) => {
    const goal = await tx.goal.create({
      data: {
        userId,
        title: plan.goal.title,
        description: plan.goal.description ?? null,
        category: plan.goal.category ?? null,
        icon: plan.goal.icon ?? null,
        color: plan.goal.color ?? '#4F46E5',
        targetDate: plan.goal.targetDate ? new Date(plan.goal.targetDate) : null,
        status: plan.goal.status ?? 'ACTIVE',
        priority: plan.goal.priority ?? 'MEDIUM',
        aiSummary: plan.summary || null,
      },
    });

    // Use the first project from the plan as the primary project, or generate a default.
    // NOTE: We do NOT iterate plan.projects again later — this loop covers all projects.
    const projectsToCreate =
      plan.projects.length > 0
        ? plan.projects
        : [
            {
              name: `${goal.title} workspace`,
              description: 'Primary project for this goal.',
              status: 'PLANNING' as const,
              color: goal.color ?? '#4F46E5',
              startDate: goal.createdAt.toISOString().slice(0, 10),
              dueDate: goal.targetDate?.toISOString().slice(0, 10) ?? null,
            },
          ];

    // Create all projects; track the first one as primaryProject for task linking.
    let primaryProject: { id: string } | null = null;
    for (const project of projectsToCreate) {
      const created = await tx.project.create({
        data: {
          userId,
          goalId: goal.id,
          name: project.name,
          description: project.description ?? null,
          status: sanitizeProjectStatus(project.status),
          color: project.color ?? goal.color ?? '#4F46E5',
          startDate: project.startDate ? new Date(project.startDate) : null,
          dueDate: project.dueDate ? new Date(project.dueDate) : null,
        },
      });
      if (!primaryProject) primaryProject = created;
    }

    if (plan.milestones.length > 0) {
      await tx.goalMilestone.createMany({
        data: plan.milestones.map((milestone, index) => ({
          goalId: goal.id,
          title: milestone.title,
          description: milestone.description ?? null,
          dueDate: milestone.dueDate ? new Date(milestone.dueDate) : null,
          status: 'PENDING',
          sortOrder: milestone.sortOrder ?? index,
        })),
      });
    }

    for (const task of plan.tasks) {
      const taskReminderTime = sanitizeReminderTime(task.reminderTime);
      // Auto-derive reminder 30 min before dueTime if no explicit reminderTime but dueTime exists
      const derivedReminderTime =
        taskReminderTime ??
        (() => {
          if (!task.dueTime) return null;
          const [h, m] = task.dueTime.split(':').map(Number);
          const total = h * 60 + m - 30;
          if (total < 0) return null;
          const rh = Math.floor(total / 60);
          const rm = total % 60;
          return `${String(rh).padStart(2, '0')}:${String(rm).padStart(2, '0')}`;
        })();

      await tx.task.create({
        data: {
          userId,
          goalId: goal.id,
          ...(primaryProject
            ? {
                projectTasks: {
                  create: { projectId: primaryProject.id, order: 0 },
                },
              }
            : {}),
          title: task.title,
          description: task.description ?? null,
          status: 'TODO',
          priority: task.priority ?? 'MEDIUM',
          dueDate: task.dueDate ? new Date(task.dueDate) : null,
          dueTime: task.dueTime ?? null,
          reminderTime: derivedReminderTime,
          reminderMessage: task.reminderMessage ?? null,
          estimatedDuration: task.estimatedDuration ?? null,
        },
      });
    }

    for (const habit of plan.habits) {
      await tx.habit.create({
        data: {
          userId,
          goalId: goal.id,
          title: habit.title,
          targetPerWeek: habit.targetPerWeek ?? 7,
          reminderTime: sanitizeReminderTime(habit.reminderTime),
          reminderMessage: habit.reminderMessage ?? null,
          durationDays: null,
          skipDays: '[]',
        },
      });
    }

    return goal;
  });

  const [goal, milestones, tasks, habits, projects] = await Promise.all([
    getGoal(userId, createdGoal.id),
    listGoalMilestones(userId, createdGoal.id),
    listTasks(userId).then((result) => result.data.filter((task) => task.goalId === createdGoal.id)),
    listHabits(userId).then((result) => result.data.filter((habit) => habit.goalId === createdGoal.id)),
    listProjects(userId).then((result) => result.data.filter((project) => project.goalId === createdGoal.id)),
  ]);

  await Promise.all(projects.map((project) => updateProjectProgress(project.id).catch(() => undefined)));
  await recomputeGoalProgress(createdGoal.id).catch(() => undefined);

  return {
    goal,
    milestones,
    tasks,
    habits,
    projects,
    source: plan.source,
  };
}

export async function listGoalMilestones(userId: string, goalId: string): Promise<GoalMilestoneDTO[]> {
  const goal = await prisma.goal.findFirst({ where: { id: goalId, userId }, select: { id: true } });
  if (!goal) throw createError(404, 'GOAL_NOT_FOUND', 'Goal not found');
  const milestones = await prisma.goalMilestone.findMany({
    where: { goalId },
    orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
  });
  return milestones.map(toMilestoneDTO);
}

export async function createGoalMilestone(
  userId: string,
  goalId: string,
  data: CreateGoalMilestoneRequest
): Promise<GoalMilestoneDTO> {
  const goal = await prisma.goal.findFirst({ where: { id: goalId, userId }, select: { id: true } });
  if (!goal) throw createError(404, 'GOAL_NOT_FOUND', 'Goal not found');
  const milestone = await prisma.goalMilestone.create({
    data: {
      goalId,
      title: data.title,
      description: data.description ?? null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      status: data.status ?? 'PENDING',
      sortOrder: data.sortOrder ?? 0,
      completedAt: data.status === 'COMPLETED' ? new Date() : null,
    },
  });
  await recomputeGoalProgress(goalId).catch(() => undefined);
  return toMilestoneDTO(milestone);
}

export async function updateGoalMilestone(
  userId: string,
  goalId: string,
  milestoneId: string,
  data: UpdateGoalMilestoneRequest
): Promise<GoalMilestoneDTO> {
  const milestone = await prisma.goalMilestone.findFirst({ where: { id: milestoneId, goalId } });
  if (!milestone) throw createError(404, 'GOAL_MILESTONE_NOT_FOUND', 'Goal milestone not found');
  const updated = await prisma.goalMilestone.update({
    where: { id: milestoneId },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.dueDate !== undefined && { dueDate: data.dueDate ? new Date(data.dueDate) : null }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      ...(data.status !== undefined && {
        completedAt:
          data.status === 'COMPLETED' ? new Date() : data.status === 'PENDING' ? null : milestone.completedAt,
      }),
    },
  });
  await recomputeGoalProgress(goalId).catch(() => undefined);
  return toMilestoneDTO(updated);
}

export async function deleteGoalMilestone(userId: string, goalId: string, milestoneId: string): Promise<void> {
  const milestone = await prisma.goalMilestone.findFirst({ where: { id: milestoneId, goalId } });
  if (!milestone) throw createError(404, 'GOAL_MILESTONE_NOT_FOUND', 'Goal milestone not found');
  await prisma.goalMilestone.delete({ where: { id: milestoneId } });
  await recomputeGoalProgress(goalId).catch(() => undefined);
}
