// backend/src/config/featureCatalog.ts
// SINGLE SOURCE OF TRUTH for plan feature metadata on the backend.
//
// Every feature key, human label, hint, and default lives here. Consumers
// (custom-plan validation, plan service, seed, audit labels) import from this
// one place so adding/removing a feature is a single-file change.
//
// Priorities:
//  - Numeric features are per-user quotas (value is a number, -1 = unlimited).
//  - Boolean features are on/off entitlements.
//  - Some numeric features are AI-related; when any AI feature is enabled the
//    aiRequestsPerMonth quota must be >= MIN_AI_QUOTA (see entitlement.service).

export const NUMERIC_FEATURE_KEYS = [
  'aiRequestsPerMonth',
  'projects',
  'habits',
  'tasks',
  'storageMb',
  'notes',
  'journals',
] as const;

export type NumericFeatureKey = (typeof NUMERIC_FEATURE_KEYS)[number];

export const BOOLEAN_FEATURE_KEYS = [
  'aiCoach',
  'goals',
  'focusAdvanced',
  'notionSync',
  'voiceNotes',
  'calendarSync',
] as const;

export type BooleanFeatureKey = (typeof BOOLEAN_FEATURE_KEYS)[number];

// Minimum usable AI monthly quota. AI features are only considered granted when
// aiRequestsPerMonth is >= this. Prevents a plan from advertising AI access it
// cannot actually serve.
export const MIN_AI_QUOTA = 1;

export interface NumericFeatureMeta {
  key: NumericFeatureKey;
  label: string;
  hint: string;
  suffix?: string;
  default: number;
}

export interface BooleanFeatureMeta {
  key: BooleanFeatureKey;
  label: string;
  hint: string;
  default: boolean;
}

export const NUMERIC_FEATURES: NumericFeatureMeta[] = [
  { key: 'aiRequestsPerMonth', label: 'AI requests / month', hint: 'AI assistant calls per month', suffix: ' / month', default: 0 },
  { key: 'projects', label: 'Active projects', hint: 'Maximum active projects', default: 3 },
  { key: 'habits', label: 'Habit trackers', hint: 'Maximum active habit trackers', default: 5 },
  { key: 'tasks', label: 'Tasks', hint: 'Maximum active tasks', default: 100 },
  { key: 'storageMb', label: 'Storage (MB)', hint: 'File storage allowance', suffix: ' MB', default: 100 },
  { key: 'notes', label: 'Notes', hint: 'Max notes; -1 for unlimited', default: 10 },
  { key: 'journals', label: 'Journal entries', hint: 'Max journal entries; -1 for unlimited', default: 5 },
];

export const BOOLEAN_FEATURES: BooleanFeatureMeta[] = [
  { key: 'aiCoach', label: 'AI Coach', hint: 'Personal AI productivity coach across the app', default: false },
  { key: 'goals', label: 'Goals', hint: 'Create and manage goals plus the AI goal planner', default: false },
  { key: 'focusAdvanced', label: 'Advanced Focus', hint: 'Custom timer durations + link tasks/goals/projects to the timer', default: false },
  { key: 'notionSync', label: 'Notion sync', hint: 'Sync tasks & notes with Notion', default: false },
  { key: 'voiceNotes', label: 'Voice notes', hint: 'Record and transcribe voice notes', default: false },
  { key: 'calendarSync', label: 'Google Calendar sync', hint: 'Sync tasks with Google Calendar', default: false },
];

// Human-readable label lookup keyed by feature key.
export const FEATURE_LABELS: Record<string, string> = {
  ...Object.fromEntries(NUMERIC_FEATURES.map((f) => [f.key, f.label])),
  ...Object.fromEntries(BOOLEAN_FEATURES.map((f) => [f.key, f.label])),
};

/** Human label for a feature key, falling back to the raw key. */
export function featureLabel(key: string): string {
  return FEATURE_LABELS[key] || key;
}

/** True when the given boolean feature key is an AI-entitlement feature. */
export function isAIFeatureKey(key: string): boolean {
  return key === 'aiCoach' || key === 'goals';
}