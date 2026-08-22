import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  exactMatch,
  matchCandidates,
  correctTypos,
  levenshtein,
} from '../../src/services/ai/entity/fuzzyMatcher';

const CANDIDATES = [
  { id: 'task_1', title: 'Prepare investor presentation' },
  { id: 'task_2', title: 'Fix mobile navigation' },
  { id: 'task_3', title: 'Finish landing page' },
];

describe('normalizeText', () => {
  it('normalizes case, punctuation, whitespace, unicode', () => {
    expect(normalizeText('  Landing-Page! ')).toBe('landing page');
    expect(normalizeText('Caf\u00e9')).toBe('cafe');
  });
});

describe('exactMatch', () => {
  it('matches a single normalized title', () => {
    const hit = exactMatch('Finish landing page', CANDIDATES);
    expect(hit?.id).toBe('task_3');
  });
});

describe('correctTypos', () => {
  it('fixes common spelling errors', () => {
    expect(correctTypos('presenation')).toBe('presentation');
    expect(correctTypos('landig')).toBe('landing');
    expect(correctTypos('reprot')).toBe('report');
    expect(correctTypos('calender')).toBe('calendar');
    expect(correctTypos('meetng')).toBe('meeting');
  });
});

describe('matchCandidates', () => {
  it('resolves a single-typo reference to the right task (spec §11)', () => {
    const scored = matchCandidates('presenation', CANDIDATES);
    expect(scored[0].id).toBe('task_1');
    expect(scored[0].score).toBeGreaterThanOrEqual(0.9);
  });

  it('returns a strong candidate for token overlap', () => {
    const scored = matchCandidates('landing page thing', CANDIDATES);
    expect(scored[0].id).toBe('task_3');
  });

  it('returns no matches for an empty reference', () => {
    expect(matchCandidates('', CANDIDATES)).toEqual([]);
  });
});

describe('levenshtein', () => {
  it('computes bounded distance', () => {
    expect(levenshtein('kitten', 'sitting', 10)).toBe(3);
  });
});