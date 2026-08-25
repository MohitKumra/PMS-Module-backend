// backend/src/services/ai/context/contextStrategy.ts
// Maps a coach intent to the exact context requirements (spec §23). This
// replaces the old flat intentSnapshotDomains switch with a first-class
// strategy layer. Recommendation intents explicitly pull tasks + goals +
// milestones so the model always has authoritative task data.

import type { CoachIntent } from '../coachIntent';
import { ALL_CONTEXT_DOMAINS, type ContextDomain, type ContextRequirements } from './contextTypes';

const TASKS: ContextDomain[] = ['tasks'];
const HABITS: ContextDomain[] = ['habits'];
const GOALS_MILESTONES: ContextDomain[] = ['goals', 'milestones'];
const TASKS_GOALS_MILESTONES: ContextDomain[] = ['tasks', 'goals', 'milestones'];
const HABITS_GOALS_TASKS: ContextDomain[] = ['habits', 'goals', 'tasks'];
const PLAN_DAY: ContextDomain[] = ['tasks', 'goals', 'habits'];
const PLAN_WEEK: ContextDomain[] = ['tasks', 'goals', 'habits', 'milestones'];

/**
 * The context requirements for a given coach intent. Uses read-only type
 * import of CoachIntent so there is no runtime import cycle.
 */
export function intentContextStrategy(intent: CoachIntent): ContextRequirements {
  switch (intent) {
    // ── Task intents ────────────────────────────────────────────────────────
    case 'task_create':
    case 'task_update':
    case 'task_complete':
    case 'task_delete':
    case 'task_status':
    case 'task_search':
    case 'task_details':
    case 'task_schedule':
    case 'task_reschedule':
      return { domains: TASKS, requiresLiveStats: intent === 'task_status' };
    // Recommendation intents must load tasks + goals + milestones (spec §25).
    case 'task_recommend':
    case 'task_prioritize':
    case 'task_next':
      return { domains: TASKS_GOALS_MILESTONES, requiresLiveStats: false };

    // ── Habit intents ───────────────────────────────────────────────────────
    // habit_create loads goals too so the model can resolve a free-text goal
    // reference ("link to my fitness goal") to a real goalId from context.
    case 'habit_create':
    case 'habit_update':
      return { domains: ['habits', 'goals', 'milestones'], requiresLiveStats: false };
    case 'habit_complete':
    case 'habit_search':
    case 'habit_details':
      return { domains: HABITS, requiresLiveStats: false };
    case 'habit_status':
      return { domains: HABITS, requiresLiveStats: true };
    case 'habit_recommend':
      return { domains: HABITS_GOALS_TASKS, requiresLiveStats: false };

    // ── Goal intents ────────────────────────────────────────────────────────
    case 'goal_create':
    case 'goal_update':
    case 'goal_progress':
    case 'goal_details':
      return { domains: GOALS_MILESTONES, requiresLiveStats: false };
    case 'goal_status':
      return { domains: GOALS_MILESTONES, requiresLiveStats: true };
    case 'goal_recommend':
      return { domains: TASKS_GOALS_MILESTONES, requiresLiveStats: false };

    // ── Project intents ─────────────────────────────────────────────────────
    case 'project_create':
    case 'project_update':
    case 'project_status':
    case 'project_details':
    case 'project_search':
      // Projects are not part of the current snapshot domains; resolve them
      // on demand via the entity resolver instead of a bulk snapshot.
      return { domains: [], requiresLiveStats: false };

    // ── Planning intents ────────────────────────────────────────────────────
    case 'plan':
    case 'plan_goal':
      return { domains: GOALS_MILESTONES, requiresLiveStats: false };
    case 'plan_day':
      return { domains: PLAN_DAY, requiresLiveStats: false };
    case 'plan_week':
      return { domains: PLAN_WEEK, requiresLiveStats: false };
    case 'plan_project':
    case 'plan_tasks':
      return { domains: TASKS_GOALS_MILESTONES, requiresLiveStats: false };

    // ── Analytics intents ───────────────────────────────────────────────────
    case 'progress_review':
    case 'productivity_review':
    case 'focus_review':
    case 'habit_review':
      return { domains: ALL_CONTEXT_DOMAINS, requiresLiveStats: true };

    // ── General ─────────────────────────────────────────────────────────────
    case 'chitchat':
    case 'coaching':
    case 'unknown':
    default:
      return { domains: [], requiresLiveStats: false };
  }
}

/** Backward-compatible helper: snapshot domains only. */
export function intentSnapshotDomains(intent: CoachIntent): ContextDomain[] {
  return intentContextStrategy(intent).domains;
}

/** Backward-compatible helper: does this intent need live analytics stats? */
export function intentNeedsLiveData(intent: CoachIntent): boolean {
  return intentContextStrategy(intent).requiresLiveStats;
}
