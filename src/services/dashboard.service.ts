// backend/src/services/dashboard.service.ts
// Aggregates data from Tasks, Habits, Projects, FocusSessions for the enhanced dashboard.

import { prisma } from '../lib/prismaClient';
import type { AnalyticsSummaryDTO, EnhancedDashboardDTO } from '../types';
import { getSummary, getWeeklyProgress, getUpcomingDeadlines } from './analytics.service';
import { getGamificationProfile } from './gamification.service';
import { generateInsights } from './insight.service';

/**
 * Get dashboard summary data for a user.
 * Returns all the stats needed for the dashboard in a single call.
 */
export async function getDashboardSummary(userId: string): Promise<AnalyticsSummaryDTO> {
  return getSummary(userId);
}

/**
 * Get enhanced dashboard data with projects, messages, and weekly progress
 */
export async function getEnhancedDashboard(userId: string): Promise<EnhancedDashboardDTO> {
  const [summary, gamification, activeProjects, projectStats, weeklyProgress, upcomingDeadlines, insights] = await Promise.all([
    getSummary(userId),
    getGamificationProfile(userId),
    // Get active projects (top 6 by recent activity)
    prisma.project.findMany({
      where: {
        userId,
        status: { in: ['PLANNING', 'ACTIVE'] },
      },
      include: {
        _count: { select: { tasks: true } },
        tasks: {
          include: { task: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 6,
    }),
    // Get project statistics
    prisma.project.groupBy({
      by: ['status'],
      where: { userId },
      _count: true,
    }),
    // Get weekly progress
    getWeeklyProgress(userId, 8), // Last 8 weeks
    // Get upcoming deadlines
    getUpcomingDeadlines(userId, 7), // Next 7 days
    // Get smart insights
    generateInsights(userId),
  ]);

  // Transform active projects
  const projectsData = activeProjects.map((p: any) => {
    const completedTaskCount = p.tasks.filter((pt: any) => pt.task.status === 'DONE').length;
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      color: p.color ?? '#4F46E5',
      userId: p.userId,
      startDate: p.startDate?.toISOString() ?? null,
      dueDate: p.dueDate?.toISOString() ?? null,
      attachmentUrl: p.attachmentUrl ?? null,
      voiceNoteUrl: p.voiceNoteUrl ?? null,
      attachments: [],
      voiceNotes: [],
      progress: p.progress,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      taskCount: p._count.tasks,
      completedTaskCount,
    };
  });

  // Calculate project stats
  const totalProjects = projectStats.reduce((acc: any, stat: any) => acc + stat._count, 0);
  const activeProjectsCount = projectStats.find((s: any) => s.status === 'ACTIVE')?._count ?? 0;
  const completedProjectsCount = projectStats.find((s: any) => s.status === 'COMPLETED')?._count ?? 0;

  return {
    ...summary,
    gamification,
    activeProjects: projectsData,
    projectStats: {
      totalProjects,
      activeProjectsCount,
      completedProjectsCount,
    },
    weeklyProgress,
    upcomingDeadlines,
    insights,
  };
}

/**
 * Get pending tasks count for today.
 */
export async function getPendingTasksCount(userId: string): Promise<number> {
  return prisma.task.count({
    where: { userId, status: { in: ['TODO', 'IN_PROGRESS'] } },
  });
}

/**
 * Get habits that need to be completed today.
 * Uses UTC-based "today" to stay consistent with habit.service.ts.
 */
export async function getHabitsToCompleteToday(userId: string): Promise<number> {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const habits = await prisma.habit.findMany({
    where: { userId },
    select: {
      id: true,
      completions: {
        where: {
          date: {
            gte: today,
            lt: tomorrow,
          },
        },
      },
    },
  });
  return habits.filter((h: any) => h.completions.length === 0).length;
}
