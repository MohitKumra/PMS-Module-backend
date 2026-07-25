// backend/src/services/insight.service.ts
// Generates contextual, data-driven insight sentences for the dashboard.
// Each insight is built from real analytics data with multiple sentence
// templates per metric to avoid repetition. Zero-aware: never says "great
// job" when the metric is 0.

import { prisma } from '../lib/prismaClient';
import type { InsightDTO, InsightType, InsightIcon } from '../types';
import { getSummary, getWeeklyProgress, getUpcomingDeadlines } from './analytics.service';

/** UTC midnight for "today" — matches habit.service.ts definition exactly. */
function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Convert any Date to a UTC-only "YYYY-MM-DD" string. */
function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

/** Pick a random element from an array (for sentence variety). */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Insight builders ─────────────────────────────────────────────────────────

interface InsightBuilderContext {
  userId: string;
  summary: Awaited<ReturnType<typeof getSummary>>;
  weeklyProgress: Awaited<ReturnType<typeof getWeeklyProgress>>;
  upcomingDeadlines: Awaited<ReturnType<typeof getUpcomingDeadlines>>;
  habits: Array<{ id: string; title: string; currentStreak: number; completionsThisWeek: number; completionsLastWeek: number }>;
  focusSessions: Array<{ startedAt: Date; durationMin: number }>;
  notes: Array<{ createdAt: Date; isJournal: boolean }>;
  tasksOverdue: number;
  tasksDueSoon: number;
}

function buildTaskInsight(ctx: InsightBuilderContext): InsightDTO | null {
  const { summary, tasksOverdue, tasksDueSoon } = ctx;
  const { tasksCompleted, tasksTotal, taskCompletionRate } = summary;

  // No tasks at all
  if (tasksTotal === 0) {
    return {
      id: 'task-zero',
      type: 'neutral',
      icon: 'calendar',
      text: 'No tasks yet — create one to start tracking your productivity.',
    };
  }

  // Overdue tasks
  if (tasksOverdue > 0) {
    const templates = [
      `You have ${tasksOverdue} overdue task${tasksOverdue > 1 ? 's' : ''} — worth prioritizing today.`,
      `${tasksOverdue} task${tasksOverdue > 1 ? 's are' : ' is'} past due. A quick review could help you catch up.`,
    ];
    return {
      id: 'task-overdue',
      type: 'warning',
      icon: 'alert',
      text: pick(templates),
    };
  }

  // Due-soon tasks
  if (tasksDueSoon > 0) {
    return {
      id: 'task-due-soon',
      type: 'neutral',
      icon: 'calendar',
      text: `${tasksDueSoon} task${tasksDueSoon > 1 ? 's are' : ' is'} due in the next 24 hours.`,
    };
  }

  // High completion rate
  if (taskCompletionRate >= 80 && tasksCompleted > 0) {
    const templates = [
      `You've completed ${taskCompletionRate}% of your tasks — strong momentum today!`,
      `${tasksCompleted} of ${tasksTotal} tasks done. You're on a roll!`,
    ];
    return {
      id: 'task-high-completion',
      type: 'positive',
      icon: 'trend',
      text: pick(templates),
    };
  }

  // Medium completion rate
  if (taskCompletionRate >= 40 && taskCompletionRate < 80) {
    return {
      id: 'task-medium-completion',
      type: 'neutral',
      icon: 'clock',
      text: `${tasksCompleted} of ${tasksTotal} tasks completed. Keep chipping away — every task counts.`,
    };
  }

  // Low completion rate (but has tasks)
  if (taskCompletionRate < 40 && tasksTotal > 0) {
    const templates = [
      `You've completed ${taskCompletionRate}% of your tasks so far. Starting small can build momentum.`,
      `Only ${tasksCompleted} of ${tasksTotal} tasks done. Try tackling the easiest one first.`,
    ];
    return {
      id: 'task-low-completion',
      type: 'warning',
      icon: 'alert',
      text: pick(templates),
    };
  }

  return null;
}

function buildHabitInsight(ctx: InsightBuilderContext): InsightDTO | null {
  const { summary, habits } = ctx;
  const { habitsCompletedToday, habitsTotal, currentHabitStreak, longestHabitStreak } = summary;

  // No habits
  if (habitsTotal === 0) {
    return {
      id: 'habit-zero',
      type: 'neutral',
      icon: 'clock',
      text: 'No habits tracked yet. Create a habit to build consistent routines.',
    };
  }

  // Active streak
  if (currentHabitStreak >= 7) {
    const templates = [
      `Your habit streak is at ${currentHabitStreak} days 🔥 Consistency is becoming second nature!`,
      `${currentHabitStreak}-day streak and counting! You're building real momentum.`,
    ];
    return {
      id: 'habit-streak-high',
      type: 'positive',
      icon: 'trend',
      text: pick(templates),
    };
  }

  if (currentHabitStreak >= 3 && currentHabitStreak < 7) {
    return {
      id: 'habit-streak-medium',
      type: 'positive',
      icon: 'trend',
      text: `Nice — you're on a ${currentHabitStreak}-day streak. Keep it going!`,
    };
  }

  if (currentHabitStreak === 1 || currentHabitStreak === 2) {
    return {
      id: 'habit-streak-low',
      type: 'neutral',
      icon: 'clock',
      text: `You've started a ${currentHabitStreak}-day streak. Tomorrow is your chance to build on it.`,
    };
  }

  // No streak but has habits — check weekly trend
  if (habits.length > 0) {
    // Check if any habit has completions this week vs last week
    let thisWeekTotal = 0;
    let lastWeekTotal = 0;
    for (const h of habits) {
      thisWeekTotal += h.completionsThisWeek;
      lastWeekTotal += h.completionsLastWeek;
    }

    if (thisWeekTotal === 0 && lastWeekTotal === 0) {
      return {
        id: 'habit-no-activity',
        type: 'neutral',
        icon: 'clock',
        text: 'No habits completed this week or last. Try completing one today to restart.',
      };
    }

    if (thisWeekTotal > 0 && lastWeekTotal > 0 && thisWeekTotal < lastWeekTotal) {
      const drop = Math.round(((lastWeekTotal - thisWeekTotal) / lastWeekTotal) * 100);
      return {
        id: 'habit-drop',
        type: 'warning',
        icon: 'alert',
        text: `Habit completions dropped ${drop}% this week. Don't break the chain!`,
      };
    }

    if (thisWeekTotal > 0 && thisWeekTotal >= lastWeekTotal) {
      return {
        id: 'habit-improving',
        type: 'positive',
        icon: 'trend',
        text: `You've completed ${thisWeekTotal} habit${thisWeekTotal > 1 ? 's' : ''} this week — keep the momentum!`,
      };
    }
  }

  return null;
}

function buildFocusInsight(ctx: InsightBuilderContext): InsightDTO | null {
  const { summary, focusSessions } = ctx;
  const { focusMinutesTotal, focusSessionsTotal } = summary;

  // No focus sessions
  if (focusSessionsTotal === 0 && focusMinutesTotal === 0) {
    return {
      id: 'focus-zero',
      type: 'neutral',
      icon: 'clock',
      text: 'No focus sessions logged yet. Start a session to boost your deep work time.',
    };
  }

  // Has focus time — find peak hour
  if (focusSessions.length > 0) {
    const hourBuckets = new Array(24).fill(0);
    for (const s of focusSessions) {
      const hour = s.startedAt.getUTCHours();
      hourBuckets[hour] += s.durationMin;
    }

    let peakHour = -1;
    let peakMinutes = 0;
    for (let h = 0; h < 24; h++) {
      if (hourBuckets[h] > peakMinutes) {
        peakMinutes = hourBuckets[h];
        peakHour = h;
      }
    }

    if (peakHour >= 0 && peakMinutes > 0) {
      const formatHour = (h: number) => {
        const period = h >= 12 ? 'PM' : 'AM';
        const hour12 = h % 12 || 12;
        return `${hour12}:00 ${period}`;
      };

      const templates = [
        `Your peak focus time is typically around ${formatHour(peakHour)} — schedule deep work then.`,
        `You focus best near ${formatHour(peakHour)}. That's your power hour!`,
      ];

      return {
        id: 'focus-peak',
        type: 'positive',
        icon: 'trend',
        text: pick(templates),
      };
    }
  }

  // Has some focus minutes but no sessions (time logs)
  if (focusMinutesTotal > 0 && focusSessionsTotal === 0) {
    return {
      id: 'focus-logs',
      type: 'neutral',
      icon: 'clock',
      text: `You've logged ${focusMinutesTotal} focus minutes. Try using focus sessions for better tracking.`,
    };
  }

  // General focus stat
  if (focusMinutesTotal > 0) {
    const hours = Math.floor(focusMinutesTotal / 60);
    const mins = focusMinutesTotal % 60;
    return {
      id: 'focus-total',
      type: 'positive',
      icon: 'trend',
      text: `Total focus time: ${hours}h ${mins}m across ${focusSessionsTotal} session${focusSessionsTotal !== 1 ? 's' : ''}.`,
    };
  }

  return null;
}

function buildProductivityTrendInsight(ctx: InsightBuilderContext): InsightDTO | null {
  const { weeklyProgress } = ctx;

  if (weeklyProgress.length < 2) {
    return null;
  }

  const current = weeklyProgress[weeklyProgress.length - 1];
  const previous = weeklyProgress[weeklyProgress.length - 2];

  // Compare tasks completed week over week
  if (current.tasksCompleted > previous.tasksCompleted && previous.tasksCompleted > 0) {
    const increase = Math.round(((current.tasksCompleted - previous.tasksCompleted) / previous.tasksCompleted) * 100);
    return {
      id: 'trend-tasks-up',
      type: 'positive',
      icon: 'trend',
      text: `Tasks completed increased ${increase}% compared to last week. Great progress!`,
    };
  }

  if (current.tasksCompleted < previous.tasksCompleted && previous.tasksCompleted > 0) {
    const decrease = Math.round(((previous.tasksCompleted - current.tasksCompleted) / previous.tasksCompleted) * 100);
    return {
      id: 'trend-tasks-down',
      type: 'warning',
      icon: 'alert',
      text: `Tasks completed dropped ${decrease}% this week. Small steps can turn it around.`,
    };
  }

  // Compare focus minutes
  if (current.focusMinutes > previous.focusMinutes && previous.focusMinutes > 0) {
    const increase = Math.round(((current.focusMinutes - previous.focusMinutes) / previous.focusMinutes) * 100);
    return {
      id: 'trend-focus-up',
      type: 'positive',
      icon: 'trend',
      text: `Focus time is up ${increase}% from last week — your deep work is paying off.`,
    };
  }

  if (current.focusMinutes < previous.focusMinutes && previous.focusMinutes > 0) {
    const decrease = Math.round(((previous.focusMinutes - current.focusMinutes) / previous.focusMinutes) * 100);
    return {
      id: 'trend-focus-down',
      type: 'neutral',
      icon: 'clock',
      text: `Focus time decreased ${decrease}% this week. Even 10 minutes helps rebuild the habit.`,
    };
  }

  return null;
}

function buildDeadlineInsight(ctx: InsightBuilderContext): InsightDTO | null {
  const { upcomingDeadlines } = ctx;

  if (upcomingDeadlines.length === 0) {
    return null;
  }

  const urgent = upcomingDeadlines.filter((d) => d.daysUntilDue <= 1);
  const soon = upcomingDeadlines.filter((d) => d.daysUntilDue > 1 && d.daysUntilDue <= 3);
  const later = upcomingDeadlines.filter((d) => d.daysUntilDue > 3);

  if (urgent.length > 0) {
    const names = urgent.slice(0, 2).map((d) => `"${d.title}"`).join(', ');
    const suffix = urgent.length > 2 ? ` and ${urgent.length - 2} more` : '';
    return {
      id: 'deadline-urgent',
      type: 'warning',
      icon: 'alert',
      text: `Urgent: ${names}${suffix} ${urgent.length === 1 ? 'is' : 'are'} due within 24 hours.`,
    };
  }

  if (soon.length > 0) {
    return {
      id: 'deadline-soon',
      type: 'neutral',
      icon: 'calendar',
      text: `${soon.length} deadline${soon.length > 1 ? 's' : ''} coming up in the next 3 days. A little planning goes a long way.`,
    };
  }

  if (later.length > 0) {
    return {
      id: 'deadline-later',
      type: 'neutral',
      icon: 'calendar',
      text: `You have ${later.length} upcoming deadline${later.length > 1 ? 's' : ''} this week. Stay ahead of the curve.`,
    };
  }

  return null;
}

function buildJournalInsight(ctx: InsightBuilderContext): InsightDTO | null {
  const { notes } = ctx;

  const journalEntries = notes.filter((n) => n.isJournal);
  if (journalEntries.length === 0) {
    return null;
  }

  // Check last 7 days for journal consistency
  const today = utcToday();
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    return toDateStr(d);
  });

  const journalDates = journalEntries.map((n) => toDateStr(n.createdAt));
  const journalDaysCount = last7Days.filter((d) => journalDates.includes(d)).length;

  if (journalDaysCount >= 5) {
    return {
      id: 'journal-consistent',
      type: 'positive',
      icon: 'trend',
      text: `You've journaled ${journalDaysCount} of the last 7 days — reflection is a powerful habit!`,
    };
  }

  if (journalDaysCount >= 2 && journalDaysCount < 5) {
    return {
      id: 'journal-occasional',
      type: 'neutral',
      icon: 'clock',
      text: `You journaled ${journalDaysCount} day${journalDaysCount > 1 ? 's' : ''} this week. A quick entry today keeps the streak alive.`,
    };
  }

  if (journalDaysCount === 1) {
    return {
      id: 'journal-starting',
      type: 'neutral',
      icon: 'clock',
      text: 'You made a journal entry this week. Regular reflection can boost clarity and focus.',
    };
  }

  return null;
}

function buildScoreInsight(ctx: InsightBuilderContext): InsightDTO | null {
  const { summary } = ctx;
  const { productivityScore } = summary;

  if (productivityScore >= 80) {
    return {
      id: 'score-high',
      type: 'positive',
      icon: 'trend',
      text: `Productivity score: ${productivityScore}. You're in the zone — keep it up!`,
    };
  }

  if (productivityScore >= 50 && productivityScore < 80) {
    return {
      id: 'score-medium',
      type: 'neutral',
      icon: 'clock',
      text: `Productivity score: ${productivityScore}. Solid foundation — small tweaks can push it higher.`,
    };
  }

  if (productivityScore > 0 && productivityScore < 50) {
    return {
      id: 'score-low',
      type: 'warning',
      icon: 'alert',
      text: `Productivity score: ${productivityScore}. Every journey starts with a single step — try completing one task.`,
    };
  }

  return null;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Generate a set of contextual insights for the dashboard.
 * Returns 3-6 insights covering tasks, habits, focus, trends, deadlines,
 * journaling, and score. Each insight is data-driven and zero-aware.
 */
export async function generateInsights(userId: string): Promise<InsightDTO[]> {
  const [summary, weeklyProgress, upcomingDeadlines] = await Promise.all([
    getSummary(userId),
    getWeeklyProgress(userId, 8),
    getUpcomingDeadlines(userId, 7),
  ]);

  const [rawHabits, rawFocusSessions, notes, tasksOverdue, tasksDueSoon] = await Promise.all([
    prisma.habit.findMany({
      where: { userId, isActive: true },
      select: {
        id: true,
        title: true,
        completions: {
          select: { date: true },
        },
      },
    }),
    prisma.focusSession.findMany({
      where: { userId, status: 'COMPLETED', isBreak: false },
      select: { startedAt: true, durationMin: true },
      orderBy: { startedAt: 'desc' },
      take: 50,
    }),
    prisma.note.findMany({
      where: { userId },
      select: { createdAt: true, isJournal: true },
    }),
    prisma.task.count({
      where: { userId, status: { not: 'DONE' }, dueDate: { lt: utcToday() } },
    }),
    prisma.task.count({
      where: {
        userId,
        status: { not: 'DONE' },
        dueDate: {
          gte: utcToday(),
          lte: new Date(utcToday().getTime() + 24 * 60 * 60 * 1000),
        },
      },
    }),
  ]);

  // Compute habit metrics from raw completions
  const today = utcToday();
  const thisWeekStart = new Date(today);
  thisWeekStart.setUTCDate(thisWeekStart.getUTCDate() - thisWeekStart.getUTCDay());
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);
  const lastWeekEnd = new Date(thisWeekStart);

  const habits = rawHabits.map((h) => {
    const dateStrs = h.completions.map((c) => toDateStr(c.date));
    const uniqueDates = [...new Set(dateStrs)].sort().reverse();

    // Current streak
    let currentStreak = 0;
    if (uniqueDates.length > 0) {
      const yesterday = new Date(today);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const mostRecent = new Date(`${uniqueDates[0]}T00:00:00.000Z`);
      if (mostRecent >= yesterday) {
        currentStreak = 1;
        let cursor = mostRecent;
        for (let i = 1; i < uniqueDates.length; i++) {
          const prev = new Date(`${uniqueDates[i]}T00:00:00.000Z`);
          const diff = (cursor.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
          if (diff === 1) { currentStreak++; cursor = prev; } else break;
        }
      }
    }

    // Completions this week vs last week
    const completionsThisWeek = h.completions.filter((c) => {
      const d = new Date(c.date);
      return d >= thisWeekStart && d < today;
    }).length;

    const completionsLastWeek = h.completions.filter((c) => {
      const d = new Date(c.date);
      return d >= lastWeekStart && d < lastWeekEnd;
    }).length;

    return {
      id: h.id,
      title: h.title,
      currentStreak,
      completionsThisWeek,
      completionsLastWeek,
    };
  });

  const ctx: InsightBuilderContext = {
    userId,
    summary,
    weeklyProgress,
    upcomingDeadlines,
    habits,
    focusSessions: rawFocusSessions.map((s) => ({
      startedAt: s.startedAt,
      durationMin: s.durationMin,
    })),
    notes,
    tasksOverdue,
    tasksDueSoon,
  };

  // Build all possible insights, then filter out nulls
  const builders = [
    buildTaskInsight,
    buildHabitInsight,
    buildFocusInsight,
    buildProductivityTrendInsight,
    buildDeadlineInsight,
    buildJournalInsight,
    buildScoreInsight,
  ];

  const insights: InsightDTO[] = [];
  for (const builder of builders) {
    const insight = builder(ctx);
    if (insight) {
      insights.push(insight);
    }
  }

  // Return up to 6 insights, shuffled for variety
  const shuffled = insights.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 6);
}