// backend/src/services/focus.service.ts
// Logs completed focus (Pomodoro) sessions. Sessions are created when the timer
// finishes — the frontend starts the timer locally and POSTs on completion.

import { prisma } from '../lib/prismaClient';
import type { FocusSessionDTO, CreateFocusSessionRequest } from '../types';

function toDTO(s: {
  id: string; userId: string; durationMin: number; startedAt: Date; completed: boolean;
}): FocusSessionDTO {
  return {
    id: s.id, userId: s.userId, durationMin: s.durationMin,
    startedAt: s.startedAt.toISOString(), completed: s.completed,
  };
}

export async function listSessions(userId: string, limit = 20): Promise<{ data: FocusSessionDTO[]; meta: { total: number } }> {
  const [sessions, total] = await Promise.all([
    prisma.focusSession.findMany({
      where: { userId }, orderBy: { startedAt: 'desc' }, take: limit,
    }),
    prisma.focusSession.count({ where: { userId } }),
  ]);
  return { data: sessions.map(toDTO), meta: { total } };
}

export async function logSession(userId: string, data: CreateFocusSessionRequest): Promise<FocusSessionDTO> {
  const session = await prisma.focusSession.create({
    data: {
      userId, durationMin: data.durationMin,
      startedAt: new Date(data.startedAt), completed: data.completed,
    },
  });
  return toDTO(session);
}
