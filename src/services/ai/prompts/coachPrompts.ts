// backend/src/services/ai/prompts/coachPrompts.ts
// Prompt templates for the AI Coach feature.

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

export interface CoachPromptData {
  mode?: 'summary' | 'chat';
  completedToday: number;
  totalHabits: number;
  currentStreak: number;
  longestStreak: number;
  tasksCompleted: number;
  tasksOverdue: number;
  focusMinutesToday: number;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  recentActivity: string;
  session: CoachSessionSnapshot;
  goals: CoachGoalSnapshot[];
  habits: CoachHabitSnapshot[];
  milestones: CoachMilestoneSnapshot[];
  conversation?: CoachConversationTurn[];
  /** Image URLs from the current user message — forwarded to the LLM as vision content blocks */
  imageUrls?: string[];
}

function cleanSnippet(text: string, maxLength: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export const COACH_SYSTEM_PROMPT = `You are a warm, natural productivity coach.

Sound like a real chat partner, not a dashboard or status report.
Use only the JSON payload from the user.
Do not invent data.
Use the session memory, recent turns, and database snapshot as background only.
Be specific, honest, encouraging, and conversational.
Vary your openings and sentence structure so replies do not sound templated.
If the user is vague, answer with a short human response and one helpful follow-up question.
When mentioning metrics, use at most one relevant stat and do not repeat the full snapshot.
Do not repeat the previous assistant phrasing or summarize the same data every turn.
Keep the reply short, practical, and human.

Return valid JSON only:
{
  "title": "2-5 words",
  "message": "1-3 short sentences, max 40 words",
  "suggestion": {
    "text": "One concrete next step",
    "actionLabel": "Short button label",
    "actionType": "open_habits|open_tasks|open_goals|open_focus|open_dashboard|open_coach|create_plan"
  },
  "mood": "encouraging|challenging|celebratory",
  "planPrompt": "Short goal-planner prompt or empty string"
}

Rules:
- Use the snapshot values exactly as given.
- In chat mode, rely on the recent conversation for continuity and avoid replaying the full session summary.
- If the user says hello or gives very little context, respond naturally and invite them to continue instead of reciting stats.
- If the user is ready to plan, set actionType to "create_plan" and fill planPrompt.
- If the best next move is to open an app section, choose the matching actionType.
- Keep actionLabel very short.
- Keep planPrompt short, concrete, and focused on the user's actual request.
- Mention the most relevant habit, milestone, or goal by name when it helps the user move forward, but keep it to one.`;

export function buildCoachUserPrompt(data: CoachPromptData): string {
  const mode = data.mode ?? (data.conversation?.length ? 'chat' : 'summary');
  const isChatMode = mode === 'chat';

  // In chat mode send only the numbers the coach needs; the conversation
  // already carries the full context so shipping goals/habits/milestones
  // arrays wastes ~200 prompt tokens per turn.
  const snapshot = isChatMode
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

  const payload: Record<string, unknown> = {
    mode,
    session: {
      title: cleanSnippet(data.session.title, 48),
      // Summary is only useful on the first (summary) call; skip in chat to save tokens
      summary: isChatMode ? '' : cleanSnippet(data.session.summary, 220),
      messageCount: data.session.messageCount,
    },
    snapshot,
    // Keep last 4 turns (was 6) — beyond that the model has diminishing returns
    // and each extra turn costs ~50–80 tokens
    conversation: (data.conversation ?? []).slice(-4).map((turn) => ({
      role: turn.role,
      content: cleanSnippet(turn.content, 120), // was 180
    })),
  };

  // Only attach the full arrays in summary mode
  if (!isChatMode) {
    payload.goals = data.goals.slice(0, 3).map((goal) => ({
      title: cleanSnippet(goal.title, 60),
      progress: goal.progress,
      status: goal.status,
      targetDate: goal.targetDate,
      nextMilestone: cleanSnippet(goal.nextMilestoneTitle ?? '', 60) || null,
    }));
    payload.habits = data.habits.slice(0, 4).map((habit) => ({
      title: cleanSnippet(habit.title, 60),
      streak: habit.currentStreak,
      doneToday: habit.completedToday,
      doneThisWeek: `${habit.completionsThisWeek}/${habit.targetPerWeek}`,
    }));
    payload.milestones = data.milestones.slice(0, 3).map((milestone) => ({
      goal: cleanSnippet(milestone.goalTitle, 60),
      title: cleanSnippet(milestone.title, 60),
      dueDate: milestone.dueDate,
    }));
  }

  return JSON.stringify(payload);
}
