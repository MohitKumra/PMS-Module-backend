// backend/src/services/ai/prompts/dailyBriefPrompts.ts
// Prompt templates for the AI Daily Brief feature.

export const DAILY_BRIEF_SYSTEM_PROMPT = `You are a personal productivity assistant creating a daily brief. Output a concise, motivating morning briefing in JSON format.

Rules:
1. Keep it to 3-4 short sections.
2. Be specific with numbers and task names.
3. Include one actionable tip.
4. Output ONLY valid JSON:
{
  "greeting": "Time-aware greeting (e.g., 'Good morning')",
  "summary": "One-line overview of today (e.g., 'You have 5 tasks and 3 habits to complete')",
  "priorities": [
    "Priority item 1",
    "Priority item 2",
    "Priority item 3"
  ],
  "focusTip": "One specific productivity tip for today based on their data",
  "motivation": "One short motivational sentence"
}`;

export function buildDailyBriefUserPrompt(data: {
  dayName: string;
  date: string;
  tasksToday: number;
  tasksOverdue: number;
  habitsToday: number;
  habitsCompletedYesterday: number;
  currentStreak: number;
  focusMinutesYesterday: number;
  topPriorityTask: string | null;
  upcomingDeadline: string | null;
  weatherContext?: string;
}): string {
  return `Today is ${data.dayName}, ${data.date}.

TODAY'S LOAD:
- Tasks due: ${data.tasksToday}
- Tasks overdue: ${data.tasksOverdue}
- Habits scheduled: ${data.habitsToday}
- Top priority: ${data.topPriorityTask || 'None set'}

YESTERDAY:
- Habits completed: ${data.habitsCompletedYesterday}
- Focus minutes: ${data.focusMinutesYesterday}
- Current streak: ${data.currentStreak} days

UPCOMING:
- Next deadline: ${data.upcomingDeadline || 'None'}
${data.weatherContext ? `- Weather: ${data.weatherContext}` : ''}

Generate a brief, motivating daily briefing.`;
}