import { describe, it, expect } from 'vitest';
import { resolveEntity, toEntityMatches } from '../../src/services/ai/entity/entityResolver';
import { createEmptyState, recordPresented, setActiveEntity } from '../../src/services/ai/memory/conversationState';

const CANDIDATES = [
  { id: 'task_1', title: 'Prepare investor presentation' },
  { id: 'task_2', title: 'Fix mobile navigation' },
  { id: 'task_3', title: 'Finish landing page' },
];

describe('resolveEntity — exact', () => {
  it('resolves an exact title reference with zero ambiguity', () => {
    const result = resolveEntity({ reference: 'Finish landing page', candidates: CANDIDATES, entityType: 'task' });
    expect(result.entityId).toBe('task_3');
    expect(result.method).toBe('exact');
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });
});

describe('resolveEntity — normalized / prefix', () => {
  it('resolves a partial reference when it is unique', () => {
    const result = resolveEntity({ reference: 'investor presentation', candidates: CANDIDATES, entityType: 'task' });
    expect(result.entityId).toBe('task_1');
    expect(result.method).toBe('normalized');
  });
});

describe('resolveEntity — fuzzy typo', () => {
  it('resolves a misspelled reference deterministically (spec §11)', () => {
    const result = resolveEntity({ reference: 'presenation', candidates: CANDIDATES, entityType: 'task' });
    expect(result.entityId).toBe('task_1');
    expect(result.method).toBe('fuzzy');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

describe('resolveEntity — contextual pronouns / ordinals (spec §13/§15)', () => {
  it('resolves "the second one" using last-presented entities', () => {
    const state = createEmptyState();
    recordPresented(state, [
      { type: 'task', id: 't1', title: 'A' },
      { type: 'task', id: 't2', title: 'B' },
      { type: 'task', id: 't3', title: 'C' },
    ]);
    const result = resolveEntity({
      reference: 'the second one',
      candidates: [],
      entityType: 'task',
      conversationState: state,
    });
    expect(result.entityId).toBe('t2');
    expect(result.method).toBe('contextual');
  });

  it('resolves "that" / "it" from the active entity', () => {
    const state = createEmptyState();
    setActiveEntity(state, { type: 'task', id: 't9', title: 'Finish investor deck' });
    const result = resolveEntity({
      reference: 'that',
      candidates: [],
      entityType: 'task',
      conversationState: state,
    });
    expect(result.entityId).toBe('t9');
  });
});

describe('resolveEntity — ambiguous (spec §17)', () => {
  it('does not guess when several candidates tie', () => {
    const ambiguous = [
      { id: 'p1', title: 'Prepare presentation' },
      { id: 'p2', title: 'Prepare investor presentation' },
      { id: 'p3', title: 'Prepare client presentation' },
    ];
    const result = resolveEntity({ reference: 'presentation', candidates: ambiguous, entityType: 'task' });
    expect(result.entityId).toBeNull();
    expect(result.method).toBe('ambiguous');
    expect(result.matches?.length).toBeGreaterThan(1);
  });
});

describe('toEntityMatches', () => {
  it('maps id+title rows to candidates', () => {
    expect(toEntityMatches([{ id: 'x', title: 'Some task' }])).toEqual([{ id: 'x', title: 'Some task' }]);
  });
});