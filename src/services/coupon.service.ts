// backend/src/services/coupon.service.ts
// Handles coupon lifecycle, plan targeting, edge case validations, and atomic redemptions.

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { logAdminAction } from './audit.service';
import type { CouponType, Prisma } from '@prisma/client';

export async function listCoupons(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  isActive?: boolean;
}) {
  const page = Math.max(1, params?.page || 1);
  const pageSize = Math.min(100, Math.max(1, params?.pageSize || 20));
  const skip = (page - 1) * pageSize;

  const where: Prisma.CouponWhereInput = {};
  if (params?.search?.trim()) {
    where.code = { contains: params.search.trim(), mode: 'insensitive' };
  }
  if (params?.isActive !== undefined) {
    where.isActive = params.isActive;
  }

  const [totalCount, items] = await Promise.all([
    prisma.coupon.count({ where }),
    prisma.coupon.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: {
        couponPlans: { include: { plan: true } },
        _count: { select: { redemptions: true } },
      },
    }),
  ]);

  return {
    items: items.map((c) => ({
      ...c,
      actualRedemptionsCount: c._count.redemptions,
    })),
    pagination: {
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    },
  };
}

export async function getCouponById(id: string) {
  const coupon = await prisma.coupon.findUnique({
    where: { id },
    include: {
      couponPlans: { include: { plan: true } },
      redemptions: {
        take: 50,
        orderBy: { redeemedAt: 'desc' },
        include: { user: { select: { id: true, email: true, name: true } } },
      },
    },
  });
  if (!coupon) throw createError(404, 'COUPON_NOT_FOUND', 'Coupon not found');
  return coupon;
}

export async function createCoupon(params: {
  code: string;
  description?: string;
  type: CouponType;
  value: number;
  currency?: string;
  maxUses?: number;
  perUserLimit?: number;
  minimumAmountCents?: number;
  startsAt?: Date | string;
  expiresAt?: Date | string;
  isActive?: boolean;
  appliesToAllPlans?: boolean;
  targetPlanIds?: string[];
  adminAccountId?: string;
}) {
  const code = params.code.trim().toUpperCase();
  const existing = await prisma.coupon.findUnique({ where: { code } });
  if (existing) {
    throw createError(409, 'COUPON_CODE_IN_USE', 'A coupon with this code already exists.');
  }

  if (params.type === 'PERCENTAGE' && (params.value <= 0 || params.value > 100)) {
    throw createError(400, 'INVALID_PERCENTAGE', 'Percentage discount must be between 1 and 100.');
  }

  if (params.type === 'FIXED_AMOUNT' && params.value <= 0) {
    throw createError(400, 'INVALID_FIXED_AMOUNT', 'Fixed discount value must be greater than 0 cents.');
  }

  const coupon = await prisma.coupon.create({
    data: {
      code,
      description: params.description,
      type: params.type,
      value: params.value,
      currency: params.currency || 'USD',
      maxUses: params.maxUses,
      perUserLimit: params.perUserLimit ?? 1,
      minimumAmountCents: params.minimumAmountCents,
      startsAt: params.startsAt ? new Date(params.startsAt) : undefined,
      expiresAt: params.expiresAt ? new Date(params.expiresAt) : undefined,
      isActive: params.isActive ?? true,
      appliesToAllPlans: params.appliesToAllPlans ?? (params.targetPlanIds?.length ? false : true),
      couponPlans:
        params.targetPlanIds && params.targetPlanIds.length > 0
          ? {
              create: params.targetPlanIds.map((planId) => ({ planId })),
            }
          : undefined,
    },
    include: { couponPlans: { include: { plan: true } } },
  });

  if (params.adminAccountId) {
    await logAdminAction({
      adminAccountId: params.adminAccountId,
      action: 'COUPON_CREATED',
      entityType: 'Coupon',
      entityId: coupon.id,
      after: coupon,
    });
  }

  return coupon;
}

export async function updateCoupon(
  id: string,
  params: {
    description?: string;
    isActive?: boolean;
    maxUses?: number;
    perUserLimit?: number;
    minimumAmountCents?: number;
    startsAt?: Date | string | null;
    expiresAt?: Date | string | null;
    appliesToAllPlans?: boolean;
    targetPlanIds?: string[];
    adminAccountId?: string;
  }
) {
  const existing = await prisma.coupon.findUnique({
    where: { id },
    include: { couponPlans: true },
  });
  if (!existing) throw createError(404, 'COUPON_NOT_FOUND', 'Coupon not found');

  const updated = await prisma.$transaction(async (tx) => {
    if (params.targetPlanIds !== undefined) {
      await tx.couponPlan.deleteMany({ where: { couponId: id } });
      if (params.targetPlanIds.length > 0) {
        await tx.couponPlan.createMany({
          data: params.targetPlanIds.map((planId) => ({ couponId: id, planId })),
        });
      }
    }

    return tx.coupon.update({
      where: { id },
      data: {
        description: params.description !== undefined ? params.description : existing.description,
        isActive: params.isActive !== undefined ? params.isActive : existing.isActive,
        maxUses: params.maxUses !== undefined ? params.maxUses : existing.maxUses,
        perUserLimit: params.perUserLimit !== undefined ? params.perUserLimit : existing.perUserLimit,
        minimumAmountCents:
          params.minimumAmountCents !== undefined ? params.minimumAmountCents : existing.minimumAmountCents,
        startsAt: params.startsAt !== undefined ? (params.startsAt ? new Date(params.startsAt) : null) : existing.startsAt,
        expiresAt: params.expiresAt !== undefined ? (params.expiresAt ? new Date(params.expiresAt) : null) : existing.expiresAt,
        appliesToAllPlans:
          params.appliesToAllPlans !== undefined ? params.appliesToAllPlans : existing.appliesToAllPlans,
      },
      include: { couponPlans: { include: { plan: true } } },
    });
  });

  if (params.adminAccountId) {
    await logAdminAction({
      adminAccountId: params.adminAccountId,
      action: 'COUPON_UPDATED',
      entityType: 'Coupon',
      entityId: updated.id,
      before: existing,
      after: updated,
    });
  }

  return updated;
}

export async function validateCoupon(params: {
  code: string;
  userId: string;
  planId?: string;
  subtotalCents: number;
}): Promise<{
  valid: boolean;
  coupon: any;
  discountCents: number;
  finalAmountCents: number;
}> {
  const code = params.code.trim().toUpperCase();
  const coupon = await prisma.coupon.findUnique({
    where: { code },
    include: { couponPlans: true },
  });

  if (!coupon) {
    throw createError(404, 'COUPON_NOT_FOUND', 'Coupon code is invalid.');
  }

  if (!coupon.isActive) {
    throw createError(400, 'COUPON_INACTIVE', 'This coupon is no longer active.');
  }

  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) {
    throw createError(400, 'COUPON_NOT_STARTED', 'This coupon is not active yet.');
  }

  if (coupon.expiresAt && coupon.expiresAt < now) {
    throw createError(400, 'COUPON_EXPIRED', 'This coupon has expired.');
  }

  if (coupon.minimumAmountCents && params.subtotalCents < coupon.minimumAmountCents) {
    throw createError(
      400,
      'MINIMUM_NOT_MET',
      `Order minimum of $${(coupon.minimumAmountCents / 100).toFixed(2)} required for this coupon.`
    );
  }

  // Check plan targeting
  if (!coupon.appliesToAllPlans && params.planId) {
    const matchesPlan = coupon.couponPlans.some((cp) => cp.planId === params.planId);
    if (!matchesPlan) {
      throw createError(400, 'COUPON_PLAN_MISMATCH', 'This coupon does not apply to the selected plan.');
    }
  }

  // Check max global uses
  if (coupon.maxUses !== null && coupon.maxUses !== undefined) {
    const redemptionsCount = await prisma.couponRedemption.count({ where: { couponId: coupon.id } });
    if (redemptionsCount >= coupon.maxUses) {
      throw createError(400, 'COUPON_EXHAUSTED', 'This coupon has reached its maximum usage limit.');
    }
  }

  // Check per-user limit
  if (coupon.perUserLimit) {
    const userRedemptionsCount = await prisma.couponRedemption.count({
      where: { couponId: coupon.id, userId: params.userId },
    });
    if (userRedemptionsCount >= coupon.perUserLimit) {
      throw createError(400, 'COUPON_USER_LIMIT', 'You have already used this coupon.');
    }
  }

  // Calculate discount
  let discountCents = 0;
  if (coupon.type === 'PERCENTAGE') {
    discountCents = Math.round((params.subtotalCents * coupon.value) / 100);
  } else if (coupon.type === 'FIXED_AMOUNT') {
    discountCents = coupon.value;
  }

  discountCents = Math.min(params.subtotalCents, Math.max(0, discountCents));
  const finalAmountCents = Math.max(0, params.subtotalCents - discountCents);

  return {
    valid: true,
    coupon,
    discountCents,
    finalAmountCents,
  };
}

export async function redeemCouponAtomic(
  params: {
    couponId: string;
    userId: string;
    orderId?: string;
    transactionId?: string;
    discountCents: number;
  },
  dbTx?: Prisma.TransactionClient
) {
  const client = dbTx || prisma;

  return client.$transaction(async (tx) => {
    const coupon = await tx.coupon.findUnique({
      where: { id: params.couponId },
    });
    if (!coupon || !coupon.isActive) {
      throw createError(400, 'COUPON_INVALID', 'Coupon is invalid or inactive');
    }

    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
      throw createError(400, 'COUPON_EXHAUSTED', 'Coupon limit reached');
    }

    const redemption = await tx.couponRedemption.create({
      data: {
        couponId: params.couponId,
        userId: params.userId,
        orderId: params.orderId,
        transactionId: params.transactionId,
        discountCents: params.discountCents,
      },
    });

    // Update denormalized cache counter
    await tx.coupon.update({
      where: { id: params.couponId },
      data: { usedCount: { increment: 1 } },
    });

    return redemption;
  });
}

export async function deleteCoupon(id: string, adminAccountId?: string) {
  const coupon = await prisma.coupon.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          redemptions: true,
        },
      },
    },
  });

  if (!coupon) {
    throw createError(404, 'COUPON_NOT_FOUND', 'Coupon not found');
  }

  // Check if coupon has redemption records (due to onDelete: Restrict on CouponRedemption)
  if (coupon._count.redemptions > 0) {
    throw createError(
      400,
      'COUPON_HAS_REDEMPTIONS',
      `Cannot delete coupon "${coupon.code}" because it has been redeemed ${coupon._count.redemptions} time(s). Deactivate the coupon instead to prevent future redemptions.`
    );
  }

  await prisma.$transaction(async (tx) => {
    // Delete couponPlan links
    await tx.couponPlan.deleteMany({ where: { couponId: id } });
    // Nullify references in payment orders and billing transactions
    await tx.paymentOrder.updateMany({ where: { couponId: id }, data: { couponId: null } });
    await tx.billingTransaction.updateMany({ where: { couponId: id }, data: { couponId: null } });
    // Delete coupon
    await tx.coupon.delete({ where: { id } });
  });

  if (adminAccountId) {
    await logAdminAction({
      adminAccountId,
      action: 'COUPON_DELETED',
      entityType: 'Coupon',
      entityId: id,
      before: coupon,
    });
  }

  return { success: true, message: `Coupon "${coupon.code}" was deleted successfully.` };
}