// backend/src/services/ai/prompts/entityPrompts.ts
// Per-entity field definitions used by the AI coach when it needs to create
// an entity on behalf of the user. The LLM is only ever given these
// pre-validated option sets — it can never hallucinate invalid values.

// ─── Option sets (mirrors the real form / DB enums) ───────────────────────────

export const TASK_PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
// Recurrence is now a structured object, not a simple string enum.
// The LLM should return recurrenceConfig with these fields populated.
export const TASK_RECURRENCE_FREQUENCY_OPTIONS = ['day', 'week', 'month', 'year'] as const;
export const TASK_RECURRENCE_WEEKDAY_OPTIONS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export const TASK_RECURRENCE_ENDS_TYPE_OPTIONS = ['never', 'date', 'occurrences'] as const;
export const TASK_STATUS_OPTIONS = ['TODO', 'IN_PROGRESS'] as const;

export const HABIT_SKIP_DAY_OPTIONS = [
  { label: 'Monday', value: 0 },
  { label: 'Tuesday', value: 1 },
  { label: 'Wednesday', value: 2 },
  { label: 'Thursday', value: 3 },
  { label: 'Friday', value: 4 },
  { label: 'Saturday', value: 5 },
  { label: 'Sunday', value: 6 },
] as const;

export const GOAL_STATUS_OPTIONS = ['ACTIVE', 'PAUSED'] as const;
export const GOAL_CATEGORY_OPTIONS = [
  'Health',
  'Career',
  'Learning',
  'Finance',
  'Personal',
  'Creative',
  'Fitness',
  'Relationships',
] as const;
export const GOAL_PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const PROJECT_STATUS_OPTIONS = [
  'PLANNING',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
] as const;

// ─── CoachOptionGroup ─────────────────────────────────────────────────────────
// Returned by the coach when the user wants to create an entity but didn't
// provide enough info. The frontend renders these as selectable chips.

export interface CoachMissingField {
  /** Internal field key matching the entity's request DTO */
  field: string;
  /** Human-readable label for the UI */
  label: string;
  /** Pre-validated options the user can pick from */
  options: string[];
  /** Whether the field is required for creation */
  required: boolean;
}

export interface CoachOptionGroup {
  entity: 'task' | 'habit' | 'goal' | 'project';
  /** What the coach understood the user wants to create */
  entityTitle: string;
  /** Fields still needed — only the ones that weren't provided in the message */
  missingFields: CoachMissingField[];
}

// ─── Field definitions per entity ────────────────────────────────────────────

/** Fields the coach should ask about for task creation */
export const TASK_FIELDS: CoachMissingField[] = [
  {
    field: 'priority',
    label: 'Priority',
    options: [...TASK_PRIORITY_OPTIONS],
    required: false,
  },
  {
    field: 'dueDate',
    label: 'Due date',
    options: ['Today', 'Tomorrow', 'This week', 'Next week', 'No due date'],
    required: false,
  },
  {
    field: 'reminderTime',
    label: 'Reminder',
    options: ['Morning (08:00)', 'Noon (12:00)', 'Evening (18:00)', 'No reminder'],
    required: false,
  },
  // Note: recurrence is now a structured object (recurrenceConfig), not a simple field.
  // The LLM handles it directly in entityDraft.fields.recurrenceConfig as JSON.
];

/** Fields the coach should ask about for habit creation */
export const HABIT_FIELDS: CoachMissingField[] = [
  {
    field: 'skipDays',
    label: 'Rest days',
    options: HABIT_SKIP_DAY_OPTIONS.map((d) => d.label),
    required: false,
  },
  {
    field: 'reminderTime',
    label: 'Reminder time',
    options: ['Morning (07:00)', 'Midday (12:00)', 'Evening (19:00)', 'Night (21:00)', 'No reminder'],
    required: false,
  },
];

/** Fields the coach should ask about for goal creation */
export const GOAL_FIELDS: CoachMissingField[] = [
  {
    field: 'category',
    label: 'Category',
    options: [...GOAL_CATEGORY_OPTIONS],
    required: false,
  },
  {
    field: 'priority',
    label: 'Priority',
    options: [...GOAL_PRIORITY_OPTIONS],
    required: false,
  },
  {
    field: 'targetDate',
    label: 'Target date',
    options: ['1 month', '3 months', '6 months', '1 year', 'No target date'],
    required: false,
  },
];

/** Fields the coach should ask about for project creation */
export const PROJECT_FIELDS: CoachMissingField[] = [
  {
    field: 'status',
    label: 'Status',
    options: [...PROJECT_STATUS_OPTIONS],
    required: false,
  },
  {
    field: 'dueDate',
    label: 'Due date',
    options: ['1 week', '2 weeks', '1 month', '3 months', 'No due date'],
    required: false,
  },
];

export function getEntityFields(entity: 'task' | 'habit' | 'goal' | 'project'): CoachMissingField[] {
  switch (entity) {
    case 'task':
      return TASK_FIELDS;
    case 'habit':
      return HABIT_FIELDS;
    case 'goal':
      return GOAL_FIELDS;
    case 'project':
      return PROJECT_FIELDS;
  }
}

// ─── Gather-options prompt template ──────────────────────────────────────────
// Injected into the coach system prompt only when a CRUD intent is detected.

export function buildEntityGatherPrompt(entity: 'task' | 'habit' | 'goal' | 'project'): string {
  const fields = getEntityFields(entity);
  const fieldDescriptions = fields
    .map((f) => `  - ${f.field} (${f.label}): options = [${f.options.map((o) => `"${o}"`).join(', ')}]`)
    .join('\n');

  return `
ENTITY CREATION MODE — ${entity.toUpperCase()}:
The user wants to create a ${entity}. Extract what they provided.
For any field not clearly stated, ask only once with the predefined options below.
NEVER invent values outside the listed options.
When ready to confirm, output an extra "entityDraft" key in your JSON:

"entityDraft": {
  "entity": "${entity}",
  "title": "<extracted title>",
  "fields": { <field>: <value or null> }
}

Available fields and valid options:
${fieldDescriptions}

If the title is missing entirely, ask for it first before anything else.
`;
}
