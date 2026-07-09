// backend/src/services/notification.service.ts
// Handles decisions of when and how to notify users, registers subscription tokens,
// and implements delivery across multiple channels (Web Push, Email).

import { prisma } from '../lib/prismaClient';
import { sendPush, PushSubscription } from '../lib/pushSender';
import { sendMail } from '../lib/mailer';
import { createError } from '../middleware/errorHandler';
import type { NotificationChannel } from '../../../shared/types';

/** Saves or updates a user's web push subscription. */
export async function registerPushSubscription(userId: string, subscription: PushSubscription): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw createError(404, 'USER_NOT_FOUND', 'User not found');

  await prisma.user.update({
    where: { id: userId },
    data: {
      pushSubscription: JSON.stringify(subscription),
    },
  });
}

/** Remove a web push subscription. */
export async function unregisterPushSubscription(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      pushSubscription: null,
    },
  });
}

/** Logs and delivers a notification across the requested channels. */
export async function sendNotification(
  userId: string,
  title: string,
  body: string,
  channels: NotificationChannel[]
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    console.error(`❌  Notification Service: User ${userId} not found`);
    return;
  }

  // Create log entries in parallel
  const logPromises = channels.map((channel) =>
    prisma.notificationLog.create({
      data: {
        userId,
        channel,
        title,
        body,
      },
    })
  );
  await Promise.all(logPromises);

  // Deliver notifications
  for (const channel of channels) {
    try {
      if (channel === 'EMAIL') {
        await sendMail({
          to: user.email,
          subject: title,
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;background:#1a1a23;color:#e8e8f0;border-radius:12px;border:1px solid #2e2e3e">
              <h2 style="color:#7c6ef5;margin-top:0">${title}</h2>
              <p style="font-size:16px;line-height:1.5">${body}</p>
              <hr style="border:0;border-top:1px solid #2e2e3e;margin:20px 0" />
              <p style="font-size:12px;color:#888899">Sent from FlowSpace Productivity Dashboard</p>
            </div>
          `,
        });
      } else if (channel === 'BROWSER_PUSH' && user.pushSubscription) {
        const sub = JSON.parse(user.pushSubscription) as PushSubscription;
        const success = await sendPush(sub, { title, body });
        if (!success) {
          // If sending fails because subscription is invalid/expired, remove it
          console.warn(`⚠️  Web Push delivery failed for User ${userId}. Clearing invalid subscription.`);
          await unregisterPushSubscription(userId);
        }
      } else if (channel === 'NATIVE_LOCAL') {
        // Native local notification is handled on frontend client platform layer
        console.info(`📱  Native Local notification logged for user ${userId}: ${title} - ${body}`);
      }
    } catch (err) {
      console.error(`❌  Failed to deliver notification on channel ${channel} to User ${userId}:`, err);
    }
  }
}

/** Lists the notification logs for a user. */
export async function getLogs(userId: string) {
  const [logs, total] = await Promise.all([
    prisma.notificationLog.findMany({
      where: { userId },
      orderBy: { sentAt: 'desc' },
      take: 50,
    }),
    prisma.notificationLog.count({ where: { userId } }),
  ]);

  return {
    data: logs.map((l) => ({
      id: l.id,
      userId: l.userId,
      channel: l.channel,
      title: l.title,
      body: l.body,
      sentAt: l.sentAt.toISOString(),
      readAt: l.readAt?.toISOString() ?? null,
    })),
    meta: { total },
  };
}

/** Marks all unread logs as read. */
export async function markAllAsRead(userId: string): Promise<void> {
  await prisma.notificationLog.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
