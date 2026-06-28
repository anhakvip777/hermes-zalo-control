// =============================================================================
// Audit Log Service — record key system actions
// =============================================================================

import { prisma } from "../db.js";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string;
  actor?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

export async function auditLog(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        actor: entry.actor ?? "system",
        details: entry.details ? JSON.stringify(entry.details) : null,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch {
    // Audit log failure must not break the main flow
  }
}

export async function listAuditLogs(opts: {
  entityType?: string;
  entityId?: string;
  action?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 50;
  const where: Record<string, unknown> = {};
  if (opts.entityType) where.entityType = opts.entityType;
  if (opts.entityId) where.entityId = opts.entityId;
  if (opts.action) where.action = opts.action;

  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}
