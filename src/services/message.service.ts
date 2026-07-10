// backend/src/services/message.service.ts
// System messages and notifications service for personal productivity insights

import { prisma } from '../lib/prismaClient';
import type {
  MessageDTO,
  CreateMessageRequest,
  UpdateMessageRequest,
  ListResponse,
} from '../types';

/** Convert Prisma Message to MessageDTO */
function toDTO(message: any): MessageDTO {
  return {
    id: message.id,
    type: message.type,
    content: message.content,
    userId: message.userId,
    projectId: message.projectId,
    status: message.status,
    readAt: message.readAt?.toISOString() ?? null,
    priority: message.priority,
    actionUrl: message.actionUrl,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    project: message.project,
  };
}

/** Get all messages for a user */
export async function listMessages(userId: string, filters?: {
  type?: string;
  status?: string;
  limit?: number;
}): Promise<ListResponse<MessageDTO>> {
  const messages = await prisma.message.findMany({
    where: {
      userId,
      ...(filters?.type && { type: filters.type as any }),
      ...(filters?.status && { status: filters.status as any }),
    },
    include: {
      project: true,
    },
    orderBy: { createdAt: 'desc' },
    take: filters?.limit ?? 50,
  });

  return {
    data: messages.map(toDTO),
    meta: { total: messages.length },
  };
}

/** Get unread message count */
export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.message.count({
    where: { userId, status: 'SENT' },
  });
}

/** Get a single message */
export async function getMessage(userId: string, messageId: string): Promise<MessageDTO> {
  const message = await prisma.message.findFirst({
    where: { id: messageId, userId },
    include: { project: true },
  });

  if (!message) throw new Error('Message not found');

  return toDTO(message);
}

/** Create a new message/notification */
export async function createMessage(
  userId: string,
  req: CreateMessageRequest
): Promise<MessageDTO> {
  const message = await prisma.message.create({
    data: {
      userId,
      type: req.type ?? 'SYSTEM',
      content: req.content,
      projectId: req.projectId ?? null,
      priority: req.priority ?? 'NORMAL',
      actionUrl: req.actionUrl ?? null,
      status: 'SENT',
    },
    include: { project: true },
  });

  return toDTO(message);
}

/** Mark a message as read */
export async function markAsRead(userId: string, messageId: string): Promise<MessageDTO> {
  const existing = await prisma.message.findFirst({
    where: { id: messageId, userId },
  });

  if (!existing) throw new Error('Message not found');

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: {
      status: 'READ',
      readAt: new Date(),
    },
    include: { project: true },
  });

  return toDTO(updated);
}

/** Mark all messages as read */
export async function markAllAsRead(userId: string): Promise<void> {
  await prisma.message.updateMany({
    where: { userId, status: 'SENT' },
    data: {
      status: 'READ',
      readAt: new Date(),
    },
  });
}

/** Delete a message */
export async function deleteMessage(userId: string, messageId: string): Promise<void> {
  const existing = await prisma.message.findFirst({
    where: { id: messageId, userId },
  });

  if (!existing) throw new Error('Message not found');

  await prisma.message.delete({ where: { id: messageId } });
}

/** System helper: Create achievement message */
export async function createAchievementMessage(
  userId: string,
  achievement: string,
  description: string
): Promise<void> {
  await createMessage(userId, {
    type: 'ACHIEVEMENT',
    content: achievement,
    priority: 'HIGH',
  });
}

/** System helper: Create project deadline reminder */
export async function createProjectDeadlineReminder(
  userId: string,
  projectId: string,
  daysUntilDue: number
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) return;

  await createMessage(userId, {
    type: 'REMINDER',
    content: `Project "${project.name}" is due in ${daysUntilDue} ${daysUntilDue === 1 ? 'day' : 'days'}`,
    projectId,
    priority: daysUntilDue <= 2 ? 'HIGH' : 'NORMAL',
    actionUrl: `/projects/${projectId}`,
  });
}

/** System helper: Create streak milestone message */
export async function createStreakMilestone(
  userId: string,
  habitName: string,
  streakDays: number
): Promise<void> {
  await createMessage(userId, {
    type: 'ACHIEVEMENT',
    content: `🔥 ${streakDays}-day streak on "${habitName}"!`,
    priority: 'NORMAL',
    actionUrl: '/habits',
  });
}
