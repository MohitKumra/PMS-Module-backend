// backend/tests/unit/customPlan.validation.test.ts
// Unit tests for the pure Custom Plan request validation + status transition logic.

import { describe, it, expect } from 'vitest';
import {
  sanitizeRequestedLimits,
  sanitizeRequestedFeatures,
  sanitizeRequirements,
  canTransitionStatus,
  parseBillingInterval,
  normalizeFinalConfig,
  NUMERIC_FEATURE_KEYS,
  BOOLEAN_FEATURE_KEYS,
  PAY_TOKEN_TTL_MS,
} from '../../src/services/customPlan.validation';

/** Runs fn and asserts the thrown AppError has the given `code`. */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err: any) {
    expect(err?.code).toBe(code);
    return;
  }
  // No throw — fail the test.
  expect('expected an error to be thrown').toBe('but none was');
}

describe('sanitizeRequestedLimits', () => {
  it('accepts canonical numeric features', () => {
    expect(sanitizeRequestedLimits({ projects: 10, storageMb: 5000 })).toEqual({ projects: 10, storageMb: 5000 });
  });

  it('rejects unknown feature keys', () => {
    expectCode(() => sanitizeRequestedLimits({ galaxyCount: 3 }), 'UNKNOWN_FEATURE');
  });

  it('rejects non-numbers and NaN', () => {
    expectCode(() => sanitizeRequestedLimits({ projects: 'abc' }), 'INVALID_LIMIT');
    expectCode(() => sanitizeRequestedLimits({ projects: NaN }), 'INVALID_LIMIT');
  });

  it('rejects zero and negative values except the -1 unlimited sentinel', () => {
    expectCode(() => sanitizeRequestedLimits({ projects: 0 }), 'INVALID_LIMIT');
    expectCode(() => sanitizeRequestedLimits({ projects: -5 }), 'INVALID_LIMIT');
    expect(sanitizeRequestedLimits({ projects: -1 })).toEqual({ projects: -1 });
  });

  it('rejects absurdly large values', () => {
    expectCode(() => sanitizeRequestedLimits({ projects: 1e12 }), 'LIMIT_TOO_HIGH');
  });

  it('rounds numeric strings', () => {
    expect(sanitizeRequestedLimits({ projects: '25' })).toEqual({ projects: 25 });
  });

  it('returns empty object for null input', () => {
    expect(sanitizeRequestedLimits(null)).toEqual({});
  });

  it('covers every NUMERIC_FEATURE_KEYS entry', () => {
    const out = sanitizeRequestedLimits(
      NUMERIC_FEATURE_KEYS.reduce((acc, k) => ({ ...acc, [k]: 1 }), {})
    );
    expect(Object.keys(out).length).toBe(NUMERIC_FEATURE_KEYS.length);
  });
});

describe('sanitizeRequestedFeatures', () => {
  const current = { aiCoach: false, goals: false };

  it('accepts canonical boolean features', () => {
    expect(sanitizeRequestedFeatures({ voiceNotes: true }, current)).toEqual({ voiceNotes: true });
  });

  it('rejects unknown features', () => {
    expectCode(() => sanitizeRequestedFeatures({ teleporting: true }, current), 'UNKNOWN_FEATURE');
  });

  it('skips features already enabled on the current plan', () => {
    const enabled = sanitizeRequestedFeatures(
      { aiCoach: true, goals: true, focusAdvanced: true },
      { aiCoach: true, goals: true, focusAdvanced: false }
    );
    expect(enabled).toEqual({ focusAdvanced: true });
  });

  it('ignores explicitly-false values', () => {
    expect(sanitizeRequestedFeatures({ voiceNotes: false }, current)).toEqual({});
  });

  it('covers every BOOLEAN_FEATURE_KEYS entry', () => {
    const out = sanitizeRequestedFeatures(
      BOOLEAN_FEATURE_KEYS.reduce((acc, k) => ({ ...acc, [k]: true }), {})
    );
    expect(Object.keys(out).length).toBe(BOOLEAN_FEATURE_KEYS.length);
  });
});

describe('sanitizeRequirements', () => {
  it('trims and drops empty strings', () => {
    expect(sanitizeRequirements({ goal: '  help me  ', hurdles: '  ', otherNotes: '' })).toEqual({
      goal: 'help me',
    });
  });

  it('handles null/undefined', () => {
    expect(sanitizeRequirements(null)).toEqual({});
    expect(sanitizeRequirements(undefined)).toEqual({});
  });
});

describe('canTransitionStatus', () => {
  it('allows PENDING → REVIEWING → QUOTED → ACCEPTED', () => {
    expect(canTransitionStatus('PENDING', 'REVIEWING')).toBe(true);
    expect(canTransitionStatus('REVIEWING', 'QUOTED')).toBe(true);
    expect(canTransitionStatus('QUOTED', 'ACCEPTED')).toBe(true);
  });

  it('allows rejection/cancellation edges', () => {
    expect(canTransitionStatus('PENDING', 'REJECTED')).toBe(true);
    expect(canTransitionStatus('QUOTED', 'CANCELLED')).toBe(true);
  });

  it('blocks invalid transitions', () => {
    expect(canTransitionStatus('PENDING', 'ACCEPTED')).toBe(false);
    expect(canTransitionStatus('ACCEPTED', 'REJECTED')).toBe(false);
    expect(canTransitionStatus('REJECTED', 'PENDING')).toBe(false);
  });

  it('allows a status to move to itself', () => {
    expect(canTransitionStatus('REVIEWING', 'REVIEWING')).toBe(true);
  });
});

describe('parseBillingInterval', () => {
  it('parses valid intervals', () => {
    expect(parseBillingInterval('MONTH')).toBe('MONTH');
    expect(parseBillingInterval('YEAR')).toBe('YEAR');
    expect(parseBillingInterval('other')).toBeNull();
    expect(parseBillingInterval(undefined)).toBeNull();
  });
});

describe('normalizeFinalConfig', () => {
  it('normalizes limits + features and drops unknown keys', () => {
    expect(
      normalizeFinalConfig({
        requestedLimits: { projects: 50, storageMb: '2000' },
        requestedFeatures: { aiCoach: true, goals: 'true', notReal: true },
      })
    ).toEqual({
      requestedLimits: { projects: 50, storageMb: 2000 },
      requestedFeatures: { aiCoach: true, goals: true },
    });
  });

  it('ignores false/absent boolean features', () => {
    expect(
      normalizeFinalConfig({ requestedFeatures: { aiCoach: false, goals: undefined, notionSync: true } })
    ).toEqual({ requestedLimits: {}, requestedFeatures: { notionSync: true } });
  });

  it('returns empty shape for null/non-object input', () => {
    expect(normalizeFinalConfig(null)).toEqual({ requestedLimits: {}, requestedFeatures: {} });
    expect(normalizeFinalConfig('x')).toEqual({ requestedLimits: {}, requestedFeatures: {} });
    expect(normalizeFinalConfig([])).toEqual({ requestedLimits: {}, requestedFeatures: {} });
  });

  it('throws-aware: invalid limits collapse to empty rather than crashing', () => {
    expect(normalizeFinalConfig({ requestedLimits: { galaxyCount: 3 } })).toEqual({
      requestedLimits: {},
      requestedFeatures: {},
    });
  });
});

describe('PAY_TOKEN_TTL', () => {
  it('expires one-week pay links (7 days in ms)', () => {
    expect(PAY_TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});