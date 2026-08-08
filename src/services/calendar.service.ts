import { prisma } from '../lib/prismaClient';
import type { CalendarOverviewDTO, CalendarEventDTO } from '../types';

function parseDateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function toIsoDate(date: Date): string {
  return date.toISOString();
}

function normalizeEndOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function mapTaskEvent(task: {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
}): CalendarEventDTO {
  const startAt = task.dueDate ?? new Date();
  return {
    id: `task-${task.id}`,
    type: 'TASK_DUE',
    title: task.title,
    startAt: toIsoDate(startAt),
    endAt: toIsoDate(normalizeEndOfDay(startAt)),
    allDay: true,
    taskId: task.id,
    priority: task.priority,
    status: task.status,
    sourceLabel:
      task.status === 'DONE' ? 'Completed task' : task.status === 'CANCELLED' ? 'Cancelled task' : 'Task due date',
    metadata: {
      description: task.description,
    },
  };
}

function mapFocusEvent(session: any): CalendarEventDTO {
  const startAt = session.startedAt;
  const endAt = addMinutes(startAt, session.durationMin);
  const isBreakSession = session.isBreak;
  const isCompleted = (session.status ?? 'IN_PROGRESS') === 'COMPLETED';
  return {
    id: `focus-${session.id}`,
    type: 'FOCUS_SESSION',
    title: isBreakSession
      ? isCompleted
        ? 'Break'
        : 'Incomplete break'
      : isCompleted
        ? 'Focus session'
        : 'Incomplete focus session',
    startAt: toIsoDate(startAt),
    endAt: toIsoDate(endAt),
    allDay: false,
    taskId: null,
    priority: null,
    status: null,
    sourceLabel: isBreakSession ? 'Break' : isCompleted ? 'Pomodoro' : 'Focus draft',
    metadata: {
      durationMin: session.durationMin,
    },
  };
}

export async function getCalendarOverview(
  userId: string,
  range: { from: string; to: string }
): Promise<CalendarOverviewDTO> {
  const from = parseDateOnly(range.from);
  const to = normalizeEndOfDay(parseDateOnly(range.to));

  const [tasks, sessions] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        dueDate: {
          gte: from,
          lte: to,
        },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.focusSession.findMany({
      where: {
        userId,
        startedAt: {
          gte: from,
          lte: to,
        },
      },
      orderBy: { startedAt: 'asc' },
    }),
  ]);

  // Filter out and clean up duplicate TODO tasks on dates where a task was already completed
  const doneTaskKeys = new Set<string>();
  for (const t of tasks) {
    if (t.status === 'DONE' && t.dueDate) {
      const rootId = t.parentTaskId ?? t.id;
      const dateKey = t.dueDate.toISOString().split('T')[0];
      doneTaskKeys.add(`${rootId}_${dateKey}`);
    }
  }

  const toDeleteIds: string[] = [];
  const filteredTasks = tasks.filter((t) => {
    if (t.status !== 'DONE' && t.dueDate) {
      const rootId = t.parentTaskId ?? t.id;
      const dateKey = t.dueDate.toISOString().split('T')[0];
      if (doneTaskKeys.has(`${rootId}_${dateKey}`)) {
        toDeleteIds.push(t.id);
        return false;
      }
    }
    return true;
  });

  if (toDeleteIds.length > 0) {
    prisma.task.deleteMany({ where: { id: { in: toDeleteIds } } }).catch((err) => {
      console.error('[CalendarService] Error cleaning up duplicate tasks:', err);
    });
  }

  const events = [...filteredTasks.map(mapTaskEvent), ...sessions.map(mapFocusEvent)].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
  );

  return {
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
    events,
    meta: {
      totalEvents: events.length,
      taskEvents: tasks.length,
      focusEvents: sessions.length,
    },
  };
}
