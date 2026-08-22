import { describe, it, expect } from 'vitest';
import { splitMultiIntent } from '../../src/services/ai/multiIntent';
import { CoachIntent } from '../../src/services/ai/coachIntent';

describe('splitMultiIntent (spec §5)', () => {
  it('splits a complete + create into two operations', () => {
    const result = splitMultiIntent('finish the landing page and remind me to email the client tomorrow');
    expect(result.intentMode).toBe('multi');
    expect(result.operations).toHaveLength(2);
    expect(result.operations[0].intent).toBe(CoachIntent.TASK_COMPLETE);
    expect(result.operations[0].entityReference).toContain('landing page');
    expect(result.operations[1].intent).toBe(CoachIntent.TASK_CREATE);
  });

  it('splits a recommend + complete into two operations', () => {
    const result = splitMultiIntent('what should i work on today and mark the presentation complete');
    expect(result.intentMode).toBe('multi');
    expect(result.operations[0].intent).toBe(CoachIntent.TASK_RECOMMEND);
    expect(result.operations[1].intent).toBe(CoachIntent.TASK_COMPLETE);
    expect(result.primaryIntent).toBe(CoachIntent.TASK_RECOMMEND);
  });

  it('returns a single operation for a plain message', () => {
    const result = splitMultiIntent('what should i do');
    expect(result.intentMode).toBe('single');
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].intent).toBe(CoachIntent.TASK_RECOMMEND);
  });

  it('collapses duplicate intents into one operation', () => {
    const result = splitMultiIntent('mark the presentation complete and finish the landing page');
    expect(result.intentMode).toBe('single');
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].intent).toBe(CoachIntent.TASK_COMPLETE);
  });
});