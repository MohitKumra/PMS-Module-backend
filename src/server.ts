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

import authRoutes         from './routes/auth.routes';
import tasksRoutes        from './routes/tasks.routes';
import habitsRoutes       from './routes/habits.routes';
import notesRoutes        from './routes/notes.routes';
import calendarRoutes     from './routes/calendar.routes';
import focusRoutes        from './routes/focus.routes';
import analyticsRoutes    from './routes/analytics.routes';
import notificationsRoutes from './routes/notifications.routes';
import settingsRoutes      from './routes/settings.routes';
import dashboardRoutes    from './routes/dashboard.routes';
import searchRoutes       from './routes/search.routes';
import projectsController  from './controllers/projects.controller';
import { errorHandler }   from './middleware/errorHandler';
import { startScheduler } from './jobs/reminderScheduler';

const app = express();

// ─── Core middleware ──────────────────────────────────────────────────────────
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,          // allow cookies (refresh token)
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/tasks',         tasksRoutes);
app.use('/api/habits',        habitsRoutes);
app.use('/api/notes',         notesRoutes);
app.use('/api/calendar',      calendarRoutes);
app.use('/api/focus',         focusRoutes);
app.use('/api/analytics',     analyticsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/settings',      settingsRoutes);
app.use('/api/dashboard',     dashboardRoutes);
app.use('/api/search',        searchRoutes);
app.use('/api/projects',      projectsController);

// ─── 404 catch ────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));

// ─── Global error handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

// ─── Start server ─────────────────────────────────────────────────────────────
const port = parseInt(env.PORT, 10);
startScheduler();
app.listen(port, () => {
  console.log(`🚀  Backend running at http://localhost:${port}`);
  console.log(`📊  Health: http://localhost:${port}/health`);
});

export default app;
