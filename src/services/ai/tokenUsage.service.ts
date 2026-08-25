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

// The token counters roll over on India Standard Time (IST = UTC+5:30) day/week/month
// boundaries so "today" matches the user's local calendar day rather than UTC midnight.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 5h 30m ahead of UTC

/**
 * Shift a UTC timestamp into IST, truncate to the start of its IST calendar day,
 * then shift back to UTC. The result is the UTC instant of IST local midnight.
 */
function startOfDay(date: Date): Date {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST_OFFSET_MS
  );
}

function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  // Sunday-based week (0=Sunday) in IST
  const shifted = new Date(day.getTime() + IST_OFFSET_MS);
  const offset = shifted.getUTCDay();
  day.setUTCDate(day.getUTCDate() - offset);
  return day;
}

function startOfMonth(date: Date): Date {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - IST_OFFSET_MS);
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
          aiRequestsThisMonth: 1,
          aiRequestsTotal: 1,
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
    // NOTE: reset and increment MUST be separate update calls — if they share one
    // data object, the increment keys overwrite the reset keys (both target the same
    // fields) and the windows would never roll over (today/week/month stay == total).
    const needsRollover = crossedDay || crossedWeek || crossedMonth;
    if (needsRollover) {
      await prisma.aIPreference.update({
        where: { userId },
        data: {
          ...(crossedDay ? { tokensToday: 0 } : {}),
          ...(crossedWeek ? { tokensThisWeek: 0 } : {}),
          ...(crossedMonth ? { tokensThisMonth: 0 } : {}),
          ...(crossedMonth ? { aiRequestsThisMonth: 0 } : {}),
          tokenPeriodStart: now,
        },
      });
    }

    // Increment every window (these must not share a data object with the reset above).
    await prisma.aIPreference.update({
      where: { userId },
      data: {
        tokensToday: { increment: totalTokens },
        tokensThisWeek: { increment: totalTokens },
        tokensThisMonth: { increment: totalTokens },
        tokensTotal: { increment: totalTokens },
        aiCallsTotal: { increment: 1 },
        aiRequestsThisMonth: { increment: 1 },
        aiRequestsTotal: { increment: 1 },
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
        ...(crossedMonth ? { aiRequestsThisMonth: 0 } : {}),
        tokenPeriodStart: now,
      },
    });
  }

  const fresh = needsStaleUpdate ? await prisma.aIPreference.findUnique({ where: { userId } }) : pref;

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
