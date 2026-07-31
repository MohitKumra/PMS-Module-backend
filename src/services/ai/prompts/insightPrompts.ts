// backend/src/services/ai/prompts/insightPrompts.ts
// Prompt templates for generating productivity insights from user data.

export const INSIGHT_SYSTEM_PROMPT = `You are a productivity analyst AI. Your job is to analyze a user's productivity data and generate 3-6 concise, actionable insights.

Rules:
1. Each insight must be 1-2 sentences, specific and data-driven.
2. Vary the tone — some encouraging, some gently challenging, some neutral observations.
3. NEVER say "great job" when metrics are zero or low. Be honest but constructive.
4. Include specific numbers (percentages, counts, streaks) where relevant.
5. Each insight must have a type: "positive", "neutral", or "warning".
6. Each insight must have an icon: "trend", "clock", "calendar", or "alert".
7. Output ONLY valid JSON in this exact format:
{
  "insights": [
    {
      "id": "unique-string-id",
      "type": "positive|neutral|warning",
      "icon": "trend|clock|calendar|alert",
      "text": "Your insight sentence here."
    }
  ]
}

Focus on cross-module patterns. For example: "You completed 40% more tasks on days you meditated" or "Your focus time drops on days with 3+ meetings scheduled."`;

export function buildInsightUserPrompt(data: {
  tasksCompleted: number;
  tasksTotal: number;
  taskCompletionRate: number;
  tasksOverdue: number;
  tasksDueSoon: number;
  habitsCompletedToday: number;
  habitsTotal: number;
  currentHabitStreak: number;
  longestHabitStreak: number;
  focusMinutesTotal: number;
  focusSessionsTotal: number;
  productivityScore: number;
  weeklyTaskTrend: string;
  weeklyFocusTrend: string;
  journalDaysThisWeek: number;
  upcomingDeadlines: number;
  hasProjects: boolean;
}): string {
  return `Here is the user's productivity data for today:

TASKS:
- Completed: ${data.tasksCompleted} / ${data.tasksTotal} (${data.taskCompletionRate}% rate)
- Overdue: ${data.tasksOverdue}
- Due in next 24h: ${data.tasksDueSoon}
- Weekly task trend: ${data.weeklyTaskTrend}

HABITS:
- Completed today: ${data.habitsCompletedToday} / ${data.habitsTotal}
- Current streak: ${data.currentHabitStreak} days
- Longest streak: ${data.longestHabitStreak} days

FOCUS:
- Total focus minutes: ${data.focusMinutesTotal}
- Total sessions: ${data.focusSessionsTotal}
- Weekly focus trend: ${data.weeklyFocusTrend}

JOURNAL:
- Days journaled this week: ${data.journalDaysThisWeek} / 7

PROJECTS:
- Active projects: ${data.hasProjects ? 'Yes' : 'None'}
- Upcoming deadlines: ${data.upcomingDeadlines}

OVERALL:
- Productivity score: ${data.productivityScore}/100

Generate 3-6 insights based on this data. Be specific, honest, and actionable.`;
}