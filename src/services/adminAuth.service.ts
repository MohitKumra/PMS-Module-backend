// backend/src/services/adminAuth.service.ts
// Handles admin bootstrapping, credential check, hashed email OTP, and sessions.

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../lib/prismaClient';
import { env } from '../config/env';
import { createError } from '../middleware/errorHandler';
import { signAdminAccessToken, signAdminRefreshToken, verifyAdminRefreshToken } from '../lib/adminJwt';
import { sendMail, renderAdminOtp } from '../lib/mailer';
import { logAdminAction } from './audit.service';
import { ROLE_PERMISSIONS, type AdminPermission } from '../middleware/requirePermission';
import type { AdminRole } from '@prisma/client';

function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

async function resolvePasswordHash(raw: string): Promise<string> {
  // If it's already a bcrypt hash (starts with $2a$, $2b$, or $2y$), return it directly
  if (/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(raw)) {
    return raw;
  }
  // Otherwise, hash the plain text password
  return bcrypt.hash(raw, 12);
}

/**
 * Idempotently bootstraps the initial super administrator.
 * Automatically hashes plaintext passwords provided in environment variables,
 * and synchronizes with .env when updated.
 */
export async function bootstrapAdmin(): Promise<void> {
  const adminEmail = (env.ADMIN_EMAIL || 'admin@finamite.com').trim().toLowerCase();
  const rawPassword = env.ADMIN_PASSWORD_HASH || 'Admin@Finamite2026!';
  const computedHash = await resolvePasswordHash(rawPassword);

  const existing = await prisma.adminAccount.findUnique({
    where: { email: adminEmail },
  });

  if (!existing) {
    await prisma.adminAccount.create({
      data: {
        email: adminEmail,
        passwordHash: computedHash,
        role: 'SUPER_ADMIN',
        isActive: true,
      },
    });
    console.info(`🛡️  Admin bootstrapped: ${adminEmail}`);
  } else {
    // If stored password in DB is not a valid bcrypt hash or does not match current .env password, sync it
    const isStoredHashValid = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(existing.passwordHash);
    let passwordMatches = false;
    if (isStoredHashValid) {
      passwordMatches = await bcrypt.compare(rawPassword, existing.passwordHash);
    }

    if (!isStoredHashValid || !passwordMatches) {
      await prisma.adminAccount.update({
        where: { id: existing.id },
        data: { passwordHash: computedHash, isActive: true },
      });
      console.info(`🛡️  Admin password synchronized with environment configuration: ${adminEmail}`);
    }
  }
}

/**
 * Validates admin credentials, generates a 6-digit OTP, stores SHA-256 hash, and emails it.
 */
export async function sendAdminOtp(
  email: string,
  password: string
): Promise<{ adminAccountId: string; email: string }> {
  const sanitizedEmail = email.trim().toLowerCase();
  const admin = await prisma.adminAccount.findUnique({
    where: { email: sanitizedEmail },
  });

  if (!admin || !admin.isActive) {
    throw createError(401, 'INVALID_CREDENTIALS', 'Invalid administrator credentials');
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    throw createError(401, 'INVALID_CREDENTIALS', 'Invalid administrator credentials');
  }

  // Generate cryptographically secure 6-digit OTP
  const rawOtp = crypto.randomInt(100000, 999999).toString();
  const codeHash = hashOtp(rawOtp);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Invalidate any previously unconsumed OTPs for this admin
  await prisma.adminOtp.updateMany({
    where: { adminAccountId: admin.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  await prisma.adminOtp.create({
    data: {
      adminAccountId: admin.id,
      codeHash,
      expiresAt,
      maxAttempts: 5,
      attempts: 0,
    },
  });

  // Always log OTP in terminal during dev / local for developer convenience
  console.info(`🔑 [ADMIN OTP] Generated verification code for ${admin.email}: ${rawOtp}`);

  // Send the OTP via email
  try {
    await sendMail({
      to: admin.email,
      subject: '🛡️ Finamite Admin Verification Code',
      html: renderAdminOtp({ otp: rawOtp }),
    });
  } catch (err: any) {
    console.warn(`⚠️ [ADMIN OTP] Email dispatch warning: ${err.message}. Use console OTP code above.`);
  }

  return { adminAccountId: admin.id, email: admin.email };
}


/**
 * Verifies admin OTP code hash, checks attempt limits & expiration, and issues JWT + refresh token.
 */
export async function verifyAdminOtp(
  email: string,
  code: string,
  context?: { ipAddress?: string; userAgent?: string }
): Promise<{
  accessToken: string;
  refreshToken: string;
  admin: {
    id: string;
    email: string;
    role: AdminRole;
    permissions: AdminPermission[];
  };
}> {
  const sanitizedEmail = email.trim().toLowerCase();
  const admin = await prisma.adminAccount.findUnique({
    where: { email: sanitizedEmail },
  });

  if (!admin || !admin.isActive) {
    throw createError(401, 'INVALID_CREDENTIALS', 'Invalid administrator account');
  }

  const otpRecord = await prisma.adminOtp.findFirst({
    where: {
      adminAccountId: admin.id,
      consumedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!otpRecord) {
    throw createError(400, 'OTP_EXPIRED', 'No active verification code found. Please request a new one.');
  }

  if (otpRecord.expiresAt.getTime() < Date.now()) {
    await prisma.adminOtp.update({
      where: { id: otpRecord.id },
      data: { consumedAt: new Date() },
    });
    throw createError(400, 'OTP_EXPIRED', 'Verification code has expired. Please request a new one.');
  }

  if (otpRecord.attempts >= otpRecord.maxAttempts) {
    await prisma.adminOtp.update({
      where: { id: otpRecord.id },
      data: { consumedAt: new Date() },
    });
    throw createError(429, 'OTP_ATTEMPTS_EXCEEDED', 'Maximum verification attempts exceeded. Please request a new code.');
  }

  const providedHash = hashOtp(code.trim());
  if (providedHash !== otpRecord.codeHash) {
    await prisma.adminOtp.update({
      where: { id: otpRecord.id },
      data: { attempts: { increment: 1 } },
    });
    const remaining = otpRecord.maxAttempts - (otpRecord.attempts + 1);
    throw createError(
      400,
      'INVALID_OTP',
      `Invalid verification code. ${remaining > 0 ? `${remaining} attempts remaining.` : 'Code locked.'}`
    );
  }

  // Consume OTP and record last login
  await prisma.$transaction([
    prisma.adminOtp.update({
      where: { id: otpRecord.id },
      data: { consumedAt: new Date() },
    }),
    prisma.adminAccount.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    }),
  ]);

  await logAdminAction({
    adminAccountId: admin.id,
    action: 'ADMIN_LOGIN_SUCCESS',
    entityType: 'AdminAccount',
    entityId: admin.id,
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  const payload = {
    sub: admin.id,
    email: admin.email,
    role: admin.role,
  };

  return {
    accessToken: signAdminAccessToken(payload),
    refreshToken: signAdminRefreshToken(payload),
    admin: {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      permissions: ROLE_PERMISSIONS[admin.role] || [],
    },
  };
}

/**
 * Refreshes admin session using refresh token.
 */
export async function refreshAdminSession(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  let payload;
  try {
    payload = verifyAdminRefreshToken(refreshToken);
  } catch {
    throw createError(401, 'INVALID_REFRESH_TOKEN', 'Admin session expired or invalid');
  }

  const admin = await prisma.adminAccount.findUnique({
    where: { id: payload.sub },
  });

  if (!admin || !admin.isActive) {
    throw createError(401, 'ADMIN_NOT_FOUND', 'Admin account no longer active');
  }

  const newPayload = {
    sub: admin.id,
    email: admin.email,
    role: admin.role,
  };

  return {
    accessToken: signAdminAccessToken(newPayload),
    refreshToken: signAdminRefreshToken(newPayload),
  };
}

/**
 * Returns current admin profile and permissions.
 */
export async function getAdminProfile(adminAccountId: string) {
  const admin = await prisma.adminAccount.findUnique({
    where: { id: adminAccountId },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  if (!admin || !admin.isActive) {
    throw createError(404, 'ADMIN_NOT_FOUND', 'Admin account not found');
  }

  return {
    ...admin,
    permissions: ROLE_PERMISSIONS[admin.role] || [],
  };
}