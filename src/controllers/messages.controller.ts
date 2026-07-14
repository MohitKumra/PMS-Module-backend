// backend/src/controllers/messages.controller.ts
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import * as messageService from '../services/message.service';
import type { CreateMessageRequest } from '../types';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/messages - List all messages for the authenticated user
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    const { type, status, limit } = req.query;

    const messages = await messageService.listMessages(userId, {
      type: type as string | undefined,
      status: status as string | undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    });

    res.json(messages);
  } catch (error) {
    next(error);
  }
});

// GET /api/messages/unread-count - Get count of unread messages
router.get('/unread-count', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    const count = await messageService.getUnreadCount(userId);
    res.json({ count });
  } catch (error) {
    next(error);
  }
});

// POST /api/messages/mark-all-read - Mark all messages as read
router.post('/mark-all-read', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    await messageService.markAllAsRead(userId);
    res.json({ message: 'All messages marked as read' });
  } catch (error) {
    next(error);
  }
});

// GET /api/messages/:id - Get a single message
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    const message = await messageService.getMessage(userId, req.params.id);
    res.json(message);
  } catch (error) {
    next(error);
  }
});

// POST /api/messages - Create a new message (manual notification)
router.post('/', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    const body: CreateMessageRequest = req.body;
    const message = await messageService.createMessage(userId, body);
    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/messages/:id - Update a message (mark as read)
router.patch('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    const message = await messageService.markAsRead(userId, req.params.id);
    res.json(message);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/messages/:id - Delete a message
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    await messageService.deleteMessage(userId, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
