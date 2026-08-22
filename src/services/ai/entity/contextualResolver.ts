// backend/src/services/ai/entity/contextualResolver.ts
// Resolves pronouns / ordinals / deictic references ("that", "the second one",
// "it", "the previous one", "the one I mentioned") using structured
// conversation state. Zero LLM cost once the entity list carries IDs.

import {
  isContextualReference,
  resolveOrdinal,
  type ConversationState,
  type StateEntityRef,
} from '../memory/conversationState';
import type { EntityMatch, EntityType, ResolutionResult } from './entityTypes';

export interface ContextualResolutionContext {
  state?: ConversationState | null;
  /** Candidate entities already loaded (to look up resolved IDs). */
  candidates?: EntityMatch[];
  candidateType?: EntityType;
}

/**
 * Try to resolve a contextual reference. Returns a ResolutionResult with
 * method === 'contextual' on success, or null when the reference is not
 * deictic / nothing resolves.
 */
export function resolveContextual(
  reference: string,
  ctx: ContextualResolutionContext,
): ResolutionResult | null {
  const norm = reference.trim().toLowerCase();
  if (!isContextualReference(norm)) return null;
  if (!ctx.state) return null;

  const resolved: StateEntityRef | null = resolveOrdinal(ctx.state, norm);
  if (!resolved) return null;

  // Verify the resolved id is present in current candidates if provided.
  const type = ctx.candidateType ?? resolved.type;
  if (ctx.candidates && ctx.candidates.length > 0) {
    const inCandidates = ctx.candidates.some((c) => c.id === resolved.id);
    if (!inCandidates) {
      // The referenced entity may have been deleted/renamed — leave to DB check.
      return {
        entityId: resolved.id,
        entityType: type,
        confidence: 0.5,
        method: 'contextual',
        reason: 'referenced entity not in current candidate list — verify against database',
      };
    }
  }

  return {
    entityId: resolved.id,
    entityType: type,
    confidence: 0.98,
    method: 'contextual',
  };
}