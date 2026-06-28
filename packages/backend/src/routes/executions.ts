import type { FastifyInstance } from "fastify";
import * as scheduleService from "../services/schedule.service.js";
import * as executionService from "../services/execution.service.js";
import { executeDryRun, executeRunNow } from "../workers/scheduler.js";
import { MockMessageSender } from "../services/message-sender.js";
import { rescheduleAfterUpdate } from "../workers/scheduler-bridge.js";
import { prisma } from "../db.js";

// Create a singleton mock sender for API-triggered executions
const mockSender = new MockMessageSender();

// ── Timeout wrapper ──────────────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function executionRoutes(app: FastifyInstance) {
  // =========================================================================
  // POST /api/schedules/:id/run-now
  // =========================================================================
  app.post("/schedules/:id/run-now", async (request, reply) => {
    const { id } = request.params as { id: string };

    const schedule = await scheduleService.getScheduleById(id);
    if (!schedule) {
      return reply.status(404).send({ error: "NotFound", message: "Schedule not found" });
    }

    const result = await executeRunNow(id, { sender: mockSender });

    if (!result.success && !result.executionId) {
      return reply.status(400).send({ error: "RunFailed", message: result.error });
    }

    return { data: result };
  });

  // =========================================================================
  // POST /api/schedules/:id/run-dry
  // =========================================================================
  app.post("/schedules/:id/run-dry", async (request, reply) => {
    const { id } = request.params as { id: string };

    const schedule = await scheduleService.getScheduleById(id);
    if (!schedule) {
      return reply.status(404).send({ error: "NotFound", message: "Schedule not found" });
    }

    const result = await executeDryRun(id, { sender: mockSender });

    if (!result.executionId) {
      return reply.status(400).send({ error: "DryRunFailed", message: result.reason });
    }

    return { data: result };
  });

  // =========================================================================
  // POST /api/schedules/:id/pause
  // =========================================================================
  app.post("/schedules/:id/pause", async (request, reply) => {
    const { id } = request.params as { id: string };

    const updated = await scheduleService.updateSchedule(id, { status: "paused" });
    if (!updated) {
      return reply.status(404).send({ error: "NotFound", message: "Schedule not found" });
    }

    // Reschedule handles cancel + new job creation if needed
    await rescheduleAfterUpdate(id, updated.version);

    return { data: updated };
  });

  // =========================================================================
  // POST /api/schedules/:id/resume
  // =========================================================================
  app.post("/schedules/:id/resume", async (request, reply) => {
    const { id } = request.params as { id: string };

    const schedule = await scheduleService.getScheduleById(id);
    if (!schedule) {
      return reply.status(404).send({ error: "NotFound", message: "Schedule not found" });
    }

    // Resume to appropriate status
    const newStatus = schedule.nextRunAt ? "scheduled" : "active";
    const updated = await scheduleService.updateSchedule(id, {
      status: newStatus as "scheduled" | "active",
    });
    if (!updated) {
      return reply.status(404).send({ error: "NotFound", message: "Schedule not found" });
    }

    await rescheduleAfterUpdate(id, updated.version);

    return { data: updated };
  });

  // =========================================================================
  // GET /api/worker/status — reads from DB heartbeat written by worker
  // Falls back safely if DB is slow or unavailable (<2s guarantee)
  // =========================================================================
  app.get("/worker/status", async (_request, reply) => {
    try {
      // Try DB heartbeat read with 1500ms timeout
      const raw = await withTimeout(
        prisma.appSetting.findUnique({ where: { key: "worker.status" } }).then((s) => s?.value ?? null),
        1500,
        null,
      );

      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          return { worker: parsed };
        } catch {
          // JSON parse failed — stale/corrupt data
        }
      }

      // Fallback: legacy in-memory status (fast, no DB)
      const { getQueueStatus } = await import("../workers/scheduler-bridge.js");
      return { worker: getQueueStatus() };
    } catch {
      // DB unavailable or any unexpected error
      return reply.status(200).send({
        worker: {
          active: false,
          provider: "unknown",
          error: "WORKER_STATUS_UNAVAILABLE",
        },
      });
    }
  });

  // =========================================================================
  // GET /api/executions — list all executions
  // =========================================================================
  app.get("/executions", async (request) => {
    const query = request.query as Record<string, string>;
    return executionService.listExecutions({
      scheduleId: query.scheduleId,
      status: query.status,
      page: query.page ? parseInt(query.page, 10) : 1,
      pageSize: query.pageSize ? parseInt(query.pageSize, 10) : 20,
    });
  });
}
