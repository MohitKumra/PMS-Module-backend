import { describe, it, expect } from 'vitest';
import {
  intentContextStrategy,
  intentSnapshotDomains,
  intentNeedsLiveData,
} from '../../src/services/ai/context/contextStrategy';
import { CoachIntent } from '../../src/services/ai/coachIntent';
import { ALL_CONTEXT_DOMAINS } from '../../src/services/ai/context/contextTypes';

describe('intentContextStrategy', () => {
  it('loads tasks + goals + milestones for recommendation intents', () => {
    for (const intent of [
      CoachIntent.TASK_RECOMMEND,
      CoachIntent.TASK_PRIORITIZE,
      CoachIntent.TASK_NEXT,
    ]) {
      const req = intentContextStrategy(intent);
      expect(req.domains).toEqual(['tasks', 'goals', 'milestones']);
      expect(req.requiresLiveStats).toBe(false);
    }
  });

  it('loads only tasks and live stats for task status', () => {
    const req = intentContextStrategy(CoachIntent.TASK_STATUS);
    expect(req.domains).toEqual(['tasks']);
    expect(req.requiresLiveStats).toBe(true);
  });

  it('loads tasks only for task CRUD/search/details', () => {
    for (const intent of [
      CoachIntent.TASK_COMPLETE,
      CoachIntent.TASK_RESCHEDULE,
      CoachIntent.TASK_SEARCH,
      CoachIntent.TASK_DETAILS,
      CoachIntent.TASK_DELETE,
    ]) {
      expect(intentContextStrategy(intent).domains).toEqual(['tasks']);
    }
  });

  it('loads habits + goals + tasks for habit recommendations', () => {
    expect(intentContextStrategy(CoachIntent.HABIT_RECOMMEND).domains).toEqual(['habits', 'goals', 'tasks']);
  });

  it('loads everything for analytics reviews', () => {
    for (const intent of [
      CoachIntent.PROGRESS_REVIEW,
      CoachIntent.PRODUCTIVITY_REVIEW,
      CoachIntent.FOCUS_REVIEW,
      CoachIntent.HABIT_REVIEW,
    ]) {
      const req = intentContextStrategy(intent);
      expect(req.domains).toEqual(ALL_CONTEXT_DOMAINS);
      expect(req.requiresLiveStats).toBe(true);
    }
  });

  it('loads nothing for chitchat / coaching / projects', () => {
    for (const intent of [CoachIntent.CHITCHAT, CoachIntent.COACHING, CoachIntent.PROJECT_CREATE]) {
      expect(intentContextStrategy(intent).domains).toEqual([]);
    }
  });

  it('loads tasks + goals + habits for day planning', () => {
    expect(intentContextStrategy(CoachIntent.PLAN_DAY).domains).toEqual(['tasks', 'goals', 'habits']);
  });
});

describe('intentSnapshotDomains delegation', () => {
  it('keeps backward-compatible domain lists', () => {
    expect(intentSnapshotDomains(CoachIntent.TASK_STATUS)).toEqual(['tasks']);
    expect(intentSnapshotDomains(CoachIntent.HABIT_STATUS)).toEqual(['habits']);
    expect(intentSnapshotDomains(CoachIntent.GOAL_CREATE)).toEqual(['goals', 'milestones']);
    expect(intentSnapshotDomains(CoachIntent.CHITCHAT)).toEqual([]);
  });

  it('loads tasks for recommendation intents (the core fix)', () => {
    expect(intentSnapshotDomains(CoachIntent.TASK_RECOMMEND)).toEqual(['tasks', 'goals', 'milestones']);
  });
});

describe('intentNeedsLiveData delegation', () => {
  it('requires live data only for status / analytics intents', () => {
    expect(intentNeedsLiveData(CoachIntent.PROGRESS_REVIEW)).toBe(true);
    expect(intentNeedsLiveData(CoachIntent.TASK_STATUS)).toBe(true);
    expect(intentNeedsLiveData(CoachIntent.TASK_RECOMMEND)).toBe(false);
    expect(intentNeedsLiveData(CoachIntent.CHITCHAT)).toBe(false);
  });
});