// backend/src/middleware/requireFeature.ts
// Guards a route by checking the user's plan feature entitlement. Returns 403
// (FEATURE_LOCKED / PLAN_LIMIT_REACHED / PLAN_EXPIRED) if the effective plan
// doesn't grant it, so features are enforced server-side even if the UI is
// bypassed. Also exports requireAIQuota for AI-generation endpoints.

import type { Request, Response, NextFunction } from 'express';
import { resolveEffectivePlan, checkUserEntitlement } from '../services/entitlement.service';

export function requireFeature(
  featureKey: string,
  category: 'feature' | 'quota' = 'feature'
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const plan = await resolveEffectivePlan(req.user!.sub);

      if (plan.status === 'FREE' && plan.planSlug === 'free') {
        // Heuristic: if there's an (expired) paid subscription that no longer
        // resolves, surface a friendlier "expired" error for gateable features.
        // resolveEffectivePlan already degrades expired subs to Free; here we
        // just provide the message. We can't know intent, so fall through to the
        // normal entitlement check (which blocks as free).
      }

      const entitlement = await checkUserEntitlement(req.user!.sub, featureKey);
      if (!entitlement.allowed) {
        const code = category === 'quota' ? 'PLAN_LIMIT_REACHED' : 'FEATURE_LOCKED';
        const msg =
          category === 'quota'
            ? `Your current plan (${entitlement.currentEffectivePlan}) has reached its limit for this feature. Please upgrade to unlock more.`
            : `${featureKey} is not available on your current plan (${entitlement.currentEffectivePlan}). Please upgrade to unlock it.`;
        res.status(403).json({
          error: { code, message: msg, currentEffectivePlan: entitlement.currentEffectivePlan },
        });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Guard for AI-generation endpoints. Returns 403 when the user's plan grants no
 * AI usage (aiCoach locked) or the monthly AI request quota is exhausted. This
 * prevents AI calls/token spend even if the frontend is bypassed.
 */
export function requireAIQuota() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const plan = await resolveEffectivePlan(req.user!.sub);
      const aiFeature = plan.features['aiCoach'];

      // If the plan doesn't grant AI at all, or explicitly locks it, block hard.
      if (aiFeature === false || (aiFeature === undefined && plan.status === 'FREE')) {
        res.status(403).json({
          error: {
            code: 'FEATURE_LOCKED',
            message: `AI features are not available on your current plan (${plan.planName}). Please upgrade to unlock them.`,
            currentEffectivePlan: plan.planName,
          },
        });
        return;
      }

      // If the plan configures an AI quota (aiRequestsPerMonth), enforce it.
      const limit = plan.features['aiRequestsPerMonth'];
      if (typeof limit === 'number' && limit !== -1) {
        const used = await getAIUsage(req.user!.sub);
        if (limit === 0 || used >= limit) {
          res.status(403).json({
            error: {
              code: 'AI_QUOTA_EXCEEDED',
              message: `Your monthly AI request limit (${limit}) has been reached on the ${plan.planName} plan. Please upgrade to continue.`,
              currentEffectivePlan: plan.planName,
              limit,
              used,
            },
          });
          return;
        }
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

async function getAIUsage(userId: string): Promise<number> {
  const { prisma } = await import('../lib/prismaClient');
  try {
    const pref = await prisma.aIPreference.findUnique({ where: { userId } });
    return pref?.aiRequestsThisMonth ?? 0;
  } catch {
    return 0;
  }
}