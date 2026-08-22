import { describe, it, expect } from 'vitest';
import { rankTasks } from '../../src/services/ai/context/contextRanker';

const TODAY = '2026-08-21';

describe('rankTasks', () => {
  it('ranks overdue high-priority due-today tasks first', () => {
    const tasks = [
      { id: 'a', title: 'Finish investor presentation', priority: 'HIGH', dueDate: '2026-08-21', status: 'TODO' },
      { id: 'b', title: 'Low priority later task', priority: 'LOW', dueDate: '2026-08-30', status: 'TODO' },
    ];
    const ranked = rankTasks(tasks, { today: TODAY, limit: 10 });
    expect(ranked[0].id).toBe('a');
    expect(ranked[0].reasons).toContain('HIGH priority');
    expect(ranked[0].reasons).toContain('due today');
  });

  it('boosts tasks linked to the active goal', () => {
    const tasks = [
      { id: 'goalTask', title: 'Ship landing page', priority: 'MEDIUM', dueDate: '2026-08-30', status: 'TODO', goalId: 'g1' },
      { id: 'unlinked', title: 'Buy groceries', priority: 'HIGH', dueDate: '2026-08-30', status: 'TODO' },
    ];
    const ranked = rankTasks(tasks, { today: TODAY, activeGoalId: 'g1', limit: 10 });
    expect(ranked[0].id).toBe('goalTask');
    expect(ranked[0].reasons).toContain('linked to an active goal');
  });

  it('respects effort constraints (spec §34)', () => {
    const tasks = [
      { id: 'short', title: 'Quick reply', priority: 'HIGH', dueDate: '2026-08-21', status: 'TODO', estimatedDuration: 15 },
      { id: 'long', title: 'Deep work', priority: 'CRITICAL', dueDate: '2026-08-21', status: 'TODO', estimatedDuration: 120 },
    ];
    const ranked = rankTasks(tasks, { today: TODAY, effortMinutes: 30, limit: 10 });
    expect(ranked[0].id).toBe('short');
  });

  it('drops excluded entities (negation, spec §44)', () => {
    const tasks = [
      { id: 'excluded', title: 'Presentation', priority: 'HIGH', dueDate: '2026-08-21', status: 'TODO' },
      { id: 'keep', title: 'Review marketing copy', priority: 'MEDIUM', dueDate: '2026-08-30', status: 'TODO' },
    ];
    const ranked = rankTasks(tasks, { today: TODAY, excludedEntityIds: ['excluded'], limit: 10 });
    expect(ranked.find((t) => t.id === 'excluded')).toBeUndefined();
    expect(ranked[0].id).toBe('keep');
  });

  it('skips completed / cancelled tasks', () => {
    const tasks = [
      { id: 'done', title: 'Finished thing', priority: 'HIGH', dueDate: '2026-08-21', status: 'DONE' },
      { id: 'open', title: 'Still to do', priority: 'LOW', dueDate: '2026-08-30', status: 'TODO' },
    ];
    const ranked = rankTasks(tasks, { today: TODAY, limit: 10 });
    expect(ranked.find((t) => t.id === 'done')).toBeUndefined();
    expect(ranked[0].id).toBe('open');
  });

  it('returns empty when there are no open tasks', () => {
    expect(rankTasks([])).toEqual([]);
  });
});