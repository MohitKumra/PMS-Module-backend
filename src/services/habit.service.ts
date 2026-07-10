import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import type { HabitDTO, CreateHabitRequest, UpdateHabitRequest } from '../types';

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function todayStr(): string {
  return toDateStr(new Date());
}

/**
 * UTC midnight for "today". Use this (never `new Date(); d.setHours(0,0,0,0)`)
 * anywhere a completion date is created or queried — that local-time version
 * is what caused completedToday to disagree with the streak/heatmap/week
 * data on the same card: writes and reads have to agree on the same
 * calendar day regardless of server timezone.
 */
function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function daysBetween(a: string, b: string): number {
  return (new Date(`${b}T00:00:00.000Z`).getTime() - new Date(`${a}T00:00:00.000Z`).getTime()) / 86400000;
}

function calcStreak(dates: string[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...new Set(dates)].sort().reverse();
  const today = utcToday();
  const yesterday = new Date(today); yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  let cursor = new Date(`${sorted[0]}T00:00:00.000Z`);
  if (cursor < yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i]}T00:00:00.000Z`);
    const diff = (cursor.getTime() - prev.getTime()) / 86400000;
    if (diff === 1) { streak++; cursor = prev; }
    else break;
  }
  return streak;
}

function calcBestStreak(dates: string[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...new Set(dates)].sort();
  let best = 1, current = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (daysBetween(sorted[i - 1], sorted[i]) === 1) {
      current++; best = Math.max(best, current);
    } else current = 1;
  }
  return best;
}

/** Monday index of the current UTC calendar week, as a UTC Date. */
function utcMondayOfThisWeek(): Date {
  const today = utcToday();
  const dow = today.getUTCDay(); // 0=Sun..6=Sat
  const offset = (dow + 6) % 7; // days since Monday
  const monday = new Date(today);
  monday.setUTCDate(monday.getUTCDate() - offset);
  return monday;
}

function calcWeekPattern(dateSet: Set<string>): boolean[] {
  const monday = utcMondayOfThisWeek();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return dateSet.has(toDateStr(d));
  });
}

function calcHeatmap(dateSet: Set<string>, weeks = 12): boolean[] {
  const cells = weeks * 7;
  const today = utcToday();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (cells - 1));
  return Array.from({ length: cells }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return dateSet.has(toDateStr(d));
  });
}

async function toDTO(h: {
  id: string; userId: string; title: string; targetPerWeek: number;
  reminderTime: string | null; createdAt: Date;
  completions: { date: Date }[];
}): Promise<HabitDTO> {
  const dateStrings = h.completions.map((c) => toDateStr(c.date));
  const dateSet = new Set(dateStrings);
  const today = todayStr();

  const monday = utcMondayOfThisWeek();
  const lastMonday = new Date(monday); lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);

  const completionsThisWeek = h.completions.filter((c) => c.date >= monday).length;
  const completionsLastWeek = h.completions.filter(
    (c) => c.date >= lastMonday && c.date < monday
  ).length;

  return {
    id: h.id, userId: h.userId, title: h.title,
    targetPerWeek: h.targetPerWeek, reminderTime: h.reminderTime,
    createdAt: h.createdAt.toISOString(),
    currentStreak: calcStreak(dateStrings),
    bestStreak: calcBestStreak(dateStrings),
    completedToday: dateSet.has(today),
    completionsThisWeek,
    completionsLastWeek,
    weekPattern: calcWeekPattern(dateSet),
    completionDates: dateStrings, // NEW — full history, 'YYYY-MM-DD' UTC strings
  };
}

export async function listHabits(userId: string): Promise<{
  data: HabitDTO[]; meta: { total: number; weeklyTrend: number };
}> {
  const habits = await prisma.habit.findMany({
    where: { userId },
    include: { completions: { select: { date: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const data = await Promise.all(habits.map(toDTO));

  const thisWeekTotal = data.reduce((sum, h) => sum + h.completionsThisWeek, 0);
  const lastWeekTotal = data.reduce((sum, h) => sum + h.completionsLastWeek, 0);
  const weeklyTrend =
    lastWeekTotal === 0
      ? (thisWeekTotal > 0 ? 100 : 0)
      : Math.round(((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 1000) / 10;

  return { data, meta: { total: data.length, weeklyTrend } };
}

export async function createHabit(userId: string, data: CreateHabitRequest): Promise<HabitDTO> {
  const habit = await prisma.habit.create({
    data: { userId, title: data.title, targetPerWeek: data.targetPerWeek ?? 7, reminderTime: data.reminderTime ?? null },
    include: { completions: { select: { date: true } } },
  });
  return toDTO(habit);
}

export async function updateHabit(userId: string, habitId: string, data: UpdateHabitRequest): Promise<HabitDTO> {
  const existing = await prisma.habit.findFirst({ where: { id: habitId, userId } });
  if (!existing) throw createError(404, 'HABIT_NOT_FOUND', 'Habit not found');
  const habit = await prisma.habit.update({
    where: { id: habitId },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.targetPerWeek !== undefined && { targetPerWeek: data.targetPerWeek }),
      ...(data.reminderTime !== undefined && { reminderTime: data.reminderTime }),
    },
    include: { completions: { select: { date: true } } },
  });
  return toDTO(habit);
}

export async function deleteHabit(userId: string, habitId: string): Promise<void> {
  const existing = await prisma.habit.findFirst({ where: { id: habitId, userId } });
  if (!existing) throw createError(404, 'HABIT_NOT_FOUND', 'Habit not found');
  await prisma.habit.delete({ where: { id: habitId } });
}

export async function toggleCompletion(userId: string, habitId: string): Promise<HabitDTO> {
  const habit = await prisma.habit.findFirst({ where: { id: habitId, userId } });
  if (!habit) throw createError(404, 'HABIT_NOT_FOUND', 'Habit not found');

  const today = utcToday(); // <-- the actual fix: same "today" definition as reads
  const existing = await prisma.habitCompletion.findUnique({
    where: { habitId_date: { habitId, date: today } },
  });

  if (existing) {
    await prisma.habitCompletion.delete({ where: { id: existing.id } });
  } else {
    await prisma.habitCompletion.create({ data: { habitId, date: today } });
  }

  const updated = await prisma.habit.findUnique({
    where: { id: habitId },
    include: { completions: { select: { date: true } } },
  });
  return toDTO(updated!);
}