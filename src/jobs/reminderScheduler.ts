// backend/src/jobs/reminderScheduler.ts
// Background job utilizing node-cron to poll database for scheduled task and habit
// reminders, format them according to user timezones, and deliver them.

import cron from 'node-cron';
import { prisma } from '../lib/prismaClient';
import * as notifService from '../services/notification.service';
import { syncBrokenHabitStreak } from '../services/habit.service';
import { synchronizeRecurringTasks } from '../services/task.service';
import { rrulestr } from 'rrule';

function normalizeTimeString(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : null;
}

function parseMinutes(time: string | null | undefined): number | null {
  const normalized = normalizeTimeString(time);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(':').map((part) => parseInt(part, 10));
  return hours * 60 + minutes;
}

function subtractMinutes(time: string | null | undefined, minutes: number): string | null {
  const total = parseMinutes(time);
  if (total === null) return null;
  const normalizedTotal = (((total - minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalizedTotal / 60);
  const mins = normalizedTotal % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function dateKeyToUtcDate(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10)));
}

function shiftDateKey(dateKey: string, days: number): string {
  const base = dateKeyToUtcDate(dateKey);
  if (!base) return dateKey;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().split('T')[0];
}

function getLocalDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function getLocalMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = parseInt(parts.find((part) => part.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((part) => part.type === 'minute')?.value ?? '0', 10);
  return hour * 60 + minute;
}

function formatTaskDate(date: Date, timeZone: string): string {
  return date.toLocaleDateString('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Checks for task reminders at their due-date milestones and reminder times.
 */
async function checkTaskReminders() {
  const now = new Date();

  try {
    const tasksToCheck = await prisma.task.findMany({
      where: {
        status: { in: ['TODO', 'IN_PROGRESS'] },
        dueDate: { not: null },
      },
      include: {
        user: {
          include: {
            notificationPreferences: true,
          },
        },
      },
    });

    for (const task of tasksToCheck) {
      if (!task.user.notificationPreferences?.taskDue) {
        continue;
      }

      const timezone = task.user.timezone || 'UTC';
      const nowDateKey = getLocalDateKey(now, timezone);
      const nowMinutes = getLocalMinutes(now, timezone);
      const dueDateKey = getLocalDateKey(task.dueDate!, timezone);
      const dueTomorrowKey = shiftDateKey(dueDateKey, -1);
      const dueTime = normalizeTimeString(task.dueTime);
      const reminderTime = normalizeTimeString(task.reminderTime) ?? subtractMinutes(dueTime, 30);
      const reminderMinutes = parseMinutes(reminderTime);
      const dueMinutes = parseMinutes(dueTime) ?? 0;
      const dueDateMorningWindow = nowMinutes >= 9 * 60 && nowMinutes < 12 * 60;
      const hasMorningReminder =
        reminderMinutes !== null && nowDateKey === dueDateKey && reminderMinutes >= 6 * 60 && reminderMinutes < 12 * 60;
      const dueIsOverdue =
        nowDateKey > dueDateKey || (dueTime !== null && nowDateKey === dueDateKey && nowMinutes >= dueMinutes);

      const notifications: Array<{
        key: string;
        title: string;
        body: string;
        templateKind: 'due_tomorrow' | 'due_today' | 'reminder_time' | 'overdue';
      }> = [];

      if (nowDateKey === dueTomorrowKey && dueDateMorningWindow) {
        notifications.push({
          key: `task-due-tomorrow:${task.id}:${dueDateKey}`,
          title: `Task due tomorrow: ${task.title}`,
          body: `You have a task due tomorrow. A little planning now will make tomorrow easier.`,
          templateKind: 'due_tomorrow',
        });
      }

      if (nowDateKey === dueDateKey && dueDateMorningWindow && !hasMorningReminder) {
        notifications.push({
          key: `task-due-today:${task.id}:${dueDateKey}`,
          title: `Task is due today: ${task.title}`,
          body: `Today is the day to finish "${task.title}".`,
          templateKind: 'due_today',
        });
      }

      if (reminderMinutes !== null && nowDateKey === dueDateKey && nowMinutes >= reminderMinutes) {
        notifications.push({
          key: `task-reminder:${task.id}:${dueDateKey}:${reminderTime}`,
          title: `Time to work on ${task.title}`,
          body: task.reminderMessage?.trim()
            ? task.reminderMessage.trim()
            : `A gentle nudge to work on "${task.title}".`,
          templateKind: 'reminder_time',
        });
      }

      if (dueIsOverdue) {
        notifications.push({
          key: `task-overdue:${task.id}:${dueDateKey}`,
          title: `Task is overdue: ${task.title}`,
          body: `This task missed its deadline. Jump back in when you can.`,
          templateKind: 'overdue',
        });
      }

      // Start of today in the user's timezone — used to scope dedup so each
      // reminder fires at most once per day instead of once ever.
      const todayStartUtc = dateKeyToUtcDate(nowDateKey) ?? new Date(0);

      for (const notification of notifications) {
        const alreadySent = await prisma.notificationLog.findFirst({
          where: {
            userId: task.userId,
            title: notification.title,
            sentAt: { gte: todayStartUtc },
          },
        });
        if (alreadySent) continue;

        console.info(`⏰  Task reminder triggered for User ${task.userId}: "${task.title}" -> ${notification.key}`);
        await notifService.sendNotification(
          task.userId,
          notification.title,
          notification.body,
          ['BROWSER_PUSH', 'EMAIL'],
          {
            templateName: 'task-due-playful',
            templateVars: {
              task: {
                title: task.title,
                description: task.description,
                dueDate: formatTaskDate(task.dueDate!, timezone),
                dueTime: dueTime ?? '00:00',
                priority: task.priority,
                bannerLabel:
                  notification.templateKind === 'due_tomorrow'
                    ? 'Due tomorrow'
                    : notification.templateKind === 'due_today'
                      ? 'Due today'
                      : notification.templateKind === 'reminder_time'
                        ? 'Reminder time'
                        : 'Overdue',
                headline: notification.title,
                supportingCopy: notification.body,
                alertStyle: notification.templateKind,
              },
            },
          }
        );
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
          {
            templateName: 'project-deadline-playful',
            templateVars: {
              project: {
                name: project.name,
                description: project.description,
                dueDate:
                  project.dueDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) ??
                  'Today',
              },
            },
          }
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
      select: {
        id: true,
        userId: true,
        title: true,
        targetPerWeek: true,
        reminderTime: true,
        reminderMessage: true,
        skipDays: true,
        createdAt: true,
        user: {
          include: {
            notificationPreferences: true,
          },
        },
      },
    });

    for (const habit of habitsWithReminders) {
      if (!habit.reminderTime) continue;

      // Skip reminder if today is one of the habit's skip days
      try {
        const skipDayStr = (habit as any).skipDays || '[]';
        let skipIndices: number[] = [];
        try {
          skipIndices = JSON.parse(skipDayStr);
        } catch {}
        if (skipIndices.length > 0) {
          const nowUTC = new Date();
          const dow = (nowUTC.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
          if (skipIndices.includes(dow)) {
            continue; // Skip reminder on intentionally skipped days
          }
        }
      } catch (e) {}

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
        const currentMinutes = parseInt(hour, 10) * 60 + parseInt(minute, 10);
        const [reminderHour, reminderMinute] = habit.reminderTime.split(':').map((value) => parseInt(value, 10));
        const reminderMinutes = reminderHour * 60 + reminderMinute;

        // Fire only within a 1-minute window of the scheduled reminder time
        // (i.e. currentMinutes === reminderMinutes).
        // Using >= caused the reminder to re-fire on every subsequent cron tick.
        const withinReminderWindow = Math.abs(currentMinutes - reminderMinutes) <= 1;
        if (withinReminderWindow) {
          // Respect user preference — default to enabled if preference row is null
          const prefs = habit.user.notificationPreferences;
          const shouldNotify = prefs === null || prefs.habitReminder === true;
          if (!shouldNotify) {
            continue;
          }

          // Verify if already completed today — use UTC midnight to match habit.service.ts.
          // If already completed, no point sending a reminder.
          const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
          const alreadyCompletedToday = await prisma.habitCompletion.findFirst({
            where: { habitId: habit.id, date: todayStart },
          });
          if (alreadyCompletedToday) continue;

          // Dedup: check if we already sent a notification for this exact habit today,
          // keyed on habitId embedded in the notification title to prevent false
          // matches from partial title substring overlap.
          const todayStartParts = new Intl.DateTimeFormat('en-CA', {
            timeZone: habit.user.timezone || 'UTC',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).formatToParts(now);
          const todayYear = todayStartParts.find((p) => p.type === 'year')?.value ?? '0000';
          const todayMonth = todayStartParts.find((p) => p.type === 'month')?.value ?? '01';
          const todayDay = todayStartParts.find((p) => p.type === 'day')?.value ?? '01';
          const todayStartUtc = new Date(
            Date.UTC(parseInt(todayYear, 10), parseInt(todayMonth, 10) - 1, parseInt(todayDay, 10))
          );

          // Use a dedup key that includes the habitId so it is unique per habit per day
          const dedupKey = `habit-reminder:${habit.id}:${todayYear}-${todayMonth}-${todayDay}`;
          const alreadyNotifiedToday = await prisma.notificationLog.findFirst({
            where: {
              userId: habit.userId,
              title: dedupKey,
              sentAt: { gte: todayStartUtc },
            },
          });
          if (alreadyNotifiedToday) continue;

          const reminderTitle = habit.reminderMessage?.trim()
            ? habit.reminderMessage.trim()
            : `Habit Reminder: ${habit.title}`;
          console.info(`⏰  Habit Reminder triggered for User ${habit.userId}: "${habit.title}"`);
          await notifService.sendNotification(
            habit.userId,
            // Store dedupKey as the notification title so future lookups are exact
            dedupKey,
            `Don't let "${habit.title}" slip today. Completing it now helps protect your streak.`,
            ['BROWSER_PUSH', 'EMAIL'],
            {
              templateName: 'habit-reminder-playful',
              templateVars: {
                reminderTitle,
                habit: {
                  title: habit.title,
                  reminderTime: habit.reminderTime,
                },
              },
            }
          );
        }
      } catch (tzErr) {
        console.error(
          `❌  Failed timezone calculation for User ${habit.userId} / Timezone ${habit.user.timezone}:`,
          tzErr
        );
      }
    }
  } catch (err) {
    console.error('❌  Error running habit reminder check:', err);
  }
}

async function checkHabitRemindersV2() {
  const now = new Date();

  try {
    const habitsWithReminders = await prisma.habit.findMany({
      where: {
        reminderTime: { not: null },
      },
      select: {
        id: true,
        userId: true,
        title: true,
        targetPerWeek: true,
        reminderTime: true,
        reminderMessage: true,
        skipDays: true,
        createdAt: true,
        user: {
          include: {
            notificationPreferences: true,
          },
        },
      },
    });

    for (const habit of habitsWithReminders) {
      if (!habit.reminderTime) continue;

      try {
        const skipDayStr = (habit as any).skipDays || '[]';
        let skipIndices: number[] = [];
        try {
          skipIndices = JSON.parse(skipDayStr);
        } catch {}
        if (skipIndices.length > 0) {
          const nowUTC = new Date();
          const dow = (nowUTC.getUTCDay() + 6) % 7;
          if (skipIndices.includes(dow)) continue;
        }
      } catch {}

      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: habit.user.timezone || 'UTC',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });

        const parts = formatter.formatToParts(now);
        const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
        const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
        const currentMinutes = parseInt(hour, 10) * 60 + parseInt(minute, 10);
        const [reminderHour, reminderMinute] = habit.reminderTime.split(':').map((value) => parseInt(value, 10));
        const reminderMinutes = reminderHour * 60 + reminderMinute;
        const warningMinutes = parseMinutes(subtractMinutes(habit.reminderTime, 30));

        const prefs = habit.user.notificationPreferences;
        const shouldNotify = prefs === null || prefs.habitReminder === true;
        if (!shouldNotify) continue;

        const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const alreadyCompletedToday = await prisma.habitCompletion.findFirst({
          where: { habitId: habit.id, date: todayStart },
        });
        if (alreadyCompletedToday) continue;

        const todayStartParts = new Intl.DateTimeFormat('en-CA', {
          timeZone: habit.user.timezone || 'UTC',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(now);
        const todayYear = todayStartParts.find((p) => p.type === 'year')?.value ?? '0000';
        const todayMonth = todayStartParts.find((p) => p.type === 'month')?.value ?? '01';
        const todayDay = todayStartParts.find((p) => p.type === 'day')?.value ?? '01';
        const todayStartUtc = new Date(Date.UTC(parseInt(todayYear, 10), parseInt(todayMonth, 10) - 1, parseInt(todayDay, 10)));

        const reminderTitle = habit.reminderMessage?.trim()
          ? habit.reminderMessage.trim()
          : `Habit Reminder: ${habit.title}`;
        const warningTitle = habit.reminderMessage?.trim()
          ? `30-minute warning: ${habit.reminderMessage.trim()}`
          : `30-minute warning: ${habit.title}`;
        const reminderBody = `Don't let "${habit.title}" slip today. Completing it now helps protect your streak.`;
        const warningBody = `You have 30 minutes left to complete "${habit.title}" and protect your streak.`;

        if (warningMinutes !== null && Math.abs(currentMinutes - warningMinutes) <= 1) {
          const warningDedupKey = `habit-reminder-warning:${habit.id}:${todayYear}-${todayMonth}-${todayDay}`;
          const alreadyWarnedToday = await prisma.notificationLog.findFirst({
            where: {
              userId: habit.userId,
              title: warningDedupKey,
              sentAt: { gte: todayStartUtc },
            },
          });
          if (!alreadyWarnedToday) {
            console.info(`⏰  Habit warning triggered for User ${habit.userId}: "${habit.title}"`);
            await notifService.sendNotification(
              habit.userId,
              warningTitle,
              warningBody,
              ['BROWSER_PUSH', 'EMAIL'],
              {
                templateName: 'habit-reminder-playful',
                templateVars: {
                  reminderTitle: warningTitle,
                  habit: {
                    title: habit.title,
                    reminderTime: habit.reminderTime,
                  },
                },
              },
              {
                logTitle: warningDedupKey,
                emailSubject: warningTitle,
              }
            );
          }
        }

        if (Math.abs(currentMinutes - reminderMinutes) <= 1) {
          const reminderDedupKey = `habit-reminder:${habit.id}:${todayYear}-${todayMonth}-${todayDay}`;
          const alreadyNotifiedToday = await prisma.notificationLog.findFirst({
            where: {
              userId: habit.userId,
              title: reminderDedupKey,
              sentAt: { gte: todayStartUtc },
            },
          });
          if (alreadyNotifiedToday) continue;

          console.info(`⏰  Habit Reminder triggered for User ${habit.userId}: "${habit.title}"`);
          await notifService.sendNotification(
            habit.userId,
            reminderTitle,
            reminderBody,
            ['BROWSER_PUSH', 'EMAIL'],
            {
              templateName: 'habit-reminder-playful',
              templateVars: {
                reminderTitle,
                habit: {
                  title: habit.title,
                  reminderTime: habit.reminderTime,
                },
              },
            },
            {
              logTitle: reminderDedupKey,
              emailSubject: reminderTitle,
            }
          );
        }
      } catch (tzErr) {
        console.error(`❌  Failed timezone calculation for User ${habit.userId} / Timezone ${habit.user.timezone}:`, tzErr);
      }
    }
  } catch (err) {
    console.error('❌  Error running habit reminder check:', err);
  }
}

async function checkHabitBreaks() {
  try {
    const habits = await prisma.habit.findMany({
      where: {
        isActive: true,
        completions: {
          some: {},
        },
      },
      select: {
        id: true,
        userId: true,
        title: true,
        skipDays: true,
        streakBrokenAt: true,
        completions: { select: { date: true } },
        user: {
          include: {
            notificationPreferences: true,
          },
        },
      },
    });

    for (const habit of habits) {
      await syncBrokenHabitStreak(habit as any, { notify: true, applyPenalty: true });
    }
  } catch (err) {
    console.error('❌  Error running habit break check:', err);
  }
}

/**
 * Legacy recurrence helper retained only for the unused scheduler generator
 * below. Runtime recurrence generation now lives in task.service.ts.
 */
function getNextOccurrence(
  currentDueDate: Date | null,
  recurrenceRule: string | null,
  recurrenceEndDate: Date | null,
  skipDates: string[]
): Date | null {
  if (!currentDueDate || !recurrenceRule) return null;
  try {
    const rule = rrulestr(recurrenceRule, { dtstart: currentDueDate });
    const occurrences = rule.between(
      new Date(currentDueDate.getTime() + 1),
      recurrenceEndDate || new Date(currentDueDate.getTime() + 365 * 24 * 60 * 60 * 1000),
      true,
      (date) => {
        const dateStr = date.toISOString().split('T')[0];
        return !skipDates.includes(dateStr);
      }
    );
    return occurrences.length > 0 ? occurrences[0] : null;
  } catch (e) {
    console.error('Error calculating next occurrence:', e);
    return null;
  }
}

/**
 * Creates the next occurrence for tasks that were recently marked DONE
 * and have a recurrence rule but no future occurrence yet.
 * Runs as part of the scheduler to avoid race conditions from concurrent requests.
 */
async function createNextOccurrences() {
  try {
    // Find all DONE recurring tasks that don't have a future occurrence
    const recentDoneTasks = await prisma.task.findMany({
      where: {
        status: 'DONE',
        recurrenceRule: { not: null },
      },
      select: {
        id: true,
        userId: true,
        title: true,
        description: true,
        priority: true,
        dueDate: true,
        recurrenceRule: true,
        recurrenceEndDate: true,
        skipDates: true,
        parentTaskId: true,
        dueTime: true,
        reminderTime: true,
        reminderMessage: true,
        attachmentUrl: true,
        voiceNoteUrl: true,
        subTasks: { select: { title: true, order: true } },
      },
    });

    for (const task of recentDoneTasks) {
      const rootId = task.parentTaskId ?? task.id;

      // Check if an active occurrence (TODO or IN_PROGRESS) already exists in this chain
      const activeOccurrence = await prisma.task.findFirst({
        where: {
          userId: task.userId,
          OR: [{ id: rootId }, { parentTaskId: rootId }],
          status: { in: ['TODO', 'IN_PROGRESS'] },
        },
      });
      if (activeOccurrence) continue;

      const nextDate = getNextOccurrence(task.dueDate, task.recurrenceRule, task.recurrenceEndDate, task.skipDates);
      if (!nextDate) continue;

      // Check if an occurrence for this exact date already exists in the chain
      const existingSameDate = await prisma.task.findFirst({
        where: {
          userId: task.userId,
          OR: [{ id: rootId }, { parentTaskId: rootId }],
          dueDate: nextDate,
        },
      });
      if (existingSameDate) continue;

      try {
        await prisma.task.create({
          data: {
            userId: task.userId,
            title: task.title,
            description: task.description,
            priority: task.priority,
            status: 'TODO',
            dueDate: nextDate,
            recurrenceRule: task.recurrenceRule,
            recurrenceEndDate: task.recurrenceEndDate,
            skipDates: task.skipDates,
            parentTaskId: rootId,
            dueTime: task.dueTime,
            reminderTime: task.reminderTime,
            reminderMessage: task.reminderMessage,
            attachmentUrl: task.attachmentUrl,
            voiceNoteUrl: task.voiceNoteUrl,
            subTasks:
              task.subTasks.length > 0
                ? {
                    create: task.subTasks.map((st) => ({
                      title: st.title,
                      order: st.order,
                      completed: false,
                    })),
                  }
                : undefined,
          },
        });
        console.log(`[Recurrence] Created next occurrence for task ${task.id} on ${nextDate.toISOString()}`);
      } catch (err: any) {
        // P2002 = unique constraint violation — another process already created it
        if (err?.code === 'P2002') {
          console.log(`[Recurrence] Duplicate skipped for task ${task.id}`);
        } else {
          console.error(`[Recurrence] Failed to create occurrence for task ${task.id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('❌  Error creating next occurrences:', err);
  }
}

/** Starts the node-cron scheduler to run reminders every minute. */
export function startScheduler() {
  synchronizeRecurringTasks().catch((err) => {
    console.error('Error synchronizing recurring tasks on startup:', err);
  });
  console.info('🕒  Reminder Scheduler initialized (runs every minute).');

  // Cron pattern: run every minute
  cron.schedule('*/1 * * * *', async () => {
    await checkTaskReminders();
    await checkProjectDeadlines();
    await checkHabitRemindersV2();
    await checkHabitBreaks();
  });
}
