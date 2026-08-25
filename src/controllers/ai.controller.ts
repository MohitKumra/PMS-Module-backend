// backend/src/controllers/ai.controller.ts
// Controller for AI-powered endpoints. Each endpoint checks the user's
// AI preference toggle before spending tokens; disabled features return
// a zero-token fallback shape.

import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import {
  getAIStatus,
  generateAIInsights,
  buildFallbackCoachResult,
  generateAICoach,
  generateDailyBrief,
  analyzeJournalEntry,
  analyzeJournalWeek,
  parseTaskFromNaturalLanguage,
  generateGoalPlan,
  fallbackGoalPlan,
} from '../services/ai/aiService';
import {
  buildCoachPromptData,
  createCoachChat,
  deleteCoachChat,
  getCoachChat,
  listCoachChats,
  recordCoachTurn,
} from '../services/ai/coachChat.service';
import { classifyIntent } from '../services/ai/coachIntent';
import { confirmCoachEntity } from '../services/ai/coachActions';
import { getSummary, getWeeklyProgress, getUpcomingDeadlines } from '../services/analytics.service';
import { prisma } from '../lib/prismaClient';
import * as goalService from '../services/goal.service';
import { checkUserEntitlement } from '../services/entitlement.service';

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
  } catch {
    return true;
  }
}

export async function checkAITokenQuota(userId: string): Promise<{ allowed: boolean; message?: string }> {
  try {
    const aiPref = await prisma.aIPreference.findUnique({ where: { userId } });
    const usageCount = aiPref?.aiRequestsThisMonth ?? 0;

    const entitlement = await checkUserEntitlement(userId, 'aiRequestsPerMonth', usageCount + 1);
    if (!entitlement.allowed) {
      return {
        allowed: false,
        message: `Monthly AI request limit reached (${entitlement.limit} requests on ${entitlement.currentEffectivePlan}). Upgrade your plan to get higher limits.`,
      };
    }
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

type CoachConversationTurn = {
  role: 'user' | 'assistant';
  content: string;
};

type CoachMessageInput = {
  role?: unknown;
  content?: unknown;
};

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
    const journalDates = new Set(journalEntries.map((n) => toDateStr(n.createdAt)));
    const journalDaysThisWeek = journalDates.size;

    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tasksDueSoon = await prisma.task.count({
      where: { userId, status: { not: 'DONE' }, dueDate: { gte: today, lt: tomorrow } },
    });

    const totalProjects = await prisma.project.count({ where: { userId } });

    const weeklyTaskTrend =
      weeklyProgress.length >= 2
        ? `${weeklyProgress[1].tasksCompleted > weeklyProgress[0].tasksCompleted ? 'up' : 'down'} from last week`
        : 'stable';
    const weeklyFocusTrend =
      weeklyProgress.length >= 2
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
      res.json({
        title: 'Coach',
        message: '',
        suggestion: { text: '', actionLabel: '', actionType: 'open_coach' as const },
        mood: 'encouraging',
        source: 'fallback',
      });
      return;
    }

    const result = await generateAICoach(userId, await buildCoachPromptData(userId, { mode: 'summary' }));
    res.json(result);
  } catch (error: any) {
    console.error('[AI] Coach error:', error.message);
    res.status(500).json({ error: 'Failed to generate coach message' });
  }
}

export async function postCoachChat(req: Request, res: Response) {
  const userId = req.user!.sub;
  const messages = (Array.isArray(req.body.messages) ? req.body.messages : []) as CoachMessageInput[];

  if (messages.length === 0) {
    res.status(400).json({ error: 'Coach messages are required' });
    return;
  }

  try {
    const enabled = await isAIFeatureEnabled(userId, 'coachEnabled');
    if (!enabled) {
      res.json({
        title: 'Coach',
        message: '',
        suggestion: { text: '', actionLabel: '', actionType: 'open_coach' as const },
        mood: 'encouraging',
        planPrompt: '',
        source: 'fallback',
      });
      return;
    }

    const quota = await checkAITokenQuota(userId);
    if (!quota.allowed) {
      res.json({
        title: 'Monthly AI Limit Reached',
        message: quota.message || 'You have reached your monthly AI limit. Please upgrade your plan in Settings to unlock more AI requests.',
        suggestion: { text: 'View Plans', actionLabel: 'Upgrade Plan', actionType: 'open_settings' as const },
        mood: 'calm',
        planPrompt: '',
        source: 'quota_exceeded',
      });
      return;
    }

    const conversation: CoachConversationTurn[] = messages
      .slice(-6)
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: typeof message.content === 'string' ? message.content.trim() : '',
      }))
      .filter((message): message is CoachConversationTurn => message.content.length > 0);

    if (conversation.length === 0) {
      res.status(400).json({ error: 'Coach messages are required' });
      return;
    }

    // Classify intent from the last two user turns so follow-up questions
    // (e.g. "yes that's what I'm asking") inherit the previous turn's domain.
    const userTurns = [...conversation].reverse().filter((t) => t.role === 'user');
    const lastUser = userTurns[0];
    const prevUser = userTurns[1];
    const intent = classifyIntent(lastUser?.content ?? '', prevUser?.content);

    // Build a lightweight session summary from the conversation tail so the
    // AI has continuity even in stateless mode (no persisted chat thread).
    const summaryParts = conversation
      .slice(-4)
      .map((t) => `${t.role === 'user' ? 'U' : 'A'}: ${t.content.slice(0, 80)}`)
      .join(' | ');

    const result = await generateAICoach(
      userId,
      await buildCoachPromptData(userId, {
        mode: 'chat',
        intent,
        session: {
          title: lastUser?.content ? lastUser.content.slice(0, 48) : 'Coach',
          summary: summaryParts,
          messageCount: conversation.length,
        },
        conversation,
      }),
    );
    res.json(result);
  } catch (error: any) {
    console.error('[AI] Coach chat error:', error.message);
    res.status(500).json({ error: 'Failed to generate coach chat response' });
  }
}

export async function getCoachChats(req: Request, res: Response) {
  const userId = req.user!.sub;
  try {
    res.json(await listCoachChats(userId));
  } catch (error: any) {
    console.error('[AI] Coach chats error:', error.message);
    res.status(500).json({ error: 'Failed to load coach chats' });
  }
}

export async function createCoachChatThread(req: Request, res: Response) {
  const userId = req.user!.sub;
  const title = typeof req.body?.title === 'string' ? req.body.title : undefined;

  try {
    const chat = await createCoachChat(userId, title);
    res.status(201).json(chat);
  } catch (error: any) {
    console.error('[AI] Coach create error:', error.message);
    res.status(500).json({ error: 'Failed to create coach chat' });
  }
}

export async function deleteCoachChatThread(req: Request, res: Response) {
  const userId = req.user!.sub;
  const chatId = typeof req.params.chatId === 'string' ? req.params.chatId : '';

  try {
    await deleteCoachChat(userId, chatId);
    res.status(200).json({ ok: true });
  } catch (error: any) {
    const status = error?.statusCode ?? error?.status ?? 500;
    const message = status === 404 ? 'Coach chat not found' : 'Failed to delete coach chat';
    console.error('[AI] Coach delete error:', error.message);
    res.status(status).json({ error: message });
  }
}

export async function getCoachChatThread(req: Request, res: Response) {
  const userId = req.user!.sub;
  const chatId = typeof req.params.chatId === 'string' ? req.params.chatId : '';
  try {
    res.json(await getCoachChat(userId, chatId));
  } catch (error: any) {
    const status = error?.statusCode ?? error?.status ?? 500;
    const message = status === 404 ? 'Coach chat not found' : 'Failed to load coach chat';
    console.error('[AI] Coach thread error:', error.message);
    res.status(status).json({ error: message });
  }
}

// ─── Image URL resolver ───────────────────────────────────────────────────────
// External AI providers (Groq, OpenAI) cannot reach localhost URLs.
// This helper converts local /uploads paths to base64 data URLs so the model
// can receive the image data regardless of where the server is running.

const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');
const LOCAL_HOST_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i;

async function resolveImageUrlsForAI(urls: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const url of urls) {
    try {
      if (LOCAL_HOST_PATTERN.test(url)) {
        const urlPath = new URL(url).pathname;
        if (urlPath.startsWith('/uploads/')) {
          const relativePath = urlPath.replace(/^\/uploads\//, '');
          const absolutePath = path.resolve(UPLOADS_ROOT, relativePath);
          if (absolutePath.startsWith(UPLOADS_ROOT + path.sep) || absolutePath === UPLOADS_ROOT) {
            const buffer = fs.readFileSync(absolutePath);
            const ext = path.extname(relativePath).toLowerCase().replace('.', '');
            const mimeMap: Record<string, string> = {
              jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
              webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
            };
            const mime = mimeMap[ext] ?? 'image/jpeg';
            results.push(`data:${mime};base64,${buffer.toString('base64')}`);
            continue;
          }
        }
        console.warn(`[AI] Skipping unresolvable local image URL: ${url}`);
      } else {
        results.push(url);
      }
    } catch (err: any) {
      console.warn(`[AI] Could not resolve image URL "${url}": ${err.message}`);
    }
  }
  return results;
}

// ─── Consecutive off-topic tracker ───────────────────────────────────────────
// Scans the tail of the stored conversation to count how many turns in a row
// the user was off-topic (chitchat intent). We look at the last N user turns
// only — one on-topic turn resets the counter to 0.

function countConsecutiveOffTopicTurns(
  messages: Array<{ role: string; content: string }>,
): number {
  const userMessages = [...messages].reverse().filter((m) => m.role === 'user');
  let count = 0;
  for (const msg of userMessages) {
    const intent = classifyIntent(msg.content);
    if (intent === 'chitchat') {
      count++;
    } else {
      break;
    }
  }
  return count;
}

// ─── postCoachChatMessage — main persisted chat endpoint ─────────────────────

export async function postCoachChatMessage(req: Request, res: Response) {
  const userId = req.user!.sub;
  const chatId = typeof req.params.chatId === 'string' ? req.params.chatId : '';
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

  // Validate and sanitise image URLs — only accept http/https, max 8 images
  const rawImageUrls = Array.isArray(req.body?.imageUrls) ? (req.body.imageUrls as unknown[]) : [];
  const imageUrls: string[] = rawImageUrls
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, 8);

  if (!message && imageUrls.length === 0) {
    res.status(400).json({ error: 'Coach message is required' });
    return;
  }

  try {
    const enabled = await isAIFeatureEnabled(userId, 'coachEnabled');
    const chat = await getCoachChat(userId, chatId);

    const conversation = [
      ...chat.messages.slice(-5).map((turn) => ({
        role: turn.role,
        content: turn.content,
      })),
      {
        role: 'user' as const,
        content: message || (imageUrls.length > 0 ? `[Shared ${imageUrls.length} image(s)]` : ''),
      },
    ];

    // ── Intent classification ──────────────────────────────────────────────
    const lastUser = message || '';
    const prevUser = [...chat.messages].reverse().find((m) => m.role === 'user')?.content;
    const intent = classifyIntent(lastUser, prevUser);

    // Count consecutive off-topic turns (before adding the new message)
    const consecutiveOffTopicTurns = countConsecutiveOffTopicTurns(chat.messages);

    // Resolve local image URLs to base64 for external AI providers
    const resolvedImageUrls = await resolveImageUrlsForAI(imageUrls);

    const promptData = await buildCoachPromptData(userId, {
      mode: 'chat',
      intent,
      consecutiveOffTopicTurns,
      message,
      threadKey: chatId,
      session: {
        title: chat.title,
        summary: chat.summary,
        messageCount: chat.messageCount + 1,
      },
      conversation,
      imageUrls: resolvedImageUrls.length > 0 ? resolvedImageUrls : undefined,
    });

    const result = enabled
      ? await generateAICoach(userId, promptData)
      : buildFallbackCoachResult(promptData);

    const assistantMessage = result.message?.trim() || 'I need a little more detail to help with that.';
    // Store the original URLs (not base64) in the DB
    const storedUserMessage = message || `[Shared ${imageUrls.length} image(s)]`;
    const updatedChat = await recordCoachTurn(
      userId,
      chatId,
      storedUserMessage,
      assistantMessage,
      imageUrls.length > 0 ? imageUrls : undefined,
    );

    res.json({ chat: updatedChat, result });
  } catch (error: any) {
    const status = error?.statusCode ?? error?.status ?? 500;
    const responseMessage = status === 404 ? 'Coach chat not found' : 'Failed to send coach message';
    console.error('[AI] Coach message error:', error.message);
    res.status(status).json({ error: responseMessage });
  }
}

// ─── postCoachConfirmEntity — create entity the coach gathered ────────────────
// The LLM returns an entityDraft; the frontend sends it here for validation
// and writes to the DB. Raw LLM output never touches the DB directly.

export async function postCoachConfirmEntity(req: Request, res: Response) {
  const userId = req.user!.sub;

  const entity = req.body?.entity;
  const draft = req.body?.draft;

  if (!entity || !draft || typeof draft !== 'object') {
    res.status(400).json({ error: 'entity and draft are required' });
    return;
  }

  const validEntities = ['task', 'habit', 'goal', 'project'] as const;
  if (!validEntities.includes(entity)) {
    res.status(400).json({ error: `entity must be one of: ${validEntities.join(', ')}` });
    return;
  }

  try {
    const result = await confirmCoachEntity(userId, { entity, draft } as any);
    res.status(201).json(result);
  } catch (error: any) {
    const status = error?.statusCode ?? error?.status ?? 500;
    const message =
      status === 400
        ? error?.message ?? 'Invalid entity draft'
        : 'Failed to create entity from coach';
    console.error('[AI] Coach confirm entity error:', error.message);
    res.status(status).json({ error: message });
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
      upcomingDeadline: nextDeadline ? `${nextDeadline.title} (${nextDeadline.dueDate?.toLocaleDateString()})` : null,
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
      res.json({
        mood: 'neutral',
        moodLabel: 'Reflective',
        themes: [],
        insight: '',
        reflectionPrompt: '',
        source: 'fallback',
      });
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
      res.json({
        overallMood: 'neutral',
        moodTrend: '',
        keyThemes: [],
        summary: '',
        insight: '',
        suggestion: '',
        source: 'fallback',
      });
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
      mood:
        (e.tags as string[])?.find((t) =>
          ['positive', 'neutral', 'negative', 'mixed'].includes(t),
        ) || undefined,
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
    const dayName =
      localDayParts.find((p) => p.type === 'weekday')?.value ?? dayNames[now.getUTCDay()];

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
