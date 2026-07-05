// =============================================================================
// Decision Trace Routes (Phase 7) — READ-ONLY, admin-only
// =============================================================================
//   GET /api/trace             — paginated list of traceable inbound messages
//   GET /api/trace/:messageId  — full decision trace for one message
//
// Auth + rate-limit are applied at registration in app.ts (adminAuth +
// strictRateLimit), mirroring the other protected route groups. No writes,
// no tool/action execution, no replay.
// =============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { buildTrace, listTraces } from "../services/trace.service.js";

export async function traceRoutes(app: FastifyInstance) {
  // ── GET /api/trace — list traceable inbound messages ─────────────
  app.get("/trace", async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as Record<string, string | undefined>;
    const page = q.page ? parseInt(q.page, 10) : 1;
    const pageSize = q.pageSize ? parseInt(q.pageSize, 10) : 30;
    const result = await listTraces({
      threadId: q.threadId,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 30,
    });
    return reply.send(result);
  });

  // ── GET /api/trace/:messageId — full decision trace ──────────────
  app.get(
    "/trace/:messageId",
    async (req: FastifyRequest<{ Params: { messageId: string } }>, reply: FastifyReply) => {
      const trace = await buildTrace(req.params.messageId);
      if (!trace) {
        return reply.status(404).send({ error: "TRACE_NOT_FOUND", message: "Message not found" });
      }
      return reply.send({ data: trace });
    },
  );
}
