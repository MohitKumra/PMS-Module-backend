// backend/src/services/notification.service.ts
// Handles decisions of when and how to notify users, registers subscription tokens,
// and implements delivery across multiple channels (Web Push, Email).

import { prisma } from '../lib/prismaClient';
import type { PushSubscription } from '../lib/pushSender';
import { sendPush } from '../lib/pushSender';
import { sendMail, renderHabitReminder, renderTaskDue, renderProjectDeadline, renderNotificationFallback } from '../lib/mailer';
import { createError } from '../middleware/errorHandler';
import type { NotificationChannel } from '../types';
import type { MailOptions } from '../lib/mailer';

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

export interface EmailTemplateVars {
  /** Which template file to use (without .html) — e.g. 'habit-reminder-playful' */
  templateName: 'habit-reminder-playful' | 'task-due-playful' | 'project-deadline-playful';
  /** Variables passed to the template renderer */
  templateVars: Record<string, any>;
}

export interface NotificationDeliveryOptions {
  /** Optional title to store in notificationLog. Defaults to the visible title. */
  logTitle?: string;
  /** Optional email subject. Defaults to the visible title. */
  emailSubject?: string;
  /** Optional custom HTML payload for the email channel. */
  html?: string;
  /** Optional attachment(s) for the email channel. */
  attachments?: MailOptions['attachments'];
}

/**
 * Safety net: maximum number of emails a single user can receive per day.
 * Prevents any future scheduler/notification regression from flooding inboxes.
 */
const DAILY_EMAIL_CAP = 10;

/** Logs and delivers a notification across the requested channels. */
export async function sendNotification(
  userId: string,
  title: string,
  body: string,
  channels: NotificationChannel[],
  emailTemplate?: EmailTemplateVars,
  options: NotificationDeliveryOptions = {}
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    console.error(`❌  Notification Service: User ${userId} not found`);
    return;
  }

  const logTitle = options.logTitle ?? title;
  const emailSubject = options.emailSubject ?? title;

  // Create log entries in parallel
  const logPromises = channels.map((channel) =>
    prisma.notificationLog.create({
      data: {
        userId,
        channel,
        title: logTitle,
        body,
      },
    })
  );
  await Promise.all(logPromises);

  // Deliver notifications
  for (const channel of channels) {
    try {
      if (channel === 'EMAIL') {
        // Enforce a per-user daily email cap to guard against notification storms.
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        const emailsToday = await prisma.notificationLog.count({
          where: {
            userId,
            channel: 'EMAIL',
            sentAt: { gte: dayStart },
          },
        });
        if (emailsToday > DAILY_EMAIL_CAP) {
          console.warn(
            `⚠️  Daily email cap (${DAILY_EMAIL_CAP}) reached for User ${userId}. Skipping email: "${title}"`
          );
          continue;
        }
        let html: string;
        if (options.html) {
          html = options.html;
        } else if (emailTemplate) {
          // Render the custom playful template
          switch (emailTemplate.templateName) {
            case 'habit-reminder-playful':
              html = renderHabitReminder(emailTemplate.templateVars as any);
              break;
            case 'task-due-playful':
              html = renderTaskDue(emailTemplate.templateVars as any);
              break;
            case 'project-deadline-playful':
              html = renderProjectDeadline(emailTemplate.templateVars as any);
              break;
            default:
              html = renderFallbackHtml(title, body);
          }
        } else {
          html = renderFallbackHtml(title, body);
        }

        await sendMail({
          to: user.email,
          subject: emailSubject,
          html,
          attachments: options.attachments,
        });
      } else if (channel === 'BROWSER_PUSH' && user.pushSubscription) {
        const sub = JSON.parse(user.pushSubscription) as PushSubscription;
        const success = await sendPush(sub, { title, body });
        if (!success) {
          console.warn(`⚠️  Web Push delivery failed for User ${userId}. Clearing invalid subscription.`);
          await unregisterPushSubscription(userId);
        }
      } else if (channel === 'NATIVE_LOCAL') {
        console.info(`📱  Native Local notification logged for user ${userId}: ${title} - ${body}`);
      }
    } catch (err) {
      console.error(`❌  Failed to deliver notification on channel ${channel} to User ${userId}:`, err);
    }
  }
}

/** Fallback HTML template when no playful template is specified */
function renderFallbackHtml(title: string, body: string): string {
  return renderNotificationFallback({ title, body });
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
