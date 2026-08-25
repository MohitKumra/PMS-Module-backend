// backend/src/services/audit.service.ts
// Secure administrative audit logging service.

import { prisma } from '../lib/prismaClient';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'code',
  'codehash',
  'otp',
  'token',
  'jwt',
  'secret',
  'apikey',
  'razorpay_key_secret',
  'webhook_secret',
]);

function sanitizePayload(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizePayload);

  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = sanitizePayload(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

export async function logAdminAction(params: {
  adminAccountId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: any;
  after?: any;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminAccountId: params.adminAccountId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        before: params.before ? sanitizePayload(params.before) : undefined,
        after: params.after ? sanitizePayload(params.after) : undefined,
        reason: params.reason ?? null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        requestId: params.requestId ?? null,
      },
    });
  } catch (err) {
    console.error('[AuditService] Failed to write audit log:', err);
  }
}