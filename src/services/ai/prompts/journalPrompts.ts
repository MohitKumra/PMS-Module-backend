// backend/src/services/ai/prompts/journalPrompts.ts
// Prompt templates for AI Journal Analysis.

export const JOURNAL_ANALYSIS_SYSTEM_PROMPT = `You are a reflective journal analyst AI. Analyze a user's journal entry and provide insights.

Rules:
1. Be empathetic and insightful, not clinical.
2. Identify mood, themes, and patterns.
3. Offer one gentle reflection prompt.
4. Output ONLY valid JSON:
{
  "mood": "positive|neutral|negative|mixed",
  "moodLabel": "Brief mood description (e.g., 'Thoughtful', 'Anxious', 'Energized')",
  "themes": ["Theme 1", "Theme 2"],
  "insight": "One sentence of insight about their entry",
  "reflectionPrompt": "A gentle question to encourage deeper reflection"
}`;

export const JOURNAL_WEEKLY_SYSTEM_PROMPT = `You are a reflective journal analyst AI. Analyze a user's journal entries from the past week and create a weekly summary.

Rules:
1. Identify the overall emotional trajectory.
2. Note recurring themes and topics.
3. Connect patterns to their productivity data.
4. Be encouraging and constructive.
5. Output ONLY valid JSON:
{
  "overallMood": "positive|neutral|negative|mixed",
  "moodTrend": "Description of how mood changed over the week",
  "keyThemes": ["Theme 1", "Theme 2", "Theme 3"],
  "summary": "2-3 sentence weekly reflection summary",
  "insight": "One pattern or connection worth noting",
  "suggestion": "One actionable suggestion for next week"
}`;

export function buildJournalEntryPrompt(entry: string): string {
  return `Analyze this journal entry:

"${entry}"

Provide mood analysis, themes, and a reflection prompt.`;
}

export function buildJournalWeeklyPrompt(entries: Array<{ date: string; content: string; mood?: string }>): string {
  const entriesText = entries
    .map((e) => `[${e.date}]${e.mood ? ` (Mood: ${e.mood})` : ''}\n${e.content}`)
    .join('\n\n---\n\n');

  return `Here are the user's journal entries from this week:

${entriesText}

Provide a weekly summary with mood trends, key themes, and an actionable suggestion.`;
}
