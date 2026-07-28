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

function daysBetween(a: string, b: string): number {
  return (new Date(`${b}T00:00:00.000Z`).getTime() - new Date(`${a}T00:00:00.000Z`).getTime()) / 86400000;
}

function getDayOfWeek(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return (d.getUTCDay() + 6) % 7;
}

function parseSkipDays(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatIsoDate(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

/** Helper to parse optional YYYY-MM-DD strings into UTC Date bounds. */
function parseRange(startDateStr?: string, endDateStr?: string) {
  let start: Date | undefined;
  let end: Date | undefined;

  if (startDateStr) {
    const [y, m, d] = startDateStr.split('-').map(Number);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    }
  }

  if (endDateStr) {
    const [y, m, d] = endDateStr.split('-').map(Number);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      end = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
    }
  }

  return { start, end };
}

export async function getSummary(userId: string, startDateStr?: string, endDateStr?: string): Promise<AnalyticsSummaryDTO> {
  const { start, end } = parseRange(startDateStr, endDateStr);

  const dateFilter = (start || end) ? {
    ...(start ? { gte: start } : {}),
    ...(end ? { lte: end } : {}),
  } : undefined;

  // Get ALL habits with ALL completions for true streak calculation across history
  const habits = await prisma.habit.findMany({
    where: { userId, isActive: true },
    include: {
      completions: {
        select: { date: true },
      },
    },
  });

  const taskCompletedWhere = {
    userId,
    status: 'DONE' as const,
    ...(dateFilter ? {
      OR: [
        { completedAt: dateFilter },
        { updatedAt: dateFilter },
      ],
    } : {}),
  };

  const overdueTaskWhere = {
    userId,
    status: { not: 'DONE' as const },
    dueDate: { lt: utcToday() },
  };

  const taskTotalWhere = {
    userId,
    ...(dateFilter ? {
      OR: [
        { createdAt: dateFilter },
        { dueDate: dateFilter },
        { completedAt: dateFilter },
        { updatedAt: dateFilter },
      ],
    } : {}),
  };

  const focusWhere = {
    userId,
    status: 'COMPLETED',
    ...(dateFilter ? {
      OR: [
        { completedAt: dateFilter },
        { startedAt: dateFilter },
      ],
    } : {}),
  };

  const [tasksTotalInRange, tasksCompleted, overdueTasks, allSessions, notes, totalTasksAllTime, cancelledSessions] = await Promise.all([
    prisma.task.count({ where: taskTotalWhere }),
    prisma.task.count({ where: taskCompletedWhere }),
    prisma.task.count({ where: overdueTaskWhere }),
    prisma.focusSession.findMany({ where: focusWhere }),
    prisma.note.findMany({ where: { userId } }),
    // Count tasks that are relevant: completed OR (not done AND due today/overdue)
    // Excludes tasks due in the future (tomorrow or later) from the denominator
    prisma.task.count({
      where: {
        userId,
        OR: [
          { status: 'DONE' },
          {
            status: { not: 'DONE' },
            dueDate: { lte: utcToday() },
          },
        ],
      },
    }),
    prisma.focusSession.count({
      where: {
        userId,
        status: 'CANCELLED',
        ...(dateFilter ? {
          OR: [
            { startedAt: dateFilter },
            { completedAt: dateFilter },
          ],
        } : {}),
      },
    }),
  ]);

  const tasksTotal = dateFilter ? (tasksTotalInRange > 0 ? tasksTotalInRange : tasksCompleted) : totalTasksAllTime;

  // Count completed sessions
  const sessions = allSessions.filter((s) => s.status === 'COMPLETED');

  // Calculate streaks across full history for each habit
  let longestHabitStreak = 0;
  let currentHabitStreak = 0;
  
  for (const habit of habits) {
    const skipDays = parseSkipDays(habit.skipDays);
    const dateStrings = habit.completions.map((c: any) => toDateStr(c.date));
    const streak = calcStreak(dateStrings, skipDays);
    const bestStreak = calcBestStreak(dateStrings, skipDays);
    
    if (streak > currentHabitStreak) currentHabitStreak = streak;
    if (bestStreak > longestHabitStreak) longestHabitStreak = bestStreak;
  }

  // Count focus minutes from non-break sessions + time logs
  const focusSessionsOnly = allSessions.filter((s: any) => !s.isBreak);
  const focusMinutesFromSessions = focusSessionsOnly.reduce((acc: any, s: any) => {
    const mins = (s.elapsedMin && s.elapsedMin > 0) ? s.elapsedMin : s.durationMin;
    return acc + mins;
  }, 0);

  // Sum time logs for additional focus time (fixed field name: date instead of createdAt!)
  const timeLogs = await prisma.focusTimeLog.aggregate({
    where: {
      userId,
      ...(dateFilter ? { date: dateFilter } : {}),
    },
    _sum: { durationMin: true },
  });
  const focusMinutesTotal = focusMinutesFromSessions + (timeLogs._sum.durationMin ?? 0);

  // Get habit completions count strictly within the date range
  const today = utcToday();
  const todayStr = toDateStr(today);

  const habitsCompletedCount = habits.filter((h: any) => 
    h.completions.some((c: any) => {
      const cStr = toDateStr(c.date);
      if (startDateStr && endDateStr) {
        return cStr >= startDateStr && cStr <= endDateStr;
      }
      return cStr === todayStr;
    })
  ).length;

  // Calculate productivity score
  let score = 0;
  const weights = {
    taskCompletion: 0.3,
    habitCompletion: 0.25,
    focusTime: 0.2,
    journalConsistency: 0.1,
    streak: 0.15,
  };

  const taskCompletionScore = tasksTotal > 0 ? (tasksCompleted / tasksTotal) * 100 : 0;
  const habitCompletionScore = habits.length > 0 ? (habitsCompletedCount / habits.length) * 100 : 0;
  const focusScore = Math.min((focusMinutesTotal / 240) * 100, 100);

  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    return toDateStr(d);
  });
  const journalDates = notes.filter(n => n.isJournal).map(n => toDateStr(new Date(n.createdAt)));
  const journalDaysCount = last7Days.filter(d => journalDates.includes(d)).length;
  const journalScore = (journalDaysCount / 7) * 100;
  const streakScore = Math.min((currentHabitStreak / 14) * 100, 100);
  const overduePenalty = clamp(overdueTasks * 10, 0, 100);
  const missedHabitsToday = Math.max(habits.length - habitsCompletedCount, 0);
  const missedHabitsPenalty = habits.length > 0 ? Math.round((missedHabitsToday / habits.length) * 100) : 0;
  const interruptionPenalty = allSessions.length > 0 ? Math.round((cancelledSessions / (allSessions.length + cancelledSessions)) * 100) : 0;

  score = Math.round(
    taskCompletionScore * weights.taskCompletion +
    habitCompletionScore * weights.habitCompletion +
    focusScore * weights.focusTime +
    streakScore * weights.streak -
    overduePenalty * 0.1 -
    missedHabitsPenalty * 0.05 -
    interruptionPenalty * 0.05
  );

  score = clamp(score, 0, 100);

  return {
    tasksCompleted,
    tasksTotal,
    taskCompletionRate: tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0,
    habitsCompletedToday: habitsCompletedCount,
    habitsTotal: habits.length,
    focusMinutesTotal,
    focusSessionsTotal: sessions.length,
    overdueTasks,
    cancelledFocusSessions: cancelledSessions,
    missedHabitsToday,
    longestHabitStreak,
    currentHabitStreak,
    productivityScore: score,
  };
}

/** Daily breakdown for specified range or N days. */
export async function getDailyBreakdown(userId: string, days = 30, startDateStr?: string, endDateStr?: string): Promise<DailyAnalyticsDTO[]> {
  let start: Date;
  let end: Date;

  const parsed = parseRange(startDateStr, endDateStr);
  if (parsed.start && parsed.end) {
    start = parsed.start;
    end = parsed.end;
  } else {
    end = utcToday();
    end.setUTCHours(23, 59, 59, 999);
    start = new Date(utcToday());
    start.setUTCDate(start.getUTCDate() - (days - 1));
  }

  const dateFilter = { gte: start, lte: end };

  const [createdTasks, completedTasks, completions, allFocusSessions] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        OR: [
          { createdAt: dateFilter },
          { dueDate: dateFilter },
          { completedAt: dateFilter },
          { updatedAt: dateFilter },
        ],
      },
      select: { createdAt: true, updatedAt: true, completedAt: true, dueDate: true, status: true },
    }),
    prisma.task.findMany({
      where: {
        userId,
        status: 'DONE',
        OR: [
          { completedAt: dateFilter },
          { updatedAt: dateFilter },
        ],
      },
      select: { updatedAt: true, completedAt: true },
    }),
    prisma.habitCompletion.findMany({
      where: { habit: { userId }, date: dateFilter },
      select: { date: true },
    }),
    prisma.focusSession.findMany({
      where: {
        userId,
        status: 'COMPLETED',
        OR: [
          { completedAt: dateFilter },
          { startedAt: dateFilter },
        ],
      },
      select: { startedAt: true, completedAt: true, durationMin: true, elapsedMin: true, isBreak: true },
    }),
  ]);

  // Build day buckets using UTC dates
  const bucket = new Map<string, DailyAnalyticsDTO>();
  const curr = new Date(start);
  while (curr <= end) {
    const key = toDateStr(curr);
    bucket.set(key, {
      date: key,
      tasksCreated: 0,
      tasksCompleted: 0,
      tasksOverdue: 0,
      focusMinutes: 0,
      habitsCompleted: 0,
      productivityScore: 0,
    });
    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  createdTasks.forEach((t: any) => {
    const d = t.createdAt ?? t.updatedAt;
    const key = toDateStr(d);
    if (bucket.has(key)) bucket.get(key)!.tasksCreated++;
    if (t.status !== 'DONE' && t.dueDate && bucket.has(toDateStr(t.dueDate))) {
      bucket.get(toDateStr(t.dueDate))!.tasksOverdue++;
    }
  });
  completedTasks.forEach((t: any) => {
    const d = t.completedAt ?? t.updatedAt;
    const key = toDateStr(d);
    if (bucket.has(key)) bucket.get(key)!.tasksCompleted++;
  });
  completions.forEach((c: any) => {
    const key = toDateStr(c.date);
    if (bucket.has(key)) bucket.get(key)!.habitsCompleted++;
  });
  allFocusSessions
    .filter((s: any) => !s.isBreak)
    .forEach((s: any) => {
      const d = s.completedAt ?? s.startedAt;
      const key = toDateStr(d);
        const mins = (s.elapsedMin && s.elapsedMin > 0) ? s.elapsedMin : s.durationMin;
        if (bucket.has(key)) bucket.get(key)!.focusMinutes += mins;
      });

  for (const day of bucket.values()) {
    const taskScore = day.tasksCreated > 0 ? (day.tasksCompleted / day.tasksCreated) * 45 : 0;
    const habitScore = Math.min(day.habitsCompleted * 8, 20);
    const focusScore = Math.min((day.focusMinutes / 240) * 25, 25);
    const penalty = Math.min(day.tasksOverdue * 4, 15);
    day.productivityScore = clamp(Math.round(taskScore + habitScore + focusScore - penalty), 0, 100);
  }

  return Array.from(bucket.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** Get detailed analytics for all user projects within optional date range */
export async function getProjectAnalytics(userId: string, startDateStr?: string, endDateStr?: string): Promise<ProjectAnalyticsDTO[]> {
  const { start, end } = parseRange(startDateStr, endDateStr);

  const projects = await prisma.project.findMany({
    where: { userId },
    include: {
      tasks: {
        include: { task: true },
      },
    },
  });

  const today = utcToday();

  const focusWhere = {
    userId,
    projectId: { not: null },
    isBreak: false,
    status: 'COMPLETED',
    ...((start || end) ? {
      OR: [
        { completedAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } },
        { startedAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } },
      ]
    } : {}),
  };

  const focusSessions = await prisma.focusSession.findMany({
    where: focusWhere,
    select: { projectId: true, durationMin: true, elapsedMin: true },
  });

  const focusMinutesByProject = new Map<string, number>();
  for (const fs of focusSessions) {
    if (fs.projectId) {
      const mins = (fs.elapsedMin && fs.elapsedMin > 0) ? fs.elapsedMin : fs.durationMin;
      focusMinutesByProject.set(fs.projectId, (focusMinutesByProject.get(fs.projectId) ?? 0) + mins);
    }
  }

    return projects.map((project) => {
      const totalTasks = project.tasks.length;
      const completedTasks = project.tasks.filter((pt) => {
        if (pt.task.status !== 'DONE') return false;
        const d = pt.task.completedAt ?? pt.task.updatedAt;
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    }).length;

      const overdueTasks = project.tasks.filter(
        (pt) => pt.task.dueDate && new Date(pt.task.dueDate) < today && pt.task.status !== 'DONE'
      ).length;
      const focusMinutes = focusMinutesByProject.get(project.id) ?? 0;
      const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : project.progress;

      let expectedProgress = project.progress;
      if (project.startDate && project.dueDate) {
        const totalDuration = Math.max(project.dueDate.getTime() - project.startDate.getTime(), 1);
        const elapsed = clamp((today.getTime() - project.startDate.getTime()) / totalDuration, 0, 1);
        expectedProgress = Math.round(elapsed * 100);
      }
      const progressDelta = progress - expectedProgress;
      const health = progressDelta >= 10 ? 'AHEAD' : progressDelta <= -10 ? 'BEHIND' : 'ON_TRACK';

      let daysRemaining: number | null = null;
      if (project.dueDate) {
        const dueDate = new Date(project.dueDate);
        daysRemaining = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    }

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
        progress,
        expectedProgress,
        progressDelta,
        health,
        totalTasks,
        completedTasks,
        overdueTasks,
        focusMinutes,
        daysRemaining,
        expectedFinish: formatIsoDate(project.dueDate),
        actualFinish: project.status === 'COMPLETED' ? formatIsoDate(project.updatedAt) : null,
        weeklyProgress,
      };
    });
  }

/** Get weekly progress trend for specified range or N weeks */
export async function getWeeklyProgress(userId: string, weeks = 12, startDateStr?: string, endDateStr?: string) {
  let start: Date;
  let end: Date;

  const parsed = parseRange(startDateStr, endDateStr);
  if (parsed.start && parsed.end) {
    start = parsed.start;
    end = parsed.end;
  } else {
    end = utcToday();
    end.setUTCHours(23, 59, 59, 999);
    start = new Date(utcToday());
    start.setUTCDate(start.getUTCDate() - (weeks * 7));
  }

  const dateFilter = { gte: start, lte: end };

  const [tasks, completions, allFocusSessions, projects] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        status: 'DONE',
        OR: [
          { completedAt: dateFilter },
          { updatedAt: dateFilter },
        ],
      },
      select: { updatedAt: true, completedAt: true },
    }),
    prisma.habitCompletion.findMany({
      where: { habit: { userId }, date: dateFilter },
      select: { date: true },
    }),
    prisma.focusSession.findMany({
      where: {
        userId,
        status: 'COMPLETED',
        OR: [
          { completedAt: dateFilter },
          { startedAt: dateFilter },
        ],
      },
      select: { startedAt: true, completedAt: true, durationMin: true, elapsedMin: true, isBreak: true },
    }),
    prisma.project.findMany({
      where: { userId, status: 'COMPLETED', updatedAt: dateFilter },
      select: { updatedAt: true },
    }),
  ]);

  const bucket = new Map<string, any>();
  const curr = new Date(start);
  while (curr <= end) {
    const weekKey = getWeekKey(curr);
    if (!bucket.has(weekKey)) {
      bucket.set(weekKey, {
        week: weekKey,
        tasksCompleted: 0,
        focusMinutes: 0,
        habitsCompleted: 0,
        projectsCompleted: 0,
      });
    }
    curr.setUTCDate(curr.getUTCDate() + 7);
  }

  tasks.forEach((t: any) => {
    const d = t.completedAt ?? t.updatedAt;
    const weekKey = getWeekKey(d);
    if (bucket.has(weekKey)) bucket.get(weekKey)!.tasksCompleted++;
  });

  completions.forEach((c: any) => {
    const weekKey = getWeekKey(c.date);
    if (bucket.has(weekKey)) bucket.get(weekKey)!.habitsCompleted++;
  });

  allFocusSessions
    .filter((s: any) => !s.isBreak)
    .forEach((s: any) => {
      const d = s.completedAt ?? s.startedAt;
      const weekKey = getWeekKey(d);
      const mins = (s.elapsedMin && s.elapsedMin > 0) ? s.elapsedMin : s.durationMin;
      if (bucket.has(weekKey)) bucket.get(weekKey)!.focusMinutes += mins;
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

// ─── PHASE 2: New Endpoints ──────────────────────────────────────────────────

/** Focus Analytics: session metrics, averages, breakdowns */
export async function getFocusAnalytics(userId: string, startDateStr?: string, endDateStr?: string) {
  const { start, end } = parseRange(startDateStr, endDateStr);
  const dateFilter = (start || end) ? {
    ...(start ? { gte: start } : {}),
    ...(end ? { lte: end } : {}),
  } : undefined;

  const sessions = await prisma.focusSession.findMany({
    where: {
      userId,
      ...(dateFilter ? {
        OR: [
          { startedAt: dateFilter },
          { completedAt: dateFilter },
        ],
      } : {}),
    },
    select: {
      id: true,
      startedAt: true,
      completedAt: true,
      durationMin: true,
      elapsedMin: true,
      isBreak: true,
      status: true,
    },
    orderBy: { startedAt: 'asc' },
  });

  const completedSessions = sessions.filter(s => s.status === 'COMPLETED' && !s.isBreak);
  const cancelledSessions = sessions.filter(s => s.status === 'CANCELLED');
  const breakSessions = sessions.filter(s => s.isBreak);

  const durations = completedSessions.map(s => s.elapsedMin && s.elapsedMin > 0 ? s.elapsedMin : s.durationMin);
  const totalFocus = durations.reduce((a, b) => a + b, 0);
  const avgSession = durations.length > 0 ? Math.round(totalFocus / durations.length) : 0;
  const longestSession = durations.length > 0 ? Math.max(...durations) : 0;
  const shortestSession = durations.length > 0 ? Math.min(...durations) : 0;
  const breakMinutes = breakSessions.reduce((a, s) => a + (s.elapsedMin && s.elapsedMin > 0 ? s.elapsedMin : s.durationMin), 0);

  return {
    totalFocusMinutes: totalFocus,
    totalSessions: completedSessions.length,
    averageSessionMinutes: avgSession,
    longestSessionMinutes: longestSession,
    shortestSessionMinutes: shortestSession,
    interruptions: cancelledSessions.length,
    cancelledSessions: cancelledSessions.length,
    breakMinutes,
  };
}

/** Task lifecycle analytics */
export async function getTaskAnalytics(userId: string, startDateStr?: string, endDateStr?: string) {
  const { start, end } = parseRange(startDateStr, endDateStr);
  const dateFilter = (start || end) ? {
    ...(start ? { gte: start } : {}),
    ...(end ? { lte: end } : {}),
  } : undefined;

  const [allTasks, reschedules] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        ...(dateFilter ? {
          OR: [
            { createdAt: dateFilter },
            { completedAt: dateFilter },
            { updatedAt: dateFilter },
          ],
        } : {}),
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        completedAt: true,
        updatedAt: true,
        dueDate: true,
      },
    }),
    prisma.taskActivity.count({
      where: {
        userId,
        type: 'DUE_DATE_CHANGED',
        ...(dateFilter ? { createdAt: dateFilter } : {}),
      },
    }),
  ]);

  const completed = allTasks.filter(t => t.status === 'DONE');
  const cancelled = allTasks.filter(t => t.status === 'CANCELLED');
  const overdue = allTasks.filter(t => t.status !== 'DONE' && t.dueDate && t.dueDate < utcToday());

  // Completion times
  const completionTimes = completed
    .map(t => t.completedAt && t.createdAt ? (t.completedAt.getTime() - t.createdAt.getTime()) / (1000 * 60) : null)
    .filter((t): t is number => t !== null && t > 0);

  const avgCompletionMinutes = completionTimes.length > 0 ? Math.round(completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length) : 0;
  const fastestTaskMinutes = completionTimes.length > 0 ? Math.min(...completionTimes) : 0;
  const longestTaskMinutes = completionTimes.length > 0 ? Math.max(...completionTimes) : 0;
  const totalDays = dateFilter && start && end ? Math.max(daysBetween(toDateStr(start), toDateStr(end)) + 1, 1) : 30;

  return {
    totalCreated: allTasks.length,
    totalCompleted: completed.length,
    totalOverdue: overdue.length,
    totalCancelled: cancelled.length,
    totalRescheduled: reschedules,
    completionRate: allTasks.length > 0 ? Math.round((completed.length / allTasks.length) * 100) : 0,
    averageCompletionMinutes: avgCompletionMinutes,
    fastestTaskMinutes: Math.round(fastestTaskMinutes),
    longestTaskMinutes: Math.round(longestTaskMinutes),
    completionVelocityPerDay: Math.round((completed.length / totalDays) * 10) / 10,
  };
}

/** Habit analytics: per-habit completion rates */
export async function getHabitAnalytics(userId: string, startDateStr?: string, endDateStr?: string) {
  const { start, end } = parseRange(startDateStr, endDateStr);
  const dateFilter = (start || end) ? {
    ...(start ? { gte: start } : {}),
    ...(end ? { lte: end } : {}),
  } : undefined;

  const habits = await prisma.habit.findMany({
    where: { userId, isActive: true },
    include: {
      completions: {
        ...(dateFilter ? { where: { date: dateFilter } } : {}),
        select: { date: true },
      },
    },
  });

  const totalDays = start && end ? daysBetween(toDateStr(start), toDateStr(end)) + 1 : 30;
  const expectedForHabit = (targetPerWeek: number) => (targetPerWeek >= 7 ? totalDays : Math.ceil((totalDays / 7) * targetPerWeek));

  const habitData = habits.map((h) => {
    const totalExpected = expectedForHabit(h.targetPerWeek);
    const completionRate = totalExpected > 0 ? Math.round((h.completions.length / totalExpected) * 100) : 0;
    const skippedDays = Math.max(totalExpected - h.completions.length, 0);
    return {
      id: h.id,
      title: h.title,
      completionCount: h.completions.length,
      totalExpected,
      skippedDays,
      completionRate,
    };
  });

  const overallCompletion = habitData.length > 0
    ? Math.round(habitData.reduce((a, h) => a + h.completionRate, 0) / habitData.length)
    : 0;

  const weakest = [...habitData].sort((a, b) => a.completionRate - b.completionRate)[0] || null;
  const strongest = [...habitData].sort((a, b) => b.completionRate - a.completionRate)[0] || null;
  const totalSkippedDays = habitData.reduce((sum, h) => sum + h.skippedDays, 0);

  return {
    habits: habitData,
    overallCompletion,
    totalSkippedDays,
    weakestHabit: weakest ? { id: weakest.id, title: weakest.title, rate: weakest.completionRate } : null,
    strongestHabit: strongest ? { id: strongest.id, title: strongest.title, rate: strongest.completionRate } : null,
    mostSuccessfulHabit: strongest ? { id: strongest.id, title: strongest.title, rate: strongest.completionRate } : null,
  };
}

/** Weekly consistency: per-day-of-week aggregation */
export async function getConsistency(userId: string, startDateStr?: string, endDateStr?: string) {
  const { start, end } = parseRange(startDateStr, endDateStr);
  const effectiveEnd = end ?? (() => { const d = utcToday(); d.setUTCHours(23, 59, 59, 999); return d; })();
  const effectiveStart = start ?? (() => { const d = new Date(effectiveEnd); d.setUTCDate(d.getUTCDate() - 29); return d; })();

  const daily = await getDailyBreakdown(userId, 30, toDateStr(effectiveStart), toDateStr(effectiveEnd));
  
  const dayBuckets: Record<number, { tasks: number; habits: number; focus: number; count: number }> = {};
  for (let i = 0; i < 7; i++) dayBuckets[i] = { tasks: 0, habits: 0, focus: 0, count: 0 };

  for (const d of daily) {
    const dayOfWeek = getDayOfWeek(d.date);
    dayBuckets[dayOfWeek].tasks += d.tasksCompleted;
    dayBuckets[dayOfWeek].habits += d.habitsCompleted;
    dayBuckets[dayOfWeek].focus += d.focusMinutes;
    dayBuckets[dayOfWeek].count++;
  }

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const days = Object.entries(dayBuckets).map(([key, val]) => ({
    day: dayNames[parseInt(key)],
    tasksPerDay: val.count > 0 ? Math.round((val.tasks / val.count) * 10) / 10 : 0,
    habitsPerDay: val.count > 0 ? Math.round((val.habits / val.count) * 10) / 10 : 0,
    focusPerDay: val.count > 0 ? Math.round(val.focus / val.count) : 0,
    score: val.count > 0 ? Math.min(Math.round(((val.tasks + val.habits) / Math.max(val.count, 1)) * 10), 10) : 0,
  }));

  const overallScore = days.length > 0
    ? Math.round(days.reduce((a, d) => a + (d.score / 10) * 100, 0) / days.length)
    : 0;

  return { days, overallScore };
}

/** Time of day analysis */
export async function getTimeOfDay(userId: string, startDateStr?: string, endDateStr?: string) {
  const { start, end } = parseRange(startDateStr, endDateStr);
  const dateFilter = (start || end) ? {
    ...(start ? { gte: start } : {}),
    ...(end ? { lte: end } : {}),
  } : undefined;

  const tasks = await prisma.task.findMany({
    where: {
      userId,
      status: 'DONE',
      ...(dateFilter ? { completedAt: dateFilter } : {}),
    },
    select: { completedAt: true },
  });

  const focusSessions = await prisma.focusSession.findMany({
    where: {
      userId,
      status: 'COMPLETED',
      isBreak: false,
      ...(dateFilter ? { startedAt: dateFilter } : {}),
    },
    select: { startedAt: true, durationMin: true, elapsedMin: true },
  });

  const slots = ['morning', 'afternoon', 'evening', 'night'];
  const slotRanges = [{ start: 5, end: 12 }, { start: 12, end: 17 }, { start: 17, end: 21 }, { start: 21, end: 5 }];
  
  const timeSlots = slots.map((name, i) => {
    const { start: s, end: e } = slotRanges[i];
    const slotTasks = tasks.filter(t => {
      if (!t.completedAt) return false;
      const h = t.completedAt.getUTCHours();
      if (e > s) return h >= s && h < e;
      return h >= s || h < e;
    });
      const slotFocus = focusSessions.filter(fs => {
        const h = fs.startedAt.getUTCHours();
        if (e > s) return h >= s && h < e;
        return h >= s || h < e;
      });
      const focusMinutes = slotFocus.reduce((a, f) => a + (f.elapsedMin && f.elapsedMin > 0 ? f.elapsedMin : f.durationMin), 0);
      const averageSessionMinutes = slotFocus.length > 0 ? Math.round(focusMinutes / slotFocus.length) : 0;

      return {
        slot: name,
        tasksCompleted: slotTasks.length,
        focusMinutes,
        completionRate: tasks.length > 0 ? Math.round((slotTasks.length / tasks.length) * 100) : 0,
        averageSessionMinutes,
      };
    });

  return { timeSlots };
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

function calcStreak(dates: string[], skipDays: number[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...new Set(dates)].sort().reverse();
  const today = utcToday();
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  let cursor = new Date(`${sorted[0]}T00:00:00.000Z`);
  const yesterdayStr = toDateStr(yesterday);
  if (cursor < yesterday && !skipDays.includes(getDayOfWeek(yesterdayStr))) return 0;

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i]}T00:00:00.000Z`);
    const diff = (cursor.getTime() - prev.getTime()) / 86400000;
    if (diff === 1) {
      streak++;
      cursor = prev;
    } else {
      let gapFilledBySkips = true;
      let checkDate = new Date(prev);
      checkDate.setUTCDate(checkDate.getUTCDate() + 1);
      while (checkDate < cursor) {
        const checkStr = toDateStr(checkDate);
        if (!skipDays.includes(getDayOfWeek(checkStr))) {
          gapFilledBySkips = false;
          break;
        }
        checkDate.setUTCDate(checkDate.getUTCDate() + 1);
      }
      if (gapFilledBySkips) { streak++; cursor = prev; }
      else break;
    }
  }
  return streak;
}

function calcBestStreak(dates: string[], skipDays: number[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...new Set(dates)].sort();
  let best = 1, current = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diff = daysBetween(sorted[i - 1], sorted[i]);
    if (diff === 1) { current++; best = Math.max(best, current); }
    else {
      let gapIsSkip = true;
      const start = new Date(`${sorted[i - 1]}T00:00:00.000Z`);
      const end = new Date(`${sorted[i]}T00:00:00.000Z`);
      let checkDate = new Date(start);
      checkDate.setUTCDate(checkDate.getUTCDate() + 1);
      while (checkDate < end) {
        const checkStr = toDateStr(checkDate);
        if (!skipDays.includes(getDayOfWeek(checkStr))) { gapIsSkip = false; break; }
        checkDate.setUTCDate(checkDate.getUTCDate() + 1);
      }
      if (gapIsSkip) { current++; best = Math.max(best, current); }
      else current = 1;
    }
  }
  return best;
}

function getWeekKey(date: Date): string {
  const d = new Date(date);
  const utcTs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const utcDate = new Date(utcTs);
  utcDate.setUTCDate(utcDate.getUTCDate() + 3 - ((utcDate.getUTCDay() + 6) % 7));
  const week1 = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 4));
  const weekNum = 1 + Math.round(((utcDate.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return `${utcDate.getUTCFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}
