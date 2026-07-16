// backend/src/services/activityFeed.service.ts
// Aggregates activities from multiple sources into a unified feed
// for the in-app notification center

import { prisma } from '../lib/prismaClient';
import type {
  InAppNotificationDTO,
  ActivityFeedResponse,
} from '../types';

/**
 * Get unified activity feed for a user combining:
 * - Task activities (created, completed, status changed)
 * - Habit completions
 * - Focus sessions
 * - Project updates
 * - Actionable items (overdue tasks, tasks due soon, habits pending)
 */
export async function getActivityFeed(
  userId: string,
  page: number = 1,
  pageSize: number = 20
): Promise<ActivityFeedResponse> {
  const offset = (page - 1) * pageSize;
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  // Fetch all data sources in parallel
  const [
    taskActivities,
    completedTasks,
    habitCompletions,
    focusSessions,
    projectUpdates,
    overdueTasks,
    tasksDueSoon,
    habitsToday,
  ] = await Promise.all([
    // Task activities from last 7 days
    prisma.taskActivity.findMany({
      where: {
        userId,
        createdAt: { gte: sevenDaysAgo },
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100, // Limit to prevent excessive data
    }),

    // Recently completed tasks
    prisma.task.findMany({
      where: {
        userId,
        status: 'DONE',
        completedAt: { gte: sevenDaysAgo },
      },
      select: {
        id: true,
        title: true,
        completedAt: true,
        priority: true,
      },
      orderBy: { completedAt: 'desc' },
      take: 50,
    }),

    // Habit completions from last 7 days
    prisma.habitCompletion.findMany({
      where: {
        habit: { userId },
        date: { gte: sevenDaysAgo },
      },
      include: {
        habit: {
          select: {
            id: true,
            title: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),

    // Focus sessions from last 7 days
    prisma.focusSession.findMany({
      where: {
        userId,
        completed: true,
        startedAt: { gte: sevenDaysAgo },
      },
      select: {
        id: true,
        durationMin: true,
        startedAt: true,
        isBreak: true,
      },
      orderBy: { startedAt: 'desc' },
      take: 50,
    }),

    // Project status changes (using updatedAt as proxy for activity)
    prisma.project.findMany({
      where: {
        userId,
        updatedAt: { gte: sevenDaysAgo },
      },
      select: {
        id: true,
        name: true,
        status: true,
        updatedAt: true,
        createdAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    }),

    // Actionable: Overdue tasks
    prisma.task.findMany({
      where: {
        userId,
        status: { in: ['TODO', 'IN_PROGRESS'] },
        dueDate: { lt: todayStart },
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        priority: true,
      },
      orderBy: { dueDate: 'asc' },
      take: 20,
    }),

    // Actionable: Tasks due in next 3 days
    prisma.task.findMany({
      where: {
        userId,
        status: { in: ['TODO', 'IN_PROGRESS'] },
        dueDate: {
          gte: todayStart,
          lte: threeDaysLater,
        },
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        priority: true,
      },
      orderBy: { dueDate: 'asc' },
      take: 20,
    }),

    // Actionable: Habits pending today
    prisma.habit.findMany({
      where: {
        userId,
        NOT: {
          completions: {
            some: {
              date: {
                gte: todayStart,
                lte: todayEnd,
              },
            },
          },
        },
      },
      select: {
        id: true,
        title: true,
      },
      take: 20,
    }),
  ]);

  // Transform to unified notification format
  const notifications: InAppNotificationDTO[] = [];

  // Task activities
  taskActivities.forEach((activity) => {
    let type: InAppNotificationDTO['type'] = 'TASK_CREATED';
    let title = activity.content;

    if (activity.type === 'CREATED') {
      type = 'TASK_CREATED';
      title = `Task created: ${activity.task.title}`;
    } else if (activity.type === 'STATUS_CHANGED') {
      type = 'TASK_STATUS_CHANGED';
      title = `Task ${activity.task.status.toLowerCase()}: ${activity.task.title}`;
    } else if (activity.task.status === 'DONE') {
      type = 'TASK_COMPLETED';
      title = `Task completed: ${activity.task.title}`;
    }

    notifications.push({
      id: activity.id,
      type,
      title,
      description: activity.content,
      timestamp: activity.createdAt.toISOString(),
      entityType: 'task',
      entityId: activity.taskId,
      metadata: {
        taskTitle: activity.task.title,
        priority: activity.task.priority,
      },
      isActionable: false,
    });
  });

  // Completed tasks (deduplicate with task activities by checking timestamps)
  completedTasks.forEach((task) => {
    if (!task.completedAt) return;
    
    // Check if we already have an activity for this completion
    const existingActivity = taskActivities.find(
      (a) => a.taskId === task.id && 
      Math.abs(a.createdAt.getTime() - task.completedAt!.getTime()) < 5000 // 5 second window
    );
    
    if (!existingActivity) {
      notifications.push({
        id: `task-completed-${task.id}`,
        type: 'TASK_COMPLETED',
        title: `Completed: ${task.title}`,
        timestamp: task.completedAt.toISOString(),
        entityType: 'task',
        entityId: task.id,
        metadata: { priority: task.priority },
        isActionable: false,
      });
    }
  });

  // Habit completions
  habitCompletions.forEach((completion) => {
    notifications.push({
      id: completion.id,
      type: 'HABIT_COMPLETED',
      title: `${completion.habit.title} completed`,
      description: `Logged on ${completion.date.toISOString().split('T')[0]}`,
      timestamp: completion.createdAt.toISOString(),
      entityType: 'habit',
      entityId: completion.habitId,
      metadata: {
        habitTitle: completion.habit.title,
        date: completion.date.toISOString().split('T')[0],
      },
      isActionable: false,
    });
  });

  // Focus sessions
  focusSessions.forEach((session) => {
    if (session.isBreak) return; // Skip break sessions
    
    notifications.push({
      id: session.id,
      type: 'FOCUS_SESSION_COMPLETED',
      title: `Completed ${session.durationMin} min focus session`,
      timestamp: session.startedAt.toISOString(),
      entityType: 'focus',
      entityId: session.id,
      metadata: { durationMin: session.durationMin },
      isActionable: false,
    });
  });

  // Project updates (only include significant changes)
  projectUpdates.forEach((project) => {
    // Skip if created recently (we'll show that instead)
    const isNewlyCreated = project.createdAt.getTime() === project.updatedAt.getTime() ||
      Math.abs(project.createdAt.getTime() - project.updatedAt.getTime()) < 1000;

    if (isNewlyCreated) {
      notifications.push({
        id: `project-created-${project.id}`,
        type: 'PROJECT_CREATED',
        title: `Project created: ${project.name}`,
        timestamp: project.createdAt.toISOString(),
        entityType: 'project',
        entityId: project.id,
        metadata: { status: project.status },
        isActionable: false,
      });
    } else if (project.status === 'COMPLETED') {
      notifications.push({
        id: `project-completed-${project.id}`,
        type: 'PROJECT_COMPLETED',
        title: `Project completed: ${project.name}`,
        timestamp: project.updatedAt.toISOString(),
        entityType: 'project',
        entityId: project.id,
        metadata: { status: project.status },
        isActionable: false,
      });
    } else {
      notifications.push({
        id: `project-updated-${project.id}`,
        type: 'PROJECT_STATUS_CHANGED',
        title: `Project updated: ${project.name}`,
        description: `Status: ${project.status}`,
        timestamp: project.updatedAt.toISOString(),
        entityType: 'project',
        entityId: project.id,
        metadata: { status: project.status },
        isActionable: false,
      });
    }
  });

  // Actionable: Overdue tasks
  overdueTasks.forEach((task) => {
    if (!task.dueDate) return;
    
    const daysOverdue = Math.floor(
      (now.getTime() - task.dueDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    
    notifications.push({
      id: `overdue-${task.id}`,
      type: 'TASK_OVERDUE',
      title: `Overdue: ${task.title}`,
      description: `${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue`,
      timestamp: task.dueDate.toISOString(),
      entityType: 'task',
      entityId: task.id,
      metadata: {
        priority: task.priority,
        daysOverdue,
      },
      isActionable: true,
    });
  });

  // Actionable: Tasks due soon
  tasksDueSoon.forEach((task) => {
    if (!task.dueDate) return;
    
    const daysUntilDue = Math.ceil(
      (task.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    
    notifications.push({
      id: `due-soon-${task.id}`,
      type: 'TASK_DUE_SOON',
      title: `Due soon: ${task.title}`,
      description: daysUntilDue === 0 
        ? 'Due today' 
        : `Due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}`,
      timestamp: task.dueDate.toISOString(),
      entityType: 'task',
      entityId: task.id,
      metadata: {
        priority: task.priority,
        daysUntilDue,
      },
      isActionable: true,
    });
  });

  // Actionable: Habits pending today
  habitsToday.forEach((habit) => {
    notifications.push({
      id: `habit-pending-${habit.id}`,
      type: 'HABIT_PENDING',
      title: `Log today: ${habit.title}`,
      description: 'Not completed today',
      timestamp: todayStart.toISOString(),
      entityType: 'habit',
      entityId: habit.id,
      metadata: { habitTitle: habit.title },
      isActionable: true,
    });
  });

  // Sort by timestamp (most recent first), but prioritize actionable items
  notifications.sort((a, b) => {
    // Actionable items first
    if (a.isActionable && !b.isActionable) return -1;
    if (!a.isActionable && b.isActionable) return 1;
    
    // Then by timestamp
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  // Apply pagination
  const total = notifications.length;
  const paginatedData = notifications.slice(offset, offset + pageSize);
  const hasMore = offset + pageSize < total;
  
  // Generate next cursor (timestamp of last item in current page)
  const nextCursor = paginatedData.length > 0 && hasMore
    ? paginatedData[paginatedData.length - 1].timestamp
    : undefined;

  return {
    data: paginatedData,
    meta: {
      total,
      page,
      pageSize,
      hasMore,
      nextCursor,
    },
  };
}
