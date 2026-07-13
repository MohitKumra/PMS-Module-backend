import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import type {
  AppearanceSettingsDTO,
  NotificationPreferenceDTO,
  SettingsDTO,
  ThemePreference,
  LayoutPreference,
} from '../types';
import { getGoogleCalendarIntegration } from './google.service';

const DEFAULT_APPEARANCE: AppearanceSettingsDTO = {
  themePreference: 'SYSTEM',
  layoutPreference: 'COMFORTABLE',
  calendarView: 'month',
};

const DEFAULT_NOTIFICATIONS: NotificationPreferenceDTO = {
  taskDue: true,
  habitReminder: true,
  projectDeadline: true,
  focusSessionComplete: false,
  calendarSync: true,
};

async function ensureUserExists(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw createError(404, 'USER_NOT_FOUND', 'User not found');
  return user;
}

async function ensurePreferenceRows(userId: string) {
  await prisma.userPreference.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function getSettings(userId: string): Promise<SettingsDTO> {
  await ensureUserExists(userId);
  await ensurePreferenceRows(userId);

  const [appearance, notifications, user] = await Promise.all([
    prisma.userPreference.findUnique({ where: { userId } }),
    prisma.notificationPreference.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId } }),
  ]);

  if (!user) throw createError(404, 'USER_NOT_FOUND', 'User not found');

  return {
    appearance: {
      themePreference: (appearance?.themePreference as AppearanceSettingsDTO['themePreference']) ?? DEFAULT_APPEARANCE.themePreference,
      layoutPreference: (appearance?.layoutPreference as LayoutPreference) ?? DEFAULT_APPEARANCE.layoutPreference,
      calendarView: (appearance?.calendarView as AppearanceSettingsDTO['calendarView']) ?? DEFAULT_APPEARANCE.calendarView,
    },
    notifications: {
      taskDue: notifications?.taskDue ?? DEFAULT_NOTIFICATIONS.taskDue,
      habitReminder: notifications?.habitReminder ?? DEFAULT_NOTIFICATIONS.habitReminder,
      projectDeadline: notifications?.projectDeadline ?? DEFAULT_NOTIFICATIONS.projectDeadline,
      focusSessionComplete: notifications?.focusSessionComplete ?? DEFAULT_NOTIFICATIONS.focusSessionComplete,
      calendarSync: notifications?.calendarSync ?? DEFAULT_NOTIFICATIONS.calendarSync,
    },
    integrations: {
      googleCalendar: await getGoogleCalendarIntegration(userId),
    },
    security: {
      hasPassword: Boolean(user.passwordHash),
      hasGoogle: Boolean(user.googleId),
      recoveryEmail: user.recoveryEmail,
    },
  };
}

export async function updateAppearance(
  userId: string,
  data: Partial<AppearanceSettingsDTO>,
): Promise<AppearanceSettingsDTO> {
  await ensureUserExists(userId);
  const updated = await prisma.userPreference.upsert({
    where: { userId },
    create: {
      userId,
      themePreference: data.themePreference ?? DEFAULT_APPEARANCE.themePreference,
      layoutPreference: data.layoutPreference ?? DEFAULT_APPEARANCE.layoutPreference,
      calendarView: data.calendarView ?? DEFAULT_APPEARANCE.calendarView,
    },
    update: {
      ...(data.themePreference ? { themePreference: data.themePreference } : {}),
      ...(data.layoutPreference ? { layoutPreference: data.layoutPreference } : {}),
      ...(data.calendarView ? { calendarView: data.calendarView } : {}),
    },
  });

  return {
    themePreference: updated.themePreference as AppearanceSettingsDTO['themePreference'],
    layoutPreference: updated.layoutPreference as LayoutPreference,
    calendarView: updated.calendarView as AppearanceSettingsDTO['calendarView'],
  };
}

export async function updateNotificationPreferences(
  userId: string,
  data: NotificationPreferenceDTO,
): Promise<NotificationPreferenceDTO> {
  await ensureUserExists(userId);
  const updated = await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...data },
    update: { ...data },
  });

  return {
    taskDue: updated.taskDue,
    habitReminder: updated.habitReminder,
    projectDeadline: updated.projectDeadline,
    focusSessionComplete: updated.focusSessionComplete,
    calendarSync: updated.calendarSync,
  };
}

export async function updateRecoveryEmail(userId: string, recoveryEmail: string | null): Promise<string | null> {
  await ensureUserExists(userId);
  const normalized = recoveryEmail?.trim() ? recoveryEmail.trim().toLowerCase() : null;
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { recoveryEmail: normalized },
  });
  return updated.recoveryEmail;
}

export async function getRecoveryTargetEmail(userId: string): Promise<string | null> {
  const user = await ensureUserExists(userId);
  return user.recoveryEmail ?? user.email;
}
