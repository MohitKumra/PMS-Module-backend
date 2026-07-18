import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prismaClient';
import type {
  AchievementDTO,
  GamificationProfileDTO,
  PointLedgerDTO,
} from '../types';

type GamificationTx = Prisma.TransactionClient;

type AwardInput = {
  userId: string;
  points: number;
  reason: string;
  entityType: string;
  entityId: string;
  description: string;
};

type AchievementDefinition = {
  key: string;
  title: string;
  description: string;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  icon: string;
  pointsAwarded: number;
  isUnlocked: (stats: UserStats) => boolean;
};

type UserStats = {
  totalPoints: number;
  tasksCompleted: number;
  habitsCompleted: number;
  focusSessionsCompleted: number;
  focusMinutes: number;
  projectsCompleted: number;
  bestHabitStreak: number;
};

const LEVEL_POINTS = 500;

const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    key: 'first_task_done',
    title: 'First Win',
    description: 'Complete your first task.',
    tier: 'bronze',
    icon: 'check-circle',
    pointsAwarded: 50,
    isUnlocked: (stats) => stats.tasksCompleted >= 1,
  },
  {
    key: 'task_crusher_25',
    title: 'Task Crusher',
    description: 'Complete 25 tasks.',
    tier: 'silver',
    icon: 'list-checks',
    pointsAwarded: 150,
    isUnlocked: (stats) => stats.tasksCompleted >= 25,
  },
  {
    key: 'task_legend_100',
    title: 'Task Legend',
    description: 'Complete 100 tasks.',
    tier: 'gold',
    icon: 'trophy',
    pointsAwarded: 400,
    isUnlocked: (stats) => stats.tasksCompleted >= 100,
  },
  {
    key: 'habit_spark',
    title: 'Habit Spark',
    description: 'Complete any habit for the first time.',
    tier: 'bronze',
    icon: 'flame',
    pointsAwarded: 50,
    isUnlocked: (stats) => stats.habitsCompleted >= 1,
  },
  {
    key: 'seven_day_streak',
    title: '7 Day Streak',
    description: 'Build a 7 day habit streak.',
    tier: 'silver',
    icon: 'calendar-check',
    pointsAwarded: 150,
    isUnlocked: (stats) => stats.bestHabitStreak >= 7,
  },
  {
    key: 'thirty_day_streak',
    title: '30 Day Streak',
    description: 'Build a 30 day habit streak.',
    tier: 'gold',
    icon: 'badge-check',
    pointsAwarded: 350,
    isUnlocked: (stats) => stats.bestHabitStreak >= 30,
  },
  {
    key: 'focus_rookie',
    title: 'Focus Rookie',
    description: 'Finish your first focus session.',
    tier: 'bronze',
    icon: 'timer',
    pointsAwarded: 50,
    isUnlocked: (stats) => stats.focusSessionsCompleted >= 1,
  },
  {
    key: 'deep_work_hour',
    title: 'Deep Work Hour',
    description: 'Log 60 minutes of focused work.',
    tier: 'silver',
    icon: 'brain',
    pointsAwarded: 125,
    isUnlocked: (stats) => stats.focusMinutes >= 60,
  },
  {
    key: 'project_shipper',
    title: 'Project Shipper',
    description: 'Complete your first project.',
    tier: 'gold',
    icon: 'rocket',
    pointsAwarded: 250,
    isUnlocked: (stats) => stats.projectsCompleted >= 1,
  },
  {
    key: 'level_five',
    title: 'Level 5 Operator',
    description: 'Reach level 5 through consistent progress.',
    tier: 'platinum',
    icon: 'sparkles',
    pointsAwarded: 500,
    isUnlocked: (stats) => getLevel(stats.totalPoints).level >= 5,
  },
];

function toPointDTO(row: {
  id: string;
  points: number;
  reason: string;
  entityType: string;
  entityId: string;
  description: string;
  createdAt: Date;
}): PointLedgerDTO {
  return {
    id: row.id,
    points: row.points,
    reason: row.reason,
    entityType: row.entityType,
    entityId: row.entityId,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  };
}

function toAchievementDTO(row: {
  id: string;
  key: string;
  title: string;
  description: string;
  tier: string;
  icon: string;
  pointsAwarded: number;
  unlockedAt: Date;
}): AchievementDTO {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    description: row.description,
    tier: row.tier as AchievementDTO['tier'],
    icon: row.icon,
    pointsAwarded: row.pointsAwarded,
    unlockedAt: row.unlockedAt.toISOString(),
  };
}

function getLevel(totalPoints: number) {
  const level = Math.floor(totalPoints / LEVEL_POINTS) + 1;
  const currentLevelPoints = totalPoints % LEVEL_POINTS;
  const progressPercent = Math.round((currentLevelPoints / LEVEL_POINTS) * 100);
  return {
    level,
    currentLevelPoints,
    nextLevelPoints: LEVEL_POINTS,
    progressPercent,
  };
}

async function createPointLedger(tx: GamificationTx, input: AwardInput) {
  try {
    return await tx.pointLedger.create({ data: input });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return null;
    }
    throw error;
  }
}

async function getStats(userId: string, tx: GamificationTx = prisma): Promise<UserStats> {
  const [points, tasksCompleted, habitsCompleted, focusStats, projectsCompleted, habits] =
    await Promise.all([
      tx.pointLedger.aggregate({ where: { userId }, _sum: { points: true } }),
      tx.task.count({ where: { userId, status: 'DONE' } }),
      tx.habitCompletion.count({ where: { habit: { userId } } }),
      tx.focusSession.aggregate({
        where: { userId, completed: true, isBreak: false },
        _count: true,
        _sum: { durationMin: true },
      }),
      tx.project.count({ where: { userId, status: 'COMPLETED' } }),
      tx.habit.findMany({
        where: { userId },
        select: { completions: { select: { date: true } } },
      }),
    ]);

  return {
    totalPoints: points._sum.points ?? 0,
    tasksCompleted,
    habitsCompleted,
    focusSessionsCompleted: focusStats._count,
    focusMinutes: focusStats._sum.durationMin ?? 0,
    projectsCompleted,
    bestHabitStreak: Math.max(
      0,
      ...habits.map((habit) => calcBestStreak(habit.completions.map((c) => dateKey(c.date))))
    ),
  };
}

function dateKey(date: Date) {
  return date.toISOString().split('T')[0];
}

function daysBetween(a: string, b: string): number {
  return (new Date(`${b}T00:00:00.000Z`).getTime() - new Date(`${a}T00:00:00.000Z`).getTime()) / 86400000;
}

function calcBestStreak(dates: string[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...new Set(dates)].sort();
  let best = 1;
  let current = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    if (daysBetween(sorted[i - 1], sorted[i]) === 1) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 1;
    }
  }
  return best;
}

async function evaluateAchievements(userId: string, tx: GamificationTx = prisma) {
  const stats = await getStats(userId, tx);
  const unlocked: Awaited<ReturnType<GamificationTx['userAchievement']['create']>>[] = [];

  for (const achievement of ACHIEVEMENTS) {
    if (!achievement.isUnlocked(stats)) continue;

    try {
      const created = await tx.userAchievement.create({
        data: {
          userId,
          key: achievement.key,
          title: achievement.title,
          description: achievement.description,
          tier: achievement.tier,
          icon: achievement.icon,
          pointsAwarded: achievement.pointsAwarded,
        },
      });
      unlocked.push(created);

      if (achievement.pointsAwarded > 0) {
        await createPointLedger(tx, {
          userId,
          points: achievement.pointsAwarded,
          reason: 'ACHIEVEMENT_UNLOCKED',
          entityType: 'achievement',
          entityId: achievement.key,
          description: `Unlocked ${achievement.title}`,
        });
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        continue;
      }
      throw error;
    }
  }

  return unlocked.map(toAchievementDTO);
}

export async function awardPoints(input: AwardInput, tx: GamificationTx = prisma) {
  const created = await createPointLedger(tx, input);
  const unlockedAchievements = created ? await evaluateAchievements(input.userId, tx) : [];
  return {
    pointsAwarded: created?.points ?? 0,
    unlockedAchievements,
  };
}

export async function awardTaskCompletion(userId: string, taskId: string, title: string) {
  return awardPoints({
    userId,
    points: 25,
    reason: 'TASK_COMPLETED',
    entityType: 'task',
    entityId: taskId,
    description: `Completed task: ${title}`,
  });
}

export async function awardHabitCompletion(userId: string, completionId: string, title: string) {
  return awardPoints({
    userId,
    points: 15,
    reason: 'HABIT_COMPLETED',
    entityType: 'habitCompletion',
    entityId: completionId,
    description: `Completed habit: ${title}`,
  });
}

export async function awardFocusSession(userId: string, sessionId: string, minutes: number) {
  if (minutes <= 0) return { pointsAwarded: 0, unlockedAchievements: [] };
  return awardPoints({
    userId,
    points: Math.max(10, Math.round(minutes)),
    reason: 'FOCUS_SESSION_COMPLETED',
    entityType: 'focusSession',
    entityId: sessionId,
    description: `Finished ${minutes} minute focus session`,
  });
}

export async function awardProjectCompletion(userId: string, projectId: string, name: string) {
  return awardPoints({
    userId,
    points: 100,
    reason: 'PROJECT_COMPLETED',
    entityType: 'project',
    entityId: projectId,
    description: `Completed project: ${name}`,
  });
}

export async function getGamificationProfile(userId: string): Promise<GamificationProfileDTO> {
  await evaluateAchievements(userId);

  const [points, achievements, recentPoints] = await Promise.all([
    prisma.pointLedger.aggregate({ where: { userId }, _sum: { points: true } }),
    prisma.userAchievement.findMany({
      where: { userId },
      orderBy: { unlockedAt: 'desc' },
    }),
    prisma.pointLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
  ]);

  const totalPoints = points._sum.points ?? 0;
  return {
    totalPoints,
    ...getLevel(totalPoints),
    achievements: achievements.map(toAchievementDTO),
    recentAchievements: achievements.slice(0, 5).map(toAchievementDTO),
    recentPoints: recentPoints.map(toPointDTO),
  };
}
