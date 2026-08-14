# AI Coach Dynamic Entity Schema System

## Overview

The AI Coach now uses a **dynamic schema introspection system** that automatically generates field definitions for entity creation (tasks, habits, goals, projects). This ensures the LLM always knows the correct fields for each entity type and eliminates hardcoded prompts that can become outdated.

## Problem Solved

**Before**: The coach had hardcoded entity creation instructions that:
- Didn't distinguish between task recurrence and habit skipDays
- Required manual updates when new fields were added
- Could become inconsistent with actual TypeScript types
- Led to the AI trying to use wrong fields (e.g., treating habits like tasks)

**After**: Entity schemas are:
- Automatically derived from a single source of truth
- Entity-specific (habits have skipDays, tasks have recurrence)
- Self-documenting with descriptions and examples
- Easy to extend when adding new fields

## Architecture

### Core Files

1. **`src/services/ai/entitySchemas.ts`** (NEW)
   - Defines `EntityFieldDef` and `EntitySchemaDef` types
   - Contains complete field definitions for all 4 entity types
   - Exports helper functions for dynamic prompt generation

2. **`src/services/ai/prompts/coachPrompts.ts`** (UPDATED)
   - Imports `generateEntityCreationPrompt()` from entitySchemas
   - System prompt now includes dynamically generated field specs
   - Removed hardcoded entity creation instructions

3. **`src/services/ai/coachActions.ts`** (UNCHANGED)
   - Already had proper validation for all entity types
   - Correctly handles habit-specific fields like `skipDays`
   - Uses Zod schemas that mirror the entitySchemas definitions

## Entity Schema Structure

Each entity has a schema with:

```typescript
interface EntitySchemaDef {
  entity: 'task' | 'habit' | 'goal' | 'project';
  description: string;
  fields: EntityFieldDef[];
}

interface EntityFieldDef {
  name: string;                    // Field name
  type: EntityFieldType;           // string, date, time, number, enum, array, recurrence
  description: string;             // What this field does
  required: boolean;               // Is this field mandatory?
  default?: any;                   // Default value if not provided
  options?: string[];              // For enum types
  example?: string;                // Example value
  entitySpecific?: boolean;        // Unique to this entity type
}
```

## Key Differences Between Entities

### Tasks
- Use `recurrence` (string pattern) for repeating
- Have `priority`, `status`, `dueDate`, `dueTime`
- Support `subtasks` (array of strings)
- Example recurrence: `"daily-skip:sunday"`, `"weekly:monday,wednesday"`

### Habits
- Use `skipDays` (array of day indices 0-6) NOT recurrence
- Have `targetPerWeek` (number 1-7)
- Have `durationDays` (tracking period or null for forever)
- **Do NOT have** priority, status, or dueDate
- Example skipDays: `[5, 6]` for skip Saturday (5) and Sunday (6)

### Goals
- Use `targetDate` (not dueDate)
- Have `category`, `icon`, `color`
- Support `priority` and `status`
- Link to other entities via `linkedHabitIds`, `linkedTaskIds`

### Projects
- Use `name` (not title)
- Have both `startDate` and `dueDate`
- Have `status` (PLANNING, ACTIVE, ON_HOLD, COMPLETED, CANCELLED)
- Have `color` for theming

## Usage in Prompts

The system prompt now includes:

```typescript
const ENTITY_CREATION_SECTION = generateEntityCreationPrompt();

export const COACH_SYSTEM_PROMPT = `
  ... other instructions ...
  
  ${ENTITY_CREATION_SECTION}
  
  ... response format ...
`;
```

This generates output like:

```
CREATING ENTITIES:
When a user asks to create a task, habit, goal, or project:
  1. Extract ALL available info from the user message immediately
  2. Use the field definitions below to know what fields exist
  3. Return entityDraft with title + all extracted fields
  4. Use null for missing optional fields — NEVER invent data
  5. Use defaults shown below for fields not mentioned by user

FIELD DEFINITIONS BY ENTITY TYPE:

TASK FIELDS (A single actionable task with optional due date...):
  • title (string) REQUIRED — Task title Example: Prepare Q4 board presentation
  • description (string) default: null — Detailed task description Example: Create slides...
  • priority (enum) default: MEDIUM options: LOW|MEDIUM|HIGH|CRITICAL — Task priority level
  ... 12 more fields ...

HABIT FIELDS (A recurring habit tracked daily with optional skip days...):
  • title (string) REQUIRED — Habit title Example: Morning workout
  • targetPerWeek (number) default: 7 — Number of times to complete per week (1-7)
  • skipDays (array) default: null — Array of day numbers to skip: 0=Monday...6=Sunday
  ... 4 more fields ...

GOAL FIELDS (...):
  ... 8 fields ...

PROJECT FIELDS (...):
  ... 7 fields ...

SPECIAL FIELD RULES:
  • Dates: Accept ISO (YYYY-MM-DD) or natural ("tomorrow", "next friday")
  • Times: Accept HH:mm (24h) or natural ("2pm", "14:30", "6am")
  • Recurrence (tasks only): Simple strings like "daily", "daily-skip:sunday"
  • Skip days (habits only): Array of day indices [0-6] where 0=Monday, 6=Sunday
  • Subtasks (tasks only): Array of subtask title strings

ENTITY-SPECIFIC DIFFERENCES:
  • TASKS use "recurrence" for repeating patterns
  • HABITS use "skipDays" array and "targetPerWeek" instead of recurrence
  • HABITS do NOT have priority, status, or dueDate
  • GOALS use "targetDate" not "dueDate"
  • PROJECTS use "name" not "title", have "startDate" and "dueDate"
```

## Adding New Fields

To add a new field to an entity:

1. **Update `entitySchemas.ts`**:
   ```typescript
   const TASK_SCHEMA: EntitySchemaDef = {
     entity: 'task',
     fields: [
       // ... existing fields ...
       {
         name: 'newField',
         type: 'string',
         description: 'What this field does',
         required: false,
         default: null,
         example: 'Example value',
       },
     ],
   };
   ```

2. **Update `coachActions.ts`** validation schema:
   ```typescript
   const CoachTaskDraftSchema = z.object({
     // ... existing fields ...
     newField: z.string().optional().nullable(),
   });
   ```

3. **Update the service layer** (`task.service.ts`, etc.) to handle the new field

That's it! The AI prompt automatically includes the new field in future conversations.

## Testing

To test entity creation with the coach:

```
User: "Create a daily habit for gym workout at 6am, skip weekends"
AI returns: 
{
  "entityDraft": {
    "entity": "habit",
    "title": "Gym workout",
    "fields": {
      "reminderTime": "06:00",
      "skipDays": [5, 6],  // Saturday, Sunday
      "targetPerWeek": 5
    }
  }
}
```

```
User: "Create a weekly task for team standup every Monday and Thursday at 10am"
AI returns:
{
  "entityDraft": {
    "entity": "task",
    "title": "Team standup",
    "fields": {
      "dueTime": "10:00",
      "recurrence": "weekly:monday,thursday",
      "priority": "MEDIUM"
    }
  }
}
```

## Benefits

1. **Type Safety**: Schemas are the single source of truth
2. **Maintainability**: Add/modify fields in one place
3. **Clarity**: LLM sees full field specs with examples
4. **Correctness**: Entity-specific fields are clearly marked
5. **Extensibility**: Easy to add new entity types or fields
6. **Self-Documenting**: Schemas serve as API documentation

## Future Enhancements

Potential improvements:

1. **Auto-generate Zod schemas** from EntitySchemaDef
2. **TypeScript type generation** from schemas
3. **Frontend form generation** using the same schemas
4. **API documentation** auto-generated from schemas
5. **Validation error messages** that reference field descriptions
