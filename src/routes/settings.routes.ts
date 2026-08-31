import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/settings.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { requireFeature } from '../middleware/requireFeature';

const router = Router();
router.use(authenticate);

const appearanceSchema = z.object({
  themePreference: z.enum(['LIGHT', 'DARK', 'SYSTEM']).optional(),
  layoutPreference: z.enum(['COMFORTABLE', 'COMPACT', 'EXPANDED']).optional(),
  calendarView: z.enum(['day', 'week', 'month', 'agenda']).optional(),
  taskView: z.enum(['board', 'list']).optional(),
  notesView: z.enum(['grid', 'list', '3d']).optional(),
  pageTransitionsEnabled: z.boolean().optional(),
  floatingAnimationsEnabled: z.boolean().optional(),
});

const notificationsSchema = z.object({
  taskDue: z.boolean(),
  habitReminder: z.boolean(),
  projectDeadline: z.boolean(),
  focusSessionComplete: z.boolean(),
  calendarSync: z.boolean(),
});

const aiSchema = z.object({
  dailyBriefEnabled: z.boolean(),
  journalWeeklyEnabled: z.boolean(),
  insightsEnabled: z.boolean(),
  coachEnabled: z.boolean(),
  journalAnalysisEnabled: z.boolean(),
  goalSummaryEnabled: z.boolean(),
  taskParserEnabled: z.boolean(),
  goalPlannerEnabled: z.boolean(),
  summaryRefreshMinutes: z.number().int().min(5).max(1440),
});

const recoverySchema = z.object({
  recoveryEmail: z.string().email().nullable().optional(),
});

router.get('/', ctrl.getSettings);
router.patch('/appearance', validate({ body: appearanceSchema }), ctrl.updateAppearance);
router.patch('/notifications', validate({ body: notificationsSchema }), ctrl.updateNotifications);
router.patch('/ai', validate({ body: aiSchema }), ctrl.updateAI);
router.patch('/security/recovery-email', validate({ body: recoverySchema }), ctrl.updateRecoveryEmail);
router.get('/google-calendar/start', requireFeature('calendarSync'), ctrl.googleCalendarStart);
router.post('/google-calendar/sync', requireFeature('calendarSync'), ctrl.syncGoogleCalendar);
router.post('/google-calendar/disconnect', requireFeature('calendarSync'), ctrl.disconnectGoogleCalendar);

export default router;
