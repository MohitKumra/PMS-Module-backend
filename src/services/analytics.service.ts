// backend/src/services/analytics.service.ts
// Aggregates data from Tasks, Habits, Projects, and FocusSessions to produce
// comprehensive analytics for the individual productivity dashboard.

import { prisma } from '../lib/prismaClient';
import type { AnalyticsSummaryDTO, DailyAnalyticsDTO, ProjectAnalyticsDTO } from '../types';

export async function getSummary(userId: string): Promise<AnalyticsSummaryDTO> {
  // Get all habits with their completions for streak calculations
  const habits = await prisma.habit.findMany({
    where: { userId },
    include: {
      completions: {
        select: { date: true },
      },
    },
  });

  const [tasksTotal, tasksCompleted, sessions] = await Promise.all([
    prisma.task.count({ where: { userId } }),
    prisma.task.count({ where: { userId, status: 'DONE' } }),
    prisma.focusSession.findMany({ where: { userId, completed: true } }),
  ]);

  // Calculate streaks using UTC dates for consistency
  let longestHabitStreak = 0;
  let currentHabitStreak = 0;
  
  for (const habit of habits) {
    const dateStrings = habit.completions.map((c: any) => c.date.toISOString().split('T')[0]);
    const streak = calcCurrentStreak(dateStrings);
    const bestStreak = calcBestStreak(dateStrings);
    
    if (streak > currentHabitStreak) currentHabitStreak = streak;
    if (bestStreak > longestHabitStreak) longestHabitStreak = bestStreak;
  }

  const focusMinutesTotal = sessions.reduce((acc: any, s: any) => acc + s.durationMin, 0);

  // Get today's completions for habitsCompletedToday
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  const habitsCompletedToday = habits.filter((h: any) => 
    h.completions.some((c: any) => c.date.toISOString().split('T')[0] === todayStr)
  ).length;

  return {
    tasksCompleted, tasksTotal,
    taskCompletionRate: tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0,
    habitsCompletedToday,
    habitsTotal: habits.length,
    focusMinutesTotal, focusSessionsTotal: sessions.length,
    longestHabitStreak,
    currentHabitStreak,
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

/** Get detailed analytics for all user projects */
export async function getProjectAnalytics(userId: string): Promise<ProjectAnalyticsDTO[]> {
  const projects = await prisma.project.findMany({
    where: { userId },
    include: {
      tasks: {
        include: { task: true },
      },
    },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return projects.map((project) => {
    const totalTasks = project.tasks.length;
    const completedTasks = project.tasks.filter((pt) => pt.task.status === 'DONE').length;
    const overdueTasks = project.tasks.filter(
      (pt) => pt.task.dueDate && new Date(pt.task.dueDate) < today && pt.task.status !== 'DONE'
    ).length;

    let daysRemaining: number | null = null;
    if (project.dueDate) {
      const dueDate = new Date(project.dueDate);
      daysRemaining = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Calculate weekly progress for this project (last 4 weeks)
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    fourWeeksAgo.setHours(0, 0, 0, 0);

    const weeklyData = new Map<string, number>();
    for (let i = 0; i < 4; i++) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - (i * 7));
      const weekKey = getWeekKey(weekStart);
      weeklyData.set(weekKey, 0);
    }

    project.tasks.forEach((pt) => {
      if (pt.task.status === 'DONE' && pt.task.updatedAt >= fourWeeksAgo) {
        const weekKey = getWeekKey(pt.task.updatedAt);
        if (weeklyData.has(weekKey)) {
          weeklyData.set(weekKey, (weeklyData.get(weekKey) || 0) + 1);
        }
      }
    });

    const weeklyProgress = Array.from(weeklyData.entries())
      .map(([week, tasksCompleted]) => ({ week, tasksCompleted }))
      .sort((a, b) => a.week.localeCompare(b.week));

    return {
      projectId: project.id,
      projectName: project.name,
      status: project.status,
      progress: project.progress,
      totalTasks,
      completedTasks,
      overdueTasks,
      daysRemaining,
      weeklyProgress,
    };
  });
}

/** Get weekly progress trend (last 12 weeks) */
export async function getWeeklyProgress(userId: string, weeks = 12) {
  const since = new Date();
  since.setDate(since.getDate() - (weeks * 7));
  since.setHours(0, 0, 0, 0);

  const [tasks, completions, sessions, projects] = await Promise.all([
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
    prisma.project.findMany({
      where: { userId, status: 'COMPLETED', updatedAt: { gte: since } },
      select: { updatedAt: true },
    }),
  ]);

  // Build week buckets
  const bucket = new Map<string, any>();
  for (let i = 0; i < weeks; i++) {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - (i * 7));
    const weekKey = getWeekKey(weekStart);
    bucket.set(weekKey, {
      week: weekKey,
      tasksCompleted: 0,
      focusMinutes: 0,
      habitsCompleted: 0,
      projectsCompleted: 0,
    });
  }

  tasks.forEach((t: any) => {
    const weekKey = getWeekKey(t.updatedAt);
    if (bucket.has(weekKey)) bucket.get(weekKey)!.tasksCompleted++;
  });

  completions.forEach((c: any) => {
    const weekKey = getWeekKey(c.date);
    if (bucket.has(weekKey)) bucket.get(weekKey)!.habitsCompleted++;
  });

  sessions.forEach((s: any) => {
    const weekKey = getWeekKey(s.startedAt);
    if (bucket.has(weekKey)) bucket.get(weekKey)!.focusMinutes += s.durationMin;
  });

  projects.forEach((p: any) => {
    const weekKey = getWeekKey(p.updatedAt);
    if (bucket.has(weekKey)) bucket.get(weekKey)!.projectsCompleted++;
  });

  return Array.from(bucket.values()).sort((a, b) => a.week.localeCompare(b.week));
}

/** Get upcoming deadlines (tasks and projects) */
export async function getUpcomingDeadlines(userId: string, days = 7) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const futureDate = new Date(today);
  futureDate.setDate(futureDate.getDate() + days);

  const [tasks, projects] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        status: { not: 'DONE' },
        dueDate: {
          gte: today,
          lte: futureDate,
        },
      },
      select: { id: true, title: true, dueDate: true },
      orderBy: { dueDate: 'asc' },
    }),
    prisma.project.findMany({
      where: {
        userId,
        status: { in: ['PLANNING', 'ACTIVE'] },
        dueDate: {
          gte: today,
          lte: futureDate,
        },
      },
      select: { id: true, name: true, dueDate: true },
      orderBy: { dueDate: 'asc' },
    }),
  ]);

  const deadlines = [
    ...tasks.map((task) => ({
      type: 'task' as const,
      id: task.id,
      title: task.title,
      dueDate: task.dueDate!.toISOString(),
      daysUntilDue: Math.ceil((task.dueDate!.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
    })),
    ...projects.map((project) => ({
      type: 'project' as const,
      id: project.id,
      title: project.name,
      dueDate: project.dueDate!.toISOString(),
      daysUntilDue: Math.ceil((project.dueDate!.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
    })),
  ];

  return deadlines.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

/** Current streak - counts consecutive days ending today (or yesterday if today not completed). */
function calcCurrentStreak(dates: string[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...new Set(dates)].sort().reverse();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  
  // Check if the most recent date is today or yesterday
  const mostRecent = new Date(sorted[0]); mostRecent.setHours(0, 0, 0, 0);
  if (mostRecent < yesterday) return 0; // Streak is broken
  
  let streak = 1;
  let cursor = mostRecent;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i]); prev.setHours(0, 0, 0, 0);
    const diff = (cursor.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
    if (diff === 1) { streak++; cursor = prev; } else break;
  }
  return streak;
}

/** Best streak - longest consecutive streak ever achieved. */
function calcBestStreak(dates: string[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...new Set(dates)].sort();
  let best = 1, current = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]); prev.setHours(0, 0, 0, 0);
    const curr = new Date(sorted[i]); curr.setHours(0, 0, 0, 0);
    const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
    if (diff === 1) { current++; best = Math.max(best, current); } else current = 1;
  }
  return best;
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

/** Get ISO week key "YYYY-WW" for grouping by week */
function getWeekKey(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}
