// backend/src/services/focus.service.ts
// Logs completed focus (Pomodoro) sessions. Sessions are created when the timer
// finishes — the frontend starts the timer locally and POSTs on completion.

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import type { FocusSessionDTO, CreateFocusSessionRequest, FocusTimeLogDTO, CreateFocusTimeLogRequest } from '../types';
import * as notifService from './notification.service';
import { awardFocusSession } from './gamification.service';

function toDTO(s: {
  id: string; userId: string; durationMin: number; startedAt: Date; completed: boolean;
  taskId: string | null; projectId: string | null; isBreak: boolean;
}): FocusSessionDTO {
  return {
    id: s.id, userId: s.userId, durationMin: s.durationMin,
    startedAt: s.startedAt.toISOString(), completed: s.completed,
    taskId: s.taskId, projectId: s.projectId, isBreak: s.isBreak,
  };
}

function toTimeLogDTO(l: {
  id: string; userId: string; durationMin: number; date: Date;
}): FocusTimeLogDTO {
  return {
    id: l.id, userId: l.userId, durationMin: l.durationMin,
    date: l.date.toISOString(),
  };
}

export async function listSessions(userId: string, limit = 100): Promise<{ data: FocusSessionDTO[]; meta: { total: number } }> {
  const [sessions, total] = await Promise.all([
    prisma.focusSession.findMany({
      where: { userId }, orderBy: { startedAt: 'desc' }, take: limit,
    }),
    prisma.focusSession.count({ where: { userId } }),
  ]);
  return { data: sessions.map(toDTO), meta: { total } };
}

export async function logSession(userId: string, data: CreateFocusSessionRequest): Promise<FocusSessionDTO> {
  const taskId = data.taskId?.trim() || null;
  const projectId = data.projectId?.trim() || null;

  if (taskId) {
    const task = await prisma.task.findFirst({
      where: { id: taskId, userId },
      select: { id: true },
    });
    if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');
  }

  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!project) throw createError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  const session = await prisma.focusSession.create({
    data: {
      userId, durationMin: data.durationMin,
      startedAt: new Date(data.startedAt), completed: data.completed,
      taskId,
      projectId,
      isBreak: data.isBreak ?? false,
    },
  });

  if (data.completed) {
    await awardFocusSession(userId, session.id, session.durationMin);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { notificationPreferences: true },
    });

    if (user?.notificationPreferences?.focusSessionComplete) {
      await notifService.sendNotification(
        userId,
        `Focus session complete: ${data.durationMin} min`,
        'Your focus block finished successfully.',
        ['BROWSER_PUSH', 'EMAIL'],
      );
    }
  }

  return toDTO(session);
}

export async function logTime(userId: string, data: CreateFocusTimeLogRequest): Promise<FocusTimeLogDTO> {
  const log = await prisma.focusTimeLog.create({
    data: { userId, durationMin: data.durationMin },
  });
  return toTimeLogDTO(log);
}

export async function listTimeLogs(userId: string, days = 7): Promise<FocusTimeLogDTO[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const logs = await prisma.focusTimeLog.findMany({
    where: { userId, date: { gte: since } },
    orderBy: { date: 'desc' },
  });
  return logs.map(toTimeLogDTO);
}
