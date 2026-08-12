// backend/src/controllers/projects.controller.ts
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import * as projectService from '../services/project.service';
import type { CreateProjectRequest, UpdateProjectRequest, AssignTaskToProjectRequest } from '../types';
import { deleteStoredFile } from '../lib/fileStorage';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/projects — List all projects for the authenticated user
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    const projects = await projectService.listProjects(userId, req.query as any);
    res.json(projects);
  } catch (error) {
    next(error);
  }
});

// GET /api/projects/:id — Get a single project
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    const project = await projectService.getProject(userId, req.params.id);
    res.json(project);
  } catch (error) {
    next(error);
  }
});

// POST /api/projects — Create a new project
router.post('/', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    const body: CreateProjectRequest = req.body;
    const project = await projectService.createProject(userId, body);
    res.status(201).json(project);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/projects/:id — Update a project
router.patch('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    const body: UpdateProjectRequest = req.body;
    const project = await projectService.updateProject(userId, req.params.id, body);
    res.json(project);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/projects/:id — Delete a project
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    await projectService.deleteProject(userId, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// GET /api/projects/:id/tasks — Get all tasks for a project
router.get('/:id/tasks', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    const tasks = await projectService.getProjectTasks(userId, req.params.id);
    res.json({ data: tasks, meta: { total: tasks.length } });
  } catch (error) {
    next(error);
  }
});

// POST /api/projects/:id/tasks — Assign a task to a project
router.post('/:id/tasks', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    const body: AssignTaskToProjectRequest = req.body;
    await projectService.assignTaskToProject(userId, req.params.id, body);
    res.status(201).json({ message: 'Task assigned to project' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/projects/:id/tasks/:taskId — Remove a task from a project
router.delete('/:id/tasks/:taskId', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    await projectService.removeTaskFromProject(userId, req.params.id, req.params.taskId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// POST /api/projects/:id/media — Add a media item to a project
router.post('/:id/media', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    const { url, type, fileName, mimeType, size } = req.body;
    await projectService.addProjectMedia(userId, req.params.id, url, type, fileName, mimeType, size);
    res.status(201).json({ message: 'Media added' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/projects/:id/media/:mediaId — Remove a media item
router.delete('/:id/media/:mediaId', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    await projectService.removeProjectMedia(userId, req.params.id, req.params.mediaId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
