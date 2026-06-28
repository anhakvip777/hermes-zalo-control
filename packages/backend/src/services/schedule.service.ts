import type { Prisma } from "@prisma/client";
import type { CreateScheduleInput, UpdateScheduleInput, ScheduleFilterInput } from "@hermes/shared";
import { prisma } from "../db.js";

// =============================================================================
// Create
// =============================================================================

export async function createSchedule(input: CreateScheduleInput) {
  const nextRunAt = computeNextRunAt(input.scheduledAt, input.cronExpression);

  const schedule = await prisma.schedule.create({
    data: {
      name: input.name,
      type: input.type,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      cronExpression: input.cronExpression ?? null,
      messageContent: input.messageContent,
      targetId: input.targetId,
      targetName: input.targetName ?? null,
      repeatEnabled: input.repeatEnabled,
      repeatCron: input.repeatCron ?? null,
      createdBy: input.createdBy,
      originalCommand: input.originalCommand ?? null,
      metadata: input.metadata ?? null,
      nextRunAt,
      status: computeInitialStatus(nextRunAt, input.repeatEnabled),
      version: 1,
    },
  });

  // Initial revision
  await prisma.scheduleRevision.create({
    data: {
      scheduleId: schedule.id,
      scheduleVersion: 1,
      field: "_created",
      oldValue: null,
      newValue: JSON.stringify(schedule),
      changedBy: input.createdBy,
    },
  });

  return schedule;
}

// =============================================================================
// Get by ID
// =============================================================================

export async function getScheduleById(id: string) {
  return prisma.schedule.findUnique({ where: { id } });
}

// =============================================================================
// List with filter/sort/pagination
// =============================================================================

export async function listSchedules(filter: ScheduleFilterInput) {
  const where: Prisma.ScheduleWhereInput = {};

  // Status filter
  if (filter.status) {
    if (Array.isArray(filter.status)) {
      where.status = { in: filter.status };
    } else {
      where.status = filter.status;
    }
  }

  // Type filter
  if (filter.type) {
    if (Array.isArray(filter.type)) {
      where.type = { in: filter.type };
    } else {
      where.type = filter.type;
    }
  }

  // Created by filter
  if (filter.createdBy) {
    where.createdBy = filter.createdBy;
  }

  // Search
  if (filter.search) {
    where.OR = [
      { name: { contains: filter.search } },
      { messageContent: { contains: filter.search } },
      { targetName: { contains: filter.search } },
      { originalCommand: { contains: filter.search } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.schedule.findMany({
      where,
      orderBy: { [filter.sortBy]: filter.sortOrder },
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
    }),
    prisma.schedule.count({ where }),
  ]);

  return {
    data,
    total,
    page: filter.page,
    pageSize: filter.pageSize,
    totalPages: Math.ceil(total / filter.pageSize),
  };
}

// =============================================================================
// Update (with version bump + revision log)
// =============================================================================

export async function updateSchedule(
  id: string,
  input: UpdateScheduleInput,
  changedByOverride?: string,
) {
  const changedBy = changedByOverride ?? input.changedBy ?? "user";
  const schedule = await prisma.schedule.findUnique({ where: { id } });
  if (!schedule) return null;

  const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
  const updateData: Prisma.ScheduleUpdateInput = {};

  // Track each field change
  if (input.name !== undefined && input.name !== schedule.name) {
    changes.push({ field: "name", oldValue: schedule.name, newValue: input.name });
    updateData.name = input.name;
  }

  if (input.scheduledAt !== undefined) {
    const newVal = input.scheduledAt ? new Date(input.scheduledAt) : null;
    const oldVal = schedule.scheduledAt;
    if (newVal?.getTime() !== oldVal?.getTime()) {
      changes.push({
        field: "scheduledAt",
        oldValue: oldVal?.toISOString() ?? null,
        newValue: newVal?.toISOString() ?? null,
      });
      updateData.scheduledAt = newVal;
    }
  }

  if (input.cronExpression !== undefined && input.cronExpression !== schedule.cronExpression) {
    changes.push({
      field: "cronExpression",
      oldValue: schedule.cronExpression,
      newValue: input.cronExpression,
    });
    updateData.cronExpression = input.cronExpression;
  }

  if (input.messageContent !== undefined && input.messageContent !== schedule.messageContent) {
    changes.push({
      field: "messageContent",
      oldValue: schedule.messageContent,
      newValue: input.messageContent,
    });
    updateData.messageContent = input.messageContent;
  }

  if (input.targetId !== undefined && input.targetId !== schedule.targetId) {
    changes.push({
      field: "targetId",
      oldValue: schedule.targetId,
      newValue: input.targetId,
    });
    updateData.targetId = input.targetId;
  }

  if (input.targetName !== undefined && input.targetName !== schedule.targetName) {
    changes.push({
      field: "targetName",
      oldValue: schedule.targetName,
      newValue: input.targetName ?? null,
    });
    updateData.targetName = input.targetName ?? null;
  }

  if (input.repeatEnabled !== undefined && input.repeatEnabled !== schedule.repeatEnabled) {
    changes.push({
      field: "repeatEnabled",
      oldValue: String(schedule.repeatEnabled),
      newValue: String(input.repeatEnabled),
    });
    updateData.repeatEnabled = input.repeatEnabled;
  }

  if (input.repeatCron !== undefined && input.repeatCron !== schedule.repeatCron) {
    changes.push({
      field: "repeatCron",
      oldValue: schedule.repeatCron,
      newValue: input.repeatCron,
    });
    updateData.repeatCron = input.repeatCron;
  }

  if (input.status !== undefined && input.status !== schedule.status) {
    changes.push({
      field: "status",
      oldValue: schedule.status,
      newValue: input.status,
    });
    updateData.status = input.status;

    // Set timestamp fields for pause/cancel
    if (input.status === "paused") {
      updateData.pausedAt = new Date();
    }
    if (input.status === "cancelled") {
      updateData.cancelledAt = new Date();
      updateData.nextRunAt = null;
    }
    if (input.status === "active") {
      updateData.pausedAt = null;
    }
  }

  // No changes — return schedule as-is, no version bump
  if (changes.length === 0) {
    return schedule;
  }

  // Increment version
  const newVersion = schedule.version + 1;
  updateData.version = newVersion;

  // Recompute nextRunAt if time changed
  // Skip for cancelled/draft status which don't have next runs
  const skipNextRun = input.status === "cancelled" || input.status === "draft";
  if (
    !skipNextRun &&
    (input.scheduledAt !== undefined ||
      input.cronExpression !== undefined ||
      input.status !== undefined)
  ) {
    const effectiveScheduledAt =
      input.scheduledAt !== undefined
        ? input.scheduledAt
          ? new Date(input.scheduledAt)
          : null
        : schedule.scheduledAt;
    const effectiveCron =
      input.cronExpression !== undefined ? input.cronExpression : schedule.cronExpression;
    updateData.nextRunAt = computeNextRunAt(effectiveScheduledAt?.toISOString(), effectiveCron);
  }

  // Update schedule
  const updated = await prisma.schedule.update({
    where: { id },
    data: updateData,
  });

  // Create revision records
  for (const change of changes) {
    await prisma.scheduleRevision.create({
      data: {
        scheduleId: id,
        scheduleVersion: newVersion,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedBy,
      },
    });
  }

  return updated;
}

// =============================================================================
// Cancel
// =============================================================================

export async function cancelSchedule(id: string, changedBy: string = "user") {
  const by = changedBy as "user" | "ai" | "system";
  return updateSchedule(id, { status: "cancelled", changedBy: by }, by);
}

// =============================================================================
// Get revisions for a schedule
// =============================================================================

export async function getScheduleRevisions(scheduleId: string) {
  return prisma.scheduleRevision.findMany({
    where: { scheduleId },
    orderBy: { createdAt: "desc" },
  });
}

// =============================================================================
// Helpers
// =============================================================================

function computeNextRunAt(
  scheduledAt: string | undefined,
  cronExpression: string | undefined | null,
): Date | null {
  if (scheduledAt) {
    return new Date(scheduledAt);
  }
  // For cron expressions, compute the next occurrence here.
  // In Phase 3 (Queue Worker), we'll integrate with cron-parser.
  // For now, return null for cron-only schedules.
  if (cronExpression) {
    return null; // Will be computed by the worker
  }
  return null;
}

function computeInitialStatus(nextRunAt: Date | null, repeatEnabled: boolean): string {
  if (nextRunAt) {
    return "scheduled";
  }
  if (repeatEnabled) {
    return "active";
  }
  return "draft";
}
