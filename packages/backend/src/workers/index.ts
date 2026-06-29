// =============================================================================
// Worker entry point — `node packages/backend/dist/workers/index.js`
//
// Architecture: Worker is the ONLY process that executes scheduled jobs.
// Backend only creates schedule_jobs rows with status=queued.
// Worker polls DB every 10s for queued jobs due for execution.
// Atomic claim prevents duplicate execution across multiple workers.
// =============================================================================

import { executeJob } from "./scheduler.js";
import { config } from "../config.js";
import { getCurrentEffectiveDryRun } from "../services/runtime-config.service.js";
import { prisma } from "../db.js";
import { pollBatches } from "./message-batch-worker.js";

const POLL_INTERVAL_MS = 10_000; // 10 seconds

async function main() {
  console.log(`Worker started (dryRun: ${getCurrentEffectiveDryRun()}, redis: ${config.redis.url ? "connected" : "polling fallback"})`);

  // Atomic claim helper: set job status from 'queued' to 'active' in one update.
  // Returns the job if claimed, null if another worker took it.
  async function claimJob(jobId: string) {
    const result = await prisma.scheduleJob.updateMany({
      where: { id: jobId, status: "queued" },
      data: { status: "active" },
    });
    return result.count > 0;
  }

  // Execute a claimed job with full DB reload, version guard, etc.
  async function executeClaimedJob(job: {
    id: string;
    scheduleId: string;
    scheduleVersion: number;
    type: string;
  }) {
    try {
      await executeJob(
        { scheduleId: job.scheduleId, scheduleVersion: job.scheduleVersion },
      );
      // Mark completed
      await prisma.scheduleJob.update({
        where: { id: job.id },
        data: { status: "completed", completedAt: new Date() },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Job ${job.id} failed: ${msg}`);
      await prisma.scheduleJob.update({
        where: { id: job.id },
        data: { status: "failed" },
      });
    }
  }

  // ── Pre-warm Zalo session ────────────────────────────────────────
  if (!getCurrentEffectiveDryRun()) {
    try {
      const { getZaloGateway } = await import("../services/zalo-gateway.service.js");
      const gw = getZaloGateway();
      if (!gw.isConnected()) {
        const restored = await gw.restoreSession({ startListener: false });
        console.log(`Zalo pre-warm: restore=${restored} connected=${gw.isConnected()}`);
      } else {
        console.log(`Zalo pre-warm: already connected`);
      }
    } catch (e: unknown) {
      console.error(`Zalo pre-warm error: ${(e as Error).message}`);
    }
  }

  // ── Main polling loop ────────────────────────────────────────────
  console.log(`Polling DB every ${POLL_INTERVAL_MS / 1000}s for queued jobs...`);

  const poll = async () => {
    const now = new Date();

    // Find queued jobs that are due (scheduledAt <= now) with active/scheduled schedule
    const queuedJobs = await prisma.scheduleJob.findMany({
      where: {
        status: "queued",
        scheduledAt: { lte: now },
        schedule: {
          status: { in: ["scheduled", "active"] },
        },
      },
      orderBy: { scheduledAt: "asc" },
      take: 10, // batch at most 10 jobs per poll
    });

    for (const job of queuedJobs) {
      const claimed = await claimJob(job.id);
      if (!claimed) continue; // another worker took it

      console.log(`Executing job ${job.id} for schedule ${job.scheduleId} v${job.scheduleVersion}`);
      await executeClaimedJob(job);
    }
  };

  // ── Worker heartbeat: write status to DB each poll cycle ──────────
  async function heartbeat() {
    try {
      await prisma.appSetting.upsert({
        where: { key: "worker.status" },
        update: { value: JSON.stringify({
          active: true,
          provider: "db-polling",
          pollIntervalMs: POLL_INTERVAL_MS,
          lastPollAt: new Date().toISOString(),
        }) },
        create: { key: "worker.status", value: JSON.stringify({ active: true, provider: "db-polling" }) },
      });
      // ── Also write to SystemHeartbeat for health monitoring ──
      const { heartbeatOk } = await import("../services/heartbeat.service.js");
      await heartbeatOk("schedulerWorker", {
        provider: "db-polling",
        pollIntervalMs: POLL_INTERVAL_MS,
        dryRun: getCurrentEffectiveDryRun(),
      });
    } catch { /* non-critical */ }
  }

  // Initial poll immediately
  await poll();
  await pollBatches();
  await heartbeat();

  // Then poll on interval
  const pollInterval = setInterval(async () => {
    await poll();
    await pollBatches();
    await heartbeat();
  }, POLL_INTERVAL_MS);

  // Handle graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down worker...");
    clearInterval(pollInterval);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
