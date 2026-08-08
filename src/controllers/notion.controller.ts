// backend/src/controllers/notion.controller.ts
// Notion integration controller — handles OAuth, database listing, and imports.
// Supports both legacy Database API and new Data Source API.

import type { Request, Response, NextFunction } from 'express';
import * as notionService from '../services/notion.service';
import { createError } from '../middleware/errorHandler';

export async function startOAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const returnTo = (req.query.returnTo as string) || '/settings?tab=integrations';
    const userId = req.user!.sub;
    const url = notionService.buildNotionAuthUrl(returnTo, userId);
    res.json({ url });
  } catch (err) {
    next(err);
  }
}

export async function handleOAuthCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code, state, error: oauthError } = req.query as Record<string, string | undefined>;
    if (oauthError) {
      throw createError(400, 'NOTION_OAUTH_ERROR', `Notion OAuth error: ${oauthError}`);
    }
    if (!code) {
      throw createError(400, 'MISSING_NOTION_CODE', 'Notion authorization code missing');
    }
    if (!state) {
      throw createError(400, 'MISSING_NOTION_STATE', 'Notion state parameter missing');
    }

    const decodedState = notionService.verifyOAuthState(state);
    const userId = decodedState.userId;
    await notionService.handleOAuthCallback(code, state, userId);

    const returnTo = '/settings?tab=integrations';
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}${returnTo}`);
  } catch (err) {
    next(err);
  }
}

export async function getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.sub;
    const integration = await notionService.getNotionIntegration(userId);
    res.json(integration);
  } catch (err) {
    next(err);
  }
}

export async function disconnect(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.sub;
    await notionService.disconnectNotion(userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function listDatabases(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.sub;
    const databases = await notionService.listDatabases(userId);
    res.json({ data: databases });
  } catch (err) {
    next(err);
  }
}

export async function getDatabaseProperties(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.sub;
    const collectionId = req.params.databaseId as string;
    const object = (req.query.object as 'database' | 'data_source') || 'database';
    const properties = await notionService.getDatabaseProperties(userId, collectionId, object);
    res.json({ data: properties });
  } catch (err) {
    next(err);
  }
}

export async function previewWithAutoMapping(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.sub;
    const collectionId = req.params.databaseId as string;
    const object = (req.query.object as 'database' | 'data_source') || 'database';

    const properties = await notionService.getDatabaseProperties(userId, collectionId, object);
    const propertyMapping = notionService.autoMapProperties(properties);
    const pages = await notionService.listPages(userId, collectionId, object, propertyMapping, 'task');

    res.json({ data: { pages, propertyMapping } });
  } catch (err) {
    next(err);
  }
}

export async function previewWithAutoMappingNotes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.sub;
    const collectionId = req.params.databaseId as string;
    const object = (req.query.object as 'database' | 'data_source') || 'database';

    const properties = await notionService.getDatabaseProperties(userId, collectionId, object);
    const propertyMapping = notionService.autoMapPropertiesForNotes(properties);
    const pages = await notionService.listPages(userId, collectionId, object, propertyMapping, 'note');

    res.json({ data: { pages, propertyMapping } });
  } catch (err) {
    next(err);
  }
}

export async function listPages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.sub;
    const collectionId = req.params.databaseId as string;
    const object = (req.query.object as 'database' | 'data_source') || 'database';
    const propertyMapping = req.body.propertyMapping || {};

    const pages = await notionService.listPages(userId, collectionId, object, propertyMapping);
    res.json({ data: pages });
  } catch (err) {
    next(err);
  }
}

export async function getImportedPageIds(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.sub;
    const ids = await notionService.getImportedPageIds(userId);
    res.json({ data: ids });
  } catch (err) {
    next(err);
  }
}

export async function importTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.sub;
    const { databaseId, object, propertyMapping, pageIds } = req.body;

    if (!databaseId) {
      throw createError(400, 'MISSING_DATABASE_ID', 'databaseId is required');
    }
    if (!propertyMapping || typeof propertyMapping !== 'object') {
      throw createError(400, 'MISSING_PROPERTY_MAPPING', 'propertyMapping is required');
    }

    const collectionObject: 'database' | 'data_source' = object === 'data_source' ? 'data_source' : 'database';
    const result = await notionService.importTasks(userId, databaseId, collectionObject, propertyMapping, pageIds);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function importNotes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.sub;
    const { databaseId, object, propertyMapping, isJournal, pageIds } = req.body;

    if (!databaseId) {
      throw createError(400, 'MISSING_DATABASE_ID', 'databaseId is required');
    }
    if (!propertyMapping || typeof propertyMapping !== 'object') {
      throw createError(400, 'MISSING_PROPERTY_MAPPING', 'propertyMapping is required');
    }

    const collectionObject: 'database' | 'data_source' = object === 'data_source' ? 'data_source' : 'database';
    const result = await notionService.importNotes(
      userId,
      databaseId,
      collectionObject,
      propertyMapping,
      isJournal,
      pageIds
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
