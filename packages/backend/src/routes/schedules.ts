import type { FastifyInstance } from "fastify";
import { CreateScheduleSchema, UpdateScheduleSchema, ScheduleFilterSchema } from "@hermes/shared";
import * as scheduleService from "../services/schedule.service.js";
import * as executionService from "../services/execution.service.js";
import * as jobService from "../services/job.service.js";
import { rescheduleAfterUpdate } from "../workers/scheduler-bridge.js";

// Helper: decide if update should cancel/recreate jobs
function shouldReschedule(input: Record<string, unknown>): boolean {
  return (
    "scheduledAt" in input ||
    "cronExpression" in input ||
    "messageContent" in input ||
    "targetId" in input ||
    "status" in input
  );
}

export async function scheduleRoutes(app: FastifyInstance) {
  // =========================================================================
  // GET /api/schedules — list
  // =========================================================================
  app.get("/schedules", async (request) => {
    const filter = ScheduleFilterSchema.parse(request.query);
    return scheduleService.listSchedules(filter);
  });

  // =========================================================================
  // POST /api/schedules — create
  // =========================================================================
  app.post("/schedules", async (request, reply) => {
    const input = CreateScheduleSchema.parse(request.body);
    const schedule = await scheduleService.createSchedule(input);

    // Queue job if schedule has a next run time
    if (schedule.nextRunAt && (schedule.status === "scheduled" || schedule.status === "active")) {
      await rescheduleAfterUpdate(schedule.id, schedule.version);
    }

    reply.status(201);
    return { data: schedule };
  });

  // =========================================================================
  // GET /api/schedules/:id — detail
  // =========================================================================
  app.get("/schedules/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const schedule = await scheduleService.getScheduleById(id);
    if (!schedule) {
      return reply.status(404).send({ error: "NotFound", message: "Schedule not found" });
    }
    return { data: schedule };
  });

  // =========================================================================
  // PATCH /api/schedules/:id — update
  // =========================================================================
  app.patch("/schedules/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = UpdateScheduleSchema.parse(request.body);

    // Cancel old jobs before updating (R7)
    if (
      input.scheduledAt !== undefined ||
      input.cronExpression !== undefined ||
      input.messageContent !== undefined ||
      input.targetId !== undefined ||
      input.status !== undefined
    ) {
      const cancelledJobs = await jobService.cancelScheduleJobs(id);
      request.log.info(
        { scheduleId: id, cancelledJobCount: cancelledJobs.length },
        "Cancelled old jobs for schedule update",
      );
    }

    const updated = await scheduleService.updateSchedule(id, input);
    if (!updated) {
      return reply.status(404).send({ error: "NotFound", message: "Schedule not found" });
    }

    // Create new job if needed (R7)
    if (shouldReschedule(input)) {
      await rescheduleAfterUpdate(id, updated.version);
    }

    return { data: updated };
  });

  // =========================================================================
  // POST /api/schedules/:id/cancel
  // =========================================================================
  app.post("/schedules/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, string> | undefined;
    const changedBy = body?.changedBy ?? "user";

    // Cancel all jobs first
    await jobService.cancelScheduleJobs(id);

    const updated = await scheduleService.cancelSchedule(id, changedBy);
    if (!updated) {
      return reply.status(404).send({ error: "NotFound", message: "Schedule not found" });
    }
    return { data: updated };
  });

  // =========================================================================
  // GET /api/schedules/:id/revisions
  // =========================================================================
  app.get("/schedules/:id/revisions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const schedule = await scheduleService.getScheduleById(id);
    if (!schedule) {
      return reply.status(404).send({ error: "NotFound", message: "Schedule not found" });
    }
    const revisions = await scheduleService.getScheduleRevisions(id);
    return { data: revisions };
  });

  // =========================================================================
  // GET /api/schedules/:id/executions
  // =========================================================================
  app.get("/schedules/:id/executions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const schedule = await scheduleService.getScheduleById(id);
    if (!schedule) {
      return reply.status(404).send({ error: "NotFound", message: "Schedule not found" });
    }
    const result = await executionService.listExecutions({
      scheduleId: id,
      page: 1,
      pageSize: 100,
    });
    return result;
  });

  // =========================================================================
  // GET /api/schedules/:id/jobs
  // =========================================================================
  app.get("/schedules/:id/jobs", async (request, reply) => {
    const { id } = request.params as { id: string };
    const schedule = await scheduleService.getScheduleById(id);
    if (!schedule) {
      return reply.status(404).send({ error: "NotFound", message: "Schedule not found" });
    }
    const jobs = await jobService.listScheduleJobs(id);
    return { data: jobs };
  });
}
