import { describe, it, expect } from 'vitest';
import {
  createEmptyState,
  setActiveEntity,
  recordPresented,
  addExclusion,
  resolveOrdinal,
  touchMentioned,
  applyCorrection,
} from '../../src/services/ai/memory/conversationState';

describe('setActiveEntity / touchMentioned', () => {
  it('sets the active entity and puts it first in last-mentioned', () => {
    const state = createEmptyState();
    setActiveEntity(state, { type: 'task', id: 't1', title: 'A' });
    expect(state.activeEntity?.id).toBe('t1');
    expect(state.lastMentionedEntities[0].id).toBe('t1');
    touchMentioned(state, { type: 'task', id: 't2', title: 'B' });
    expect(state.lastMentionedEntities[0].id).toBe('t2');
  });

  it('does not duplicate last-mentioned entries', () => {
    const state = createEmptyState();
    setActiveEntity(state, { type: 'task', id: 't1', title: 'A' });
    setActiveEntity(state, { type: 'task', id: 't1', title: 'A' });
    expect(state.lastMentionedEntities.filter((e) => e.id === 't1')).toHaveLength(1);
  });
});

describe('resolveOrdinal (spec §15)', () => {
  it('resolves "the second one" to the second presented entity', () => {
    const state = createEmptyState();
    recordPresented(state, [
      { type: 'task', id: 't1', title: 'A' },
      { type: 'task', id: 't2', title: 'B' },
      { type: 'task', id: 't3', title: 'C' },
    ]);
    expect(resolveOrdinal(state, 'the second one')?.id).toBe('t2');
  });

  it('resolves "that" / "it" to the last presented entity', () => {
    const state = createEmptyState();
    recordPresented(state, [
      { type: 'task', id: 't1', title: 'A' },
      { type: 'task', id: 't2', title: 'B' },
    ]);
    expect(resolveOrdinal(state, 'that')?.id).toBe('t2');
    expect(resolveOrdinal(state, 'it')?.id).toBe('t2');
  });

  it('resolves "the previous one" to the last presented entity', () => {
    const state = createEmptyState();
    recordPresented(state, [{ type: 'task', id: 't1', title: 'A' }, { type: 'task', id: 't2', title: 'B' }]);
    expect(resolveOrdinal(state, 'the previous one')?.id).toBe('t2');
  });
});

describe('negation / exclusions (spec §44)', () => {
  it('adds exclusions without duplicates', () => {
    const state = createEmptyState();
    addExclusion(state, { type: 'task', id: 't1' });
    addExclusion(state, { type: 'task', id: 't1' });
    expect(state.excludedEntities).toHaveLength(1);
  });
});

describe('corrections (spec §45)', () => {
  it('replaces the active entity instead of adding a competing state', () => {
    const state = createEmptyState();
    setActiveEntity(state, { type: 'task', id: 't1', title: 'Wrong one' });
    applyCorrection(state, { type: 'task', id: 't2', title: 'Client presentation' });
    expect(state.activeEntity?.id).toBe('t2');
  });
});