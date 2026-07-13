// backend/src/jobs/reminderScheduler.ts
// Background job utilizing node-cron to poll database for scheduled task and habit
// reminders, format them according to user timezones, and deliver them.

import cron from 'node-cron';
import { prisma } from '../lib/prismaClient';
import * as notifService from '../services/notification.service';

/**
 * Checks for tasks that are due soon (in the next 15 minutes) and
 * sends reminders to users who have not been notified yet.
 */
async function checkTaskReminders() {
  const now = new Date();
  const fifteenMinutesLater = new Date(now.getTime() + 15 * 60 * 1000);

  try {
    // Find all tasks with a due date in the upcoming window
    const tasksDueSoon = await prisma.task.findMany({
      where: {
        status: { in: ['TODO', 'IN_PROGRESS'] },
        dueDate: {
          gte: now,
          lte: fifteenMinutesLater,
        },
      },
      include: {
        user: {
          include: {
            notificationPreferences: true,
          },
        },
      },
    });

    for (const task of tasksDueSoon) {
      // Check if we already sent a notification for this task in the last 1 hour
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const alreadySent = await prisma.notificationLog.findFirst({
        where: {
          userId: task.userId,
          title: { contains: task.title },
          sentAt: { gte: oneHourAgo },
        },
      });

      if (!alreadySent) {
        if (!task.user.notificationPreferences?.taskDue) {
          continue;
        }
        console.info(`⏰  Task Reminder triggered for User ${task.userId}: "${task.title}"`);
        const title = `Task Due Soon: ${task.title}`;
        const body = task.description
          ? `"${task.description}" is due soon.`
          : `Your task is due in less than 15 minutes.`;

        // Send push + email
        await notifService.sendNotification(task.userId, title, body, ['BROWSER_PUSH', 'EMAIL']);
      }
    }
  } catch (err) {
    console.error('❌  Error running task reminder check:', err);
  }
}

/**
 * Checks for projects that are due soon and notifies users who opted in.
 */
async function checkProjectDeadlines() {
  const now = new Date();
  const twentyFourHoursLater = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  try {
    const projectsDueSoon = await prisma.project.findMany({
      where: {
        dueDate: {
          gte: now,
          lte: twentyFourHoursLater,
        },
      },
      include: {
        user: {
          include: {
            notificationPreferences: true,
          },
        },
      },
    });

    for (const project of projectsDueSoon) {
      if (!project.user.notificationPreferences?.projectDeadline) {
        continue;
      }

      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const alreadySent = await prisma.notificationLog.findFirst({
        where: {
          userId: project.userId,
          title: { contains: project.name },
          sentAt: { gte: oneDayAgo },
        },
      });

      if (!alreadySent) {
        console.info(`📅  Project Deadline triggered for User ${project.userId}: "${project.name}"`);
        await notifService.sendNotification(
          project.userId,
          `Project deadline: ${project.name}`,
          project.description
            ? `"${project.description}" is due within 24 hours.`
            : 'Your project is due within 24 hours.',
          ['BROWSER_PUSH', 'EMAIL'],
        );
      }
    }
  } catch (err) {
    console.error('❌  Error running project deadline check:', err);
  }
}

/**
 * Checks for habits that match the current time in the user's timezone.
 */
async function checkHabitReminders() {
  const now = new Date();

  try {
    // We fetch all habits with reminders enabled
    const habitsWithReminders = await prisma.habit.findMany({
      where: {
        reminderTime: { not: null },
      },
      include: {
        user: {
          include: {
            notificationPreferences: true,
          },
        },
      },
    });

    for (const habit of habitsWithReminders) {
      if (!habit.reminderTime) continue;

      // Calculate current "HH:mm" in user timezone
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: habit.user.timezone || 'UTC',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });

        // Parts formatting ensures we get "HH:mm" consistently
        const parts = formatter.formatToParts(now);
        const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
        const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
        const formattedUserTime = `${hour}:${minute}`;

        if (formattedUserTime === habit.reminderTime) {
          // Verify if already completed today — use UTC midnight to match habit.service.ts
          const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
          const alreadyCompletedToday = await prisma.habitCompletion.findFirst({
            where: {
              habitId: habit.id,
              date: todayStart,
            },
          });

          if (!alreadyCompletedToday) {
            if (!habit.user.notificationPreferences?.habitReminder) {
              continue;
            }
            // Check if notified in the last 10 minutes to avoid double-runs
            const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);
            const alreadyNotified = await prisma.notificationLog.findFirst({
              where: {
                userId: habit.userId,
                title: { contains: habit.title },
                sentAt: { gte: tenMinAgo },
              },
            });

            if (!alreadyNotified) {
              console.info(`⏰  Habit Reminder triggered for User ${habit.userId}: "${habit.title}"`);
              await notifService.sendNotification(
                habit.userId,
                `Habit Reminder: ${habit.title}`,
                `Don't forget to check off your habit "${habit.title}" today!`,
                ['BROWSER_PUSH', 'EMAIL']
              );
            }
          }
        }
      } catch (tzErr) {
        console.error(`❌  Failed timezone calculation for User ${habit.userId} / Timezone ${habit.user.timezone}:`, tzErr);
      }
    }
  } catch (err) {
    console.error('❌  Error running habit reminder check:', err);
  }
}

/** Starts the node-cron scheduler to run reminders every minute. */
export function startScheduler() {
  console.info('🕒  Reminder Scheduler initialized (runs every minute).');

  // Cron pattern: run every minute
  cron.schedule('*/1 * * * *', async () => {
    await checkTaskReminders();
    await checkProjectDeadlines();
    await checkHabitReminders();
  });
}
