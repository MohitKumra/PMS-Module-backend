// backend/src/services/ai/aiService.ts
// Main AI service that orchestrates all AI-powered features.
// Each method has a fallback to the existing rule-based system if AI is unavailable.

import { complete, isAIAvailable, getAIProvider, getAIModel } from './aiClient';
import { extractDueDateFromText, getLocalDateContext } from './taskDateParser';
import { INSIGHT_SYSTEM_PROMPT, buildInsightUserPrompt } from './prompts/insightPrompts';
import { COACH_SYSTEM_PROMPT, buildCoachUserPrompt } from './prompts/coachPrompts';
import { DAILY_BRIEF_SYSTEM_PROMPT, buildDailyBriefUserPrompt } from './prompts/dailyBriefPrompts';
import { JOURNAL_ANALYSIS_SYSTEM_PROMPT, JOURNAL_WEEKLY_SYSTEM_PROMPT, buildJournalEntryPrompt, buildJournalWeeklyPrompt } from './prompts/journalPrompts';
import type { InsightDTO } from '../../types';

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

export async function generateAIInsights(data: Parameters<typeof buildInsightUserPrompt>[0]): Promise<AIInsightResult> {
  if (!isAIAvailable()) {
    return { insights: [], source: 'fallback' };
  }

  const response = await complete({
    systemPrompt: INSIGHT_SYSTEM_PROMPT,
    userPrompt: buildInsightUserPrompt(data),
    maxTokens: 1024,
    temperature: 0.7,
    responseFormat: 'json_object',
  });

  if (!response) {
    return { insights: [], source: 'fallback' };
  }

  try {
    const parsed = JSON.parse(response.content);
    if (parsed.insights && Array.isArray(parsed.insights)) {
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

export interface AICoachResult {
  title: string;
  message: string;
  suggestion: { text: string; actionLabel: string };
  mood: 'encouraging' | 'challenging' | 'celebratory';
  source: 'ai' | 'fallback';
}

export async function generateAICoach(data: Parameters<typeof buildCoachUserPrompt>[0]): Promise<AICoachResult> {
  if (!isAIAvailable()) {
    return { title: '', message: '', suggestion: { text: '', actionLabel: '' }, mood: 'encouraging', source: 'fallback' };
  }

  const response = await complete({
    systemPrompt: COACH_SYSTEM_PROMPT,
    userPrompt: buildCoachUserPrompt(data),
    maxTokens: 512,
    temperature: 0.8,
    responseFormat: 'json_object',
  });

  if (!response) {
    return { title: '', message: '', suggestion: { text: '', actionLabel: '' }, mood: 'encouraging', source: 'fallback' };
  }

  try {
    const parsed = JSON.parse(response.content);
    return {
      title: parsed.title || 'Coach says',
      message: parsed.message || '',
      suggestion: parsed.suggestion || { text: '', actionLabel: '' },
      mood: parsed.mood || 'encouraging',
      source: 'ai',
    };
  } catch (e) {
    console.warn('[AI] Failed to parse coach JSON:', e);
    return { title: '', message: '', suggestion: { text: '', actionLabel: '' }, mood: 'encouraging', source: 'fallback' };
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

export async function generateDailyBrief(data: Parameters<typeof buildDailyBriefUserPrompt>[0]): Promise<AIDailyBriefResult> {
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
    maxTokens: 512,
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

export async function analyzeJournalEntry(entry: string): Promise<AIJournalAnalysisResult> {
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
    maxTokens: 512,
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

export async function analyzeJournalWeek(entries: Array<{ date: string; content: string; mood?: string }>): Promise<AIJournalWeeklyResult> {
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
    maxTokens: 512,
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
  input: string,
  options?: { timezone?: string },
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
      subTasks: Array.isArray(parsed.subTasks) && parsed.subTasks.length > 0
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
