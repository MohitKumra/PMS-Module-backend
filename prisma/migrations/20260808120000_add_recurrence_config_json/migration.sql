-- AddColumn: recurrenceConfig JSON on Task table
-- Stores the full TaskRecurrenceConfig object for advanced recurrence settings.
-- The legacy recurrenceRule RRULE string is preserved for backward compatibility.
-- Existing tasks will have recurrenceConfig = NULL and continue using recurrenceRule only.

ALTER TABLE "Task" ADD COLUMN "recurrenceConfig" JSONB;
