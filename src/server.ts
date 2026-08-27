// backend/src/server.ts
// Express app bootstrap — mounts all routes, middleware, and starts the server.
// Import env first to fail fast on missing vars.

import dotenv from 'dotenv';
dotenv.config(); // Load .env file before validation
import './config/env'; // validates env vars at startup
import { env } from './config/env';

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';

import aiRoutes from './routes/ai.routes';
import authRoutes from './routes/auth.routes';
import tasksRoutes from './routes/tasks.routes';
import habitsRoutes from './routes/habits.routes';
import notesRoutes from './routes/notes.routes';
import calendarRoutes from './routes/calendar.routes';
import focusRoutes from './routes/focus.routes';
import analyticsRoutes from './routes/analytics.routes';
import goalsRoutes from './routes/goals.routes';
import notificationsRoutes from './routes/notifications.routes';
import settingsRoutes from './routes/settings.routes';
import gamificationRoutes from './routes/gamification.routes';
import dashboardRoutes from './routes/dashboard.routes';
import searchRoutes from './routes/search.routes';
import usersRoutes from './routes/users.routes';
import uploadsRoutes from './routes/uploads.routes';
import mediaFileRoutes from './routes/media-file.routes';
import storageRoutes from './routes/storage.routes';
import schedulerRoutes from './routes/scheduler.routes';
import notionRoutes from './routes/notion.routes';
import adminRoutes from './routes/admin.routes';
import billingRoutes from './routes/billing.routes';
import webhookRoutes from './routes/webhook.routes';
import projectsController from './controllers/projects.controller';
import { errorHandler } from './middleware/errorHandler';
import { startScheduler } from './jobs/reminderScheduler';
import { startSubscriptionRenewal } from './jobs/subscriptionRenewal';
import systemRoutes from './routes/system.routes';
import { maintenanceMode } from './middleware/maintenanceMode';
import { loadSystemSettings } from './services/systemSettings.service';
import { bootstrapAdmin } from './services/adminAuth.service';
import { prisma } from './lib/prismaClient';

const app = express();

// ─── Readiness check ─────────────────────────────────────────────────────────
// Verifies critical dependencies (database connectivity) required to serve traffic.
// Never exposes credentials or internal connection details.
app.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not_ready', reason: 'database_unavailable' });
  }
});

// ─── Core middleware ──────────────────────────────────────────────────────────
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ['POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], // allow cookies (refresh token)
  })
);

// Middleware to set correct Content-Type and media headers for audio/image files served from /uploads
app.use('/uploads', (req, res, next) => {
  const filePath = req.path.toLowerCase();

  // Allow cross-origin access for all uploaded assets (needed for AI vision API fetching images)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=31536000');

  // Override Content-Type for audio formats that browsers are picky about
  let contentType: string | undefined;
  if (filePath.endsWith('.webm')) {
    contentType = 'audio/webm';
  } else if (filePath.endsWith('.mp4') || filePath.endsWith('.m4a')) {
    contentType = 'audio/mp4';
  } else if (filePath.endsWith('.ogg')) {
    contentType = 'audio/ogg';
  } else if (filePath.endsWith('.mp3')) {
    contentType = 'audio/mpeg';
  } else if (filePath.endsWith('.wav')) {
    contentType = 'audio/wav';
  } else if (filePath.endsWith('.avif')) {
    contentType = 'image/avif';
  } else if (filePath.endsWith('.heic') || filePath.endsWith('.heif')) {
    contentType = 'image/heic';
  }

  if (contentType) {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
  }

  next();
});
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));
app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api/system', systemRoutes);
// ─── Maintenance gate: blocks all non-admin traffic when maintenance is ON ───
app.use(maintenanceMode);

app.use('/api/ai', aiRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/habits', habitsRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/focus', focusRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/goals', goalsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/gamification', gamificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/media', mediaFileRoutes);
app.use('/api/media', uploadsRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/notion', notionRoutes);
app.use('/api/projects', projectsController);
app.use('/api/billing', billingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhooks', webhookRoutes);

// ─── 404 catch ────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));

// ─── Global error handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

// ─── Start server ─────────────────────────────────────────────────────────────
const port = parseInt(env.PORT, 10);
loadSystemSettings()
  .then(() => console.info('💾  System settings loaded from database.'))
  .catch((err) => console.error('Failed to load system settings from database:', err));
startScheduler();
startSubscriptionRenewal();
bootstrapAdmin().catch((err) => console.error('Failed to bootstrap initial admin:', err));
app.listen(port, () => {
  console.log(`🚀  Backend running at http://localhost:${port}`);
  console.log(`📊  Health: http://localhost:${port}/health`);
});

export default app;

