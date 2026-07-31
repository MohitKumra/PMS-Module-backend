// backend/src/routes/notion.routes.ts
// Notion integration routes — OAuth, database listing, and import endpoints.

import { Router } from 'express';
import * as ctrl from '../controllers/notion.controller';
import { authenticate } from '../middleware/authenticate';

const router = Router();

// OAuth callback (no auth required — Notion redirects here)
router.get('/oauth/callback', ctrl.handleOAuthCallback);

// All following routes require authentication
router.use(authenticate);

// OAuth start (requires auth — we need the user's ID)
router.get('/start', ctrl.startOAuth);

// Connection status
router.get('/status', ctrl.getStatus);

// Disconnect
router.post('/disconnect', ctrl.disconnect);

// List accessible databases
router.get('/databases', ctrl.listDatabases);

// Get database properties (for property mapping)
router.get('/databases/:databaseId/properties', ctrl.getDatabaseProperties);

// Preview pages with auto-mapped properties for tasks
router.get('/databases/:databaseId/auto-preview', ctrl.previewWithAutoMapping);

// Preview pages with auto-mapped properties for notes/journal
router.get('/databases/:databaseId/auto-preview-notes', ctrl.previewWithAutoMappingNotes);

// Preview pages from a database (with explicit property mapping)
router.post('/databases/:databaseId/pages', ctrl.listPages);

// Get already-imported page IDs
router.get('/imported-pages', ctrl.getImportedPageIds);

// Import tasks from a Notion database
router.post('/import/tasks', ctrl.importTasks);

// Import notes from a Notion database
router.post('/import/notes', ctrl.importNotes);

export default router;