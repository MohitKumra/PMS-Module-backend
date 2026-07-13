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
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';
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
    sourceLabel: task.status === 'DONE' ? 'Completed task' : 'Task due date',
    metadata: {
      description: task.description,
    },
  };
}

function mapFocusEvent(session: {
  id: string;
  startedAt: Date;
  durationMin: number;
  completed: boolean;
}): CalendarEventDTO {
  const startAt = session.startedAt;
  const endAt = addMinutes(startAt, session.durationMin);
  return {
    id: `focus-${session.id}`,
    type: 'FOCUS_SESSION',
    title: session.completed ? 'Focus session' : 'Incomplete focus session',
    startAt: toIsoDate(startAt),
    endAt: toIsoDate(endAt),
    allDay: false,
    taskId: null,
    priority: null,
    status: null,
    sourceLabel: session.completed ? 'Pomodoro' : 'Focus draft',
    metadata: {
      durationMin: session.durationMin,
    },
  };
}

export async function getCalendarOverview(
  userId: string,
  range: { from: string; to: string },
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

  const events = [
    ...tasks.map(mapTaskEvent),
    ...sessions.map(mapFocusEvent),
  ].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

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
