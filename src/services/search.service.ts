// backend/src/services/search.service.ts
// Global search service for searching tasks, habits, notes, and projects

import { prisma } from '../lib/prismaClient';

export interface SearchResult {
  type: 'task' | 'habit' | 'note' | 'project';
  id: string;
  title: string;
  description?: string | null;
  createdAt: string;
  updatedAt?: string;
  metadata?: any;
}

export async function search(userId: string, query: string): Promise<SearchResult[]> {
  const lowerQuery = query.toLowerCase();

  // Perform parallel searches across all models
  const [tasks, habits, notes, projects] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        OR: [
          { title: { contains: lowerQuery, mode: 'insensitive' } },
          { description: { contains: lowerQuery, mode: 'insensitive' } },
        ],
      },
      include: {
        projectTasks: true,
      },
      take: 10,
    }),
    prisma.habit.findMany({
      where: {
        userId,
        title: { contains: lowerQuery, mode: 'insensitive' },
      },
      take: 10,
    }),
    prisma.note.findMany({
      where: {
        userId,
        OR: [
          { title: { contains: lowerQuery, mode: 'insensitive' } },
          { content: { contains: lowerQuery, mode: 'insensitive' } },
        ],
      },
      take: 10,
    }),
    prisma.project.findMany({
      where: {
        userId,
        OR: [
          { name: { contains: lowerQuery, mode: 'insensitive' } },
          { description: { contains: lowerQuery, mode: 'insensitive' } },
        ],
      },
      take: 10,
    }),
  ]);

  // Transform all results to unified format
  const results: SearchResult[] = [
    ...tasks.map((task) => ({
      type: 'task' as const,
      id: task.id,
      title: task.title,
      description: task.description,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      metadata: {
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate?.toISOString(),
        projectId: task.projectTasks?.projectId ?? null,
      },
    })),
    ...habits.map((habit) => ({
      type: 'habit' as const,
      id: habit.id,
      title: habit.title,
      createdAt: habit.createdAt.toISOString(),
      metadata: {
        targetPerWeek: habit.targetPerWeek,
      },
    })),
    ...notes.map((note) => ({
      type: 'note' as const,
      id: note.id,
      title: note.title || 'Untitled Note',
      description: note.content,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
      metadata: {
        isJournal: note.isJournal,
        taskId: note.taskId,
        projectId: note.projectId,
      },
    })),
    ...projects.map((project) => ({
      type: 'project' as const,
      id: project.id,
      title: project.name,
      description: project.description,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      metadata: {
        status: project.status,
        progress: project.progress,
        dueDate: project.dueDate?.toISOString(),
      },
    })),
  ];

  // Sort all results by createdAt (newest first)
  return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}