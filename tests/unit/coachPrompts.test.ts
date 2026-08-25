import { describe, it, expect } from 'vitest';
import { buildCoachUserPrompt, type CoachPromptData } from '../../src/services/ai/prompts/coachPrompts';
import { CoachIntent } from '../../src/services/ai/coachIntent';

function makeData(overrides: Partial<CoachPromptData> = {}): CoachPromptData {
  return {
    completedToday: 1,
    totalHabits: 3,
    currentStreak: 2,
    longestStreak: 5,
    tasksCompleted: 4,
    tasksOverdue: 1,
    focusMinutesToday: 20,
    timeOfDay: 'morning',
    recentActivity: 'Last task: "Ship it" (IN_PROGRESS)',
    tasks: [
      {
        id: '1',
        title: 'Finish report',
        dueDate: '2026-08-10T00:00:00.000Z',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
        overdue: false,
        subtasksOpen: 2,
      },
      { id: '1', title: 'Water plants', dueDate: null, priority: 'LOW', status: 'TODO', overdue: false, subtasksOpen: 0 },
    ],
    goals: [
      {
         id: '1',
        title: 'Get fit',
        progress: 40,
        status: 'ACTIVE',
        targetDate: null,
        nextMilestoneTitle: 'Run 5k',
        nextMilestoneDueDate: null,
      },
    ],
    habits: [
      {
         id: '1',
        title: 'Morning run',
        goalTitle: 'Get fit',
        currentStreak: 2,
        targetPerWeek: 4,
        completionsThisWeek: 2,
        completedToday: true,
      },
    ],
    milestones: [{ id: '1', goalTitle: 'Get fit', goalProgress: 40, title: 'Run 5k', dueDate: null, status: 'PENDING' }],
    session: { title: 'Coach', summary: '', messageCount: 3 },
    ...overrides,
  };
}

function parse(data: CoachPromptData): Record<string, unknown> {
  return JSON.parse(buildCoachUserPrompt(data));
}

describe('buildCoachUserPrompt — targeted snapshot injection', () => {
  it('sends only tasks for a task_status request in chat mode', () => {
    const payload = parse(makeData({ mode: 'chat', intent: CoachIntent.TASK_STATUS, needsLiveData: true }));
    expect(payload.tasks).toBeDefined();
    expect((payload.tasks as unknown[]).length).toBe(2);
    expect((payload.tasks as Array<Record<string, unknown>>)[0]).toMatchObject({
      title: 'Finish report',
      priority: 'HIGH',
    });
    expect(payload.habits).toBeUndefined();
    expect(payload.goals).toBeUndefined();
    expect(payload.milestones).toBeUndefined();
  });

  it('sends only habits for a habit_status request in chat mode', () => {
    const payload = parse(makeData({ mode: 'chat', intent: CoachIntent.HABIT_STATUS, needsLiveData: true }));
    expect(payload.habits).toBeDefined();
    expect(payload.tasks).toBeUndefined();
    expect(payload.goals).toBeUndefined();
    expect(payload.milestones).toBeUndefined();
  });

  it('sends no entity snapshot for chitchat', () => {
    const payload = parse(makeData({ mode: 'chat', intent: CoachIntent.CHITCHAT }));
    expect(payload.tasks).toBeUndefined();
    expect(payload.habits).toBeUndefined();
    expect(payload.goals).toBeUndefined();
    expect(payload.milestones).toBeUndefined();
  });

  it('forces the habit entity type for a habit_create request', () => {
    const payload = parse(makeData({ mode: 'chat', intent: CoachIntent.HABIT_CREATE, needsLiveData: false }));
    const hint = payload.entityCreation as { entity?: string; instruction?: string } | undefined;
    expect(hint).toBeDefined();
    expect(hint?.entity).toBe('habit');
    expect(hint?.instruction).toContain('set entityDraft.entity to "habit"');
    // Must not allow task-only concepts
    expect(hint?.instruction).toContain('skipDays');
    expect(hint?.instruction).not.toContain('recurrenceConfig');
  });

  it('does not force an entity type for non-create intents', () => {
    const payload = parse(makeData({ mode: 'chat', intent: CoachIntent.TASK_STATUS, needsLiveData: true }));
    expect(payload.entityCreation).toBeUndefined();
  });

  it('sends all non-empty snapshots in summary / progress review mode', () => {
    // Summary mode: intent defaults to PROGRESS_REVIEW → all domains.
    const payload = parse(makeData({ mode: 'summary' }));
    expect(payload.tasks).toBeDefined();
    expect(payload.goals).toBeDefined();
    expect(payload.habits).toBeDefined();
    expect(payload.milestones).toBeDefined();
  });

  it('caps the task list to 6 items', () => {
    const manyTasks = Array.from({ length: 12 }, (_, i) => ({
      id : `${i}`,
      title: `Task ${i}`,
      dueDate: null,
      priority: 'MEDIUM' as const,
      status: 'TODO' as const,
      overdue: false,
      subtasksOpen: 0,
    }));
    const payload = parse(
      makeData({ mode: 'chat', intent: CoachIntent.TASK_STATUS, needsLiveData: true, tasks: manyTasks })
    );
    expect((payload.tasks as unknown[]).length).toBe(6);
  });
});
