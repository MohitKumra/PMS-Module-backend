// backend/src/services/ai/coachIntent.ts
// Deterministic keyword-based intent classifier for the AI coach.
// Zero LLM cost — fully testable. Pluggable for an LLM classifier later.

import {
  intentSnapshotDomains as strategySnapshotDomains,
  intentNeedsLiveData as strategyNeedsLiveData,
} from './context/contextStrategy';

export const CoachIntent = {
  /** Pure off-topic / casual exchange */
  CHITCHAT: 'chitchat',

  // ── Task intents ──────────────────────────────────────────────────────────
  TASK_CREATE: 'task_create',
  TASK_UPDATE: 'task_update',
  TASK_COMPLETE: 'task_complete',
  TASK_DELETE: 'task_delete',
  TASK_STATUS: 'task_status',
  TASK_RECOMMEND: 'task_recommend',
  TASK_PRIORITIZE: 'task_prioritize',
  TASK_NEXT: 'task_next',
  TASK_SEARCH: 'task_search',
  TASK_DETAILS: 'task_details',
  TASK_SCHEDULE: 'task_schedule',
  TASK_RESCHEDULE: 'task_reschedule',

  // ── Habit intents ─────────────────────────────────────────────────────────
  HABIT_CREATE: 'habit_create',
  HABIT_UPDATE: 'habit_update',
  HABIT_COMPLETE: 'habit_complete',
  HABIT_STATUS: 'habit_status',
  HABIT_RECOMMEND: 'habit_recommend',
  HABIT_SEARCH: 'habit_search',
  HABIT_DETAILS: 'habit_details',

  // ── Goal intents ──────────────────────────────────────────────────────────
  GOAL_CREATE: 'goal_create',
  GOAL_UPDATE: 'goal_update',
  GOAL_STATUS: 'goal_status',
  GOAL_PROGRESS: 'goal_progress',
  GOAL_RECOMMEND: 'goal_recommend',
  GOAL_DETAILS: 'goal_details',

  // ── Project intents ───────────────────────────────────────────────────────
  PROJECT_CREATE: 'project_create',
  PROJECT_UPDATE: 'project_update',
  PROJECT_STATUS: 'project_status',
  PROJECT_DETAILS: 'project_details',
  PROJECT_SEARCH: 'project_search',

  // ── Planning intents ──────────────────────────────────────────────────────
  PLAN: 'plan',
  PLAN_DAY: 'plan_day',
  PLAN_WEEK: 'plan_week',
  PLAN_PROJECT: 'plan_project',
  PLAN_GOAL: 'plan_goal',
  PLAN_TASKS: 'plan_tasks',

  // ── Analytics intents ─────────────────────────────────────────────────────
  PROGRESS_REVIEW: 'progress_review',
  PRODUCTIVITY_REVIEW: 'productivity_review',
  FOCUS_REVIEW: 'focus_review',
  HABIT_REVIEW: 'habit_review',

  // ── General ───────────────────────────────────────────────────────────────
  COACHING: 'coaching',
  UNKNOWN: 'unknown',
} as const;

export type CoachIntent = (typeof CoachIntent)[keyof typeof CoachIntent];

// ─── Keyword map ─────────────────────────────────────────────────────────────
// Each key maps to the phrases that strongly suggest that intent.
// Order matters: more specific intents are listed first so the scorer
// can give them a head-start over the generic COACHING fallback.

export const INTENT_KEYWORDS: Record<CoachIntent, string[]> = {
  // ── Task update / complete / delete / schedule ────────────────────────────
  [CoachIntent.TASK_UPDATE]: [
    'update the',
    'update task',
    'edit the',
    'edit task',
    'change the task',
    'change task',
    'rename the task',
    'rename task',
  ],
  [CoachIntent.TASK_COMPLETE]: [
    'mark complete',
    'mark it complete',
    'complete the',
    'finish the',
    'finish task',
    'mark the',
    'mark as done',
    'mark as complete',
    'check off',
    'complete it',
    'actually complete',
  ],
  [CoachIntent.TASK_DELETE]: [
    'delete the',
    'delete task',
    'delete it',
    'remove the',
    'remove task',
    'remove it',
    'cancel the task',
    'get rid of',
    'delete this',
  ],
  [CoachIntent.TASK_RESCHEDULE]: [
    'move the',
    'move it',
    'move task',
    'reschedule',
    'postpone',
    'push to',
    'push back',
    'move this',
  ],
  [CoachIntent.TASK_SCHEDULE]: [
    'schedule the',
    'schedule task',
    'schedule it',
    'set a time for',
    'put it on my calendar',
  ],
  [CoachIntent.TASK_RECOMMEND]: [
    'what should i do',
    'what should i work on',
    'what task should i',
    'which task should i',
    'what task to do',
    'recommend a task',
    'recommend task',
    'which task do i',
    'what should i tackle',
  ],
  [CoachIntent.TASK_PRIORITIZE]: [
    'most important task',
    'which task is most important',
    'priority task',
    'prioritize',
    'whats most important',
    'top priority task',
    'most urgent task',
    'which task first',
    'what should i focus on',
  ],
  [CoachIntent.TASK_NEXT]: [
    'next task',
    'work on next',
    'whats next',
    'do next',
    'should i do next',
    'after that',
    'what next',
  ],
  [CoachIntent.TASK_SEARCH]: [
    'find my',
    'find the',
    'find task',
    'search for',
    'search my',
    'look for my',
    'look for the',
    'search task',
  ],
  [CoachIntent.TASK_DETAILS]: [
    'tell me about',
    'tell me more about',
    'what about the',
    'what about my',
    'more info on',
    'info on the',
    'which one is',
  ],
  [CoachIntent.TASK_CREATE]: [
    'add a task',
    'create a task',
    'new task',
    'add task',
    'make a task',
    'create task',
    'schedule a task',
    'set a task',
    'add to my tasks',
    'put a task',
    'log a task',
    'i need to do',
    'i have to do',
    'remind me to',
    'task for',
    'todo:',
    'to-do:',
    'action item',
    'create a to-do',
    'add a to-do',
    'create a new task',
    'schedule a new task',
    'make a new task',
    'put on my list',
    'put on my tasks',
    'put this on my tasks',
    'add to tasks',
    'add this task',
    'new to-do',
    'i need to',
    'i have to',
  ],
  [CoachIntent.HABIT_CREATE]: [
    'add a habit',
    'create a habit',
    'new habit',
    'start a habit',
    'build a habit',
    'track a habit',
    'make a habit',
    'daily habit',
    'weekly habit',
    'habit for',
    'set up a habit',
    'create habit',
    'add habit',
    'i want to build',
    'i want to start',
    'help me track',
    'create a new habit',
    'start tracking',
    'start daily habit',
  ],
  [CoachIntent.GOAL_CREATE]: [
    'add a goal',
    'create a goal',
    'set a goal',
    'new goal',
    'i want to achieve',
    'my goal is',
    'working toward',
    'working towards',
    'i want to reach',
    'set up a goal',
    'help me set a goal',
    'create goal',
    'add goal',
    'how many goals',
    'my goals',
    'list my goals',
    'show my goals',
    'what goals',
    'which goals',
    'goals do i',
    'goals have i',
  ],
  [CoachIntent.PROJECT_CREATE]: [
    'create a project',
    'add a project',
    'new project',
    'start a project',
    'set up a project',
    'create project',
    'add project',
    'make a project',
    'project for',
    'how many projects',
    'my projects',
    'list my projects',
    'show my projects',
    'what projects',
    'which projects',
    'projects do i',
  ],
  [CoachIntent.PLAN]: [
    'build a plan',
    'create a plan',
    'make a plan',
    'plan for',
    'roadmap',
    'goal plan',
    'full plan',
    'strategy for',
    'workspace',
    'plan out',
    'plan my',
    'help me plan',
    'generate a plan',
    'create workspace',
  ],
  [CoachIntent.TASK_STATUS]: [
    'upcoming tasks',
    'upcoming task',
    'my upcoming',
    'what upcoming',
    'what are my upcoming',
    'know my tasks',
    'know upcoming tasks',
    'see my tasks',
    'see upcoming tasks',
    'tell me my tasks',
    'tell my tasks',
    'my schedule',
    'whats on my plate',
    'what is on my plate',
    'show upcoming',
    'check my tasks',
    'check tasks',
    'view my tasks',
    'view tasks',
    'view my upcoming',
    'what to do',
    'what do i have to do',
    'what do i need to do',
    'tasks on my plate',
    'look at my tasks',
    'pull up my tasks',
    'get my tasks',
    'tasks due soon',
    'tasks this month',
    'my tasks',
    'overdue tasks',
    'tasks due',
    'tasks are due',
    'pending tasks',
    'are pending',
    'is pending',
    'tasks pending',
    'task list',
    'what tasks',
    'what are my',
    'tasks today',
    'tasks this week',
    'how many tasks',
    'show my tasks',
    'review my tasks',
    'task backlog',
    'outstanding tasks',
    'tasks left',
    'tasks are overdue',
    'are overdue',
    'open tasks',
    'count my tasks',
    'count tasks',
    'do i have any tasks',
    'do i have tasks',
    'list my tasks',
    'list tasks',
    'any pending',
    'any overdue',
    'which tasks',
    'incomplete tasks',
    'unfinished tasks',
    'tasks remaining',
    'remaining tasks',
    'not done',
    'still open',
    'what do i have',
    'what have i got',
    'tasks should i',
    'tasks do i',
  ],
  [CoachIntent.HABIT_STATUS]: [
    'upcoming habits',
    'my daily habits',
    'my routine',
    'how are my habits',
    'check my habits',
    'show upcoming habits',
    'view my habits',
    'habit list',
    'routine check',
    'my habits',
    'habit streak',
    'streak',
    'habits today',
    'habits this week',
    'how many habits',
    'completed habits',
    'habit progress',
    'what habits',
    'show my habits',
    'review my habits',
    'missed habits',
    'list my habits',
    'list habits',
    'habits do i',
    'habits have i',
    'which habits',
    'habit check',
    'habit status',
    'any habits',
    'habits pending',
    'habits left',
    'habits remaining',
    'habits completed',
    'did i do my habits',
    'have i done my',
  ],
  [CoachIntent.PROGRESS_REVIEW]: [
    'how am i doing',
    'my progress',
    'review my progress',
    'check in',
    'weekly review',
    'monthly review',
    'progress report',
    'how is my progress',
    'overall progress',
    'what have i done',
    'what did i accomplish',
    'how did i do',
    'productivity',
    'summary',
    'week summary',
    'show my progress',
    'give me a summary',
    'give me an overview',
    'overview of my',
    'how have i been',
    'update on my',
    'catch me up',
    'where am i',
    'where do i stand',
    'status update',
    'full report',
  ],
  [CoachIntent.HABIT_UPDATE]: ['update habit', 'edit habit', 'change habit'],
  [CoachIntent.HABIT_COMPLETE]: [
    'mark habit complete',
    'complete the habit',
    'completed my habit',
    'did my habit',
    'check off habit',
    'finish the habit',
  ],
  [CoachIntent.HABIT_RECOMMEND]: ['recommend a habit', 'which habit should i', 'what habit should i'],
  [CoachIntent.HABIT_SEARCH]: ['find my habit', 'find the habit', 'search habits'],
  [CoachIntent.HABIT_DETAILS]: ['tell me about the habit', 'habit details'],

  [CoachIntent.GOAL_UPDATE]: ['update goal', 'edit goal', 'change my goal'],
  [CoachIntent.GOAL_STATUS]: ['goal status', 'how is my goal', 'how are my goals', 'goals going'],
  [CoachIntent.GOAL_PROGRESS]: ['goal progress', 'progress on my goal', 'how far along'],
  [CoachIntent.GOAL_RECOMMEND]: ['recommend a goal', 'which goal should i', 'what goal should i focus'],
  [CoachIntent.GOAL_DETAILS]: ['tell me about the goal', 'goal details', 'about my goal'],

  [CoachIntent.PROJECT_UPDATE]: ['update project', 'edit project', 'change the project'],
  [CoachIntent.PROJECT_STATUS]: ['project status', 'how is the project', 'how are my projects going'],
  [CoachIntent.PROJECT_DETAILS]: ['tell me about the project', 'project details'],
  [CoachIntent.PROJECT_SEARCH]: ['find my project', 'find the project', 'search projects'],

  [CoachIntent.PLAN_DAY]: ['plan my day', 'plan today', 'plan the day', 'schedule today'],
  [CoachIntent.PLAN_WEEK]: ['plan my week', 'plan the week', 'plan this week', 'weekly plan'],
  [CoachIntent.PLAN_PROJECT]: ['plan the project', 'project plan', 'plan for the project'],
  [CoachIntent.PLAN_GOAL]: ['plan my goal', 'goal plan', 'plan toward'],
  [CoachIntent.PLAN_TASKS]: ['plan my tasks', 'plan tasks', 'schedule my tasks'],

  [CoachIntent.PRODUCTIVITY_REVIEW]: ['am i productive', 'productivity review', 'how productive'],
  [CoachIntent.FOCUS_REVIEW]: ['focus review', 'how was my focus', 'focus time this week'],
  [CoachIntent.HABIT_REVIEW]: ['habit review', 'review my habits', 'habit consistency'],

  [CoachIntent.CHITCHAT]: [
    'hello',
    'hi ',
    '^hi$',
    'hey ',
    '^hey$',
    'how are you',
    'what are you',
    'who are you',
    'tell me a joke',
    'tell me a story',
    'what is the weather',
    "what's the weather",
    'what time is it',
    "what's today",
    'good morning',
    'good evening',
    'good night',
    'good afternoon',
    'thanks',
    'thank you',
    'nice to meet',
    'bye',
    'goodbye',
    'see you',
    'lol',
    'haha',
    'cool',
    'awesome',
    'interesting',
    'ok',
    'okay',
    'sure',
    'yep',
    'nope',
  ],
  [CoachIntent.COACHING]: [], // fallback — never matched by keywords
  [CoachIntent.UNKNOWN]: [],
};

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Priority order: CRUD task intents > habit > goal > project > planning >
 * status/recommend/search/detail > analytics > chitchat > general coaching.
 * The first intent that gets at least one keyword hit wins.
 */
const PRIORITY_ORDER: CoachIntent[] = [
  CoachIntent.TASK_CREATE,
  CoachIntent.TASK_COMPLETE,
  CoachIntent.TASK_RESCHEDULE,
  CoachIntent.TASK_SCHEDULE,
  CoachIntent.TASK_UPDATE,
  CoachIntent.TASK_DELETE,
  CoachIntent.HABIT_CREATE,
  CoachIntent.HABIT_COMPLETE,
  CoachIntent.HABIT_UPDATE,
  CoachIntent.GOAL_CREATE,
  CoachIntent.GOAL_UPDATE,
  CoachIntent.PROJECT_CREATE,
  CoachIntent.PROJECT_UPDATE,
  CoachIntent.PLAN,
  CoachIntent.PLAN_DAY,
  CoachIntent.PLAN_WEEK,
  CoachIntent.PLAN_PROJECT,
  CoachIntent.PLAN_GOAL,
  CoachIntent.PLAN_TASKS,
  CoachIntent.TASK_NEXT,
  CoachIntent.TASK_PRIORITIZE,
  CoachIntent.TASK_RECOMMEND,
  CoachIntent.TASK_SEARCH,
  CoachIntent.TASK_DETAILS,
  CoachIntent.TASK_STATUS,
  CoachIntent.HABIT_RECOMMEND,
  CoachIntent.HABIT_SEARCH,
  CoachIntent.HABIT_DETAILS,
  CoachIntent.HABIT_STATUS,
  CoachIntent.GOAL_RECOMMEND,
  CoachIntent.GOAL_PROGRESS,
  CoachIntent.GOAL_STATUS,
  CoachIntent.GOAL_DETAILS,
  CoachIntent.PROJECT_STATUS,
  CoachIntent.PROJECT_DETAILS,
  CoachIntent.PROJECT_SEARCH,
  CoachIntent.PROGRESS_REVIEW,
  CoachIntent.PRODUCTIVITY_REVIEW,
  CoachIntent.FOCUS_REVIEW,
  CoachIntent.HABIT_REVIEW,
  CoachIntent.CHITCHAT,
  CoachIntent.COACHING,
  CoachIntent.UNKNOWN,
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/['']/g, "'");
}

function hasKeyword(normalized: string, keywords: string[]): boolean {
  return keywords.some((kw) => {
    // Keywords starting with ^ are simple start-anchored regex
    if (kw.startsWith('^')) {
      const pattern = new RegExp(kw, 'i');
      return pattern.test(normalized);
    }
    return normalized.includes(kw);
  });
}

function detectStructuralIntent(text: string): CoachIntent | null {
  const hasTaskTerm = /\b(tasks?|todos?|to-dos?|action items?|backlog)\b/i.test(text);
  const hasHabitTerm = /\b(habits?|routines?|streaks?)\b/i.test(text);
  const hasGoalTerm = /\b(goals?|milestones?|objectives?)\b/i.test(text);
  const hasProjectTerm = /\b(projects?|initiatives?)\b/i.test(text);

  const hasQueryVerb = /\b(know|show|tell|see|view|check|get|list|display|find|fetch|pull up|what are|what is|whats|count|review|examine|read|look at)\b/i.test(text);
  const hasCreateVerb = /\b(create|add|make|schedule|set up|start|track|build|draft|remind me to|log|new)\b/i.test(text);
  const hasRecommendVerb = /\b(recommend|suggest|prioritize|which|what should|what next)\b/i.test(text);

  if (hasCreateVerb) {
    if (hasHabitTerm) return CoachIntent.HABIT_CREATE;
    if (hasGoalTerm) return CoachIntent.GOAL_CREATE;
    if (hasProjectTerm) return CoachIntent.PROJECT_CREATE;
    if (hasTaskTerm || /\bremind me\b/i.test(text)) return CoachIntent.TASK_CREATE;
  }

  if (hasRecommendVerb) {
    if (hasHabitTerm) return CoachIntent.HABIT_RECOMMEND;
    if (hasGoalTerm) return CoachIntent.GOAL_RECOMMEND;
    if (hasTaskTerm || /\bwork on\b/i.test(text)) return CoachIntent.TASK_RECOMMEND;
  }

  if (hasQueryVerb) {
    if (hasHabitTerm) return CoachIntent.HABIT_STATUS;
    if (hasGoalTerm) return CoachIntent.GOAL_STATUS;
    if (hasProjectTerm) return CoachIntent.PROJECT_STATUS;
    if (hasTaskTerm || /\b(upcoming|agenda|schedule)\b/i.test(text)) return CoachIntent.TASK_STATUS;
  }

  // Standalone phrases like "upcoming tasks" or "agenda"
  if (/\bupcoming (tasks?|todos?|items?|events?|deadlines?)\b/i.test(text)) return CoachIntent.TASK_STATUS;
  if (/\bupcoming (habits?|routines?)\b/i.test(text)) return CoachIntent.HABIT_STATUS;
  if (/\bupcoming (goals?|milestones?)\b/i.test(text)) return CoachIntent.GOAL_STATUS;

  return null;
}

/**
 * Classify the intent of the current user message.
 *
 * Strategy (current-message-first):
 *  1. Run the classifier on the CURRENT message alone. If it yields a
 *     non-COACHING, non-CHITCHAT intent that is concrete enough → use it.
 *  2. Check structural regex heuristics for domain-specific query/action intents.
 *  3. Only fall back to blending with the previous message when the current
 *     message is genuinely ambiguous: it matched nothing, OR it matched only
 *     CHITCHAT (pure follow-up like "yes that's what I'm asking").
 *
 * This prevents a previous turn's domain keywords from hijacking a fresh,
 * clearly different question (e.g. "how many habits do i have" after a task
 * thread should not inherit TASK_STATUS from the prior turn).
 *
 * @param latestUserMessage   The current user message (required).
 * @param previousUserMessage Optional previous user message for continuity.
 */
export function classifyIntent(
  latestUserMessage: string,
  previousUserMessage?: string,
): CoachIntent {
  const currentNorm = normalize(latestUserMessage);

  // ── Step 1: classify current message alone via keyword table ──────────────
  let currentIntent: CoachIntent = CoachIntent.COACHING;
  for (const intent of PRIORITY_ORDER) {
    const keywords = INTENT_KEYWORDS[intent];
    if (keywords.length > 0 && hasKeyword(currentNorm, keywords)) {
      currentIntent = intent;
      break;
    }
  }

  // ── Step 1b: Structural regex detector for phrases missed by keyword table
  if (currentIntent === CoachIntent.COACHING) {
    const structural = detectStructuralIntent(currentNorm);
    if (structural) {
      currentIntent = structural;
    }
  }

  // If the current message resolved to a concrete, domain-specific intent
  // (anything other than COACHING or CHITCHAT), trust it directly.
  // This stops a previous turn from polluting a fresh, unambiguous question.
  if (
    currentIntent !== CoachIntent.COACHING &&
    currentIntent !== CoachIntent.CHITCHAT
  ) {
    return currentIntent;
  }

  // ── Step 2: ambiguous current message — blend with previous turn ──────────
  // The current message hit nothing useful (or is pure chitchat/follow-up).
  // Blending lets short follow-ups like "yes that's what I'm asking" inherit
  // context from the previous question.
  if (!previousUserMessage) return currentIntent;

  const combined = normalize(`${latestUserMessage} ${previousUserMessage}`);
  for (const intent of PRIORITY_ORDER) {
    const keywords = INTENT_KEYWORDS[intent];
    if (keywords.length > 0 && hasKeyword(combined, keywords)) {
      return intent;
    }
  }

  const combinedStructural = detectStructuralIntent(combined);
  if (combinedStructural) {
    return combinedStructural;
  }

  return CoachIntent.COACHING;
}

// ─── Intent metadata ──────────────────────────────────────────────────────────
// These are now thin delegates into the context strategy layer so there is a
// single source of truth for "what does this intent need".

/** Whether this intent requires pulling live DB stats (summary, focus, streaks). */
export function intentNeedsLiveData(intent: CoachIntent): boolean {
  return strategyNeedsLiveData(intent);
}

/** Entity snapshot domain type — kept for backward compatibility. */
export type CoachSnapshotDomain = 'tasks' | 'habits' | 'goals' | 'milestones';

/** All snapshot domains — used for summary mode / broad progress reviews. */
export const ALL_SNAPSHOT_DOMAINS: CoachSnapshotDomain[] = ['tasks', 'habits', 'goals', 'milestones'];

/**
 * Map an intent to the exact set of snapshot domains it needs.
 * Delegates to context/contextStrategy so recommendations also load tasks.
 */
export function intentSnapshotDomains(intent: CoachIntent): CoachSnapshotDomain[] {
  return strategySnapshotDomains(intent);
}

/**
 * Which entity type (if any) this intent targets for CRUD / resolution.
 * Returns null for non-entity intents.
 */
export function intentTargetEntity(
  intent: CoachIntent,
): 'task' | 'habit' | 'goal' | 'project' | null {
  switch (intent) {
    case CoachIntent.TASK_CREATE:
    case CoachIntent.TASK_UPDATE:
    case CoachIntent.TASK_COMPLETE:
    case CoachIntent.TASK_DELETE:
    case CoachIntent.TASK_STATUS:
    case CoachIntent.TASK_SEARCH:
    case CoachIntent.TASK_DETAILS:
    case CoachIntent.TASK_SCHEDULE:
    case CoachIntent.TASK_RESCHEDULE:
    case CoachIntent.TASK_RECOMMEND:
    case CoachIntent.TASK_PRIORITIZE:
    case CoachIntent.TASK_NEXT:
      return 'task';
    case CoachIntent.HABIT_CREATE:
    case CoachIntent.HABIT_UPDATE:
    case CoachIntent.HABIT_COMPLETE:
    case CoachIntent.HABIT_STATUS:
    case CoachIntent.HABIT_RECOMMEND:
    case CoachIntent.HABIT_SEARCH:
    case CoachIntent.HABIT_DETAILS:
      return 'habit';
    case CoachIntent.GOAL_CREATE:
    case CoachIntent.GOAL_UPDATE:
    case CoachIntent.GOAL_STATUS:
    case CoachIntent.GOAL_PROGRESS:
    case CoachIntent.GOAL_RECOMMEND:
    case CoachIntent.GOAL_DETAILS:
      return 'goal';
    case CoachIntent.PROJECT_CREATE:
    case CoachIntent.PROJECT_UPDATE:
    case CoachIntent.PROJECT_STATUS:
    case CoachIntent.PROJECT_DETAILS:
    case CoachIntent.PROJECT_SEARCH:
      return 'project';
    default:
      return null;
  }
}
