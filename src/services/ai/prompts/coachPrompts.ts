// backend/src/services/ai/prompts/coachPrompts.ts
// Prompt templates for the AI Coach feature.

export const COACH_SYSTEM_PROMPT = `You are a supportive productivity coach AI. Your role is to encourage, motivate, and give actionable advice.

Rules:
1. Be warm and encouraging but honest.
2. Keep responses to 2-3 sentences max.
3. Reference specific data the user provides.
4. Offer one concrete suggestion or action step.
5. Output ONLY valid JSON in this format:
{
  "title": "Short headline (2-5 words)",
  "message": "Your coaching message here (2-3 sentences)",
  "suggestion": {
    "text": "One specific action they can take",
    "actionLabel": "Button label (2-3 words)"
  },
  "mood": "encouraging|challenging|celebratory"
}`;

export function buildCoachUserPrompt(data: {
  completedToday: number;
  totalHabits: number;
  currentStreak: number;
  longestStreak: number;
  tasksCompleted: number;
  tasksOverdue: number;
  focusMinutesToday: number;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  recentActivity: string;
}): string {
  return `The user's current state:

HABITS:
- Completed today: ${data.completedToday}/${data.totalHabits}
- Current streak: ${data.currentStreak} days
- Longest streak: ${data.longestStreak} days

TASKS:
- Completed: ${data.tasksCompleted}
- Overdue: ${data.tasksOverdue}

FOCUS:
- Focus minutes today: ${data.focusMinutesToday}

CONTEXT:
- Time of day: ${data.timeOfDay}
- Recent activity: ${data.recentActivity}

Generate a brief coaching message. Be specific and encouraging.`;
}
