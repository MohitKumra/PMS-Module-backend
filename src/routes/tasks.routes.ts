// backend/src/routes/tasks.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/tasks.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate);

const createSubTaskSchema = z.object({
  title: z.string().trim().min(1).max(500),
  order: z.number().int().optional(),
});

const taskSubTaskSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1).max(500),
  order: z.number().int().optional(),
  completed: z.boolean().optional(),
});

const updateSubTaskSchema = createSubTaskSchema.partial().extend({
  completed: z.boolean().optional(),
});

const createTimeEntrySchema = z.object({
  minutes: z.number().int().positive(),
  note: z.string().max(2000).optional(),
  startedAt: z.string().datetime().optional(),
});

const createSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  dueDate: z.string().optional().refine(val => !val || /^\d{4}-\d{2}-\d{2}$/.test(val), 'Invalid date format'),
  recurrenceRule: z.string().max(200).optional(),
  recurrenceEndDate: z.string().optional().refine(val => !val || /^\d{4}-\d{2}-\d{2}$/.test(val), 'Invalid date format'),
  skipDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format')).optional(),
  parentTaskId: z.string().optional(),
  estimatedDuration: z.number().int().positive().nullable().optional(),
  attachmentUrl: z.string().min(1).max(2048).nullable().optional(),
  voiceNoteUrl: z.string().min(1).max(2048).nullable().optional(),
  subTasks: z.array(createSubTaskSchema).optional(),
});

const updateSchema = createSchema.partial().extend({
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  dueDate: z.string().nullable().optional().refine(val => val === null || !val || /^\d{4}-\d{2}-\d{2}$/.test(val), 'Invalid date format'),
  recurrenceRule: z.string().max(200).nullable().optional(),
  recurrenceEndDate: z.string().nullable().optional().refine(val => val === null || !val || /^\d{4}-\d{2}-\d{2}$/.test(val), 'Invalid date format'),
  skipDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format')).optional(),
  attachmentUrl: z.string().min(1).max(2048).nullable().optional(),
  voiceNoteUrl: z.string().min(1).max(2048).nullable().optional(),
  estimatedDuration: z.number().int().positive().nullable().optional(),
  subTasks: z.array(taskSubTaskSchema).optional(),
});

const idParams = z.object({ id: z.string() });
const taskIdParams = z.object({ taskId: z.string() });
const subTaskIdParams = z.object({ taskId: z.string(), subTaskId: z.string() });

// Task routes
router.get('/',    ctrl.list);
router.get('/:id', validate({ params: idParams }), ctrl.getOne);
router.post('/',   validate({ body: createSchema }), ctrl.create);
router.patch('/:id', validate({ params: idParams, body: updateSchema }), ctrl.update);
router.delete('/:id', validate({ params: idParams }), ctrl.remove);

// Subtask routes
router.get('/:taskId/subtasks', validate({ params: taskIdParams }), ctrl.listSubTasks);
router.post('/:taskId/subtasks', validate({ params: taskIdParams, body: createSubTaskSchema }), ctrl.createSubTask);
router.patch('/:taskId/subtasks/:subTaskId', validate({ params: subTaskIdParams, body: updateSubTaskSchema }), ctrl.updateSubTask);
router.delete('/:taskId/subtasks/:subTaskId', validate({ params: subTaskIdParams }), ctrl.deleteSubTask);

// Time entry routes
router.post('/:taskId/time-entries', validate({ params: taskIdParams, body: createTimeEntrySchema }), ctrl.createTimeEntry);

export default router;
