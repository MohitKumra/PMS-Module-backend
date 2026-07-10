// backend/src/services/project.service.ts
// Personal project management service for individual productivity tracking

import { prisma } from '../lib/prismaClient';
import type {
  ProjectDTO,
  CreateProjectRequest,
  UpdateProjectRequest,
  AssignTaskToProjectRequest,
  ListResponse,
} from '../types';

/** Convert Prisma Project to ProjectDTO */
function toDTO(project: any): ProjectDTO {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    color: project.color ?? '#4F46E5',
    userId: project.userId,
    startDate: project.startDate?.toISOString() ?? null,
    dueDate: project.dueDate?.toISOString() ?? null,
    progress: project.progress ?? 0,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    taskCount: project._count?.tasks,
    completedTaskCount: project.completedTaskCount,
  };
}

/** Get all projects for a user */
export async function listProjects(userId: string): Promise<ListResponse<ProjectDTO>> {
  const projects = await prisma.project.findMany({
    where: { userId },
    include: {
      _count: { select: { tasks: true } },
      tasks: {
        include: { task: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const projectsWithCounts = projects.map((p) => {
    const completedTaskCount = p.tasks.filter((pt) => pt.task.status === 'DONE').length;
    return { ...p, completedTaskCount };
  });

  return {
    data: projectsWithCounts.map(toDTO),
    meta: { total: projects.length },
  };
}

/** Get a single project by ID */
export async function getProject(userId: string, projectId: string): Promise<ProjectDTO> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    include: {
      _count: { select: { tasks: true } },
      tasks: {
        include: { task: true },
      },
    },
  });

  if (!project) throw new Error('Project not found');

  const completedTaskCount = project.tasks.filter((pt) => pt.task.status === 'DONE').length;

  return toDTO({ ...project, completedTaskCount });
}

/** Create a new project */
export async function createProject(
  userId: string,
  req: CreateProjectRequest
): Promise<ProjectDTO> {
  const project = await prisma.project.create({
    data: {
      userId,
      name: req.name,
      description: req.description ?? null,
      status: req.status ?? 'PLANNING',
      color: req.color ?? '#4F46E5',
      startDate: req.startDate ? new Date(req.startDate) : null,
      dueDate: req.dueDate ? new Date(req.dueDate) : null,
    },
    include: {
      _count: { select: { tasks: true } },
    },
  });

  return toDTO({ ...project, completedTaskCount: 0 });
}

/** Update a project */
export async function updateProject(
  userId: string,
  projectId: string,
  req: UpdateProjectRequest
): Promise<ProjectDTO> {
  const existing = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });

  if (!existing) throw new Error('Project not found');

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(req.name !== undefined && { name: req.name }),
      ...(req.description !== undefined && { description: req.description }),
      ...(req.status !== undefined && { status: req.status }),
      ...(req.color !== undefined && { color: req.color }),
      ...(req.startDate !== undefined && { startDate: req.startDate ? new Date(req.startDate) : null }),
      ...(req.dueDate !== undefined && { dueDate: req.dueDate ? new Date(req.dueDate) : null }),
      ...(req.progress !== undefined && { progress: req.progress }),
    },
    include: {
      _count: { select: { tasks: true } },
      tasks: {
        include: { task: true },
      },
    },
  });

  const completedTaskCount = updated.tasks.filter((pt) => pt.task.status === 'DONE').length;

  return toDTO({ ...updated, completedTaskCount });
}

/** Delete a project */
export async function deleteProject(userId: string, projectId: string): Promise<void> {
  const existing = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });

  if (!existing) throw new Error('Project not found');

  await prisma.project.delete({ where: { id: projectId } });
}

/** Assign a task to a project */
export async function assignTaskToProject(
  userId: string,
  projectId: string,
  req: AssignTaskToProjectRequest
): Promise<void> {
  // Verify project belongs to user
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });
  if (!project) throw new Error('Project not found');

  // Verify task belongs to user
  const task = await prisma.task.findFirst({
    where: { id: req.taskId, userId },
  });
  if (!task) throw new Error('Task not found');

   // Check if task is already assigned to this project
   const existing = await prisma.projectTask.findUnique({
     where: { taskId: req.taskId },
   });

  if (existing) throw new Error('Task already assigned to this project');

  await prisma.projectTask.create({
    data: {
      projectId,
      taskId: req.taskId,
      order: req.order ?? 0,
    },
  });
}

/** Remove a task from a project */
export async function removeTaskFromProject(
  userId: string,
  projectId: string,
  taskId: string
): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });
  if (!project) throw new Error('Project not found');

  await prisma.projectTask.deleteMany({
    where: { projectId, taskId },
  });
}

/** Get all tasks for a project */
export async function getProjectTasks(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    include: {
      tasks: {
        include: { task: true },
        orderBy: { order: 'asc' },
      },
    },
  });

  if (!project) throw new Error('Project not found');

  return project.tasks.map((pt) => ({
    ...pt.task,
    order: pt.order,
    projectTaskId: pt.id,
  }));
}

/** Auto-calculate and update project progress based on task completion */
export async function updateProjectProgress(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      tasks: {
        include: { task: true },
      },
    },
  });

  if (!project || project.tasks.length === 0) return;

  const completedTasks = project.tasks.filter((pt) => pt.task.status === 'DONE').length;
  const progress = Math.round((completedTasks / project.tasks.length) * 100);

  await prisma.project.update({
    where: { id: projectId },
    data: { progress },
  });
}
