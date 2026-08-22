// backend/src/services/ai/memory/conversationState.ts
// Structured conversation state (spec §14). Stores IDs, not just names, so
// references stay robust when titles are renamed. Backed by an in-memory store
// keyed by thread (chat) id — swapable for a DB column later (the persister
// interface below is the single plug point).

import type { EntityType } from '../entity/entityTypes';

export interface StateEntityRef {
  type: EntityType;
  id: string;
  title?: string;
}

export interface ConversationState {
  activeEntity: StateEntityRef | null;
  lastMentionedEntities: StateEntityRef[];
  lastIntent?: string;
  lastAction?: string;
  lastPresentedEntities: StateEntityRef[];
  excludedEntities: StateEntityRef[];
}

export function createEmptyState(): ConversationState {
  return {
    activeEntity: null,
    lastMentionedEntities: [],
    lastPresentedEntities: [],
    excludedEntities: [],
  };
}

/** Set the active (last acted-upon / referenced) entity. */
export function setActiveEntity(
  state: ConversationState,
  ref: StateEntityRef | null,
): ConversationState {
  state.activeEntity = ref;
  if (ref) {
    state.lastMentionedEntities = [
      { type: ref.type, id: ref.id, title: ref.title },
      ...state.lastMentionedEntities.filter((e) => !(e.type === ref.type && e.id === ref.id)),
    ].slice(0, 8);
  }
  return state;
}

export function touchMentioned(state: ConversationState, ref: StateEntityRef): ConversationState {
  state.lastMentionedEntities = [
    { type: ref.type, id: ref.id, title: ref.title },
    ...state.lastMentionedEntities.filter((e) => !(e.type === ref.type && e.id === ref.id)),
  ].slice(0, 8);
  return state;
}

/** Record the entities the assistant just presented (for first/second/last). */
export function recordPresented(
  state: ConversationState,
  refs: StateEntityRef[],
): ConversationState {
  state.lastPresentedEntities = refs;
  return state;
}

export function addExclusion(state: ConversationState, ref: StateEntityRef): ConversationState {
  if (!state.excludedEntities.some((e) => e.type === ref.type && e.id === ref.id)) {
    state.excludedEntities.push(ref);
  }
  return state;
}

/**
 * A user correction replaces the previous interpretation instead of creating a
 * competing top candidate (spec §45 / §46).
 */
export function applyCorrection(
  state: ConversationState,
  ref: StateEntityRef,
): ConversationState {
  return setActiveEntity(state, ref);
}

/** Resolve a pronoun/ordinal reference against presented entities (spec §15). */
export function resolveOrdinal(
  state: ConversationState,
  ref: string,
): StateEntityRef | null {
  const norm = ref.toLowerCase().trim();
  const presented = state.lastPresentedEntities;

  // that / this / it → last presented (most recent the assistant surfaced),
  // falling back to the active entity when nothing was presented yet.
  if (/^(that|this|it|that one|this one|the previous one|the last one)$/.test(norm)) {
    return presented[presented.length - 1] ?? state.activeEntity ?? null;
  }
  const first = presented[0] ?? null;

  const m = norm.match(/\b(the\s+)?(?:1st|2nd|3rd|4th|5th|\d+)(?:st|nd|rd|th)?\s+(one|item|task)?\b/);
  if (norm.includes('second') || /2nd/.test(norm)) return presented[1] ?? first;
  if (norm.includes('third') || /3rd/.test(norm)) return presented[2] ?? first;
  if (norm.includes('fourth') || /4th/.test(norm)) return presented[3] ?? first;
  if (norm.includes('first') || /1st/.test(norm)) return presented[0] ?? null;
  if (norm.includes('last') || norm.includes('previous')) {
    return presented[presented.length - 1] ?? null;
  }
  if (m) {
    const words = norm.split(/\s+/);
    const idx = words.findIndex((w) => /\d+/.test(w));
    if (idx !== -1) {
      const n = parseInt(words[idx].replace(/\D/g, ''), 10);
      if (Number.isFinite(n) && n >= 1) return presented[n - 1] ?? null;
    }
  }
  return null;
}

export const isContextualReference = (ref: string): boolean =>
  /^(that|this|it|that one|this one|the previous one|the last one|the first one|the second one|the third one|the 1st one|the 2nd one|1st one|2nd one|first one|second one|third one|the last one|last one|previous one|the one i mentioned)$/i.test(
    ref.trim(),
  );

// ─── Per-thread store ─────────────────────────────────────────────────────────
// In-memory map keyed by thread (chat) id. Single plug point for upgrading to a
// DB-backed column later — the pure helpers above stay unchanged.

const stateStore = new Map<string, ConversationState>();

export function getConversationState(threadKey: string): ConversationState {
  return stateStore.get(threadKey) ?? createEmptyState();
}

export function saveConversationState(threadKey: string, state: ConversationState): void {
  stateStore.set(threadKey, state);
  // Simple bound on memory growth; oldest entries evicted.
  if (stateStore.size > 5000) {
    const oldest = stateStore.keys().next().value as string | undefined;
    if (oldest) stateStore.delete(oldest);
  }
}