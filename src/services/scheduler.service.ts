/**
 * backend/src/services/scheduler.service.ts
 * Intelligent daily time-budgeting and auto-scheduling.
 *
 * For any given day, the scheduler:
 * 1. Calculates the user's remaining focus capacity (daily budget - already-booked focus minutes)
 * 2. Collects all non-DONE tasks with estimatedDuration and selects the highest-priority ones
 * 3. Suggests time blocks to fit within the remaining capacity
 * 4. Can auto-create FocusSession records for the suggested blocks
 */

import { prisma } from '../lib/prismaClient';

export interface CapacityInfo {
  dailyBudgetMinutes: number;   // user setting, default 240
  bookedMinutes: number;        // minutes already booked via focus sessions
  remainingMinutes: number;     // what's left
}

export interface ScheduledBlock {
  taskId: string;
  taskTitle: string;
  priority: string;
  estimatedDuration: number;
  scheduledStart: Date | null;  // null = block suggested but no specific time
  scheduledEnd: Date | null;
}

export interface ScheduleSuggestion {
  date: string;               // YYYY-MM-DD
  capacity: CapacityInfo;
  suggestedBlocks: ScheduledBlock[];
  totalSuggestedMinutes: number;
  isOverCapacity: boolean;
}

/**
 * Default daily focus capacity (4 hours = 240 minutes).
 * Can be made user-configurable later by adding a field to UserPreference.
 */
const DEFAULT_DAILY_CAPACITY_MINUTES = 240;

/** Get the user's default daily capacity (default 240 min = 4 hours). */
export async function getDailyCapacity(): Promise<number> {
  return DEFAULT_DAILY_CAPACITY_MINUTES;
}

/** Calculate capacity info for a given date. */
export async function getCapacityForDate(userId: string, date: Date): Promise<CapacityInfo> {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const dailyBudgetMinutes = DEFAULT_DAILY_CAPACITY_MINUTES;

  // Sum all focus sessions on this day (completed or not) for total booked minutes
  const focusSessions = await prisma.focusSession.findMany({
    where: {
      userId,
      startedAt: { gte: dayStart, lte: dayEnd },
      isBreak: false,
    },
    select: { durationMin: true, completed: true },
  });

  // Only count completed sessions as "booked"
  const bookedMinutes = focusSessions
    .filter((s) => s.completed)
    .reduce((sum, s) => sum + s.durationMin, 0);

  return {
    dailyBudgetMinutes,
    bookedMinutes,
    remainingMinutes: Math.max(0, dailyBudgetMinutes - bookedMinutes),
  };
}

/** Suggest task blocks for a given date, sorted by priority×urgency. */
export async function suggestSchedule(userId: string, date: Date): Promise<ScheduleSuggestion> {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const capacity = await getCapacityForDate(userId, date);

  // Get tasks due on this day that aren't done
  const tasks = await prisma.task.findMany({
    where: {
      userId,
      dueDate: { gte: dayStart, lte: dayEnd },
      status: { not: 'DONE' },
      estimatedDuration: { not: null }, // only tasks with estimated duration
    },
    orderBy: [
      { priority: 'desc' },    // CRITICAL first
      { dueDate: 'asc' },      // earliest due first
    ],
    select: {
      id: true,
      title: true,
      priority: true,
      estimatedDuration: true,
      dueDate: true,
    },
  });

  // Build schedule: allocate from remaining capacity, highest priority first
  const suggestedBlocks: ScheduledBlock[] = [];
  let remaining = capacity.remainingMinutes;

  for (const task of tasks) {
    const duration = task.estimatedDuration!;
    if (duration <= remaining) {
      // We can fit this task in
      const scheduledStart = new Date(date);
      // Rough time suggestion: start at 9 AM + already allocated minutes
      const allocatedSoFar = suggestedBlocks.reduce((sum, b) => sum + b.estimatedDuration, 0);
      scheduledStart.setHours(9, 0, 0, 0);
      const blockStart = new Date(scheduledStart.getTime() + allocatedSoFar * 60 * 1000);
      const blockEnd = new Date(blockStart.getTime() + duration * 60 * 1000);

      suggestedBlocks.push({
        taskId: task.id,
        taskTitle: task.title,
        priority: task.priority,
        estimatedDuration: duration,
        scheduledStart: blockStart,
        scheduledEnd: blockEnd,
      });
      remaining -= duration;
    } else {
      // Task doesn't fit — suggest it but mark no specific time
      suggestedBlocks.push({
        taskId: task.id,
        taskTitle: task.title,
        priority: task.priority,
        estimatedDuration: duration,
        scheduledStart: null,
        scheduledEnd: null,
      });
    }
  }

  const totalSuggestedMinutes = suggestedBlocks.reduce((sum, b) => sum + b.estimatedDuration, 0);

  return {
    date: date.toISOString().split('T')[0],
    capacity,
    suggestedBlocks,
    totalSuggestedMinutes,
    isOverCapacity: totalSuggestedMinutes > capacity.remainingMinutes,
  };
}

/** Auto-create FocusSession records for suggested blocks. */
export async function applySchedule(userId: string, date: Date, blocks: ScheduledBlock[]): Promise<number> {
  let created = 0;

  for (const block of blocks) {
    if (!block.scheduledStart || !block.scheduledEnd) continue; // skip unscheduled blocks

    await prisma.focusSession.create({
      data: {
        userId,
        taskId: block.taskId,
        durationMin: block.estimatedDuration,
        startedAt: block.scheduledStart,
        completed: false,
        isBreak: false,
      },
    });
    created++;
  }

  // Award points for scheduling (one-time per day)
  if (created > 0) {
    const dateKey = date.toISOString().split('T')[0];
    const existing = await prisma.pointLedger.findFirst({
      where: { userId, entityType: 'schedule', entityId: dateKey },
    });
    if (!existing) {
      await prisma.pointLedger.create({
        data: {
          userId,
          points: 10,
          reason: 'Day scheduled',
          entityType: 'schedule',
          entityId: dateKey,
          description: `Auto-scheduled ${created} tasks on ${dateKey}`,
        },
      });
    }
  }

  return created;
}