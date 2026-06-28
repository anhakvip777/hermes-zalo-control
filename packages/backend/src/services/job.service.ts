import { prisma } from "../db.js";

// =============================================================================
// Create a schedule job record
// =============================================================================

export interface CreateJobInput {
  scheduleId: string;
  scheduleVersion: number;
  queueJobId?: string;
  type: string;
  scheduledAt?: Date;
}

export async function createScheduleJob(input: CreateJobInput) {
  return prisma.scheduleJob.create({
    data: {
      scheduleId: input.scheduleId,
      scheduleVersion: input.scheduleVersion,
      queueJobId: input.queueJobId ?? null,
      type: input.type,
      status: "queued",
      scheduledAt: input.scheduledAt ?? null,
    },
  });
}

// =============================================================================
// Cancel all active jobs for a schedule
// =============================================================================

export async function cancelScheduleJobs(scheduleId: string) {
  const activeJobs = await prisma.scheduleJob.findMany({
    where: {
      scheduleId,
      status: { in: ["queued", "active"] },
    },
  });

  if (activeJobs.length === 0) return [];

  const now = new Date();
  await prisma.scheduleJob.updateMany({
    where: {
      scheduleId,
      status: { in: ["queued", "active"] },
    },
    data: {
      status: "cancelled",
      cancelledAt: now,
    },
  });

  return activeJobs;
}

// =============================================================================
// Mark a job as completed
// =============================================================================

export async function completeScheduleJob(jobId: string) {
  return prisma.scheduleJob.update({
    where: { id: jobId },
    data: {
      status: "completed",
      completedAt: new Date(),
    },
  });
}

// =============================================================================
// Mark a job as failed
// =============================================================================

export async function failScheduleJob(jobId: string) {
  return prisma.scheduleJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
    },
  });
}

// =============================================================================
// Find a job by queue ID
// =============================================================================

export async function findJobByQueueId(queueJobId: string) {
  return prisma.scheduleJob.findFirst({
    where: { queueJobId },
  });
}

// =============================================================================
// List jobs for a schedule
// =============================================================================

export async function listScheduleJobs(scheduleId: string) {
  return prisma.scheduleJob.findMany({
    where: { scheduleId },
    orderBy: { createdAt: "desc" },
  });
}
