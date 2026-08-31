// backend/tests/unit/customPlan.snapshot.test.ts
// Tests for the immutable entitlement-snapshot builder used when a custom plan
// request is ACCEPTED — confirmed the merged config on the carrier Plan.features.

import { describe, it, expect } from 'vitest';
import { buildCustomPlanFeaturesSnapshot } from '../../src/services/customPlan.service';

describe('buildCustomPlanFeaturesSnapshot', () => {
  it('starts from the base features and applies finalized limits + features', () => {
    const base = {
      projects: 3,
      tasks: 100,
      aiRequestsPerMonth: 30,
      aiCoach: true,
      notionSync: false,
    };
    const config = {
      requestedLimits: { projects: 50, aiRequestsPerMonth: 1000 },
      requestedFeatures: { notionSync: true, aiCoach: false },
    };

    const snapshot = buildCustomPlanFeaturesSnapshot(base, config as any);

    // Overridden by finalized config.
    expect(snapshot.projects).toBe(50);
    expect(snapshot.aiRequestsPerMonth).toBe(1000);
    // Base values untouched.
    expect(snapshot.tasks).toBe(100);
    // Only enabled boolean features are applied; `false` is a no-op (the config
    // never turns features off), so aiCoach remains from base.
    expect(snapshot.notionSync).toBe(true);
    expect(snapshot.aiCoach).toBe(true);
  });

  it('does not mutate the base features object', () => {
    const base: Record<string, unknown> = { projects: 3 };
    const snapshot = buildCustomPlanFeaturesSnapshot(base, {
      requestedLimits: { projects: 9 },
      requestedFeatures: {},
    });
    expect(snapshot.projects).toBe(9);
    expect(base.projects).toBe(3);
  });

  it('returns a copy of the base for an empty config', () => {
    const base = { a: 1, b: true };
    expect(buildCustomPlanFeaturesSnapshot(base, { requestedLimits: {}, requestedFeatures: {} })).toEqual(base);
  });

  it('auto-raises aiRequestsPerMonth to MIN_AI_QUOTA when AI features are enabled without quota', () => {
    const base = { projects: 3, aiRequestsPerMonth: 0 };
    const config = {
      requestedLimits: {},
      requestedFeatures: { aiCoach: true },
    };
    const snapshot = buildCustomPlanFeaturesSnapshot(base, config as any);
    expect(snapshot.aiCoach).toBe(true);
    expect(snapshot.aiRequestsPerMonth).toBeGreaterThanOrEqual(1);
  });
});