// backend/src/services/project.service.ts
// Personal project management service for individual productivity tracking

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { deleteStoredFile } from '../lib/fileStorage';
import { recomputeGoalProgress } from './goal.service';
import { awardProjectCompletion, revokeProjectCompletion, deleteProjectPoints } from './gamification.service';
import type {
  ProjectDTO,
  CreateProjectRequest,
  UpdateProjectRequest,
  AssignTaskToProjectRequest,
  ListResponse,
} from '../types';

function normalizeMediaUrl(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Convert Prisma Project to ProjectDTO */
function toDTO(project: any): ProjectDTO {
  const mediaItems = project.media ?? [];
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    color: project.color ?? '#4F46E5',
    userId: project.userId,
    goalId: project.goalId ?? null,
    startDate: project.startDate?.toISOString() ?? null,
    dueDate: project.dueDate?.toISOString() ?? null,
    attachmentUrl: project.attachmentUrl ?? null,
    voiceNoteUrl: project.voiceNoteUrl ?? null,
    attachments: mediaItems
      .filter((m: any) => m.type === 'attachment')
      .map((m: any) => ({
        id: m.id,
        url: m.url,
        type: m.type as 'attachment',
        fileName: m.fileName,
        mimeType: m.mimeType,
        size: m.size,
        createdAt: m.createdAt.toISOString(),
      })),
    voiceNotes: mediaItems
      .filter((m: any) => m.type === 'voice_note')
      .map((m: any) => ({
        id: m.id,
        url: m.url,
        type: m.type as 'voice_note',
        fileName: m.fileName,
        mimeType: m.mimeType,
        size: m.size,
        createdAt: m.createdAt.toISOString(),
      })),
    progress: project.progress ?? 0,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    taskCount: project._count?.tasks,
    completedTaskCount: project.completedTaskCount,
  };
}

export interface ProjectListFilters {
  status?: string; // 'ALL' | ProjectStatus
  search?: string;
  sort?: string; // 'default' | 'name' | 'progress' | 'dueDate'
}

/** Get all projects for a user */
export async function listProjects(
  userId: string,
  filters: ProjectListFilters = {}
): Promise<ListResponse<ProjectDTO>> {
  const projects = await prisma.project.findMany({
    where: { userId },
    include: {
      _count: { select: { tasks: true } },
      tasks: {
        include: { task: true },
      },
      media: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  const projectsWithCounts = projects.map((p: any) => {
    const completedTaskCount = p.tasks.filter((pt: any) => pt.task.status === 'DONE').length;
    return { ...p, completedTaskCount };
  });

  // Filter / search / sort on the server, mirroring the previous frontend logic.
  let data = projectsWithCounts.map(toDTO);

  const status = filters.status ?? 'ALL';
  if (status !== 'ALL') data = data.filter((p) => p.status === status);

  const term = (filters.search ?? '').trim().toLowerCase();
  if (term) data = data.filter((p) => p.name.toLowerCase().includes(term) || (p.description ?? '').toLowerCase().includes(term));

  switch (filters.sort) {
    case 'name':
      data = [...data].sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'progress':
      data = [...data].sort((a, b) => b.progress - a.progress);
      break;
    case 'dueDate':
      data = [...data].sort(
        (a, b) =>
          (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) -
          (b.dueDate ? new Date(b.dueDate).getTime() : Infinity)
      );
      break;
    // 'default' / undefined → keep updatedAt desc (the default order)
  }

  return {
    data,
    meta: { total: data.length },
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
      media: true,
    },
  });

  if (!project) throw createError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  const completedTaskCount = (project as any).tasks.filter((pt: any) => pt.task.status === 'DONE').length;

  return toDTO({ ...project, completedTaskCount });
}

/** Create a new project */
export async function createProject(userId: string, req: CreateProjectRequest): Promise<ProjectDTO> {
  if (req.goalId) {
    const goal = await prisma.goal.findFirst({ where: { id: req.goalId, userId }, select: { id: true } });
    if (!goal) throw createError(404, 'GOAL_NOT_FOUND', 'Goal not found');
  }

  const project = await prisma.project.create({
    data: {
      userId,
      name: req.name,
      description: req.description ?? null,
      status: req.status ?? 'PLANNING',
      color: req.color ?? '#4F46E5',
      startDate: req.startDate ? new Date(req.startDate) : null,
      dueDate: req.dueDate ? new Date(req.dueDate) : null,
      attachmentUrl: normalizeMediaUrl(req.attachmentUrl),
      voiceNoteUrl: normalizeMediaUrl(req.voiceNoteUrl),
      goalId: req.goalId ?? null,
    },
    include: {
      _count: { select: { tasks: true } },
    },
  });

  return toDTO({ ...project, completedTaskCount: 0 });
}

/** Update a project */
export async function updateProject(userId: string, projectId: string, req: UpdateProjectRequest): Promise<ProjectDTO> {
  const existing = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });

  if (!existing) throw createError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  const previousAttachmentUrl = existing.attachmentUrl;
  const previousVoiceNoteUrl = existing.voiceNoteUrl;

  if (req.goalId !== undefined && req.goalId !== null) {
    const goal = await prisma.goal.findFirst({ where: { id: req.goalId, userId }, select: { id: true } });
    if (!goal) throw createError(404, 'GOAL_NOT_FOUND', 'Goal not found');
  }

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(req.name !== undefined && { name: req.name }),
      ...(req.description !== undefined && { description: req.description }),
      ...(req.status !== undefined && { status: req.status }),
      ...(req.color !== undefined && { color: req.color }),
      ...(req.startDate !== undefined && { startDate: req.startDate ? new Date(req.startDate) : null }),
      ...(req.dueDate !== undefined && { dueDate: req.dueDate ? new Date(req.dueDate) : null }),
      ...(req.attachmentUrl !== undefined && { attachmentUrl: normalizeMediaUrl(req.attachmentUrl) }),
      ...(req.voiceNoteUrl !== undefined && { voiceNoteUrl: normalizeMediaUrl(req.voiceNoteUrl) }),
      ...(req.goalId !== undefined && { goalId: req.goalId ?? null }),
      ...(req.progress !== undefined && { progress: req.progress }),
    },
    include: {
      _count: { select: { tasks: true } },
      tasks: {
        include: { task: true },
      },
    },
  });

  if (req.attachmentUrl !== undefined && req.attachmentUrl !== previousAttachmentUrl) {
    await deleteStoredFile(previousAttachmentUrl);
  }
  if (req.voiceNoteUrl !== undefined && req.voiceNoteUrl !== previousVoiceNoteUrl) {
    await deleteStoredFile(previousVoiceNoteUrl);
  }

  const completedTaskCount = updated.tasks.filter((pt) => pt.task.status === 'DONE').length;
  if (existing.status !== 'COMPLETED' && updated.status === 'COMPLETED') {
    await awardProjectCompletion(userId, updated.id, updated.name);
  } else if (existing.status === 'COMPLETED' && updated.status !== 'COMPLETED') {
    await revokeProjectCompletion(userId, updated.id, updated.name);
  }

  return toDTO({ ...updated, completedTaskCount });
}

/** Delete a project */
export async function deleteProject(userId: string, projectId: string): Promise<void> {
  const existing = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });

  if (!existing) throw createError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  // If project was completed, deduct the XP before deleting
  if (existing.status === 'COMPLETED') {
    await deleteProjectPoints(userId, existing.id, existing.name);
  }

  // Clean up stored files for all associated media records
  const mediaItems = await prisma.projectMedia.findMany({ where: { projectId } });
  for (const media of mediaItems) {
    await deleteStoredFile(media.url);
  }

  await prisma.project.delete({ where: { id: projectId } });
  await deleteStoredFile(existing.attachmentUrl);
  await deleteStoredFile(existing.voiceNoteUrl);
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
  if (!project) throw createError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  // Verify task belongs to user
  const task = await prisma.task.findFirst({
    where: { id: req.taskId, userId },
  });
  if (!task) throw createError(404, 'TASK_NOT_FOUND', 'Task not found');

  // Check if task is already assigned to this project
  const existing = await prisma.projectTask.findUnique({
    where: { taskId: req.taskId },
  });

  if (existing) throw createError(400, 'TASK_ALREADY_ASSIGNED', 'Task already assigned to this project');

  await prisma.projectTask.create({
    data: {
      projectId,
      taskId: req.taskId,
      order: req.order ?? 0,
    },
  });

  await updateProjectProgress(projectId);
}

/** Remove a task from a project */
export async function removeTaskFromProject(userId: string, projectId: string, taskId: string): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });
  if (!project) throw createError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  await prisma.projectTask.deleteMany({
    where: { projectId, taskId },
  });

  await updateProjectProgress(projectId);
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

  if (!project) throw createError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  return project.tasks.map((pt) => ({
    ...pt.task,
    order: pt.order,
    projectTaskId: pt.id,
  }));
}

/** Add a media item to a project */
export async function addProjectMedia(
  userId: string,
  projectId: string,
  url: string,
  type: 'attachment' | 'voice_note',
  fileName?: string,
  mimeType?: string,
  size?: number
): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });
  if (!project) throw createError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  await prisma.projectMedia.create({
    data: {
      projectId,
      url,
      type,
      fileName: fileName ?? null,
      mimeType: mimeType ?? null,
      size: size ?? null,
    },
  });
}

/** Remove a media item from a project */
export async function removeProjectMedia(userId: string, projectId: string, mediaId: string): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });
  if (!project) throw createError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  // Handle legacy sentinel IDs for attachmentUrl / voiceNoteUrl
  if (mediaId === 'legacy-attachment') {
    await deleteStoredFile(project.attachmentUrl);
    await prisma.project.update({
      where: { id: projectId },
      data: { attachmentUrl: null },
    });
    return;
  }
  if (mediaId === 'legacy-voice') {
    await deleteStoredFile(project.voiceNoteUrl);
    await prisma.project.update({
      where: { id: projectId },
      data: { voiceNoteUrl: null },
    });
    return;
  }

  const media = await prisma.projectMedia.findFirst({
    where: { id: mediaId, projectId },
  });
  if (!media) throw createError(404, 'MEDIA_NOT_FOUND', 'Media item not found');

  await prisma.projectMedia.delete({ where: { id: mediaId } });
  await deleteStoredFile(media.url);
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

  if (project.goalId) {
    await recomputeGoalProgress(project.goalId).catch(() => undefined);
  }
}
