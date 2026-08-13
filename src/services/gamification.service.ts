import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prismaClient';
import type { AchievementDTO, AchievementWithStatusDTO, GamificationProfileDTO, PointLedgerDTO } from '../types';

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
  progress: (stats: UserStats) => { current: number; target: number };
};

type UserStats = {
  totalPoints: number;
  tasksCompleted: number;
  habitsCompleted: number;
  focusSessionsCompleted: number;
  focusMinutes: number;
  projectsCompleted: number;
  goalsCompleted: number;
  milestonesCompleted: number;
  bestHabitStreak: number;
};

// ─── Leveling curve ─────────────────────────────────────────────────────────
// Flat XP-per-level was too easy to climb, so each level now requires more XP
// than the previous one (a linear growth curve). Tune LEVEL_BASE_XP and
// LEVEL_GROWTH here to change how hard it is to level up.
const LEVEL_BASE_XP = 500;
const LEVEL_GROWTH = 250;

/** XP required to advance from `level` to `level + 1`. Grows every level. */
function xpForLevel(level: number): number {
  return LEVEL_BASE_XP + (level - 1) * LEVEL_GROWTH;
}

// Named badge tiers attached to the current level, shown in the level UI so
// a level reads as a badge ("Operator", "Strategist", ...) not just a number.
const LEVEL_BADGES: Array<{ min: number; name: string }> = [
  { min: 50, name: 'Legend' },
  { min: 25, name: 'Champion' },
  { min: 10, name: 'Strategist' },
  { min: 5, name: 'Operator' },
  { min: 2, name: 'Achiever' },
  { min: 1, name: 'Beginner' },
];

function getLevelBadgeName(level: number): string {
  for (const badge of LEVEL_BADGES) {
    if (level >= badge.min) return badge.name;
  }
  return 'Beginner';
}

const ACHIEVEMENTS: AchievementDefinition[] = [
  // ─── Tasks ──────────────────────────────────────────────────────────────
  {
    key: 'first_task_done',
    title: 'First Win',
    description: 'Complete your first task.',
    tier: 'bronze',
    icon: 'check-circle',
    pointsAwarded: 50,
    isUnlocked: (stats) => stats.tasksCompleted >= 1,
    progress: (stats) => ({ current: stats.tasksCompleted, target: 1 }),
  },
  {
    key: 'task_crusher_25',
    title: 'Task Crusher',
    description: 'Complete 25 tasks.',
    tier: 'silver',
    icon: 'list-checks',
    pointsAwarded: 150,
    isUnlocked: (stats) => stats.tasksCompleted >= 25,
    progress: (stats) => ({ current: stats.tasksCompleted, target: 25 }),
  },
  {
    key: 'task_legend_100',
    title: 'Task Legend',
    description: 'Complete 100 tasks.',
    tier: 'gold',
    icon: 'trophy',
    pointsAwarded: 400,
    isUnlocked: (stats) => stats.tasksCompleted >= 100,
    progress: (stats) => ({ current: stats.tasksCompleted, target: 100 }),
  },
  {
    key: 'task_master_500',
    title: 'Task Master',
    description: 'Complete 500 tasks.',
    tier: 'platinum',
    icon: 'crown',
    pointsAwarded: 600,
    isUnlocked: (stats) => stats.tasksCompleted >= 500,
    progress: (stats) => ({ current: stats.tasksCompleted, target: 500 }),
  },

  // ─── Habits ─────────────────────────────────────────────────────────────
  {
    key: 'habit_spark',
    title: 'Habit Spark',
    description: 'Complete any habit for the first time.',
    tier: 'bronze',
    icon: 'flame',
    pointsAwarded: 50,
    isUnlocked: (stats) => stats.habitsCompleted >= 1,
    progress: (stats) => ({ current: stats.habitsCompleted, target: 1 }),
  },
  {
    key: 'seven_day_streak',
    title: '7 Day Streak',
    description: 'Build a 7 day habit streak.',
    tier: 'silver',
    icon: 'calendar-check',
    pointsAwarded: 150,
    isUnlocked: (stats) => stats.bestHabitStreak >= 7,
    progress: (stats) => ({ current: stats.bestHabitStreak, target: 7 }),
  },
  {
    key: 'thirty_day_streak',
    title: '30 Day Streak',
    description: 'Build a 30 day habit streak.',
    tier: 'gold',
    icon: 'badge-check',
    pointsAwarded: 350,
    isUnlocked: (stats) => stats.bestHabitStreak >= 30,
    progress: (stats) => ({ current: stats.bestHabitStreak, target: 30 }),
  },
  {
    key: 'streak_50',
    title: 'Half Century',
    description: 'Build a 50 day habit streak.',
    tier: 'silver',
    icon: 'medal',
    pointsAwarded: 250,
    isUnlocked: (stats) => stats.bestHabitStreak >= 50,
    progress: (stats) => ({ current: stats.bestHabitStreak, target: 50 }),
  },
  {
    key: 'century_streak',
    title: 'Century Streak',
    description: 'Build a 100 day habit streak.',
    tier: 'platinum',
    icon: 'star',
    pointsAwarded: 800,
    isUnlocked: (stats) => stats.bestHabitStreak >= 100,
    progress: (stats) => ({ current: stats.bestHabitStreak, target: 100 }),
  },
  {
    key: 'habit_master_100',
    title: 'Habit Master',
    description: 'Complete 100 habits total.',
    tier: 'gold',
    icon: 'award',
    pointsAwarded: 300,
    isUnlocked: (stats) => stats.habitsCompleted >= 100,
    progress: (stats) => ({ current: stats.habitsCompleted, target: 100 }),
  },

  // ─── Focus ──────────────────────────────────────────────────────────────
  {
    key: 'focus_rookie',
    title: 'Focus Rookie',
    description: 'Finish your first focus session.',
    tier: 'bronze',
    icon: 'timer',
    pointsAwarded: 50,
    isUnlocked: (stats) => stats.focusSessionsCompleted >= 1,
    progress: (stats) => ({ current: stats.focusSessionsCompleted, target: 1 }),
  },
  {
    key: 'deep_work_hour',
    title: 'Deep Work Hour',
    description: 'Log 60 minutes of focused work.',
    tier: 'silver',
    icon: 'brain',
    pointsAwarded: 125,
    isUnlocked: (stats) => stats.focusMinutes >= 60,
    progress: (stats) => ({ current: stats.focusMinutes, target: 60 }),
  },
  {
    key: 'focus_marathon',
    title: 'Focus Marathon',
    description: 'Log 300 minutes of focused work.',
    tier: 'silver',
    icon: 'zap',
    pointsAwarded: 200,
    isUnlocked: (stats) => stats.focusMinutes >= 300,
    progress: (stats) => ({ current: stats.focusMinutes, target: 300 }),
  },

  // ─── Projects ───────────────────────────────────────────────────────────
  {
    key: 'project_shipper',
    title: 'Project Shipper',
    description: 'Complete your first project.',
    tier: 'gold',
    icon: 'rocket',
    pointsAwarded: 250,
    isUnlocked: (stats) => stats.projectsCompleted >= 1,
    progress: (stats) => ({ current: stats.projectsCompleted, target: 1 }),
  },
  {
    key: 'project_legend_10',
    title: 'Project Legend',
    description: 'Complete 10 projects.',
    tier: 'platinum',
    icon: 'target',
    pointsAwarded: 500,
    isUnlocked: (stats) => stats.projectsCompleted >= 10,
    progress: (stats) => ({ current: stats.projectsCompleted, target: 10 }),
  },

  // ─── Goals ────────────────────────────────────────────────────────────────
  {
    key: 'first_goal_completed',
    title: 'Goal Getter',
    description: 'Complete your first goal.',
    tier: 'bronze',
    icon: 'flag',
    pointsAwarded: 75,
    isUnlocked: (stats) => stats.goalsCompleted >= 1,
    progress: (stats) => ({ current: stats.goalsCompleted, target: 1 }),
  },
  {
    key: 'goal_achiever_5',
    title: 'Goal Achiever',
    description: 'Complete 5 goals.',
    tier: 'silver',
    icon: 'trophy',
    pointsAwarded: 200,
    isUnlocked: (stats) => stats.goalsCompleted >= 5,
    progress: (stats) => ({ current: stats.goalsCompleted, target: 5 }),
  },
  {
    key: 'goal_master_25',
    title: 'Goal Master',
    description: 'Complete 25 goals.',
    tier: 'gold',
    icon: 'crown',
    pointsAwarded: 500,
    isUnlocked: (stats) => stats.goalsCompleted >= 25,
    progress: (stats) => ({ current: stats.goalsCompleted, target: 25 }),
  },
  {
    key: 'milestone_builder_10',
    title: 'Milestone Builder',
    description: 'Complete 10 goal milestones.',
    tier: 'silver',
    icon: 'flag',
    pointsAwarded: 150,
    isUnlocked: (stats) => stats.milestonesCompleted >= 10,
    progress: (stats) => ({ current: stats.milestonesCompleted, target: 10 }),
  },

  // ─── Level ──────────────────────────────────────────────────────────────
  {
    key: 'level_five',
    title: 'Level 5 Operator',
    description: 'Reach level 5 through consistent progress.',
    tier: 'platinum',
    icon: 'sparkles',
    pointsAwarded: 500,
    isUnlocked: (stats) => getLevel(stats.totalPoints).level >= 5,
    progress: (stats) => ({ current: getLevel(stats.totalPoints).level, target: 5 }),
  },
  {
    key: 'level_two',
    title: 'Second Wind',
    description: 'Reach level 2.',
    tier: 'bronze',
    icon: 'star',
    pointsAwarded: 50,
    isUnlocked: (stats) => getLevel(stats.totalPoints).level >= 2,
    progress: (stats) => ({ current: getLevel(stats.totalPoints).level, target: 2 }),
  },
  {
    key: 'level_ten',
    title: 'Level 10 Strategist',
    description: 'Reach level 10.',
    tier: 'gold',
    icon: 'sparkles',
    pointsAwarded: 400,
    isUnlocked: (stats) => getLevel(stats.totalPoints).level >= 10,
    progress: (stats) => ({ current: getLevel(stats.totalPoints).level, target: 10 }),
  },
  {
    key: 'level_25',
    title: 'Level 25 Champion',
    description: 'Reach level 25.',
    tier: 'platinum',
    icon: 'crown',
    pointsAwarded: 600,
    isUnlocked: (stats) => getLevel(stats.totalPoints).level >= 25,
    progress: (stats) => ({ current: getLevel(stats.totalPoints).level, target: 25 }),
  },
  {
    key: 'level_50',
    title: 'Level 50 Legend',
    description: 'Reach level 50.',
    tier: 'platinum',
    icon: 'target',
    pointsAwarded: 900,
    isUnlocked: (stats) => getLevel(stats.totalPoints).level >= 50,
    progress: (stats) => ({ current: getLevel(stats.totalPoints).level, target: 50 }),
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
  let level = 1;
  let remaining = totalPoints;
  // Consume each level's (growing) XP requirement until there isn't enough
  // left for the next level. Terminates because xpForLevel grows with level.
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  const currentLevelPoints = remaining;
  const nextLevelPoints = xpForLevel(level);
  const progressPercent = Math.round((currentLevelPoints / nextLevelPoints) * 100);
  return {
    level,
    currentLevelPoints,
    nextLevelPoints,
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
  const [points, tasksCompleted, habitsCompleted, focusStats, projectsCompleted, goalsCompleted, milestonesCompleted, habits] =
    await Promise.all([
      tx.pointLedger.aggregate({ where: { userId }, _sum: { points: true } }),
      tx.task.count({ where: { userId, status: 'DONE' } }),
      tx.habitCompletion.count({ where: { habit: { userId } } }),
      tx.focusSession.aggregate({
        where: { userId, status: 'COMPLETED', isBreak: false },
        _count: true,
        _sum: { durationMin: true },
      }),
      tx.project.count({ where: { userId, status: 'COMPLETED' } }),
      tx.goal.count({ where: { userId, status: 'COMPLETED' } }),
      tx.goalMilestone.count({ where: { goal: { userId }, status: 'COMPLETED' } }),
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
    goalsCompleted,
    milestonesCompleted,
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
  const revoked: string[] = [];

  const alreadyUnlocked = await tx.userAchievement.findMany({ where: { userId } });
  const unlockedMap = new Map(alreadyUnlocked.map((a) => [a.key, a]));

  for (const achievement of ACHIEVEMENTS) {
    const isNowUnlocked = achievement.isUnlocked(stats);
    const wasUnlocked = unlockedMap.has(achievement.key);

    if (isNowUnlocked && !wasUnlocked) {
      // Newly unlocked — award points
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
    } else if (!isNowUnlocked && wasUnlocked) {
      // Achievement no longer met — revoke it and deduct points
      try {
        await tx.userAchievement.delete({
          where: { id: unlockedMap.get(achievement.key)!.id },
        });
        revoked.push(achievement.key);

        if (achievement.pointsAwarded > 0) {
          await createPointLedger(tx, {
            userId,
            points: -achievement.pointsAwarded,
            reason: 'ACHIEVEMENT_REVOKED',
            entityType: 'achievement',
            entityId: achievement.key,
            description: `Achievement revoked: ${achievement.title}`,
          });
        }
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          continue; // already deleted
        }
        throw error;
      }
    }
  }

  return { unlocked: unlocked.map(toAchievementDTO), revoked };
}

export async function awardPoints(input: AwardInput, tx: GamificationTx = prisma) {
  const created = await createPointLedger(tx, input);
  const result = created ? await evaluateAchievements(input.userId, tx) : { unlocked: [], revoked: [] };
  return {
    pointsAwarded: created?.points ?? 0,
    unlockedAchievements: result.unlocked,
    revokedAchievements: result.revoked,
  };
}

/**
 * Deducts XP by creating a negative point ledger entry.
 * This is the reverse operation for awarding points.
 * Triggers achievement re-evaluation so revoked achievements are cleaned up too.
 */
export async function deductPoints(input: AwardInput, tx: GamificationTx = prisma) {
  const deduction = await createPointLedger(tx, {
    ...input,
    points: -Math.abs(input.points), // ensure negative
  });
  const result = deduction ? await evaluateAchievements(input.userId, tx) : { unlocked: [], revoked: [] };
  return {
    pointsDeducted: deduction?.points ?? 0,
    unlockedAchievements: result.unlocked,
    revokedAchievements: result.revoked,
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

export async function revokeTaskCompletion(userId: string, taskId: string, title: string) {
  return deductPoints({
    userId,
    points: 25,
    reason: 'TASK_UNCOMPLETED',
    entityType: 'task',
    entityId: taskId,
    description: `Uncompleted task: ${title}`,
  });
}

export async function deleteTaskPoints(userId: string, taskId: string, title: string) {
  return deductPoints({
    userId,
    points: 25,
    reason: 'TASK_DELETED',
    entityType: 'task',
    entityId: taskId,
    description: `Deleted completed task: ${title}`,
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

export async function revokeHabitCompletion(userId: string, completionId: string, title: string) {
  return deductPoints({
    userId,
    points: 15,
    reason: 'HABIT_UNCOMPLETED',
    entityType: 'habitCompletion',
    entityId: completionId,
    description: `Uncompleted habit: ${title}`,
  });
}

export async function awardFocusSession(userId: string, sessionId: string, minutes: number) {
  if (minutes <= 0) return { pointsAwarded: 0, unlockedAchievements: [], revokedAchievements: [] };
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

export async function revokeProjectCompletion(userId: string, projectId: string, name: string) {
  return deductPoints({
    userId,
    points: 100,
    reason: 'PROJECT_UNCOMPLETED',
    entityType: 'project',
    entityId: projectId,
    description: `Uncompleted project: ${name}`,
  });
}

export async function deleteProjectPoints(userId: string, projectId: string, name: string) {
  return deductPoints({
    userId,
    points: 100,
    reason: 'PROJECT_DELETED',
    entityType: 'project',
    entityId: projectId,
    description: `Deleted completed project: ${name}`,
  });
}

export async function awardGoalCompletion(userId: string, goalId: string, title: string) {
  return awardPoints({
    userId,
    points: 200,
    reason: 'GOAL_COMPLETED',
    entityType: 'goal',
    entityId: goalId,
    description: `Completed goal: ${title}`,
  });
}

export async function revokeGoalCompletion(userId: string, goalId: string, title: string) {
  return deductPoints({
    userId,
    points: 200,
    reason: 'GOAL_UNCOMPLETED',
    entityType: 'goal',
    entityId: goalId,
    description: `Goal uncompleted: ${title}`,
  });
}

export async function deleteGoalPoints(userId: string, goalId: string, title: string) {
  return deductPoints({
    userId,
    points: 200,
    reason: 'GOAL_DELETED',
    entityType: 'goal',
    entityId: goalId,
    description: `Deleted completed goal: ${title}`,
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
    currentLevelBadge: getLevelBadgeName(getLevel(totalPoints).level),
    achievements: achievements.map(toAchievementDTO),
    recentAchievements: achievements.slice(0, 5).map(toAchievementDTO),
    recentPoints: recentPoints.map(toPointDTO),
  };
}

export async function getAchievementsWithStatus(userId: string): Promise<AchievementWithStatusDTO[]> {
  const stats = await getStats(userId);
  const unlockedAchievements = await prisma.userAchievement.findMany({
    where: { userId },
  });
  const unlockedMap = new Map(unlockedAchievements.map((a) => [a.key, a]));

  return ACHIEVEMENTS.map((achievement) => {
    const unlocked = unlockedMap.get(achievement.key);
    const prog = achievement.progress(stats);
    const progress = prog.target > 0 ? Math.min(100, Math.round((prog.current / prog.target) * 100)) : 0;

    return {
      key: achievement.key,
      title: achievement.title,
      description: achievement.description,
      tier: achievement.tier,
      icon: achievement.icon,
      pointsAwarded: achievement.pointsAwarded,
      isUnlocked: !!unlocked,
      unlockedAt: unlocked?.unlockedAt.toISOString() ?? null,
      progress,
      progressCurrent: prog.current,
      progressTarget: prog.target,
    };
  });
}
