// backend/src/services/customPlan.validation.ts
// Pure validation helpers for Custom Plan requests.
//
// IMPORTANT: These are display/validation metadata keyed by the same canonical
// feature keys stored on Plan.features (the real source of truth, edited via
// Admin → Plans). We do NOT define a second feature system here — this file only
// whitelists which keys may be requested so the server can reject anything else.
// Availability still comes from the user's actual resolved plan.

import { createError } from '../middleware/errorHandler';

// Canonical keys of numeric, per-user quota features on Plan.features.
export const NUMERIC_FEATURE_KEYS = [
  'aiRequestsPerMonth',
  'projects',
  'habits',
  'tasks',
  'storageMb',
  'notes',
  'journals',
] as const;

// Canonical keys of boolean (on/off) entitlement features on Plan.features.
export const BOOLEAN_FEATURE_KEYS = [
  'aiCoach',
  'goals',
  'focusAdvanced',
  'notionSync',
  'voiceNotes',
  'audioRecurrence',
] as const;

export type NumericFeatureKey = (typeof NUMERIC_FEATURE_KEYS)[number];
export type BooleanFeatureKey = (typeof BOOLEAN_FEATURE_KEYS)[number];

const NUMERIC_SET = new Set<string>(NUMERIC_FEATURE_KEYS);
const BOOLEAN_SET = new Set<string>(BOOLEAN_FEATURE_KEYS);

// Upper sanity bound for any requested numeric limit. -1 is preserved as the
// existing "unlimited" sentinel.
export const MAX_LIMIT = 100_000_000;

// Human-readable labels mirroring Admin → Plans (single display vocabulary).
export const FEATURE_LABELS: Record<string, string> = {
  aiRequestsPerMonth: 'AI requests / month',
  projects: 'Active projects',
  habits: 'Habit trackers',
  tasks: 'Tasks',
  storageMb: 'Storage (MB)',
  notes: 'Notes',
  journals: 'Journal entries',
  aiCoach: 'AI Coach',
  goals: 'Goals',
  focusAdvanced: 'Advanced Focus',
  notionSync: 'Notion sync',
  voiceNotes: 'Voice notes',
  audioRecurrence: 'Audio recurrence',
};

export interface SanitizedLimits {
  [key: string]: number;
}

export interface SanitizedFeatures {
  [key: string]: true;
}
/**
 * Validates and normalizes a client-supplied requestedLimits map.
 * Rejects unknown keys, non-numbers, negative values (except the -1 unlimited
 * sentinel), zero, or absurd values beyond MAX_LIMIT. Returns a sanitized copy.
 * The client is never trusted: only canonical keys pass.
 */
export function sanitizeRequestedLimits(
  input: unknown
): SanitizedLimits {
  const result: SanitizedLimits = {};
  if (input == null) return result;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw createError(400, 'INVALID_LIMITS', 'requestedLimits must be an object of feature keys to values.');
  }

  for (const [key, rawValue] of Object.entries(input as Record<string, unknown>)) {
    if (!NUMERIC_SET.has(key)) {
      throw createError(400, 'UNKNOWN_FEATURE', `Unknown limit feature: "${key}"`);
    }
    const value = typeof rawValue === 'string' ? Number(rawValue) : rawValue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw createError(400, 'INVALID_LIMIT', `Limit for "${key}" must be a number.`);
    }
    // -1 is the unlimited sentinel; otherwise require a positive integer.
    if (value === -1) {
      result[key] = -1;
    } else if (value <= 0) {
      throw createError(400, 'INVALID_LIMIT', `Limit for "${key}" must be greater than zero.`);
    } else if (value > MAX_LIMIT) {
      throw createError(400, 'LIMIT_TOO_HIGH', `Limit for "${key}" exceeds the allowed maximum.`);
    } else {
      result[key] = Math.round(value);
    }
  }
  return result;
}

/**
 * Validates and normalizes a client-supplied requestedFeatures map.
 * Only canonical boolean entitlement keys are accepted, and only when enabled.
 * Returns { featureKey: true }.
 */
export function sanitizeRequestedFeatures(
  input: unknown,
  currentFeatures: Record<string, unknown> = {}
): SanitizedFeatures {
  const result: SanitizedFeatures = {};
  if (input == null) return result;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw createError(400, 'INVALID_FEATURES', 'requestedFeatures must be an object of feature keys.');
  }
  for (const [key, rawValue] of Object.entries(input as Record<string, unknown>)) {
    if (!BOOLEAN_SET.has(key)) {
      throw createError(400, 'UNKNOWN_FEATURE', `Unknown feature: "${key}"`);
    }
    if (rawValue === true || rawValue === 'true') {
      // A feature already enabled by the current plan is a no-op; skip it.
      if (currentFeatures[key] === true) {
        continue;
      }
      result[key] = true;
    }
  }
  return result;
}

/**
 * Normalizes free-text requirements (goal, constraints/hurdles) and an optional
 * other-notes field. Trims and drops empties.
 */
export function sanitizeRequirements(
  input: unknown
): { goal?: string; hurdles?: string; otherNotes?: string } {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return {};
  const src = input as Record<string, unknown>;
  const out: { goal?: string; hurdles?: string; otherNotes?: string } = {};
  for (const key of ['goal', 'hurdles', 'otherNotes'] as const) {
    const val = (src[key] as string | undefined) ?? '';
    const trimmed = String(val).slice(0, 4000).trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}
export const CUSTOM_PLAN_STATUSES = [
  'PENDING',
  'REVIEWING',
  'QUOTED',
  'ACCEPTED',
  'REJECTED',
  'CANCELLED',
] as const;
export type CustomPlanStatus = (typeof CUSTOM_PLAN_STATUSES)[number];

// Server-controlled status transitions. A request can only move along approved
// edges; clients/normal users are never allowed to change status.
const TRANSITIONS: Record<CustomPlanStatus, CustomPlanStatus[]> = {
  PENDING: ['REVIEWING', 'QUOTED', 'REJECTED', 'CANCELLED'],
  REVIEWING: ['QUOTED', 'REJECTED', 'CANCELLED'],
  QUOTED: ['ACCEPTED', 'REJECTED', 'CANCELLED', 'REVIEWING'],
  ACCEPTED: [],
  REJECTED: [],
  CANCELLED: [],
};

export const CUSTOM_PLAN_STATUS_LABELS: Record<CustomPlanStatus, string> = {
  PENDING: 'Pending',
  REVIEWING: 'Under review',
  QUOTED: 'Quote ready',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/** Returns true when `from -> to` is an allowed server-side transition. */
export function canTransitionStatus(
  from: CustomPlanStatus,
  to: CustomPlanStatus
): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function parseBillingInterval(value: unknown): 'MONTH' | 'YEAR' | null {
  if (value === 'MONTH' || value === 'YEAR') return value;
  return null;
}

// Lifetime of the emailed one-time payment link for an ACCEPTED custom plan.
export const PAY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface FinalConfigShape {
  requestedLimits: Record<string, number>;
  requestedFeatures: Record<string, boolean>;
}

/**
 * Normalizes the admin-authored `finalConfig` for an ACCEPTED custom plan.
 * Shape: { requestedLimits: { featureKey: absoluteValue }, requestedFeatures: { featureKey: true } }.
 * Values are re-whitelisted against the canonical feature keys — the server never
 * trusts arbitrary config. This is the immutable entitlement snapshot applied once.
 */
export function normalizeFinalConfig(input: unknown): FinalConfigShape {
  const empty: FinalConfigShape = { requestedLimits: {}, requestedFeatures: {} };
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return empty;

  const src = input as Record<string, unknown>;

  let requestedLimits: Record<string, number> = {};
  try {
    requestedLimits = sanitizeRequestedLimits(src.requestedLimits);
  } catch {
    requestedLimits = {};
  }

  const requestedFeatures: Record<string, boolean> = {};
  const features = src.requestedFeatures;
  if (features != null && typeof features === 'object' && !Array.isArray(features)) {
    for (const [key, raw] of Object.entries(features as Record<string, unknown>)) {
      if (BOOLEAN_SET.has(key) && (raw === true || raw === 'true')) {
        requestedFeatures[key] = true;
      }
    }
  }

  return { requestedLimits, requestedFeatures };
}