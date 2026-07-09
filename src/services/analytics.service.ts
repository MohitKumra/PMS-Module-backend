// backend/src/services/analytics.service.ts
// Aggregates data from Tasks, Habits, and FocusSessions to produce
// summary and daily-breakdown analytics for the Analytics dashboard.
// No new tables — everything derived from existing data.

import { prisma } from '../lib/prismaClient';
import type { AnalyticsSummaryDTO, DailyAnalyticsDTO } from '../types';

export async function getSummary(userId: string): Promise<AnalyticsSummaryDTO> {
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

  // Longest habit streak across all habits
  let longestHabitStreak = 0;
  for (const habit of habits) {
    const streak = calcStreak(habit.completions.map((c: any) => c.date.toISOString().split('T')[0]));
    if (streak > longestHabitStreak) longestHabitStreak = streak;
  }

  const focusMinutesTotal = sessions.reduce((acc: any, s: any) => acc + s.durationMin, 0);

  return {
    tasksCompleted, tasksTotal,
    taskCompletionRate: tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0,
    habitsCompletedToday: habits.filter((h: any) => h.completions.length > 0).length,
    habitsTotal: habits.length,
    focusMinutesTotal, focusSessionsTotal: sessions.length,
    longestHabitStreak,
  };
}

/** Daily breakdown for the past N days (default 30). */
export async function getDailyBreakdown(userId: string, days = 30): Promise<DailyAnalyticsDTO[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const [tasks, completions, sessions] = await Promise.all([
    prisma.task.findMany({
      where: { userId, status: 'DONE', updatedAt: { gte: since } },
      select: { updatedAt: true },
    }),
    prisma.habitCompletion.findMany({
      where: { habit: { userId }, date: { gte: since } },
      select: { date: true },
    }),
    prisma.focusSession.findMany({
      where: { userId, completed: true, startedAt: { gte: since } },
      select: { startedAt: true, durationMin: true },
    }),
  ]);

  // Build day buckets
  const bucket = new Map<string, DailyAnalyticsDTO>();
  for (let i = 0; i < days; i++) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
    const key = d.toISOString().split('T')[0];
    bucket.set(key, { date: key, tasksCompleted: 0, focusMinutes: 0, habitsCompleted: 0 });
  }

  tasks.forEach((t: any) => {
    const key = t.updatedAt.toISOString().split('T')[0];
    if (bucket.has(key)) bucket.get(key)!.tasksCompleted++;
  });
  completions.forEach((c: any) => {
    const key = c.date.toISOString().split('T')[0];
    if (bucket.has(key)) bucket.get(key)!.habitsCompleted++;
  });
  sessions.forEach((s: any) => {
    const key = s.startedAt.toISOString().split('T')[0];
    if (bucket.has(key)) bucket.get(key)!.focusMinutes += s.durationMin;
  });

  return Array.from(bucket.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** Streak helper (same algorithm as habit.service.ts). */
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
