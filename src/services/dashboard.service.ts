// backend/src/services/dashboard.service.ts
// Aggregates data from Tasks, Habits, Projects, FocusSessions, and Messages for the enhanced dashboard.

import { prisma } from '../lib/prismaClient';
import type { AnalyticsSummaryDTO, EnhancedDashboardDTO } from '../types';
import { getSummary } from './analytics.service';
import { getWeeklyProgress, getUpcomingDeadlines } from './analytics.service';

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
  const [summary, activeProjects, recentMessages, projectStats, weeklyProgress, upcomingDeadlines] = await Promise.all([
    getSummary(userId),
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
    // Get recent messages (top 10)
    prisma.message.findMany({
      where: { userId },
      include: { project: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
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
  ]);

  // Transform active projects
  const projectsData = activeProjects.map((p) => {
    const completedTaskCount = p.tasks.filter((pt) => pt.task.status === 'DONE').length;
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      color: p.color ?? '#4F46E5',
      userId: p.userId,
      startDate: p.startDate?.toISOString() ?? null,
      dueDate: p.dueDate?.toISOString() ?? null,
      progress: p.progress,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      taskCount: p._count.tasks,
      completedTaskCount,
    };
  });

  // Transform messages
  const messagesData = recentMessages.map((m) => ({
    id: m.id,
    type: m.type,
    content: m.content,
    userId: m.userId,
    projectId: m.projectId,
    status: m.status,
    readAt: m.readAt?.toISOString() ?? null,
    priority: m.priority,
    actionUrl: m.actionUrl,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    project: m.project ? {
      id: m.project.id,
      name: m.project.name,
      description: m.project.description,
      status: m.project.status,
      color: m.project.color ?? '#4F46E5',
      userId: m.project.userId,
      startDate: m.project.startDate?.toISOString() ?? null,
      dueDate: m.project.dueDate?.toISOString() ?? null,
      progress: m.project.progress,
      createdAt: m.project.createdAt.toISOString(),
      updatedAt: m.project.updatedAt.toISOString(),
    } : undefined,
  }));

  // Calculate project stats
  const totalProjects = projectStats.reduce((acc, stat) => acc + stat._count, 0);
  const activeProjectsCount = projectStats.find((s) => s.status === 'ACTIVE')?._count ?? 0;
  const completedProjectsCount = projectStats.find((s) => s.status === 'COMPLETED')?._count ?? 0;

  return {
    ...summary,
    activeProjects: projectsData,
    recentMessages: messagesData,
    projectStats: {
      totalProjects,
      activeProjectsCount,
      completedProjectsCount,
    },
    weeklyProgress,
    upcomingDeadlines,
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
 */
export async function getHabitsToCompleteToday(userId: string): Promise<number> {
  const habits = await prisma.habit.findMany({
    where: { userId },
    include: {
      completions: {
        where: {
          date: {
            gte: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })(),
            lte: (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; })(),
          },
        },
      },
    },
  });
  return habits.filter((h) => h.completions.length === 0).length;
}