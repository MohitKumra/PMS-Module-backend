// backend/src/services/systemSettings.service.ts
// Persists application-wide system settings in the database (SystemSetting
// key/value rows) and keeps an in-memory cache for fast reads on every request.
// Settings survive restarts because the DB is the source of truth.

import { prisma } from '../lib/prismaClient';

export interface SystemSettings {
  appName: string;
  supportEmail: string;
  defaultCurrency: string;
  defaultTimezone: string;
  maintenanceMode: boolean;
  maintenanceMessage?: string | null;
  updatedAt?: string;
}

const DEFAULTS: SystemSettings = {
  appName: 'Finamite Productivity',
  supportEmail: 'support@finamite.com',
  defaultCurrency: 'USD',
  defaultTimezone: 'UTC',
  maintenanceMode: false,
  maintenanceMessage: null,
};

let cache: SystemSettings = { ...DEFAULTS };
let loaded = false;

/** Load all settings rows from the DB into the cache. Safe to call at startup. */
export async function loadSystemSettings(): Promise<SystemSettings> {
  const rows = await prisma.systemSetting.findMany();
  const merged: SystemSettings = { ...DEFAULTS };

  for (const row of rows) {
    const v = row.value as any;
    if (row.key === 'maintenanceMode') merged.maintenanceMode = Boolean(v);
    else if (row.key === 'appName') merged.appName = String(v);
    else if (row.key === 'supportEmail') merged.supportEmail = String(v);
    else if (row.key === 'defaultCurrency') merged.defaultCurrency = String(v);
    else if (row.key === 'defaultTimezone') merged.defaultTimezone = String(v);
    else if (row.key === 'maintenanceMessage') merged.maintenanceMessage = v == null ? null : String(v);
  }

  cache = merged;
  loaded = true;
  return cache;
}

/** Return the current cache, loading from DB once on first access if needed. */
export async function getSystemSettings(): Promise<SystemSettings> {
  if (!loaded) {
    try {
      await loadSystemSettings();
    } catch (err) {
      console.error('[SystemSettings] Load from DB failed, using defaults:', err);
      cache = { ...DEFAULTS };
      loaded = true;
    }
  }
  return { ...cache };
}

export async function isMaintenanceMode(): Promise<boolean> {
  const s = await getSystemSettings();
  return s.maintenanceMode;
}

/** Upsert the given keys to the DB and refresh the cache. Returns merged settings. */
export async function updateSystemSettings(
  patch: Partial<SystemSettings>,
  adminId?: string
): Promise<SystemSettings> {
  const current = await getSystemSettings();
  const next = { ...current, ...patch };

  const keysToStore: Record<string, any> = {
    appName: next.appName,
    supportEmail: next.supportEmail,
    defaultCurrency: next.defaultCurrency,
    defaultTimezone: next.defaultTimezone,
    maintenanceMode: next.maintenanceMode,
    maintenanceMessage: next.maintenanceMessage ?? null,
  };

  for (const [key, value] of Object.entries(keysToStore)) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: value as any, updatedByAdminId: adminId ?? null },
      update: { value: value as any, updatedByAdminId: adminId ?? null },
    });
  }

  cache = { ...next, updatedAt: new Date().toISOString() };
  loaded = true;
  return { ...cache };
}