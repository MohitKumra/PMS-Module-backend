import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import type {
  AIPreferenceDTO,
  AppearanceSettingsDTO,
  NotificationPreferenceDTO,
  SettingsDTO,
  ThemePreference,
  LayoutPreference,
  TaskViewPreference,
  UpdateAIPreferencesRequest,
} from '../types';
import { getGoogleCalendarIntegration } from './google.service';

const DEFAULT_APPEARANCE: AppearanceSettingsDTO = {
  themePreference: 'SYSTEM',
  layoutPreference: 'COMFORTABLE',
  calendarView: 'month',
  taskView: 'board',
  pageTransitionsEnabled: true,
  floatingAnimationsEnabled: true,
};

const DEFAULT_NOTIFICATIONS: NotificationPreferenceDTO = {
  taskDue: true,
  habitReminder: true,
  projectDeadline: true,
  focusSessionComplete: false,
  calendarSync: true,
};

const DEFAULT_AI: AIPreferenceDTO = {
  dailyBriefEnabled: true,
  journalWeeklyEnabled: true,
  insightsEnabled: true,
  coachEnabled: true,
  journalAnalysisEnabled: true,
  goalSummaryEnabled: true,
  taskParserEnabled: true,
  goalPlannerEnabled: true,
  summaryRefreshMinutes: 60,
  tokensToday: 0,
  tokensThisWeek: 0,
  tokensThisMonth: 0,
  tokensTotal: 0,
  aiCallsTotal: 0,
  tokenUsageUpdatedAt: null,
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
  await prisma.aIPreference.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function getSettings(userId: string): Promise<SettingsDTO> {
  await ensureUserExists(userId);
  await ensurePreferenceRows(userId);

  const [appearance, notifications, aiPref, user] = await Promise.all([
    prisma.userPreference.findUnique({ where: { userId } }),
    prisma.notificationPreference.findUnique({ where: { userId } }),
    prisma.aIPreference.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId } }),
  ]);

  if (!user) throw createError(404, 'USER_NOT_FOUND', 'User not found');

  return {
    appearance: {
      themePreference:
        (appearance?.themePreference as AppearanceSettingsDTO['themePreference']) ?? DEFAULT_APPEARANCE.themePreference,
      layoutPreference: (appearance?.layoutPreference as LayoutPreference) ?? DEFAULT_APPEARANCE.layoutPreference,
      calendarView:
        (appearance?.calendarView as AppearanceSettingsDTO['calendarView']) ?? DEFAULT_APPEARANCE.calendarView,
      taskView: (appearance?.taskView as TaskViewPreference) ?? DEFAULT_APPEARANCE.taskView,
      pageTransitionsEnabled: appearance?.pageTransitionsEnabled ?? DEFAULT_APPEARANCE.pageTransitionsEnabled,
      floatingAnimationsEnabled: appearance?.floatingAnimationsEnabled ?? DEFAULT_APPEARANCE.floatingAnimationsEnabled,
    },
    notifications: {
      taskDue: notifications?.taskDue ?? DEFAULT_NOTIFICATIONS.taskDue,
      habitReminder: notifications?.habitReminder ?? DEFAULT_NOTIFICATIONS.habitReminder,
      projectDeadline: notifications?.projectDeadline ?? DEFAULT_NOTIFICATIONS.projectDeadline,
      focusSessionComplete: notifications?.focusSessionComplete ?? DEFAULT_NOTIFICATIONS.focusSessionComplete,
      calendarSync: notifications?.calendarSync ?? DEFAULT_NOTIFICATIONS.calendarSync,
    },
    ai: {
      dailyBriefEnabled: aiPref?.dailyBriefEnabled ?? DEFAULT_AI.dailyBriefEnabled,
      journalWeeklyEnabled: aiPref?.journalWeeklyEnabled ?? DEFAULT_AI.journalWeeklyEnabled,
      insightsEnabled: aiPref?.insightsEnabled ?? DEFAULT_AI.insightsEnabled,
      coachEnabled: aiPref?.coachEnabled ?? DEFAULT_AI.coachEnabled,
      journalAnalysisEnabled: aiPref?.journalAnalysisEnabled ?? DEFAULT_AI.journalAnalysisEnabled,
      goalSummaryEnabled: aiPref?.goalSummaryEnabled ?? DEFAULT_AI.goalSummaryEnabled,
      taskParserEnabled: aiPref?.taskParserEnabled ?? DEFAULT_AI.taskParserEnabled,
      goalPlannerEnabled: aiPref?.goalPlannerEnabled ?? DEFAULT_AI.goalPlannerEnabled,
      summaryRefreshMinutes: aiPref?.summaryRefreshMinutes ?? DEFAULT_AI.summaryRefreshMinutes,

      // ─── Token consumption counters (read-only) ───────────────────────
      tokensToday: aiPref?.tokensToday ?? 0,
      tokensThisWeek: aiPref?.tokensThisWeek ?? 0,
      tokensThisMonth: aiPref?.tokensThisMonth ?? 0,
      tokensTotal: aiPref?.tokensTotal ?? 0,
      aiCallsTotal: aiPref?.aiCallsTotal ?? 0,
      tokenUsageUpdatedAt: aiPref?.lastTokenUseAt?.toISOString() ?? null,
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
  data: Partial<AppearanceSettingsDTO>
): Promise<AppearanceSettingsDTO> {
  await ensureUserExists(userId);
  const updated = await prisma.userPreference.upsert({
    where: { userId },
    create: {
      userId,
      themePreference: data.themePreference ?? DEFAULT_APPEARANCE.themePreference,
      layoutPreference: data.layoutPreference ?? DEFAULT_APPEARANCE.layoutPreference,
      calendarView: data.calendarView ?? DEFAULT_APPEARANCE.calendarView,
      taskView: data.taskView ?? DEFAULT_APPEARANCE.taskView,
      pageTransitionsEnabled: data.pageTransitionsEnabled ?? DEFAULT_APPEARANCE.pageTransitionsEnabled,
      floatingAnimationsEnabled: data.floatingAnimationsEnabled ?? DEFAULT_APPEARANCE.floatingAnimationsEnabled,
    },
    update: {
      ...(data.themePreference ? { themePreference: data.themePreference } : {}),
      ...(data.layoutPreference ? { layoutPreference: data.layoutPreference } : {}),
      ...(data.calendarView ? { calendarView: data.calendarView } : {}),
      ...(data.taskView ? { taskView: data.taskView } : {}),
      ...(typeof data.pageTransitionsEnabled === 'boolean' ? { pageTransitionsEnabled: data.pageTransitionsEnabled } : {}),
      ...(typeof data.floatingAnimationsEnabled === 'boolean'
        ? { floatingAnimationsEnabled: data.floatingAnimationsEnabled }
        : {}),
    },
  });

  return {
    themePreference: updated.themePreference as AppearanceSettingsDTO['themePreference'],
    layoutPreference: updated.layoutPreference as LayoutPreference,
    calendarView: updated.calendarView as AppearanceSettingsDTO['calendarView'],
    taskView: updated.taskView as TaskViewPreference,
    pageTransitionsEnabled: updated.pageTransitionsEnabled,
    floatingAnimationsEnabled: updated.floatingAnimationsEnabled,
  };
}

export async function updateNotificationPreferences(
  userId: string,
  data: NotificationPreferenceDTO
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

export async function updateAIPreferences(userId: string, data: UpdateAIPreferencesRequest): Promise<AIPreferenceDTO> {
  await ensureUserExists(userId);

  // Strip read-only token counters so clients can never overwrite them.
  const {
    tokensToday: _tokensToday,
    tokensThisWeek: _tokensThisWeek,
    tokensThisMonth: _tokensThisMonth,
    tokensTotal: _tokensTotal,
    aiCallsTotal: _aiCallsTotal,
    tokenUsageUpdatedAt: _tokenUsageUpdatedAt,
    ...writable
  } = data;

  const updated = await prisma.aIPreference.upsert({
    where: { userId },
    create: { userId, ...writable },
    update: { ...writable },
  });

  return {
    dailyBriefEnabled: updated.dailyBriefEnabled,
    journalWeeklyEnabled: updated.journalWeeklyEnabled,
    insightsEnabled: updated.insightsEnabled,
    coachEnabled: updated.coachEnabled,
    journalAnalysisEnabled: updated.journalAnalysisEnabled,
    goalSummaryEnabled: updated.goalSummaryEnabled,
    taskParserEnabled: updated.taskParserEnabled,
    goalPlannerEnabled: updated.goalPlannerEnabled,
    summaryRefreshMinutes: updated.summaryRefreshMinutes,
    tokensToday: updated.tokensToday,
    tokensThisWeek: updated.tokensThisWeek,
    tokensThisMonth: updated.tokensThisMonth,
    tokensTotal: updated.tokensTotal,
    aiCallsTotal: updated.aiCallsTotal,
    tokenUsageUpdatedAt: updated.lastTokenUseAt?.toISOString() ?? null,
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
