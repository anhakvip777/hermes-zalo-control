import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CreateAttendanceSessionSchema } from "@hermes/shared";
import * as attendanceService from "../services/attendance.service.js";

const UpdateAttendanceBody = z.object({
  name: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
  targetName: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
  expectedCount: z.number().int().min(0).optional(),
  status: z.enum(["draft", "scheduled", "active", "closed", "cancelled"]).optional(),
});

const SendReminderBody = z.object({
  message: z.string().min(1).max(2000).optional(),
});

export async function attendanceRoutes(app: FastifyInstance) {
  // ─── GET /api/attendance/sessions ────────────────────────────
  app.get("/attendance/sessions", async (request) => {
    const query = request.query as Record<string, string>;
    return attendanceService.listSessions({
      status: query.status,
      page: query.page ? parseInt(query.page, 10) : 1,
      pageSize: query.pageSize ? parseInt(query.pageSize, 10) : 50,
    });
  });

  // ─── POST /api/attendance/sessions ───────────────────────────
  app.post("/attendance/sessions", async (request, reply) => {
    const input = CreateAttendanceSessionSchema.parse(request.body);
    const session = await attendanceService.createSession(input);
    reply.status(201);
    return { data: session };
  });

  // ─── GET /api/attendance/sessions/:id ────────────────────────
  app.get("/attendance/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await attendanceService.getSession(id);
    if (!session) return reply.status(404).send({ error: "NotFound" });
    return { data: session };
  });

  // ─── PATCH /api/attendance/sessions/:id ─────────────────────
  app.patch("/attendance/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = UpdateAttendanceBody.parse(request.body);
    const session = await attendanceService.updateSession(id, body);
    if (!session) return reply.status(404).send({ error: "NotFound" });
    return { data: session };
  });

  // ─── POST /api/attendance/sessions/:id/start ─────────────────
  app.post("/attendance/sessions/:id/start", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await attendanceService.startSession(id);
    if (!session) return reply.status(404).send({ error: "NotFound" });
    return { data: session };
  });

  // ─── POST /api/attendance/sessions/:id/close ─────────────────
  app.post("/attendance/sessions/:id/close", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await attendanceService.closeSession(id);
    if (!session) return reply.status(404).send({ error: "NotFound" });
    return { data: session };
  });

  // ─── POST /api/attendance/sessions/:id/cancel ────────────────
  app.post("/attendance/sessions/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await attendanceService.cancelSession(id);
    if (!session) return reply.status(404).send({ error: "NotFound" });
    return { data: session };
  });

  // ─── POST /api/attendance/sessions/:id/send-reminder ─────────
  app.post("/attendance/sessions/:id/send-reminder", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = SendReminderBody.parse(request.body ?? {});
    try {
      // sendReminder now routes through sendOutbound for full guard coverage
      const result = await attendanceService.sendReminder(id, body.message);
      return { data: result };
    } catch (err: unknown) {
      return reply.status(400).send({ error: "ReminderFailed", message: (err as Error).message });
    }
  });

  // ─── POST /api/attendance/sessions/:id/parse-messages ────────
  app.post("/attendance/sessions/:id/parse-messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await attendanceService.parseMessagesForAttendance(id);
      return { data: result };
    } catch (err: unknown) {
      return reply.status(400).send({ error: "ParseFailed", message: (err as Error).message });
    }
  });

  // ─── GET /api/attendance/sessions/:id/records ────────────────
  app.get("/attendance/sessions/:id/records", async (request, reply) => {
    const { id } = request.params as { id: string };
    const records = await attendanceService.listRecords(id);
    return { data: records };
  });

  // ─── GET /api/attendance/sessions/:id/export.csv ──────────────
  app.get("/attendance/sessions/:id/export.csv", async (request, reply) => {
    const { id } = request.params as { id: string };
    const csv = await attendanceService.exportCsv(id);
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header(
      "Content-Disposition",
      `attachment; filename="attendance-${id}.csv"`,
    );
    return csv;
  });
}
