// backend/src/controllers/adminAudit.controller.ts
// Administration endpoints for reviewing administrative audit logs.

import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prismaClient';

export async function listAuditLogsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 25;
    const action = req.query.action as string | undefined;
    const entityType = req.query.entityType as string | undefined;
    const search = req.query.search as string | undefined;

    const skip = (page - 1) * pageSize;
    const where: any = {};

    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (search?.trim()) {
      where.OR = [
        { action: { contains: search.trim(), mode: 'insensitive' } },
        { entityType: { contains: search.trim(), mode: 'insensitive' } },
        { reason: { contains: search.trim(), mode: 'insensitive' } },
        { entityId: { contains: search.trim() } },
      ];
    }

    const [totalCount, items] = await Promise.all([
      prisma.adminAuditLog.count({ where }),
      prisma.adminAuditLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          adminAccount: { select: { id: true, email: true, role: true } },
        },
      }),
    ]);

    res.json({
      success: true,
      items,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (err) {
    next(err);
  }
}