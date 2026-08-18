// backend/src/services/ai/coachIntent.ts
// Deterministic keyword-based intent classifier for the AI coach.
// Zero LLM cost — fully testable. Pluggable for an LLM classifier later.

export const CoachIntent = {
  /** Pure off-topic / casual exchange */
  CHITCHAT: 'chitchat',
  /** User wants to create a single task */
  TASK_CREATE: 'task_create',
  /** User wants to create a single habit */
  HABIT_CREATE: 'habit_create',
  /** User wants to create a single goal */
  GOAL_CREATE: 'goal_create',
  /** User wants to create a single project */
  PROJECT_CREATE: 'project_create',
  /** User wants to build a full goal plan/workspace */
  PLAN: 'plan',
  /** User is asking about their task list / overdue / status */
  TASK_STATUS: 'task_status',
  /** User is asking about habit streaks / completions */
  HABIT_STATUS: 'habit_status',
  /** User is requesting a broader progress review */
  PROGRESS_REVIEW: 'progress_review',
  /** General coaching — no specific CRUD intent detected */
  COACHING: 'coaching',
} as const;

export type CoachIntent = (typeof CoachIntent)[keyof typeof CoachIntent];

// ─── Keyword map ─────────────────────────────────────────────────────────────
// Each key maps to the phrases that strongly suggest that intent.
// Order matters: more specific intents are listed first so the scorer
// can give them a head-start over the generic COACHING fallback.

export const INTENT_KEYWORDS: Record<CoachIntent, string[]> = {
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
};

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Priority order: CRUD create intents > status intents > plan > progress review
 * > chitchat > general coaching.
 * The first intent that gets at least one keyword hit wins.
 */
const PRIORITY_ORDER: CoachIntent[] = [
  CoachIntent.TASK_CREATE,
  CoachIntent.HABIT_CREATE,
  CoachIntent.GOAL_CREATE,
  CoachIntent.PROJECT_CREATE,
  CoachIntent.PLAN,
  CoachIntent.TASK_STATUS,
  CoachIntent.HABIT_STATUS,
  CoachIntent.PROGRESS_REVIEW,
  CoachIntent.CHITCHAT,
  CoachIntent.COACHING,
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

/**
 * Classify the intent of the current user message.
 *
 * Strategy (current-message-first):
 *  1. Run the classifier on the CURRENT message alone. If it yields a
 *     non-COACHING, non-CHITCHAT intent that is concrete enough → use it.
 *  2. Only fall back to blending with the previous message when the current
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

  // ── Step 1: classify current message alone ────────────────────────────────
  let currentIntent: CoachIntent = CoachIntent.COACHING;
  for (const intent of PRIORITY_ORDER) {
    const keywords = INTENT_KEYWORDS[intent];
    if (keywords.length > 0 && hasKeyword(currentNorm, keywords)) {
      currentIntent = intent;
      break;
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

  return CoachIntent.COACHING;
}

// ─── Intent metadata ──────────────────────────────────────────────────────────

/**
 * Whether this intent requires pulling live DB stats (summary, focus, streaks).
 */
export function intentNeedsLiveData(intent: CoachIntent): boolean {
  return (
    intent === CoachIntent.PROGRESS_REVIEW ||
    intent === CoachIntent.TASK_STATUS ||
    intent === CoachIntent.HABIT_STATUS
  );
}

/**
 * The granular data domains that can be loaded as an entity "snapshot".
 * Each one maps to a focused DB query so the coach never reads the whole
 * user's database — only what the current intent actually needs.
 */
export type CoachSnapshotDomain = 'tasks' | 'habits' | 'goals' | 'milestones';

/** All snapshot domains — used for summary mode / broad progress reviews. */
export const ALL_SNAPSHOT_DOMAINS: CoachSnapshotDomain[] = ['tasks', 'habits', 'goals', 'milestones'];

/**
 * Map an intent to the exact set of snapshot domains it needs.
 * CHITCHAT / COACHING return an empty list → the coach sends no entity
 * snapshots at all, saving the most tokens.
 */
export function intentSnapshotDomains(intent: CoachIntent): CoachSnapshotDomain[] {
  switch (intent) {
    case CoachIntent.TASK_CREATE:
    case CoachIntent.TASK_STATUS:
      return ['tasks'];
    case CoachIntent.HABIT_CREATE:
    case CoachIntent.HABIT_STATUS:
      return ['habits'];
    case CoachIntent.GOAL_CREATE:
    case CoachIntent.PLAN:
      return ['goals', 'milestones'];
    case CoachIntent.PROJECT_CREATE:
      return [];
    case CoachIntent.PROGRESS_REVIEW:
      return ALL_SNAPSHOT_DOMAINS;
    default:
      return [];
  }
}

/**
 * Which entity type (if any) this intent targets for CRUD.
 * Returns null for non-CRUD intents.
 */
export function intentTargetEntity(
  intent: CoachIntent,
): 'task' | 'habit' | 'goal' | 'project' | null {
  switch (intent) {
    case CoachIntent.TASK_CREATE:
      return 'task';
    case CoachIntent.HABIT_CREATE:
      return 'habit';
    case CoachIntent.GOAL_CREATE:
      return 'goal';
    case CoachIntent.PROJECT_CREATE:
      return 'project';
    default:
      return null;
  }
}
