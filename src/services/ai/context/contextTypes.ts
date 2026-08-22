// backend/src/services/ai/context/contextTypes.ts
// Shared types for the context strategy / loading / ranking layers.
// These encode the tier states (NOT_LOADED | EMPTY | AVAILABLE | ...) that let
// the model distinguish between "no tasks exist" and "tasks were not loaded".

/** Runtime state of any entity/domain we load from the database. */
export type ContextState =
  | 'NOT_LOADED' // domain was never fetched for this turn
  | 'EMPTY' // fetched, zero items
  | 'AVAILABLE' // fetched, has items
  | 'STALE' // fetched earlier, older than acceptable
  | 'AMBIGUOUS' // multiple matches, needs clarification
  | 'UNAVAILABLE'; // fetch failed / not supported

/** The granular data domains the coach can snapshot. */
export type ContextDomain = 'tasks' | 'habits' | 'goals' | 'milestones';

/** All snapshot domains — used for broad reviews / summary mode. */
export const ALL_CONTEXT_DOMAINS: ContextDomain[] = [
  'tasks',
  'habits',
  'goals',
  'milestones',
];

/** What a given intent needs from the workspace. */
export interface ContextRequirements {
  /** Snapshot domains to load before answering. */
  domains: ContextDomain[];
  /** Whether live analytics/focus stats are required for this intent. */
  requiresLiveStats: boolean;
}