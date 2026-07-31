// backend/src/controllers/ai.controller.ts
// Controller for AI-powered endpoints.

import { Request, Response } from 'express';
import { getAIStatus, generateAIInsights, generateAICoach, generateDailyBrief, analyzeJournalEntry, analyzeJournalWeek, parseTaskFromNaturalLanguage } from '../services/ai/aiService';
import { getSummary, getWeeklyProgress, getUpcomingDeadlines } from '../services/analytics.service';
import { prisma } from '../lib/prismaClient';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

// ─── GET /api/ai/status ──────────────────────────────────────────────────────

export async function getStatus(req: Request, res: Response) {
  const status = getAIStatus();
  res.json(status);
}

// ─── GET /api/ai/insights ─────────────────────────────────────────────────────

export async function getInsights(req: Request, res: Response) {
  const userId = req.user!.sub;

  try {
    const summary = await getSummary(userId);
    const weeklyProgress = await getWeeklyProgress(userId, 2);
    const upcomingDeadlines = await getUpcomingDeadlines(userId, 7);

    // Get journal count for this week
    const today = utcToday();
    const weekStart = new Date(today);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    const journalEntries = await prisma.note.findMany({
      where: { userId, isJournal: true, createdAt: { gte: weekStart } },
      select: { createdAt: true },
    });
    const journalDates = new Set(journalEntries.map(n => toDateStr(n.createdAt)));
    const journalDaysThisWeek = journalDates.size;

    // Get tasks due soon (next 24h)
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tasksDueSoon = await prisma.task.count({
      where: { userId, status: { not: 'DONE' }, dueDate: { gte: today, lt: tomorrow } },
    });

    // Get total projects count
    const totalProjects = await prisma.project.count({ where: { userId } });

    // Calculate trends
    const weeklyTaskTrend = weeklyProgress.length >= 2
      ? `${weeklyProgress[1].tasksCompleted > weeklyProgress[0].tasksCompleted ? 'up' : 'down'} from last week`
      : 'stable';

    const weeklyFocusTrend = weeklyProgress.length >= 2
      ? `${weeklyProgress[1].focusMinutes > weeklyProgress[0].focusMinutes ? 'up' : 'down'} from last week`
      : 'stable';

    const result = await generateAIInsights({
      tasksCompleted: summary.tasksCompleted,
      tasksTotal: summary.tasksTotal,
      taskCompletionRate: summary.taskCompletionRate,
      tasksOverdue: summary.overdueTasks,
      tasksDueSoon,
      habitsCompletedToday: summary.habitsCompletedToday,
      habitsTotal: summary.habitsTotal,
      currentHabitStreak: summary.currentHabitStreak,
      longestHabitStreak: summary.longestHabitStreak,
      focusMinutesTotal: summary.focusMinutesTotal,
      focusSessionsTotal: summary.focusSessionsTotal,
      productivityScore: summary.productivityScore,
      weeklyTaskTrend,
      weeklyFocusTrend,
      journalDaysThisWeek,
      upcomingDeadlines: upcomingDeadlines.length,
      hasProjects: totalProjects > 0,
    });

    res.json(result);
  } catch (error: any) {
    console.error('[AI] Insights error:', error.message);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
}

// ─── GET /api/ai/coach ────────────────────────────────────────────────────────

export async function getCoach(req: Request, res: Response) {
  const userId = req.user!.sub;

  try {
    const summary = await getSummary(userId);

    // Get recent activity
    const recentTask = await prisma.task.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { title: true, status: true },
    });

    const recentActivity = recentTask
      ? `Last task: "${recentTask.title}" (${recentTask.status})`
      : 'No recent activity';

    const result = await generateAICoach({
      completedToday: summary.habitsCompletedToday,
      totalHabits: summary.habitsTotal,
      currentStreak: summary.currentHabitStreak,
      longestStreak: summary.longestHabitStreak,
      tasksCompleted: summary.tasksCompleted,
      tasksOverdue: summary.overdueTasks,
      focusMinutesToday: summary.focusMinutesTotal,
      timeOfDay: getTimeOfDay(),
      recentActivity,
    });

    res.json(result);
  } catch (error: any) {
    console.error('[AI] Coach error:', error.message);
    res.status(500).json({ error: 'Failed to generate coach message' });
  }
}

// ─── GET /api/ai/daily-brief ──────────────────────────────────────────────────

export async function getDailyBrief(req: Request, res: Response) {
  const userId = req.user!.sub;

  try {
    const summary = await getSummary(userId);
    const today = utcToday();
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const tasksDueToday = await prisma.task.count({
      where: {
        userId,
        status: { not: 'DONE' },
        dueDate: { gte: today, lt: tomorrow },
      },
    });

    const topPriorityTask = await prisma.task.findFirst({
      where: { userId, status: { not: 'DONE' }, priority: 'CRITICAL' },
      orderBy: { dueDate: 'asc' },
      select: { title: true },
    });

    const nextDeadline = await prisma.task.findFirst({
      where: { userId, status: { not: 'DONE' }, dueDate: { not: null } },
      orderBy: { dueDate: 'asc' },
      select: { title: true, dueDate: true },
    });

    // Habits completed yesterday
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayCompletions = await prisma.habitCompletion.count({
      where: { habit: { userId }, date: { gte: yesterday, lt: today } },
    });

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const now = new Date();

    const result = await generateDailyBrief({
      dayName: dayNames[now.getUTCDay()],
      date: now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
      tasksToday: tasksDueToday,
      tasksOverdue: summary.overdueTasks,
      habitsToday: summary.habitsTotal,
      habitsCompletedYesterday: yesterdayCompletions,
      currentStreak: summary.currentHabitStreak,
      focusMinutesYesterday: summary.focusMinutesTotal,
      topPriorityTask: topPriorityTask?.title || null,
      upcomingDeadline: nextDeadline
        ? `${nextDeadline.title} (${nextDeadline.dueDate?.toLocaleDateString()})`
        : null,
    });

    res.json(result);
  } catch (error: any) {
    console.error('[AI] Daily brief error:', error.message);
    res.status(500).json({ error: 'Failed to generate daily brief' });
  }
}

// ─── POST /api/ai/analyze-journal ─────────────────────────────────────────────

export async function postAnalyzeJournal(req: Request, res: Response) {
  const { content } = req.body;
  if (!content || typeof content !== 'string') {
    res.status(400).json({ error: 'Journal content is required' });
    return;
  }

  try {
    const result = await analyzeJournalEntry(content);
    res.json(result);
  } catch (error: any) {
    console.error('[AI] Journal analysis error:', error.message);
    res.status(500).json({ error: 'Failed to analyze journal entry' });
  }
}

// ─── GET /api/ai/journal-weekly ───────────────────────────────────────────────

export async function getJournalWeekly(req: Request, res: Response) {
  const userId = req.user!.sub;

  try {
    const today = utcToday();
    const weekStart = new Date(today);
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);

    const entries = await prisma.note.findMany({
      where: { userId, isJournal: true, createdAt: { gte: weekStart } },
      orderBy: { createdAt: 'desc' },
      select: { content: true, createdAt: true, tags: true },
    });

    const formattedEntries = entries.map((e) => ({
      date: toDateStr(e.createdAt),
      content: e.content?.substring(0, 1000) || '',
      mood: (e.tags as string[])?.find((t) => ['positive', 'neutral', 'negative', 'mixed'].includes(t)) || undefined,
    }));

    const result = await analyzeJournalWeek(formattedEntries);
    res.json(result);
  } catch (error: any) {
    console.error('[AI] Weekly journal error:', error.message);
    res.status(500).json({ error: 'Failed to analyze weekly journal' });
  }
}

// ─── POST /api/ai/parse-task ──────────────────────────────────────────────────

export async function postParseTask(req: Request, res: Response) {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'Task text is required' });
    return;
  }

  try {
    const userId = req.user!.sub;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const timezone = user?.timezone || 'UTC';

    const result = await parseTaskFromNaturalLanguage(text, { timezone });
    res.json(result);
  } catch (error: any) {
    console.error('[AI] Task parse error:', error.message);
    res.status(500).json({ error: 'Failed to parse task' });
  }
}