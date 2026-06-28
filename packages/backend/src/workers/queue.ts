// =============================================================================
// Queue Adapter — abstracts BullMQ / node-cron / local timer
// =============================================================================

import { config } from "../config.js";
import type { JobStatus } from "@hermes/shared";

export interface QueueJobData {
  scheduleId: string;
  scheduleVersion: number;
}

export interface QueueAdapter {
  /** Schedule a job to run at a specific time */
  addJob(data: QueueJobData, runAt: Date, jobType: string): Promise<string>;
  /** Cancel a specific job by its queue ID */
  removeJob(queueJobId: string): Promise<void>;
  /** Cancel all jobs matching scheduleId (for local fallback) */
  removeJobsForSchedule?(scheduleId: string): Promise<void>;
  /** Register a processor — called when a job fires */
  onJob(callback: (data: QueueJobData) => Promise<void>): void;
  /** Start listening */
  start(): Promise<void>;
  /** Stop listening */
  stop(): Promise<void>;
  /** Get worker status */
  getStatus(): { provider: string; active: boolean };
}

// =============================================================================
// LocalTimerQueue — in-process timer fallback when Redis unavailable
// =============================================================================

export class LocalTimerQueue implements QueueAdapter {
  private jobs: Map<
    string,
    {
      data: QueueJobData;
      runAt: Date;
      timer: ReturnType<typeof setTimeout>;
      jobType: string;
    }
  > = new Map();
  private callback: ((data: QueueJobData) => Promise<void>) | null = null;
  private active = false;

  async addJob(data: QueueJobData, runAt: Date, jobType: string): Promise<string> {
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const delayMs = Math.max(0, runAt.getTime() - Date.now());

    const timer = setTimeout(async () => {
      this.jobs.delete(id);
      if (this.callback && this.active) {
        await this.callback(data);
      }
    }, delayMs);

    this.jobs.set(id, { data, runAt, timer, jobType });
    return id;
  }

  async removeJob(queueJobId: string): Promise<void> {
    const job = this.jobs.get(queueJobId);
    if (job) {
      clearTimeout(job.timer);
      this.jobs.delete(queueJobId);
    }
  }

  async removeJobsForSchedule(scheduleId: string): Promise<void> {
    for (const [id, job] of this.jobs.entries()) {
      if (job.data.scheduleId === scheduleId) {
        clearTimeout(job.timer);
        this.jobs.delete(id);
      }
    }
  }

  onJob(callback: (data: QueueJobData) => Promise<void>): void {
    this.callback = callback;
  }

  async start(): Promise<void> {
    this.active = true;
  }

  async stop(): Promise<void> {
    this.active = false;
    for (const [, job] of this.jobs.entries()) {
      clearTimeout(job.timer);
    }
    this.jobs.clear();
  }

  getStatus() {
    return {
      provider: "local-timer",
      active: this.active,
    };
  }
}

// =============================================================================
// BullMQQueue — production queue backed by Redis
// =============================================================================

export class BullMQQueue implements QueueAdapter {
  private queue: any; // BullMQ Queue
  private worker: any; // BullMQ Worker
  private callback: ((data: QueueJobData) => Promise<void>) | null = null;
  private active = false;

  constructor() {
    // Lazy-loaded — BullMQ only imported when Redis is available
  }

  async addJob(data: QueueJobData, runAt: Date, _jobType: string): Promise<string> {
    await this.ensureQueue();
    const delayMs = Math.max(0, runAt.getTime() - Date.now());
    const job = await this.queue.add("execute-schedule", data, { delay: delayMs });
    return job.id as string;
  }

  async removeJob(queueJobId: string): Promise<void> {
    if (!this.queue) return;
    try {
      const job = await this.queue.getJob(queueJobId);
      if (job) await job.remove();
    } catch {
      // Job might already be completed/removed
    }
  }

  onJob(callback: (data: QueueJobData) => Promise<void>): void {
    this.callback = callback;
  }

  async start(): Promise<void> {
    await this.ensureWorker();
    this.active = true;
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }

  getStatus() {
    return {
      provider: "bullmq",
      active: this.active,
    };
  }

  private async ensureQueue() {
    if (this.queue) return;
    const { Queue } = await import("bullmq");
    this.queue = new Queue("hermes-schedules", {
      connection: { url: config.redis.url ?? undefined },
    });
  }

  private async ensureWorker() {
    if (this.worker) return;
    const { Worker } = await import("bullmq");
    this.worker = new Worker(
      "hermes-schedules",
      async (job: any) => {
        if (this.callback) {
          await this.callback(job.data as QueueJobData);
        }
      },
      { connection: { url: config.redis.url ?? undefined } },
    );
  }
}

// =============================================================================
// Factory
// =============================================================================

let queueInstance: QueueAdapter | null = null;

export function getQueue(): QueueAdapter {
  if (queueInstance) return queueInstance;

  if (config.redis.url) {
    queueInstance = new BullMQQueue();
  } else {
    queueInstance = new LocalTimerQueue();
  }

  return queueInstance;
}

export function resetQueue(): void {
  queueInstance = null;
}
