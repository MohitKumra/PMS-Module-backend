// backend/src/services/ai/prompts/coachPrompts.ts
// Prompt templates for the AI Coach feature.

import type { CoachIntent } from '../coachIntent';
import { generateEntityCreationPrompt } from '../entitySchemas';

export type AICoachActionType =
  | 'open_habits'
  | 'open_tasks'
  | 'open_goals'
  | 'open_focus'
  | 'open_dashboard'
  | 'open_coach'
  | 'create_plan';

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
  title: string;
  progress: number;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
  targetDate: string | null;
  nextMilestoneTitle: string | null;
  nextMilestoneDueDate: string | null;
}

export interface CoachHabitSnapshot {
  title: string;
  goalTitle: string | null;
  currentStreak: number;
  targetPerWeek: number;
  completionsThisWeek: number;
  completedToday: boolean;
}

export interface CoachMilestoneSnapshot {
  goalTitle: string;
  goalProgress: number;
  title: string;
  dueDate: string | null;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
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
  • Create a single task, habit, goal, or project on the user's behalf when asked.
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

DATA RULES:
  • Use only the JSON payload provided. Do not invent data.
  • In chat mode, rely on the recent conversation for continuity; avoid replaying stats every turn.
  • If the user says hello or is very vague, respond naturally and ask one follow-up question.

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

  // Entity snapshots — only attached when the loader actually fetched them
  // (i.e. goals/habits/milestones arrays are non-empty or mode is summary)
  if (!isChatMode && data.goals.length > 0) {
    payload.goals = data.goals.slice(0, 3).map((goal) => ({
      title: cleanSnippet(goal.title, 60),
      progress: goal.progress,
      status: goal.status,
      targetDate: goal.targetDate,
      nextMilestone: cleanSnippet(goal.nextMilestoneTitle ?? '', 60) || null,
    }));
  }

  if (!isChatMode && data.habits.length > 0) {
    payload.habits = data.habits.slice(0, 4).map((habit) => ({
      title: cleanSnippet(habit.title, 60),
      streak: habit.currentStreak,
      doneToday: habit.completedToday,
      doneThisWeek: `${habit.completionsThisWeek}/${habit.targetPerWeek}`,
    }));
  }

  if (!isChatMode && data.milestones.length > 0) {
    payload.milestones = data.milestones.slice(0, 3).map((milestone) => ({
      goal: cleanSnippet(milestone.goalTitle, 60),
      title: cleanSnippet(milestone.title, 60),
      dueDate: milestone.dueDate,
    }));
  }

  return JSON.stringify(payload);
}
