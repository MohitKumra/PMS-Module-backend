// backend/src/routes/ai.routes.ts
// Routes for AI-powered features.

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import * as aiController from '../controllers/ai.controller';

const router = Router();

// All AI routes require authentication
router.use(authenticate);

const coachMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(400),
});

const coachChatSchema = z.object({
  messages: z.array(coachMessageSchema).min(1).max(8),
});

const coachCreateSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
});

const coachChatMessageSchema = z.object({
  message: z.string().trim().max(1500).optional().default(''),
  imageUrls: z
    .array(z.string().url().max(2048))
    .max(8)
    .optional()
    .default([]),
}).refine(
  (data) => data.message.length > 0 || (data.imageUrls ?? []).length > 0,
  { message: 'Either message or at least one image is required' },
);

const coachChatParamsSchema = z.object({
  chatId: z.string().min(1),
});

// GET /api/ai/status - Check if AI is configured and available
router.get('/status', aiController.getStatus);

// GET /api/ai/insights - Generate AI-powered productivity insights
router.get('/insights', aiController.getInsights);

// GET /api/ai/coach - Get AI coach message
router.get('/coach', aiController.getCoach);

// POST /api/ai/coach/chat - Continue an AI coach conversation
router.post('/coach/chat', validate({ body: coachChatSchema }), aiController.postCoachChat);

// GET /api/ai/coach/chats - List saved coach chats
router.get('/coach/chats', aiController.getCoachChats);

// POST /api/ai/coach/chats - Create a new saved coach chat
router.post('/coach/chats', validate({ body: coachCreateSchema }), aiController.createCoachChatThread);

// GET /api/ai/coach/chats/:chatId - Open a saved coach chat
router.get('/coach/chats/:chatId', validate({ params: coachChatParamsSchema }), aiController.getCoachChatThread);

// DELETE /api/ai/coach/chats/:chatId - Delete a saved coach chat
router.delete('/coach/chats/:chatId', validate({ params: coachChatParamsSchema }), aiController.deleteCoachChatThread);

// POST /api/ai/coach/chats/:chatId/messages - Send a message in a saved coach chat
router.post(
  '/coach/chats/:chatId/messages',
  validate({ params: coachChatParamsSchema, body: coachChatMessageSchema }),
  aiController.postCoachChatMessage
);

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
