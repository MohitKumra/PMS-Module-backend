// backend/src/services/ai/coachChat.service.ts
// Chat persistence + prompt-data builder for the AI Coach.
// Context loading is tiered — data is only fetched when the intent requires it.

import { prisma } from '../../lib/prismaClient';
import { createError } from '../../middleware/errorHandler';
import { getSummary } from '../analytics.service';
import { calcStreak, getDayOfWeek, parseSkipDays, toDateStr } from '../habit.service';
import {
  classifyIntent,
  intentNeedsLiveData,
  intentSnapshotDomains,
  intentTargetEntity,
  ALL_SNAPSHOT_DOMAINS,
  CoachIntent,
  type CoachSnapshotDomain,
} from './coachIntent';
import { preprocessMessage } from './messagePreprocessor';
import { splitMultiIntent } from './multiIntent';
import { rankTasks, type RecommendableTask } from './context/contextRanker';
import { resolveEntity } from './entity/entityResolver';
import {
  getConversationState,
  saveConversationState,
  createEmptyState,
  recordPresented,
  setActiveEntity,
  type ConversationState,
  type StateEntityRef,
} from './memory/conversationState';
import type { EntityType, ResolvedEntityInfo } from './entity/entityTypes';
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
  CoachTaskSnapshot,
} from './prompts/coachPrompts';

const db = prisma as any;
const DEFAULT_CHAT_TITLE = 'New chat';
const CHAT_MEMORY_LIMIT = 320;
const CHAT_PREVIEW_LIMIT = 120;

// ─── Live-stats TTL cache ─────────────────────────────────────────────────────
// Avoids hammering analytics/focus on every message when the user reviews
// progress. Entries expire after LIVE_STATS_TTL_MS.

const LIVE_STATS_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface LiveStatsEntry {
  data: Awaited<ReturnType<typeof fetchLiveStats>>;
  expiresAt: number;
}

const liveStatsCache = new Map<string, LiveStatsEntry>();

function getLiveStatsFromCache(userId: string): LiveStatsEntry['data'] | null {
  const entry = liveStatsCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    liveStatsCache.delete(userId);
    return null;
  }
  return entry.data;
}

function setLiveStatsCache(userId: string, data: LiveStatsEntry['data']): void {
  liveStatsCache.set(userId, { data, expiresAt: Date.now() + LIVE_STATS_TTL_MS });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function getTimeOfDay(timezone: string): 'morning' | 'afternoon' | 'evening' | 'night' {
  const now = new Date();
  let hour = now.getHours();
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        hour12: false,
      }).format(now),
    );
  } catch {
    hour = now.getHours();
  }
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

// ─── Tier 1: Persistent context (always loaded, very cheap) ───────────────────

interface PersistentContext {
  timezone: string;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  recentActivity: string;
}

async function loadPersistentContext(userId: string): Promise<PersistentContext> {
  const user = await db.user
    .findUnique({ where: { id: userId }, select: { timezone: true } })
    .catch(() => null);
  const timezone = user?.timezone || 'UTC';

  const recentTask = await db.task
    .findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { title: true, status: true },
    })
    .catch(() => null);

  return {
    timezone,
    timeOfDay: getTimeOfDay(timezone),
    recentActivity: recentTask
      ? `Last task: "${recentTask.title}" (${recentTask.status})`
      : 'No recent activity',
  };
}

// ─── Tier 2: Live stats (only when intent needs progress data, TTL-cached) ────

interface LiveStats {
  completedToday: number;
  totalHabits: number;
  currentStreak: number;
  longestStreak: number;
  tasksCompleted: number;
  tasksOverdue: number;
  focusMinutesToday: number;
}

const EMPTY_LIVE_STATS: LiveStats = {
  completedToday: 0,
  totalHabits: 0,
  currentStreak: 0,
  longestStreak: 0,
  tasksCompleted: 0,
  tasksOverdue: 0,
  focusMinutesToday: 0,
};

async function fetchLiveStats(userId: string): Promise<LiveStats> {
  const today = utcToday();
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const summary = await getSummary(userId).catch(() => null);

  const focusSessionsToday = await db.focusSession
    .findMany({
      where: {
        userId,
        status: 'COMPLETED',
        OR: [
          { completedAt: { gte: today, lt: tomorrow } },
          { startedAt: { gte: today, lt: tomorrow } },
        ],
      },
      select: { elapsedMin: true, durationMin: true },
    })
    .catch(() => []);

  const focusTimeLogsToday = await db.focusTimeLog
    .aggregate({
      where: { userId, date: { gte: today, lt: tomorrow } },
      _sum: { durationMin: true },
    })
    .catch(() => ({ _sum: { durationMin: 0 } }));

  const focusMinutesToday =
    focusSessionsToday.reduce((total: number, s: any) => {
      const minutes = (s.elapsedMin && s.elapsedMin > 0 ? s.elapsedMin : s.durationMin) ?? 0;
      return total + minutes;
    }, 0) + (focusTimeLogsToday._sum.durationMin ?? 0);

  if (!summary) return { ...EMPTY_LIVE_STATS, focusMinutesToday };

  return {
    completedToday: summary.habitsCompletedToday ?? 0,
    totalHabits: summary.habitsTotal ?? 0,
    currentStreak: summary.currentHabitStreak ?? 0,
    longestStreak: summary.longestHabitStreak ?? 0,
    tasksCompleted: summary.tasksCompleted ?? 0,
    tasksOverdue: summary.overdueTasks ?? 0,
    focusMinutesToday,
  };
}

async function loadLiveStats(userId: string): Promise<LiveStats> {
  const cached = getLiveStatsFromCache(userId);
  if (cached) return cached;
  const fresh = await fetchLiveStats(userId).catch(() => EMPTY_LIVE_STATS);
  setLiveStatsCache(userId, fresh);
  return fresh;
}

// ─── Tier 3: Entity snapshot (only when intent targets a specific entity) ──────

interface EntitySnapshot {
  tasks: CoachTaskSnapshot[];
  goals: CoachGoalSnapshot[];
  habits: CoachHabitSnapshot[];
  milestones: CoachMilestoneSnapshot[];
}

const EMPTY_ENTITY_SNAPSHOT: EntitySnapshot = {
  tasks: [],
  goals: [],
  habits: [],
  milestones: [],
};

async function loadEntitySnapshot(
  userId: string,
  domains: CoachSnapshotDomain[],
): Promise<EntitySnapshot> {
  const today = utcToday();
  const todayStr = toDateStr(today);
  const weekStart = new Date(today);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);

  // Only load the data relevant to the requested domains — never the whole DB.
  const needsTasks = domains.includes('tasks');
  const needsGoals = domains.includes('goals');
  const needsHabits = domains.includes('habits');
  const needsMilestones = domains.includes('milestones');

  const [rawTasks, rawGoals, rawHabits, rawMilestones] = await Promise.all([
    needsTasks
      ? db.task
          .findMany({
            where: { userId, status: { in: ['TODO', 'IN_PROGRESS'] } },
            orderBy: [{ updatedAt: 'desc' }],
            take: 50,
            select: {
              id: true,
              title: true,
              priority: true,
              status: true,
              dueDate: true,
              goalId: true,
              estimatedDuration: true,
              updatedAt: true,
              _count: { select: { subTasks: true } },
            },
          })
          .catch(() => [])
      : Promise.resolve([]),

    needsGoals
      ? db.goal
          .findMany({
            where: { userId, OR: [{ status: 'ACTIVE' }, { status: 'PAUSED' }] },
            orderBy: [{ updatedAt: 'desc' }],
            take: 3,
            select: {
              id: true,
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
          })
          .catch(() => [])
      : Promise.resolve([]),

    needsHabits
      ? db.habit
          .findMany({
            where: { userId, isActive: true },
            orderBy: [{ createdAt: 'desc' }],
            take: 4,
            select: {
              id: true,
              title: true,
              targetPerWeek: true,
              skipDays: true,
              streakBrokenAt: true,
              goal: { select: { title: true } },
              completions: { select: { date: true } },
            },
          })
          .catch(() => [])
      : Promise.resolve([]),

    needsMilestones
      ? db.goalMilestone
          .findMany({
            where: { status: 'PENDING', goal: { is: { userId } } },
            orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
            take: 4,
            select: {
              id: true,
              title: true,
              dueDate: true,
              status: true,
              goal: { select: { title: true, progress: true } },
            },
          })
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const habitSnapshots: CoachHabitSnapshot[] = rawHabits.map((habit: any) => {
    const skipDays = parseSkipDays(habit.skipDays);
    const dateStrings = habit.completions.map((c: any) => toDateStr(c.date));
    const completionSet = new Set(dateStrings);
    const weekCount = dateStrings.filter(
      (d: string) => d >= toDateStr(weekStart) && d <= todayStr,
    ).length;
    return {
      id: habit.id,
      title: habit.title,
      goalTitle: habit.goal?.title ?? null,
      currentStreak: calcStreak(dateStrings, skipDays),
      targetPerWeek: habit.targetPerWeek,
      completionsThisWeek: weekCount,
      completedToday: completionSet.has(todayStr) || skipDays.includes(getDayOfWeek(todayStr)),
    };
  });

  const goalSnapshots: CoachGoalSnapshot[] = rawGoals.map((goal: any) => ({
    id: goal.id,
    title: goal.title,
    progress: goal.progress,
    status: goal.status as CoachGoalSnapshot['status'],
    targetDate: goal.targetDate?.toISOString() ?? null,
    nextMilestoneTitle: goal.milestones[0]?.title ?? null,
    nextMilestoneDueDate: goal.milestones[0]?.dueDate?.toISOString() ?? null,
  }));

  const milestoneSnapshots: CoachMilestoneSnapshot[] = rawMilestones.map((m: any) => ({
    id: m.id,
    goalTitle: m.goal.title,
    goalProgress: m.goal.progress,
    title: m.title,
    dueDate: m.dueDate?.toISOString() ?? null,
    status: m.status,
  }));

  // Open tasks — retain the full candidate set so the deterministic ranker can
  // use ALL relevant tasks (spec §26), not just the top few by priority.
  const taskSnapshots: CoachTaskSnapshot[] = rawTasks.map((task: any) => {
    const due = task.dueDate ? new Date(task.dueDate) : null;
    return {
      id: task.id,
      title: task.title,
      priority: task.priority as CoachTaskSnapshot['priority'],
      status: task.status as CoachTaskSnapshot['status'],
      dueDate: due ? due.toISOString() : null,
      overdue: Boolean(
        due &&
          due.getTime() < today.getTime() &&
          task.status !== 'DONE' &&
          task.status !== 'CANCELLED',
      ),
      subtasksOpen: task._count?.subTasks ?? 0,
      goalId: task.goalId ?? null,
      estimatedDuration: task.estimatedDuration ?? null,
      updatedAt: task.updatedAt?.toISOString() ?? null,
    };
  });

  return {
    tasks: taskSnapshots,
    goals: goalSnapshots,
    habits: habitSnapshots,
    milestones: milestoneSnapshots,
  };
}

// ─── Chat title / memory helpers ──────────────────────────────────────────────

export function deriveCoachChatTitle(source: string): string {
  const words = collapseWhitespace(source)
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return DEFAULT_CHAT_TITLE;

  const stopWords = new Set([
    'i', 'me', 'my', 'mine', 'please', 'help', 'need', 'want',
    'to', 'for', 'the', 'a', 'an', 'with', 'and', 'build', 'make',
  ]);

  let startIndex = 0;
  while (startIndex < words.length && stopWords.has(words[startIndex].toLowerCase())) {
    startIndex += 1;
  }

  const titleWords = (startIndex < words.length ? words.slice(startIndex) : words).slice(0, 5);
  const title = titleWords.map(capitalize).join(' ').trim();
  return clip(title, 48) || DEFAULT_CHAT_TITLE;
}

export function buildCoachMemory(
  currentSummary: string,
  userMessage: string,
  assistantMessage: string,
): string {
  const fragments = [
    currentSummary,
    `User: ${clip(userMessage, 90)}`,
    `Coach: ${clip(assistantMessage, 90)}`,
  ].filter(Boolean);
  return trimTail(fragments.join(' | '), CHAT_MEMORY_LIMIT);
}

// ─── Message mapper ───────────────────────────────────────────────────────────

function mapMessage(message: {
  id: string;
  chatId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  imageUrls?: string | null;
  createdAt: Date;
}): CoachChatMessageDTO {
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
  lastMessage?: { content: string; role: 'USER' | 'ASSISTANT'; createdAt: Date } | null,
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
  return { ...listItem, messages: chat.messages.map(mapMessage) };
}

// ─── Intent-aware prompt data builder ────────────────────────────────────────

/** Intents that should produce deterministic recommendation candidates. */
const RECOMMENDATION_INTENTS = new Set<CoachIntent>([
  CoachIntent.TASK_RECOMMEND,
  CoachIntent.TASK_PRIORITIZE,
  CoachIntent.TASK_NEXT,
  CoachIntent.GOAL_RECOMMEND,
  CoachIntent.HABIT_RECOMMEND,
]);

/** Build the resolver candidate list for a target entity type. */
function entityCandidatesFor(
  type: EntityType,
  snapshot: EntitySnapshot,
): { id: string; title: string }[] {
  switch (type) {
    case 'task':
      return snapshot.tasks.map((t) => ({ id: t.id, title: t.title }));
    case 'goal':
      return snapshot.goals.map((g) => ({ id: g.id, title: g.title }));
    case 'habit':
      return snapshot.habits.map((h) => ({ id: h.id, title: h.title }));
    case 'project':
      return [];
  }
}

export async function buildCoachPromptData(
  userId: string,
  options: {
    session?: CoachSessionSnapshot;
    conversation?: CoachConversationTurn[];
    mode?: 'summary' | 'chat';
    imageUrls?: string[];
    /** Pre-classified intent — caller should pass this in chat mode */
    intent?: CoachIntent;
    /** Consecutive off-topic turns in this session */
    consecutiveOffTopicTurns?: number;
    /** Raw current user message — used for preprocessing / entity resolution */
    message?: string;
    /** Thread (chat) id — key for the structured conversation state store */
    threadKey?: string;
  } = {},
): Promise<CoachPromptData> {
  const mode = options.mode ?? (options.conversation?.length ? 'chat' : 'summary');
  const isChatMode = mode === 'chat';

  // ── Persistent context — always cheap ────────────────────────────────────
  const persistent = await loadPersistentContext(userId);

  // ── Phase 1: message preprocessing + multi-intent (spec §5, §6) ───────────
  // Preprocess the raw message for normalization/typo+date/reference signals.
  let normalizedMessage: string | undefined;
  let resolveRef: string | undefined;
  if (isChatMode && options.message) {
    const processed = preprocessMessage(options.message, persistent.timezone);
    normalizedMessage = processed.normalizedMessage;
    const multi = splitMultiIntent(processed.normalizedMessage);
    resolveRef = multi.operations[0]?.entityReference;
  }

  // ── Determine intent ──────────────────────────────────────────────────────
  // Summary mode (dashboard widget) always loads full context.
  // Chat mode only loads what the intent needs.
  let intent = options.intent;
  if (!intent) {
    if (isChatMode && normalizedMessage) {
      intent = classifyIntent(normalizedMessage);
    } else if (isChatMode && options.conversation && options.conversation.length > 0) {
      const lastUser = [...options.conversation].reverse().find((t) => t.role === 'user');
      const prevUser = [...options.conversation]
        .reverse()
        .filter((t) => t.role === 'user')
        .slice(1, 2)[0];
      intent = classifyIntent(lastUser?.content ?? '', prevUser?.content);
    } else {
      // Summary widget — treat as progress review so we load full stats
      intent = CoachIntent.PROGRESS_REVIEW;
    }
  }

  // ── Live stats — only when intent needs them ──────────────────────────────
  const needsLive = !isChatMode || intentNeedsLiveData(intent);
  const liveStats = needsLive ? await loadLiveStats(userId) : EMPTY_LIVE_STATS;

  // ── Entity snapshot — only the domains the current intent actually needs ──
  // Chat mode sends ONLY what the user asked about (e.g. tasks for
  // TASK_STATUS). Summary mode (PROGRESS_REVIEW) loads everything.
  const snapshotDomains = isChatMode ? intentSnapshotDomains(intent) : ALL_SNAPSHOT_DOMAINS;

  const entitySnapshot =
    snapshotDomains.length > 0
      ? await loadEntitySnapshot(userId, snapshotDomains)
      : EMPTY_ENTITY_SNAPSHOT;

  // ── Phase 3: structured conversation state (spec §14) ─────────────────────
  const state: ConversationState = options.threadKey
    ? getConversationState(options.threadKey)
    : createEmptyState();
  state.lastIntent = intent;

  // ── Phase 1: deterministic task recommendation ranking (spec §27) ─────────
  const isRecommendation = RECOMMENDATION_INTENTS.has(intent);
  let recommendationCandidates: CoachPromptData['recommendationCandidates'];
  if (isChatMode && isRecommendation) {
    const activeGoalId =
      entitySnapshot.goals.find((g) => g.status === 'ACTIVE')?.id ?? null;
    const rankable: RecommendableTask[] = entitySnapshot.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate,
      estimatedDuration: t.estimatedDuration,
      goalId: t.goalId,
      updatedAt: t.updatedAt,
    }));
    recommendationCandidates = rankTasks(rankable, {
      activeGoalId,
      excludedEntityIds: state.excludedEntities.map((e) => e.id),
    });
  }

  // ── Phase 2: entity resolution from the message reference (spec §8) ───────
  let resolvedEntity: ResolvedEntityInfo | null = null;
  if (isChatMode) {
    const target = intentTargetEntity(intent);
    if (target && resolveRef) {
      const candidates = entityCandidatesFor(target, entitySnapshot);
      const result = resolveEntity({
        reference: resolveRef,
        candidates,
        entityType: target,
        conversationState: state,
      });
      if (result.entityId) {
        const title = candidates.find((c) => c.id === result.entityId)?.title;
        resolvedEntity = {
          id: result.entityId,
          type: target,
          title,
          confidence: result.confidence,
          method: result.method,
        };
        setActiveEntity(state, { type: target, id: result.entityId, title });
      }
      // Ambiguous (result.matches) is not surfaced here — the model or a later
      // semantic resolver asks a concise clarification instead.
    }
  }

  // Track last-presented entities for first/second/last + pronoun references.
  const presentedRefs: StateEntityRef[] = (
    recommendationCandidates ?? entitySnapshot.tasks
  )
    .slice(0, 5)
    .map((t) => ({ type: 'task' as const, id: t.id, title: t.title }));
  recordPresented(state, presentedRefs);

  if (options.threadKey) saveConversationState(options.threadKey, state);

  return {
    mode,
    intent,
    needsLiveData: needsLive,
    consecutiveOffTopicTurns: options.consecutiveOffTopicTurns ?? 0,

    // Live stats
    completedToday: liveStats.completedToday,
    totalHabits: liveStats.totalHabits,
    currentStreak: liveStats.currentStreak,
    longestStreak: liveStats.longestStreak,
    tasksCompleted: liveStats.tasksCompleted,
    tasksOverdue: liveStats.tasksOverdue,
    focusMinutesToday: liveStats.focusMinutesToday,

    // Entity snapshots
    tasks: entitySnapshot.tasks,
    goals: entitySnapshot.goals,
    habits: entitySnapshot.habits,
    milestones: entitySnapshot.milestones,

    // Persistent
    timeOfDay: persistent.timeOfDay,
    recentActivity: persistent.recentActivity,

    // Session / conversation
    session: {
      title: clip(options.session?.title ?? DEFAULT_CHAT_TITLE, 48) || DEFAULT_CHAT_TITLE,
      summary: clip(options.session?.summary ?? '', CHAT_MEMORY_LIMIT),
      messageCount:
        options.session?.messageCount ?? options.conversation?.length ?? 0,
    },
    conversation: options.conversation,
    imageUrls: options.imageUrls,

    // Context intelligence (Phase 1–3)
    normalizedMessage,
    needsRecommendation:
      isChatMode && isRecommendation && (recommendationCandidates?.length ?? 0) > 0,
    recommendationCandidates,
    resolvedEntity,
  };
}

// ─── Chat CRUD ────────────────────────────────────────────────────────────────

export async function listCoachChats(
  userId: string,
): Promise<{ data: CoachChatListDTO[]; meta: { total: number } }> {
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
        select: {
          id: true,
          chatId: true,
          role: true,
          content: true,
          imageUrls: true,
          createdAt: true,
        },
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

  const nextTitle =
    existing.title === DEFAULT_CHAT_TITLE ? deriveCoachChatTitle(userMessage) : existing.title;
  const nextSummary = buildCoachMemory(existing.summary, userMessage, assistantMessage);

  await db.$transaction([
    db.aICoachMessage.create({
      data: {
        chatId,
        role: 'USER',
        content: userMessage,
        imageUrls: imageUrls && imageUrls.length > 0 ? JSON.stringify(imageUrls) : null,
      },
    }),
    db.aICoachMessage.create({
      data: { chatId, role: 'ASSISTANT', content: assistantMessage },
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
