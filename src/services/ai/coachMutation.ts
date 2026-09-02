// backend/src/services/ai/coachMutation.ts
// Deterministic mutation execution for the AI Coach (spec §13 Phase 4).
// Allows the coach to execute simple, high-confidence mutations (complete task,
// reschedule task, delete task, complete habit) with zero LLM latency and 100% reliability.

import { prisma } from '../../lib/prismaClient';
import { updateTask, deleteTask } from '../task.service';
import { toggleCompletion } from '../habit.service';
import type { CoachIntent } from './coachIntent';
import type { AICoachResult } from './aiService';

export interface MutationExecutionOptions {
  intent: CoachIntent;
  entityId: string;
  entityType: 'task' | 'habit';
  extractedDate?: string;
  fields?: Record<string, any>;
}

export interface CoachMutationResult {
  success: boolean;
  message: string;
  title: string;
  result: AICoachResult;
}

/**
 * Execute a mutation on behalf of the user after high-confidence resolution.
 */
export async function executeCoachMutation(
  userId: string,
  options: MutationExecutionOptions
): Promise<CoachMutationResult | null> {
  const { intent, entityId, entityType, extractedDate } = options;

  if (entityType === 'task') {
    const task = await prisma.task.findFirst({
      where: { id: entityId, userId },
      select: { id: true, title: true, status: true, dueDate: true },
    });

    if (!task) {
      return {
        success: false,
        title: 'Task Not Found',
        message: 'That task could not be found or may have already been removed.',
        result: {
          title: 'Task Not Found',
          message: 'That task could not be found or may have already been removed.',
          suggestion: {
            text: 'View open tasks',
            actionLabel: 'Open Tasks',
            actionType: 'open_tasks',
          },
          mood: 'encouraging',
          source: 'ai',
        },
      };
    }

    // ── TASK_COMPLETE ───────────────────────────────────────────────────────
    if (intent === 'task_complete') {
      if (task.status === 'DONE') {
        return {
          success: true,
          title: 'Already Completed',
          message: `"${task.title}" is already marked as completed.`,
          result: {
            title: 'Already Completed',
            message: `"${task.title}" is already marked as completed.`,
            suggestion: {
              text: 'View your remaining tasks',
              actionLabel: 'View Tasks',
              actionType: 'open_tasks',
            },
            mood: 'celebratory',
            source: 'ai',
          },
        };
      }

      await updateTask(userId, entityId, { status: 'DONE' });
      return {
        success: true,
        title: 'Task Completed',
        message: `Done! "${task.title}" has been marked as complete.`,
        result: {
          title: 'Task Completed',
          message: `Done! "${task.title}" has been marked as complete.`,
          suggestion: {
            text: 'Great work! Check your next task.',
            actionLabel: 'Next Task',
            actionType: 'open_tasks',
          },
          mood: 'celebratory',
          source: 'ai',
        },
      };
    }

    // ── TASK_DELETE ─────────────────────────────────────────────────────────
    if (intent === 'task_delete') {
      await deleteTask(userId, entityId);
      return {
        success: true,
        title: 'Task Deleted',
        message: `Done! "${task.title}" has been deleted.`,
        result: {
          title: 'Task Deleted',
          message: `Done! "${task.title}" has been deleted.`,
          suggestion: {
            text: 'View your task list',
            actionLabel: 'Open Tasks',
            actionType: 'open_tasks',
          },
          mood: 'encouraging',
          source: 'ai',
        },
      };
    }

    // ── TASK_RESCHEDULE ─────────────────────────────────────────────────────
    if (intent === 'task_reschedule' && extractedDate) {
      await updateTask(userId, entityId, { dueDate: extractedDate });
      return {
        success: true,
        title: 'Task Rescheduled',
        message: `Done! "${task.title}" is now rescheduled to ${extractedDate}.`,
        result: {
          title: 'Task Rescheduled',
          message: `Done! "${task.title}" is now rescheduled to ${extractedDate}.`,
          suggestion: {
            text: 'View updated schedule',
            actionLabel: 'View Tasks',
            actionType: 'open_tasks',
          },
          mood: 'encouraging',
          source: 'ai',
        },
      };
    }
  }

  if (entityType === 'habit') {
    const habit = await prisma.habit.findFirst({
      where: { id: entityId, userId },
      select: { id: true, title: true },
    });

    if (!habit) {
      return {
        success: false,
        title: 'Habit Not Found',
        message: 'That habit could not be found.',
        result: {
          title: 'Habit Not Found',
          message: 'That habit could not be found.',
          suggestion: {
            text: 'Open habits list',
            actionLabel: 'Open Habits',
            actionType: 'open_habits',
          },
          mood: 'encouraging',
          source: 'ai',
        },
      };
    }

    // ── HABIT_COMPLETE ──────────────────────────────────────────────────────
    if (intent === 'habit_complete') {
      await toggleCompletion(userId, entityId);
      return {
        success: true,
        title: 'Habit Completed',
        message: `Awesome! "${habit.title}" is marked as done for today.`,
        result: {
          title: 'Habit Completed',
          message: `Awesome! "${habit.title}" is marked as done for today.`,
          suggestion: {
            text: 'Keep the streak alive!',
            actionLabel: 'Open Habits',
            actionType: 'open_habits',
          },
          mood: 'celebratory',
          source: 'ai',
        },
      };
    }
  }

  return null;
}
