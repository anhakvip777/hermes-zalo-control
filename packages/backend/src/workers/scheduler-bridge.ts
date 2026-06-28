// =============================================================================
// Scheduler Service — bridge between schedule updates and the queue
// =============================================================================

import { getQueue, type QueueAdapter } from "../workers/queue.js";
import * as jobService from "../services/job.service.js";
import * as scheduleService from "../services/schedule.service.js";

// =============================================================================
// Schedule a job for a schedule
// =============================================================================

export interface ScheduleJobOptions {
  scheduleId: string;
  scheduleVersion: number;
  runAt: Date;
  type: string; // "scheduled" | "run_now" | "retry"
}

export async function queueScheduleJob(opts: ScheduleJobOptions): Promise<string> {
  const queue = getQueue();

  // Queue the job
  const queueJobId = await queue.addJob(
    { scheduleId: opts.scheduleId, scheduleVersion: opts.scheduleVersion },
    opts.runAt,
    opts.type,
  );

  // Record in schedule_jobs
  await jobService.createScheduleJob({
    scheduleId: opts.scheduleId,
    scheduleVersion: opts.scheduleVersion,
    queueJobId,
    type: opts.type,
    scheduledAt: opts.runAt,
  });

  return queueJobId;
}

// =============================================================================
// Cancel all jobs for a schedule (R7)
// =============================================================================

export async function cancelScheduleJobs(scheduleId: string): Promise<void> {
  const queue = getQueue();

  // Cancel in-memory queue jobs
  if (queue.removeJobsForSchedule) {
    await queue.removeJobsForSchedule(scheduleId);
  }

  // Also try to remove individual BullMQ jobs
  const activeJobs = await jobService.cancelScheduleJobs(scheduleId);
  for (const job of activeJobs) {
    if (job.queueJobId) {
      try {
        await queue.removeJob(job.queueJobId);
      } catch {
        // Job might already be removed
      }
    }
  }
}

// =============================================================================
// Re-schedule after update (R7 full flow)
// =============================================================================

export async function rescheduleAfterUpdate(scheduleId: string, newVersion: number): Promise<void> {
  // 1. Cancel old jobs
  await cancelScheduleJobs(scheduleId);

  // 2. Fetch updated schedule
  const schedule = await scheduleService.getScheduleById(scheduleId);
  if (!schedule) return;

  // 3. Create new job if schedule has a next run time and is runnable
  if (schedule.nextRunAt && (schedule.status === "scheduled" || schedule.status === "active")) {
    await queueScheduleJob({
      scheduleId: schedule.id,
      scheduleVersion: newVersion,
      runAt: schedule.nextRunAt,
      type: "scheduled",
    });
  }
}

// =============================================================================
// Initialize the queue system (call on startup)
// =============================================================================

export function getQueueStatus() {
  return getQueue().getStatus();
}
