// backend/src/services/focus.service.ts
// Manages the full lifecycle of focus sessions:
//   create (start) → update (pause/autosave) → complete (timer finished) → cancel
// XP is only awarded on complete, never on pause/autosave/cancel.

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { checkUserEntitlement } from './entitlement.service';
import type {
  FocusSessionDTO,
  FocusSessionStatus,
  CreateFocusSessionRequest,
  UpdateFocusSessionRequest,
  FocusTimeLogDTO,
  CreateFocusTimeLogRequest,
} from '../types';
import * as notifService from './notification.service';
import { awardFocusSession } from './gamification.service';

// ─── DTO helpers ─────────────────────────────────────────────────────────────

// The free tier allows only the standard Pomodoro preset durations.
const STANDARD_FOCUS_MIN = 25;
const STANDARD_BREAK_MIN = 5;
const STANDARD_LONG_BREAK_MIN = 15;

function isStandardFocusDuration(durationMin: number, isBreak: boolean): boolean {
  if (isBreak) return durationMin === STANDARD_BREAK_MIN || durationMin === STANDARD_LONG_BREAK_MIN;
  return durationMin === STANDARD_FOCUS_MIN;
}

function toDTO(s: any): FocusSessionDTO {
  return {
    id: s.id,
    userId: s.userId,
    durationMin: s.durationMin,
    elapsedMin: s.elapsedMin ?? 0,
    startedAt: s.startedAt.toISOString(),
    status: (s.status ?? 'IN_PROGRESS') as FocusSessionStatus,
    completedAt: s.completedAt?.toISOString() ?? null,
    taskId: s.taskId,
    projectId: s.projectId,
    isBreak: s.isBreak ?? false,
  };
}

function toTimeLogDTO(l: { id: string; userId: string; durationMin: number; date: Date }): FocusTimeLogDTO {
  return {
    id: l.id,
    userId: l.userId,
    durationMin: l.durationMin,
    date: l.date.toISOString(),
  };
}

// ─── List helpers (backward compat) ──────────────────────────────────────────

export async function listSessions(
  userId: string,
  limit = 100
): Promise<{ data: FocusSessionDTO[]; meta: { total: number } }> {
  const [sessions, total] = await Promise.all([
    prisma.focusSession.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    }),
    prisma.focusSession.count({ where: { userId } }),
  ]);
  return { data: sessions.map(toDTO), meta: { total } };
}

// ─── Create (start timer) ────────────────────────────────────────────────────
// Called when the user starts a brand-new timer. Creates a session with
// status=IN_PROGRESS. No XP awarded.

export async function createSession(userId: string, data: CreateFocusSessionRequest): Promise<FocusSessionDTO> {
  let taskId = data.taskId?.trim() || null;
  let projectId = data.projectId?.trim() || null;

  // Focus "advanced" (custom durations or linking a task/goal/project to the
  // timer) is a paid feature. The standard 25/5/15 pomodoro stays free.
  const usesAdvanced =
    Boolean(taskId) ||
    Boolean(projectId) ||
    (typeof data.durationMin === 'number' && !isStandardFocusDuration(data.durationMin, Boolean(data.isBreak)));

  if (usesAdvanced) {
    const entitlement = await checkUserEntitlement(userId, 'focusAdvanced');
    if (!entitlement.allowed) {
      throw createError(
        403,
        'FEATURE_LOCKED',
        `Custom timer durations and linking tasks/goals/projects to the Focus timer require an upgrade (${entitlement.currentEffectivePlan}).`
      );
    }
  }

  if (taskId) {
    const task = await prisma.task.findFirst({
      where: { id: taskId, userId },
      select: { id: true },
    });
    if (!task) taskId = null;
  }

  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!project) projectId = null;
  }

  const session = await prisma.focusSession.create({
    data: {
      userId,
      durationMin: data.durationMin,
      elapsedMin: 0,
      startedAt: new Date(),
      status: 'IN_PROGRESS',
      taskId,
      projectId,
      isBreak: data.isBreak ?? false,
    },
  });

  return toDTO(session);
}

// ─── Update (pause / autosave / resume) ──────────────────────────────────────
// Called on pause, autosave (every 20–30s), and resume to persist elapsed time.
// No XP awarded.

export async function updateSession(
  userId: string,
  sessionId: string,
  data: UpdateFocusSessionRequest
): Promise<FocusSessionDTO> {
  const session = await prisma.focusSession.findFirst({
    where: { id: sessionId, userId, status: 'IN_PROGRESS' },
  });

  if (!session) {
    throw new Error('Session not found or not in progress');
  }

  const updated = await prisma.focusSession.update({
    where: { id: sessionId },
    data: {
      elapsedMin: data.elapsedMin,
      ...(data.status ? { status: data.status } : {}),
    },
  });

  return toDTO(updated);
}

// ─── Complete (timer finished) ───────────────────────────────────────────────
// Called when the timer reaches 0. Awards XP and counts in stats.

export async function completeSession(userId: string, sessionId: string): Promise<FocusSessionDTO> {
  const session = await prisma.focusSession.findFirst({
    where: { id: sessionId, userId, status: 'IN_PROGRESS' },
  });

  if (!session) {
    throw new Error('Session not found or not in progress');
  }

  const now = new Date();
  const updated = await prisma.focusSession.update({
    where: { id: sessionId },
    data: {
      status: 'COMPLETED',
      completedAt: now,
      elapsedMin: session.durationMin, // full duration on completion
    },
  });

  // Award XP — only for completed sessions
  await awardFocusSession(userId, session.id, updated.durationMin);

  // Send notification if user has it enabled
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { notificationPreferences: true },
  });

  if (user?.notificationPreferences?.focusSessionComplete) {
    await notifService.sendNotification(
      userId,
      `Focus session complete: ${updated.durationMin} min`,
      'Your focus block finished successfully.',
      ['BROWSER_PUSH', 'EMAIL']
    );
  }

  return toDTO(updated);
}

// ─── Cancel ──────────────────────────────────────────────────────────────────
// Called when the user cancels a session (e.g., exit without completing).
// No XP awarded, not counted in stats.

export async function cancelSession(userId: string, sessionId: string): Promise<FocusSessionDTO> {
  const session = await prisma.focusSession.findFirst({
    where: { id: sessionId, userId, status: 'IN_PROGRESS' },
  });

  if (!session) {
    throw new Error('Session not found or not in progress');
  }

  const updated = await prisma.focusSession.update({
    where: { id: sessionId },
    data: { status: 'CANCELLED' },
  });

  return toDTO(updated);
}

// ─── Get active session (for refresh recovery) ───────────────────────────────
// Returns the latest IN_PROGRESS session for the user, if any.
// The frontend uses this to recover timer state on page refresh.

export async function getActiveSession(userId: string): Promise<FocusSessionDTO | null> {
  const session = await prisma.focusSession.findFirst({
    where: { userId, status: 'IN_PROGRESS' },
    orderBy: { startedAt: 'desc' },
  });

  return session ? toDTO(session) : null;
}

// ─── Legacy time log support ─────────────────────────────────────────────────

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
