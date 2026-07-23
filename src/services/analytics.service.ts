// backend/src/services/analytics.service.ts
// Aggregates data from Tasks, Habits, Projects, and FocusSessions to produce
// comprehensive analytics for the individual productivity dashboard.
// IMPORTANT: All date handling uses UTC-based "today" to stay consistent
// with habit.service.ts — never use local-time setHours(0,0,0,0).

import { prisma } from '../lib/prismaClient';
import type { AnalyticsSummaryDTO, DailyAnalyticsDTO, ProjectAnalyticsDTO } from '../types';

/** UTC midnight for "today" — matches habit.service.ts definition exactly. */
function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Convert any Date to a UTC-only "YYYY-MM-DD" string. */
function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

export async function getSummary(userId: string): Promise<AnalyticsSummaryDTO> {
  // Get all habits with their completions for streak calculations
  const habits = await prisma.habit.findMany({
    where: { userId },
    select: {
      id: true,
      completions: {
        select: { date: true },
      },
    },
  });

  const [tasksTotal, tasksCompleted, allSessions, notes] = await Promise.all([
    prisma.task.count({ where: { userId } }),
    prisma.task.count({ where: { userId, status: 'DONE' } }),
    prisma.focusSession.findMany({ where: { userId, status: 'COMPLETED' } }),
    prisma.note.findMany({ where: { userId } }),
  ]);

  // Count completed sessions separately for focusSessionsTotal
  const sessions = allSessions.filter((s) => s.status === 'COMPLETED');

  // Calculate streaks using UTC dates for consistency
  let longestHabitStreak = 0;
  let currentHabitStreak = 0;
  
  for (const habit of habits) {
    const dateStrings = habit.completions.map((c: any) => toDateStr(c.date));
    const streak = calcCurrentStreak(dateStrings);
    const bestStreak = calcBestStreak(dateStrings);
    
    if (streak > currentHabitStreak) currentHabitStreak = streak;
    if (bestStreak > longestHabitStreak) longestHabitStreak = bestStreak;
  }

  // Count focus minutes from non-break sessions + time logs
  const focusSessionsOnly = allSessions.filter((s: any) => !s.isBreak);
  const focusMinutesFromSessions = focusSessionsOnly.reduce((acc: any, s: any) => acc + s.durationMin, 0);

  // Sum time logs for additional focus time
  const timeLogs = await prisma.focusTimeLog.aggregate({
    where: { userId },
    _sum: { durationMin: true },
  });
  const focusMinutesTotal = focusMinutesFromSessions + (timeLogs._sum.durationMin ?? 0);

  // Get today's completions for habitsCompletedToday
  // Use UTC-based "today" to match how habit.service.ts stores completion dates
  const today = utcToday();
  const todayStr = toDateStr(today);
  const habitsCompletedToday = habits.filter((h: any) => 
    h.completions.some((c: any) => toDateStr(c.date) === todayStr)
  ).length;

  // Calculate productivity score
  // Weighted average of different metrics
  let score = 0;
  const weights = {
    taskCompletion: 0.3, // 30%
    habitCompletion: 0.25, // 25%
    focusTime: 0.2, // 20%
    journalConsistency: 0.1, // 10%
    streak: 0.15, // 15%
  };

  // Task completion rate (0-100)
  const taskCompletionScore = tasksTotal > 0 ? (tasksCompleted / tasksTotal) * 100 : 0;

  // Habit completion rate (0-100)
  const habitCompletionScore = habits.length > 0 ? (habitsCompletedToday / habits.length) * 100 : 0;

  // Focus time score (assume 4hrs (240min) is max, 0-100)
  const focusScore = Math.min((focusMinutesTotal / 240) * 100, 100);

  // Journal consistency (check last 7 UTC days for journal entries)
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    return toDateStr(d);
  });
  const journalDates = notes.filter(n => n.isJournal).map(n => {
    const d = new Date(n.createdAt);
    return toDateStr(d); // just use UTC date from createdAt
  });
  const journalDaysCount = last7Days.filter(d => journalDates.includes(d)).length;
  const journalScore = (journalDaysCount / 7) * 100;

  // Streak score (max 100 for 14-day streak)
  const streakScore = Math.min((currentHabitStreak / 14) * 100, 100);

  // Calculate weighted total score
  score = Math.round(
    taskCompletionScore * weights.taskCompletion +
    habitCompletionScore * weights.habitCompletion +
    focusScore * weights.focusTime +
    journalScore * weights.journalConsistency +
    streakScore * weights.streak
  );

  return {
    tasksCompleted, tasksTotal,
    taskCompletionRate: tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0,
    habitsCompletedToday,
    habitsTotal: habits.length,
    focusMinutesTotal, focusSessionsTotal: sessions.length,
    longestHabitStreak,
    currentHabitStreak,
    productivityScore: score,
  };
}

/** Daily breakdown for the past N days (default 30). */
export async function getDailyBreakdown(userId: string, days = 30): Promise<DailyAnalyticsDTO[]> {
  const today = utcToday();
  const since = new Date(today);
  since.setUTCDate(since.getUTCDate() - days);

  const [tasks, completions, allFocusSessions] = await Promise.all([
    prisma.task.findMany({
      where: { userId, status: 'DONE', updatedAt: { gte: since } },
      select: { updatedAt: true },
    }),
    prisma.habitCompletion.findMany({
      where: { habit: { userId }, date: { gte: since } },
      select: { date: true },
    }),
    prisma.focusSession.findMany({
      where: { userId, startedAt: { gte: since } },
      select: { startedAt: true, durationMin: true },
    }),
  ]);

  // Build day buckets using UTC dates
  const bucket = new Map<string, DailyAnalyticsDTO>();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = toDateStr(d);
    bucket.set(key, { date: key, tasksCompleted: 0, focusMinutes: 0, habitsCompleted: 0 });
  }

  tasks.forEach((t: any) => {
    const key = toDateStr(t.updatedAt);
    if (bucket.has(key)) bucket.get(key)!.tasksCompleted++;
  });
  completions.forEach((c: any) => {
    const key = toDateStr(c.date);
    if (bucket.has(key)) bucket.get(key)!.habitsCompleted++;
  });
  allFocusSessions
    .filter((s: any) => !s.isBreak)
    .forEach((s: any) => {
      const key = toDateStr(s.startedAt);
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

  const today = utcToday();

  // Aggregate focus minutes per project
  const focusSessions = await prisma.focusSession.findMany({
    where: { userId, projectId: { not: null }, isBreak: false, status: 'COMPLETED' },
    select: { projectId: true, durationMin: true },
  });
  const focusMinutesByProject = new Map<string, number>();
  for (const fs of focusSessions) {
    if (fs.projectId) {
      focusMinutesByProject.set(fs.projectId, (focusMinutesByProject.get(fs.projectId) ?? 0) + fs.durationMin);
    }
  }

  return projects.map((project) => {
    const totalTasks = project.tasks.length;
    const completedTasks = project.tasks.filter((pt) => pt.task.status === 'DONE').length;
    const overdueTasks = project.tasks.filter(
      (pt) => pt.task.dueDate && new Date(pt.task.dueDate) < today && pt.task.status !== 'DONE'
    ).length;
    const focusMinutes = focusMinutesByProject.get(project.id) ?? 0;

    let daysRemaining: number | null = null;
    if (project.dueDate) {
      const dueDate = new Date(project.dueDate);
      daysRemaining = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Calculate weekly progress for this project (last 4 weeks)
    const fourWeeksAgo = new Date(today);
    fourWeeksAgo.setUTCDate(fourWeeksAgo.getUTCDate() - 28);

    const weeklyData = new Map<string, number>();
    for (let i = 0; i < 4; i++) {
      const weekStart = new Date(today);
      weekStart.setUTCDate(weekStart.getUTCDate() - (i * 7));
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
      focusMinutes,
      daysRemaining,
      weeklyProgress,
    };
  });
}

/** Get weekly progress trend (last 12 weeks) */
export async function getWeeklyProgress(userId: string, weeks = 12) {
  const today = utcToday();
  const since = new Date(today);
  since.setUTCDate(since.getUTCDate() - (weeks * 7));

  const [tasks, completions, allFocusSessions, projects] = await Promise.all([
    prisma.task.findMany({
      where: { userId, status: 'DONE', updatedAt: { gte: since } },
      select: { updatedAt: true },
    }),
    prisma.habitCompletion.findMany({
      where: { habit: { userId }, date: { gte: since } },
      select: { date: true },
    }),
    prisma.focusSession.findMany({
      where: { userId, startedAt: { gte: since } },
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
    const weekStart = new Date(today);
    weekStart.setUTCDate(weekStart.getUTCDate() - (i * 7));
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

  allFocusSessions
    .filter((s: any) => !s.isBreak)
    .forEach((s: any) => {
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
  const today = utcToday();
  const futureDate = new Date(today);
  futureDate.setUTCDate(futureDate.getUTCDate() + days);

  const [tasks, projects] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        status: { not: 'DONE' },
        dueDate: {
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
  const today = utcToday();
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  // Check if the most recent date is today or yesterday — dates are already UTC YYYY-MM-DD strings
  const mostRecent = new Date(`${sorted[0]}T00:00:00.000Z`);
  if (mostRecent < yesterday) return 0; // Streak is broken

  let streak = 1;
  let cursor = mostRecent;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i]}T00:00:00.000Z`);
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
    const prev = new Date(`${sorted[i - 1]}T00:00:00.000Z`);
    const curr = new Date(`${sorted[i]}T00:00:00.000Z`);
    const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
    if (diff === 1) { current++; best = Math.max(best, current); } else current = 1;
  }
  return best;
}

/** Streak helper (same algorithm as habit.service.ts). */
function calcStreak(dates: string[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...new Set(dates)].sort().reverse();
  const today = utcToday();
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  let cursor = new Date(`${sorted[0]}T00:00:00.000Z`);
  if (cursor < yesterday) return 0;
  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i]}T00:00:00.000Z`);
    const diff = (cursor.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
    if (diff === 1) { streak++; cursor = prev; } else break;
  }
  return streak;
}

/** Get ISO week key "YYYY-WW" for grouping by week */
function getWeekKey(date: Date): string {
  // Clone in UTC to avoid local-time interference
  const d = new Date(date);
  const utcTs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const utcDate = new Date(utcTs);
  utcDate.setUTCDate(utcDate.getUTCDate() + 3 - ((utcDate.getUTCDay() + 6) % 7));
  const week1 = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 4));
  const weekNum = 1 + Math.round(((utcDate.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return `${utcDate.getUTCFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}