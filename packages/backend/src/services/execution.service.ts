import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

// =============================================================================
// List executions (with optional scheduleId filter)
// =============================================================================

export interface ExecutionFilter {
  scheduleId?: string;
  status?: string | string[];
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export async function listExecutions(filter: ExecutionFilter = {}) {
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const sortBy = filter.sortBy ?? "plannedRunAt";
  const sortOrder = filter.sortOrder ?? "desc";

  const where: Prisma.ScheduleExecutionWhereInput = {};

  if (filter.scheduleId) {
    where.scheduleId = filter.scheduleId;
  }

  if (filter.status) {
    if (Array.isArray(filter.status)) {
      where.status = { in: filter.status };
    } else {
      where.status = filter.status;
    }
  }

  const [data, total] = await Promise.all([
    prisma.scheduleExecution.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.scheduleExecution.count({ where }),
  ]);

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// =============================================================================
// Get execution by ID
// =============================================================================

export async function getExecutionById(id: string) {
  return prisma.scheduleExecution.findUnique({ where: { id } });
}

// =============================================================================
// Create execution (called by worker in Phase 3)
// =============================================================================

export interface CreateExecutionInput {
  scheduleId: string;
  scheduleVersion: number;
  scheduleJobId?: string;
  mode: string;
  plannedRunAt: Date;
  targetId: string;
  targetName?: string | null;
  messageContent: string;
  dryRun?: boolean;
  maxRetries?: number;
}

export async function createExecution(input: CreateExecutionInput) {
  return prisma.scheduleExecution.create({
    data: {
      scheduleId: input.scheduleId,
      scheduleVersion: input.scheduleVersion,
      scheduleJobId: input.scheduleJobId ?? null,
      mode: input.mode,
      plannedRunAt: input.plannedRunAt,
      targetId: input.targetId,
      targetName: input.targetName ?? null,
      messageContent: input.messageContent,
      dryRun: input.dryRun ?? false,
      maxRetries: input.maxRetries ?? 3,
      status: "pending",
    },
  });
}

// =============================================================================
// Update execution result (called by worker after send attempt)
// =============================================================================

export interface UpdateExecutionResultInput {
  id: string;
  status: string;
  mode?: string;
  dryRun?: boolean;
  actualRunAt?: Date;
  finishedAt?: Date;
  zaloMessageId?: string | null;
  errorMessage?: string | null;
  errorCode?: string | null;
  retryCount?: number;
  nextRetryAt?: Date | null;
  metadata?: string | null;
}

export async function updateExecutionResult(input: UpdateExecutionResultInput) {
  return prisma.scheduleExecution.update({
    where: { id: input.id },
    data: {
      status: input.status,
      mode: input.mode,
      dryRun: input.dryRun,
      actualRunAt: input.actualRunAt,
      finishedAt: input.finishedAt,
      zaloMessageId: input.zaloMessageId,
      errorMessage: input.errorMessage,
      errorCode: input.errorCode,
      retryCount: input.retryCount,
      nextRetryAt: input.nextRetryAt,
      metadata: input.metadata,
    },
  });
}

// =============================================================================
// Get recent executions (for dashboard)
// =============================================================================

export async function getRecentExecutions(limit: number = 20) {
  return prisma.scheduleExecution.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
