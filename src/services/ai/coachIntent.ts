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
    'pending tasks',
    'task list',
    'what tasks',
    'tasks today',
    'tasks this week',
    'how many tasks',
    'show my tasks',
    'review my tasks',
    'task backlog',
    'outstanding tasks',
    'tasks left',
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
 * Classify the user's intent from up to the last 2 user turns.
 * Falls back to COACHING when no keyword matches.
 *
 * @param latestUserMessage  The current user message (required).
 * @param previousUserMessage Optional previous user message for continuity.
 */
export function classifyIntent(
  latestUserMessage: string,
  previousUserMessage?: string,
): CoachIntent {
  const combined = normalize(
    [latestUserMessage, previousUserMessage ?? ''].filter(Boolean).join(' '),
  );

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
