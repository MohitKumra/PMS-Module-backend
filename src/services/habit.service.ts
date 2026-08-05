import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { recomputeGoalProgress } from './goal.service';
import { awardHabitCompletion, revokeHabitCompletion, deductPoints } from './gamification.service';
import * as notifService from './notification.service';
import type { HabitDTO, CreateHabitRequest, UpdateHabitRequest, WeekOverviewDTO, HabitStreakBreakDTO } from '../types';

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function daysBetween(a: string, b: string): number {
  return (new Date(`${b}T00:00:00.000Z`).getTime() - new Date(`${a}T00:00:00.000Z`).getTime()) / 86400000;
}

function getDayOfWeek(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return (d.getUTCDay() + 6) % 7;
}

function parseSkipDays(raw: string | null): number[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function calcStreak(dates: string[], skipDays: number[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...new Set(dates)].sort().reverse();
  const today = utcToday();
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  let cursor = new Date(`${sorted[0]}T00:00:00.000Z`);
  const yesterdayStr = toDateStr(yesterday);
  if (cursor < yesterday && !skipDays.includes(getDayOfWeek(yesterdayStr))) return 0;

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i]}T00:00:00.000Z`);
    const diff = (cursor.getTime() - prev.getTime()) / 86400000;
    if (diff === 1) {
      streak++;
      cursor = prev;
    } else {
      let gapFilledBySkips = true;
      let checkDate = new Date(prev);
      checkDate.setUTCDate(checkDate.getUTCDate() + 1);
      while (checkDate < cursor) {
        const checkStr = toDateStr(checkDate);
        if (!skipDays.includes(getDayOfWeek(checkStr))) {
          gapFilledBySkips = false;
          break;
        }
        checkDate.setUTCDate(checkDate.getUTCDate() + 1);
      }
      if (gapFilledBySkips) { streak++; cursor = prev; }
      else break;
    }
  }
  return streak;
}

function calcBestStreak(dates: string[], skipDays: number[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...new Set(dates)].sort();
  let best = 1, current = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diff = daysBetween(sorted[i - 1], sorted[i]);
    if (diff === 1) { current++; best = Math.max(best, current); }
    else {
      let gapIsSkip = true;
      const start = new Date(`${sorted[i - 1]}T00:00:00.000Z`);
      const end = new Date(`${sorted[i]}T00:00:00.000Z`);
      let checkDate = new Date(start);
      checkDate.setUTCDate(checkDate.getUTCDate() + 1);
      while (checkDate < end) {
        const checkStr = toDateStr(checkDate);
        if (!skipDays.includes(getDayOfWeek(checkStr))) { gapIsSkip = false; break; }
        checkDate.setUTCDate(checkDate.getUTCDate() + 1);
      }
      if (gapIsSkip) { current++; best = Math.max(best, current); }
      else current = 1;
    }
  }
  return best;
}

function utcMondayOfThisWeek(): Date {
  const today = utcToday();
  const dow = today.getUTCDay();
  const offset = (dow + 6) % 7;
  const monday = new Date(today);
  monday.setUTCDate(monday.getUTCDate() - offset);
  return monday;
}

function calcWeekPattern(dateSet: Set<string>, skipSet: Set<string>): boolean[] {
  const monday = utcMondayOfThisWeek();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    const dateStr = toDateStr(d);
    if (skipSet.has(dateStr)) return true;
    return dateSet.has(dateStr);
  });
}

function calcStreakSafeDays(skipDaysRaw: string): Set<string> {
  const skipDayIndices = parseSkipDays(skipDaysRaw);
  if (skipDayIndices.length === 0) return new Set();
  const safe = new Set<string>();
  const now = utcToday();
  const checkDate = new Date(now);
  checkDate.setUTCDate(checkDate.getUTCDate() - 60);
  while (checkDate <= now) {
    const dow = getDayOfWeek(toDateStr(checkDate));
    if (skipDayIndices.includes(dow)) safe.add(toDateStr(checkDate));
    checkDate.setUTCDate(checkDate.getUTCDate() + 1);
  }
  return safe;
}

interface HabitRow {
  id: string;
  userId: string;
  goalId: string | null;
  title: string;
  targetPerWeek: number;
  reminderTime: string | null;
  createdAt: Date;
  completions: { date: Date }[];
}

async function toDTO(h: HabitRow & {
  reminderMessage: string | null;
  durationDays: number | null;
  skipDays: string;
  streakBrokenAt: Date | null;
  isActive: boolean;
}): Promise<HabitDTO> {
  const dateStrings = h.completions.map((c) => toDateStr(c.date));
  const dateSet = new Set(dateStrings);
  const skipDayIndices = parseSkipDays(h.skipDays);
  const today = toDateStr(utcToday());
  const safeDaysSet = calcStreakSafeDays(h.skipDays);

  const monday = utcMondayOfThisWeek();
  const lastMonday = new Date(monday);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);

  const completionsThisWeek = h.completions.filter((c) => c.date >= monday).length;
  const completionsLastWeek = h.completions.filter((c) => c.date >= lastMonday && c.date < monday).length;

  return {
    id: h.id, userId: h.userId, goalId: h.goalId ?? null, title: h.title,
    targetPerWeek: h.targetPerWeek, reminderTime: h.reminderTime,
    reminderMessage: h.reminderMessage,
    durationDays: h.durationDays,
    skipDays: skipDayIndices,
    streakBrokenAt: h.streakBrokenAt?.toISOString() ?? null,
    isActive: h.isActive,
    createdAt: h.createdAt.toISOString(),
    currentStreak: calcStreak(dateStrings, skipDayIndices),
    bestStreak: calcBestStreak(dateStrings, skipDayIndices),
    completedToday: dateSet.has(today) || safeDaysSet.has(today),
    completionsThisWeek,
    completionsLastWeek,
    weekPattern: calcWeekPattern(dateSet, safeDaysSet),
    completionDates: dateStrings,
    streakSafeDays: Array.from(safeDaysSet),
    totalXp: dateStrings.length * 15, // 15 XP per completion
  };
}

export async function listHabits(userId: string): Promise<{
  data: HabitDTO[]; meta: { total: number; weeklyTrend: number };
}> {
  const habits = await prisma.habit.findMany({
    where: { userId },
    select: {
      id: true,
      userId: true,
      goalId: true,
      title: true,
      targetPerWeek: true,
      reminderTime: true,
      createdAt: true,
      completions: { select: { date: true } },
      reminderMessage: true,
      durationDays: true,
      skipDays: true,
      streakBrokenAt: true,
      isActive: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const data = await Promise.all(
    habits.map((h) => toDTO(h as any))
  );

  const thisWeekTotal = data.reduce((sum, h) => sum + h.completionsThisWeek, 0);
  const lastWeekTotal = data.reduce((sum, h) => sum + h.completionsLastWeek, 0);
  const weeklyTrend =
    lastWeekTotal === 0
      ? (thisWeekTotal > 0 ? 100 : 0)
      : Math.round(((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 1000) / 10;

  return { data, meta: { total: data.length, weeklyTrend } };
}

export async function createHabit(userId: string, data: CreateHabitRequest): Promise<HabitDTO> {
  const skipDays = data.skipDays ? JSON.stringify(data.skipDays) : '[]';
  const skipDayIndices = parseSkipDays(skipDays);
  const targetPerWeek = 7 - skipDayIndices.length; // auto-compute from skip days
  if (data.goalId) {
    const goal = await prisma.goal.findFirst({ where: { id: data.goalId, userId }, select: { id: true } });
    if (!goal) throw createError(404, 'GOAL_NOT_FOUND', 'Goal not found');
  }
  const habit = await prisma.habit.create({
    data: {
      userId,
      title: data.title,
      targetPerWeek,
      reminderTime: data.reminderTime ?? null,
      reminderMessage: data.reminderMessage ?? null,
      durationDays: data.durationDays ?? null,
      skipDays,
      goalId: data.goalId ?? null,
    } as any,
    include: { completions: { select: { date: true } } },
  });
  return toDTO(habit as any);
}

export async function updateHabit(userId: string, habitId: string, data: UpdateHabitRequest): Promise<HabitDTO> {
  const existing = await prisma.habit.findFirst({ 
    where: { id: habitId, userId }, 
    select: { id: true } 
  });
  if (!existing) throw createError(404, 'HABIT_NOT_FOUND', 'Habit not found');
  if (data.goalId !== undefined && data.goalId !== null) {
    const goal = await prisma.goal.findFirst({ where: { id: data.goalId, userId }, select: { id: true } });
    if (!goal) throw createError(404, 'GOAL_NOT_FOUND', 'Goal not found');
  }

  const updateData: Record<string, any> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.reminderTime !== undefined) updateData.reminderTime = data.reminderTime;
  if (data.reminderMessage !== undefined) updateData.reminderMessage = data.reminderMessage;
  if (data.durationDays !== undefined) updateData.durationDays = data.durationDays;
  if (data.goalId !== undefined) updateData.goalId = data.goalId;
  if (data.skipDays !== undefined) {
    updateData.skipDays = JSON.stringify(data.skipDays);
    // Recompute targetPerWeek from new skip days
    const skipDayIndices = parseSkipDays(updateData.skipDays);
    updateData.targetPerWeek = 7 - skipDayIndices.length;
  }

  const habit = await prisma.habit.update({
    where: { id: habitId },
    data: updateData as any,
    select: {
      id: true,
      userId: true,
      goalId: true,
      title: true,
      targetPerWeek: true,
      reminderTime: true,
      createdAt: true,
      completions: { select: { date: true } },
      reminderMessage: true,
      durationDays: true,
      skipDays: true,
      streakBrokenAt: true,
      isActive: true,
    },
  });
  return toDTO(habit as any);
}

export async function deleteHabit(userId: string, habitId: string): Promise<void> {
  const existing = await prisma.habit.findFirst({ 
    where: { id: habitId, userId }, 
    select: { id: true, title: true, completions: { select: { id: true } } } 
  }) as any;
  if (!existing) throw createError(404, 'HABIT_NOT_FOUND', 'Habit not found');

  // Deduct all XP earned from this habit before deleting
  const completionCount = existing.completions?.length ?? 0;
  if (completionCount > 0) {
    await deductPoints({
      userId,
      points: completionCount * 15,
      reason: 'HABIT_DELETED',
      entityType: 'habit',
      entityId: habitId,
      description: `Deleted habit: ${existing.title} (${completionCount} completions)`,
    });
  }

  await prisma.habit.delete({ where: { id: habitId } });
}

export async function toggleCompletion(userId: string, habitId: string): Promise<HabitDTO> {
  const habit = await prisma.habit.findFirst({
    where: { id: habitId, userId },
    select: {
      id: true,
      skipDays: true,
      completions: { select: { date: true, id: true } },
      user: {
        select: {
          notificationPreferences: true,
        },
      },
    },
  }) as any;
  if (!habit) throw createError(404, 'HABIT_NOT_FOUND', 'Habit not found');

  const today = utcToday();
  const todayStr = toDateStr(today);
  const skipDayIndices = parseSkipDays(habit.skipDays);
  const todayDow = getDayOfWeek(todayStr);

  // If today is a skip day, return the habit as-is — no toggle allowed
  if (skipDayIndices.includes(todayDow)) {
    const current = await prisma.habit.findUnique({
      where: { id: habitId },
      select: {
        id: true,
        userId: true,
        goalId: true,
        title: true,
        targetPerWeek: true,
        reminderTime: true,
        createdAt: true,
        completions: { select: { date: true } },
        reminderMessage: true,
        durationDays: true,
        skipDays: true,
        streakBrokenAt: true,
        isActive: true,
      },
    }) as any;
    return toDTO(current);
  }
  const existing = await prisma.habitCompletion.findUnique({
    where: { habitId_date: { habitId, date: today } },
  });

  let completionId: string | null = null;
  const wasCompleted = !!existing;
  const oldStreak = calcStreak(
    habit.completions.map((c: any) => toDateStr(c.date)),
    parseSkipDays(habit.skipDays)
  );

  if (existing) {
    await prisma.habitCompletion.delete({ where: { id: existing.id } });
  } else {
    const completion = await prisma.habitCompletion.create({ data: { habitId, date: today } });
    completionId = completion.id;
  }

  const updated = await prisma.habit.findUnique({
    where: { id: habitId },
    select: {
      id: true,
      skipDays: true,
      completions: { select: { date: true } },
    },
  }) as any;
  if (!updated) throw createError(404, 'HABIT_NOT_FOUND', 'Habit not found');

  const newStreak = calcStreak(
    updated.completions.map((c: any) => toDateStr(c.date)),
    parseSkipDays(habit.skipDays)
  );
  if (wasCompleted && newStreak < oldStreak && newStreak === 0) {
    await prisma.habit.update({
      where: { id: habitId },
      data: { streakBrokenAt: today } as any,
    });
    // Deduct XP for the broken streak (15 per day lost)
    await deductPoints({
      userId,
      points: oldStreak * 15,
      reason: 'STREAK_BROKEN',
      entityType: 'habit',
      entityId: habitId,
      description: `Streak broken for habit: ${habit.title} (lost ${oldStreak}-day streak)`,
    });

    const habitReminderEnabled = habit.user?.notificationPreferences?.habitReminder ?? true;
    if (habitReminderEnabled) {
      await notifService.sendNotification(
        userId,
        `Streak broken: ${habit.title}`,
        `Your streak for "${habit.title}" has been broken. Restart it today so the habit does not stay down for long.`,
        ['BROWSER_PUSH', 'EMAIL']
      );
    }
  }

  const durationDays = habit.durationDays;
  if (durationDays !== null && updated.completions.length >= durationDays) {
    await prisma.habit.update({
      where: { id: habitId },
      data: { isActive: false } as any,
    });
  }

  const finalHabit = await prisma.habit.findUnique({
    where: { id: habitId },
    select: {
      id: true,
      userId: true,
      goalId: true,
      title: true,
      targetPerWeek: true,
      reminderTime: true,
      createdAt: true,
      completions: { select: { date: true } },
      reminderMessage: true,
      durationDays: true,
      skipDays: true,
      streakBrokenAt: true,
      isActive: true,
    },
  }) as any;
  if (!finalHabit) throw createError(404, 'HABIT_NOT_FOUND', 'Habit not found');

  if (completionId) {
    await awardHabitCompletion(userId, completionId, habit.title);
  } else if (wasCompleted && existing) {
    await revokeHabitCompletion(userId, existing.id, habit.title);
  }
  if (finalHabit.goalId) {
    await recomputeGoalProgress(finalHabit.goalId).catch(() => undefined);
  }
  return toDTO(finalHabit);
}

export async function getBrokenStreaks(userId: string): Promise<HabitStreakBreakDTO[]> {
  const now = new Date();
  const recentWindowStart = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const habits = await prisma.habit.findMany({
    where: {
      userId,
      streakBrokenAt: {
        gte: recentWindowStart,
      },
    } as any,
    select: {
      id: true,
      title: true,
      skipDays: true,
      completions: { select: { date: true } },
      streakBrokenAt: true,
    },
    orderBy: {
      streakBrokenAt: 'desc',
    },
  }) as any[];

  return habits.map((h: any) => {
    const previousStreak = calcStreak(
      h.completions.map((c: any) => toDateStr(c.date)),
      parseSkipDays(h.skipDays)
    );
    return {
      habitId: h.id,
      title: h.title,
      previousStreak,
      xpLost: previousStreak * 15,
      brokenAt: h.streakBrokenAt?.toISOString() ?? now.toISOString(),
    };
  });
}

export async function getWeekOverview(userId: string): Promise<WeekOverviewDTO> {
  const habits = await prisma.habit.findMany({
    where: { userId },
    select: {
      id: true,
      title: true,
      createdAt: true,
      skipDays: true,
      completions: { select: { date: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const monday = utcMondayOfThisWeek();
  const today = utcToday();

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    const dateStr = toDateStr(d);

    const eligibleHabits = habits.filter((h) => toDateStr(h.createdAt) <= dateStr);
    const completed = eligibleHabits.filter((h) => {
      const hAny = h as any;
      const skipDayIndices = parseSkipDays(hAny.skipDays);
      const dow = getDayOfWeek(dateStr);
      if (skipDayIndices.includes(dow)) return true;
      return h.completions.some((c) => toDateStr(c.date) === dateStr);
    }).length;

    const total = eligibleHabits.length;
    const score = total === 0 ? 0 : Math.round((completed / total) * 100);

    return {
      date: dateStr,
      score,
      completed,
      total,
      isFuture: d > today,
      isToday: toDateStr(d) === toDateStr(today),
    };
  });

  return { days };
}
