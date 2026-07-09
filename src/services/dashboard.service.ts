// backend/src/services/dashboard.service.ts
// Aggregates data from Tasks, Habits, FocusSessions, and Analytics for the dashboard.

import { prisma } from '../lib/prismaClient';
import type { AnalyticsSummaryDTO } from '../types';

/**
 * Get dashboard summary data for a user.
 * Returns all the stats needed for the dashboard in a single call.
 */
export async function getDashboardSummary(userId: string): Promise<AnalyticsSummaryDTO> {
  const [tasksTotal, tasksCompleted, habits, sessions] = await Promise.all([
    prisma.task.count({ where: { userId } }),
    prisma.task.count({ where: { userId, status: 'DONE' } }),
    prisma.habit.findMany({
      where: { userId },
      include: {
        completions: {
          where: {
            date: {
              gte: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })(),
              lte: (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; })(),
            },
          },
        },
      },
    }),
    prisma.focusSession.findMany({ where: { userId, completed: true } }),
  ]);

  // Calculate longest habit streak
  function calcStreak(dates: string[]): number {
    if (dates.length === 0) return 0;
    const sorted = [...new Set(dates)].sort().reverse();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    let cursor = new Date(sorted[0]); cursor.setHours(0, 0, 0, 0);
    if (cursor < yesterday) return 0;
    let streak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i]); prev.setHours(0, 0, 0, 0);
      const diff = (cursor.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      if (diff === 1) { streak++; cursor = prev; } else break;
    }
    return streak;
  }

  let longestHabitStreak = 0;
  for (const habit of habits) {
    const streak = calcStreak(habit.completions.map((c) => c.date.toISOString().split('T')[0]));
    if (streak > longestHabitStreak) longestHabitStreak = streak;
  }

  const focusMinutesTotal = sessions.reduce((acc, s) => acc + s.durationMin, 0);

  return {
    tasksCompleted,
    tasksTotal,
    taskCompletionRate: tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0,
    habitsCompletedToday: habits.filter((h) => h.completions.length > 0).length,
    habitsTotal: habits.length,
    focusMinutesTotal,
    focusSessionsTotal: sessions.length,
    longestHabitStreak,
  };
}

/**
 * Get pending tasks count for today.
 */
export async function getPendingTasksCount(userId: string): Promise<number> {
  return prisma.task.count({
    where: { userId, status: { in: ['TODO', 'IN_PROGRESS'] } },
  });
}

/**
 * Get habits that need to be completed today.
 */
export async function getHabitsToCompleteToday(userId: string): Promise<number> {
  const habits = await prisma.habit.findMany({
    where: { userId },
    include: {
      completions: {
        where: {
          date: {
            gte: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })(),
            lte: (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; })(),
          },
        },
      },
    },
  });
  return habits.filter((h) => h.completions.length === 0).length;
}