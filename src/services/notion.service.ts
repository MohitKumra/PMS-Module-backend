// backend/src/services/notion.service.ts
// Notion OAuth + import service.
// Handles OAuth token exchange, database listing, and importing tasks/notes.
// Supports both legacy Database API and new Data Source API.

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Client } from '@notionhq/client';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prismaClient';
import { env } from '../config/env';
import { createError } from '../middleware/errorHandler';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NotionOAuthState {
  returnTo: string;
  userId: string;
}

export interface NotionIntegrationDTO {
  connected: boolean;
  workspaceName: string | null;
  workspaceIcon: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
}

export interface NotionCollectionDTO {
  id: string;
  object: 'database' | 'data_source';
  title: string;
  icon: string | null;
}

export interface NotionDatabaseProperty {
  type: string;
  name: string;
}

export interface NotionImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface NotionPagePreview {
  id: string;
  title: string;
  alreadyImported: boolean;
}

// ─── Encryption (mirrors google.service.ts pattern) ──────────────────────────

function encryptionKey(): Buffer {
  return crypto.createHash('sha256').update(env.JWT_REFRESH_SECRET).digest();
}

function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), encrypted.toString('base64'), tag.toString('base64')].join(':');
}

function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const [version, ivB64, encryptedB64, tagB64] = value.split(':');
  if (version !== 'v1' || !ivB64 || !encryptedB64 || !tagB64) return value;
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

// ─── OAuth ───────────────────────────────────────────────────────────────────

function signOAuthState(state: NotionOAuthState): string {
  return encodeURIComponent(jwt.sign(state, env.JWT_SECRET, { expiresIn: '10m' }));
}

export function verifyOAuthState(state: string): NotionOAuthState {
  return jwt.verify(decodeURIComponent(state), env.JWT_SECRET) as NotionOAuthState;
}

export function buildNotionAuthUrl(returnTo: string, userId: string): string {
  if (!env.NOTION_CLIENT_ID) {
    throw createError(503, 'NOTION_NOT_CONFIGURED', 'Notion OAuth is not configured');
  }

  const state = signOAuthState({ returnTo, userId });
  const params = new URLSearchParams({
    client_id: env.NOTION_CLIENT_ID,
    redirect_uri: env.NOTION_REDIRECT_URI,
    response_type: 'code',
    owner: 'user',
    state,
  });

  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(code: string): Promise<Record<string, any>> {
  if (!env.NOTION_CLIENT_ID || !env.NOTION_CLIENT_SECRET) {
    throw createError(503, 'NOTION_NOT_CONFIGURED', 'Notion OAuth is not configured');
  }

  const auth = Buffer.from(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`).toString('base64');

  const response = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.NOTION_REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw createError(400, 'NOTION_TOKEN_EXCHANGE_FAILED', `Failed to exchange Notion auth code: ${text}`);
  }

  return response.json() as Promise<Record<string, any>>;
}

// ─── Notion API helpers ──────────────────────────────────────────────────────

function createNotionClient(accessToken: string): Client {
  return new Client({ auth: accessToken });
}

async function getValidAccessToken(userId: string): Promise<string> {
  const connection = await (prisma as any).notionConnection.findUnique({ where: { userId } });
  if (!connection) {
    throw createError(401, 'NOTION_NOT_CONNECTED', 'Notion is not connected. Please connect in Settings.');
  }

  const token = decryptSecret(connection.accessToken);
  if (!token) {
    throw createError(401, 'NOTION_TOKEN_MISSING', 'Notion access token is missing. Please reconnect.');
  }

  return token;
}

// ─── Collection API helpers (supports both database and data_source) ─────────

/**
 * Query a Notion collection (database or data_source) for its pages/rows.
 * Uses the appropriate API based on the object type.
 *
 * NOTE: @notionhq/client v5.x removed databases.query() from the SDK.
 * The databases namespace only has retrieve/update/create.
 * We use notion.request() for database queries and dataSources.query() for data sources.
 */
async function queryCollection(
  notion: Client,
  collectionId: string,
  object: 'database' | 'data_source',
  cursor?: string
): Promise<any> {
  // NOTE: @notionhq/client v5.x removed databases.query() from the SDK.
  // The Notion API v2 has deprecated POST /v1/databases/{id}/query and now
  // uses POST /v1/data_sources/{id}/query for ALL queries (both databases and data sources).
  // Use dataSources.query() for both types.

  // Data source API — check SDK support first
  if ((notion as any).dataSources) {
    return await (notion as any).dataSources.query({
      data_source_id: collectionId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
  }

  // Fallback to raw API if SDK doesn't expose dataSources
  return await (notion as any).request({
    path: `data_sources/${collectionId}/query`,
    method: 'POST',
    body: {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    },
  });
}

/**
 * Retrieve a Notion collection's metadata (database or data_source).
 * Uses the appropriate API based on the object type.
 *
 * NOTE: databases.retrieve() and dataSources.retrieve() both exist in SDK v5.x.
 */
async function retrieveCollection(
  notion: Client,
  collectionId: string,
  object: 'database' | 'data_source'
): Promise<any> {
  if (object === 'database') {
    // Legacy database API — databases.retrieve() exists in SDK v5.x
    return await notion.databases.retrieve({ database_id: collectionId });
  }

  // Data source API — check SDK support first
  if ((notion as any).dataSources) {
    return await (notion as any).dataSources.retrieve({ data_source_id: collectionId });
  }

  // Fallback to raw API if SDK doesn't expose dataSources
  return await (notion as any).request({
    path: `data_sources/${collectionId}`,
    method: 'GET',
  });
}

// ─── Page preview helpers ────────────────────────────────────────────────────

/**
 * Extract a page's title using the property mapping.
 * Falls back to the first 'title' type property if the mapping doesn't specify one.
 */
function extractPageTitle(page: any, propertyMapping: Record<string, string>): string | null {
  const props = page.properties ?? {};

  // Try the mapped title property first
  for (const [notionPropName, systemField] of Object.entries(propertyMapping)) {
    if (systemField === 'title') {
      const prop = props[notionPropName];
      if (prop?.type === 'title' && prop.title) {
        const t = (prop.title ?? [])
          .map((t: any) => t.plain_text ?? '')
          .join('')
          .trim();
        if (t) return t;
      }
    }
  }

  // Fallback: find the first title property
  for (const [, prop] of Object.entries(props)) {
    const p = prop as any;
    if (p.type === 'title' && p.title) {
      const t = (p.title ?? [])
        .map((t: any) => t.plain_text ?? '')
        .join('')
        .trim();
      if (t) return t;
    }
  }

  return null;
}

/**
 * Auto-detect property mapping from Notion database properties to system fields.
 * Matches by property name (case-insensitive) and type.
 */
export function autoMapProperties(properties: Record<string, NotionDatabaseProperty>): Record<string, string> {
  const mapping: Record<string, string> = {};
  const entries = Object.entries(properties);

  // Helper to check if a property name is already used in the mapping
  const isUsed = (propName: string) => Object.keys(mapping).includes(propName);

  // Helper to find a property by name keywords and type
  const findByName = (names: string[], types: string[]): [string, NotionDatabaseProperty] | undefined => {
    const lower = names.map((n) => n.toLowerCase());
    return entries.find(
      ([name, prop]) => lower.includes(name.toLowerCase()) && types.includes(prop.type) && !isUsed(name)
    );
  };

  // 1. Title: always the 'title' type property (Notion has exactly one)
  const titleEntry = entries.find(([, p]) => p.type === 'title');
  if (titleEntry) mapping[titleEntry[0]] = 'title';

  // 2. Status: name match first (select/status), then type match
  const statusEntry =
    findByName(['status', 'state', 'stage'], ['select', 'status']) ??
    entries.find(([, p]) => p.type === 'status' && !isUsed(p.name)) ??
    entries.find(([, p]) => p.type === 'select' && !isUsed(p.name));
  if (statusEntry && !isUsed(statusEntry[0])) mapping[statusEntry[0]] = 'status';

  // 3. Priority: name match on select properties (different from status)
  const priorityEntry = findByName(['priority', 'importance', 'urgency', 'urgent'], ['select']);
  if (priorityEntry && !isUsed(priorityEntry[0])) mapping[priorityEntry[0]] = 'priority';

  // 4. Due Date: name match on date properties
  const dateEntry =
    findByName(['due date', 'deadline', 'due', 'due_date', 'date'], ['date']) ??
    entries.find(([, p]) => p.type === 'date' && !isUsed(p.name));
  if (dateEntry && !isUsed(dateEntry[0])) mapping[dateEntry[0]] = 'dueDate';

  // 5. Description: name match on rich_text properties
  const descEntry =
    findByName(['description', 'text', 'content', 'notes', 'details', 'body', 'comment', 'note'], ['rich_text']) ??
    entries.find(([, p]) => p.type === 'rich_text' && !isUsed(p.name));
  if (descEntry && !isUsed(descEntry[0])) mapping[descEntry[0]] = 'description';

  return mapping;
}

/**
 * Auto-detect property mapping from Notion database properties for notes/journal.
 * Maps to: title, content, tags
 */
export function autoMapPropertiesForNotes(properties: Record<string, NotionDatabaseProperty>): Record<string, string> {
  const mapping: Record<string, string> = {};
  const entries = Object.entries(properties);

  const isUsed = (propName: string) => Object.keys(mapping).includes(propName);

  const findByName = (names: string[], types: string[]): [string, NotionDatabaseProperty] | undefined => {
    const lower = names.map((n) => n.toLowerCase());
    return entries.find(
      ([name, prop]) => lower.includes(name.toLowerCase()) && types.includes(prop.type) && !isUsed(name)
    );
  };

  // 1. Title: always the 'title' type property
  const titleEntry = entries.find(([, p]) => p.type === 'title');
  if (titleEntry) mapping[titleEntry[0]] = 'title';

  // 2. Content: find rich_text named content, text, description, body, notes, etc.
  const contentEntry =
    findByName(['content', 'text', 'description', 'body', 'notes', 'note', 'details', 'entry'], ['rich_text']) ??
    entries.find(([, p]) => p.type === 'rich_text' && !isUsed(p.name));
  if (contentEntry && !isUsed(contentEntry[0])) mapping[contentEntry[0]] = 'content';

  // 3. Tags: find multi_select properties
  const tagsEntry = entries.find(([, p]) => p.type === 'multi_select' && !isUsed(p.name));
  if (tagsEntry && !isUsed(tagsEntry[0])) mapping[tagsEntry[0]] = 'tags';

  return mapping;
}

/**
 * Preview pages from a Notion collection before importing.
 * Returns pages with their titles and whether they've already been imported.
 * The `table` parameter determines which DB table to check for duplicates ('task' or 'note').
 */
export async function listPages(
  userId: string,
  collectionId: string,
  object: 'database' | 'data_source',
  propertyMapping: Record<string, string>,
  table: 'task' | 'note' = 'task'
): Promise<NotionPagePreview[]> {
  const accessToken = await getValidAccessToken(userId);
  const notion = createNotionClient(accessToken);

  // Get all notionPageId values already imported
  const model = table === 'task' ? (prisma as any).task : (prisma as any).note;
  const importedPages = new Set(
    (
      (await model.findMany({
        where: { userId, notionPageId: { not: null } },
        select: { notionPageId: true },
      })) as { notionPageId: string }[]
    )
      .map((t) => t.notionPageId)
      .filter(Boolean)
  );

  const pages: NotionPagePreview[] = [];
  let cursor: string | undefined;

  do {
    let response: any;
    try {
      response = await queryCollection(notion, collectionId, object, cursor);
    } catch (err: any) {
      throw err;
    }

    for (const result of response.results ?? []) {
      if (result.object !== 'page' || !result.properties) continue;

      const title = extractPageTitle(result, propertyMapping);
      if (!title) continue;

      pages.push({
        id: result.id,
        title,
        alreadyImported: importedPages.has(result.id),
      });
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return pages;
}

/**
 * Get a list of notionPageId values that have already been imported as tasks.
 */
export async function getImportedPageIds(userId: string): Promise<string[]> {
  const results = await (prisma as any).task.findMany({
    where: { userId, notionPageId: { not: null } },
    select: { notionPageId: true },
  });
  return (results as { notionPageId: string }[]).map((r) => r.notionPageId).filter(Boolean);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function handleOAuthCallback(code: string, state: string, userId: string): Promise<void> {
  if (!code) throw createError(400, 'MISSING_NOTION_CODE', 'Notion authorization code missing');

  verifyOAuthState(state);
  const tokens = await exchangeCodeForTokens(code);

  await (prisma as any).notionConnection.upsert({
    where: { userId },
    create: {
      userId,
      accessToken: encryptSecret(tokens.access_token),
      workspaceName: tokens.workspace_name || null,
      workspaceIcon: tokens.workspace_icon || null,
    },
    update: {
      accessToken: encryptSecret(tokens.access_token),
      workspaceName: tokens.workspace_name || null,
      workspaceIcon: tokens.workspace_icon || null,
      connectedAt: new Date(),
      lastSyncedAt: null,
    },
  });
}

export async function getNotionIntegration(userId: string): Promise<NotionIntegrationDTO> {
  const connection = await (prisma as any).notionConnection.findUnique({ where: { userId } });
  return {
    connected: Boolean(connection),
    workspaceName: connection?.workspaceName ?? null,
    workspaceIcon: connection?.workspaceIcon ?? null,
    connectedAt: connection?.connectedAt?.toISOString?.() ?? null,
    lastSyncedAt: connection?.lastSyncedAt?.toISOString?.() ?? null,
  };
}

export async function disconnectNotion(userId: string): Promise<void> {
  await (prisma as any).notionConnection.delete({ where: { userId } }).catch(() => {});
}

export async function listDatabases(userId: string): Promise<NotionCollectionDTO[]> {
  const accessToken = await getValidAccessToken(userId);
  const notion = createNotionClient(accessToken);

  // Notion API: search endpoint to find databases the integration has access to
  let cursor: string | undefined;
  const collections: NotionCollectionDTO[] = [];

  do {
    let response: any;
    try {
      // Notion API: search without filter to get all accessible items,
      // then filter for database/data_source objects in code below.
      response = await notion.search({
        query: '',
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
    } catch (err: any) {
      throw err;
    }

    for (const result of response.results ?? []) {
      const db = result as any;

      // Only include database/data_source objects (search may return other types)
      if (db.object !== 'database' && db.object !== 'data_source') continue;

      if (!db.title) continue;

      const title =
        (Array.isArray(db.title) ? db.title : [])
          .map((t: any) => t.plain_text ?? '')
          .join('')
          .trim() || 'Untitled';

      let icon: string | null = null;
      if (db.icon?.type === 'emoji') {
        icon = db.icon.emoji;
      } else if (db.icon?.type === 'external') {
        icon = db.icon.external.url;
      } else if (db.icon?.type === 'file') {
        icon = db.icon.file.url;
      }

      // Use the object's own ID — for data_sources, the id IS the correct ID
      // to use for querying (not parent.database_id)
      collections.push({
        id: db.id,
        object: db.object as 'database' | 'data_source',
        title,
        icon,
      });
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return collections;
}

export async function getDatabaseProperties(
  userId: string,
  collectionId: string,
  object: 'database' | 'data_source'
): Promise<Record<string, NotionDatabaseProperty>> {
  const accessToken = await getValidAccessToken(userId);
  const notion = createNotionClient(accessToken);

  const db = await retrieveCollection(notion, collectionId, object);
  const dbAny = db as any;
  const properties: Record<string, NotionDatabaseProperty> = {};

  if (dbAny.properties) {
    for (const [key, prop] of Object.entries(dbAny.properties)) {
      const p = prop as any;
      properties[key] = {
        type: p.type ?? 'unknown',
        name: key,
      };
    }
  }

  return properties;
}

// ─── Import Tasks from Notion Database ───────────────────────────────────────

export async function importTasks(
  userId: string,
  collectionId: string,
  object: 'database' | 'data_source',
  propertyMapping: Record<string, string>,
  pageIds?: string[]
): Promise<NotionImportResult> {
  const accessToken = await getValidAccessToken(userId);
  const notion = createNotionClient(accessToken);

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  let cursor: string | undefined;

  do {
    let response: any;
    try {
      response = await queryCollection(notion, collectionId, object, cursor);
    } catch (err: any) {
      errors.push(`Query failed: ${err.message}`);
      break;
    }

    for (const page of response.results ?? []) {
      if (page.object !== 'page' || !page.properties) continue;

      const notionId = page.id;

      // If specific pageIds provided, only import those
      if (pageIds && !pageIds.includes(notionId)) {
        skipped++;
        continue;
      }

      // Check for duplicates
      const existing = await (prisma as any).task.findUnique({ where: { notionPageId: notionId } });
      if (existing) {
        skipped++;
        continue;
      }

      try {
        const taskData = mapNotionPageToTask(page, propertyMapping);
        if (!taskData.title) {
          skipped++;
          continue;
        }

        await (prisma as any).task.create({
          data: {
            userId,
            title: taskData.title,
            description: taskData.description,
            status: taskData.status ?? 'TODO',
            priority: taskData.priority ?? 'MEDIUM',
            dueDate: taskData.dueDate ?? null,
            notionPageId: notionId,
          },
        });

        imported++;
      } catch (err: any) {
        errors.push(`Failed to import page ${notionId}: ${err.message}`);
        skipped++;
      }
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  // Update last synced
  await (prisma as any).notionConnection.update({
    where: { userId },
    data: { lastSyncedAt: new Date() },
  });

  // Log the import
  await (prisma as any).integrationLog.create({
    data: {
      userId,
      source: 'notion',
      action: 'import_tasks',
      status: errors.length > 0 ? (imported > 0 ? 'partial' : 'failed') : 'success',
      itemsCount: imported,
      errorLog: errors.length > 0 ? { errors } : undefined,
    },
  });

  return { imported, skipped, errors };
}

// ─── Import Notes from Notion Database ───────────────────────────────────────

export async function importNotes(
  userId: string,
  collectionId: string,
  object: 'database' | 'data_source',
  propertyMapping: Record<string, string>,
  isJournal?: boolean,
  pageIds?: string[]
): Promise<NotionImportResult> {
  const accessToken = await getValidAccessToken(userId);
  const notion = createNotionClient(accessToken);

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  let cursor: string | undefined;

  do {
    let response: any;
    try {
      response = await queryCollection(notion, collectionId, object, cursor);
    } catch (err: any) {
      errors.push(`Query failed: ${err.message}`);
      break;
    }

    for (const page of response.results ?? []) {
      if (page.object !== 'page' || !page.properties) continue;

      const notionId = page.id;

      // If specific pageIds provided, only import those
      if (pageIds && !pageIds.includes(notionId)) {
        skipped++;
        continue;
      }

      // Check for duplicates
      const existing = await (prisma as any).note.findUnique({ where: { notionPageId: notionId } });
      if (existing) {
        skipped++;
        continue;
      }

      try {
        const noteData = await mapNotionPageToNote(notion, page, propertyMapping);

        await (prisma as any).note.create({
          data: {
            userId,
            title: noteData.title,
            content: noteData.content,
            // Omit empty tags so the DB column default applies instead of sending
            // an empty JS array (avoids P2007 "malformed array literal: []").
            ...(noteData.tags && noteData.tags.length > 0 ? { tags: noteData.tags } : {}),
            isJournal: isJournal ?? false,
            notionPageId: notionId,
          },
        });

        imported++;
      } catch (err: any) {
        errors.push(`Failed to import page ${notionId}: ${err.message}`);
        skipped++;
      }
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  // Update last synced
  await (prisma as any).notionConnection.update({
    where: { userId },
    data: { lastSyncedAt: new Date() },
  });

  // Log the import
  await (prisma as any).integrationLog.create({
    data: {
      userId,
      source: 'notion',
      action: 'import_notes',
      status: errors.length > 0 ? (imported > 0 ? 'partial' : 'failed') : 'success',
      itemsCount: imported,
      errorLog: errors.length > 0 ? { errors } : undefined,
    },
  });

  return { imported, skipped, errors };
}

// ─── Property Mapping ────────────────────────────────────────────────────────

interface MappedTask {
  title: string;
  description: string | null;
  status?: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  dueDate?: Date | null;
}

function mapNotionPageToTask(page: any, mapping: Record<string, string>): MappedTask {
  const props = page.properties ?? {};
  const result: MappedTask = { title: '', description: null };

  for (const [notionPropName, systemField] of Object.entries(mapping)) {
    const prop = props[notionPropName];
    if (!prop) continue;

    switch (systemField) {
      case 'title': {
        if (prop.type === 'title') {
          result.title = (prop.title ?? [])
            .map((t: any) => t.plain_text ?? '')
            .join('')
            .trim();
        }
        break;
      }
      case 'description': {
        if (prop.type === 'rich_text') {
          result.description =
            (prop.rich_text ?? [])
              .map((t: any) => t.plain_text ?? '')
              .join('')
              .trim() || null;
        }
        break;
      }
      case 'status': {
        if (prop.type === 'select' && prop.select) {
          const statusMap: Record<string, 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'> = {
            'not started': 'TODO',
            'to do': 'TODO',
            'in progress': 'IN_PROGRESS',
            done: 'DONE',
            completed: 'DONE',
            cancelled: 'CANCELLED',
          };
          result.status = statusMap[prop.select.name?.toLowerCase()] ?? 'TODO';
        } else if (prop.type === 'status' && prop.status) {
          const statusMap: Record<string, 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'> = {
            'not started': 'TODO',
            'to do': 'TODO',
            'in progress': 'IN_PROGRESS',
            done: 'DONE',
            completed: 'DONE',
            cancelled: 'CANCELLED',
          };
          result.status = statusMap[prop.status.name?.toLowerCase()] ?? 'TODO';
        }
        break;
      }
      case 'priority': {
        if (prop.type === 'select' && prop.select) {
          const priorityMap: Record<string, 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'> = {
            low: 'LOW',
            medium: 'MEDIUM',
            high: 'HIGH',
            critical: 'CRITICAL',
            urgent: 'CRITICAL',
          };
          result.priority = priorityMap[prop.select.name?.toLowerCase()] ?? 'MEDIUM';
        }
        break;
      }
      case 'dueDate': {
        if (prop.type === 'date' && prop.date) {
          result.dueDate = new Date(prop.date.start);
        }
        break;
      }
    }
  }

  return result;
}

interface MappedNote {
  title: string | null;
  content: string;
  tags: string[];
}

async function mapNotionPageToNote(notion: Client, page: any, mapping: Record<string, string>): Promise<MappedNote> {
  const props = page.properties ?? {};
  const result: MappedNote = { title: null, content: '', tags: [] };

  for (const [notionPropName, systemField] of Object.entries(mapping)) {
    const prop = props[notionPropName];
    if (!prop) continue;

    switch (systemField) {
      case 'title': {
        if (prop.type === 'title') {
          result.title =
            (prop.title ?? [])
              .map((t: any) => t.plain_text ?? '')
              .join('')
              .trim() || null;
        }
        break;
      }
      case 'content': {
        if (prop.type === 'rich_text') {
          result.content = (prop.rich_text ?? [])
            .map((t: any) => t.plain_text ?? '')
            .join('')
            .trim();
        }
        break;
      }
      case 'tags': {
        if (prop.type === 'multi_select') {
          result.tags = (prop.multi_select ?? []).map((t: any) => t.name);
        }
        break;
      }
    }
  }

  // If no rich_text content property, fetch page blocks as content
  if (!result.content) {
    try {
      const blocks = await notion.blocks.children.list({ block_id: page.id });
      result.content = (blocks.results ?? [])
        .map((block: any) => {
          if (block.type === 'paragraph') {
            return block.paragraph?.rich_text?.map((t: any) => t.plain_text ?? '').join('') ?? '';
          }
          if (block.type === 'heading_1') {
            return `# ${block.heading_1?.rich_text?.map((t: any) => t.plain_text ?? '').join('') ?? ''}`;
          }
          if (block.type === 'heading_2') {
            return `## ${block.heading_2?.rich_text?.map((t: any) => t.plain_text ?? '').join('') ?? ''}`;
          }
          if (block.type === 'heading_3') {
            return `### ${block.heading_3?.rich_text?.map((t: any) => t.plain_text ?? '').join('') ?? ''}`;
          }
          if (block.type === 'bulleted_list_item') {
            return `- ${block.bulleted_list_item?.rich_text?.map((t: any) => t.plain_text ?? '').join('') ?? ''}`;
          }
          if (block.type === 'numbered_list_item') {
            return `1. ${block.numbered_list_item?.rich_text?.map((t: any) => t.plain_text ?? '').join('') ?? ''}`;
          }
          if (block.type === 'to_do') {
            const checked = block.to_do?.checked ? '[x]' : '[ ]';
            return `${checked} ${block.to_do?.rich_text?.map((t: any) => t.plain_text ?? '').join('') ?? ''}`;
          }
          if (block.type === 'code') {
            return `\`\`\`\n${block.code?.rich_text?.map((t: any) => t.plain_text ?? '').join('') ?? ''}\n\`\`\``;
          }
          if (block.type === 'quote') {
            return `> ${block.quote?.rich_text?.map((t: any) => t.plain_text ?? '').join('') ?? ''}`;
          }
          if (block.type === 'divider') {
            return '---';
          }
          return '';
        })
        .filter(Boolean)
        .join('\n\n');
    } catch {
      // If we can't fetch blocks, just use empty content
    }
  }

  return result;
}
