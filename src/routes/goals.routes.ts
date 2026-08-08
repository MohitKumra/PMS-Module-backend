import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/goals.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate);

const goalStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']);
const goalPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const baseSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(5000).optional().nullable(),
  category: z.string().max(120).optional().nullable(),
  icon: z.string().max(64).optional().nullable(),
  color: z.string().max(32).optional().nullable(),
  targetDate: z
    .string()
    .optional()
    .nullable()
    .refine((val) => val == null || /^\d{4}-\d{2}-\d{2}$/.test(val), 'Invalid date format'),
  status: goalStatusSchema.optional(),
  priority: goalPrioritySchema.optional(),
  aiSummary: z.string().max(5000).optional().nullable(),
  linkedHabitIds: z.array(z.string()).optional(),
  linkedTaskIds: z.array(z.string()).optional(),
  linkedProjectIds: z.array(z.string()).optional(),
});

const milestoneSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(5000).optional().nullable(),
  dueDate: z
    .string()
    .optional()
    .nullable()
    .refine((val) => val == null || /^\d{4}-\d{2}-\d{2}$/.test(val), 'Invalid date format'),
  status: z.enum(['PENDING', 'COMPLETED', 'SKIPPED']).optional(),
  sortOrder: z.number().int().optional(),
});

const createSchema = baseSchema;
const updateSchema = baseSchema.partial().extend({
  title: z.string().trim().min(1).max(500).optional(),
});

const idParams = z.object({ id: z.string() });
const milestoneParams = z.object({ id: z.string(), milestoneId: z.string() });

// Optional body for DELETE /goals/:id — lets the client specify which linked
// records should be deleted alongside the goal.
const deleteGoalBody = z
  .object({
    deleteLinkedHabits: z.boolean().optional(),
    deleteLinkedTasks: z.boolean().optional(),
    deleteLinkedProjects: z.boolean().optional(),
  })
  .optional();

router.get('/', ctrl.list);
router.get('/:id', validate({ params: idParams }), ctrl.getOne);
router.get('/:id/milestones', validate({ params: idParams }), ctrl.listMilestones);
router.post('/', validate({ body: createSchema }), ctrl.create);
router.patch('/:id', validate({ params: idParams, body: updateSchema }), ctrl.update);
router.delete('/:id', validate({ params: idParams, body: deleteGoalBody }), ctrl.remove);
router.post('/:id/milestones', validate({ params: idParams, body: milestoneSchema }), ctrl.createMilestone);
router.patch(
  '/:id/milestones/:milestoneId',
  validate({ params: milestoneParams, body: milestoneSchema.partial() }),
  ctrl.updateMilestone
);
router.delete('/:id/milestones/:milestoneId', validate({ params: milestoneParams }), ctrl.deleteMilestone);

export default router;
