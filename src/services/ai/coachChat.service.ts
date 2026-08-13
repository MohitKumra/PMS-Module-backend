import { prisma } from '../../lib/prismaClient';
import { createError } from '../../middleware/errorHandler';
import { getSummary } from '../analytics.service';
import { calcStreak, getDayOfWeek, parseSkipDays, toDateStr } from '../habit.service';
import type {
  CoachChatDTO,
  CoachChatListDTO,
  CoachChatMessageDTO,
  CoachSessionSnapshot,
} from '../../types';
import type {
  CoachConversationTurn,
  CoachGoalSnapshot,
  CoachHabitSnapshot,
  CoachMilestoneSnapshot,
  CoachPromptData,
} from './prompts/coachPrompts';

const db = prisma as any;
const DEFAULT_CHAT_TITLE = 'New chat';
const CHAT_MEMORY_LIMIT = 320;
const CHAT_PREVIEW_LIMIT = 120;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clip(value: string, maxLength: number): string {
  const normalized = collapseWhitespace(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function trimTail(value: string, maxLength: number): string {
  const normalized = collapseWhitespace(value);
  if (normalized.length <= maxLength) return normalized;
  return `…${normalized.slice(normalized.length - Math.max(0, maxLength - 1))}`;
}

function capitalize(word: string): string {
  if (word.length === 0) return word;
  return `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`;
}

export function deriveCoachChatTitle(source: string): string {
  const words = collapseWhitespace(source)
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return DEFAULT_CHAT_TITLE;

  const stopWords = new Set([
    'i',
    'me',
    'my',
    'mine',
    'please',
    'help',
    'need',
    'want',
    'to',
    'for',
    'the',
    'a',
    'an',
    'with',
    'and',
    'build',
    'make',
  ]);

  let startIndex = 0;
  while (startIndex < words.length && stopWords.has(words[startIndex].toLowerCase())) {
    startIndex += 1;
  }

  const titleWords = (startIndex < words.length ? words.slice(startIndex) : words).slice(0, 5);
  const title = titleWords.map(capitalize).join(' ').trim();
  return clip(title, 48) || DEFAULT_CHAT_TITLE;
}

export function buildCoachMemory(currentSummary: string, userMessage: string, assistantMessage: string): string {
  const fragments = [
    currentSummary,
    `User: ${clip(userMessage, 90)}`,
    `Coach: ${clip(assistantMessage, 90)}`,
  ].filter(Boolean);

  return trimTail(fragments.join(' | '), CHAT_MEMORY_LIMIT);
}

function mapMessage(message: {
  id: string;
  chatId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  imageUrls?: string | null;
  createdAt: Date;
}): CoachChatMessageDTO {
  // imageUrls is stored as a JSON string in the DB; parse it back to string[]
  let parsedImageUrls: string[] | undefined;
  if (message.imageUrls) {
    try {
      const parsed = JSON.parse(message.imageUrls) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        parsedImageUrls = (parsed as unknown[]).filter((u): u is string => typeof u === 'string');
      }
    } catch {
      // malformed — ignore
    }
  }

  return {
    id: message.id,
    chatId: message.chatId,
    role: message.role === 'ASSISTANT' ? 'assistant' : 'user',
    content: message.content,
    ...(parsedImageUrls !== undefined && { imageUrls: parsedImageUrls }),
    createdAt: message.createdAt.toISOString(),
  } as CoachChatMessageDTO;
}

function mapChatListItem(
  chat: {
    id: string;
    title: string;
    summary: string;
    messageCount: number;
    lastMessageAt: Date;
    createdAt: Date;
    updatedAt: Date;
  },
  lastMessage?: { content: string; role: 'USER' | 'ASSISTANT'; createdAt: Date } | null
): CoachChatListDTO {
  const previewSource = chat.summary || lastMessage?.content || DEFAULT_CHAT_TITLE;

  return {
    id: chat.id,
    title: clip(chat.title, 60) || DEFAULT_CHAT_TITLE,
    summary: trimTail(chat.summary || '', CHAT_MEMORY_LIMIT),
    messageCount: chat.messageCount,
    preview: clip(previewSource, CHAT_PREVIEW_LIMIT),
    lastMessageAt: chat.lastMessageAt.toISOString(),
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
  };
}

function mapChat(chat: {
  id: string;
  title: string;
  summary: string;
  messageCount: number;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
  messages: {
    id: string;
    chatId: string;
    role: 'USER' | 'ASSISTANT';
    content: string;
    imageUrls?: string | null;
    createdAt: Date;
  }[];
}): CoachChatDTO {
  const listItem = mapChatListItem(chat, chat.messages.at(-1) ?? null);
  return {
    ...listItem,
    messages: chat.messages.map(mapMessage),
  };
}

async function safeGetCoachSummary(userId: string) {
  try {
    const summary = await getSummary(userId);
    return {
      completedToday: summary.habitsCompletedToday ?? 0,
      totalHabits: summary.habitsTotal ?? 0,
      currentStreak: summary.currentHabitStreak ?? 0,
      longestStreak: summary.longestHabitStreak ?? 0,
      tasksCompleted: summary.tasksCompleted ?? 0,
      tasksOverdue: summary.overdueTasks ?? 0,
      focusMinutesTotal: summary.focusMinutesTotal ?? 0,
    };
  } catch (error: any) {
    console.warn('[AI] Coach summary unavailable:', error?.message ?? error);
    return {
      completedToday: 0,
      totalHabits: 0,
      currentStreak: 0,
      longestStreak: 0,
      tasksCompleted: 0,
      tasksOverdue: 0,
      focusMinutesTotal: 0,
    };
  }
}

function getTimeOfDay(timezone: string): 'morning' | 'afternoon' | 'evening' | 'night' {
  const now = new Date();
  let hour = now.getHours();

  try {
    hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }).format(now));
  } catch {
    hour = now.getHours();
  }

  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function loadCoachContext(userId: string): Promise<
  Omit<CoachPromptData, 'session' | 'conversation' | 'mode'>
> {
  const summary = await safeGetCoachSummary(userId);

  const user = await db.user
    .findUnique({
      where: { id: userId },
      select: { timezone: true },
    })
    .catch((error: any) => {
      console.warn('[AI] Coach timezone unavailable:', error?.message ?? error);
      return null;
    });

  const timezone = user?.timezone || 'UTC';
  const today = utcToday();
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const recentTask = await db.task
    .findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { title: true, status: true },
    })
    .catch((error: any) => {
      console.warn('[AI] Coach recent task unavailable:', error?.message ?? error);
      return null;
    });

  const focusSessionsToday = await db.focusSession
    .findMany({
      where: {
        userId,
        status: 'COMPLETED',
        OR: [{ completedAt: { gte: today, lt: tomorrow } }, { startedAt: { gte: today, lt: tomorrow } }],
      },
      select: { elapsedMin: true, durationMin: true },
    })
    .catch((error: any) => {
      console.warn('[AI] Coach focus sessions unavailable:', error?.message ?? error);
      return [];
    });

  const focusTimeLogsToday = await db.focusTimeLog
    .aggregate({
      where: { userId, date: { gte: today, lt: tomorrow } },
      _sum: { durationMin: true },
    })
    .catch((error: any) => {
      console.warn('[AI] Coach focus time logs unavailable:', error?.message ?? error);
      return { _sum: { durationMin: 0 } };
    });

  const focusMinutesToday =
    focusSessionsToday.reduce((total: number, session: any) => {
      const minutes = (session.elapsedMin && session.elapsedMin > 0 ? session.elapsedMin : session.durationMin) ?? 0;
      return total + minutes;
    }, 0) + (focusTimeLogsToday._sum.durationMin ?? 0);

  const recentActivity = recentTask
    ? `Last task: "${recentTask.title}" (${recentTask.status})`
    : 'No recent activity';

  const [goals, habits, milestones] = await Promise.all([
    db.goal.findMany({
      where: { userId, OR: [{ status: 'ACTIVE' }, { status: 'PAUSED' }] },
      orderBy: [{ updatedAt: 'desc' }],
      take: 3,
      select: {
        title: true,
        progress: true,
        status: true,
        targetDate: true,
        milestones: {
          where: { status: 'PENDING' },
          orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
          take: 1,
          select: { title: true, dueDate: true, status: true },
        },
      },
    }),
    db.habit.findMany({
      where: { userId, isActive: true },
      orderBy: [{ createdAt: 'desc' }],
      take: 4,
      select: {
        title: true,
        targetPerWeek: true,
        skipDays: true,
        streakBrokenAt: true,
        goal: { select: { title: true } },
        completions: { select: { date: true } },
      },
    }),
    db.goalMilestone.findMany({
      where: { status: 'PENDING', goal: { is: { userId } } },
      orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 4,
      select: {
        title: true,
        dueDate: true,
        status: true,
        goal: { select: { title: true, progress: true } },
      },
    }),
  ]);

  const todayStr = toDateStr(today);
  const weekStart = new Date(today);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);

  const habitSnapshots: CoachHabitSnapshot[] = habits.map((habit: any) => {
    const skipDays = parseSkipDays(habit.skipDays);
    const dateStrings = habit.completions.map((completion: any) => toDateStr(completion.date));
    const completionSet = new Set(dateStrings);
    const weekCount = dateStrings.filter((dateStr: string) => dateStr >= toDateStr(weekStart) && dateStr <= todayStr).length;
    const todayIsSafeDay = skipDays.includes(getDayOfWeek(todayStr));

    return {
      title: habit.title,
      goalTitle: habit.goal?.title ?? null,
      currentStreak: calcStreak(dateStrings, skipDays),
      targetPerWeek: habit.targetPerWeek,
      completionsThisWeek: weekCount,
      completedToday: completionSet.has(todayStr) || todayIsSafeDay,
    };
  });

  const goalSnapshots: CoachGoalSnapshot[] = goals.map((goal: any) => ({
    title: goal.title,
    progress: goal.progress,
    status: goal.status as CoachGoalSnapshot['status'],
    targetDate: goal.targetDate?.toISOString() ?? null,
    nextMilestoneTitle: goal.milestones[0]?.title ?? null,
    nextMilestoneDueDate: goal.milestones[0]?.dueDate?.toISOString() ?? null,
  }));

  const milestoneSnapshots: CoachMilestoneSnapshot[] = milestones.map((milestone: any) => ({
    goalTitle: milestone.goal.title,
    goalProgress: milestone.goal.progress,
    title: milestone.title,
    dueDate: milestone.dueDate?.toISOString() ?? null,
    status: milestone.status,
  }));

  return {
    completedToday: summary.completedToday,
    totalHabits: summary.totalHabits,
    currentStreak: summary.currentStreak,
    longestStreak: summary.longestStreak,
    tasksCompleted: summary.tasksCompleted,
    tasksOverdue: summary.tasksOverdue,
    focusMinutesToday,
    timeOfDay: getTimeOfDay(timezone),
    recentActivity,
    goals: goalSnapshots,
    habits: habitSnapshots,
    milestones: milestoneSnapshots,
  };
}

export async function buildCoachPromptData(
  userId: string,
  options: {
    session?: CoachSessionSnapshot;
    conversation?: CoachConversationTurn[];
    mode?: 'summary' | 'chat';
    imageUrls?: string[];
  } = {}
): Promise<CoachPromptData> {
  const base = await loadCoachContext(userId);
  return {
    mode: options.mode ?? (options.conversation?.length ? 'chat' : 'summary'),
    ...base,
    session: {
      title: clip(options.session?.title ?? DEFAULT_CHAT_TITLE, 48) || DEFAULT_CHAT_TITLE,
      summary: clip(options.session?.summary ?? '', CHAT_MEMORY_LIMIT),
      messageCount: options.session?.messageCount ?? options.conversation?.length ?? 0,
    },
    conversation: options.conversation,
    imageUrls: options.imageUrls,
  };
}

export async function listCoachChats(userId: string): Promise<{ data: CoachChatListDTO[]; meta: { total: number } }> {
  const chats = await db.aICoachChat.findMany({
    where: { userId, messageCount: { gt: 0 } },
    orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      summary: true,
      messageCount: true,
      lastMessageAt: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { content: true, role: true, createdAt: true },
      },
    },
  });

  return {
    data: chats.map((chat: any) => mapChatListItem(chat, chat.messages[0] ?? null)),
    meta: { total: chats.length },
  };
}

export async function createCoachChat(userId: string, title?: string): Promise<CoachChatDTO> {
  const chat = await db.aICoachChat.create({
    data: {
      userId,
      title: clip(title ?? '', 80) || DEFAULT_CHAT_TITLE,
      summary: '',
      messageCount: 0,
      lastMessageAt: new Date(),
    },
  });

  return getCoachChat(userId, chat.id);
}

export async function getCoachChat(userId: string, chatId: string): Promise<CoachChatDTO> {
  const chat = await db.aICoachChat.findFirst({
    where: { id: chatId, userId },
    select: {
      id: true,
      title: true,
      summary: true,
      messageCount: true,
      lastMessageAt: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, chatId: true, role: true, content: true, imageUrls: true, createdAt: true },
      },
    },
  });

  if (!chat) throw createError(404, 'COACH_CHAT_NOT_FOUND', 'Coach chat not found');
  return mapChat(chat);
}

export async function recordCoachTurn(
  userId: string,
  chatId: string,
  userMessage: string,
  assistantMessage: string,
  imageUrls?: string[],
): Promise<CoachChatDTO> {
  const existing = await db.aICoachChat.findFirst({
    where: { id: chatId, userId },
    select: { id: true, title: true, summary: true },
  });

  if (!existing) throw createError(404, 'COACH_CHAT_NOT_FOUND', 'Coach chat not found');

  const nextTitle = existing.title === DEFAULT_CHAT_TITLE ? deriveCoachChatTitle(userMessage) : existing.title;
  const nextSummary = buildCoachMemory(existing.summary, userMessage, assistantMessage);

  await db.$transaction([
    db.aICoachMessage.create({
      data: {
        chatId,
        role: 'USER',
        content: userMessage,
        // Serialise image URLs as JSON; null when none present
        imageUrls:
          imageUrls && imageUrls.length > 0 ? JSON.stringify(imageUrls) : null,
      },
    }),
    db.aICoachMessage.create({
      data: {
        chatId,
        role: 'ASSISTANT',
        content: assistantMessage,
      },
    }),
    db.aICoachChat.update({
      where: { id: chatId },
      data: {
        title: nextTitle,
        summary: nextSummary,
        messageCount: { increment: 2 },
        lastMessageAt: new Date(),
      },
    }),
  ]);

  return getCoachChat(userId, chatId);
}

export async function deleteCoachChat(userId: string, chatId: string): Promise<void> {
  const existing = await db.aICoachChat.findFirst({
    where: { id: chatId, userId },
    select: { id: true },
  });

  if (!existing) throw createError(404, 'COACH_CHAT_NOT_FOUND', 'Coach chat not found');

  await db.$transaction([
    db.aICoachMessage.deleteMany({ where: { chatId } }),
    db.aICoachChat.delete({ where: { id: chatId } }),
  ]);
}
