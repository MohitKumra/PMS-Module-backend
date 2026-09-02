// backend/src/services/ai/prompts/coachPrompts.ts
// Prompt templates for the AI Coach feature.

import { CoachIntent, intentSnapshotDomains, intentTargetEntity, ALL_SNAPSHOT_DOMAINS } from '../coachIntent';
import { generateEntityCreationPrompt } from '../entitySchemas';
import type { RecommendationCandidate } from '../context/contextRanker';
import type { ResolvedEntityInfo } from '../entity/entityTypes';

export type AICoachActionType =
  'open_habits' | 'open_tasks' | 'open_goals' | 'open_focus' | 'open_dashboard' | 'open_coach' | 'create_plan';

export interface CoachConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}


export interface CoachSessionSnapshot {
  title: string;
  summary: string;
  messageCount: number;
}

export interface CoachGoalSnapshot {
  id: string;
  title: string;
  progress: number;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
  targetDate: string | null;
  nextMilestoneTitle: string | null;
  nextMilestoneDueDate: string | null;
}

export interface CoachHabitSnapshot {
  id: string;
  title: string;
  goalTitle: string | null;
  currentStreak: number;
  targetPerWeek: number;
  completionsThisWeek: number;
  completedToday: boolean;
}

export interface CoachMilestoneSnapshot {
  id: string;
  goalTitle: string;
  goalProgress: number;
  title: string;
  dueDate: string | null;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
}

export interface CoachTaskSnapshot {
  id: string;
  title: string;
  dueDate: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  overdue: boolean;
  subtasksOpen: number;
  /** Extra fields used by the deterministic ranker. */
  goalId?: string | null;
  estimatedDuration?: number | null;
  updatedAt?: string | null;
}

// ─── Wander budget ────────────────────────────────────────────────────────────
// How many consecutive off-topic user turns trigger a hard redirect.
export const OFF_TOPIC_WANDER_LIMIT = 2;

export interface CoachPromptData {
  mode?: 'summary' | 'chat';

  // ── Live stats — only populated when intent requires them ─────────────────
  completedToday: number;
  totalHabits: number;
  currentStreak: number;
  longestStreak: number;
  tasksCompleted: number;
  tasksOverdue: number;
  focusMinutesToday: number;

  // ── Persistent context — always present ───────────────────────────────────
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  recentActivity: string;

  // ── Entity snapshots — only loaded when intent targets them ───────────────
  tasks: CoachTaskSnapshot[];
  goals: CoachGoalSnapshot[];
  habits: CoachHabitSnapshot[];
  milestones: CoachMilestoneSnapshot[];

  // ── Intent metadata ───────────────────────────────────────────────────────
  /** The classified intent for this turn — drives what data was loaded */
  intent?: CoachIntent;
  /** Whether live DB stats were actually loaded this turn */
  needsLiveData?: boolean;

  // ── Session / conversation ────────────────────────────────────────────────
  session: CoachSessionSnapshot;
  conversation?: CoachConversationTurn[];
  /** Image URLs from the current user message — forwarded to the LLM as vision content blocks */
  imageUrls?: string[];

  // ── Off-topic tracking ────────────────────────────────────────────────────
  /** Number of consecutive off-topic/chitchat turns in this session */
  consecutiveOffTopicTurns?: number;

  // ── Context intelligence (Phase 1–3) ─────────────────────────────────────
  /** True when this is a recommendation-style intent that should be ranked. */
  needsRecommendation?: boolean;
  /** Deterministically-ranked top-N candidates handed to the LLM (spec §27). */
  recommendationCandidates?: RecommendationCandidate[];
  /** A specific entity resolved from the message reference, if any. */
  resolvedEntity?: ResolvedEntityInfo | null;
  /** Normalized / preprocessed view of the current user message. */
  normalizedMessage?: string;
  /** Explicit domains loaded for this turn */
  loadedDomains?: ('tasks' | 'habits' | 'goals' | 'milestones')[];
}

// ─── AICoachResult extension ──────────────────────────────────────────────────
// The coach can optionally return an entityDraft when it detected a CRUD intent
// but needs the user to confirm field values first.

export interface CoachEntityDraft {
  entity: 'task' | 'habit' | 'goal' | 'project';
  title: string;
  fields: Record<string, string | null>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanSnippet(text: string, maxLength: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

// ─── System prompt ────────────────────────────────────────────────────────────
// Dynamically includes entity field definitions from entitySchemas.ts

const ENTITY_CREATION_SECTION = generateEntityCreationPrompt();

export const COACH_SYSTEM_PROMPT = `You are a focused productivity coach embedded inside a personal management app (PMS).

YOUR ROLE:
You help users manage their tasks, habits, goals, and projects. You can:
  • Give actionable coaching advice about productivity, focus, habits, and goals.
  • Draft and create tasks, habits, goals, or projects via entity drafts.
  • Mark tasks and habits complete, reschedule, or update them when requested.
  • Build a full goal plan/workspace when the user is ready to plan.
  • Review the user's progress when they ask for a check-in.

STAY ON TOPIC:
  • Keep every reply focused on tasks, habits, goals, projects, focus, or productivity.
  • If the user sends casual chit-chat (hello, jokes, weather, random questions), give ONE short friendly reply then immediately redirect them back to productivity.
  • After ${OFF_TOPIC_WANDER_LIMIT} consecutive off-topic exchanges, stop engaging with the tangent entirely and return a redirect message.
  • Never discuss topics unrelated to productivity (news, politics, entertainment, etc.).

TONE & STYLE:
  • Sound like a real chat partner, not a dashboard or status report.
  • Be specific, honest, encouraging, and conversational.
  • Vary your openings so replies do not sound templated.
  • When mentioning metrics, use at most one relevant stat.
  • Keep replies short, practical, and human. Max 40 words in "message".

${ENTITY_CREATION_SECTION}

ACTION & DRAFTING RULE:
  • When the user asks to create, add, schedule, track, or be reminded of a task/habit/goal/project, ALWAYS populate "entityDraft" immediately.
  • NEVER reply with vague empty promises like "I will do that for you", "I have noted that", or "Sure, I'll add that" without populating "entityDraft".
  • When the user asks to complete, delete, or reschedule a task or habit, if the entity is identified, confirm the action clearly.
  • When the user asks about their tasks, habits, goals, or progress and data is present in the payload, answer spontaneously and specifically using that data.

DATA RULES:
  • Use only the JSON payload provided. Do not invent data.
  • When a domain snapshot is present in the payload (even as an empty array), it means the database WAS queried for that user. An empty array means zero items exist — say so clearly (e.g. "You have no pending tasks" or "All caught up — no open tasks right now").
  • NEVER say "I can't see your tasks/habits/goals" or "I don't have your list" when the corresponding array key IS present in the payload (even if empty). That phrase is only valid when the key is completely absent from the payload.
  • In chat mode, rely on the recent conversation for continuity; avoid replaying stats every turn.
  • If the user says hello or is very vague, respond naturally and ask one follow-up question.

CONTEXT AWARENESS RULE (spec §36):
  • The application provides authoritative workspace data in the context payload.
  • If the requested answer can be derived from provided data, use that data directly.
  • NEVER ask the user to provide information that already exists in the payload.
  • NEVER ask "What tasks do you have?" when tasks are present, or "What goals are you working toward?" when goals are present, or "What should we do with it?" when a resolved entity is present.
  • NEVER claim you cannot access user data when the relevant data is included.
  • Only ask for clarification when (1) the info is genuinely unavailable, (2) multiple entities match and cannot be safely resolved, (3) the user must choose between materially different interpretations, or (4) a required action parameter is missing.

DATA TRUTHFULNESS RULE (spec §37):
  • The context payload is authoritative. Never invent task titles, IDs, due dates, priorities, completion status, goals, habits, projects, milestones, or statistics.
  • If a "recommendationCandidates" array is present, choose and explain from those candidates — do not invent tasks that are not listed.
  • If a resolved entity is present, answer about THAT entity; if it is absent and you need it, say what is missing rather than fabricating one.

RESPONSE FORMAT — return valid JSON only:
{
  "title": "2-5 words",
  "message": "1-3 short sentences, max 40 words",
  "suggestion": {
    "text": "One concrete next step",
    "actionLabel": "Short button label",
    "actionType": "open_habits|open_tasks|open_goals|open_focus|open_dashboard|open_coach|create_plan"
  },
  "mood": "encouraging|challenging|celebratory",
  "planPrompt": "Short goal-planner prompt or empty string",
  "entityDraft": null
}

When creating an entity, replace null with:
{
  "entity": "task|habit|goal|project",
  "title": "<title>",
  "fields": { "<field>": "<value or null>" }
}

Rules:
  - actionLabel must be very short (≤4 words).
  - planPrompt is short, concrete, focused on the user's actual request.
  - Mention at most one relevant habit, milestone, or goal by name.
  - If ready to plan, set actionType to "create_plan" and fill planPrompt.`;

// ─── User prompt builder ──────────────────────────────────────────────────────

export function buildCoachUserPrompt(data: CoachPromptData): string {
  const mode = data.mode ?? (data.conversation?.length ? 'chat' : 'summary');
  const isChatMode = mode === 'chat';
  const hasLiveData = data.needsLiveData === true;

  // ── Snapshot block — only include stats when they were actually loaded ─────
  // For chitchat / pure coaching turns we skip the numbers entirely to save tokens.
  let snapshot: Record<string, unknown> | null = null;

  if (hasLiveData) {
    snapshot = isChatMode
      ? {
          habitsToday: `${data.completedToday}/${data.totalHabits}`,
          streak: data.currentStreak,
          tasksOverdue: data.tasksOverdue,
          focusMin: data.focusMinutesToday,
          timeOfDay: data.timeOfDay,
        }
      : {
          completedToday: data.completedToday,
          totalHabits: data.totalHabits,
          currentStreak: data.currentStreak,
          longestStreak: data.longestStreak,
          tasksCompleted: data.tasksCompleted,
          tasksOverdue: data.tasksOverdue,
          focusMinutesToday: data.focusMinutesToday,
          timeOfDay: data.timeOfDay,
          recentActivity: cleanSnippet(data.recentActivity, 120),
        };
  } else {
    // Always send time-of-day so the coach can greet naturally
    snapshot = { timeOfDay: data.timeOfDay };
  }

  const payload: Record<string, unknown> = {
    mode,
    intent: data.intent ?? 'coaching',
    session: {
      title: cleanSnippet(data.session.title, 48),
      summary: isChatMode ? '' : cleanSnippet(data.session.summary, 220),
      messageCount: data.session.messageCount,
    },
    snapshot,
    conversation: (data.conversation ?? []).slice(-4).map((turn) => ({
      role: turn.role,
      content: cleanSnippet(turn.content, 120),
    })),
  };

  // Off-topic wander budget signal
  if ((data.consecutiveOffTopicTurns ?? 0) > 0) {
    payload.offTopicStreak = data.consecutiveOffTopicTurns;
  }

  // Entity snapshots — only attached when the current intent targets them.
  // In chat mode this sends ONLY the domain the user asked about (e.g. just
  // tasks for TASK_STATUS), keeping every per-message payload small. Summary
  // mode (intent = PROGRESS_REVIEW) includes all non-empty snapshots.
  //
  // IMPORTANT: We always include the key for every loaded domain, even when
  // the array is empty. This tells the AI "we checked the DB and found nothing"
  // rather than leaving the key absent (which the AI interprets as "no data
  // available"). An absent key means the domain was not loaded for this turn.
  const domains = data.loadedDomains ?? (isChatMode ? intentSnapshotDomains(data.intent ?? 'coaching') : ALL_SNAPSHOT_DOMAINS);

  if (domains.includes('tasks')) {
    payload.tasks = data.tasks.slice(0, 6).map((task) => ({
      id: task.id,
      title: cleanSnippet(task.title, 60),
      dueDate: task.dueDate,
      priority: task.priority,
      status: task.status,
      overdue: task.overdue,
      subtasksOpen: task.subtasksOpen,
    }));
    // Add a count hint so the AI can give a precise number even when we cap the list
    payload.tasksTotal = data.tasks.length;
  }

  if (domains.includes('goals')) {
    payload.goals = data.goals.slice(0, 3).map((goal) => ({
      id: goal.id,
      title: cleanSnippet(goal.title, 60),
      progress: goal.progress,
      status: goal.status,
      targetDate: goal.targetDate,
      nextMilestone: cleanSnippet(goal.nextMilestoneTitle ?? '', 60) || null,
    }));
  }

  if (domains.includes('habits')) {
    payload.habits = data.habits.slice(0, 4).map((habit) => ({
      id: habit.id,
      title: cleanSnippet(habit.title, 60),
      streak: habit.currentStreak,
      doneToday: habit.completedToday,
      doneThisWeek: `${habit.completionsThisWeek}/${habit.targetPerWeek}`,
    }));
  }

  if (domains.includes('milestones')) {
    payload.milestones = data.milestones.slice(0, 3).map((milestone) => ({
      id: milestone.id,
      goal: cleanSnippet(milestone.goalTitle, 60),
      title: cleanSnippet(milestone.title, 60),
      dueDate: milestone.dueDate,
    }));
  }

  // ── Recommendation / resolved-entity context (spec §27, §53) ─────────────
  if (
    isChatMode &&
    data.needsRecommendation === true &&
    data.recommendationCandidates &&
    data.recommendationCandidates.length > 0
  ) {
    payload.recommendationCandidates = data.recommendationCandidates.map((c) => ({
      id: c.id,
      title: cleanSnippet(c.title, 60),
      priority: c.priority,
      dueDate: c.dueDate,
      status: c.status,
      score: c.score,
      reasons: (c.reasons ?? []).slice(0, 4),
    }));
  }

  if (isChatMode && data.resolvedEntity) {
    payload.resolvedEntity = {
      id: data.resolvedEntity.id,
      type: data.resolvedEntity.type,
      title: data.resolvedEntity.title,
      confidence: data.resolvedEntity.confidence,
      method: data.resolvedEntity.method,
    };
  }

  const CREATE_INTENTS: ReadonlySet<CoachIntent> = new Set([
    CoachIntent.TASK_CREATE,
    CoachIntent.HABIT_CREATE,
    CoachIntent.GOAL_CREATE,
    CoachIntent.PROJECT_CREATE,
  ]);

  // Force the model to draft the correct entity type for create intents.
  // The shared creation prompt lists all four field sets, and weaker models
  // default to "task" for habit/goal/project requests. Asserting the one entity
  // here — with its allowed field names — prevents a habit from being created
  // as a task (which loses skipDays, reminders, and shows `recurrence` chips).
  const intentNow = data.intent ?? 'coaching';
  const createEntity = isChatMode && CREATE_INTENTS.has(intentNow) ? intentTargetEntity(intentNow) : undefined;
  if (createEntity) {
    const isHabit = createEntity === 'habit';
    const typeHint = isHabit
      ? '"habit". HABITS use skipDays + reminderTime + reminderMessage + targetPerWeek + durationDays. HABITS do NOT have priority, status, dueDate, or recurrence.'
      : `"${createEntity}". Use ONLY the ${createEntity} field set.`;
    payload.entityCreation = {
      entity: createEntity,
      instruction: `This turn is requesting to CREATE a ${createEntity}. You MUST set entityDraft.entity to ${typeHint} Never use fields from another entity type.`,
    };
  }

  return JSON.stringify(payload);
}
