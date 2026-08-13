// backend/src/services/ai/aiService.ts
// Main AI service that orchestrates all AI-powered features.
// Each method has a fallback to the existing rule-based system if AI is unavailable.

import { complete, isAIAvailable, getAIProvider, getAIModel } from './aiClient';
import { recordTokenUsage } from './tokenUsage.service';
import { extractDueDateFromText, getLocalDateContext } from './taskDateParser';
import { INSIGHT_SYSTEM_PROMPT, buildInsightUserPrompt } from './prompts/insightPrompts';
import {
  COACH_SYSTEM_PROMPT,
  buildCoachUserPrompt,
  type AICoachActionType,
  type CoachPromptData,
} from './prompts/coachPrompts';
import { DAILY_BRIEF_SYSTEM_PROMPT, buildDailyBriefUserPrompt } from './prompts/dailyBriefPrompts';
import {
  JOURNAL_ANALYSIS_SYSTEM_PROMPT,
  JOURNAL_WEEKLY_SYSTEM_PROMPT,
  buildJournalEntryPrompt,
  buildJournalWeeklyPrompt,
} from './prompts/journalPrompts';
import type { InsightDTO, GoalPlannerPlanDTO } from '../../types';

// ─── Status ───────────────────────────────────────────────────────────────────

export interface AIStatus {
  available: boolean;
  provider: string;
  model: string;
}

export function getAIStatus(): AIStatus {
  return {
    available: isAIAvailable(),
    provider: getAIProvider(),
    model: getAIModel(),
  };
}

// ─── Insights ─────────────────────────────────────────────────────────────────

export interface AIInsightResult {
  insights: InsightDTO[];
  source: 'ai' | 'fallback';
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export async function generateAIInsights(
  userId: string,
  data: Parameters<typeof buildInsightUserPrompt>[0]
): Promise<AIInsightResult> {
  if (!isAIAvailable()) {
    return { insights: [], source: 'fallback' };
  }

  const response = await complete({
    systemPrompt: INSIGHT_SYSTEM_PROMPT,
    userPrompt: buildInsightUserPrompt(data),
    maxTokens: 600,
    temperature: 0.7,
    responseFormat: 'json_object',
  });

  if (!response) {
    return { insights: [], source: 'fallback' };
  }

  try {
    const parsed = JSON.parse(response.content);
    if (parsed.insights && Array.isArray(parsed.insights)) {
      void recordTokenUsage(userId, response.usage?.totalTokens ?? 0);
      return {
        insights: parsed.insights.slice(0, 6),
        source: 'ai',
        usage: response.usage ?? undefined,
      };
    }
  } catch (e) {
    console.warn('[AI] Failed to parse insights JSON:', e);
  }

  return { insights: [], source: 'fallback' };
}

// ─── Coach ────────────────────────────────────────────────────────────────────

export interface CoachEntityDraft {
  entity: 'task' | 'habit' | 'goal' | 'project';
  title: string;
  fields: Record<string, string | null>;
}

export interface AICoachResult {
  title: string;
  message: string;
  suggestion: { text: string; actionLabel: string; actionType: AICoachActionType };
  mood: 'encouraging' | 'challenging' | 'celebratory';
  planPrompt?: string;
  entityDraft?: CoachEntityDraft | null;
  source: 'ai' | 'fallback';
}

const COACH_ACTION_TYPES: AICoachActionType[] = [
  'open_habits',
  'open_tasks',
  'open_goals',
  'open_focus',
  'open_dashboard',
  'open_coach',
  'create_plan',
];

function trimCoachText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function emptyCoachResult(): AICoachResult {
  return {
    title: 'Coach',
    message: '',
    suggestion: { text: '', actionLabel: '', actionType: 'open_coach' },
    mood: 'encouraging',
    planPrompt: '',
    source: 'fallback',
  };
}

function buildCoachSignalText(data: CoachPromptData): string {
  const mode = data.mode ?? (data.conversation?.length ? 'chat' : 'summary');
  const userMessages = [...(data.conversation ?? [])]
    .reverse()
    .filter((turn) => turn.role === 'user')
    .slice(0, 3)
    .map((turn) => turn.content);

  const goalSignals = data.goals.flatMap((goal) => [goal.title, goal.nextMilestoneTitle].filter(Boolean) as string[]);
  const habitSignals = data.habits.flatMap((habit) => [habit.title, habit.goalTitle].filter(Boolean) as string[]);
  const milestoneSignals = data.milestones.flatMap((milestone) => [milestone.goalTitle, milestone.title].filter(Boolean) as string[]);

  return [
    data.session.title,
    mode === 'chat' ? '' : data.session.summary,
    data.recentActivity,
    ...userMessages,
    ...goalSignals,
    ...habitSignals,
    ...milestoneSignals,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function latestUserMessage(data: CoachPromptData): string {
  return (
    [...(data.conversation ?? [])]
      .reverse()
      .find((turn) => turn.role === 'user')
      ?.content.replace(/\s+/g, ' ')
      .trim() || ''
  );
}

function includesAny(text: string, keywords: string[]): boolean {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

function pickVariant<T>(variants: T[], seed: string): T {
  if (variants.length === 0) {
    throw new Error('pickVariant requires at least one variant');
  }

  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  return variants[hash % variants.length];
}

export function buildFallbackCoachResult(data: CoachPromptData): AICoachResult {
  const userText = latestUserMessage(data);
  const combinedText = buildCoachSignalText(data);
  const mode = data.mode ?? (data.conversation?.length ? 'chat' : 'summary');
  const isChatMode = mode === 'chat';
  const branchText = isChatMode && userText ? userText : combinedText;
  const seed = [
    mode,
    data.session.messageCount,
    userText || combinedText,
    data.completedToday,
    data.tasksOverdue,
    data.focusMinutesToday,
    data.totalHabits,
    data.currentStreak,
  ].join('|');
  const userLooksVague =
    isChatMode &&
    (!userText ||
      userText.length < 8 ||
      includesAny(userText, ['hello', 'hi', 'hey', 'thanks', 'thank you', 'ok', 'okay']));

  let title = 'Coach';
  let message = 'Tell me what matters most and I will help you pick the next move.';
  let suggestionText = 'Share one goal, blocker, or deadline.';
  let actionLabel = 'Keep chatting';
  let actionType: AICoachActionType = 'open_coach';
  let planPrompt = '';
  let mood: AICoachResult['mood'] = 'encouraging';

  if (userLooksVague) {
    title = pickVariant(['Quick check-in', 'Talk to me', 'Next step'], seed);
    message = pickVariant(
      [
        'I am here. Tell me the one thing you want to work on, and I will help shape the next step.',
        'Let us make this useful. What is the goal, blocker, or deadline you want to tackle first?',
        'Give me a target or a problem, and I will help turn it into something actionable.',
      ],
      seed
    );
    suggestionText = 'Tell me your goal or blocker.';
    actionLabel = 'Keep chatting';
    actionType = 'open_coach';
    mood = 'encouraging';
  } else {
    const wantsPlan = includesAny(branchText, ['plan', 'roadmap', 'strategy', 'goal plan', 'build a plan']);
    const wantsTasks = includesAny(branchText, ['task', 'todo', 'backlog', 'overdue', 'blocked']);
    const wantsFocus = includesAny(branchText, ['focus', 'distract', 'distraction', 'attention', 'concentrate']);
    const wantsHabits = includesAny(branchText, ['habit', 'routine', 'streak', 'exercise', 'workout']);
    const wantsGoals = includesAny(branchText, ['goal', 'goals', 'target', 'objective']);

    if (wantsPlan) {
    title = 'Plan builder';
    message = 'I can turn this into a practical plan. Give me the goal and deadline if you have one.';
    suggestionText = 'Build a practical plan from this chat.';
    actionLabel = 'Build plan';
    actionType = 'create_plan';
    planPrompt = userText
      ? `Create a practical goal plan from this request: ${userText}`
      : 'Create a practical goal plan from the conversation.';
    mood = 'encouraging';
  } else if (wantsTasks) {
    title = 'Task reset';
    message = data.tasksOverdue > 0
      ? pickVariant(
          [
            `${data.tasksOverdue} overdue task${data.tasksOverdue === 1 ? '' : 's'} need attention. Let us clear the smallest one first.`,
            `You have ${data.tasksOverdue} overdue task${data.tasksOverdue === 1 ? '' : 's'}. Start with the easiest blocker.`,
            'A few tasks are waiting. Pick one overdue item and move it forward now.',
          ],
          seed
        )
      : pickVariant(
          [
            'Your task list needs a quick reset. Pick one easy win and make it real.',
            'Let us tidy the task stack. Start with the smallest blocker.',
            'A light task cleanup will help here. Choose one thing and finish it.',
          ],
          seed
        );
    suggestionText = 'Open tasks and clear the next blocker.';
    actionLabel = 'Open tasks';
    actionType = 'open_tasks';
    mood = data.tasksOverdue > 2 ? 'challenging' : 'encouraging';
  } else if (wantsFocus) {
    title = 'Focus block';
    message = `You have ${data.focusMinutesToday} focus minute${data.focusMinutesToday === 1 ? '' : 's'} today. Let’s protect one focused block.`;
    suggestionText = 'Open focus and start one short block.';
    actionLabel = 'Open focus';
    actionType = 'open_focus';
    mood = data.focusMinutesToday >= 30 ? 'celebratory' : 'encouraging';
  } else if (wantsHabits) {
    title = 'Habit push';
    message = `${data.completedToday} of ${data.totalHabits} habits are done. Finish one small habit to protect the streak.`;
    suggestionText = 'Open habits and finish one quick win.';
    actionLabel = 'Open habits';
    actionType = 'open_habits';
    mood = data.completedToday > 0 ? 'celebratory' : 'encouraging';
  } else if (wantsGoals) {
    title = 'Goals';
    message = 'You are talking about a goal. Open goals and turn it into a concrete next step.';
    suggestionText = 'Open goals and map the next step.';
    actionLabel = 'Open goals';
    actionType = 'open_goals';
    mood = 'encouraging';
  } else if (!isChatMode && (data.completedToday > 0 || data.focusMinutesToday > 30)) {
    title = 'Momentum';
    message = 'You are moving well. Keep the momentum with one clear next step.';
    suggestionText = 'Stay in motion with one focused action.';
    actionLabel = 'Open coach';
    actionType = 'open_coach';
    mood = 'celebratory';
  }
  }

  return {
    title,
    message,
    suggestion: {
      text: suggestionText,
      actionLabel,
      actionType,
    },
    mood,
    planPrompt,
    source: 'fallback',
  };
}

function normalizeCoachActionType(value: unknown, fallback: AICoachActionType): AICoachActionType {
  return typeof value === 'string' && COACH_ACTION_TYPES.includes(value as AICoachActionType)
    ? (value as AICoachActionType)
    : fallback;
}

function normalizeCoachResult(parsed: any, fallback: AICoachResult): AICoachResult {
  const parsedSuggestion = parsed?.suggestion && typeof parsed.suggestion === 'object' ? parsed.suggestion : {};
  const actionType = normalizeCoachActionType(
    parsedSuggestion.actionType,
    trimCoachText(parsed?.planPrompt, 220) ? 'create_plan' : 'open_coach'
  );
  const actionLabel =
    trimCoachText(parsedSuggestion.actionLabel, 24) ||
    (actionType === 'create_plan'
      ? 'Build plan'
      : actionType === 'open_coach'
        ? 'Open coach'
        : 'Continue');
  const suggestionText = trimCoachText(parsedSuggestion.text, 120) || fallback.suggestion.text;
  const mood =
    parsed?.mood === 'challenging' || parsed?.mood === 'celebratory' ? parsed.mood : ('encouraging' as const);

  // Extract entityDraft if present from the LLM response
  let entityDraft: CoachEntityDraft | null | undefined = undefined;
  if (parsed?.entityDraft && typeof parsed.entityDraft === 'object') {
    const draft = parsed.entityDraft;
    const validEntities = ['task', 'habit', 'goal', 'project'];
    if (
      validEntities.includes(draft.entity) &&
      typeof draft.title === 'string' &&
      draft.title.trim() &&
      typeof draft.fields === 'object' &&
      draft.fields !== null
    ) {
      entityDraft = {
        entity: draft.entity as 'task' | 'habit' | 'goal' | 'project',
        title: draft.title.trim(),
        fields: draft.fields as Record<string, string | null>,
      };
    }
  }

  return {
    title: trimCoachText(parsed?.title, 40) || fallback.title,
    message: trimCoachText(parsed?.message, 240) || fallback.message,
    suggestion: {
      text: suggestionText,
      actionLabel,
      actionType,
    },
    mood,
    planPrompt: trimCoachText(parsed?.planPrompt, 220),
    entityDraft,
    source: 'ai',
  };
}

export async function generateAICoach(
  userId: string,
  data: CoachPromptData
): Promise<AICoachResult> {
  if (!isAIAvailable()) {
    return buildFallbackCoachResult(data);
  }

  // Vision responses need more tokens — the model describes the image before
  // producing the JSON, so the tight 160-token chat cap causes truncated/invalid JSON.
  const hasImages = Boolean(data.imageUrls && data.imageUrls.length > 0);
  const chatTokens = hasImages ? 400 : 160;

  const response = await complete({
    systemPrompt: COACH_SYSTEM_PROMPT,
    userPrompt: buildCoachUserPrompt(data),
    imageUrls: data.imageUrls,
    maxTokens: data.mode === 'chat' ? chatTokens : 192,
    temperature: data.mode === 'chat' ? 0.65 : 0.45,
    responseFormat: 'json_object',
  });

  if (!response) {
    return buildFallbackCoachResult(data);
  }

  try {
    const parsed = JSON.parse(response.content);
    const normalized = normalizeCoachResult(parsed, emptyCoachResult());
    void recordTokenUsage(userId, response.usage?.totalTokens ?? 0);
    return normalized;
  } catch (e) {
    console.warn('[AI] Failed to parse coach JSON:', e);
    return buildFallbackCoachResult(data);
  }
}

// ─── Daily Brief ──────────────────────────────────────────────────────────────

export interface AIDailyBriefResult {
  greeting: string;
  summary: string;
  priorities: string[];
  focusTip: string;
  motivation: string;
  source: 'ai' | 'fallback';
}

export async function generateDailyBrief(
  userId: string,
  data: Parameters<typeof buildDailyBriefUserPrompt>[0]
): Promise<AIDailyBriefResult> {
  if (!isAIAvailable()) {
    return {
      greeting: 'Good day',
      summary: '',
      priorities: [],
      focusTip: '',
      motivation: '',
      source: 'fallback',
    };
  }

  const response = await complete({
    systemPrompt: DAILY_BRIEF_SYSTEM_PROMPT,
    userPrompt: buildDailyBriefUserPrompt(data),
    maxTokens: 300,
    temperature: 0.7,
    responseFormat: 'json_object',
  });

  if (!response) {
    return {
      greeting: 'Good day',
      summary: '',
      priorities: [],
      focusTip: '',
      motivation: '',
      source: 'fallback',
    };
  }

  try {
    const parsed = JSON.parse(response.content);
    void recordTokenUsage(userId, response.usage?.totalTokens ?? 0);
    return {
      greeting: parsed.greeting || 'Good day',
      summary: parsed.summary || '',
      priorities: parsed.priorities || [],
      focusTip: parsed.focusTip || '',
      motivation: parsed.motivation || '',
      source: 'ai',
    };
  } catch (e) {
    console.warn('[AI] Failed to parse daily brief JSON:', e);
    return {
      greeting: 'Good day',
      summary: '',
      priorities: [],
      focusTip: '',
      motivation: '',
      source: 'fallback',
    };
  }
}

// ─── Journal Analysis ─────────────────────────────────────────────────────────

export interface AIJournalAnalysisResult {
  mood: 'positive' | 'neutral' | 'negative' | 'mixed';
  moodLabel: string;
  themes: string[];
  insight: string;
  reflectionPrompt: string;
  source: 'ai' | 'fallback';
}

export async function analyzeJournalEntry(userId: string, entry: string): Promise<AIJournalAnalysisResult> {
  if (!isAIAvailable()) {
    return {
      mood: 'neutral',
      moodLabel: 'Reflective',
      themes: [],
      insight: '',
      reflectionPrompt: '',
      source: 'fallback',
    };
  }

  const response = await complete({
    systemPrompt: JOURNAL_ANALYSIS_SYSTEM_PROMPT,
    userPrompt: buildJournalEntryPrompt(entry),
    maxTokens: 300,
    temperature: 0.7,
    responseFormat: 'json_object',
  });

  if (!response) {
    return {
      mood: 'neutral',
      moodLabel: 'Reflective',
      themes: [],
      insight: '',
      reflectionPrompt: '',
      source: 'fallback',
    };
  }

  try {
    const parsed = JSON.parse(response.content);
    void recordTokenUsage(userId, response.usage?.totalTokens ?? 0);
    return {
      mood: parsed.mood || 'neutral',
      moodLabel: parsed.moodLabel || 'Reflective',
      themes: parsed.themes || [],
      insight: parsed.insight || '',
      reflectionPrompt: parsed.reflectionPrompt || '',
      source: 'ai',
    };
  } catch (e) {
    console.warn('[AI] Failed to parse journal analysis JSON:', e);
    return {
      mood: 'neutral',
      moodLabel: 'Reflective',
      themes: [],
      insight: '',
      reflectionPrompt: '',
      source: 'fallback',
    };
  }
}

export interface AIJournalWeeklyResult {
  overallMood: 'positive' | 'neutral' | 'negative' | 'mixed';
  moodTrend: string;
  keyThemes: string[];
  summary: string;
  insight: string;
  suggestion: string;
  source: 'ai' | 'fallback';
}

export async function analyzeJournalWeek(
  userId: string,
  entries: Array<{ date: string; content: string; mood?: string }>
): Promise<AIJournalWeeklyResult> {
  if (!isAIAvailable() || entries.length === 0) {
    return {
      overallMood: 'neutral',
      moodTrend: '',
      keyThemes: [],
      summary: '',
      insight: '',
      suggestion: '',
      source: 'fallback',
    };
  }

  const response = await complete({
    systemPrompt: JOURNAL_WEEKLY_SYSTEM_PROMPT,
    userPrompt: buildJournalWeeklyPrompt(entries),
    maxTokens: 320,
    temperature: 0.7,
    responseFormat: 'json_object',
  });

  if (!response) {
    return {
      overallMood: 'neutral',
      moodTrend: '',
      keyThemes: [],
      summary: '',
      insight: '',
      suggestion: '',
      source: 'fallback',
    };
  }

  try {
    const parsed = JSON.parse(response.content);
    void recordTokenUsage(userId, response.usage?.totalTokens ?? 0);
    return {
      overallMood: parsed.overallMood || 'neutral',
      moodTrend: parsed.moodTrend || '',
      keyThemes: parsed.keyThemes || [],
      summary: parsed.summary || '',
      insight: parsed.insight || '',
      suggestion: parsed.suggestion || '',
      source: 'ai',
    };
  } catch (e) {
    console.warn('[AI] Failed to parse weekly journal JSON:', e);
    return {
      overallMood: 'neutral',
      moodTrend: '',
      keyThemes: [],
      summary: '',
      insight: '',
      suggestion: '',
      source: 'fallback',
    };
  }
}

// ─── Task Parser ──────────────────────────────────────────────────────────────

// ─── Goal Planner ───────────────────────────────────────────────────────────────

const GOAL_PLANNER_SYSTEM_PROMPT = `You are a goal planning assistant. Turn the user's prompt into a practical workspace plan.

TODAY: {{TODAY_DATE}} ({{DAY_NAME}}, tz: {{TIMEZONE}}). All dates MUST be >= {{TODAY_DATE}}.
Use {{TODAY_PLUS_2}} as the earliest task date. Space milestones toward targetDate.

Output ONLY valid JSON with this exact shape:
{
  "goal": { "title": "≤60 chars", "description": "2-3 sentences", "category": "Health|Career|Learning|Finance|Personal|Creative|Fitness|Relationships", "icon": "target", "color": "#4F46E5", "targetDate": "YYYY-MM-DD or null", "status": "ACTIVE", "priority": "LOW|MEDIUM|HIGH|CRITICAL" },
  "summary": "2-3 sentence executive summary",
  "milestones": [{ "title": "str", "description": "str", "dueDate": "YYYY-MM-DD", "sortOrder": 0 }],
  "tasks": [{ "title": "actionable verb phrase ≤60 chars", "description": "1-2 sentences", "priority": "LOW|MEDIUM|HIGH|CRITICAL", "dueDate": "YYYY-MM-DD or null", "dueTime": "HH:mm or null", "reminderTime": "HH:mm or null", "reminderMessage": "str or null", "estimatedDuration": 30 }],
  "habits": [{ "title": "str", "reminderTime": "HH:mm (required)", "reminderMessage": "≤80 chars (required)", "targetPerWeek": 5 }],
  "projects": [{ "name": "str", "description": "str", "status": "PLANNING", "color": "#4F46E5", "startDate": "YYYY-MM-DD or null", "dueDate": "YYYY-MM-DD or null" }]
}

Rules:
- 3-5 milestones, 4-7 tasks, 1-3 habits, 1-2 projects.
- Every date >= {{TODAY_DATE}}. First task dueDate >= {{TODAY_PLUS_2}}.
- project status: PLANNING|ACTIVE|ON_HOLD|COMPLETED|CANCELLED (not IN_PROGRESS).
- goal status: ACTIVE|COMPLETED|PAUSED|CANCELLED|ARCHIVED.
- habits: reminderTime and reminderMessage are required (never null). Morning habits → 07:00-09:00, evening → 19:00-21:00.
- tasks with dueTime: set reminderTime 30 min before.
- All dates YYYY-MM-DD, all times HH:mm 24-hour.
- If prompt is vague, infer a strong personal productivity goal.
`;


export function fallbackGoalPlan(prompt: string, todayDateStr?: string): GoalPlannerPlanDTO {
  const trimmed = prompt.trim();
  const headline = trimmed.split(/[.\n]/)[0]?.trim() || 'Goal';
  const title = headline.length > 70 ? `${headline.slice(0, 67).trimEnd()}...` : headline;
  const baseDescription = trimmed.length > 280 ? `${trimmed.slice(0, 277).trimEnd()}...` : trimmed;

  // Use the provided today date (user's local date) if available, otherwise fall back to server UTC
  const todayBase = todayDateStr ? new Date(`${todayDateStr}T00:00:00Z`) : new Date();

  const addDays = (days: number) => {
    const next = new Date(todayBase);
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString().slice(0, 10);
  };

  return {
    goal: {
      title,
      description: baseDescription || 'Auto-generated goal plan',
      category: 'Personal',
      icon: 'target',
      color: '#4F46E5',
      targetDate: addDays(45),
      status: 'ACTIVE',
      priority: 'MEDIUM',
    },
    summary: `Workspace generated from: ${title}`,
    milestones: [
      {
        title: 'Define scope',
        description: 'Clarify the outcome and success criteria.',
        dueDate: addDays(7),
        sortOrder: 0,
      },
      {
        title: 'Build momentum',
        description: 'Complete the first execution block.',
        dueDate: addDays(21),
        sortOrder: 1,
      },
      {
        title: 'Validate progress',
        description: 'Review blockers and adjust the plan.',
        dueDate: addDays(35),
        sortOrder: 2,
      },
      {
        title: 'Finish strong',
        description: 'Deliver the final result and close the loop.',
        dueDate: addDays(45),
        sortOrder: 3,
      },
    ],
    tasks: [
      {
        title: 'Break down the work',
        description: 'Turn the goal into clear execution steps.',
        priority: 'HIGH',
        dueDate: addDays(2),
        dueTime: '10:00',
        reminderTime: '09:30',
        reminderMessage: 'Time to plan — break the goal into steps.',
        estimatedDuration: 45,
      },
      {
        title: 'Gather required inputs',
        description: 'Collect notes, assets, or stakeholders needed to move forward.',
        priority: 'MEDIUM',
        dueDate: addDays(5),
        dueTime: null,
        reminderTime: null,
        reminderMessage: null,
        estimatedDuration: 60,
      },
      {
        title: 'Execute the first milestone',
        description: 'Make measurable progress on the plan.',
        priority: 'HIGH',
        dueDate: addDays(12),
        dueTime: '09:00',
        reminderTime: '08:30',
        reminderMessage: "Time to work on your milestone — let's do this.",
        estimatedDuration: 90,
      },
      {
        title: 'Review and refine',
        description: 'Check quality and tighten the plan.',
        priority: 'MEDIUM',
        dueDate: addDays(28),
        dueTime: null,
        reminderTime: null,
        reminderMessage: null,
        estimatedDuration: 45,
      },
    ],
    habits: [
      {
        title: 'Review goal progress',
        reminderTime: '08:00',
        reminderMessage: 'Take 5 minutes to review your goal progress.',
        targetPerWeek: 5,
      },
      {
        title: 'Deep work session',
        reminderTime: '09:00',
        reminderMessage: 'Protect this hour — focused work moves goals forward.',
        targetPerWeek: 4,
      },
    ],
    projects: [
      {
        name: `${title} workspace`,
        description: 'Primary project for this goal.',
        status: 'PLANNING',
        color: '#4F46E5',
        startDate: addDays(0),
        dueDate: addDays(45),
      },
    ],
    source: 'fallback',
  };
}

export interface GoalPlanDateContext {
  /** Today's date in YYYY-MM-DD format in the user's local timezone. */
  todayDate: string;
  /** Day name, e.g. "Monday". */
  dayName: string;
  /** IANA timezone string, e.g. "America/New_York". */
  timezone: string;
}

/** Build the resolved system prompt with today's date substituted in. */
function buildGoalPlannerPrompt(ctx: GoalPlanDateContext): string {
  const addDaysToDateStr = (dateStr: string, days: number): string => {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  return GOAL_PLANNER_SYSTEM_PROMPT.replace(/\{\{TODAY_DATE\}\}/g, ctx.todayDate)
    .replace(/\{\{DAY_NAME\}\}/g, ctx.dayName)
    .replace(/\{\{TIMEZONE\}\}/g, ctx.timezone)
    .replace(/\{\{TODAY_PLUS_2\}\}/g, addDaysToDateStr(ctx.todayDate, 2))
    .replace(/\{\{TODAY_PLUS_7\}\}/g, addDaysToDateStr(ctx.todayDate, 7));
}

export async function generateGoalPlan(
  userId: string,
  prompt: string,
  dateCtx?: GoalPlanDateContext
): Promise<GoalPlannerPlanDTO> {
  // Build a date context anchored to today if not provided (server's local date as fallback)
  const resolvedCtx: GoalPlanDateContext =
    dateCtx ??
    (() => {
      const now = new Date();
      const todayDate = now.toISOString().slice(0, 10);
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return { todayDate, dayName: dayNames[now.getUTCDay()], timezone: 'UTC' };
    })();

  if (!isAIAvailable()) {
    return fallbackGoalPlan(prompt, resolvedCtx.todayDate);
  }

  const response = await complete({
    systemPrompt: buildGoalPlannerPrompt(resolvedCtx),
    userPrompt: prompt,
    maxTokens: 1800,
    temperature: 0.6,
    responseFormat: 'json_object',
  });

  if (!response) {
    return fallbackGoalPlan(prompt, resolvedCtx.todayDate);
  }

  try {
    const parsed = JSON.parse(response.content);
    const fallback = fallbackGoalPlan(prompt, resolvedCtx.todayDate);

    // Clamp any dates the AI may have generated in the past to today
    const clampDate = (d: string | null | undefined): string | null => {
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return d ?? null;
      return d < resolvedCtx.todayDate ? resolvedCtx.todayDate : d;
    };

    const clampedGoal = parsed.goal ?? {};
    if (clampedGoal.targetDate) clampedGoal.targetDate = clampDate(clampedGoal.targetDate);

    const clampedMilestones =
      Array.isArray(parsed.milestones) && parsed.milestones.length > 0
        ? parsed.milestones.map((m: any) => ({ ...m, dueDate: clampDate(m.dueDate) }))
        : fallback.milestones;

    const clampedTasks =
      Array.isArray(parsed.tasks) && parsed.tasks.length > 0
        ? parsed.tasks.map((t: any) => ({ ...t, dueDate: clampDate(t.dueDate) }))
        : fallback.tasks;

    const clampedProjects =
      Array.isArray(parsed.projects) && parsed.projects.length > 0
        ? parsed.projects.map((p: any) => ({ ...p, startDate: clampDate(p.startDate), dueDate: clampDate(p.dueDate) }))
        : fallback.projects;

    void recordTokenUsage(userId, response.usage?.totalTokens ?? 0);
    return {
      goal: {
        ...fallback.goal,
        ...clampedGoal,
      },
      summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary : fallback.summary,
      milestones: clampedMilestones,
      tasks: clampedTasks,
      habits: Array.isArray(parsed.habits) && parsed.habits.length > 0 ? parsed.habits : fallback.habits,
      projects: clampedProjects,
      source: 'ai',
    };
  } catch (error) {
    console.warn('[AI] Failed to parse goal plan JSON:', error);
    return fallbackGoalPlan(prompt, resolvedCtx.todayDate);
  }
}

export interface AITaskParseResult {
  title: string;
  description?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  dueDate?: string; // YYYY-MM-DD
  dueTime?: string; // HH:mm (24-hour)
  reminderTime?: string; // HH:mm (24-hour)
  reminderMessage?: string;
  estimatedDuration?: number; // minutes
  status?: 'TODO' | 'IN_PROGRESS';
  recurrence?: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
  subTasks?: { title: string }[];
  source: 'ai' | 'fallback';
}

const TASK_PARSE_SYSTEM_PROMPT = `You are a task parser AI. Convert natural language into structured task data.

Today is {{DAY_NAME}}, {{TODAY_DATE}} (user timezone: {{TIMEZONE}}).

Output ONLY valid JSON with these fields:
{
  "title": "Task title (required, concise)",
  "description": "Task description (required, 1-3 short lines)",
  "priority": "LOW|MEDIUM|HIGH|CRITICAL",
  "dueDate": "YYYY-MM-DD or null",
  "dueTime": "HH:mm (24-hour format, e.g. 15:00) or null",
  "reminderTime": "HH:mm (24-hour format, e.g. 14:00) or null",
  "reminderMessage": "Custom reminder message text or null",
  "estimatedDuration": "number of minutes or null",
  "status": "TODO|IN_PROGRESS",
  "recurrence": "none|daily|weekly|biweekly|monthly|quarterly",
  "subTasks": [{"title": "subtask title"}, ...] or []
}

Rules:
- "dueDate" must be in YYYY-MM-DD format. Resolve relative dates using today's date in the user's timezone.
- Bare weekday names ("Saturday", "Friday") mean the upcoming occurrence this week (including today if today is that weekday).
- "next Saturday" / "next Monday" mean the weekday in the following week.
- If a resolved due date hint is provided in the user message, use that exact YYYY-MM-DD value.
- "dueTime" must be in 24-hour HH:mm format (e.g. 15:00 for 3pm, 09:30 for 9:30am). Only set if a time is mentioned.
- "reminderTime" must be in 24-hour HH:mm format. If user says "remind me 1 hour before" and a dueTime is set, subtract 1 hour from dueTime. If no dueTime, set the reminder to the mentioned time.
- "reminderMessage" is a custom message for the reminder notification. Use the user's own words if they describe what the reminder is for, otherwise leave null.
- "description" is REQUIRED. Write 1-3 short lines (max ~250 characters). Be concise and actionable. If the user gave extra context (e.g. "needs CEO review"), include it. Otherwise infer a brief helpful description from the task title — do not repeat the title verbatim and do not leave null.
- "estimatedDuration" in minutes (e.g. 2 hours = 120, 30 min = 30).
- "status" is "IN_PROGRESS" if user says they already started/began the task, otherwise "TODO".
- "recurrence" maps: "every day"/"daily" → "daily", "every week"/"weekly" → "weekly", "every two weeks"/"biweekly"/"fortnightly" → "biweekly", "every month"/"monthly" → "monthly", "every quarter"/"quarterly" → "quarterly". If no recurrence mentioned, use "none".
- "subTasks" is an array of {title} objects. Extract from phrases like "steps: ...", "subtasks: ...", or comma/numbered lists within the input. If none, return empty array [].
- "priority" defaults to "MEDIUM" unless words like "urgent", "critical", "high priority" (→ HIGH/CRITICAL) or "low priority", "whenever" (→ LOW) are used.

Examples:
- "Prepare quarterly report by Friday at 3pm, high priority, needs CEO review" → {"title":"Prepare quarterly report","description":"Needs CEO review.\\nFinalize figures and formatting before submission.","priority":"HIGH","dueDate":"2026-08-02","dueTime":"15:00","reminderTime":null,"reminderMessage":null,"estimatedDuration":null,"status":"TODO","recurrence":"none","subTasks":[]}
- "Buy groceries tomorrow at 5pm, remind me 1 hour before to get bags" → {"title":"Buy groceries","description":"Pick up groceries for the week.\\nBring reusable bags.","priority":"MEDIUM","dueDate":"2026-08-01","dueTime":"17:00","reminderTime":"16:00","reminderMessage":"Get bags","estimatedDuration":30,"status":"TODO","recurrence":"none","subTasks":[]}
- "Team meeting Saturday at 10am" → {"title":"Team meeting","description":"Sync with the team on progress and blockers.\\nCome prepared with updates.","priority":"MEDIUM","dueDate":"2026-08-01","dueTime":"10:00","reminderTime":null,"reminderMessage":null,"estimatedDuration":60,"status":"TODO","recurrence":"none","subTasks":[]}
- "Weekly team standup every week, already started, steps: prepare agenda, send invites" → {"title":"Weekly team standup","description":"Recurring team standup to align on priorities.","priority":"MEDIUM","dueDate":null,"dueTime":null,"reminderTime":null,"reminderMessage":null,"estimatedDuration":null,"status":"IN_PROGRESS","recurrence":"weekly","subTasks":[{"title":"Prepare agenda"},{"title":"Send invites"}]}
- "Buy groceries" → {"title":"Buy groceries","description":"Pick up groceries for the week.","priority":"MEDIUM","dueDate":null,"dueTime":null,"reminderTime":null,"reminderMessage":null,"estimatedDuration":30,"status":"TODO","recurrence":"none","subTasks":[]}`;

function limitDescription(description: string | null | undefined): string | undefined {
  if (!description?.trim()) return undefined;
  const lines = description
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (lines.length === 0) return undefined;
  const joined = lines.join('\n');
  if (joined.length <= 280) return joined;
  return `${joined.slice(0, 277).trimEnd()}...`;
}

export async function parseTaskFromNaturalLanguage(
  userId: string,
  input: string,
  options?: { timezone?: string }
): Promise<AITaskParseResult> {
  const timezone = options?.timezone || 'UTC';
  const parsedDueDate = extractDueDateFromText(input, timezone);

  if (!isAIAvailable()) {
    return {
      title: input,
      dueDate: parsedDueDate || undefined,
      source: 'fallback',
    };
  }

  const { dateKey, dayName } = getLocalDateContext(timezone);
  const systemPrompt = TASK_PARSE_SYSTEM_PROMPT.replace('{{TODAY_DATE}}', dateKey)
    .replace('{{DAY_NAME}}', dayName)
    .replace('{{TIMEZONE}}', timezone);

  const dueDateHint = parsedDueDate ? `\n\nResolved due date (use this exact value): ${parsedDueDate}` : '';
  const response = await complete({
    systemPrompt,
    userPrompt: `Parse this task: "${input}"${dueDateHint}`,
    maxTokens: 512,
    temperature: 0.3,
    responseFormat: 'json_object',
  });

  if (!response) {
    return {
      title: input,
      dueDate: parsedDueDate || undefined,
      source: 'fallback',
    };
  }

  try {
    const parsed = JSON.parse(response.content);
    const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const validStatuses = ['TODO', 'IN_PROGRESS'];
    const validRecurrences = ['none', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly'];

    void recordTokenUsage(userId, response.usage?.totalTokens ?? 0);
    return {
      title: parsed.title || input,
      description: limitDescription(parsed.description),
      priority: validPriorities.includes(parsed.priority) ? parsed.priority : undefined,
      dueDate: parsedDueDate || parsed.dueDate || undefined,
      dueTime: parsed.dueTime || undefined,
      reminderTime: parsed.reminderTime || undefined,
      reminderMessage: parsed.reminderMessage || undefined,
      estimatedDuration: typeof parsed.estimatedDuration === 'number' ? parsed.estimatedDuration : undefined,
      status: validStatuses.includes(parsed.status) ? parsed.status : undefined,
      recurrence: validRecurrences.includes(parsed.recurrence) ? parsed.recurrence : undefined,
      subTasks:
        Array.isArray(parsed.subTasks) && parsed.subTasks.length > 0
          ? parsed.subTasks.map((s: any) => ({ title: String(s.title || s) })).filter((s: any) => s.title)
          : undefined,
      source: 'ai',
    };
  } catch (e) {
    console.warn('[AI] Failed to parse task JSON:', e);
    return {
      title: input,
      dueDate: parsedDueDate || undefined,
      source: 'fallback',
    };
  }
}
