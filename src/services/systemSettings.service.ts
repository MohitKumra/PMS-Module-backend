// backend/src/services/systemSettings.service.ts
// Persists application-wide system settings in the database (SystemSetting
// key/value rows) and keeps an in-memory cache for fast reads on every request.
// Settings survive restarts because the DB is the source of truth.

import { prisma } from '../lib/prismaClient';

export interface InvoiceSettings {
  sac: string;
  supportEmail: string;
  notes: string;
  placeOfSupply: string;
  currency: string;
  invoicePrefix: string;
  companyName: string;
  gstin: string;
  addressLine1: string;
  addressLine2: string;
  cityState: string;
  pincode: string;
}

export interface SystemSettings {
  appName: string;
  supportEmail: string;
  defaultCurrency: string;
  defaultTimezone: string;
  maintenanceMode: boolean;
  maintenanceMessage?: string | null;
  invoice: InvoiceSettings;
  updatedAt?: string;
}

const INVOICE_DEFAULTS: InvoiceSettings = {
  sac: '',
  supportEmail: '',
  notes: 'All monthly and usage payments are non-refundable.',
  placeOfSupply: '',
  currency: 'INR',
  invoicePrefix: 'INV',
  companyName: '',
  gstin: '',
  addressLine1: '',
  addressLine2: '',
  cityState: '',
  pincode: '',
};

const DEFAULTS: SystemSettings = {
  appName: 'Finamite Productivity',
  supportEmail: 'support@finamite.com',
  defaultCurrency: 'USD',
  defaultTimezone: 'UTC',
  maintenanceMode: false,
  maintenanceMessage: null,
  invoice: { ...INVOICE_DEFAULTS },
};

let cache: SystemSettings = { ...DEFAULTS, invoice: { ...DEFAULTS.invoice } };
let loaded = false;

/** Load all settings rows from the DB into the cache. Safe to call at startup. */
export async function loadSystemSettings(): Promise<SystemSettings> {
  const rows = await prisma.systemSetting.findMany();
  const merged: SystemSettings = { ...DEFAULTS, invoice: { ...DEFAULTS.invoice } };

  for (const row of rows) {
    const v = row.value as any;
    if (row.key === 'maintenanceMode') merged.maintenanceMode = Boolean(v);
    else if (row.key === 'appName') merged.appName = String(v);
    else if (row.key === 'supportEmail') merged.supportEmail = String(v);
    else if (row.key === 'defaultCurrency') merged.defaultCurrency = String(v);
    else if (row.key === 'defaultTimezone') merged.defaultTimezone = String(v);
    else if (row.key === 'maintenanceMessage') merged.maintenanceMessage = v == null ? null : String(v);
    else if (row.key === 'invoice') {
      const obj = (v && typeof v === 'object' ? v : {}) as Partial<InvoiceSettings>;
      merged.invoice = {
        sac: typeof obj.sac === 'string' ? obj.sac : INVOICE_DEFAULTS.sac,
        supportEmail: typeof obj.supportEmail === 'string' ? obj.supportEmail : INVOICE_DEFAULTS.supportEmail,
        notes: typeof obj.notes === 'string' ? obj.notes : INVOICE_DEFAULTS.notes,
        placeOfSupply: typeof obj.placeOfSupply === 'string' ? obj.placeOfSupply : INVOICE_DEFAULTS.placeOfSupply,
        currency: typeof obj.currency === 'string' ? obj.currency : INVOICE_DEFAULTS.currency,
        invoicePrefix: typeof obj.invoicePrefix === 'string' ? obj.invoicePrefix : INVOICE_DEFAULTS.invoicePrefix,
        companyName: typeof obj.companyName === 'string' ? obj.companyName : INVOICE_DEFAULTS.companyName,
        gstin: typeof obj.gstin === 'string' ? obj.gstin : INVOICE_DEFAULTS.gstin,
        addressLine1: typeof obj.addressLine1 === 'string' ? obj.addressLine1 : INVOICE_DEFAULTS.addressLine1,
        addressLine2: typeof obj.addressLine2 === 'string' ? obj.addressLine2 : INVOICE_DEFAULTS.addressLine2,
        cityState: typeof obj.cityState === 'string' ? obj.cityState : INVOICE_DEFAULTS.cityState,
        pincode: typeof obj.pincode === 'string' ? obj.pincode : INVOICE_DEFAULTS.pincode,
      };
    }
  }

  cache = { ...merged, invoice: { ...merged.invoice } };
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
      cache = { ...DEFAULTS, invoice: { ...DEFAULTS.invoice } };
      loaded = true;
    }
  }
  return { ...cache, invoice: { ...cache.invoice } };
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
  const next: SystemSettings = {
    ...current,
    ...patch,
    invoice: { ...current.invoice, ...(patch.invoice || {}) },
  };

  const keysToStore: Record<string, any> = {
    appName: next.appName,
    supportEmail: next.supportEmail,
    defaultCurrency: next.defaultCurrency,
    defaultTimezone: next.defaultTimezone,
    maintenanceMode: next.maintenanceMode,
    maintenanceMessage: next.maintenanceMessage ?? null,
    invoice: next.invoice,
  };

  for (const [key, value] of Object.entries(keysToStore)) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: value as any, updatedByAdminId: adminId ?? null },
      update: { value: value as any, updatedByAdminId: adminId ?? null },
    });
  }

  cache = { ...next, invoice: { ...next.invoice }, updatedAt: new Date().toISOString() };
  loaded = true;
  return { ...cache, invoice: { ...cache.invoice } };
}

/** Read-only accessor for the invoice billing settings. */
export async function getInvoiceSettings(): Promise<InvoiceSettings> {
  const s = await getSystemSettings();
  return { ...s.invoice };
}

/**
 * Synchronous read of the invoice billing settings from the in-memory cache.
 * Safe to call during synchronous rendering (e.g. buildInvoiceHtml) because the
 * settings cache is loaded at server bootstrap via loadSystemSettings(). If not
 * yet loaded it returns defaults rather than stale/partial data.
 */
export function getCachedInvoiceSettings(): InvoiceSettings {
  return { ...(cache.invoice || INVOICE_DEFAULTS) };
}

