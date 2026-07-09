// backend/src/services/habit.service.ts
// Business logic for habits, completions, and streak calculation.
//
// Streak algorithm:
//   A streak is the count of consecutive days (ending today or yesterday)
//   where the habit was completed. We look at sorted completion dates and
//   walk backwards from today, counting unbroken days.

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import type { HabitDTO, CreateHabitRequest, UpdateHabitRequest } from '../types';

/** Returns "YYYY-MM-DD" for a given Date in UTC. */
function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

/** Today's date string in UTC. */
function todayStr(): string {
  return toDateStr(new Date());
}

/**
 * Calculates the current streak for an array of completion date strings
 * (sorted ascending). A streak is consecutive calendar days ending on today
 * or yesterday (grace period so a habit done yesterday isn't broken at midnight).
 */
function calcStreak(dates: string[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...new Set(dates)].sort().reverse(); // newest first, deduplicated
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

  let cursor = new Date(sorted[0]);
  cursor.setHours(0, 0, 0, 0);

  // Streak must start from today or yesterday
  if (cursor < yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i]); prev.setHours(0, 0, 0, 0);
    const diff = (cursor.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
    if (diff === 1) { streak++; cursor = prev; }
    else break;
  }
  return streak;
}

async function toDTO(h: {
  id: string; userId: string; title: string; targetPerWeek: number;
  reminderTime: string | null; createdAt: Date;
  completions: { date: Date }[];
}): Promise<HabitDTO> {
  const dateStrings = h.completions.map((c) => toDateStr(c.date));
  const today = todayStr();

  // Completions this week (Mon–Sun)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const completionsThisWeek = h.completions.filter((c) => c.date >= monday).length;

  return {
    id: h.id, userId: h.userId, title: h.title,
    targetPerWeek: h.targetPerWeek, reminderTime: h.reminderTime,
    createdAt: h.createdAt.toISOString(),
    currentStreak: calcStreak(dateStrings),
    completedToday: dateStrings.includes(today),
    completionsThisWeek,
  };
}

export async function listHabits(userId: string): Promise<{ data: HabitDTO[]; meta: { total: number } }> {
  const habits = await prisma.habit.findMany({
    where: { userId },
    include: { completions: { select: { date: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const data = await Promise.all(habits.map(toDTO));
  return { data, meta: { total: data.length } };
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

/** Toggle today's completion for a habit (check-in or uncheck). */
export async function toggleCompletion(userId: string, habitId: string): Promise<HabitDTO> {
  const habit = await prisma.habit.findFirst({ where: { id: habitId, userId } });
  if (!habit) throw createError(404, 'HABIT_NOT_FOUND', 'Habit not found');

  const today = new Date(); today.setHours(0, 0, 0, 0);
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
