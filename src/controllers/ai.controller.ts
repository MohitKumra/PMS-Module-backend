// backend/src/controllers/ai.controller.ts
// Controller for AI-powered endpoints. Each endpoint checks the user's
// AI preference toggle before spending tokens; disabled features return
// a zero-token fallback shape.

import { Request, Response } from 'express';
import { getAIStatus, generateAIInsights, generateAICoach, generateDailyBrief, analyzeJournalEntry, analyzeJournalWeek, parseTaskFromNaturalLanguage, generateGoalPlan, fallbackGoalPlan } from '../services/ai/aiService';
import { getSummary, getWeeklyProgress, getUpcomingDeadlines } from '../services/analytics.service';
import { prisma } from '../lib/prismaClient';
import * as goalService from '../services/goal.service';

export type AIFeatureKey =
  | 'dailyBriefEnabled'
  | 'journalWeeklyEnabled'
  | 'insightsEnabled'
  | 'coachEnabled'
  | 'journalAnalysisEnabled'
  | 'goalSummaryEnabled'
  | 'taskParserEnabled'
  | 'goalPlannerEnabled';

async function isAIFeatureEnabled(userId: string, featureKey: AIFeatureKey): Promise<boolean> {
  try {
    const aiPref = await prisma.aIPreference.findUnique({ where: { userId } });
    if (!aiPref) return true;
    return aiPref[featureKey] !== false;
  } catch (e) {
    return true;
  }
}

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

export async function getStatus(req: Request, res: Response) {
  const status = getAIStatus();
  res.json(status);
}

export async function getInsights(req: Request, res: Response) {
  const userId = req.user!.sub;
  try {
    const enabled = await isAIFeatureEnabled(userId, 'insightsEnabled');
    if (!enabled) {
      res.json({ insights: [], source: 'fallback' });
      return;
    }

    const summary = await getSummary(userId);
    const weeklyProgress = await getWeeklyProgress(userId, 2);
    const upcomingDeadlines = await getUpcomingDeadlines(userId, 7);

    const today = utcToday();
    const weekStart = new Date(today);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    const journalEntries = await prisma.note.findMany({
      where: { userId, isJournal: true, createdAt: { gte: weekStart } },
      select: { createdAt: true },
    });
    const journalDates = new Set(journalEntries.map(n => toDateStr(n.createdAt)));
    const journalDaysThisWeek = journalDates.size;

    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tasksDueSoon = await prisma.task.count({
      where: { userId, status: { not: 'DONE' }, dueDate: { gte: today, lt: tomorrow } },
    });

    const totalProjects = await prisma.project.count({ where: { userId } });

    const weeklyTaskTrend = weeklyProgress.length >= 2
      ? `${weeklyProgress[1].tasksCompleted > weeklyProgress[0].tasksCompleted ? 'up' : 'down'} from last week`
      : 'stable';
    const weeklyFocusTrend = weeklyProgress.length >= 2
      ? `${weeklyProgress[1].focusMinutes > weeklyProgress[0].focusMinutes ? 'up' : 'down'} from last week`
      : 'stable';

    const result = await generateAIInsights(userId, {
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

export async function getCoach(req: Request, res: Response) {
  const userId = req.user!.sub;
  try {
    const enabled = await isAIFeatureEnabled(userId, 'coachEnabled');
    if (!enabled) {
      res.json({ title: '', message: '', suggestion: { text: '', actionLabel: '' }, mood: 'encouraging', source: 'fallback' });
      return;
    }

    const summary = await getSummary(userId);
    const recentTask = await prisma.task.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { title: true, status: true },
    });
    const recentActivity = recentTask
      ? `Last task: "${recentTask.title}" (${recentTask.status})`
      : 'No recent activity';

    const result = await generateAICoach(userId, {
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

export async function getDailyBrief(req: Request, res: Response) {
  const userId = req.user!.sub;
  try {
    const enabled = await isAIFeatureEnabled(userId, 'dailyBriefEnabled');
    if (!enabled) {
      res.json({ greeting: 'Good day', summary: '', priorities: [], focusTip: '', motivation: '', source: 'fallback' });
      return;
    }

    const summary = await getSummary(userId);
    const today = utcToday();
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const tasksDueToday = await prisma.task.count({
      where: { userId, status: { not: 'DONE' }, dueDate: { gte: today, lt: tomorrow } },
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

    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayCompletions = await prisma.habitCompletion.count({
      where: { habit: { userId }, date: { gte: yesterday, lt: today } },
    });

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const now = new Date();

    const result = await generateDailyBrief(userId, {
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

export async function postAnalyzeJournal(req: Request, res: Response) {
  const { content } = req.body;
  if (!content || typeof content !== 'string') {
    res.status(400).json({ error: 'Journal content is required' });
    return;
  }

  try {
    const userId = req.user!.sub;
    const enabled = await isAIFeatureEnabled(userId, 'journalAnalysisEnabled');
    if (!enabled) {
      res.json({ mood: 'neutral', moodLabel: 'Reflective', themes: [], insight: '', reflectionPrompt: '', source: 'fallback' });
      return;
    }
    const result = await analyzeJournalEntry(userId, content);
    res.json(result);
  } catch (error: any) {
    console.error('[AI] Journal analysis error:', error.message);
    res.status(500).json({ error: 'Failed to analyze journal entry' });
  }
}

export async function getJournalWeekly(req: Request, res: Response) {
  const userId = req.user!.sub;
  try {
    const enabled = await isAIFeatureEnabled(userId, 'journalWeeklyEnabled');
    if (!enabled) {
      res.json({ overallMood: 'neutral', moodTrend: '', keyThemes: [], summary: '', insight: '', suggestion: '', source: 'fallback' });
      return;
    }

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

    const result = await analyzeJournalWeek(userId, formattedEntries);
    res.json(result);
  } catch (error: any) {
    console.error('[AI] Weekly journal error:', error.message);
    res.status(500).json({ error: 'Failed to analyze weekly journal' });
  }
}

export async function postParseTask(req: Request, res: Response) {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'Task text is required' });
    return;
  }

  try {
    const userId = req.user!.sub;
    const enabled = await isAIFeatureEnabled(userId, 'taskParserEnabled');
    if (!enabled) {
      res.json({ title: text, source: 'fallback' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const timezone = user?.timezone || 'UTC';

    const result = await parseTaskFromNaturalLanguage(userId, text, { timezone });
    res.json(result);
  } catch (error: any) {
    console.error('[AI] Task parse error:', error.message);
    res.status(500).json({ error: 'Failed to parse task' });
  }
}

export async function postGoalPlan(req: Request, res: Response) {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'Goal prompt is required' });
    return;
  }

  try {
    const userId = req.user!.sub;
    const enabled = await isAIFeatureEnabled(userId, 'goalPlannerEnabled');
    if (!enabled) {
      const fallback = fallbackGoalPlan(prompt);
      res.json({ ...fallback, source: 'fallback' as const });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const timezone = user?.timezone || 'UTC';

    const now = new Date();
    const localParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const todayDate =
      `${localParts.find((p) => p.type === 'year')?.value ?? '0000'}-` +
      `${localParts.find((p) => p.type === 'month')?.value ?? '01'}-` +
      `${localParts.find((p) => p.type === 'day')?.value ?? '01'}`;

    const localDayParts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
    }).formatToParts(now);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = localDayParts.find((p) => p.type === 'weekday')?.value ?? dayNames[now.getUTCDay()];

    const result = await generateGoalPlan(userId, prompt, { todayDate, dayName, timezone });
    res.json(result);
  } catch (error: any) {
    console.error('[AI] Goal plan error:', error.message);
    res.status(500).json({ error: 'Failed to generate goal plan' });
  }
}

export async function postGoalWorkspace(req: Request, res: Response) {
  const { plan } = req.body;
  if (!plan || typeof plan !== 'object') {
    res.status(400).json({ error: 'Goal plan is required' });
    return;
  }

  try {
    const result = await goalService.createGoalWorkspace(req.user!.sub, plan);
    res.status(201).json(result);
  } catch (error: any) {
    console.error('[AI] Goal workspace error:', error.message);
    res.status(500).json({ error: 'Failed to create goal workspace' });
  }
}