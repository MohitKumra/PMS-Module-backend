// backend/src/routes/ai.routes.ts
// Routes for AI-powered features.

import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import * as aiController from '../controllers/ai.controller';

const router = Router();

// All AI routes require authentication
router.use(authenticate);

// GET /api/ai/status - Check if AI is configured and available
router.get('/status', aiController.getStatus);

// GET /api/ai/insights - Generate AI-powered productivity insights
router.get('/insights', aiController.getInsights);

// GET /api/ai/coach - Get AI coach message
router.get('/coach', aiController.getCoach);

// GET /api/ai/daily-brief - Get AI daily briefing
router.get('/daily-brief', aiController.getDailyBrief);

// POST /api/ai/analyze-journal - Analyze a journal entry
router.post('/analyze-journal', aiController.postAnalyzeJournal);

// GET /api/ai/journal-weekly - Get weekly journal analysis
router.get('/journal-weekly', aiController.getJournalWeekly);

// POST /api/ai/parse-task - Parse natural language into task data
router.post('/parse-task', aiController.postParseTask);

// POST /api/ai/goal-plan - Generate a full workspace plan from a single prompt
router.post('/goal-plan', aiController.postGoalPlan);

// POST /api/ai/goal-workspace - Create goal, milestones, tasks, habits, and projects from a plan
router.post('/goal-workspace', aiController.postGoalWorkspace);

export default router;
