// backend/src/services/ai/tokenUsage.service.ts
// Persists and rolls over per-user AI token consumption counters.
// The counters live on the AIPreference row so the settings page can
// surface them without any extra tables or endpoints.

import { prisma } from '../../lib/prismaClient';

export interface TokenUsageSnapshot {
  tokensToday: number;
  tokensThisWeek: number;
  tokensThisMonth: number;
  tokensTotal: number;
  aiCallsTotal: number;
  lastTokenUseAt: string | null;
  periodStart: string;
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  // Sunday-based week (getUTCDay: 0=Sunday)
  const offset = day.getUTCDay();
  day.setUTCDate(day.getUTCDate() - offset);
  return day;
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Add a successful AI call to the user's counters.
 * Rolls over stale windows first, then atomically increments.
 * Never throws — token accounting must not break the feature that used AI.
 */
export async function recordTokenUsage(userId: string, totalTokens: number): Promise<void> {
  try {
    const now = new Date();

    const existing = await prisma.aIPreference.findUnique({ where: { userId } });
    if (!existing) {
      // No preference row yet — create one with the base defaults and just record.
      await prisma.aIPreference.create({
        data: {
          userId,
          tokensToday: totalTokens,
          tokensThisWeek: totalTokens,
          tokensThisMonth: totalTokens,
          tokensTotal: totalTokens,
          aiCallsTotal: 1,
          lastTokenUseAt: now,
          tokenPeriodStart: now,
        },
      });
      return;
    }

    // ── Rollover stale windows ──────────────────────────────────────────
    const dayStart = startOfDay(now);
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);
    const periodStart = existing.tokenPeriodStart ?? now;
    const crossedDay = dayStart > startOfDay(periodStart);
    const crossedWeek = weekStart > startOfWeek(periodStart);
    const crossedMonth = monthStart > startOfMonth(periodStart);

    // Only reset counters that crossed their boundary; keep the more
    // granular ones alive (e.g. if only the day changed, week/month persist).
    const next = {
      ...(crossedDay ? { tokensToday: 0 } : {}),
      ...(crossedWeek ? { tokensThisWeek: 0 } : {}),
      ...(crossedMonth ? { tokensThisMonth: 0 } : {}),
      ...(crossedDay || crossedWeek || crossedMonth ? { tokenPeriodStart: now } : {}),
    };

    await prisma.aIPreference.update({
      where: { userId },
      data: {
        ...next,
        tokensToday: { increment: totalTokens },
        tokensThisWeek: { increment: totalTokens },
        tokensThisMonth: { increment: totalTokens },
        tokensTotal: { increment: totalTokens },
        aiCallsTotal: { increment: 1 },
        lastTokenUseAt: now,
      },
    });
  } catch (error: any) {
    console.error(`[TokenUsage] Failed to record usage for user ${userId}:`, error?.message ?? error);
  }
}

/**
 * Resolve the current usage snapshot, rolling over stale windows so the UI
 * never shows a stale "today/week/month" count.
 */
export async function getTokenUsage(userId: string): Promise<TokenUsageSnapshot> {
  const now = new Date();
  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  const pref = await prisma.aIPreference.findUnique({ where: { userId } });
  if (!pref) {
    return {
      tokensToday: 0,
      tokensThisWeek: 0,
      tokensThisMonth: 0,
      tokensTotal: 0,
      aiCallsTotal: 0,
      lastTokenUseAt: null,
      periodStart: now.toISOString(),
    };
  }

  const periodStart = pref.tokenPeriodStart ?? now;
  const crossedDay = dayStart > startOfDay(periodStart);
  const crossedWeek = weekStart > startOfWeek(periodStart);
  const crossedMonth = monthStart > startOfMonth(periodStart);

  const needsStaleUpdate = crossedDay || crossedWeek || crossedMonth;

  if (needsStaleUpdate) {
    await prisma.aIPreference.update({
      where: { userId },
      data: {
        ...(crossedDay ? { tokensToday: 0 } : {}),
        ...(crossedWeek ? { tokensThisWeek: 0 } : {}),
        ...(crossedMonth ? { tokensThisMonth: 0 } : {}),
        tokenPeriodStart: now,
      },
    });
  }

  const fresh = needsStaleUpdate
    ? await prisma.aIPreference.findUnique({ where: { userId } })
    : pref;

  return {
    tokensToday: fresh?.tokensToday ?? 0,
    tokensThisWeek: fresh?.tokensThisWeek ?? 0,
    tokensThisMonth: fresh?.tokensThisMonth ?? 0,
    tokensTotal: fresh?.tokensTotal ?? 0,
    aiCallsTotal: fresh?.aiCallsTotal ?? 0,
    lastTokenUseAt: fresh?.lastTokenUseAt?.toISOString() ?? null,
    periodStart: periodStart.toISOString(),
  };
}