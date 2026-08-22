// backend/src/services/ai/entity/entityResolver.ts
// Entity resolution engine — maps a natural-language reference to a real DB
// entity. Runs deterministic layers first (spec §8) and only escalates to a
// semantic resolver when confidence sits in the ambiguous band.

import { exactMatch, matchCandidates, normalizeText, prefixMatch } from './fuzzyMatcher';
import { resolveContextual } from './contextualResolver';
import {
  EntityConfidence,
  type EntityMatch,
  type EntityType,
  type ResolutionResult,
} from './entityTypes';
import type { ConversationState } from '../memory/conversationState';

export interface EntityResolverInput {
  reference: string;
  candidates: EntityMatch[];
  entityType?: EntityType;
  conversationState?: ConversationState | null;
}

/**
 * Primary deterministic entry point. Order: exact → normalized(prefix) →
 * fuzzy → contextual. Returns an unambiguous resolution when possible, or a
 * low-confidence/ambiguous result that the caller routes to clarification or a
 * semantic resolver.
 */
export function resolveEntity(input: EntityResolverInput): ResolutionResult {
  const ref = input.reference?.trim();
  if (!ref) {
    return { entityId: null, entityType: null, confidence: 0, method: 'ambiguous', reason: 'no reference' };
  }

  const candidates = input.candidates ?? [];
  // 1. Exact match (after normalization).
  const exact = exactMatch(ref, candidates);
  if (exact) {
    return {
      entityId: exact.id,
      entityType: input.entityType ?? null,
      confidence: 1,
      method: 'exact',
    };
  }

  // 2. Normalized prefix / substring match — only when it yields exactly one hit.
  const prefixes = prefixMatch(ref, candidates);
  if (prefixes.length === 1) {
    return {
      entityId: prefixes[0].id,
      entityType: input.entityType ?? null,
      confidence: 0.9,
      method: 'normalized',
    };
  }
  if (prefixes.length > 1) {
    return {
      entityId: null,
      entityType: input.entityType ?? null,
      confidence: 0.5,
      method: 'ambiguous',
      matches: prefixes.map((c) => ({ id: c.id, title: c.title })),
    };
  }

  // 3. Contextual (pronouns / ordinals) — resolve via conversation state.
  const contextual = resolveContextual(ref, {
    state: input.conversationState,
    candidates,
    candidateType: input.entityType,
  });
  if (contextual) return contextual;

  // 4. Fuzzy / token matching with confidence bands.
  const scored = matchCandidates(ref, candidates);
  if (scored.length === 0) {
    return { entityId: null, entityType: null, confidence: 0, method: 'ambiguous' };
  }

  const best = scored[0];

  if (scored.length === 1 || best.score - (scored[1]?.score ?? 0) >= 0.15) {
    // Clear winner.
    if (best.score >= EntityConfidence.AUTO) {
      return { entityId: best.id, entityType: input.entityType ?? null, confidence: 0.96, method: 'fuzzy' };
    }
    if (best.score >= EntityConfidence.STRONG) {
      return { entityId: best.id, entityType: input.entityType ?? null, confidence: best.score, method: 'fuzzy' };
    }
    // 0.60–0.79 → semantic resolver band (escalate), or clarifient below.
    return {
      entityId: null,
      entityType: input.entityType ?? null,
      confidence: best.score,
      method: 'ambiguous',
      matches: scored.slice(0, 3).map((c) => ({ id: c.id, title: c.title })),
    };
  }

  // Multiple close candidates → ambiguous; surface the matches for a concise
  // clarification. Never silently pick one.
  return {
    entityId: null,
    entityType: input.entityType ?? null,
    confidence: best.score,
    method: 'ambiguous',
    matches: scored.slice(0, 3).map((c) => ({ id: c.id, title: c.title })),
  };
}

/** Convenience: build EntityMatch[] from any objects carrying id + title. */
export function toEntityMatches<T extends { id: string; title: string }>(
  rows: T[],
): EntityMatch[] {
  return rows.map((r) => ({ id: r.id, title: r.title }));
}

/** Exported for tests: keeps normalization single-sourced. */
export function _normalizeForTesting(value: string): string {
  return normalizeText(value);
}