// backend/src/services/ai/entitySchemas.ts
// Dynamic entity schema introspection for AI coach entity creation.
// This provides field definitions for tasks, habits, goals, and projects
// so the LLM knows EXACTLY what fields are available.

export type EntityFieldType = 'string' | 'date' | 'time' | 'number' | 'boolean' | 'enum' | 'array' | 'recurrence';

export interface EntityFieldDef {
  name: string;
  type: EntityFieldType;
  description: string;
  required: boolean;
  default?: string | number | boolean | null;
  options?: string[]; // For enum types
  example?: string;
  /** If true, this field is specific to this entity and not shared */
  entitySpecific?: boolean;
}

export interface EntitySchemaDef {
  entity: 'task' | 'habit' | 'goal' | 'project';
  description: string;
  fields: EntityFieldDef[];
}

// ─── TASK SCHEMA ──────────────────────────────────────────────────────────────

const TASK_SCHEMA: EntitySchemaDef = {
  entity: 'task',
  description: 'A single actionable task with optional due date, priority, recurrence, and subtasks',
  fields: [
    {
      name: 'title',
      type: 'string',
      description: 'Task title',
      required: true,
      example: 'Prepare Q4 board presentation',
    },
    {
      name: 'description',
      type: 'string',
      description: 'Detailed task description',
      required: false,
      default: null,
      example: 'Create slides covering financial data and projections',
    },
    {
      name: 'priority',
      type: 'enum',
      description: 'Task priority level',
      required: false,
      default: 'MEDIUM',
      options: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      example: 'HIGH',
    },
    {
      name: 'status',
      type: 'enum',
      description: 'Current task status',
      required: false,
      default: 'TODO',
      options: ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'],
      example: 'TODO',
    },
    {
      name: 'dueDate',
      type: 'date',
      description: 'Due date in ISO format (YYYY-MM-DD) or natural language like "tomorrow", "next friday"',
      required: false,
      default: null,
      example: '2024-12-25 or "next friday"',
    },
    {
      name: 'dueTime',
      type: 'time',
      description: 'Due time in HH:mm format or natural like "2pm", "14:30"',
      required: false,
      default: null,
      example: '14:00 or "2pm"',
    },
    {
      name: 'reminderTime',
      type: 'time',
      description: 'Reminder time in HH:mm or natural format',
      required: false,
      default: null,
      example: '13:00 or "1pm"',
    },
    {
      name: 'reminderMessage',
      type: 'string',
      description: 'Custom reminder message',
      required: false,
      default: null,
      example: 'Time for final review',
    },
    {
      name: 'estimatedDuration',
      type: 'number',
      description: 'Estimated duration in minutes',
      required: false,
      default: null,
      example: '90',
    },
    {
      name: 'recurrence',
      type: 'recurrence',
      description:
        'Recurrence pattern as simple string: "daily", "daily-skip:sunday", "weekly:monday,wednesday", "monthly:15", "quarterly", "yearly"',
      required: false,
      default: null,
      example: 'daily-skip:sunday',
      entitySpecific: true,
    },
    {
      name: 'projectId',
      type: 'string',
      description: 'Link to project ID',
      required: false,
      default: null,
      example: 'proj_123',
    },
    {
      name: 'goalId',
      type: 'string',
      description: 'Link to goal ID',
      required: false,
      default: null,
      example: 'goal_456',
    },
    {
      name: 'subTasks',
      type: 'array',
      description: 'Array of subtask titles',
      required: false,
      default: null,
      example: '["Gather financial data", "Create slide deck", "Get CEO approval"]',
      entitySpecific: true,
    },
  ],
};

// ─── HABIT SCHEMA ─────────────────────────────────────────────────────────────

const HABIT_SCHEMA: EntitySchemaDef = {
  entity: 'habit',
  description: 'A recurring habit tracked daily with optional skip days and target completions per week',
  fields: [
    {
      name: 'title',
      type: 'string',
      description: 'Habit title',
      required: true,
      example: 'Morning workout',
    },
    {
      name: 'targetPerWeek',
      type: 'number',
      description: 'Number of times to complete per week (1-7)',
      required: false,
      default: 7,
      example: '5',
    },
    {
      name: 'reminderTime',
      type: 'time',
      description: 'Daily reminder time in HH:mm or natural format',
      required: false,
      default: null,
      example: '06:00 or "6am"',
    },
    {
      name: 'reminderMessage',
      type: 'string',
      description: 'Custom reminder message',
      required: false,
      default: null,
      example: 'Time to move!',
    },
    {
      name: 'durationDays',
      type: 'number',
      description: 'Number of days to track this habit (null = forever)',
      required: false,
      default: null,
      example: '90',
    },
    {
      name: 'skipDays',
      type: 'array',
      description:
        'Array of FULL day names the habit is skipped on, e.g. ["Saturday","Sunday"]. Use day names (not numbers): monday,tuesday,wednesday,thursday,friday,saturday,sunday',
      required: false,
      default: null,
      example: '["Saturday", "Sunday"] to skip the weekend',
      entitySpecific: true,
    },
    {
      name: 'goalId',
      type: 'string',
      description: 'Link to goal ID',
      required: false,
      default: null,
      example: 'goal_789',
    },
  ],
};

// ─── GOAL SCHEMA ──────────────────────────────────────────────────────────────

const GOAL_SCHEMA: EntitySchemaDef = {
  entity: 'goal',
  description: 'A high-level objective with optional target date, milestones, and linked entities',
  fields: [
    {
      name: 'title',
      type: 'string',
      description: 'Goal title',
      required: true,
      example: 'Launch freelance consulting business',
    },
    {
      name: 'description',
      type: 'string',
      description: 'Detailed goal description',
      required: false,
      default: null,
      example: 'Build sustainable side income with 3 paying clients',
    },
    {
      name: 'priority',
      type: 'enum',
      description: 'Goal priority level',
      required: false,
      default: 'MEDIUM',
      options: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      example: 'HIGH',
    },
    {
      name: 'status',
      type: 'enum',
      description: 'Current goal status',
      required: false,
      default: 'ACTIVE',
      options: ['ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'],
      example: 'ACTIVE',
    },
    {
      name: 'targetDate',
      type: 'date',
      description: 'Target completion date in ISO format or natural language',
      required: false,
      default: null,
      example: '2027-03-31 or "end of Q1 2027"',
    },
    {
      name: 'category',
      type: 'string',
      description: 'Goal category/theme',
      required: false,
      default: null,
      example: 'Career',
    },
    {
      name: 'icon',
      type: 'string',
      description: 'Icon name for goal visualization',
      required: false,
      default: null,
      example: 'rocket',
      entitySpecific: true,
    },
    {
      name: 'color',
      type: 'string',
      description: 'Color hex code or name',
      required: false,
      default: '#3b82f6',
      example: 'blue or #3b82f6',
    },
  ],
};

// ─── PROJECT SCHEMA ───────────────────────────────────────────────────────────

const PROJECT_SCHEMA: EntitySchemaDef = {
  entity: 'project',
  description: 'A multi-task initiative with start/end dates and status tracking',
  fields: [
    {
      name: 'name',
      type: 'string',
      description: 'Project name',
      required: true,
      example: 'Home office renovation',
    },
    {
      name: 'description',
      type: 'string',
      description: 'Detailed project description',
      required: false,
      default: null,
      example: 'Redesign workspace, purchase furniture, setup tech equipment',
    },
    {
      name: 'status',
      type: 'enum',
      description: 'Current project status',
      required: false,
      default: 'ACTIVE',
      options: ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'],
      example: 'ACTIVE',
    },
    {
      name: 'color',
      type: 'string',
      description: 'Color hex code or name for project theme',
      required: false,
      default: '#8b5cf6',
      example: 'purple or #8b5cf6',
    },
    {
      name: 'startDate',
      type: 'date',
      description: 'Project start date in ISO format or natural language',
      required: false,
      default: null,
      example: '2024-12-01 or "today"',
    },
    {
      name: 'dueDate',
      type: 'date',
      description: 'Project due date in ISO format or natural language',
      required: false,
      default: null,
      example: '2024-12-15 or "end of month"',
    },
    {
      name: 'goalId',
      type: 'string',
      description: 'Link to goal ID',
      required: false,
      default: null,
      example: 'goal_123',
    },
  ],
};

// ─── SCHEMA REGISTRY ──────────────────────────────────────────────────────────

export const ENTITY_SCHEMAS: Record<string, EntitySchemaDef> = {
  task: TASK_SCHEMA,
  habit: HABIT_SCHEMA,
  goal: GOAL_SCHEMA,
  project: PROJECT_SCHEMA,
};

// ─── DYNAMIC PROMPT GENERATION ────────────────────────────────────────────────

/**
 * Generates a concise field list for the LLM prompt based on the entity schema.
 * This ensures the AI knows exactly what fields are available for each entity type.
 */
export function generateEntityFieldsPrompt(entity: 'task' | 'habit' | 'goal' | 'project'): string {
  const schema = ENTITY_SCHEMAS[entity];
  if (!schema) return '';

  const lines: string[] = [`${entity.toUpperCase()} FIELDS (${schema.description}):`];

  for (const field of schema.fields) {
    const parts: string[] = [`  • ${field.name} (${field.type})`];

    if (field.required) {
      parts.push('REQUIRED');
    } else if (field.default !== undefined) {
      parts.push(`default: ${field.default}`);
    }

    if (field.options) {
      parts.push(`options: ${field.options.join('|')}`);
    }

    parts.push(`— ${field.description}`);

    if (field.example) {
      parts.push(`Example: ${field.example}`);
    }

    lines.push(parts.join(' '));
  }

  return lines.join('\n');
}

/**
 * Generates a complete entity creation section for the system prompt.
 * This dynamically includes ALL entity schemas so the LLM always knows
 * the current field structure without manual updates.
 */
export function generateEntityCreationPrompt(): string {
  const sections: string[] = [
    'CREATING ENTITIES:',
    'When a user asks to create a task, habit, goal, or project:',
    '  1. Extract ALL available info from the user message immediately',
    '  2. Use the field definitions below to know what fields exist',
    '  3. Return entityDraft with title + all extracted fields',
    '  4. Use null for missing optional fields — NEVER invent data',
    '  5. Use defaults shown below for fields not mentioned by user',
    '',
    'FIELD DEFINITIONS BY ENTITY TYPE:',
    '',
  ];

  // Add each entity schema
  for (const entity of ['task', 'habit', 'goal', 'project'] as const) {
    sections.push(generateEntityFieldsPrompt(entity));
    sections.push('');
  }

  sections.push('ENTITY-TYPE SELECTION RULE (CRITICAL):');
  sections.push('  • Decide the entity type from the user\'s words FIRST — never default to "task".');
  sections.push(
    '  • Words like "habit", "routine", "track", "build a habit" or a repeatable daily/weekly behavior => entity: "habit".'
  );
  sections.push('  • "task"/"to-do"/"remind me to" => entity: "task".');
  sections.push(
    '  • A habit request MUST NOT be a task. Never put task-only fields (recurrence, priority, status, dueDate) in a habit draft.'
  );
  sections.push(
    '  • Set "entityDraft.entity" to exactly "habit" for any habit request, and use only the habit field set below.'
  );
  sections.push(
    '  • NEGATIVE GUARD: If the user says any of "every day", "daily", "skip ... days", "remind me at", "habit", "routine", "track", "commit for", or names rest days — this is ALWAYS a habit, NEVER a task. Output entity:"habit".'
  );
  sections.push('');
  sections.push('SPECIAL FIELD RULES:');
  sections.push('  • Dates: Accept ISO (YYYY-MM-DD) or natural ("tomorrow", "next friday", "end of month")');
  sections.push('  • Times: Accept HH:mm (24h) or natural ("2pm", "14:30", "6am")');
  sections.push(
    '  • Recurrence (tasks only): Simple strings like "daily", "daily-skip:sunday", "weekly:monday,wednesday", "monthly:15"'
  );
  sections.push(
    '  • Skip days (habits only): Array of FULL day names to skip, e.g. "Saturday" and "Sunday". Use the names, never numbers: ["Saturday","Sunday"].'
  );
  sections.push('  • Subtasks (tasks only): Array of subtask title strings under the field "subTasks"');
  sections.push('');
  sections.push('ENTITY-SPECIFIC DIFFERENCES:');
  sections.push('  • TASKS use "recurrence" for repeating patterns');
  sections.push('  • HABITS use "skipDays" array and "targetPerWeek" instead of recurrence');
  sections.push('  • HABITS do NOT have priority, status, or dueDate');
  sections.push('  • GOALS use "targetDate" not "dueDate"');
  sections.push('  • PROJECTS use "name" not "title", have "startDate" and "dueDate"');

  return sections.join('\n');
}

/**
 * Gets the list of required fields for an entity type.
 */
export function getRequiredFields(entity: 'task' | 'habit' | 'goal' | 'project'): string[] {
  const schema = ENTITY_SCHEMAS[entity];
  return schema.fields.filter((f) => f.required).map((f) => f.name);
}

/**
 * Gets all field names for an entity type (for validation).
 */
export function getAllFields(entity: 'task' | 'habit' | 'goal' | 'project'): string[] {
  const schema = ENTITY_SCHEMAS[entity];
  return schema.fields.map((f) => f.name);
}

/**
 * Gets entity-specific fields (fields that only this entity has).
 */
export function getEntitySpecificFields(entity: 'task' | 'habit' | 'goal' | 'project'): string[] {
  const schema = ENTITY_SCHEMAS[entity];
  return schema.fields.filter((f) => f.entitySpecific).map((f) => f.name);
}
