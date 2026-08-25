import { describe, it, expect } from 'vitest';
import {
  CoachIntent,
  classifyIntent,
  intentNeedsLiveData,
  intentSnapshotDomains,
  ALL_SNAPSHOT_DOMAINS,
} from '../../src/services/ai/coachIntent';

describe('intentSnapshotDomains', () => {
  it('loads only tasks for task intents', () => {
    expect(intentSnapshotDomains(CoachIntent.TASK_STATUS)).toEqual(['tasks']);
    expect(intentSnapshotDomains(CoachIntent.TASK_CREATE)).toEqual(['tasks']);
  });

  it('loads only habits for habit status, but habits + goals for habit create', () => {
    expect(intentSnapshotDomains(CoachIntent.HABIT_STATUS)).toEqual(['habits']);
    expect(intentSnapshotDomains(CoachIntent.HABIT_CREATE)).toEqual(['habits', 'goals', 'milestones']);
  });

  it('loads goals + milestones for goal/plan intents', () => {
    expect(intentSnapshotDomains(CoachIntent.GOAL_CREATE)).toEqual(['goals', 'milestones']);
    expect(intentSnapshotDomains(CoachIntent.PLAN)).toEqual(['goals', 'milestones']);
  });

  it('loads nothing for project-only intents', () => {
    expect(intentSnapshotDomains(CoachIntent.PROJECT_CREATE)).toEqual([]);
  });

  it('loads everything for a broad progress review', () => {
    expect(intentSnapshotDomains(CoachIntent.PROGRESS_REVIEW)).toEqual(ALL_SNAPSHOT_DOMAINS);
  });

  it('loads nothing for chitchat / generic coaching', () => {
    expect(intentSnapshotDomains(CoachIntent.CHITCHAT)).toEqual([]);
    expect(intentSnapshotDomains(CoachIntent.COACHING)).toEqual([]);
  });

  it('never returns a domain outside the allowed set', () => {
    for (const intent of Object.values(CoachIntent)) {
      const domains = intentSnapshotDomains(intent as CoachIntent);
      for (const d of domains) {
        expect(ALL_SNAPSHOT_DOMAINS).toContain(d);
      }
    }
  });
});

describe('intentNeedsLiveData', () => {
  it('requires live data for status / review intents', () => {
    expect(intentNeedsLiveData(CoachIntent.TASK_STATUS)).toBe(true);
    expect(intentNeedsLiveData(CoachIntent.HABIT_STATUS)).toBe(true);
    expect(intentNeedsLiveData(CoachIntent.PROGRESS_REVIEW)).toBe(true);
  });

  it('does not require live data for chitchat or creation', () => {
    expect(intentNeedsLiveData(CoachIntent.CHITCHAT)).toBe(false);
    expect(intentNeedsLiveData(CoachIntent.TASK_CREATE)).toBe(false);
    expect(intentNeedsLiveData(CoachIntent.COACHING)).toBe(false);
  });
});

describe('classifyIntent', () => {
  it('classifies a task status request', () => {
    expect(classifyIntent('show me my tasks today')).toBe(CoachIntent.TASK_STATUS);
  });

  it.each([
    'how many tasks are pending',
    'which tasks are pending',
    'tasks are overdue',
    'how many tasks are overdue',
    'count my pending tasks',
    'do i have open tasks',
    'what are my pending tasks',
    'what are my tasks',
    'list my tasks',
    'do i have any tasks',
    'any overdue tasks',
    'which tasks should i do',
    'tasks remaining this week',
    'what do i have left to do',
    'incomplete tasks',
    'unfinished tasks',
    'show me my task list',
  ])('classifies "%s" as task status', (phrase) => {
    expect(classifyIntent(phrase)).toBe(CoachIntent.TASK_STATUS);
  });

  it.each([
    'how is my habit streak',
    'list my habits',
    'which habits have i done',
    'any habits pending',
    'habits remaining today',
    'did i do my habits today',
    'habit status',
    'show my habits',
    'how many habits do i have',
    'how many habits',
  ])('classifies "%s" as habit status', (phrase) => {
    expect(classifyIntent(phrase)).toBe(CoachIntent.HABIT_STATUS);
  });

  // ── Cross-domain bleed prevention ─────────────────────────────────────────
  // A fresh clear question should NEVER inherit the previous turn's domain.
  it('does not let a task-status previous turn override a habit-status current message', () => {
    expect(classifyIntent('how many habits do i have', 'yes thats what im asking what are my pending tasks')).toBe(
      CoachIntent.HABIT_STATUS
    );
  });

  it('does not let a habit-status previous turn override a goals current message', () => {
    // "how many goals do i have" is not ambiguous — it clearly asks about goals,
    // not habits. The previous turn must not bleed through.
    const result = classifyIntent('how many goals do i have', 'show my habits');
    expect(result).toBe(CoachIntent.GOAL_CREATE);
    expect(result).not.toBe(CoachIntent.HABIT_STATUS);
  });

  it('does not let a task previous turn override a habit creation current message', () => {
    expect(classifyIntent('add a habit to drink water daily', 'how many tasks are pending')).toBe(
      CoachIntent.HABIT_CREATE
    );
  });

  // ── Follow-up inheritance ──────────────────────────────────────────────────
  // Short / ambiguous follow-ups SHOULD inherit the previous turn's domain.
  it('inherits task status intent from previous turn for ambiguous follow-up', () => {
    expect(classifyIntent('yes thats what im asking', 'how many tasks are pending')).toBe(CoachIntent.TASK_STATUS);
  });

  it('inherits task status intent from previous turn for "ok show me"', () => {
    expect(classifyIntent('ok show me', 'what are my overdue tasks')).toBe(CoachIntent.TASK_STATUS);
  });

  it('classifies a habit status request', () => {
    expect(classifyIntent('how is my habit streak going?')).toBe(CoachIntent.HABIT_STATUS);
  });

  it('classifies a task creation request', () => {
    expect(classifyIntent('add a task to buy groceries')).toBe(CoachIntent.TASK_CREATE);
  });

  it('falls back to generic coaching', () => {
    expect(classifyIntent('give me a pep talk')).toBe(CoachIntent.COACHING);
  });

  it('falls back to chitchat for greetings', () => {
    expect(classifyIntent('hello there')).toBe(CoachIntent.CHITCHAT);
  });

  // ── New context taxonomy (spec §3.1) ────────────────────────────────────────
  it.each(['what should i do', 'what should i work on', 'which task should i do', 'recommend a task'])(
    'classifies "%s" as task recommend',
    (phrase) => {
      expect(classifyIntent(phrase)).toBe(CoachIntent.TASK_RECOMMEND);
    }
  );

  it.each([
    'whats my most important task',
    'which task is most important',
    'prioritize my tasks',
    'what should i focus on today',
  ])('classifies "%s" as task prioritize', (phrase) => {
    expect(classifyIntent(phrase)).toBe(CoachIntent.TASK_PRIORITIZE);
  });

  it.each(['whats next', 'next task', 'what should i do next', 'what do i work on next'])(
    'classifies "%s" as task next',
    (phrase) => {
      expect(classifyIntent(phrase)).toBe(CoachIntent.TASK_NEXT);
    }
  );

  it.each(['mark the landing page complete', 'finish the investor deck', 'complete the presentation'])(
    'classifies "%s" as task complete',
    (phrase) => {
      expect(classifyIntent(phrase)).toBe(CoachIntent.TASK_COMPLETE);
    }
  );

  it.each(['move the presentation to tomorrow', 'reschedule the meeting', 'postpone the review'])(
    'classifies "%s" as task reschedule',
    (phrase) => {
      expect(classifyIntent(phrase)).toBe(CoachIntent.TASK_RESCHEDULE);
    }
  );

  it.each(['find my presentation task', 'search for the invoice'])('classifies "%s" as task search', (phrase) => {
    expect(classifyIntent(phrase)).toBe(CoachIntent.TASK_SEARCH);
  });

  it.each(['tell me about the presentation task', 'what about the landing page'])(
    'classifies "%s" as task details',
    (phrase) => {
      expect(classifyIntent(phrase)).toBe(CoachIntent.TASK_DETAILS);
    }
  );

  it('classifies a multi-word recommendation phrase despite previous habit turn intent', () => {
    expect(classifyIntent('what should i work on', 'what are my pending tasks')).toBe(CoachIntent.TASK_RECOMMEND);
  });
});
