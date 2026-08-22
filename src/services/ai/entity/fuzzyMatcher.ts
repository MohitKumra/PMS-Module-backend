// backend/src/services/ai/entity/fuzzyMatcher.ts
// Deterministic typo / token matching for entity references. Zero LLM cost.
// Handles: normalization, common spelling errors, token overlap, and basic
// Levenshtein distance. Returns 0..1 similarity scores.

import type { EntityMatch } from './entityTypes';

/** Normalize a single string for comparison. */
export function normalizeText(value: string): string {
  let s = String(value ?? '')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  // Collapse internal whitespace and drop punctuation that separates words.
  s = s.replace(/[^a-z0-9\s-]/g, ' ').replace(/[-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

/** Split into meaningful (non-stopword) tokens. */
const STOP_WORDS = new Set([
  'i', 'me', 'my', 'mine', 'you', 'your', 'the', 'a', 'an', 'and', 'or', 'to',
  'for', 'of', 'in', 'on', 'at', 'with', 'is', 'are', 'was', 'be', 'it', 'this',
  'that', 'do', 'does', 'did', 'should', 'would', 'will', 'can', 'could',
  'please', 'just', 'about', 'what', 'which', 'how', 'finish', 'complete',
  'mark', 'move', 'delete', 'remove', 'schedule', 'reschedule', 'update',
  'make', 'create', 'find', 'tell', 'show', 'need', 'want', 'task', 'tasks',
]);

export function contentTokens(value: string): string[] {
  return normalizeText(value).split(/\s+/).filter(Boolean).filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Levenshtein distance between two strings (capped for performance).
 */
export function levenshtein(a: string, b: string, cap = 4): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return curr[b.length];
}

/** Common spelling errors that survive normalization (spec §11). */
const TYPO_MAP: Record<string, string> = {
  presenation: 'presentation',
  presenaton: 'presentation',
  presention: 'presentation',
  landig: 'landing',
  landgin: 'landing',
  landding: 'landing',
  mobil: 'mobile',
  nav: 'navigation',
  reprot: 'report',
  rept: 'report',
  calender: 'calendar',
  calandar: 'calendar',
  meetng: 'meeting',
  meetin: 'meeting',
  tmrw: 'tomorrow',
  tmr: 'tomorrow',
  tommorow: 'tomorrow',
  tomorow: 'tomorrow',
  tomoro: 'tomorrow',
  tdy: 'today',
};

/** Apply the typo map to the reference tokens before scoring. */
export function correctTypos(ref: string, map: Record<string, string> = TYPO_MAP): string {
  return ref
    .split(/\s+/)
    .map((token) => map[token] ?? token)
    .join(' ');
}

/** A scored candidate result. */
export interface ScoredMatch {
  id: string;
  title: string;
  score: number;
}

function scorePair(refNorm: string, titleNorm: string): number {
  if (refNorm === titleNorm) return 1;
  // Character-level similarity via Levenshtein (handles single-word typos).
  if (refNorm.length <= 24 && titleNorm.length <= 24 && !refNorm.includes(' ')) {
    const dist = levenshtein(refNorm, titleNorm);
    const max = Math.max(refNorm.length, titleNorm.length);
    const ratio = 1 - dist / max;
    if (dist <= 2 && ratio >= 0.7) return Math.max(0.55, ratio);
  }
  // Token overlap.
  const refTokens = contentTokens(refNorm);
  const titleTokens = contentTokens(titleNorm);
  if (refTokens.length === 0 || titleTokens.length === 0) return 0;
  let hits = 0;
  for (const t of refTokens) {
    if (titleTokens.includes(t)) hits += 1;
    else {
      // fuzzy token match
      const matched = titleTokens.some((tt) => {
        if (Math.abs(tt.length - t.length) > 2) return false;
        return levenshtein(tt, t, 2) <= 1;
      });
      if (matched) hits += 0.9;
    }
  }
  return hits / refTokens.length;
}

/**
 * Rank candidate entities by similarity to a (possibly misspelled) reference.
 * Also returns a per-sequence typo-corrected score using the TYPO_MAP.
 */
export function matchCandidates(
  reference: string,
  candidates: EntityMatch[],
): ScoredMatch[] {
  const correctedRef = correctTypos(reference);
  const refNorm = normalizeText(correctedRef);
  if (!refNorm) return [];

  const scored = candidates
    .map((c) => ({
      id: c.id,
      title: c.title,
      score: scorePair(refNorm, normalizeText(c.title)),
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored;
}

/** Exact (after normalization) single-match lookup. */
export function exactMatch(reference: string, candidates: EntityMatch[]): EntityMatch | null {
  const refNorm = normalizeText(reference);
  if (!refNorm) return null;
  const hits = candidates.filter((c) => normalizeText(c.title) === refNorm);
  return hits.length === 1 ? hits[0] : null;
}

/** Normalized prefix match (e.g. "the investor" → "Finish the investor ..."). */
export function prefixMatch(reference: string, candidates: EntityMatch[]): EntityMatch[] {
  const refNorm = normalizeText(reference);
  if (!refNorm) return [];
  return candidates
    .filter((c) => normalizeText(c.title).includes(refNorm) || normalizeText(c.title).startsWith(refNorm))
    .map((c) => ({ ...c }));
}