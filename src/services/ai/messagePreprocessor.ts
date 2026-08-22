// backend/src/services/ai/messagePreprocessor.ts
// Normalizes and extracts signals from a raw user message (spec §6). Never
// mutates the user's original message.

import { extractDueDateFromText } from './taskDateParser';

export interface PreprocessedMessage {
  rawMessage: string;
  normalizedMessage: string;
  /** YYYY-MM-DD resolved deterministically (chrono + abbreviations). */
  extractedDate?: string;
  /** HH:mm when a time phrase is present (not fully wired in Phase 1–3). */
  extractedTime?: string;
  /** Ordered reference phrases the message may point at. */
  references: string[];
}

/** Curly-quote + unicode + whitespace normalization (spec §6). */
export function normalizeMessage(raw: string): string {
  let s = String(raw ?? '')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  // Expand common colloquial date abbreviations before chrono parsing.
  s = ` ${s} `;
  s = s
    .replace(/\b(tmrw|tmr|tommorow|tomorow|tomoro)\b/g, ' tomorrow ')
    .replace(/\b(tdy|2day)\b/g, ' today ')
    .replace(/\btngiht\b|tonite/g, ' tonight ');
  return s.replace(/\s+/g, ' ').trim();
}

const DATE_PHRASES =
  /\b(today|tomorrow|tonight|this (evening|weekend|week|morning|afternoon|evening|night)|next (week|weekend|month|friday|monday|tuesday|wednesday|thursday|saturday|sunday|\w+)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|in \d+ days?|by \w+|before \w+))\b/g;

const LEADING_ACTIONS =
  /^(finish|complete|mark|move|delete|remove|do|schedule|reschedule|update|make|create|find|tell|show|call|email|remind me to|actually|please)\s+/gi;

const TRAILING_DATES = /(\s*(today|tomorrow|tonight|now|this week|next week|this weekend|next weekend|this evening|this afternoon|this morning|tonight|tonite))\s*$/i;

const STOP_WORDS = new Set([
  'i', 'me', 'my', 'you', 'your', 'the', 'a', 'an', 'and', 'or', 'to', 'for',
  'of', 'in', 'on', 'at', 'with', 'is', 'are', 'was', 'be', 'it', 'do', 'does',
  'did', 'should', 'about', 'that', 'this', 'task', 'tasks', 'habit', 'habits',
  'goal', 'goals', 'project', 'projects', 'me', 'with', 'from', 'by',
]);

/** Extract the most likely entity reference phrase (spec §6 reference detection). */
export function extractReferencePhrase(normalized: string): string | null {
  let s = normalized
    .replace(DATE_PHRASES, ' ')
    // Collapse date/time phrases left in the middle too.
    .replace(/\btmrw\b|\btomorrow\b|\btoday\b|\btonight\b/g, ' ')
    .trim();

  // Remove leading action verbs.
  s = s.replace(LEADING_ACTIONS, '').trim();
  // Remove trailing date/time phrases.
  s = s.replace(TRAILING_DATES, '').trim();

  // Remove leading stop words to shorten to the core reference.
  const words = s.split(/\s+/);
  while (words.length > 0 && STOP_WORDS.has(words[0])) words.shift();
  while (words.length > 0 && STOP_WORDS.has(words[words.length - 1])) words.pop();

  const out = words.join(' ').trim();
  return out.length > 0 ? out : null;
}

export function preprocessMessage(
  rawMessage: string,
  timezone: string = 'UTC',
): PreprocessedMessage {
  const normalizedMessage = normalizeMessage(rawMessage);
  const extractedDate = extractDueDateFromText(normalizedMessage, timezone);

  // A light time heuristic — keep simple and deterministic.
  let extractedTime: string | undefined;
  const timeMatch = normalizedMessage.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3] ? timeMatch[3].toLowerCase() : '';
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    extractedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const references = [extractReferencePhrase(normalizedMessage)]
    .filter((r): r is string => Boolean(r));

  return {
    rawMessage,
    normalizedMessage,
    ...(extractedDate ? { extractedDate } : {}),
    ...(extractedTime ? { extractedTime } : {}),
    references,
  };
}