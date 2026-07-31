// Deterministic date extraction from natural language task input.
// Used alongside LLM parsing so weekday names like "Saturday" resolve correctly.

import * as chrono from 'chrono-node';

function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

/** Wall-clock "now" in the user's timezone, used as chrono's reference date. */
function referenceDateInTimeZone(timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  const hour = get('hour') % 24;

  return new Date(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
}

export interface LocalDateContext {
  dateKey: string;
  dayName: string;
}

export function getLocalDateContext(timeZone: string): LocalDateContext {
  const now = new Date();
  return {
    dateKey: dateKeyInTimeZone(now, timeZone),
    dayName: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(now),
  };
}

/**
 * Extract a due date (YYYY-MM-DD) from natural language text.
 * Returns null when no date phrase is found.
 */
export function extractDueDateFromText(text: string, timeZone: string): string | null {
  const ref = referenceDateInTimeZone(timeZone);
  const results = chrono.parse(text, ref, { forwardDate: true });
  if (results.length === 0) return null;

  const parsed = results[0].start.date();
  const dateKey = dateKeyInTimeZone(parsed, timeZone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  return dateKey;
}
